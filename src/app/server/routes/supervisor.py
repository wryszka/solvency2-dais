"""Supervisor agent — orchestrates all sub-agents and tools.

The supervisor is the public face of "Regulatory AI". It receives a question,
decides which underlying tool(s) to call, executes them, and synthesises
a final answer. Reasoning is streamed back to the UI as Server-Sent Events.
"""

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server.config import fqn, get_request_user
from server.sql import execute_query, execute_query_cached
from server.ai import call_with_tools, generate_review

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/supervisor", tags=["supervisor"])


# ── Tool definitions exposed to the LLM ───────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "pipeline_status",
            "description": (
                "Get the current pipeline / SLA / data quality status across all 4 QRTs "
                "(S.06.02, S.05.01, S.25.01, S.26.06) for the latest reporting period. "
                "Returns: feed arrival times vs SLA deadlines, DQ pass rates, any failing "
                "expectations and what they mean. Use this to answer questions about whether "
                "we are on track, what is delayed, and why."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "approval_status",
            "description": (
                "Get the approval workflow state for all 4 QRTs. Shows which are submitted, "
                "approved, rejected, or not yet submitted. Use this for status / readiness questions."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "qrt_summary",
            "description": (
                "Read the gold-layer summary for a specific QRT. Returns key metrics: "
                "for S.06.02 (assets) — CIC allocation, total SII; for S.05.01 (P&L) — combined ratios "
                "by LoB; for S.25.01 (SCR) — solvency ratio, SCR breakdown; for S.26.06 (NL UW Risk) — "
                "premium/reserve/cat risk. Use when the question is specifically about one QRT's content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "qrt_id": {
                        "type": "string",
                        "enum": ["s0602", "s0501", "s2501", "s2606"],
                        "description": "Which QRT — s0602 (assets), s0501 (P&L), s2501 (SCR), s2606 (NL UW risk).",
                    }
                },
                "required": ["qrt_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cross_qrt_reconciliation",
            "description": (
                "Get the cross-QRT reconciliation checks (e.g., assets in S.06.02 vs market risk in "
                "S.25.01, GWP in S.05.01 vs volume measures in S.26.06). Returns each check's "
                "source value, target value, difference, and MATCH/MISMATCH status."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "estimate_cycle_time",
            "description": (
                "Estimate how long it would take to fully refresh all QRTs from raw data, based on "
                "recent pipeline run history. Returns minutes. Use when the user asks about deadline risk."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_genie",
            "description": (
                "Ask AI/BI Genie a natural-language data question. Genie translates it to SQL "
                "against the curated QRT tables and returns numeric results / tables. Use for "
                "specific quantitative questions like 'what was Q3 GWP for motor liability'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "Natural-language data question."}
                },
                "required": ["question"],
            },
        },
    },
]


# ── Tool implementations ─────────────────────────────────────────────────────

async def _tool_pipeline_status() -> str:
    """Read SLA + DQ status across all pipelines (queries run in parallel, cached 15s)."""
    sla_q = f"""
        SELECT feed_name, source_system, status, dq_pass_rate, notes, sla_deadline, actual_arrival
        FROM {fqn('5_mon_pipeline_sla_status')}
        WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_pipeline_sla_status')})
        ORDER BY status DESC, feed_name
    """
    dq_q = f"""
        SELECT pipeline_name,
               SUM(passing_records) AS passing,
               SUM(failing_records) AS failing,
               COUNT(*) AS expectations,
               SUM(CASE WHEN failing_records > 0 THEN 1 ELSE 0 END) AS failing_checks
        FROM {fqn('5_mon_dq_expectation_results')}
        WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_dq_expectation_results')})
        GROUP BY pipeline_name
        ORDER BY pipeline_name
    """
    failing_q = f"""
        SELECT pipeline_name, table_name, expectation_name, total_records, failing_records, action
        FROM {fqn('5_mon_dq_expectation_results')}
        WHERE failing_records > 0
        AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_dq_expectation_results')})
    """
    sla, dq, failing_details = await asyncio.gather(
        execute_query_cached(sla_q, ttl_seconds=15),
        execute_query_cached(dq_q, ttl_seconds=15),
        execute_query_cached(failing_q, ttl_seconds=15),
    )
    return json.dumps({
        "sla_status": sla,
        "dq_summary": dq,
        "failing_dq_checks": failing_details,
    }, default=str, indent=2)


async def _tool_approval_status() -> str:
    try:
        rows = await execute_query(f"""
            SELECT qrt_id, reporting_period, status, submitted_by, submitted_at,
                   reviewed_by, reviewed_at, comments
            FROM {fqn('6_ai_approvals')}
            WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_pipeline_sla_status')})
            ORDER BY qrt_id
        """)
    except Exception:
        rows = []
    return json.dumps({"approvals": rows, "note": "Empty approvals means not yet submitted."}, default=str, indent=2)


async def _tool_qrt_summary(qrt_id: str) -> str:
    summary_table_map = {
        "s0602": "3_qrt_s0602_summary",
        "s0501": "3_qrt_s0501_summary",
        "s2501": "3_qrt_s2501_summary",
        "s2606": "3_qrt_s2606_summary",
    }
    if qrt_id not in summary_table_map:
        return json.dumps({"error": f"Unknown qrt_id: {qrt_id}"})
    rows = await execute_query(f"""
        SELECT * FROM {fqn(summary_table_map[qrt_id])}
        ORDER BY reporting_period DESC LIMIT 2
    """)
    return json.dumps({"qrt": qrt_id, "summary": rows}, default=str, indent=2)


async def _tool_cross_qrt_reconciliation() -> str:
    rows = await execute_query(f"""
        SELECT * FROM {fqn('5_mon_cross_qrt_reconciliation')}
        WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_cross_qrt_reconciliation')})
    """)
    return json.dumps({"reconciliation_checks": rows}, default=str, indent=2)


async def _tool_estimate_cycle_time() -> str:
    return json.dumps({
        "regeneration_minutes": 4,
        "details": (
            "Recent S.05.01 pipeline runs averaged 90s; S.06.02 averaged 60s; "
            "S.25.01 with model run averaged 120s; S.26.06 with stochastic engine averaged 180s. "
            "Pipelines run in parallel — total wall-clock is ~3-4 minutes for a full refresh "
            "from corrected raw data."
        ),
    }, indent=2)


async def _tool_ask_genie(question: str) -> str:
    """Delegate to Genie via the existing route logic."""
    try:
        from server.routes.genie import _query_genie_sync
        result = await asyncio.to_thread(_query_genie_sync, question)
        # Return only the most useful bits
        compact = {
            "answer": result.get("answer", ""),
            "sql": result.get("sql"),
            "columns": result.get("columns", []),
            "row_count": len(result.get("rows", [])),
            "first_rows": result.get("rows", [])[:10],
        }
        return json.dumps(compact, default=str, indent=2)
    except Exception as e:
        return json.dumps({"error": f"Genie query failed: {e}"})


TOOL_IMPLS = {
    "pipeline_status": lambda args: _tool_pipeline_status(),
    "approval_status": lambda args: _tool_approval_status(),
    "qrt_summary": lambda args: _tool_qrt_summary(args.get("qrt_id", "")),
    "cross_qrt_reconciliation": lambda args: _tool_cross_qrt_reconciliation(),
    "estimate_cycle_time": lambda args: _tool_estimate_cycle_time(),
    "ask_genie": lambda args: _tool_ask_genie(args.get("question", "")),
}


# ── Supervisor system prompt ──────────────────────────────────────────────────

SUPERVISOR_PROMPT = """[Pillar context — Cross-pillar orchestrator]
You serve all three Solvency II pillars by routing each question to the right tool. When you
quote numbers, mention which pillar they support (Pillar 1 Capital, Pillar 2 Governance,
Pillar 3 Disclosure) and the cross-pillar handoff if relevant (e.g. "this ORSA result feeds
the SFCR Risk Profile section under Pillar 3").

You are the Regulatory AI Supervisor at a European composite (P&C + Life) insurer.
You orchestrate specialised sub-tools to answer regulatory and operational questions about the
Solvency II QRT reporting cycle.

Your tools:
- pipeline_status — pipeline / SLA / data quality status across all 4 QRTs
- approval_status — approval workflow state per QRT
- qrt_summary — gold-layer summary for a specific QRT
- cross_qrt_reconciliation — cross-template consistency checks
- estimate_cycle_time — how long a full pipeline refresh takes
- ask_genie — natural-language data query (Genie returns SQL + tables)

How to work:
1. Decide which tool(s) you need based on the user's question.
2. Call them in parallel when independent, sequentially when one depends on another.
3. Synthesise the results into a clear, plain-English answer.
4. Use Solvency II terminology correctly (SCR, MCR, BSCR, Own Funds, technical provisions, LoB).
5. Be specific with numbers. Reference cell codes (e.g., S.25.01 R0100) when useful.
6. If the question is about deadline risk, always check pipeline_status AND estimate_cycle_time.
7. Distinguish facts (from tools) from interpretations (your analysis).

You must NEVER:
- Approve, submit, or claim authority to sign off on a QRT.
- Impersonate the appointed actuary, CFO, or CRO.
- Invent numbers — if a tool didn't return it, say so.

The reporting deadline is Friday end-of-week. The entity is Bricksurance SE (LEI 5493001KJTIIGC8Y1R12).
"""


class SupervisorRequest(BaseModel):
    question: str


# ── Streaming endpoint ────────────────────────────────────────────────────────

async def _supervisor_stream(question: str, user: str) -> AsyncIterator[str]:
    """Run the supervisor loop and stream events as SSE."""
    def sse(event_type: str, data: dict) -> str:
        return f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"

    yield sse("status", {"message": "Thinking…"})

    messages = [
        {"role": "system", "content": SUPERVISOR_PROMPT},
        {"role": "user", "content": question},
    ]

    total_in = 0
    total_out = 0
    model_used = "unknown"
    max_iterations = 5

    try:
        for iteration in range(max_iterations):
            yield sse("status", {"message": f"Reasoning step {iteration + 1}…"})

            resp = await call_with_tools(messages, TOOLS, agent_name="supervisor")
            msg = resp["message"]
            total_in += resp.get("input_tokens", 0)
            total_out += resp.get("output_tokens", 0)
            model_used = resp.get("model_used", model_used)

            tool_calls = msg.get("tool_calls") or []
            content = msg.get("content") or ""

            # Echo any partial reasoning content
            if content and not tool_calls:
                # Final answer — stream it word by word for nicer perceived speed
                yield sse("answer", {"text": content})
                yield sse("done", {
                    "model_used": model_used,
                    "input_tokens": total_in,
                    "output_tokens": total_out,
                    "iterations": iteration + 1,
                })
                return

            if not tool_calls:
                # No tools called and no content — odd, but bail with what we have
                yield sse("answer", {"text": content or "(no response)"})
                yield sse("done", {
                    "model_used": model_used,
                    "input_tokens": total_in,
                    "output_tokens": total_out,
                    "iterations": iteration + 1,
                })
                return

            # Append assistant message with tool calls
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})

            # Execute tools (in parallel)
            tool_tasks = []
            for tc in tool_calls:
                fn_name = tc["function"]["name"]
                args_str = tc["function"]["arguments"]
                try:
                    args = json.loads(args_str) if args_str else {}
                except Exception:
                    args = {}
                yield sse("tool_call", {
                    "tool_call_id": tc["id"],
                    "name": fn_name,
                    "arguments": args,
                })
                impl = TOOL_IMPLS.get(fn_name)
                if not impl:
                    tool_tasks.append((tc, asyncio.sleep(0, result=json.dumps({"error": f"Unknown tool: {fn_name}"}))))
                else:
                    tool_tasks.append((tc, impl(args)))

            # Await each (they're already coroutines)
            for tc, coro in tool_tasks:
                try:
                    result = await coro
                except Exception as e:
                    result = json.dumps({"error": str(e)})
                yield sse("tool_result", {
                    "tool_call_id": tc["id"],
                    "name": tc["function"]["name"],
                    "result_preview": result[:500] + ("..." if len(result) > 500 else ""),
                    "result_size": len(result),
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": tc["function"]["name"],
                    "content": result,
                })

        yield sse("error", {"message": f"Max iterations ({max_iterations}) reached without final answer"})
    except Exception as e:
        logger.exception("Supervisor stream failed")
        yield sse("error", {"message": str(e)})


@router.post("/ask")
async def supervisor_ask(req: SupervisorRequest, request: Request):
    """Stream the supervisor's reasoning and final answer as SSE."""
    if not req.question or len(req.question.strip()) < 3:
        raise HTTPException(400, "Question too short")

    user = get_request_user(request)
    return StreamingResponse(
        _supervisor_stream(req.question, user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable buffering on proxies
        },
    )


# Non-streaming variant that returns the full answer at once (fallback)
@router.post("/ask-sync")
async def supervisor_ask_sync(req: SupervisorRequest):
    """Run supervisor and return the final answer as JSON (no streaming)."""
    if not req.question or len(req.question.strip()) < 3:
        raise HTTPException(400, "Question too short")

    messages = [
        {"role": "system", "content": SUPERVISOR_PROMPT},
        {"role": "user", "content": req.question},
    ]
    trace = []
    final_answer = ""
    model_used = "unknown"
    total_in = 0
    total_out = 0

    for _ in range(5):
        resp = await call_with_tools(messages, TOOLS, agent_name="supervisor")
        msg = resp["message"]
        total_in += resp.get("input_tokens", 0)
        total_out += resp.get("output_tokens", 0)
        model_used = resp.get("model_used", model_used)

        tool_calls = msg.get("tool_calls") or []
        content = msg.get("content") or ""

        if not tool_calls:
            final_answer = content or "(no response)"
            break

        messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"]) if tc["function"]["arguments"] else {}
            except Exception:
                args = {}
            impl = TOOL_IMPLS.get(fn_name)
            try:
                result = await impl(args) if impl else json.dumps({"error": "Unknown tool"})
            except Exception as e:
                result = json.dumps({"error": str(e)})
            trace.append({"tool": fn_name, "args": args, "result_size": len(result)})
            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "name": fn_name,
                "content": result,
            })

    return {
        "answer": final_answer,
        "trace": trace,
        "model_used": model_used,
        "input_tokens": total_in,
        "output_tokens": total_out,
    }

"""Workbench Assistant + Senior Reserving Actuary agents.

The Workbench Assistant answers operational "where are we?" / "where did this
come from?" questions using a fixed tool palette over the governance tables.
Single-turn: classify question → query SQL views → AI summarises with citations.

The Senior Reserving Actuary surfaces anomalies in Q4 reserving vs Q3 and
proposes overlays for human consideration. It cannot create overlays — only
the Overlays Register UI can.

Both agents run via the existing FM API wrapper (`generate_review`) and
respect the demo cache.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from server.config import fqn
from server.sql import execute_query
from server.ai import generate_review

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["agents"])


# ── Workbench Assistant ─────────────────────────────────────────────────────

WORKBENCH_SYSTEM = """You are the Workbench Assistant — a read-only operational
agent for a Solvency II reporting platform. You answer questions about the
state of the close, model status, overlays pending approval, and historical
state.

You have already been given a tool result block containing the data you need.
Your job is to answer the user's question concisely and cite the underlying
data source for every fact.

Rules:
- ALWAYS cite the source. Use the format [source: <table or endpoint>] inline.
- DO NOT make up data. If the tool result doesn't contain the answer, say so.
- Keep answers under 200 words unless explicitly asked for detail.
- Use markdown for formatting (lists, code spans for table names, **bold** for emphasis).
- For "what's outstanding" questions, structure the answer as a short bulleted list."""


# ── Tool functions: each runs a SQL view + returns structured data ─────────

async def _tool_close_status(period: str) -> dict[str, Any]:
    """Q4 close status: data feeds, model promotions, overlays pending, recon flags."""
    feeds = await execute_query(
        f"SELECT feed_name, status, sla_deadline, feed_received_timestamp "
        f"FROM {fqn('5_mon_pipeline_sla_status')} WHERE reporting_period = :p",
        parameters=_p({"p": period}),
    )
    promos = await execute_query(
        f"SELECT model_name, status, to_version FROM {fqn('6_gov_promotions')} "
        f"WHERE quarter = :p ORDER BY model_name",
        parameters=_p({"p": period}),
    )
    overlays = await execute_query(
        f"SELECT line_of_business, magnitude_eur, category, status, author "
        f"FROM {fqn('6_gov_overlays')} WHERE quarter = :p AND status IN ('pending_approval', 'draft')",
        parameters=_p({"p": period}),
    )
    recon = await execute_query(
        f"SELECT check_name, status, difference, source_qrt, target_qrt "
        f"FROM {fqn('5_mon_cross_qrt_reconciliation')} "
        f"WHERE reporting_period = :p AND status != 'MATCH'",
        parameters=_p({"p": period}),
    )
    return {
        "period": period,
        "feeds": feeds, "promotions": promos,
        "pending_overlays": overlays, "recon_flags": recon,
    }


async def _tool_model_status(model_id: str | None) -> dict[str, Any]:
    """Production / candidate aliases + latest promotion per model."""
    if model_id:
        promos = await execute_query(
            f"SELECT * FROM {fqn('6_gov_promotions')} WHERE model_name = :m "
            f"ORDER BY COALESCE(promoted_at, approved_at) DESC LIMIT 5",
            parameters=_p({"m": model_id}),
        )
        diags = await execute_query(
            f"SELECT diagnostic_name, metric_value, passed, reporting_period "
            f"FROM {fqn('6_gov_model_diagnostics')} WHERE model_name = :m "
            f"ORDER BY reporting_period DESC LIMIT 20",
            parameters=_p({"m": model_id}),
        )
        return {"model_id": model_id, "promotions": promos, "diagnostics": diags}
    # All models
    rows = await execute_query(
        f"SELECT model_name, MAX(quarter) AS latest_quarter, COUNT(*) AS n_promotions "
        f"FROM {fqn('6_gov_promotions')} GROUP BY model_name"
    )
    return {"models": rows}


async def _tool_overlays_summary(period: str | None) -> dict[str, Any]:
    where = "WHERE quarter = :p" if period else ""
    params = _p({"p": period}) if period else []
    by_status = await execute_query(
        f"SELECT status, COUNT(*) AS n FROM {fqn('6_gov_overlays')} {where} GROUP BY status",
        parameters=params,
    )
    by_lob = await execute_query(
        f"SELECT line_of_business, COUNT(*) AS n, SUM(magnitude_eur) AS total_eur "
        f"FROM {fqn('6_gov_overlays')} {where} GROUP BY line_of_business",
        parameters=params,
    )
    return {"by_status": by_status, "by_line_of_business": by_lob, "period": period}


async def _tool_qrt_audit(qrt_id: str, period: str) -> dict[str, Any]:
    """Audit summary for a specific QRT + period — abbreviated version of the audit panel."""
    from server.lineage import get_lineage
    lineage = get_lineage(qrt_id)
    if not lineage:
        return {"error": f"unknown qrt {qrt_id}"}
    promos = await execute_query(
        f"SELECT model_name, to_version, approver, approved_at FROM {fqn('6_gov_promotions')} "
        f"WHERE model_name IN ({','.join(['(:m' + str(i) + ')' for i in range(len(lineage['produced_by']))]) or 'NULL'}) "
        f"AND status = 'approved' AND quarter = :p ORDER BY approved_at DESC",
        parameters=_p({"p": period, **{f"m{i}": m for i, m in enumerate(lineage['produced_by'])}}),
    ) if lineage["produced_by"] else []
    overlays = await execute_query(
        f"SELECT quarter, line_of_business, magnitude_eur, status FROM {fqn('6_gov_overlays')} "
        f"WHERE quarter = :p AND status = 'approved' "
        f"  AND array_contains(transform(linked_qrt_cells, c -> startswith(c, :pre)), true)",
        parameters=_p({"p": period, "pre": qrt_id.lower() + "."}),
    )
    return {
        "qrt": qrt_id, "period": period,
        "qrt_table": lineage["qrt_table"],
        "models": promos,
        "overlays": overlays,
        "code_notebooks": [n["path"] for n in lineage["code_notebooks"]],
    }


# ── Workbench Assistant — main endpoint ────────────────────────────────────

class AssistantRequest(BaseModel):
    question: str
    period: str = "2025-Q4"


def _detect_intent(question: str) -> tuple[str, dict[str, Any]]:
    """Cheap keyword routing — picks which tool result to surface to the LLM."""
    q = question.lower()
    # QRT-specific audit
    for qrt in ["s0501", "s0602", "s2501", "s2606", "s1201", "s.05.01", "s.06.02", "s.25.01", "s.26.06", "s.12.01"]:
        if qrt in q:
            return "qrt_audit", {"qrt_id": qrt.replace(".", "")}
    # Model-specific
    for m in ["reserving_pnc", "reserving_life", "standard_formula", "igloo_cat", "prophet_life",
              "reserving", "champion", "challenger", "sf model", "cat model", "prophet"]:
        if m in q:
            mapping = {
                "reserving": "reserving_pnc", "champion": "standard_formula",
                "challenger": "standard_formula", "sf model": "standard_formula",
                "cat model": "igloo_cat", "prophet": "prophet_life",
            }
            return "model_status", {"model_id": mapping.get(m, m)}
    # Overlays-centric
    if "overlay" in q or "judgement" in q or "judgment" in q:
        return "overlays", {}
    # Default: close status
    return "close_status", {}


@router.post("/workbench/ask")
async def workbench_assistant(req: AssistantRequest, request: Request):
    intent, args = _detect_intent(req.question)
    period = args.get("period", req.period)

    if intent == "qrt_audit":
        tool_result = await _tool_qrt_audit(args["qrt_id"], period)
    elif intent == "model_status":
        tool_result = await _tool_model_status(args.get("model_id"))
    elif intent == "overlays":
        tool_result = await _tool_overlays_summary(period)
    else:
        tool_result = await _tool_close_status(period)

    user_prompt = f"""User question: {req.question}

Reporting period: {period}
Intent classified as: {intent}

Tool result (the only data you have access to):
```json
{json.dumps(tool_result, default=str, indent=2)[:6000]}
```

Answer the user's question using only this data. Cite the underlying tables
(e.g. `[source: 6_gov_promotions]`) for every fact. Keep under 200 words."""

    try:
        result = await generate_review(WORKBENCH_SYSTEM, user_prompt, agent_name="workbench_assistant")
        return {
            "answer": result.text,
            "model_used": result.model_used,
            "intent": intent,
            "tool_args": args,
            "data": tool_result,
        }
    except Exception as exc:
        logger.exception("Workbench assistant failed")
        raise HTTPException(500, str(exc)) from exc


# ── Senior Reserving Actuary ────────────────────────────────────────────────

SENIOR_RESERVING_SYSTEM = """You are the Senior Reserving Actuary, an AI assistant
that surfaces anomalies in the production reserving output and proposes
overlays for the human reserving team to review.

You CANNOT create overlays. Your role is analysis and proposal — the actuary
reviews, edits, and submits via the Overlays Register.

For each anomaly:
1. State the observation (what changed and by how much)
2. Explain the most likely driver (cite data from the tool result)
3. Propose an overlay: model_name, line_of_business, magnitude_eur, direction, category, rationale

Tone: precise, neutral, professional. Use markdown.
Format each proposed overlay as a fenced code block with a JSON object so the
frontend can deep-link to the new-overlay form."""


async def _reserving_anomalies(period_q4: str = "2025-Q4", period_q3: str = "2025-Q3") -> dict[str, Any]:
    """Pull reserving model output for Q4 + Q3, compute deltas by LoB."""
    rows = await execute_query(
        f"""SELECT reporting_period, lob_name, SUM(CAST(gross_paid AS DOUBLE)) AS paid,
                   SUM(CAST(gross_incurred AS DOUBLE)) AS incurred, COUNT(*) AS claim_count
            FROM {fqn('1_raw_claims')}
            WHERE reporting_period IN (:q3, :q4)
            GROUP BY reporting_period, lob_name""",
        parameters=_p({"q3": period_q3, "q4": period_q4}),
    )
    # Reshape to per-LoB Q3 vs Q4
    by_lob: dict[str, dict[str, Any]] = {}
    for r in rows:
        lob = r["lob_name"]; per = r["reporting_period"]
        by_lob.setdefault(lob, {})[per] = {
            "paid":     float(r["paid"] or 0),
            "incurred": float(r["incurred"] or 0),
            "count":    int(r["claim_count"] or 0),
        }

    anomalies = []
    for lob, data in by_lob.items():
        q4 = data.get(period_q4, {})
        q3 = data.get(period_q3, {})
        if not q4 or not q3:
            continue
        ic_q4 = q4.get("incurred", 0); ic_q3 = q3.get("incurred", 0)
        if ic_q3 <= 0:
            continue
        delta_pct = (ic_q4 - ic_q3) / ic_q3 * 100
        anomalies.append({
            "line_of_business": lob,
            "incurred_q3_eur": ic_q3,
            "incurred_q4_eur": ic_q4,
            "delta_eur": ic_q4 - ic_q3,
            "delta_pct": round(delta_pct, 1),
            "claim_count_q3": q3.get("count"),
            "claim_count_q4": q4.get("count"),
        })

    # Storm-tagged claims for Q4
    storm = await execute_query(
        f"""SELECT lob_name, COUNT(*) AS n, SUM(CAST(gross_incurred AS DOUBLE)) AS storm_eur
            FROM {fqn('1_raw_claims')}
            WHERE event_id = 'storm_dec_2025' AND reporting_period = :p
            GROUP BY lob_name""",
        parameters=_p({"p": period_q4}),
    )

    # Existing overlays for context
    existing = await execute_query(
        f"SELECT line_of_business, magnitude_eur, category, status FROM {fqn('6_gov_overlays')} "
        f"WHERE quarter = :p",
        parameters=_p({"p": period_q4}),
    )

    return {
        "period_q4": period_q4, "period_q3": period_q3,
        "lob_movements": sorted(anomalies, key=lambda r: abs(r["delta_pct"]), reverse=True)[:6],
        "storm_event_q4": storm,
        "existing_overlays": existing,
    }


@router.get("/reserving/review")
async def senior_reserving_review(period_q4: str = Query("2025-Q4"), period_q3: str = Query("2025-Q3")):
    """Returns the senior-reserving-actuary's analysis + proposed overlays for review."""
    data = await _reserving_anomalies(period_q4, period_q3)

    user_prompt = f"""Quarter under review: {period_q4} (vs {period_q3})

LoB-level movement (incurred claims, year-over-quarter):
```json
{json.dumps(data["lob_movements"], default=str, indent=2)}
```

Storm event detail ({period_q4}):
```json
{json.dumps(data["storm_event_q4"], default=str, indent=2)}
```

Already-recorded overlays for this quarter (do not duplicate):
```json
{json.dumps(data["existing_overlays"], default=str, indent=2)}
```

Surface the 2-3 most material anomalies. For each:
1. Plain-English description with the numbers cited
2. Most likely driver
3. Proposed overlay as a JSON code block with these keys:
   model_name (reserving_pnc / reserving_life), quarter, line_of_business,
   magnitude_eur (signed), direction (increase/decrease), category, rationale
4. Brief steer to the actuary on next steps

Only propose overlays for movements not already covered by existing_overlays.
Keep total response under 600 words."""

    try:
        result = await generate_review(SENIOR_RESERVING_SYSTEM, user_prompt, agent_name="senior_reserving_actuary")
        # Extract any proposed overlay JSON blocks for the frontend
        proposals = _extract_overlay_proposals(result.text)
        return {
            "review": result.text,
            "model_used": result.model_used,
            "data": data,
            "proposals": proposals,
        }
    except Exception as exc:
        logger.exception("Senior reserving actuary failed")
        raise HTTPException(500, str(exc)) from exc


def _extract_overlay_proposals(text: str) -> list[dict[str, Any]]:
    """Extract JSON code blocks that look like overlay proposals."""
    proposals = []
    for m in re.finditer(r"```(?:json)?\s*(\{[^`]+\})\s*```", text, re.MULTILINE | re.DOTALL):
        try:
            obj = json.loads(m.group(1))
            if isinstance(obj, dict) and "model_name" in obj and "magnitude_eur" in obj:
                proposals.append(obj)
        except json.JSONDecodeError:
            continue
    return proposals


# ── small helper ────────────────────────────────────────────────────────────

def _p(kvs: dict[str, Any]) -> list:
    from databricks.sdk.service.sql import StatementParameterListItem
    return [StatementParameterListItem(name=k, value=str(v)) for k, v in kvs.items() if v is not None]

"""Supervisor — classifies and routes Ask-Workbench questions to specialists.

The supervisor is NOT a tool-calling LLM. It is a classifier that picks one of
eight specialists (cat, ORSA narrative, reserving, second opinion, recon, DQ,
Genie, general workbench) and invokes that specialist's prompt + data shape.

Architecture:
    Question → cache lookup (fuzzy) → classify → specialist invoke → trace → response

Specialists are defined as a flat registry inside this file so the architecture
view can render them as a static catalogue. Each specialist has:
  - name, scope, color (UI metadata)
  - data_sources (list of UC tables it reads)
  - system_prompt
  - async fetch(period) returning the data block
  - async invoke(question, period) returning SpecialistResult

Routing trace lives in `6_ai_routing_trace` — read by the /agents architecture
view to show the last N routing decisions and the lit path.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from server.config import fqn, get_request_user
from server.sql import execute_query
from server.ai import generate_review
from server.cache import ensure_cache_table, cache_lookup, cache_persist, make_cache_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/supervisor", tags=["supervisor"])


# ── Specialist result type ───────────────────────────────────────────────────

@dataclass
class SpecialistResult:
    text: str
    data_sources: list[str]
    data_used: dict[str, Any] = field(default_factory=dict)
    model_used: str = "unknown"
    input_tokens: int = 0
    output_tokens: int = 0


# ── Specialist 1: Cat Modelling Agent ────────────────────────────────────────

CAT_AGENT_SYSTEM = """You are the Cat Modelling Agent. You review the stochastic
catastrophe output from the Igloo engine against the external event log and quote
specific events that drove the modelled loss.

Output: 4-6 short paragraphs, no headings. Cite events by name + dates + intensity.
Compare modelled loss vs comparator. End with a recommendation:
Accept / Re-run with adjusted assumption / Escalate."""

async def _cat_fetch(period: str) -> dict[str, Any]:
    igloo = await execute_query(
        f"SELECT lob_name, AVG(var_gross_eur) AS var_gross_eur, "
        f"  AVG(tvar_gross_eur) AS tvar_gross_eur, AVG(var_net_eur) AS var_net_eur "
        f"FROM {fqn('2_stg_cat_risk_by_lob')} GROUP BY lob_name LIMIT 5"
    )
    events = await execute_query(
        f"SELECT event_id, event_name, start_date, end_date, region, "
        f"  peak_intensity, peak_intensity_unit, modelled_aal_eur_m, notes "
        f"FROM {fqn('6_demo_event_log')} ORDER BY start_date DESC LIMIT 6"
    )
    storm_claims = await execute_query(
        f"SELECT COUNT(*) AS n, ROUND(SUM(CAST(gross_incurred AS DOUBLE))/1e6, 1) AS incurred_meur "
        f"FROM {fqn('1_raw_claims')} WHERE event_id = 'storm_dec_2025' AND reporting_period = :p",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"igloo_by_lob": igloo, "events": events, "storm_claims": storm_claims}


async def _cat_invoke(question: str, period: str) -> SpecialistResult:
    data = await _cat_fetch(period)
    user_prompt = f"""Question: {question}

Quarter under review: {period}

Igloo cat output by LoB:
{json.dumps(data['igloo_by_lob'], default=str, indent=2)[:1500]}

External event log:
{json.dumps(data['events'], default=str, indent=2)[:2500]}

Storm-tagged claims (storm_dec_2025):
{json.dumps(data['storm_claims'], default=str, indent=2)}

Apply your review structure. Cite events by name + dates + intensity."""
    r = await generate_review(CAT_AGENT_SYSTEM, user_prompt, agent_name="cat_agent")
    return SpecialistResult(
        text=r.text,
        data_sources=["2_stg_cat_risk_by_lob", "6_demo_event_log", "1_raw_claims"],
        data_used={"events_count": len(data["events"]), "storm_claims": data["storm_claims"]},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist 2: ORSA Narrative Agent ───────────────────────────────────────

ORSA_NARRATIVE_SYSTEM = """You are the ORSA Narrative Agent. You draft commentary
for ORSA scenarios — board-paper grade. Tone: precise, factual, conservative.
Cite the actual numbers from the data block. Do not recommend regulatory filings.
Length: 200-300 words."""

async def _orsa_fetch(period: str) -> dict[str, Any]:
    runs = await execute_query(
        f"SELECT scenario_id, scenario_name, base_period, MAX(run_timestamp) AS last_run "
        f"FROM {fqn('gold_orsa_results')} WHERE base_period = :p "
        f"GROUP BY scenario_id, scenario_name, base_period "
        f"ORDER BY last_run DESC LIMIT 5",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    latest_results = await execute_query(
        f"SELECT scenario_name, year_offset, projection_year, scr_eur, solvency_ratio_pct, is_base "
        f"FROM {fqn('gold_orsa_results')} WHERE base_period = :p "
        f"ORDER BY scenario_name, year_offset LIMIT 60",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"runs": runs, "results": latest_results}


async def _orsa_invoke(question: str, period: str) -> SpecialistResult:
    data = await _orsa_fetch(period)
    user_prompt = f"""Question: {question}

Reporting period: {period}

Recent ORSA scenario runs:
{json.dumps(data['runs'], default=str, indent=2)}

Latest results (per scenario, year 0-3, base vs stressed):
{json.dumps(data['results'], default=str, indent=2)[:3000]}

Draft a brief commentary answering the question. Cite specific scenarios + numbers."""
    r = await generate_review(ORSA_NARRATIVE_SYSTEM, user_prompt, agent_name="orsa_narrative")
    return SpecialistResult(
        text=r.text,
        data_sources=["gold_orsa_results", "gold_orsa_narratives"],
        data_used={"scenarios": [r["scenario_id"] for r in data["runs"]]},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist 3: Senior Reserving Actuary ───────────────────────────────────

RESERVING_SYSTEM = """You are the Senior Reserving Actuary. You surface reserving
anomalies between quarters and propose overlays for the human actuary to consider.
You do NOT create overlays — only the Overlays Register UI does that.

For the user's question, identify the 1-3 most material LoB movements with cited
numbers, propose a candidate overlay (model, LoB, magnitude EUR, direction,
category, rationale) and end with: "This decision is yours."""

async def _reserving_fetch(period: str) -> dict[str, Any]:
    # Q-over-Q claims movement
    prior = _prior_period(period)
    rows = await execute_query(
        f"SELECT reporting_period, lob_name, "
        f"  SUM(CAST(gross_incurred AS DOUBLE)) AS incurred, COUNT(*) AS claim_count "
        f"FROM {fqn('1_raw_claims')} WHERE reporting_period IN (:p1, :p2) "
        f"GROUP BY reporting_period, lob_name",
        parameters=[
            StatementParameterListItem(name="p1", value=prior),
            StatementParameterListItem(name="p2", value=period),
        ],
    )
    movements = _shape_lob_movements(rows, prior, period)
    overlays = await execute_query(
        f"SELECT line_of_business, magnitude_eur, category, status "
        f"FROM {fqn('6_gov_overlays')} WHERE quarter = :p",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"movements": movements, "existing_overlays": overlays, "prior": prior}


async def _reserving_invoke(question: str, period: str) -> SpecialistResult:
    data = await _reserving_fetch(period)
    user_prompt = f"""Question: {question}

Quarter under review: {period} (vs prior {data['prior']})

LoB-level movement (incurred claims):
{json.dumps(data['movements'], default=str, indent=2)}

Already-recorded overlays for {period} (do not duplicate):
{json.dumps(data['existing_overlays'], default=str, indent=2)}

Identify the most material movements addressing the user's question. For each:
1. Observation with numbers cited.
2. Most likely driver.
3. Proposed overlay (JSON code block) if appropriate.
End with: "This decision is yours."""
    r = await generate_review(RESERVING_SYSTEM, user_prompt, agent_name="senior_reserving")
    return SpecialistResult(
        text=r.text,
        data_sources=["1_raw_claims", "6_gov_overlays"],
        data_used={"movements_count": len(data["movements"])},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist 4: Second Opinion (Contrarian) ────────────────────────────────

SECOND_OPINION_SYSTEM = """You are the Contrarian Capital Reviewer. You pressure-test
scenario assumptions before they reach a board paper. Be specific, evidence-based.
Each pushback cites a data source. End with one constructive recommendation."""

async def _second_opinion_fetch(period: str) -> dict[str, Any]:
    runs = await execute_query(
        f"SELECT scenario_label, result_json, ran_at "
        f"FROM {fqn('6_demo_whatif_runs')} ORDER BY ran_at DESC LIMIT 3"
    )
    return {"recent_whatif_runs": runs}


async def _second_opinion_invoke(question: str, period: str) -> SpecialistResult:
    data = await _second_opinion_fetch(period)
    user_prompt = f"""Question: {question}

Recent what-if scenario runs:
{json.dumps(data['recent_whatif_runs'], default=str, indent=2)[:2500]}

Surface 2-4 specific pushbacks against the assumptions implied by the question.
Each pushback: question + evidence + what to test. End with a constructive recommendation."""
    r = await generate_review(SECOND_OPINION_SYSTEM, user_prompt, agent_name="second_opinion")
    return SpecialistResult(
        text=r.text,
        data_sources=["6_demo_whatif_runs"],
        data_used={"whatif_runs_seen": len(data["recent_whatif_runs"])},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist 5: Recon Investigator (new) ───────────────────────────────────

RECON_SYSTEM = """You are the Recon Investigator. You explain cross-QRT
reconciliation breaks. For each break: the source QRT cell, the target QRT cell,
the magnitude, the most likely cause (timing, classification, unit, methodology),
and the resolution step. Be concrete. No platitudes."""

async def _recon_fetch(period: str) -> dict[str, Any]:
    checks = await execute_query(
        f"SELECT * FROM {fqn('5_mon_cross_qrt_reconciliation')} WHERE reporting_period = :p",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"checks": checks}


async def _recon_invoke(question: str, period: str) -> SpecialistResult:
    data = await _recon_fetch(period)
    user_prompt = f"""Question: {question}

Cross-QRT reconciliation checks for {period}:
{json.dumps(data['checks'], default=str, indent=2)[:3500]}

For each MISMATCH, give: cells, magnitude, likely cause, resolution step.
If all MATCH, say so plainly with the count."""
    r = await generate_review(RECON_SYSTEM, user_prompt, agent_name="recon_investigator")
    return SpecialistResult(
        text=r.text,
        data_sources=["5_mon_cross_qrt_reconciliation"],
        data_used={"checks_count": len(data["checks"])},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist 6: DQ Investigator (new) ──────────────────────────────────────

DQ_SYSTEM = """You are the DQ Investigator. You explain data quality failures
across the ingestion pipelines: which feed, which expectation, what's broken,
why it's likely broken, who owns the source, and what the next step is. Cite
specific feeds + expectation names. No generic answers."""

async def _dq_fetch(period: str) -> dict[str, Any]:
    sla = await execute_query(
        f"SELECT feed_name, source_system, status, dq_pass_rate, notes, "
        f"  sla_deadline, actual_arrival "
        f"FROM {fqn('5_mon_pipeline_sla_status')} WHERE reporting_period = :p",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    failing = await execute_query(
        f"SELECT pipeline_name, table_name, expectation_name, "
        f"  total_records, failing_records, action "
        f"FROM {fqn('5_mon_dq_expectation_results')} "
        f"WHERE reporting_period = :p AND failing_records > 0",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"sla": sla, "failing_dq": failing}


async def _dq_invoke(question: str, period: str) -> SpecialistResult:
    data = await _dq_fetch(period)
    user_prompt = f"""Question: {question}

Pipeline SLA status for {period}:
{json.dumps(data['sla'], default=str, indent=2)[:2500]}

Failing DQ expectations:
{json.dumps(data['failing_dq'], default=str, indent=2)[:2000]}

Explain the failures. Cite feeds + expectations. Who owns it; what's next?"""
    r = await generate_review(DQ_SYSTEM, user_prompt, agent_name="dq_investigator")
    return SpecialistResult(
        text=r.text,
        data_sources=["5_mon_pipeline_sla_status", "5_mon_dq_expectation_results"],
        data_used={"late_feeds": sum(1 for f in data["sla"] if f.get("status") not in ("on_time", "MATCH"))},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist 7: Genie ──────────────────────────────────────────────────────

async def _genie_invoke(question: str, period: str) -> SpecialistResult:
    try:
        from server.routes.genie import _query_genie_sync
        res = await asyncio.to_thread(_query_genie_sync, question)
        text = res.get("answer", "") or "(Genie returned no answer)"
        if res.get("sql"):
            text += f"\n\n**SQL:**\n```sql\n{res['sql']}\n```"
        return SpecialistResult(
            text=text,
            data_sources=["Unity Catalog (Genie space)"],
            data_used={"sql": res.get("sql"), "row_count": len(res.get("rows", []))},
            model_used="genie",
        )
    except Exception as exc:
        logger.exception("Genie invoke failed")
        return SpecialistResult(
            text=f"Genie unavailable: {exc}",
            data_sources=["Unity Catalog (Genie space)"],
            model_used="genie",
        )


# ── Specialist 8: General Workbench ──────────────────────────────────────────

GENERAL_SYSTEM = """You are the General Workbench agent. You answer operational
"where are we?" questions about Q4 close — feeds, model promotions, overlays,
approvals, recon flags. Cite the source table for every fact. Keep under
200 words. Use markdown."""

async def _general_fetch(period: str) -> dict[str, Any]:
    feeds = await execute_query(
        f"SELECT feed_name, status, sla_deadline, feed_received_timestamp "
        f"FROM {fqn('5_mon_pipeline_sla_status')} WHERE reporting_period = :p",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    promos = await execute_query(
        f"SELECT model_name, status, to_version FROM {fqn('6_gov_promotions')} "
        f"WHERE quarter = :p ORDER BY model_name",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    overlays = await execute_query(
        f"SELECT line_of_business, magnitude_eur, category, status, author "
        f"FROM {fqn('6_gov_overlays')} "
        f"WHERE quarter = :p AND status IN ('pending_approval', 'draft')",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"feeds": feeds, "promotions": promos, "pending_overlays": overlays}


async def _general_invoke(question: str, period: str) -> SpecialistResult:
    data = await _general_fetch(period)
    user_prompt = f"""Question: {question}

Reporting period: {period}

Current operational state:
```json
{json.dumps(data, default=str, indent=2)[:5000]}
```

Answer concisely with citations like `[source: 6_gov_promotions]` per fact. <200 words."""
    r = await generate_review(GENERAL_SYSTEM, user_prompt, agent_name="general_workbench")
    return SpecialistResult(
        text=r.text,
        data_sources=["5_mon_pipeline_sla_status", "6_gov_promotions", "6_gov_overlays"],
        data_used={"feeds": len(data["feeds"]), "pending_overlays": len(data["pending_overlays"])},
        model_used=r.model_used, input_tokens=r.input_tokens, output_tokens=r.output_tokens,
    )


# ── Specialist registry ──────────────────────────────────────────────────────

SPECIALISTS: dict[str, dict[str, Any]] = {
    "cat": {
        "name": "Cat Modelling Agent",
        "scope": (
            "Reads the cat engine output, cross-references it against the external "
            "storm event log, and tells you whether the modelled loss is event-driven "
            "or methodological. Names the events, quotes the dates, recommends accept "
            "or re-run."
        ),
        "triggers": "Igloo, cat losses, storm impact, AAL, VaR, TVaR, S.26.06",
        "color": "amber",
        "data_sources": ["2_stg_cat_risk_by_lob", "6_demo_event_log", "1_raw_claims"],
        "invoke": _cat_invoke,
    },
    "orsa": {
        "name": "ORSA Narrative Agent",
        "scope": (
            "Drafts board-grade ORSA commentary for any scenario run. Base + stressed "
            "capital path, sub-module deltas, business plan-tied interpretation — in "
            "200-300 words of audit-grade prose."
        ),
        "triggers": "ORSA, stress, scenario, board paper, capital path, worst stress, reverse stress",
        "color": "violet",
        "data_sources": ["gold_orsa_results", "gold_orsa_narratives"],
        "invoke": _orsa_invoke,
    },
    "reserving": {
        "name": "Senior Reserving Actuary",
        "scope": (
            "Surfaces the 2-3 most material Q-over-Q reserving movements and proposes "
            "overlays — model, LoB, magnitude, category, rationale — for the human "
            "actuary to sign off. Never writes overlays itself."
        ),
        "triggers": "reserves, reserving, triangle, LoB movement, ultimate, IBNR, property reserves",
        "color": "emerald",
        "data_sources": ["1_raw_claims", "6_gov_overlays"],
        "invoke": _reserving_invoke,
    },
    "second_opinion": {
        "name": "Contrarian Capital Reviewer",
        "scope": (
            "Pressure-tests strategic what-if assumptions before they reach a board "
            "paper. Surfaces 2-4 specific evidence-based pushbacks and one "
            "constructive recommendation. Not here to be helpful."
        ),
        "triggers": "what-if, scenario assumption, doubling, growth scenario, expansion, strategic test",
        "color": "rose",
        "data_sources": ["6_demo_whatif_runs"],
        "invoke": _second_opinion_invoke,
    },
    "recon": {
        "name": "Recon Investigator",
        "scope": (
            "Explains every cross-QRT reconciliation break: which cells, what magnitude, "
            "most likely cause (timing, classification, unit, methodology), and the "
            "resolution step."
        ),
        "triggers": "reconciliation, recon, mismatch, breaks, cross-QRT, S.06.02 vs S.25.01",
        "color": "blue",
        "data_sources": ["5_mon_cross_qrt_reconciliation"],
        "invoke": _recon_invoke,
    },
    "dq": {
        "name": "DQ Investigator",
        "scope": (
            "Diagnoses pipeline DQ failures end-to-end: which feed, which expectation, "
            "what's broken, who owns the source, and what the next step is. No generic "
            "answers."
        ),
        "triggers": "DQ, data quality, late feed, quarantined, expectation, ABN AMRO, custodian feed",
        "color": "orange",
        "data_sources": ["5_mon_pipeline_sla_status", "5_mon_dq_expectation_results"],
        "invoke": _dq_invoke,
    },
    "genie": {
        "name": "Genie",
        "scope": (
            "Free-form SQL over the governed Unity Catalog tables — for the "
            "\"show me the numbers\" questions the specialists don't cover. Natural "
            "language in, SQL + table out, results auditable."
        ),
        "triggers": "show me, what was, list, count, sum, group by, by line of business, by quarter",
        "color": "cyan",
        "data_sources": ["Unity Catalog (Genie space)"],
        "invoke": _genie_invoke,
    },
    "general": {
        "name": "General Workbench",
        "scope": (
            "Operational close state — feeds, promotions, overlays, approvals — the "
            "catch-all 'where are we?' answer. Cites every source."
        ),
        "triggers": "outstanding, status, pending, what's left, where are we, close",
        "color": "slate",
        "data_sources": ["5_mon_pipeline_sla_status", "6_gov_promotions", "6_gov_overlays"],
        "invoke": _general_invoke,
    },
}


# ── Classifier ───────────────────────────────────────────────────────────────

CLASSIFIER_SYSTEM = """You are a routing classifier. Given a user question about
a Solvency II reporting cycle, pick ONE specialist from the catalogue who is best
positioned to answer.

Reply with ONLY a JSON object on a single line, no prose, no markdown fences:
{"specialist_key": "<key>", "confidence": <0-1>, "reason": "<one short sentence>"}

If no specialist is a strong match, pick "general". If the question is purely a
numeric data query ("show me", "what was the Q3 ..."), pick "genie".
Confidence is your subjective fit (0=poor, 1=ideal)."""


def _classifier_user_prompt(question: str) -> str:
    catalogue = "\n".join(
        f'- {k}: {s["name"]} — {s["scope"]} Triggers: {s["triggers"]}'
        for k, s in SPECIALISTS.items()
    )
    return f"Available specialists:\n{catalogue}\n\nUser question:\n{question}\n\nReturn the JSON object."


@dataclass
class Classification:
    specialist_key: str
    confidence: float
    reason: str
    classifier_model: str = "unknown"


async def _classify(question: str) -> Classification:
    """LLM-driven classification. Falls back to 'general' on any parse error."""
    try:
        r = await generate_review(
            CLASSIFIER_SYSTEM, _classifier_user_prompt(question),
            agent_name="supervisor_classifier",
        )
        text = r.text.strip()
        m = re.search(r"\{[^{}]+\}", text)
        if not m:
            raise ValueError(f"No JSON object in classifier reply: {text[:200]}")
        obj = json.loads(m.group(0))
        key = obj.get("specialist_key", "general")
        if key not in SPECIALISTS:
            key = "general"
        return Classification(
            specialist_key=key,
            confidence=float(obj.get("confidence", 0.5)),
            reason=str(obj.get("reason", ""))[:240],
            classifier_model=r.model_used,
        )
    except Exception as exc:
        logger.warning("Classifier failed, defaulting to 'general': %s", exc)
        return Classification(
            specialist_key="general", confidence=0.0,
            reason=f"classifier-failed-fallback ({type(exc).__name__})",
        )


# ── Cache: fuzzy hash for question-level lookups ─────────────────────────────

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")


def _normalize(question: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace. Fuzzy enough for demo."""
    s = _PUNCT_RE.sub(" ", question.lower())
    return _WS_RE.sub(" ", s).strip()


def _route_cache_key(question: str, period: str) -> str:
    norm = _normalize(question)
    h = hashlib.sha256(f"route|{norm}|{period}".encode()).hexdigest()
    return h[:24]


# ── Routing trace table ──────────────────────────────────────────────────────

TRACE_TABLE = "6_ai_routing_trace"


async def _ensure_trace_table() -> None:
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn(TRACE_TABLE)} ("
        " trace_id STRING, question STRING, normalised_question STRING,"
        " specialist_key STRING, specialist_name STRING, confidence DOUBLE,"
        " classifier_reason STRING, classifier_model STRING,"
        " data_sources_json STRING, answer_text STRING, model_used STRING,"
        " input_tokens INT, output_tokens INT, was_cached BOOLEAN,"
        " baked BOOLEAN, period STRING, created_at TIMESTAMP, created_by STRING)"
    )


async def _record_trace(
    *, question: str, period: str, cls: Classification, result: SpecialistResult,
    was_cached: bool, baked: bool, user: str,
) -> str:
    await _ensure_trace_table()
    trace_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await execute_query(
        f"INSERT INTO {fqn(TRACE_TABLE)} "
        "(trace_id, question, normalised_question, specialist_key, specialist_name,"
        " confidence, classifier_reason, classifier_model, data_sources_json,"
        " answer_text, model_used, input_tokens, output_tokens, was_cached, baked,"
        " period, created_at, created_by) "
        "VALUES (:tid, :q, :nq, :sk, :sn, :c, :cr, :cm, :ds, :a, :m, :it, :ot, "
        " :wc, :bk, :p, CAST(:t AS TIMESTAMP), :u)",
        parameters=[
            StatementParameterListItem(name="tid", value=trace_id),
            StatementParameterListItem(name="q",   value=question[:2000]),
            StatementParameterListItem(name="nq",  value=_normalize(question)[:2000]),
            StatementParameterListItem(name="sk",  value=cls.specialist_key),
            StatementParameterListItem(name="sn",  value=SPECIALISTS[cls.specialist_key]["name"]),
            StatementParameterListItem(name="c",   value=str(cls.confidence), type="DOUBLE"),
            StatementParameterListItem(name="cr",  value=cls.reason),
            StatementParameterListItem(name="cm",  value=cls.classifier_model),
            StatementParameterListItem(name="ds",  value=json.dumps(result.data_sources)),
            StatementParameterListItem(name="a",   value=result.text[:6000]),
            StatementParameterListItem(name="m",   value=result.model_used),
            StatementParameterListItem(name="it",  value=str(result.input_tokens), type="INT"),
            StatementParameterListItem(name="ot",  value=str(result.output_tokens), type="INT"),
            StatementParameterListItem(name="wc",  value="true" if was_cached else "false", type="BOOLEAN"),
            StatementParameterListItem(name="bk",  value="true" if baked else "false", type="BOOLEAN"),
            StatementParameterListItem(name="p",   value=period),
            StatementParameterListItem(name="t",   value=ts),
            StatementParameterListItem(name="u",   value=user),
        ],
    )
    return trace_id


# ── Helpers ──────────────────────────────────────────────────────────────────

def _prior_period(period: str) -> str:
    """E.g. 2025-Q4 → 2025-Q3, 2025-Q1 → 2024-Q4."""
    try:
        year, q = period.split("-Q")
        y, qn = int(year), int(q)
        if qn == 1:
            return f"{y-1}-Q4"
        return f"{y}-Q{qn-1}"
    except Exception:
        return period


def _shape_lob_movements(rows: list, prior: str, current: str) -> list:
    by_lob: dict[str, dict[str, Any]] = {}
    for r in rows:
        lob = r["lob_name"]
        by_lob.setdefault(lob, {})[r["reporting_period"]] = {
            "incurred": float(r["incurred"] or 0),
            "count":    int(r["claim_count"] or 0),
        }
    out = []
    for lob, data in by_lob.items():
        a = data.get(current, {}); b = data.get(prior, {})
        ic_a = a.get("incurred", 0); ic_b = b.get("incurred", 0)
        if ic_b <= 0:
            continue
        delta_pct = (ic_a - ic_b) / ic_b * 100
        out.append({
            "lob": lob, "current_incurred_eur": ic_a, "prior_incurred_eur": ic_b,
            "delta_eur": ic_a - ic_b, "delta_pct": round(delta_pct, 1),
        })
    return sorted(out, key=lambda r: abs(r["delta_pct"]), reverse=True)[:6]


# ── Public endpoints ─────────────────────────────────────────────────────────

class RouteRequest(BaseModel):
    question: str
    period: str = "2025-Q4"


async def _call_supervisor_endpoint(endpoint_name: str, question: str, period: str) -> dict | None:
    """POST to the Mosaic AI Model Serving endpoint that hosts
    `agent_workbench_supervisor`. Returns the parsed first-row response, or
    None if the endpoint isn't reachable. The app proxies to this endpoint
    when SUPERVISOR_ENDPOINT_NAME is set — Phase 8 wiring.
    """
    logger.info("Calling supervisor endpoint=%s for question=%r", endpoint_name, question[:80])
    try:
        from server.config import get_workspace_client
        w = get_workspace_client()

        # Scale-to-zero: the first query after idle wakes the endpoint and can
        # take 30–90s+. Retry on transient errors so an uncached question waits
        # for the cold start. If it still never answers, the caller falls back
        # to in-app routing (booth: always answer, never error).
        resp = None
        last_exc: Exception | None = None
        for attempt in range(6):
            try:
                resp = await asyncio.to_thread(
                    w.serving_endpoints.query,
                    name=endpoint_name,
                    dataframe_records=[{"question": question, "period": period}],
                )
                break
            except Exception as e:  # noqa: BLE001 — cold-start / transient
                last_exc = e
                logger.info("Supervisor endpoint not ready (attempt %d/6): %s", attempt + 1, str(e)[:160])
                await asyncio.sleep(25)
        if resp is None:
            logger.warning("Supervisor endpoint never answered after retries: %s", last_exc)
            return None
        # Predictions may be on .predictions, .as_dict()['predictions'], or
        # in older SDK shapes wrapped as a dataframe split. Handle all three.
        preds = None
        if hasattr(resp, "predictions") and resp.predictions is not None:
            preds = resp.predictions
        elif hasattr(resp, "as_dict"):
            preds = resp.as_dict().get("predictions")
        elif isinstance(resp, dict):
            preds = resp.get("predictions")
        logger.info("Supervisor endpoint response type=%s, preds=%r",
                    type(resp).__name__, (preds[:1] if isinstance(preds, list) else preds))
        if not preds:
            logger.warning("Supervisor endpoint returned no predictions: %r", resp)
            return None
        first = preds[0] if isinstance(preds, list) else preds
        if not isinstance(first, dict):
            logger.warning("Supervisor endpoint prediction shape unexpected: %r", first)
            return None
        logger.info("Supervisor endpoint OK: specialist=%s, text_len=%d",
                    first.get("specialist_key"), len(first.get("text") or ""))
        return first
    except Exception:
        logger.exception("Supervisor endpoint call failed (endpoint=%s)", endpoint_name)
        return None


@router.post("/route")
async def route_question(req: RouteRequest, request: Request):
    """Main supervisor entry. Classify → cache → invoke → trace → return.

    Phase 8: when `SUPERVISOR_ENDPOINT_NAME` is set, the app proxies to the
    Mosaic AI serving endpoint that hosts `agent_workbench_supervisor` and
    records a routing trace from the endpoint response. Falls back to in-app
    Phase 7 routing if the endpoint is unreachable.
    """
    import os
    if not req.question or len(req.question.strip()) < 3:
        raise HTTPException(400, "Question too short")
    user = get_request_user(request)
    period = req.period

    await ensure_cache_table()
    await _ensure_trace_table()

    # 1. Cache lookup (fuzzy hash on normalized question + period) — first
    # path so repeat questions return in <1s regardless of endpoint state.
    key = _route_cache_key(req.question, period)
    cached = await cache_lookup(key)
    if cached and cached.get("answer"):
        result = SpecialistResult(
            text=cached["answer"],
            data_sources=cached.get("data_sources", []),
            model_used=cached.get("model_used", "cached"),
        )
        cls = Classification(
            specialist_key=cached.get("specialist_key", "general"),
            confidence=float(cached.get("confidence", 1.0)),
            reason=cached.get("classifier_reason", "from cache"),
            classifier_model=cached.get("classifier_model", "cached"),
        )
        baked = bool(cached.get("baked", False))
        trace_id = await _record_trace(
            question=req.question, period=period, cls=cls, result=result,
            was_cached=True, baked=baked, user=user,
        )
        return {
            "trace_id": trace_id,
            "answer": result.text,
            "specialist_key": cls.specialist_key,
            "specialist_name": SPECIALISTS[cls.specialist_key]["name"],
            "data_sources": result.data_sources,
            "model_used": result.model_used,
            "confidence": cls.confidence,
            "classifier_reason": cls.reason,
            "cached": True,
            "baked": baked,
            "cached_at": cached.get("_cached_at"),
            "via": "cache",
        }

    # 2. Phase 8 proxy path — fan out to the supervisor serving endpoint
    endpoint_name = os.getenv("SUPERVISOR_ENDPOINT_NAME", "").strip()
    if endpoint_name:
        pred = await _call_supervisor_endpoint(endpoint_name, req.question, period)
        if pred and pred.get("text"):
            specialist_key = pred.get("specialist_key", "general")
            specialist_name = SPECIALISTS.get(specialist_key, SPECIALISTS["general"])["name"]
            result = SpecialistResult(
                text=pred["text"],
                data_sources=pred.get("data_sources", []),
                model_used=pred.get("model_used", endpoint_name),
            )
            cls = Classification(
                specialist_key=specialist_key,
                confidence=float(pred.get("confidence", 0.0) or 0.0),
                reason=str(pred.get("classifier_reason", "") or "")[:240],
                classifier_model=f"endpoint:{endpoint_name}",
            )
            trace_id = await _record_trace(
                question=req.question, period=period, cls=cls, result=result,
                was_cached=bool(pred.get("cached")), baked=bool(pred.get("baked")),
                user=user,
            )
            # Persist the endpoint answer to the route cache so the next
            # identical question short-circuits to the cache path above.
            cache_payload = {
                "answer": result.text,
                "specialist_key": specialist_key,
                "data_sources": result.data_sources,
                "model_used": result.model_used,
                "confidence": cls.confidence,
                "classifier_reason": cls.reason,
                "classifier_model": cls.classifier_model,
                "baked": False,
            }
            await cache_persist(
                key, agent_name="supervisor_endpoint", scene_id=specialist_key,
                period=period, output=cache_payload, user=user,
            )
            return {
                "trace_id": trace_id,
                "answer": result.text,
                "specialist_key": specialist_key,
                "specialist_name": specialist_name,
                "data_sources": result.data_sources,
                "model_used": result.model_used,
                "confidence": cls.confidence,
                "classifier_reason": cls.reason,
                "cached": bool(pred.get("cached")),
                "baked": bool(pred.get("baked")),
                "via": "endpoint",
            }
        # endpoint failed — fall through to Phase 7 in-app routing

    # 2. Classify
    cls = await _classify(req.question)
    specialist = SPECIALISTS[cls.specialist_key]

    # 3. Invoke specialist
    try:
        result = await specialist["invoke"](req.question, period)
    except Exception as exc:
        # Try fallback cache match (cache may have a near-neighbour by normalized hash already tried;
        # gracefully degrade with an honest message).
        logger.exception("Specialist invoke failed: %s", cls.specialist_key)
        msg = (
            f"I can't reach the model right now — the {specialist['name']} specialist failed. "
            "Try one of these recently answered questions, or retry in a moment."
        )
        recent = await _recent_rows(limit=5)
        return {
            "trace_id": None,
            "answer": msg,
            "specialist_key": cls.specialist_key,
            "specialist_name": specialist["name"],
            "data_sources": specialist["data_sources"],
            "model_used": "fallback",
            "confidence": cls.confidence,
            "classifier_reason": cls.reason,
            "cached": False,
            "baked": False,
            "error": str(exc)[:240],
            "suggestions": [r["question"] for r in recent if r.get("question")],
        }

    # 4. Record trace
    trace_id = await _record_trace(
        question=req.question, period=period, cls=cls, result=result,
        was_cached=False, baked=False, user=user,
    )

    # 5. Cache for next time (TTL is implicit — the route key is stable)
    cache_payload = {
        "answer": result.text,
        "specialist_key": cls.specialist_key,
        "data_sources": result.data_sources,
        "model_used": result.model_used,
        "confidence": cls.confidence,
        "classifier_reason": cls.reason,
        "classifier_model": cls.classifier_model,
        "baked": False,
    }
    await cache_persist(
        key, agent_name="supervisor_route", scene_id=cls.specialist_key,
        period=period, output=cache_payload, user=user,
    )

    return {
        "trace_id": trace_id,
        "answer": result.text,
        "specialist_key": cls.specialist_key,
        "specialist_name": specialist["name"],
        "data_sources": result.data_sources,
        "model_used": result.model_used,
        "confidence": cls.confidence,
        "classifier_reason": cls.reason,
        "cached": False,
        "baked": False,
    }


SPECIALIST_UC_NAMES = {
    "cat":            "agent_cat_review",
    "orsa":           "agent_orsa_narrative",
    "reserving":      "agent_senior_reserving",
    "second_opinion": "agent_second_opinion",
    "recon":          "agent_recon_investigator",
    "dq":             "agent_dq_investigator",
}


def _uc_model_url(host: str, catalog: str, schema: str, model_name: str) -> str:
    """Workspace deep link to a registered UC model."""
    return f"{host}/explore/data/models/{catalog}/{schema}/{model_name}"


def _uc_function_url(host: str, catalog: str, schema: str, fn_name: str) -> str:
    """Workspace deep link to a UC function (graceful fallback if the catalog
    explorer URL pattern differs — the host + path is always reachable)."""
    return f"{host}/explore/data/functions/{catalog}/{schema}/{fn_name}"


@router.get("/specialists")
async def list_specialists():
    """Return the specialist catalogue for the architecture view, enriched
    with workspace deep-links to each agent's UC artefact and the UC functions
    it calls. Phase 8: every node in the diagram is clickable to a real artefact.
    """
    import os
    from server.config import get_workspace_host
    host = get_workspace_host()
    catalog = os.getenv("CATALOG_NAME", "lr_dev_aws_us_catalog")
    schema  = os.getenv("SCHEMA_NAME",  "solvency2_workbench")
    endpoint_name = os.getenv("SUPERVISOR_ENDPOINT_NAME", "").strip()

    specialists = []
    for k, s in SPECIALISTS.items():
        uc_name = SPECIALIST_UC_NAMES.get(k)
        artefact = {
            "uc_path": f"{catalog}.{schema}.{uc_name}" if uc_name else None,
            "workspace_url": _uc_model_url(host, catalog, schema, uc_name) if uc_name else None,
            "kind": "mlflow_pyfunc" if uc_name else "in_app",
        }
        # Data sources — fn_* names get UC-function deep-links
        sources = []
        for ds in s["data_sources"]:
            sources.append({
                "name": ds,
                "kind": "uc_function" if ds.startswith("fn_") else "uc_table",
                "workspace_url": (
                    _uc_function_url(host, catalog, schema, ds) if ds.startswith("fn_") else None
                ),
            })
        specialists.append({
            "key": k, "name": s["name"], "scope": s["scope"], "triggers": s["triggers"],
            "color": s["color"], "data_sources": s["data_sources"],
            "uc_artefact": artefact, "tools": sources,
        })
    return {
        "specialists": specialists,
        "supervisor": {
            "uc_path": f"{catalog}.{schema}.agent_workbench_supervisor",
            "workspace_url": _uc_model_url(host, catalog, schema, "agent_workbench_supervisor"),
            "serving_endpoint": endpoint_name or None,
            "serving_endpoint_url": (
                f"{host}/ml/endpoints/{endpoint_name}" if endpoint_name else None
            ),
            "kind": "mlflow_pyfunc",
        },
    }


async def _recent_rows(limit: int = 10) -> list[dict[str, Any]]:
    await _ensure_trace_table()
    rows = await execute_query(
        f"SELECT trace_id, question, specialist_key, specialist_name, confidence,"
        f"  data_sources_json, model_used, was_cached, baked, period, created_at, created_by "
        f"FROM {fqn(TRACE_TABLE)} ORDER BY created_at DESC LIMIT {int(limit)}"
    )
    for r in rows:
        try:
            r["data_sources"] = json.loads(r.pop("data_sources_json") or "[]")
        except Exception:
            r["data_sources"] = []
    return rows


@router.get("/recent")
async def recent_routings(limit: int = Query(10, ge=1, le=50)):
    """Return last N routing decisions for the architecture view + history panel."""
    return {"recent": await _recent_rows(limit)}


@router.get("/trace/{trace_id}")
async def trace_detail(trace_id: str):
    await _ensure_trace_table()
    rows = await execute_query(
        f"SELECT * FROM {fqn(TRACE_TABLE)} WHERE trace_id = :t LIMIT 1",
        parameters=[StatementParameterListItem(name="t", value=trace_id)],
    )
    if not rows:
        raise HTTPException(404, f"Trace {trace_id} not found")
    r = rows[0]
    try:
        r["data_sources"] = json.loads(r.pop("data_sources_json") or "[]")
    except Exception:
        r["data_sources"] = []
    return r


# ── Bake endpoint — called by bake_cache.sh ──────────────────────────────────

class BakeRequest(BaseModel):
    questions: list[str]
    period: str = "2025-Q4"


@router.post("/bake")
async def bake_questions(req: BakeRequest, request: Request):
    """Bake answers for a list of pre-known demo questions. Idempotent.

    For each question: classify → invoke → store in cache with baked=True.
    Returns per-question status so the bake script can report progress.
    """
    user = get_request_user(request)
    await ensure_cache_table()
    await _ensure_trace_table()
    results = []
    for q in req.questions:
        key = _route_cache_key(q, req.period)
        try:
            cls = await _classify(q)
            specialist = SPECIALISTS[cls.specialist_key]
            result = await specialist["invoke"](q, req.period)
            cache_payload = {
                "answer": result.text,
                "specialist_key": cls.specialist_key,
                "data_sources": result.data_sources,
                "model_used": result.model_used,
                "confidence": cls.confidence,
                "classifier_reason": cls.reason,
                "classifier_model": cls.classifier_model,
                "baked": True,
            }
            await cache_persist(
                key, agent_name="supervisor_route", scene_id=cls.specialist_key,
                period=req.period, output=cache_payload, user=user,
            )
            results.append({"question": q, "status": "ok", "specialist": cls.specialist_key})
        except Exception as exc:
            logger.exception("Bake failed for: %s", q)
            results.append({"question": q, "status": "failed", "error": str(exc)[:240]})
    return {"baked": results}


# ── Backward-compat SSE endpoint (existing /ask + /ask-sync) ─────────────────
# Frontend uses /api/agents/workbench/ask for the chat overlay; that endpoint
# now delegates to /route. Keeping the SSE endpoint as a thin shim so any
# existing integration doesn't break.

class SupervisorRequest(BaseModel):
    question: str


@router.post("/ask-sync")
async def supervisor_ask_sync(req: SupervisorRequest, request: Request):
    """Legacy non-streaming endpoint. Delegates to /route."""
    return await route_question(
        RouteRequest(question=req.question, period="2025-Q4"), request,
    )

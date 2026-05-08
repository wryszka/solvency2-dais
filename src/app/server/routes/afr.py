"""Actuarial Function Report (Article 48).

Pillar 2 named deliverable. The Solvency II Article 48 AFR has four
standard sections — this module drafts each of them via the FM API,
grounded in the actual SCR / model-version / DQ / ORSA data, and
persists every draft version to gold_afr_drafts.

Workflow:
  1. /api/afr/draft → AI generates a draft for one section, stores a new version
  2. Human reviews / edits in the UI → /api/afr/save updates the draft text
  3. /api/afr/approve marks the draft approved (records actor + timestamp)
  4. /api/afr/pdf renders the approved draft to PDF with sha256 hash

The four sections come from Article 48 §1:
  - tps_adequacy:        coordination of TPs calculation, methods + assumptions
  - uw_policy_adequacy:  opinion on the overall underwriting policy
  - ri_adequacy:         opinion on the adequacy of reinsurance arrangements
  - internal_model:      contribution to the effective implementation of risk-management
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server.ai import generate_review
from server.cache import (
    cache_lookup, cache_persist, cache_miss_503, make_cache_key, should_use_cache,
)
from server.config import fqn, get_request_user
from server.sql import execute_query, execute_query_cached

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/afr", tags=["afr"])


SECTION_IDS = ["tps_adequacy", "uw_policy_adequacy", "ri_adequacy", "internal_model"]
SECTION_TITLES: dict[str, str] = {
    "tps_adequacy":       "Adequacy of Technical Provisions",
    "uw_policy_adequacy": "Opinion on the Underwriting Policy",
    "ri_adequacy":        "Opinion on the Adequacy of Reinsurance Arrangements",
    "internal_model":     "Contribution to Risk-Management Implementation",
}

# Section-specific prompts. Each gets the SAME data block (so all four are
# grounded in the same evidence) but a different framing instruction.
AFR_SYSTEM = """[Pillar context — Pillar 2 Governance]
The AFR is a Pillar 2 deliverable under Article 48. Your sections draw evidence from
Pillar 1 (SCR breakdown, model versions, life and non-life UW risk) and feed Pillar 3
(SFCR Section B governance, Section D valuation). Where a finding affects another
pillar's deliverable, say so.

You are the Appointed Actuary of Bricksurance SE, drafting the Actuarial
Function Report under Article 48 of the Solvency II Directive. Tone: precise, conservative,
technical, factual. Reference the actual numbers in the data block. Use plain prose
(no bullet headers within a section). Length: 250–400 words for this section. Do NOT
recommend or claim approval; you are advising the Board, not signing the QRTs."""

SECTION_PROMPTS: dict[str, str] = {
    "tps_adequacy": (
        "Draft Section 1: 'Adequacy of Technical Provisions'.\n\n"
        "Cover: the methodology used to calculate technical provisions, whether the assumptions are\n"
        "sufficient and reasonable in light of recent claims experience, IBNR adequacy, and any\n"
        "concerns about specific lines of business. Draw on the SCR breakdown, the life and non-life\n"
        "BEL totals, the data quality outcomes, and the property reserve uplift."
    ),
    "uw_policy_adequacy": (
        "Draft Section 2: 'Opinion on the Underwriting Policy'.\n\n"
        "Cover: whether the underwriting policy is adequate to the company's risk profile, premium\n"
        "adequacy in the current pricing environment, observed combined ratios, and whether the\n"
        "underwriting strategy and the SCR sub-modules are aligned."
    ),
    "ri_adequacy": (
        "Draft Section 3: 'Opinion on the Adequacy of Reinsurance Arrangements'.\n\n"
        "Cover: whether the reinsurance programme is adequate for the risks underwritten, recent\n"
        "cession behaviour, and any data-quality concerns from the reinsurance feed."
    ),
    "internal_model": (
        "Draft Section 4: 'Contribution to the Effective Implementation of Risk Management'.\n\n"
        "Cover: how the actuarial function contributes to risk management, the role of the standard\n"
        "formula model (Champion vs Challenger), the ORSA process if performed this period, and the\n"
        "controls operated over model runs and approvals."
    ),
}


# ── Bootstrap ───────────────────────────────────────────────────────────────

async def _ensure_afr_tables() -> None:
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn('gold_afr_drafts')} ("
        " draft_id STRING, reporting_period STRING, section_id STRING,"
        " version INT, content STRING, status STRING,"
        " ai_prompt STRING, ai_model STRING, ai_input_tokens INT, ai_output_tokens INT,"
        " content_hash STRING,"
        " created_at TIMESTAMP, created_by STRING,"
        " updated_at TIMESTAMP, updated_by STRING,"
        " approved_at TIMESTAMP, approved_by STRING)"
    )


def _hash_content(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── Data gathering ──────────────────────────────────────────────────────────

async def _gather_data(period: str | None) -> tuple[str, dict[str, Any]]:
    """Collect the structured input block fed to every AFR section prompt."""
    if not period:
        rows = await execute_query(
            f"SELECT MAX(reporting_period) AS rp FROM {fqn('3_qrt_s2501_summary')}"
        )
        period = rows[0]["rp"] if rows else None
    if not period:
        raise HTTPException(400, "Cannot determine reporting period — gold tables empty")

    p = [StatementParameterListItem(name="period", value=period)]

    scr_q = f"""
        SELECT component, CAST(amount_eur AS DOUBLE) AS amount_eur
        FROM {fqn('2_stg_scr_results')}
        WHERE reporting_period = :period
          AND component IN ('SCR_market','SCR_default','SCR_non_life','SCR_health','SCR_life',
                            'BSCR','Op_risk','LAC_DT','SCR')
    """
    s2501_q = f"""
        SELECT * FROM {fqn('3_qrt_s2501_summary')} WHERE reporting_period = :period
    """
    s0501_q = f"""
        SELECT * FROM {fqn('3_qrt_s0501_summary')} WHERE reporting_period = :period
    """
    s1201_q = f"""
        SELECT * FROM {fqn('3_qrt_s1201_summary')} WHERE reporting_period = :period
    """
    s2606_q = f"""
        SELECT * FROM {fqn('3_qrt_s2606_summary')} WHERE reporting_period = :period
    """
    lifeuw_q = f"""
        SELECT * FROM {fqn('3_qrt_life_uw_risk_summary')} WHERE reporting_period = :period
    """
    dq_q = f"""
        SELECT pipeline_name,
               SUM(passing_records) AS passing,
               SUM(failing_records) AS failing,
               COUNT(CASE WHEN failing_records > 0 THEN 1 END) AS failing_checks
        FROM {fqn('5_mon_dq_expectation_results')}
        WHERE reporting_period = :period
        GROUP BY pipeline_name
    """
    models_q = f"""
        SELECT model_name, model_version, calibration_year, status
        FROM {fqn('5_mon_model_registry_log')}
        WHERE reporting_period = :period
        ORDER BY model_version DESC
    """
    orsa_q = f"""
        SELECT scenario_name, year_offset, projection_year, scr_eur, eligible_own_funds_eur,
               solvency_ratio_pct, is_base
        FROM {fqn('gold_orsa_results')}
        WHERE base_period = :period
        ORDER BY run_timestamp DESC, year_offset, is_base DESC
        LIMIT 80
    """

    scr, s2501, s0501, s1201, s2606, lifeuw, dq, models, orsa = await asyncio.gather(
        execute_query(scr_q, parameters=p),
        execute_query(s2501_q, parameters=p),
        execute_query(s0501_q, parameters=p),
        execute_query(s1201_q, parameters=p),
        execute_query(s2606_q, parameters=p),
        execute_query(lifeuw_q, parameters=p),
        execute_query(dq_q, parameters=p),
        execute_query(models_q, parameters=p),
        execute_query(orsa_q, parameters=p),
        return_exceptions=True,
    )

    def _ok(x):
        return [] if isinstance(x, Exception) else (x or [])

    return period, {
        "scr_breakdown":      _ok(scr),
        "s2501_summary":      _ok(s2501)[0] if _ok(s2501) else {},
        "s0501_summary":      _ok(s0501)[0] if _ok(s0501) else {},
        "s1201_summary":      _ok(s1201)[0] if _ok(s1201) else {},
        "s2606_summary":      _ok(s2606)[0] if _ok(s2606) else {},
        "life_uw_summary":    _ok(lifeuw)[0] if _ok(lifeuw) else {},
        "dq_pipelines":       _ok(dq),
        "model_versions":     _ok(models),
        "orsa_results":       _ok(orsa),
    }


def _format_data_block(period: str, data: dict[str, Any]) -> str:
    """Render the structured data block as readable prose for the prompt."""
    parts = [f"# Reporting period: {period}\n"]

    if data["s2501_summary"]:
        s = data["s2501_summary"]
        parts.append(f"## Solvency position\n"
                     f"- SCR: EUR {s.get('scr_eur', '—'):,}\n"
                     f"- Eligible own funds: EUR {s.get('eligible_own_funds_eur', '—'):,}\n"
                     f"- Solvency ratio: {s.get('solvency_ratio_pct', '—')}%")

    if data["scr_breakdown"]:
        parts.append("## SCR breakdown")
        for row in data["scr_breakdown"]:
            parts.append(f"- {row['component']}: EUR {row['amount_eur']:,.0f}")

    if data["s0501_summary"]:
        s = data["s0501_summary"]
        parts.append(f"## P&C P&L (S.05.01)\n{json.dumps(s, default=str, indent=2)}")
    if data["s2606_summary"]:
        s = data["s2606_summary"]
        parts.append(f"## Non-life UW risk (S.26.06)\n{json.dumps(s, default=str, indent=2)}")
    if data["s1201_summary"]:
        s = data["s1201_summary"]
        parts.append(f"## Life technical provisions (S.12.01)\n{json.dumps(s, default=str, indent=2)}")
    if data["life_uw_summary"]:
        s = data["life_uw_summary"]
        parts.append(f"## Life UW risk\n{json.dumps(s, default=str, indent=2)}")

    if data["dq_pipelines"]:
        parts.append("## Data-quality pipelines")
        for r in data["dq_pipelines"]:
            parts.append(
                f"- {r['pipeline_name']}: {r.get('passing', 0)} pass / {r.get('failing', 0)} fail · "
                f"{r.get('failing_checks', 0)} failing checks"
            )

    if data["model_versions"]:
        parts.append("## Model versions in scope")
        for r in data["model_versions"]:
            parts.append(f"- {r.get('model_name')} v{r.get('model_version')} ({r.get('calibration_year')}) — {r.get('status')}")

    if data["orsa_results"]:
        parts.append("## Recent ORSA results (sample)")
        for r in data["orsa_results"][:12]:
            flag = "base" if r.get("is_base") else "scenario"
            parts.append(
                f"- {r.get('scenario_name')} year+{r.get('year_offset')} {flag}: "
                f"SCR EUR {r.get('scr_eur'):,.0f}, ratio {r.get('solvency_ratio_pct')}%"
            )

    return "\n\n".join(parts)


# ── Routes ──────────────────────────────────────────────────────────────────

class DraftRequest(BaseModel):
    section_id: str
    reporting_period: str | None = None


class SaveRequest(BaseModel):
    draft_id: str
    content: str


class ApproveRequest(BaseModel):
    draft_id: str


@router.get("/sections")
async def list_sections():
    return {"sections": [{"id": k, "title": SECTION_TITLES[k]} for k in SECTION_IDS]}


@router.get("/drafts")
async def list_drafts(reporting_period: str | None = None):
    """List all drafts for a period — latest version per section first."""
    await _ensure_afr_tables()
    if reporting_period:
        rows = await execute_query(
            f"SELECT draft_id, reporting_period, section_id, version, status, "
            f"       content_hash, ai_model, created_at, updated_at, approved_at, approved_by "
            f"FROM {fqn('gold_afr_drafts')} "
            f"WHERE reporting_period = :rp ORDER BY section_id, version DESC",
            parameters=[StatementParameterListItem(name="rp", value=reporting_period)],
        )
    else:
        rows = await execute_query(
            f"SELECT draft_id, reporting_period, section_id, version, status, "
            f"       content_hash, ai_model, created_at, updated_at, approved_at, approved_by "
            f"FROM {fqn('gold_afr_drafts')} ORDER BY reporting_period DESC, section_id, version DESC LIMIT 200"
        )
    return {"drafts": rows}


@router.get("/draft/{draft_id}")
async def get_draft(draft_id: str):
    await _ensure_afr_tables()
    rows = await execute_query(
        f"SELECT * FROM {fqn('gold_afr_drafts')} WHERE draft_id = :id",
        parameters=[StatementParameterListItem(name="id", value=draft_id)],
    )
    if not rows:
        raise HTTPException(404, "Draft not found")
    return {"draft": rows[0]}


@router.post("/draft")
async def create_draft(req: DraftRequest, request: Request):
    """Generate a new AI draft for one section. Always creates a new version."""
    if req.section_id not in SECTION_IDS:
        raise HTTPException(400, f"Unknown section: {req.section_id}")
    await _ensure_afr_tables()
    user = get_request_user(request)

    period, data = await _gather_data(req.reporting_period)

    # Demo cache: keyed by (section_id, period). Same section across runs = same cache.
    cache_key = make_cache_key("afr_draft", req.section_id, period)
    if should_use_cache(request):
        cached = await cache_lookup(cache_key)
        if cached:
            return cached
        if request.query_params.get("cached") in ("1", "true", "yes", "on"):
            raise cache_miss_503()

    data_block = _format_data_block(period, data)
    user_prompt = f"## Data block\n\n{data_block}\n\n## Section to draft\n\n{SECTION_PROMPTS[req.section_id]}"

    result = await generate_review(AFR_SYSTEM, user_prompt, agent_name=f"afr_{req.section_id}")

    # Version number = (existing for this section, this period) + 1
    v_rows = await execute_query(
        f"SELECT COUNT(*) AS n FROM {fqn('gold_afr_drafts')} "
        f"WHERE reporting_period = :rp AND section_id = :sid",
        parameters=[
            StatementParameterListItem(name="rp", value=period),
            StatementParameterListItem(name="sid", value=req.section_id),
        ],
    )
    version = int((v_rows[0] or {}).get("n", 0) or 0) + 1
    draft_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    h = _hash_content(result.text)

    await execute_query(
        f"INSERT INTO {fqn('gold_afr_drafts')} "
        "(draft_id, reporting_period, section_id, version, content, status, "
        " ai_prompt, ai_model, ai_input_tokens, ai_output_tokens, content_hash, "
        " created_at, created_by, updated_at, updated_by, approved_at, approved_by) "
        "VALUES (:id, :rp, :sid, :ver, :content, 'draft', "
        "        :prompt, :model, :inp, :out, :hash, "
        "        CAST(:now AS TIMESTAMP), :user, CAST(:now AS TIMESTAMP), :user, NULL, NULL)",
        parameters=[
            StatementParameterListItem(name="id",      value=draft_id),
            StatementParameterListItem(name="rp",      value=period),
            StatementParameterListItem(name="sid",     value=req.section_id),
            StatementParameterListItem(name="ver",     value=str(version), type="INT"),
            StatementParameterListItem(name="content", value=result.text),
            StatementParameterListItem(name="prompt",  value=user_prompt),
            StatementParameterListItem(name="model",   value=result.model_used),
            StatementParameterListItem(name="inp",     value=str(result.input_tokens), type="INT"),
            StatementParameterListItem(name="out",     value=str(result.output_tokens), type="INT"),
            StatementParameterListItem(name="hash",    value=h),
            StatementParameterListItem(name="now",     value=now),
            StatementParameterListItem(name="user",    value=user),
        ],
    )

    response = {
        "draft_id": draft_id,
        "section_id": req.section_id,
        "section_title": SECTION_TITLES[req.section_id],
        "reporting_period": period,
        "version": version,
        "content": result.text,
        "content_hash": h,
        "ai_model": result.model_used,
        "ai_input_tokens": result.input_tokens,
        "ai_output_tokens": result.output_tokens,
        "status": "draft",
    }
    await cache_persist(cache_key, "afr_draft", req.section_id, period, response, user=user)
    return response


@router.post("/save")
async def save_draft(req: SaveRequest, request: Request):
    """Update an existing draft's content (human edits)."""
    await _ensure_afr_tables()
    user = get_request_user(request)
    h = _hash_content(req.content)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await execute_query(
        f"UPDATE {fqn('gold_afr_drafts')} SET content = :content, content_hash = :hash, "
        f"       updated_at = CAST(:now AS TIMESTAMP), updated_by = :user "
        f"WHERE draft_id = :id",
        parameters=[
            StatementParameterListItem(name="content", value=req.content),
            StatementParameterListItem(name="hash",    value=h),
            StatementParameterListItem(name="now",     value=now),
            StatementParameterListItem(name="user",    value=user),
            StatementParameterListItem(name="id",      value=req.draft_id),
        ],
    )
    return {"draft_id": req.draft_id, "content_hash": h, "updated_at": now, "updated_by": user}


@router.post("/approve")
async def approve_draft(req: ApproveRequest, request: Request):
    await _ensure_afr_tables()
    user = get_request_user(request)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await execute_query(
        f"UPDATE {fqn('gold_afr_drafts')} SET status = 'approved', "
        f"       approved_at = CAST(:now AS TIMESTAMP), approved_by = :user "
        f"WHERE draft_id = :id",
        parameters=[
            StatementParameterListItem(name="now",  value=now),
            StatementParameterListItem(name="user", value=user),
            StatementParameterListItem(name="id",   value=req.draft_id),
        ],
    )
    return {"draft_id": req.draft_id, "status": "approved", "approved_at": now, "approved_by": user}


@router.get("/pdf/{reporting_period}")
async def afr_pdf(reporting_period: str):
    """Render the latest version of every section into a single PDF.

    The PDF carries the document SHA-256 hash + section-level hashes in the
    footer so an auditor can verify integrity.
    """
    await _ensure_afr_tables()
    rows = await execute_query(
        f"SELECT section_id, version, content, content_hash, status, approved_by, approved_at "
        f"FROM {fqn('gold_afr_drafts')} d "
        f"WHERE reporting_period = :rp "
        f"  AND version = (SELECT MAX(version) FROM {fqn('gold_afr_drafts')} d2 "
        f"                 WHERE d2.reporting_period = d.reporting_period AND d2.section_id = d.section_id) "
        f"ORDER BY CASE section_id "
        f"  WHEN 'tps_adequacy'       THEN 1 "
        f"  WHEN 'uw_policy_adequacy' THEN 2 "
        f"  WHEN 'ri_adequacy'        THEN 3 "
        f"  WHEN 'internal_model'     THEN 4 "
        f"  ELSE 99 END",
        parameters=[StatementParameterListItem(name="rp", value=reporting_period)],
    )
    if not rows:
        raise HTTPException(404, f"No drafts for period {reporting_period}")

    try:
        from fpdf import FPDF
    except Exception as exc:
        raise HTTPException(500, "PDF library not available") from exc

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Actuarial Function Report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Article 48, Solvency II Directive | Bricksurance SE | {reporting_period}",
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    section_hashes: list[str] = []
    for r in rows:
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 7, SECTION_TITLES.get(r["section_id"], r["section_id"]),
                 new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "I", 9)
        status_line = f"v{r['version']} · {r['status']}"
        if r.get("approved_by"):
            status_line += f" · approved by {r['approved_by']} {r.get('approved_at', '')}"
        pdf.cell(0, 5, status_line, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        for line in (r["content"] or "").split("\n"):
            pdf.multi_cell(0, 5, line.replace("—", "-").replace("→", "->"))
        pdf.ln(3)
        section_hashes.append(f"{r['section_id']}={r['content_hash'][:12]}")

    # Document hash = sha256 of concatenated section hashes
    doc_hash = hashlib.sha256("|".join(section_hashes).encode("utf-8")).hexdigest()
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(0, 4, f"Document hash (sha256, derived from sections): {doc_hash[:32]}...",
             new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4, "Section hashes: " + ", ".join(section_hashes),
             new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4, f"Generated: {datetime.now(timezone.utc).isoformat()}",
             new_x="LMARGIN", new_y="NEXT")

    pdf_bytes = bytes(pdf.output())
    filename = f"AFR_{reporting_period}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Document-Hash": doc_hash,
        },
    )

"""SFCR — Solvency and Financial Condition Report.

Pillar 3 public disclosure. The standard SFCR has five sections; each is
section-by-section drafted by AI with paragraph-level citations to the
underlying gold tables. Auditors can trace every quantitative claim back
to a specific cell in a specific table.

Storage:
- gold_sfcr_drafts: per-section draft with versioning, status, hash
- content stored as JSON: { "paragraphs": [{ "text": "...", "citations": [{"table":"...","cell":"..."}] }] }

The same engine powers RSR — see rsr.py for the supervisor-only section list.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
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
from server.sql import execute_query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sfcr", tags=["sfcr"])


# ── SFCR sections (Articles 290 - 297, Solvency II Delegated Acts) ─────────
# RSR sections that overlap with SFCR are also flagged here; RSR-only flags
# live in rsr.py.

SFCR_SECTIONS: list[dict[str, Any]] = [
    {"id": "business_performance",
     "title": "A. Business and Performance",
     "summary": "A.1 Business · A.2 Performance from underwriting · A.3 Performance from investments · A.4 Any other information."},
    {"id": "system_of_governance",
     "title": "B. System of Governance",
     "summary": "B.1 General governance · B.2 Fit + proper · B.3 Risk management + ORSA · B.4 Internal control · B.5 Internal audit · B.6 Actuarial function · B.7 Outsourcing."},
    {"id": "risk_profile",
     "title": "C. Risk Profile",
     "summary": "C.1 Underwriting risk · C.2 Market risk · C.3 Credit risk · C.4 Liquidity risk · C.5 Operational risk · C.6 Other material risks (climate, conduct, ICT)."},
    {"id": "valuation_solvency",
     "title": "D. Valuation for Solvency Purposes",
     "summary": "D.1 Assets · D.2 Technical provisions · D.3 Other liabilities · D.4 Alternative valuation methods. LTG measures (Art. 77b/77d) disclosed in D.2."},
    {"id": "capital_management",
     "title": "E. Capital Management",
     "summary": "E.1 Own funds · E.2 SCR + MCR · E.3 Duration-based equity risk sub-module (where used) · E.4 Internal model differences (if used). Article 138 status disclosed in E.2."},
]
SFCR_SECTION_IDS = {s["id"] for s in SFCR_SECTIONS}

# RSR is the supervisor-only twin. We share the same engine and add two
# supervisor-only sections defined in rsr.py.

# Citation schema. The model emits inline tokens of the form
#   {{cite:3_qrt_s2501_summary,R0100}}
# The server parses these into a structured paragraphs[] payload with
# citations[] alongside the visible text. The frontend renders citation
# chips inline (TipTap node) and lets users click through to source.
CITE_RE = re.compile(r"\{\{cite:([A-Za-z0-9_]+),([A-Za-z0-9._-]+)\}\}")


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fmt_eur(v: Any) -> str:
    f = _safe_float(v)
    return f"EUR {f:,.0f}" if f is not None else "—"


def _parse_paragraphs(raw: str) -> list[dict[str, Any]]:
    """Convert markdown-ish text with {{cite:...}} tokens into structured paragraphs."""
    paragraphs: list[dict[str, Any]] = []
    for block in [b.strip() for b in raw.split("\n\n") if b.strip()]:
        cites = []
        def _collect(m: re.Match) -> str:
            cites.append({"table": m.group(1), "cell": m.group(2)})
            return f"[{m.group(1)} {m.group(2)}]"
        text = CITE_RE.sub(_collect, block)
        paragraphs.append({"text": text, "citations": cites})
    return paragraphs


def _serialise_paragraphs(paragraphs: list[dict[str, Any]]) -> str:
    """Serialise back to a human-readable string (each paragraph + its citations as a footer)."""
    out_blocks = []
    for p in paragraphs:
        block = p.get("text", "")
        cites = p.get("citations", [])
        if cites:
            tags = " ".join(f"[{c.get('table')} {c.get('cell')}]" for c in cites)
            block = block + "\n  " + tags
        out_blocks.append(block)
    return "\n\n".join(out_blocks)


# ── Bootstrap ───────────────────────────────────────────────────────────────

async def _ensure_sfcr_tables() -> None:
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn('gold_sfcr_drafts')} ("
        " draft_id STRING, doc_kind STRING, reporting_period STRING, section_id STRING,"
        " version INT, content_json STRING, status STRING,"
        " ai_prompt STRING, ai_model STRING, ai_input_tokens INT, ai_output_tokens INT,"
        " content_hash STRING,"
        " created_at TIMESTAMP, created_by STRING,"
        " updated_at TIMESTAMP, updated_by STRING,"
        " approved_at TIMESTAMP, approved_by STRING)"
    )


def _hash_content(content_json: str) -> str:
    return hashlib.sha256(content_json.encode("utf-8")).hexdigest()


# ── Data block (richer than AFR's because SFCR cites everything) ────────────

async def _gather_sfcr_data(period: str) -> dict[str, Any]:
    """Read the per-section data block — every cell that might be cited."""
    p = [StatementParameterListItem(name="period", value=period)]
    queries = {
        "s2501":   f"SELECT * FROM {fqn('3_qrt_s2501_summary')} WHERE reporting_period = :period",
        "s0501":   f"SELECT * FROM {fqn('3_qrt_s0501_summary')} WHERE reporting_period = :period",
        "s1201":   f"SELECT * FROM {fqn('3_qrt_s1201_summary')} WHERE reporting_period = :period",
        "s2606":   f"SELECT * FROM {fqn('3_qrt_s2606_summary')} WHERE reporting_period = :period",
        "lifeuw":  f"SELECT * FROM {fqn('3_qrt_life_uw_risk_summary')} WHERE reporting_period = :period",
        "s2501_breakdown":
            f"SELECT template_row_id, template_row_label, CAST(amount_eur AS DOUBLE) AS amount_eur "
            f"FROM {fqn('3_qrt_s2501_scr_breakdown')} WHERE reporting_period = :period ORDER BY template_row_id",
        "s2606_breakdown":
            f"SELECT template_row_id, template_row_label, CAST(amount_eur AS DOUBLE) AS amount_eur "
            f"FROM {fqn('3_qrt_s2606_nl_uw_risk')} WHERE reporting_period = :period ORDER BY template_row_id",
        "lifeuw_breakdown":
            f"SELECT template_row_id, template_row_label, CAST(amount_eur AS DOUBLE) AS amount_eur "
            f"FROM {fqn('3_qrt_life_uw_risk')} WHERE reporting_period = :period ORDER BY template_row_id",
    }
    keys = list(queries.keys())
    rows = await asyncio.gather(
        *[execute_query(q, parameters=p) for q in queries.values()],
        return_exceptions=True,
    )
    out: dict[str, Any] = {}
    for k, r in zip(keys, rows):
        out[k] = ([] if isinstance(r, Exception) else (r or []))
    return out


def _format_sfcr_data_block(period: str, data: dict[str, Any]) -> str:
    parts = [f"# Reporting period: {period}\n"]
    parts.append("Quantitative claims must cite gold tables using {{cite:TABLE,CELL}} where TABLE is one of\n"
                 "the following and CELL is a row id (e.g. R0100) or a metric name from the summary tables.")

    if data.get("s2501"):
        s = data["s2501"][0]
        parts.append(f"\n## 3_qrt_s2501_summary  (Solvency position)\n{json.dumps(s, default=str, indent=2)}")
    if data.get("s2501_breakdown"):
        parts.append("\n## 3_qrt_s2501_scr_breakdown  (SCR template)")
        for r in data["s2501_breakdown"][:30]:
            parts.append(f"  {r['template_row_id']}  {r['template_row_label']}  {_fmt_eur(r.get('amount_eur'))}")
    if data.get("s0501"):
        parts.append(f"\n## 3_qrt_s0501_summary  (Non-life P&L)\n{json.dumps(data['s0501'][0], default=str, indent=2)}")
    if data.get("s2606"):
        parts.append(f"\n## 3_qrt_s2606_summary  (Non-life UW risk)\n{json.dumps(data['s2606'][0], default=str, indent=2)}")
    if data.get("s2606_breakdown"):
        parts.append("\n## 3_qrt_s2606_nl_uw_risk  (NL UW template)")
        for r in data["s2606_breakdown"][:20]:
            parts.append(f"  {r['template_row_id']}  {r['template_row_label']}  {_fmt_eur(r.get('amount_eur'))}")
    if data.get("s1201"):
        parts.append(f"\n## 3_qrt_s1201_summary  (Life TPs)\n{json.dumps(data['s1201'][0], default=str, indent=2)}")
    if data.get("lifeuw"):
        parts.append(f"\n## 3_qrt_life_uw_risk_summary  (Life UW)\n{json.dumps(data['lifeuw'][0], default=str, indent=2)}")
    if data.get("lifeuw_breakdown"):
        parts.append("\n## 3_qrt_life_uw_risk  (Life UW template)")
        for r in data["lifeuw_breakdown"][:20]:
            parts.append(f"  {r['template_row_id']}  {r['template_row_label']}  {_fmt_eur(r.get('amount_eur'))}")
    return "\n".join(parts)


# ── Prompts ─────────────────────────────────────────────────────────────────

SFCR_SYSTEM = """[Pillar context — Pillar 3 Disclosure]
The SFCR is the public Pillar 3 deliverable. You draw evidence from Pillar 1 (Capital —
SCR breakdown, asset register, life TPs) and Pillar 2 (Governance — ORSA, AFR, model
governance). Each section header should remind the reader which pillar's evidence sits
behind it.

You are drafting a Solvency and Financial Condition Report (SFCR) under
Article 51 of the Solvency II Directive for Bricksurance SE, a mid-size European composite
insurer (P&C + Life on one balance sheet). Tone: clear, neutral, public-facing. Length:
3–6 short paragraphs per section.

CITATION RULE — every quantitative claim must include an inline citation token of the form
{{cite:TABLE,CELL}} where TABLE is one of the gold tables in the data block and CELL is the
row id (e.g. R0100) or metric name. The frontend renders these as auditor-traceable chips.
Do NOT fabricate cell references; only cite tokens that appear in the data block."""

SECTION_PROMPTS: dict[str, str] = {
    "business_performance": (
        "Draft Section A — 'Business and Performance'. Cover entity scope, P&C vs life mix, "
        "underwriting performance with combined-ratio commentary, and investment performance."
    ),
    "system_of_governance": (
        "Draft Section B — 'System of Governance'. Cover governance structure, fit and proper, "
        "risk management framework, internal controls (point at the AI guardrails), internal audit, "
        "actuarial function, and outsourcing arrangements."
    ),
    "risk_profile": (
        "Draft Section C — 'Risk Profile'. Cover the major risk categories (UW, market, credit, "
        "liquidity, operational) referencing the SCR sub-modules. Cite specific module charges."
    ),
    "valuation_solvency": (
        "Draft Section D — 'Valuation for Solvency Purposes'. Cover assets, technical provisions, "
        "and other liabilities — valuation methods used and key differences vs the financial statements."
    ),
    "capital_management": (
        "Draft Section E — 'Capital Management'. Cover own funds composition, SCR and MCR, "
        "the standard formula (no internal model in scope), and any non-compliance with citations."
    ),
}


# ── Public API ──────────────────────────────────────────────────────────────

class DraftRequest(BaseModel):
    section_id: str
    reporting_period: str | None = None


class SaveRequest(BaseModel):
    draft_id: str
    paragraphs: list[dict[str, Any]]  # [{ "text": str, "citations": [{table, cell}] }]


class ApproveRequest(BaseModel):
    draft_id: str


def _resolve_section(section_id: str) -> dict[str, Any]:
    for s in SFCR_SECTIONS:
        if s["id"] == section_id:
            return s
    raise HTTPException(400, f"Unknown SFCR section: {section_id}")


@router.get("/sections")
async def list_sections():
    return {"sections": SFCR_SECTIONS}


@router.get("/drafts")
async def list_drafts(reporting_period: str | None = None):
    await _ensure_sfcr_tables()
    if reporting_period:
        rows = await execute_query(
            f"SELECT draft_id, reporting_period, section_id, version, status, "
            f"       content_hash, ai_model, created_at, updated_at, approved_at, approved_by "
            f"FROM {fqn('gold_sfcr_drafts')} "
            f"WHERE doc_kind = 'sfcr' AND reporting_period = :rp "
            f"ORDER BY section_id, version DESC",
            parameters=[StatementParameterListItem(name="rp", value=reporting_period)],
        )
    else:
        rows = await execute_query(
            f"SELECT draft_id, reporting_period, section_id, version, status, "
            f"       content_hash, ai_model, created_at, updated_at, approved_at, approved_by "
            f"FROM {fqn('gold_sfcr_drafts')} WHERE doc_kind = 'sfcr' "
            f"ORDER BY reporting_period DESC, section_id, version DESC LIMIT 200"
        )
    return {"drafts": rows}


@router.get("/draft/{draft_id}")
async def get_draft(draft_id: str):
    await _ensure_sfcr_tables()
    rows = await execute_query(
        f"SELECT * FROM {fqn('gold_sfcr_drafts')} WHERE draft_id = :id",
        parameters=[StatementParameterListItem(name="id", value=draft_id)],
    )
    if not rows:
        raise HTTPException(404, "Draft not found")
    return {"draft": rows[0]}


@router.post("/draft")
async def create_draft(req: DraftRequest, request: Request):
    section = _resolve_section(req.section_id)
    await _ensure_sfcr_tables()
    user = get_request_user(request)

    period = req.reporting_period
    if not period:
        rows = await execute_query(
            f"SELECT MAX(reporting_period) AS rp FROM {fqn('3_qrt_s2501_summary')}"
        )
        period = rows[0]["rp"] if rows else None
    if not period:
        raise HTTPException(400, "Cannot determine reporting period")

    cache_key = make_cache_key("sfcr_draft", req.section_id, period)
    if should_use_cache(request):
        cached = await cache_lookup(cache_key)
        if cached:
            return cached
        if request.query_params.get("cached") in ("1", "true", "yes", "on"):
            raise cache_miss_503()

    data = await _gather_sfcr_data(period)
    data_block = _format_sfcr_data_block(period, data)
    user_prompt = (
        f"## Data block\n\n{data_block}\n\n"
        f"## Section to draft\n\nSection title: {section['title']}\n\n"
        f"{SECTION_PROMPTS[req.section_id]}"
    )

    result = await generate_review(SFCR_SYSTEM, user_prompt, agent_name=f"sfcr_{req.section_id}")

    paragraphs = _parse_paragraphs(result.text)
    content_json = json.dumps({"paragraphs": paragraphs})
    h = _hash_content(content_json)

    v_rows = await execute_query(
        f"SELECT COUNT(*) AS n FROM {fqn('gold_sfcr_drafts')} "
        f"WHERE doc_kind = 'sfcr' AND reporting_period = :rp AND section_id = :sid",
        parameters=[
            StatementParameterListItem(name="rp", value=period),
            StatementParameterListItem(name="sid", value=req.section_id),
        ],
    )
    version = int((v_rows[0] or {}).get("n", 0) or 0) + 1
    draft_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    await execute_query(
        f"INSERT INTO {fqn('gold_sfcr_drafts')} "
        "(draft_id, doc_kind, reporting_period, section_id, version, content_json, status, "
        " ai_prompt, ai_model, ai_input_tokens, ai_output_tokens, content_hash, "
        " created_at, created_by, updated_at, updated_by, approved_at, approved_by) "
        "VALUES (:id, 'sfcr', :rp, :sid, :ver, :content, 'draft', "
        "        :prompt, :model, :inp, :out, :hash, "
        "        CAST(:now AS TIMESTAMP), :user, CAST(:now AS TIMESTAMP), :user, NULL, NULL)",
        parameters=[
            StatementParameterListItem(name="id",      value=draft_id),
            StatementParameterListItem(name="rp",      value=period),
            StatementParameterListItem(name="sid",     value=req.section_id),
            StatementParameterListItem(name="ver",     value=str(version), type="INT"),
            StatementParameterListItem(name="content", value=content_json),
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
        "section_title": section["title"],
        "reporting_period": period,
        "version": version,
        "paragraphs": paragraphs,
        "content_hash": h,
        "ai_model": result.model_used,
        "ai_input_tokens": result.input_tokens,
        "ai_output_tokens": result.output_tokens,
        "status": "draft",
    }
    await cache_persist(cache_key, "sfcr_draft", req.section_id, period, response, user=user)
    return response


@router.post("/save")
async def save_draft(req: SaveRequest, request: Request):
    await _ensure_sfcr_tables()
    user = get_request_user(request)
    content_json = json.dumps({"paragraphs": req.paragraphs})
    h = _hash_content(content_json)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await execute_query(
        f"UPDATE {fqn('gold_sfcr_drafts')} SET content_json = :content, content_hash = :hash, "
        f"       updated_at = CAST(:now AS TIMESTAMP), updated_by = :user "
        f"WHERE draft_id = :id",
        parameters=[
            StatementParameterListItem(name="content", value=content_json),
            StatementParameterListItem(name="hash",    value=h),
            StatementParameterListItem(name="now",     value=now),
            StatementParameterListItem(name="user",    value=user),
            StatementParameterListItem(name="id",      value=req.draft_id),
        ],
    )
    return {"draft_id": req.draft_id, "content_hash": h, "updated_at": now, "updated_by": user}


@router.post("/approve")
async def approve_draft(req: ApproveRequest, request: Request):
    await _ensure_sfcr_tables()
    user = get_request_user(request)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    await execute_query(
        f"UPDATE {fqn('gold_sfcr_drafts')} SET status = 'approved', "
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
async def sfcr_pdf(reporting_period: str):
    """Render the latest version of every SFCR section into a single PDF."""
    return await _render_pdf(reporting_period, "sfcr", SFCR_SECTIONS, "Solvency and Financial Condition Report")


async def _render_pdf(period: str, doc_kind: str, sections: list[dict[str, Any]], title: str):
    await _ensure_sfcr_tables()
    section_id_order = {s["id"]: i for i, s in enumerate(sections)}
    rows = await execute_query(
        f"SELECT section_id, version, content_json, content_hash, status, approved_by, approved_at "
        f"FROM {fqn('gold_sfcr_drafts')} d "
        f"WHERE doc_kind = :dk AND reporting_period = :rp "
        f"  AND version = (SELECT MAX(version) FROM {fqn('gold_sfcr_drafts')} d2 "
        f"                 WHERE d2.doc_kind = d.doc_kind "
        f"                   AND d2.reporting_period = d.reporting_period "
        f"                   AND d2.section_id = d.section_id)",
        parameters=[
            StatementParameterListItem(name="dk", value=doc_kind),
            StatementParameterListItem(name="rp", value=period),
        ],
    )
    if not rows:
        raise HTTPException(404, f"No {doc_kind.upper()} drafts for {period}")

    # Order by section list
    rows.sort(key=lambda r: section_id_order.get(r["section_id"], 99))

    try:
        from fpdf import FPDF
    except Exception as exc:
        raise HTTPException(500, "PDF library not available") from exc

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Bricksurance SE | {period}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    section_hashes: list[str] = []
    section_titles = {s["id"]: s["title"] for s in sections}
    for r in rows:
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 7, section_titles.get(r["section_id"], r["section_id"]),
                 new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "I", 9)
        status_line = f"v{r['version']} · {r['status']}"
        if r.get("approved_by"):
            status_line += f" · approved by {r['approved_by']} {r.get('approved_at', '')}"
        pdf.cell(0, 5, status_line, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        try:
            content = json.loads(r["content_json"] or "{}")
            for para in content.get("paragraphs", []):
                txt = (para.get("text") or "").replace("—", "-").replace("→", "->")
                pdf.multi_cell(0, 5, txt)
                if para.get("citations"):
                    cites = "  Sources: " + "; ".join(
                        f"{c.get('table')} {c.get('cell')}" for c in para["citations"]
                    )
                    pdf.set_font("Helvetica", "I", 8)
                    pdf.multi_cell(0, 4, cites)
                    pdf.set_font("Helvetica", "", 10)
                pdf.ln(1)
        except Exception:
            pass
        pdf.ln(3)
        section_hashes.append(f"{r['section_id']}={r['content_hash'][:12]}")

    doc_hash = hashlib.sha256("|".join(section_hashes).encode("utf-8")).hexdigest()
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(0, 4, f"Document hash (sha256): {doc_hash[:32]}...",
             new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4, "Section hashes: " + ", ".join(section_hashes),
             new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4, f"Generated: {datetime.now(timezone.utc).isoformat()}",
             new_x="LMARGIN", new_y="NEXT")

    pdf_bytes = bytes(pdf.output())
    filename = f"{doc_kind.upper()}_{period}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Document-Hash": doc_hash,
        },
    )

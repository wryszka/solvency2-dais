"""RSR — Regular Supervisory Report.

Pillar 3, supervisor-only. Same engine as SFCR (gold_sfcr_drafts table,
TipTap-friendly content_json, citations) — RSR adds two supervisor-only
sections and the SFCR sections themselves are reused without change.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from server.ai import generate_review
from server.cache import (
    cache_lookup, cache_persist, cache_miss_503, make_cache_key, should_use_cache,
)
from server.config import fqn, get_request_user
from server.sql import execute_query

# Reuse the SFCR engine helpers
from server.routes.sfcr import (
    SFCR_SECTIONS,
    SFCR_SYSTEM,
    SECTION_PROMPTS as SFCR_SECTION_PROMPTS,
    _ensure_sfcr_tables,
    _gather_sfcr_data,
    _format_sfcr_data_block,
    _parse_paragraphs,
    _hash_content,
    _render_pdf,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rsr", tags=["rsr"])


# Two supervisor-only sections in addition to the public SFCR ones.
RSR_ONLY_SECTIONS: list[dict[str, Any]] = [
    {"id": "supervisor_uw_detail",
     "title": "F. Detailed Underwriting Analysis (supervisor-only)",
     "summary": "Granular per-LoB performance, including loss ratios and reserving deltas not disclosed publicly."},
    {"id": "supervisor_capital_planning",
     "title": "G. Forward Capital Planning (supervisor-only)",
     "summary": "Capital management plan over 3 years, reinsurance roadmap, dividend policy."},
]

RSR_SECTIONS = SFCR_SECTIONS + RSR_ONLY_SECTIONS

RSR_ONLY_PROMPTS: dict[str, str] = {
    "supervisor_uw_detail": (
        "Draft Section F — 'Detailed Underwriting Analysis' (supervisor-only). Cover per-LoB "
        "performance with loss/expense/combined ratios, reserve releases or strengthenings, "
        "any notable developments not disclosed in the public SFCR."
    ),
    "supervisor_capital_planning": (
        "Draft Section G — 'Forward Capital Planning' (supervisor-only). Cover the 3-year "
        "capital plan, reinsurance strategy roadmap, intended dividend policy, and any planned "
        "capital actions."
    ),
}

ALL_PROMPTS = {**SFCR_SECTION_PROMPTS, **RSR_ONLY_PROMPTS}


class DraftRequest(BaseModel):
    section_id: str
    reporting_period: str | None = None


class SaveRequest(BaseModel):
    draft_id: str
    paragraphs: list[dict[str, Any]]


class ApproveRequest(BaseModel):
    draft_id: str


def _resolve_section(section_id: str) -> dict[str, Any]:
    for s in RSR_SECTIONS:
        if s["id"] == section_id:
            return s
    raise HTTPException(400, f"Unknown RSR section: {section_id}")


@router.get("/sections")
async def list_sections():
    return {"sections": RSR_SECTIONS}


@router.get("/drafts")
async def list_drafts(reporting_period: str | None = None):
    await _ensure_sfcr_tables()
    if reporting_period:
        rows = await execute_query(
            f"SELECT draft_id, reporting_period, section_id, version, status, "
            f"       content_hash, ai_model, created_at, updated_at, approved_at, approved_by "
            f"FROM {fqn('gold_sfcr_drafts')} "
            f"WHERE doc_kind = 'rsr' AND reporting_period = :rp "
            f"ORDER BY section_id, version DESC",
            parameters=[StatementParameterListItem(name="rp", value=reporting_period)],
        )
    else:
        rows = await execute_query(
            f"SELECT draft_id, reporting_period, section_id, version, status, "
            f"       content_hash, ai_model, created_at, updated_at, approved_at, approved_by "
            f"FROM {fqn('gold_sfcr_drafts')} WHERE doc_kind = 'rsr' "
            f"ORDER BY reporting_period DESC, section_id, version DESC LIMIT 200"
        )
    return {"drafts": rows}


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

    cache_key = make_cache_key("rsr_draft", req.section_id, period)
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
        f"{ALL_PROMPTS[req.section_id]}"
    )

    result = await generate_review(SFCR_SYSTEM, user_prompt, agent_name=f"rsr_{req.section_id}")
    paragraphs = _parse_paragraphs(result.text)
    content_json = json.dumps({"paragraphs": paragraphs})
    h = _hash_content(content_json)

    v_rows = await execute_query(
        f"SELECT COUNT(*) AS n FROM {fqn('gold_sfcr_drafts')} "
        f"WHERE doc_kind = 'rsr' AND reporting_period = :rp AND section_id = :sid",
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
        "VALUES (:id, 'rsr', :rp, :sid, :ver, :content, 'draft', "
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
        "status": "draft",
    }
    await cache_persist(cache_key, "rsr_draft", req.section_id, period, response, user=user)
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
async def rsr_pdf(reporting_period: str):
    return await _render_pdf(reporting_period, "rsr", RSR_SECTIONS, "Regular Supervisory Report")

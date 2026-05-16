"""Governance — unified surface across all model types.

The single source of truth for the Actuarial Lab. Combines:
  - MLflow registered models (native UC: reserving_pnc, reserving_life, standard_formula)
  - External-engine alias rows from `6_gov_model_aliases` (igloo_cat, prophet_life)

Endpoints:
- GET  /api/governance/models                       → peer-row list (5 models)
- GET  /api/governance/models/{model_id}            → header + versions + aliases
- GET  /api/governance/models/{model_id}/versions   → version history
- GET  /api/governance/models/{model_id}/diagnostics → diagnostics snapshots
- GET  /api/governance/models/{model_id}/promotions  → promotion event log
- POST /api/governance/models/{model_id}/promote    → promote candidate → production
                                                       (flips MLflow alias for native;
                                                        updates `6_gov_model_aliases` for external)
- POST /api/governance/promotions/{promotion_id}/approve → approve a pending promotion

The promote endpoint is the close-of-quarter workflow: it requires
diagnostics_passed=True, a justification, and an approver signature.

Read paths are cacheable; the agent has read-only access via these.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from server.config import fqn, get_request_user, get_workspace_client, get_catalog, get_schema
from server.sql import execute_query, execute_query_cached

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/governance", tags=["governance"])


# Canonical 5-model registry. The Lab table renders one row per model.
NATIVE_MODELS: list[dict[str, str]] = [
    {"model_id": "reserving_pnc",    "label": "Reserving — P&C",  "engine": "Native UC",     "engine_tag": "native"},
    {"model_id": "reserving_life",   "label": "Reserving — Life", "engine": "Native UC",     "engine_tag": "native"},
    {"model_id": "standard_formula", "label": "Standard Formula", "engine": "Native UC",     "engine_tag": "native"},
]
EXTERNAL_MODELS: list[dict[str, str]] = [
    {"model_id": "igloo_cat",        "label": "Cat Risk",         "engine": "WTW Igloo",     "engine_tag": "external"},
    {"model_id": "prophet_life",     "label": "Life Risk",        "engine": "FIS Prophet",   "engine_tag": "external"},
]


def _native_full_name(model_id: str) -> str:
    return f"{get_catalog()}.{get_schema()}.{model_id}"


# ── Helpers: fetching MLflow + external state ───────────────────────────────

def _get_native_state(model_id: str) -> dict[str, Any]:
    """Workspace-SDK lookup of UC MLflow registered model."""
    full = _native_full_name(model_id)
    try:
        client = get_workspace_client()
        rm = client.registered_models.get(full_name=full, include_aliases=True)
        aliases = []
        for a in (rm.aliases or []):
            # SDK returns lowercase alias names; normalise
            aliases.append({"alias_name": a.alias_name, "version_num": a.version_num})

        versions: list[dict[str, Any]] = []
        try:
            for v in client.model_versions.list(full_name=full):
                versions.append({
                    "version": str(v.version),
                    "comment": v.comment,
                    "created_at": str(v.created_at) if v.created_at else None,
                    "created_by": v.created_by,
                    "status": str(v.status) if v.status else None,
                })
        except Exception as exc:
            logger.warning("Versions list failed for %s: %s", full, exc)

        return {
            "full_name": full,
            "owner": rm.owner,
            "comment": rm.comment,
            "aliases": aliases,
            "versions": versions,
        }
    except Exception as exc:
        logger.warning("Native model state read failed for %s: %s", full, exc)
        return {"full_name": full, "aliases": [], "versions": [], "error": str(exc)}


async def _get_external_state(model_id: str) -> dict[str, Any]:
    """`6_gov_model_aliases` rows for an external engine."""
    rows = await execute_query(
        f"SELECT alias, version_label, artefact_table, reporting_period, set_at, set_by "
        f"FROM {fqn('6_gov_model_aliases')} WHERE model_id = :mid ORDER BY set_at DESC",
        parameters=[StatementParameterListItem(name="mid", value=model_id)],
    )
    aliases = [{"alias_name": r["alias"], "version_label": r["version_label"]} for r in rows]
    return {
        "full_name": model_id,
        "aliases": aliases,
        "rows": rows,
        "artefact_table": rows[0]["artefact_table"] if rows else None,
    }


def _alias_pick(aliases: list[dict[str, Any]], name: str) -> str | None:
    name_lower = name.lower()
    for a in aliases:
        if a.get("alias_name", "").lower() == name_lower:
            return str(a.get("version_num") or a.get("version_label") or "")
    return None


# ── Read endpoints ──────────────────────────────────────────────────────────

@router.get("/models")
async def list_models():
    """Peer-row table for the Lab. One row per model, native + external mixed."""
    rows: list[dict[str, Any]] = []

    for spec in NATIVE_MODELS:
        st = await asyncio.to_thread(_get_native_state, spec["model_id"])
        prod_v = _alias_pick(st["aliases"], "production") or _alias_pick(st["aliases"], "champion")
        cand_v = _alias_pick(st["aliases"], "candidate")  or _alias_pick(st["aliases"], "challenger")
        rows.append({
            "model_id":          spec["model_id"],
            "label":             spec["label"],
            "engine":            spec["engine"],
            "engine_tag":        spec["engine_tag"],
            "production_version": prod_v,
            "candidate_version":  cand_v,
            "n_versions":         len(st["versions"]),
            "owner":              st.get("owner"),
            "error":              st.get("error"),
        })

    for spec in EXTERNAL_MODELS:
        st = await _get_external_state(spec["model_id"])
        prod_v = _alias_pick(st["aliases"], "production")
        cand_v = _alias_pick(st["aliases"], "candidate")
        rows.append({
            "model_id":          spec["model_id"],
            "label":             spec["label"],
            "engine":            spec["engine"],
            "engine_tag":        spec["engine_tag"],
            "production_version": prod_v,
            "candidate_version":  cand_v,
            "n_versions":         len(st["aliases"]),
            "artefact_table":     st.get("artefact_table"),
        })

    # Latest promotion per model (for Status column)
    latest = await execute_query(f"""
        SELECT model_name, status, quarter, promoted_at, approver, to_version
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY model_name ORDER BY promoted_at DESC NULLS LAST, approved_at DESC NULLS LAST) AS rn
          FROM {fqn('6_gov_promotions')}
        ) WHERE rn = 1
    """)
    promo_by_model = {r["model_name"]: r for r in latest}

    pending = await execute_query(f"""
        SELECT model_name, COUNT(*) AS n FROM {fqn('6_gov_promotions')}
        WHERE status = 'pending' GROUP BY model_name
    """)
    pending_by_model = {r["model_name"]: int(r["n"]) for r in pending}

    for r in rows:
        p = promo_by_model.get(r["model_id"], {})
        r["last_promotion_status"] = p.get("status")
        r["last_promotion_quarter"] = p.get("quarter")
        r["last_promotion_at"] = p.get("promoted_at")
        r["last_promotion_approver"] = p.get("approver")
        r["pending_promotions"] = pending_by_model.get(r["model_id"], 0)

    return {"models": rows}


@router.get("/models/{model_id}")
async def get_model(model_id: str):
    spec = next((s for s in NATIVE_MODELS + EXTERNAL_MODELS if s["model_id"] == model_id), None)
    if not spec:
        raise HTTPException(404, f"Unknown model: {model_id}")

    if spec["engine_tag"] == "native":
        state = await asyncio.to_thread(_get_native_state, model_id)
    else:
        state = await _get_external_state(model_id)

    return {
        "model_id": model_id,
        "label": spec["label"],
        "engine": spec["engine"],
        "engine_tag": spec["engine_tag"],
        "state": state,
    }


@router.get("/models/{model_id}/diagnostics")
async def get_model_diagnostics(model_id: str, period: str | None = Query(None)):
    where = "WHERE model_name = :mn"
    params = [StatementParameterListItem(name="mn", value=model_id)]
    if period:
        where += " AND reporting_period = :p"
        params.append(StatementParameterListItem(name="p", value=period))
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_gov_model_diagnostics')} {where} "
        f"ORDER BY reporting_period DESC, diagnostic_name",
        parameters=params,
    )
    return {"diagnostics": rows}


@router.get("/models/{model_id}/promotions")
async def get_model_promotions(model_id: str):
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_gov_promotions')} WHERE model_name = :mn "
        f"ORDER BY COALESCE(promoted_at, approved_at) DESC NULLS LAST LIMIT 50",
        parameters=[StatementParameterListItem(name="mn", value=model_id)],
    )
    return {"promotions": rows}


# ── Write endpoints ─────────────────────────────────────────────────────────

class PromoteRequest(BaseModel):
    target_alias: str = "production"           # alias to set on the candidate version
    candidate_version: str | None = None       # version to promote (default: current `candidate` alias)
    quarter: str
    justification: str
    approver: str | None = None                # if missing, pulled from request user


@router.post("/models/{model_id}/promote")
async def promote(model_id: str, req: PromoteRequest, request: Request):
    if req.target_alias not in {"production", "candidate", "archive"}:
        raise HTTPException(400, "target_alias must be production / candidate / archive")
    if len(req.justification.strip()) < 20:
        raise HTTPException(400, "Justification too short — at least 20 chars (the audit trail needs the why)")

    spec = next((s for s in NATIVE_MODELS + EXTERNAL_MODELS if s["model_id"] == model_id), None)
    if not spec:
        raise HTTPException(404, f"Unknown model: {model_id}")

    # Pull diagnostics — promotion blocked if any diagnostic for this quarter failed
    diag_rows = await execute_query(
        f"SELECT diagnostic_name, passed FROM {fqn('6_gov_model_diagnostics')} "
        f"WHERE model_name = :mn AND reporting_period = :p",
        parameters=[
            StatementParameterListItem(name="mn", value=model_id),
            StatementParameterListItem(name="p", value=req.quarter),
        ],
    )
    failed = [r["diagnostic_name"] for r in diag_rows if r.get("passed") in (False, "false", "False")]
    if failed:
        raise HTTPException(409, f"Diagnostics failed for {req.quarter}: {failed}. Promotion blocked.")
    diagnostics_passed = True

    user = get_request_user(request)
    approver = req.approver or user
    promotion_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    if spec["engine_tag"] == "native":
        # Resolve current production + candidate
        full = _native_full_name(model_id)
        client = get_workspace_client()
        rm = await asyncio.to_thread(client.registered_models.get, full_name=full, include_aliases=True)
        aliases = {a.alias_name.lower(): str(a.version_num) for a in (rm.aliases or [])}
        current_prod = aliases.get("production")
        current_cand = aliases.get("candidate")
        new_version = req.candidate_version or current_cand
        if not new_version:
            raise HTTPException(400, f"No candidate version for {model_id}; specify candidate_version explicitly")

        # Flip aliases: candidate → target_alias (typically production); previous production → archive
        try:
            await asyncio.to_thread(
                client.registered_models.set_alias,
                full_name=full, alias=req.target_alias, version_num=int(new_version),
            )
            if req.target_alias == "production" and current_prod and current_prod != new_version:
                await asyncio.to_thread(
                    client.registered_models.set_alias,
                    full_name=full, alias="archive", version_num=int(current_prod),
                )
        except Exception as exc:
            raise HTTPException(500, f"MLflow alias flip failed: {exc}") from exc

        from_version = current_prod
        to_version = str(new_version)
    else:
        # External: read current row, update alias
        cur = await execute_query(
            f"SELECT version_label, alias FROM {fqn('6_gov_model_aliases')} "
            f"WHERE model_id = :m AND alias = 'candidate' ORDER BY set_at DESC LIMIT 1",
            parameters=[StatementParameterListItem(name="m", value=model_id)],
        )
        if not cur and not req.candidate_version:
            raise HTTPException(400, f"No candidate row for external engine {model_id}")
        new_label = req.candidate_version or cur[0]["version_label"]

        # Move existing production → archive
        await execute_query(
            f"UPDATE {fqn('6_gov_model_aliases')} SET alias = 'archive' "
            f"WHERE model_id = :m AND alias = 'production'",
            parameters=[StatementParameterListItem(name="m", value=model_id)],
        )
        # Move candidate → production (or whatever target_alias)
        await execute_query(
            f"UPDATE {fqn('6_gov_model_aliases')} SET alias = :a, set_at = CAST(:now AS TIMESTAMP), set_by = :u "
            f"WHERE model_id = :m AND version_label = :v",
            parameters=[
                StatementParameterListItem(name="a", value=req.target_alias),
                StatementParameterListItem(name="now", value=now),
                StatementParameterListItem(name="u", value=user),
                StatementParameterListItem(name="m", value=model_id),
                StatementParameterListItem(name="v", value=new_label),
            ],
        )
        from_version = (cur[0]["version_label"] if cur else None)
        to_version = new_label

    # Log to 6_gov_promotions
    await execute_query(
        f"INSERT INTO {fqn('6_gov_promotions')} "
        "(promotion_id, model_name, model_type, from_alias, to_alias, from_version, to_version, "
        " quarter, diagnostics_passed, justification, approver, approved_at, "
        " promoted_by, promoted_at, status) "
        "VALUES (:pid, :mn, :mt, 'candidate', :ta, :fv, :tv, :q, :dp, :j, :app, "
        "        CAST(:now AS TIMESTAMP), :u, CAST(:now AS TIMESTAMP), 'approved')",
        parameters=[
            StatementParameterListItem(name="pid", value=promotion_id),
            StatementParameterListItem(name="mn",  value=model_id),
            StatementParameterListItem(name="mt",  value=spec["engine_tag"]),
            StatementParameterListItem(name="ta",  value=req.target_alias),
            StatementParameterListItem(name="fv",  value=str(from_version) if from_version else ""),
            StatementParameterListItem(name="tv",  value=str(to_version)),
            StatementParameterListItem(name="q",   value=req.quarter),
            StatementParameterListItem(name="dp",  value="true" if diagnostics_passed else "false", type="BOOLEAN"),
            StatementParameterListItem(name="j",   value=req.justification),
            StatementParameterListItem(name="app", value=approver),
            StatementParameterListItem(name="now", value=now),
            StatementParameterListItem(name="u",   value=user),
        ],
    )
    return {
        "promotion_id": promotion_id,
        "model_id": model_id,
        "from_version": from_version,
        "to_version": to_version,
        "target_alias": req.target_alias,
        "diagnostics_passed": diagnostics_passed,
        "approver": approver,
    }


# ── Cross-model summary (for Lab header + Workbench Assistant) ─────────────

@router.get("/summary")
async def governance_summary(period: str | None = Query(None)):
    """High-level counts for the Lab page header + the Workbench Assistant agent."""
    where = "WHERE quarter = :p" if period else ""
    params = [StatementParameterListItem(name="p", value=period)] if period else []

    pending = await execute_query(
        f"SELECT COUNT(*) AS n FROM {fqn('6_gov_promotions')} WHERE status = 'pending'"
        + (" AND quarter = :p" if period else ""),
        parameters=params,
    )
    approved = await execute_query(
        f"SELECT COUNT(*) AS n FROM {fqn('6_gov_promotions')} WHERE status = 'approved'"
        + (" AND quarter = :p" if period else ""),
        parameters=params,
    )
    failed_diags = await execute_query(
        f"SELECT model_name, COUNT(*) AS n FROM {fqn('6_gov_model_diagnostics')} "
        f"WHERE passed = false " + (" AND reporting_period = :p" if period else "")
        + " GROUP BY model_name",
        parameters=params,
    )
    return {
        "pending_promotions": int((pending[0] or {}).get("n", 0) or 0),
        "approved_promotions": int((approved[0] or {}).get("n", 0) or 0),
        "models_with_failed_diagnostics": failed_diags,
    }


# ── Phase 9 — Governance destination landing ─────────────────────────────

@router.get("/landing")
async def governance_landing(period: str | None = Query(None)):
    """Aggregates the 4 KPI tiles + recent governance events for the
    Governance destination page. Reads existing tables only — no new ETL.
    """
    # Default target period to whatever today resolves to via the demo
    # period helper — derived from datetime, not a table lookup.
    if period:
        target_period = period
    else:
        try:
            from datetime import datetime, timezone
            from server.routes.demo import _quarter_for, _quarter_label
            today = datetime.now(timezone.utc)
            yyyy, q, _qs, _qe = _quarter_for(today)
            target_period = _quarter_label(yyyy, q)
        except Exception:
            target_period = "2026-Q2"

    # KPI 1 — pending governance actions (overlays + model promotions).
    # Status values across the seed are inconsistent: overlays land as
    # 'pending_approval', promotions as 'pending'. Accept both. Promotions
    # span quarters (a pending Q1 promotion can still be pending in Q2) so
    # don't filter by quarter — overlays we do filter by current quarter.
    try:
        pend_overlays = await execute_query(
            f"SELECT overlay_id, line_of_business, magnitude_eur, author "
            f"FROM {fqn('6_gov_overlays')} "
            f"WHERE quarter = :p AND status IN ('pending', 'pending_approval') "
            f"ORDER BY ABS(CAST(magnitude_eur AS DOUBLE)) DESC",
            parameters=[StatementParameterListItem(name="p", value=target_period)],
        )
    except Exception:
        pend_overlays = []
    try:
        pend_promos = await execute_query(
            f"SELECT model_name, to_version, approver, quarter FROM {fqn('6_gov_promotions')} "
            f"WHERE status IN ('pending', 'pending_approval') "
            f"ORDER BY COALESCE(approved_at, promoted_at) DESC"
        )
    except Exception:
        pend_promos = []

    pending_total = len(pend_overlays) + len(pend_promos)
    most_urgent = None
    if pend_overlays:
        o = pend_overlays[0]
        eur_m = (abs(float(o.get("magnitude_eur") or 0)) / 1e6)
        most_urgent = {
            "label": f"{o.get('line_of_business')} overlay (EUR {eur_m:.1f}M)",
            "owner": o.get("author"),
            "type": "overlay",
        }
    elif pend_promos:
        p = pend_promos[0]
        most_urgent = {
            "label": f"{p.get('model_name')} → {p.get('to_version')}",
            "owner": p.get("approver"),
            "type": "promotion",
        }

    # KPI 2 — active controls
    try:
        controls = await execute_query(
            f"SELECT control_id, status, last_verified_at "
            f"FROM {fqn('6_internal_controls')} "
            f"WHERE status IN ('active', 'auto')"
        )
    except Exception:
        controls = []
    controls_count = len(controls)
    controls_last_verified = None
    if controls:
        try:
            controls_last_verified = max(
                (str(c.get("last_verified_at")) for c in controls if c.get("last_verified_at")),
                default=None,
            )
        except Exception:
            controls_last_verified = None

    # KPI 3 — AI activity (24h) from 6_ai_routing_trace
    ai_total = 0; ai_cached = 0; top_specialist = None
    try:
        ai_rows = await execute_query(
            f"SELECT specialist_key, specialist_name, was_cached "
            f"FROM {fqn('6_ai_routing_trace')} "
            f"WHERE created_at >= current_timestamp() - INTERVAL 1 DAY"
        )
        ai_total = len(ai_rows)
        ai_cached = sum(1 for r in ai_rows if r.get("was_cached"))
        if ai_rows:
            from collections import Counter
            counts = Counter(r.get("specialist_name") or r.get("specialist_key") for r in ai_rows)
            top_specialist, _ = counts.most_common(1)[0]
    except Exception:
        ai_total = 0
    ai_cached_pct = round((ai_cached / ai_total * 100), 1) if ai_total else 0.0

    # KPI 4 — audit coverage (% submissions archived for current period)
    audit_coverage_pct = 0
    try:
        arc = await execute_query(
            f"SELECT qrt, status FROM {fqn('gold_submissions_archive')} "
            f"WHERE period = :p",
            parameters=[StatementParameterListItem(name="p", value=target_period)],
        )
        if arc:
            total = len(arc)
            done = sum(1 for r in arc if (r.get("status") or "").lower() in ("submitted", "approved", "reviewed"))
            audit_coverage_pct = round(done / total * 100, 1) if total else 0
    except Exception:
        audit_coverage_pct = 0

    # Recent events — last 20 from promotions + overlay creates + agent failures
    events: list[dict[str, Any]] = []
    try:
        for r in await execute_query(
            f"SELECT model_name, to_version, status, approver, "
            f"  COALESCE(approved_at, promoted_at) AS ts "
            f"FROM {fqn('6_gov_promotions')} "
            f"ORDER BY ts DESC LIMIT 20"
        ):
            events.append({
                "kind": "model_promotion",
                "label": f"{r['model_name']} → {r['to_version']}",
                "actor": r.get("approver"),
                "status": r.get("status"),
                "ts": str(r.get("ts")),
            })
    except Exception:
        pass
    try:
        for r in await execute_query(
            f"SELECT line_of_business, magnitude_eur, status, author, created_at "
            f"FROM {fqn('6_gov_overlays')} ORDER BY created_at DESC LIMIT 20"
        ):
            events.append({
                "kind": "overlay",
                "label": f"{r['line_of_business']} overlay · EUR {(float(r.get('magnitude_eur') or 0)/1e6):.1f}M",
                "actor": r.get("author"),
                "status": r.get("status"),
                "ts": str(r.get("created_at")),
            })
    except Exception:
        pass
    events.sort(key=lambda e: e["ts"], reverse=True)
    events = events[:20]

    return {
        "period": target_period,
        "kpis": {
            "pending_total": pending_total,
            "most_urgent": most_urgent,
            "controls_active": controls_count,
            "controls_last_verified": controls_last_verified,
            "ai_24h_total": ai_total,
            "ai_24h_cached_pct": ai_cached_pct,
            "ai_top_specialist": top_specialist,
            "audit_coverage_pct": audit_coverage_pct,
        },
        "recent_events": events,
        "pending_overlays": pend_overlays,
        "pending_promotions": pend_promos,
    }

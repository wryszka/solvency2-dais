"""Audit Panel — unified audit data for any QRT.

Single endpoint that returns all 5 panes the AuditPanel renders:
  - data:     source-table provenance (DESCRIBE HISTORY → version/timestamp/row counts)
  - code:     notebooks/jobs that produced this QRT (curated + last-run from job runs)
  - models:   model versions that contributed (production aliases at this period)
  - approvals_overlays: approval chain + overlays linked to this QRT's cells
  - lineage:  curated dependency graph

Time-aware: the `period` query param filters everything to that quarter, so
clicking through Q1 2025 returns Q1's audit. Optional `as_of_version` selects
a specific Delta version of the QRT table for full Delta time travel.

This panel is what makes "audit travels with the artefact" visible.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from server.config import fqn, get_workspace_client, get_catalog, get_schema
from server.sql import execute_query
from server.lineage import get_lineage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/qrt", tags=["audit"])


# ── Data tab ────────────────────────────────────────────────────────────────

async def _table_history(table_name: str, limit: int = 5) -> list[dict[str, Any]]:
    try:
        rows = await execute_query(
            f"SELECT version, timestamp, operation, operationMetrics "
            f"FROM (DESCRIBE HISTORY {fqn(table_name)}) ORDER BY version DESC LIMIT {limit}"
        )
        return rows
    except Exception as exc:
        logger.warning("DESCRIBE HISTORY failed for %s: %s", table_name, exc)
        return []


async def _table_summary(table_name: str, period: str | None) -> dict[str, Any]:
    try:
        if period:
            count_q = f"SELECT COUNT(*) AS n FROM {fqn(table_name)} WHERE reporting_period = :p"
            from databricks.sdk.service.sql import StatementParameterListItem
            params = [StatementParameterListItem(name="p", value=period)]
            rows = await execute_query(count_q, parameters=params)
        else:
            rows = await execute_query(f"SELECT COUNT(*) AS n FROM {fqn(table_name)}")
        n = int((rows[0] or {}).get("n", 0) or 0) if rows else 0
        return {"row_count": n}
    except Exception as exc:
        return {"row_count": None, "error": str(exc)}


# ── Code tab ────────────────────────────────────────────────────────────────

async def _list_recent_job_runs(limit: int = 10) -> list[dict[str, Any]]:
    """Recent job-run history for the workspace (best-effort)."""
    try:
        client = get_workspace_client()
        runs = list(client.jobs.list_runs(limit=limit, expand_tasks=False))
        out: list[dict[str, Any]] = []
        for r in runs:
            out.append({
                "job_id": r.job_id,
                "run_id": r.run_id,
                "run_name": r.run_name,
                "state":   str(r.state.life_cycle_state) if r.state else None,
                "result":  str(r.state.result_state) if r.state and r.state.result_state else None,
                "start":   r.start_time,
                "end":     r.end_time,
            })
        return out
    except Exception as exc:
        logger.warning("Job runs list failed: %s", exc)
        return []


# ── Models tab ──────────────────────────────────────────────────────────────

async def _models_for_qrt(qrt_id: str, period: str | None) -> list[dict[str, Any]]:
    """Production model versions that produced this QRT for the given period."""
    lineage = get_lineage(qrt_id) or {}
    produced_by = lineage.get("produced_by", [])
    if not produced_by:
        return []
    # Look up the promotion record per (model, period) — the "to_version" is what was production at that time
    from databricks.sdk.service.sql import StatementParameterListItem
    out: list[dict[str, Any]] = []
    for model_id in produced_by:
        params = [StatementParameterListItem(name="m", value=model_id)]
        where = "model_name = :m AND status = 'approved' AND to_alias = 'production'"
        if period:
            where += " AND quarter = :p"
            params.append(StatementParameterListItem(name="p", value=period))
        rows = await execute_query(
            f"SELECT model_name, model_type, to_version, quarter, approver, approved_at "
            f"FROM {fqn('6_gov_promotions')} WHERE {where} "
            f"ORDER BY approved_at DESC NULLS LAST LIMIT 1",
            parameters=params,
        )
        if rows:
            out.append(rows[0])
        else:
            out.append({"model_name": model_id, "to_version": None, "quarter": period, "approver": None, "approved_at": None})
    return out


# ── Approvals & Overlays tab ────────────────────────────────────────────────

async def _qrt_approvals(qrt_id: str, period: str | None) -> list[dict[str, Any]]:
    try:
        from databricks.sdk.service.sql import StatementParameterListItem
        where = "qrt_id = :q"
        params = [StatementParameterListItem(name="q", value=qrt_id)]
        if period:
            where += " AND reporting_period = :p"
            params.append(StatementParameterListItem(name="p", value=period))
        rows = await execute_query(
            f"SELECT * FROM {fqn('6_ai_approvals')} WHERE {where} ORDER BY decided_at DESC",
            parameters=params,
        )
        return rows
    except Exception as exc:
        logger.warning("approvals query failed: %s", exc)
        return []


async def _qrt_overlays(qrt_id: str, period: str | None) -> list[dict[str, Any]]:
    """Overlays whose linked_qrt_cells reference this QRT (e.g. 's0501.*')."""
    from databricks.sdk.service.sql import StatementParameterListItem
    cell_prefix = qrt_id.lower() + "."
    where = ["array_contains(transform(linked_qrt_cells, c -> startswith(c, :pre)), true)",
             "status = 'approved'"]
    params = [StatementParameterListItem(name="pre", value=cell_prefix)]
    if period:
        where.append("quarter = :p")
        params.append(StatementParameterListItem(name="p", value=period))
    try:
        rows = await execute_query(
            f"SELECT overlay_id, quarter, model_name, line_of_business, magnitude_eur, "
            f"  direction, category, status, author, approver, lifecycle_action, "
            f"  linked_qrt_cells "
            f"FROM {fqn('6_gov_overlays')} WHERE {' AND '.join(where)} "
            f"ORDER BY ABS(magnitude_eur) DESC LIMIT 50",
            parameters=params,
        )
        return rows
    except Exception as exc:
        logger.warning("overlays query failed: %s", exc)
        return []


# ── Endpoint ────────────────────────────────────────────────────────────────

@router.get("/{qrt_id}/audit")
async def get_audit(qrt_id: str, period: str | None = Query(None)):
    """Return all 5 audit panes for a QRT in a single payload."""
    lineage = get_lineage(qrt_id)
    if not lineage:
        raise HTTPException(404, f"No lineage curated for QRT '{qrt_id}'")

    # Data tab
    source_tables = []
    for src in lineage["source_tables"]:
        history = await _table_history(src["name"], limit=4)
        summary = await _table_summary(src["name"], period)
        source_tables.append({
            "name":     src["name"],
            "layer":    src["layer"],
            "columns_used": src["columns_used"],
            "described":    src["described"],
            "row_count":    summary.get("row_count"),
            "history":      history,
        })
    qrt_history = await _table_history(lineage["qrt_table"], limit=8)

    # Code tab
    code_notebooks = lineage["code_notebooks"]
    recent_runs = await _list_recent_job_runs(limit=10)

    # Models tab
    models = await _models_for_qrt(qrt_id, period)

    # Approvals + Overlays tab
    approvals = await _qrt_approvals(qrt_id, period)
    overlays = await _qrt_overlays(qrt_id, period)

    # Lineage tab — full graph
    full_lineage = {
        "produced_by": lineage["produced_by"],
        "source_tables": [{"name": s["name"], "layer": s["layer"], "described": s["described"]} for s in lineage["source_tables"]],
        "qrt_table": lineage["qrt_table"],
        "summary_table": lineage["summary_table"],
    }

    return {
        "qrt_id": qrt_id,
        "period": period,
        "data": {
            "qrt_table":      lineage["qrt_table"],
            "qrt_history":    qrt_history,
            "source_tables":  source_tables,
        },
        "code": {
            "notebooks":   code_notebooks,
            "recent_runs": recent_runs,
        },
        "models": models,
        "approvals_overlays": {
            "approvals": approvals,
            "overlays":  overlays,
        },
        "lineage": full_lineage,
    }


# ── Time travel: list available Delta versions of a QRT table ──────────────

@router.get("/{qrt_id}/versions")
async def list_versions(qrt_id: str):
    """List Delta versions of the QRT table — used by the 'View as-of' picker."""
    lineage = get_lineage(qrt_id)
    if not lineage:
        raise HTTPException(404, f"No lineage curated for QRT '{qrt_id}'")
    history = await _table_history(lineage["qrt_table"], limit=20)
    return {"qrt_table": lineage["qrt_table"], "history": history}

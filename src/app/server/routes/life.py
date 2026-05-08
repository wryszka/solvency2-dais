"""Composite life-side endpoints — Pillar 1 deliverables that don't fit
the per-QRT_DEFS template (S.12.01 + Life UW Risk).

Two read-only routes:
  - /api/life/reserves  — life BEL + RM by LoB across periods
  - /api/life/uw        — life UW SCR sub-modules across periods

Both are simple aggregations over the gold tables. The frontend's
LifeReserving and LifeUWRisk pages consume these directly.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from server.config import fqn
from server.sql import execute_query_cached

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/life", tags=["life"])


@router.get("/reserves")
async def reserves():
    """Per-LoB life BEL + RM, all periods. Frontend groups by period."""
    try:
        rows = await execute_query_cached(
            f"SELECT reporting_period, lob_code, lob_name, lob_eiopa_name, "
            f"       in_force_count, "
            f"       CAST(best_estimate_liability_eur AS DOUBLE) AS best_estimate_liability_eur, "
            f"       CAST(risk_margin_eur AS DOUBLE)             AS risk_margin_eur, "
            f"       CAST(technical_provisions_eur AS DOUBLE)    AS technical_provisions_eur, "
            f"       assumption_version "
            f"FROM {fqn('1_raw_life_reserves')} "
            f"ORDER BY reporting_period, lob_code",
            ttl_seconds=60,
        )
        return {"data": rows}
    except Exception as exc:
        logger.exception("Life reserves fetch failed")
        raise HTTPException(500, str(exc)) from exc


@router.get("/uw")
async def uw_risk():
    """Life UW SCR sub-modules per period (mortality, longevity, lapse, expense, life_cat, total)."""
    try:
        rows = await execute_query_cached(
            f"SELECT reporting_period, "
            f"       CAST(mortality_eur AS DOUBLE) AS mortality_eur, "
            f"       CAST(longevity_eur AS DOUBLE) AS longevity_eur, "
            f"       CAST(lapse_eur AS DOUBLE) AS lapse_eur, "
            f"       CAST(expense_eur AS DOUBLE) AS expense_eur, "
            f"       CAST(life_cat_eur AS DOUBLE) AS life_cat_eur, "
            f"       CAST(total_life_uw_scr AS DOUBLE) AS total_life_uw_scr, "
            f"       CAST(diversification_benefit_eur AS DOUBLE) AS diversification_benefit_eur "
            f"FROM {fqn('3_qrt_life_uw_risk_summary')} "
            f"ORDER BY reporting_period",
            ttl_seconds=60,
        )
        # Sub-module breakdown per period (long form), used by the chart
        sub_rows = await execute_query_cached(
            f"SELECT reporting_period, lob_name, sub_module, "
            f"       CAST(var_eur AS DOUBLE) AS var_eur, "
            f"       CAST(tvar_eur AS DOUBLE) AS tvar_eur "
            f"FROM {fqn('2_stg_life_uw_risk_by_module')} "
            f"ORDER BY reporting_period, lob_name, sub_module",
            ttl_seconds=60,
        )
        return {"summary": rows, "by_module": sub_rows}
    except Exception as exc:
        logger.exception("Life UW fetch failed")
        raise HTTPException(500, str(exc)) from exc


@router.get("/lapses")
async def lapses():
    """Quarterly lapse experience by LoB and duration band."""
    try:
        rows = await execute_query_cached(
            f"SELECT reporting_period, lob_name, duration_band, "
            f"       in_force_at_quarter_start, lapsed_in_quarter, "
            f"       CAST(lapse_rate_quarterly AS DOUBLE) AS lapse_rate_quarterly, "
            f"       CAST(annualised_lapse_rate AS DOUBLE) AS annualised_lapse_rate "
            f"FROM {fqn('1_raw_life_lapses')} "
            f"ORDER BY reporting_period, lob_name, duration_band",
            ttl_seconds=60,
        )
        return {"data": rows}
    except Exception as exc:
        logger.exception("Life lapses fetch failed")
        raise HTTPException(500, str(exc)) from exc

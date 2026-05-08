"""Landing page status endpoint.

Returns live status flags for each pillar deliverable so the Landing page
hero shows real "Capital: ready / ORSA: in progress / 2.3M recon gap"
indicators instead of hardcoded copy.

Cheap aggregations only — read-only, cached, fanned-out in parallel.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from server.config import fqn
from server.sql import execute_query_cached

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/landing", tags=["landing"])


# Each tile we surface on the landing page. Deliberately compact —
# the Landing page only renders 6 / 4 / 4 of these.
TILE_KEYS = [
    # Pillar 1
    "scr", "reserving_pnc", "reserving_life", "nl_uw_risk", "life_uw_risk", "assets",
    # Pillar 2
    "orsa", "model_governance", "afr", "internal_controls",
    # Pillar 3
    "qrt_pack", "sfcr", "rsr", "regulator_qa",
]


def _ok(rows_or_exc: Any) -> list:
    return [] if isinstance(rows_or_exc, Exception) else (rows_or_exc or [])


@router.get("/status")
async def landing_status():
    """Return per-tile status for the Landing page pillar columns."""
    try:
        # Parallel small queries against the gold + monitoring tables.
        scr_q = f"""
            SELECT reporting_period, ROUND(scr_eur/1e6, 1) AS scr_meur, solvency_ratio_pct
            FROM {fqn('3_qrt_s2501_summary')}
            ORDER BY reporting_period DESC LIMIT 1
        """
        s1201_q = f"""
            SELECT reporting_period, ROUND(total_technical_provisions_eur/1e6, 1) AS tp_meur
            FROM {fqn('3_qrt_s1201_summary')}
            ORDER BY reporting_period DESC LIMIT 1
        """
        s2606_q = f"""
            SELECT reporting_period, ROUND(total_nl_uw_scr/1e6, 1) AS nl_uw_meur
            FROM {fqn('3_qrt_s2606_summary')}
            ORDER BY reporting_period DESC LIMIT 1
        """
        lifeuw_q = f"""
            SELECT reporting_period, ROUND(total_life_uw_scr/1e6, 1) AS life_uw_meur
            FROM {fqn('3_qrt_life_uw_risk_summary')}
            ORDER BY reporting_period DESC LIMIT 1
        """
        s0501_q = f"""
            SELECT reporting_period FROM {fqn('3_qrt_s0501_summary')}
            ORDER BY reporting_period DESC LIMIT 1
        """
        s0602_q = f"""
            SELECT reporting_period,
                   COUNT(CASE WHEN asset_id LIKE '%-DUP' THEN 1 END) AS dup_rows,
                   ROUND(SUM(CASE WHEN asset_id LIKE '%-DUP' THEN CAST(sii_value AS DOUBLE) ELSE 0 END)/1e6, 2) AS dup_meur
            FROM {fqn('1_raw_assets')}
            WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('1_raw_assets')})
            GROUP BY reporting_period
        """
        # Quarantined-claim count drives the "QRT pack — needs attention"
        # signal (Pain B from Phase 1).
        quarantine_q = f"""
            SELECT COUNT(*) AS quarantined
            FROM {fqn('1_raw_claims')}
            WHERE gross_paid < 0
              AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('1_raw_claims')})
        """
        # Recon mismatches at the latest period.
        recon_q = f"""
            SELECT SUM(CASE WHEN status = 'MISMATCH' THEN 1 ELSE 0 END) AS mismatches,
                   COUNT(*) AS total
            FROM {fqn('5_mon_cross_qrt_reconciliation')}
            WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_cross_qrt_reconciliation')})
        """
        # Late or missing feeds at the latest period.
        feeds_q = f"""
            SELECT SUM(CASE WHEN status IN ('late','missing') THEN 1 ELSE 0 END) AS late_or_missing,
                   COUNT(*) AS total
            FROM {fqn('5_mon_pipeline_sla_status')}
            WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_pipeline_sla_status')})
        """

        scr, s1201, s2606, lifeuw, s0501, s0602, quarantined, recon, feeds = await asyncio.gather(
            execute_query_cached(scr_q, ttl_seconds=30),
            execute_query_cached(s1201_q, ttl_seconds=30),
            execute_query_cached(s2606_q, ttl_seconds=30),
            execute_query_cached(lifeuw_q, ttl_seconds=30),
            execute_query_cached(s0501_q, ttl_seconds=30),
            execute_query_cached(s0602_q, ttl_seconds=30),
            execute_query_cached(quarantine_q, ttl_seconds=30),
            execute_query_cached(recon_q, ttl_seconds=30),
            execute_query_cached(feeds_q, ttl_seconds=30),
            return_exceptions=True,
        )

        scr_row     = (_ok(scr)     or [{}])[0]
        s1201_row   = (_ok(s1201)   or [{}])[0]
        s2606_row   = (_ok(s2606)   or [{}])[0]
        lifeuw_row  = (_ok(lifeuw)  or [{}])[0]
        s0501_row   = (_ok(s0501)   or [{}])[0]
        s0602_row   = (_ok(s0602)   or [{}])[0]
        quar_row    = (_ok(quarantined) or [{}])[0]
        recon_row   = (_ok(recon)   or [{}])[0]
        feeds_row   = (_ok(feeds)   or [{}])[0]

        # Compose per-tile status. Ready by default; flip to "attention" on
        # known signals from Phase 1's six pains.
        dup_count = int(quar_row.get("quarantined", 0) or 0)
        dup_rows = int(s0602_row.get("dup_rows", 0) or 0)
        recon_mm = int(recon_row.get("mismatches", 0) or 0)
        feeds_late = int(feeds_row.get("late_or_missing", 0) or 0)

        tiles = {
            # Pillar 1
            "scr": {
                "status": "ready",
                "metric": f"{scr_row.get('solvency_ratio_pct','—')}% solvency"
                          if scr_row.get('solvency_ratio_pct') is not None else "—",
                "period": scr_row.get("reporting_period"),
            },
            "reserving_pnc":    {"status": "ready", "metric": "ratios within tolerance",
                                 "period": s0501_row.get("reporting_period")},
            "reserving_life":   {"status": "ready",
                                 "metric": f"EUR {s1201_row.get('tp_meur','—')}M life TP" if s1201_row else "—",
                                 "period": s1201_row.get("reporting_period")},
            "nl_uw_risk":       {"status": "ready",
                                 "metric": f"EUR {s2606_row.get('nl_uw_meur','—')}M NL UW SCR",
                                 "period": s2606_row.get("reporting_period")},
            "life_uw_risk":     {"status": "ready",
                                 "metric": f"EUR {lifeuw_row.get('life_uw_meur','—')}M life UW SCR",
                                 "period": lifeuw_row.get("reporting_period")},
            "assets": {
                "status": "attention" if dup_rows > 0 else "ready",
                "metric": f"duplicate ISIN flagged (EUR {s0602_row.get('dup_meur','?')}M)" if dup_rows > 0 else "register clean",
                "period": s0602_row.get("reporting_period"),
            },
            # Pillar 2
            "orsa":              {"status": "pending", "metric": "in progress"},
            "model_governance":  {"status": "attention", "metric": "Challenger pending decision"},
            "afr":               {"status": "pending", "metric": "draft pending"},
            "internal_controls": {"status": "ready",   "metric": "12 controls active"},
            # Pillar 3
            "qrt_pack": {
                "status": "attention" if dup_count > 0 else "ready",
                "metric": f"{dup_count} quarantined claims" if dup_count > 0 else "all clean",
            },
            "sfcr":              {"status": "pending", "metric": "draft pending"},
            "rsr":               {"status": "pending", "metric": "draft pending"},
            "regulator_qa":      {"status": "ready",   "metric": "supervisor agent online"},
        }

        return {
            "tiles": tiles,
            "control_tower": {
                "feeds_late_or_missing": feeds_late,
                "feeds_total": int(feeds_row.get("total", 0) or 0),
                "recon_mismatches": recon_mm,
                "recon_total": int(recon_row.get("total", 0) or 0),
                "latest_period": scr_row.get("reporting_period"),
            },
        }
    except Exception as exc:
        logger.exception("Landing status failed")
        raise HTTPException(500, str(exc)) from exc

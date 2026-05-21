import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request

from server.config import fqn, get_request_user
from server.sql import execute_query, execute_query_cached
from server.ai import generate_review
from server.cache import cache_lookup, cache_persist, make_cache_key, should_use_cache
from server.prompts import DQ_TRIAGE_SYSTEM, DQ_TRIAGE_PROMPT
from server.guardrails import validate_input, validate_output, truncate_output

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fmt_eur(v) -> str:
    f = _safe_float(v)
    return f"EUR {f:,.0f}" if f is not None else "EUR 0"


@router.get("/sla-status")
async def get_sla_status(period: str = Query(None)):
    """Feed arrival status vs SLA deadlines."""
    try:
        where = f"WHERE reporting_period = '{period}'" if period else \
            f"WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_pipeline_sla_status')})"
        rows = await execute_query(f"SELECT * FROM {fqn('5_mon_pipeline_sla_status')} {where} ORDER BY sla_deadline")
        return {"data": rows}
    except Exception as exc:
        logger.exception("Failed to fetch SLA status")
        raise HTTPException(500, str(exc)) from exc


@router.get("/dq-summary")
async def get_dq_summary(period: str = Query(None)):
    """DQ expectation pass/fail rates by pipeline and table."""
    try:
        where = f"WHERE reporting_period = '{period}'" if period else \
            f"WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_dq_expectation_results')})"
        rows = await execute_query(f"""
            SELECT * FROM {fqn('5_mon_dq_expectation_results')} {where}
            ORDER BY pipeline_name, table_name, expectation_name
        """)

        # Also compute aggregates
        agg = await execute_query(f"""
            SELECT
                SUM(total_records) AS total_records,
                SUM(passing_records) AS total_passing,
                SUM(failing_records) AS total_failing,
                ROUND(SUM(passing_records) * 100.0 / NULLIF(SUM(total_records), 0), 1) AS overall_pass_rate,
                COUNT(*) AS total_expectations,
                COUNT(CASE WHEN failing_records > 0 THEN 1 END) AS failing_expectations
            FROM {fqn('5_mon_dq_expectation_results')} {where}
        """)

        return {"data": rows, "aggregate": agg[0] if agg else None}
    except Exception as exc:
        logger.exception("Failed to fetch DQ summary")
        raise HTTPException(500, str(exc)) from exc


@router.get("/dq-trends")
async def get_dq_trends():
    """DQ pass rate trend across all quarters."""
    try:
        rows = await execute_query(f"""
            SELECT
                reporting_period,
                SUM(total_records) AS total_records,
                SUM(passing_records) AS total_passing,
                SUM(failing_records) AS total_failing,
                ROUND(SUM(passing_records) * 100.0 / NULLIF(SUM(total_records), 0), 1) AS pass_rate_pct,
                COUNT(CASE WHEN failing_records > 0 THEN 1 END) AS failing_checks
            FROM {fqn('5_mon_dq_expectation_results')}
            GROUP BY reporting_period
            ORDER BY reporting_period
        """)
        return {"data": rows}
    except Exception as exc:
        logger.exception("Failed to fetch DQ trends")
        raise HTTPException(500, str(exc)) from exc


@router.get("/reconciliation")
async def get_reconciliation(period: str = Query(None)):
    """Cross-QRT reconciliation checks."""
    try:
        where = f"WHERE reporting_period = '{period}'" if period else \
            f"WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_cross_qrt_reconciliation')})"
        rows = await execute_query(f"""
            SELECT * FROM {fqn('5_mon_cross_qrt_reconciliation')} {where}
            ORDER BY check_name
        """)
        return {"data": rows}
    except Exception as exc:
        logger.exception("Failed to fetch reconciliation")
        raise HTTPException(500, str(exc)) from exc


@router.get("/q4-pains")
async def q4_pain_summary():
    """Return one row per Q4 2025 pain with its current signal.

    Drives the Control Tower 'attention items' callout cards. The check
    logic mirrors the SQL paths documented in README "Q4 2025 engineered
    pains" — single source of truth for what counts as 'fired'.
    """
    try:
        # Pain A — late RI feed
        pain_a_q = f"""
            SELECT reporting_period, status, notes, feed_received_timestamp, sla_deadline
            FROM {fqn('5_mon_pipeline_sla_status')}
            WHERE feed_name = '1_raw_reinsurance'
              AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_pipeline_sla_status')})
        """
        # Pain B — quarantined claims (negative paid_amount)
        pain_b_q = f"""
            SELECT COUNT(*) AS n, MIN(system_source) AS source_tag
            FROM {fqn('1_raw_claims')}
            WHERE gross_paid < 0
              AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('1_raw_claims')})
        """
        # Pain C — December storm tagged claims
        pain_c_q = f"""
            SELECT COUNT(*) AS storm_claims,
                   ROUND(SUM(CAST(gross_incurred AS DOUBLE))/1e6, 1) AS storm_incurred_meur
            FROM {fqn('1_raw_claims')}
            WHERE event_id = 'storm_dec_2025'
              AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('1_raw_claims')})
        """
        # Pain D — life lapse delta (Q4 vs Q3)
        pain_d_q = f"""
            SELECT reporting_period,
                   ROUND(SUM(lapsed_in_quarter) * 100.0 / NULLIF(SUM(in_force_at_quarter_start), 0), 3) AS lapse_pct
            FROM {fqn('1_raw_life_lapses')}
            WHERE lob_name = 'unit_linked'
            GROUP BY reporting_period
            ORDER BY reporting_period DESC LIMIT 2
        """
        # Pain E — duplicate -DUP asset rows
        pain_e_q = f"""
            SELECT COUNT(*) AS dup_rows,
                   ROUND(SUM(CAST(sii_value AS DOUBLE)), 2) AS dup_eur
            FROM {fqn('1_raw_assets')}
            WHERE asset_id LIKE '%-DUP'
              AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('1_raw_assets')})
        """
        # Pain F — Champion vs Challenger model registry
        pain_f_q = f"""
            SELECT model_version, calibration_year FROM {fqn('5_mon_model_registry_log')}
            ORDER BY model_version DESC LIMIT 5
        """
        # Pain G — reserve-capital divergence (storm overlay applied to reserving model
        # but capital model is on prior quarter's parameter; SCR understated)
        pain_g_q = f"""
            SELECT difference, status, source_qrt, target_qrt
            FROM {fqn('5_mon_cross_qrt_reconciliation')}
            WHERE check_name = 'reserve_capital_divergence'
              AND reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_cross_qrt_reconciliation')})
        """

        a, b, c, d, e, f, g = await asyncio.gather(
            execute_query_cached(pain_a_q, ttl_seconds=30),
            execute_query_cached(pain_b_q, ttl_seconds=30),
            execute_query_cached(pain_c_q, ttl_seconds=30),
            execute_query_cached(pain_d_q, ttl_seconds=30),
            execute_query_cached(pain_e_q, ttl_seconds=30),
            execute_query_cached(pain_f_q, ttl_seconds=120),
            execute_query_cached(pain_g_q, ttl_seconds=60),
            return_exceptions=True,
        )

        def _row(r, default=None):
            if isinstance(r, Exception):
                return default or {}
            arr = r or []
            return arr[0] if arr else (default or {})

        a_row = _row(a, {})
        b_row = _row(b, {})
        c_row = _row(c, {})
        d_rows = b if False else (d if not isinstance(d, Exception) else [])
        e_row = _row(e, {})
        g_row = _row(g, {})

        # Pain D delta: Q4 lapse vs Q3 lapse
        lapse_q4 = float(d_rows[0].get("lapse_pct", 0) or 0) if len(d_rows) >= 1 else 0
        lapse_q3 = float(d_rows[1].get("lapse_pct", 0) or 0) if len(d_rows) >= 2 else 0
        lapse_uplift_pct = round((lapse_q4 - lapse_q3) / lapse_q3 * 100, 1) if lapse_q3 > 0 else None

        pains = [
            {
                "id": "A", "category": "ingestion",
                "title": "Reinsurance feed late",
                "fired": a_row.get("status") == "late",
                "severity": "high" if a_row.get("status") == "late" else "ok",
                "headline": (a_row.get("notes") or "—") if a_row.get("status") == "late" else "RI feed on time",
                "drill_path": "/feeds/1_raw_reinsurance",
                "context": {"period": a_row.get("reporting_period"), "received": a_row.get("feed_received_timestamp")},
            },
            {
                "id": "B", "category": "ingestion",
                "title": "Quarantined claims (DQ break)",
                "fired": int(b_row.get("n", 0) or 0) > 0,
                "severity": "high" if int(b_row.get("n", 0) or 0) > 0 else "ok",
                "headline": (
                    f"{b_row.get('n', 0)} negative paid_amount rows tagged {b_row.get('source_tag','?')}"
                    if int(b_row.get("n", 0) or 0) > 0 else "no quarantined rows"
                ),
                "drill_path": "/data-quality",
                "context": {},
            },
            {
                "id": "C", "category": "reserving",
                "title": "December storm — property reserve spike",
                "fired": int(c_row.get("storm_claims", 0) or 0) > 0,
                "severity": "warn" if int(c_row.get("storm_claims", 0) or 0) > 0 else "ok",
                "headline": (
                    f"{c_row.get('storm_claims', 0)} storm-tagged claims · EUR {c_row.get('storm_incurred_meur', 0)}M incurred"
                    if int(c_row.get("storm_claims", 0) or 0) > 0 else "no storm event"
                ),
                "drill_path": "/nl-uw-risk",
                "context": {},
            },
            {
                "id": "D", "category": "reserving",
                "title": "Life lapse deterioration (unit-linked)",
                "fired": (lapse_uplift_pct or 0) > 20,
                "severity": "warn" if (lapse_uplift_pct or 0) > 20 else "ok",
                "headline": (
                    f"unit-linked lapse {lapse_q4}% vs {lapse_q3}% prior quarter (+{lapse_uplift_pct}%)"
                    if lapse_uplift_pct is not None else "no lapse data"
                ),
                "drill_path": "/life-uw-risk",
                "context": {"q4_pct": lapse_q4, "q3_pct": lapse_q3, "uplift_pct": lapse_uplift_pct},
            },
            {
                "id": "E", "category": "reconciliation",
                "title": "Asset / own-funds reconciliation gap",
                "fired": int(e_row.get("dup_rows", 0) or 0) > 0,
                "severity": "high" if int(e_row.get("dup_rows", 0) or 0) > 0 else "ok",
                "headline": (
                    f"duplicate ISIN custodian row of {_fmt_eur(e_row.get('dup_eur'))} not in own funds"
                    if int(e_row.get("dup_rows", 0) or 0) > 0 else "no duplicates"
                ),
                "drill_path": "/assets",
                "context": {"dup_eur": e_row.get("dup_eur")},
            },
            {
                "id": "F", "category": "model_governance",
                "title": "Challenger model pending decision",
                "fired": True,  # always relevant: surfacing the +4% delta to be reviewed
                "severity": "warn",
                "headline": "2026 calibration: NL UW correlation +1.5%, op risk to 4.0%, life lapse stress ×1.15 → ≈+4% SCR",
                "drill_path": "/model-governance",
                "context": {"model": "standard_formula"},
            },
            {
                "id": "G", "category": "reconciliation",
                "title": "Reserve-capital divergence",
                "fired": (g_row.get("status") == "MISMATCH"),
                "severity": "high" if g_row.get("status") == "MISMATCH" else "ok",
                "headline": (
                    f"capital model on prior-quarter reserving parameter — SCR understated by {_fmt_eur(g_row.get('difference'))}"
                    if g_row.get("status") == "MISMATCH"
                    else "reserving + capital parameters aligned"
                ),
                "drill_path": "/lab",
                "context": {"divergence_eur": g_row.get("difference")},
            },
            {
                "id": "H", "category": "model_governance",
                "title": "Stochastic candidate awaiting actuarial review",
                "fired": True,
                "severity": "warn",
                "headline": "Igloo Q4 cat output +12% vs prior quarter — outside normal volatility band, cat agent recommendation pending",
                "drill_path": "/lab/igloo_cat",
                "context": {"engine": "igloo_cat"},
            },
        ]
        return {"pains": pains}
    except Exception as exc:
        logger.exception("Q4 pain summary failed")
        raise HTTPException(500, str(exc)) from exc


@router.get("/model-versions")
async def get_model_versions(period: str = Query(None)):
    """Model version comparison — Champion vs Challenger."""
    try:
        where = f"WHERE reporting_period = '{period}'" if period else \
            f"WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_model_registry_log')})"
        rows = await execute_query(f"""
            SELECT * FROM {fqn('5_mon_model_registry_log')} {where}
            ORDER BY model_version
        """)
        return {"data": rows}
    except Exception as exc:
        logger.exception("Failed to fetch model versions")
        raise HTTPException(500, str(exc)) from exc


# ── Feed Detail ──────────────────────────────────────────────────────────────

# Ownership / escalation chain per feed. Used by the Ownership tab on the feed
# detail drilldown so a user clicking a late feed knows who to chase.
OWNERSHIP_MAP: dict[str, dict[str, str]] = {
    "1_raw_reinsurance": {
        "source_party":         "Munich Re (broker: Aon)",
        "owner_contact_name":   "Anja Vogel",
        "owner_contact_role":   "Senior Treaty Administrator, Munich",
        "owner_contact_email":  "anja.vogel@munichre.example.com",
        "internal_owner":       "Carlos Mendes — Head of Reinsurance Operations",
        "internal_owner_email": "carlos.mendes@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+3 second auto-email · D+5 third auto-email · D+6 Slack to #broker-aon · D+7 Head of RI ops · D+8+ CFO + regulator notification",
        "sla_text":             "3 business days after quarter close",
    },
    "1_raw_assets": {
        "source_party":         "ABN AMRO Custody Services",
        "owner_contact_name":   "Janusz Kowalski",
        "owner_contact_role":   "Custody Operations Lead, Amsterdam",
        "owner_contact_email":  "janusz.kowalski@abnamro.example.com",
        "internal_owner":       "Investment Operations team",
        "internal_owner_email": "investment-ops@bricksurance.example.com",
        "escalation_chain":     "Mon 08:15 auto-email · Mon 11:00 Slack ops · D+2 Head of Investment Ops · D+3 CRO + regulator notification",
        "sla_text":             "Friday 18:00 CET weekly · 2 business days after quarter close",
    },
    "1_raw_counterparties": {
        "source_party":         "Bloomberg + S&P Capital IQ",
        "owner_contact_name":   "Maria Petrova",
        "owner_contact_role":   "Market Data Manager",
        "owner_contact_email":  "maria.petrova@bricksurance.example.com",
        "internal_owner":       "Market Data team",
        "internal_owner_email": "marketdata@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 vendor support ticket · D+3 Head of Market Data",
        "sla_text":             "Daily 06:00 CET",
    },
    "1_raw_balance_sheet": {
        "source_party":         "Bricksurance Finance (SAP)",
        "owner_contact_name":   "Tomasz Wojcik",
        "owner_contact_role":   "Group Financial Reporting Lead",
        "owner_contact_email":  "tomasz.wojcik@bricksurance.example.com",
        "internal_owner":       "Group Finance",
        "internal_owner_email": "group-finance@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Slack #finance-close · D+3 Group CFO",
        "sla_text":             "5 business days after quarter close",
    },
    "1_raw_premiums": {
        "source_party":         "Bricksurance PAS",
        "owner_contact_name":   "Internal — PAS Operations",
        "owner_contact_role":   "PAS Operations",
        "owner_contact_email":  "pas-ops@bricksurance.example.com",
        "internal_owner":       "PAS Operations team",
        "internal_owner_email": "pas-ops@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Slack #pas-ops · D+3 Head of Operations",
        "sla_text":             "2 business days after quarter close",
    },
    "1_raw_claims": {
        "source_party":         "Bricksurance Claims Administration",
        "owner_contact_name":   "Internal — Claims Operations",
        "owner_contact_role":   "Claims Operations",
        "owner_contact_email":  "claims-ops@bricksurance.example.com",
        "internal_owner":       "Claims Operations team",
        "internal_owner_email": "claims-ops@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Slack #claims-ops · D+3 Head of Claims",
        "sla_text":             "2 business days after quarter close",
    },
    "1_raw_expenses": {
        "source_party":         "Bricksurance Finance (cost-allocation engine)",
        "owner_contact_name":   "Tomasz Wojcik",
        "owner_contact_role":   "Group Financial Reporting Lead",
        "owner_contact_email":  "tomasz.wojcik@bricksurance.example.com",
        "internal_owner":       "Group Finance — expense allocation",
        "internal_owner_email": "expense-allocation@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Slack #finance-close · D+3 Group CFO",
        "sla_text":             "5 business days after quarter close",
    },
    "1_raw_risk_factors": {
        "source_party":         "EIOPA risk-free rate + Bloomberg market data",
        "owner_contact_name":   "Internal — Market Data team",
        "owner_contact_role":   "Market Data team",
        "owner_contact_email":  "marketdata@bricksurance.example.com",
        "internal_owner":       "Market Data team",
        "internal_owner_email": "marketdata@bricksurance.example.com",
        "escalation_chain":     "EIOPA publishes monthly · vendor ticket if outage",
        "sla_text":             "Monthly · within 5 days of EIOPA publication",
    },
    "1_raw_exposures": {
        "source_party":         "Bricksurance Underwriting platform",
        "owner_contact_name":   "Internal — Underwriting Ops",
        "owner_contact_role":   "Underwriting Operations",
        "owner_contact_email":  "uw-ops@bricksurance.example.com",
        "internal_owner":       "Underwriting Operations team",
        "internal_owner_email": "uw-ops@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Slack #uw-ops · D+3 Head of Underwriting",
        "sla_text":             "2 business days after quarter close",
    },
    "1_raw_volume_measures": {
        "source_party":         "Bricksurance Underwriting platform",
        "owner_contact_name":   "Internal — Underwriting Ops",
        "owner_contact_role":   "Underwriting Operations",
        "owner_contact_email":  "uw-ops@bricksurance.example.com",
        "internal_owner":       "Underwriting Operations team",
        "internal_owner_email": "uw-ops@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Slack #uw-ops · D+3 Head of Underwriting",
        "sla_text":             "2 business days after quarter close",
    },
    "1_raw_own_funds": {
        "source_party":         "Bricksurance Treasury",
        "owner_contact_name":   "Internal — Treasury",
        "owner_contact_role":   "Treasury Operations",
        "owner_contact_email":  "treasury@bricksurance.example.com",
        "internal_owner":       "Treasury team",
        "internal_owner_email": "treasury@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+3 Group CFO",
        "sla_text":             "5 business days after quarter close",
    },
    "1_raw_claims_triangles": {
        "source_party":         "Bricksurance Claims Administration",
        "owner_contact_name":   "Internal — Reserving team",
        "owner_contact_role":   "Reserving Operations",
        "owner_contact_email":  "reserving@bricksurance.example.com",
        "internal_owner":       "Reserving team (Senior Reserving Actuary)",
        "internal_owner_email": "reserving@bricksurance.example.com",
        "escalation_chain":     "D+1 auto-email · D+2 Senior Reserving Actuary · D+3 Chief Actuary",
        "sla_text":             "3 business days after quarter close",
    },
}


def _ownership_for(feed_name: str) -> dict[str, str]:
    return OWNERSHIP_MAP.get(feed_name, {
        "source_party":         "Internal / unspecified",
        "owner_contact_name":   "—",
        "owner_contact_role":   "—",
        "owner_contact_email":  "—",
        "internal_owner":       "See feed catalog (6_demo_data_feeds) for owner mapping.",
        "internal_owner_email": "—",
        "escalation_chain":     "—",
        "sla_text":             "—",
    })


# Map feed names to their source raw table and the DQ pipeline/table they flow through
FEED_MAP = {
    "1_raw_assets": {"table": "1_raw_assets", "dq_pipeline": "S.06.02 List of Assets", "dq_tables": ["2_stg_assets_enriched", "3_qrt_s0602_list_of_assets"]},
    "1_raw_premiums": {"table": "1_raw_premiums", "dq_pipeline": "S.05.01 Premiums Claims Expenses", "dq_tables": ["2_stg_premiums_by_lob", "3_qrt_s0501_summary"]},
    "1_raw_claims": {"table": "1_raw_claims", "dq_pipeline": "S.05.01 Premiums Claims Expenses", "dq_tables": ["2_stg_claims_by_lob", "3_qrt_s0501_summary"]},
    "1_raw_expenses": {"table": "1_raw_expenses", "dq_pipeline": "S.05.01 Premiums Claims Expenses", "dq_tables": ["2_stg_expenses_by_lob"]},
    "1_raw_risk_factors": {"table": "1_raw_risk_factors", "dq_pipeline": "S.25.01 SCR Template", "dq_tables": ["3_qrt_s2501_scr_breakdown", "3_qrt_s2501_summary"]},
    "1_raw_exposures": {"table": "1_raw_exposures", "dq_pipeline": "S.26.06 NL UW Risk Template", "dq_tables": ["4_eng_stochastic_results"]},
    "1_raw_reinsurance": {"table": "1_raw_reinsurance", "dq_pipeline": "S.26.06 NL UW Risk Template", "dq_tables": ["2_stg_cat_risk_by_lob"]},
    "1_raw_counterparties": {"table": "1_raw_counterparties", "dq_pipeline": "S.06.02 List of Assets", "dq_tables": ["2_stg_assets_enriched"]},
    "1_raw_balance_sheet": {"table": "1_raw_balance_sheet", "dq_pipeline": "S.06.02 List of Assets", "dq_tables": ["2_stg_assets_enriched"]},
    "1_raw_volume_measures": {"table": "1_raw_volume_measures", "dq_pipeline": "S.26.06 NL UW Risk Template", "dq_tables": ["2_stg_premium_reserve_risk"]},
    "1_raw_own_funds": {"table": "1_raw_own_funds", "dq_pipeline": "S.25.01 SCR Template", "dq_tables": ["3_qrt_s2501_summary"]},
    "1_raw_claims_triangles": {"table": "1_raw_claims_triangles", "dq_pipeline": "S.05.01 Premiums Claims Expenses", "dq_tables": ["2_stg_claims_by_lob"]},
}


@router.get("/feed-detail/{feed_name}")
async def get_feed_detail(feed_name: str):
    """Detailed view of a data feed: freshness history, completeness, DQ rules, sample data."""
    try:
        feed_info = FEED_MAP.get(feed_name, {"table": feed_name, "dq_pipeline": "", "dq_tables": []})
        table = feed_info["table"]

        freshness_q = f"""
            SELECT reporting_period, feed_name, actual_arrival, sla_deadline,
                   status, row_count, dq_pass_rate, notes
            FROM {fqn('5_mon_pipeline_sla_status')}
            WHERE feed_name = '{feed_name}'
            ORDER BY reporting_period DESC
        """
        # Period-aware completeness. For tables without reporting_period
        # (e.g. static treaty data like 1_raw_reinsurance), fall back to a
        # single-bucket total row count.
        completeness_q = f"""
            SELECT CAST(reporting_period AS STRING) AS reporting_period,
                   COUNT(*) AS row_count
            FROM {fqn(table)}
            GROUP BY reporting_period
            ORDER BY reporting_period DESC
        """
        completeness_fallback_q = f"""
            SELECT 'all' AS reporting_period, COUNT(*) AS row_count
            FROM {fqn(table)}
        """
        # DQ rule NAMES only — counts are derived from the SLA row's
        # row_count + dq_pass_rate below so the drill-down always agrees
        # with the FeedCard summary numerically.
        dq_rule_names_q = f"""
            SELECT DISTINCT expectation_name, table_name
            FROM {fqn('5_mon_dq_expectation_results')}
            WHERE pipeline_name LIKE '%{feed_info["dq_pipeline"]}%'
            ORDER BY table_name, expectation_name
        """
        # Period-aware sample. Fall back to plain LIMIT for non-period tables.
        sample_q = f"""
            SELECT * FROM {fqn(table)}
            WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn(table)})
            LIMIT 20
        """
        sample_fallback_q = f"SELECT * FROM {fqn(table)} LIMIT 20"
        columns_q = f"DESCRIBE {fqn(table)}"

        # Run all 5 queries concurrently. Wrap with return_exceptions so individual
        # missing-table failures don't sink the whole request.
        freshness_r, completeness_r, dq_rule_names_r, sample_r, columns_r = await asyncio.gather(
            execute_query_cached(freshness_q, ttl_seconds=30),
            execute_query_cached(completeness_q, ttl_seconds=30),
            execute_query_cached(dq_rule_names_q, ttl_seconds=300) if feed_info["dq_pipeline"] else asyncio.sleep(0, result=[]),
            execute_query_cached(sample_q, ttl_seconds=30),
            execute_query_cached(columns_q, ttl_seconds=300),
            return_exceptions=True,
        )

        def _ok(x):
            return [] if isinstance(x, Exception) else x

        freshness = _ok(freshness_r)
        completeness = _ok(completeness_r)
        dq_rule_names = _ok(dq_rule_names_r)
        sample = _ok(sample_r)
        columns = _ok(columns_r)

        # ── DQ Rules: derive totals from the SLA row's row_count + dq_pass_rate.
        # Single source of truth for the drill-down. Rule names come from the
        # seed table so 'gross_incurred_positive' etc. still look authentic.
        live_row = freshness[0] if freshness else {}
        try:
            live_total = int(float(live_row.get("row_count") or 0))
        except (TypeError, ValueError):
            live_total = 0
        try:
            live_pass = float(live_row.get("dq_pass_rate") or 1.0)
        except (TypeError, ValueError):
            live_pass = 1.0
        total_failing = round(live_total * max(0.0, 1.0 - live_pass))

        # Which named rule bears the failures for each feed. If a feed
        # has dq_pass_rate < 1.0 but no mapping, the failures land on the
        # first rule alphabetically so the maths still add up.
        FAILING_RULE_BY_FEED: dict[str, tuple[str, str]] = {
            "1_raw_claims": ("2_stg_claims_by_lob", "gross_incurred_positive"),
        }
        failing_target = FAILING_RULE_BY_FEED.get(feed_name)
        if total_failing > 0 and failing_target is None and dq_rule_names:
            first = dq_rule_names[0]
            failing_target = (first.get("table_name", ""), first.get("expectation_name", ""))

        dq_rules: list[dict] = []
        for rule in dq_rule_names:
            tn = rule.get("table_name", "")
            en = rule.get("expectation_name", "")
            is_failing = (
                total_failing > 0
                and failing_target is not None
                and tn == failing_target[0]
                and en == failing_target[1]
            )
            failing = total_failing if is_failing else 0
            passing = max(0, live_total - failing)
            pass_rate_pct = round(passing * 100.0 / live_total, 1) if live_total > 0 else 100.0
            dq_rules.append({
                "expectation_name": en,
                "table_name": tn,
                "total_records": live_total,
                "passing_records": passing,
                "failing_records": failing,
                "pass_rate_pct": pass_rate_pct,
            })

        # If the table has no reporting_period column, the period-aware
        # queries return empty (or raise). For completeness, prefer the
        # per-period row_count history from 5_mon_pipeline_sla_status — that
        # gives 3-4 prior uploads for trend comparison instead of one bucket.
        # Sample falls back to a plain LIMIT.
        has_period = any(c.get("col_name") == "reporting_period" for c in columns)
        if not has_period:
            try:
                completeness = await execute_query_cached(
                    f"""
                    SELECT reporting_period, row_count
                    FROM {fqn('5_mon_pipeline_sla_status')}
                    WHERE feed_name = '{feed_name}'
                    ORDER BY reporting_period DESC
                    """,
                    ttl_seconds=30,
                )
            except Exception:
                completeness = []
            if not completeness:
                try:
                    completeness = await execute_query_cached(completeness_fallback_q, ttl_seconds=30)
                except Exception:
                    completeness = []
            try:
                sample = await execute_query_cached(sample_fallback_q, ttl_seconds=30)
            except Exception:
                sample = []

        # Compute period-over-period change
        for i, row in enumerate(completeness):
            current = int(row.get("row_count", 0))
            if i + 1 < len(completeness):
                prev = int(completeness[i + 1].get("row_count", 0))
                change_pct = round((current - prev) / prev * 100, 1) if prev > 0 else 0
                row["prev_row_count"] = str(prev)
                row["change_pct"] = str(change_pct)
            else:
                row["prev_row_count"] = None
                row["change_pct"] = None

        return {
            "feed_name": feed_name,
            "table": table,
            "pipeline": feed_info["dq_pipeline"],
            "freshness": freshness,
            "completeness": completeness,
            "dq_rules": dq_rules,
            "sample": sample,
            "columns": columns,
            "ownership": _ownership_for(feed_name),
        }

    except Exception as exc:
        logger.exception("Failed to fetch feed detail for %s", feed_name)
        raise HTTPException(500, str(exc)) from exc


# ── Reconciliation Detail + AI Investigation ─────────────────────────────────

@router.post("/recon-investigate")
async def investigate_reconciliation(request: Request, body: dict = {}):
    """AI investigates a specific reconciliation mismatch."""
    user = get_request_user(request)
    check_name = body.get("check_name", "")

    # Cache lookup — keyed by check_name. Returns instantly if pre-baked.
    cache_key = make_cache_key("recon_investigate", check_name)
    if should_use_cache(request):
        cached = await cache_lookup(cache_key)
        if cached:
            return cached

    try:
        # Get the specific check
        where = f"WHERE reporting_period = (SELECT MAX(reporting_period) FROM {fqn('5_mon_cross_qrt_reconciliation')})"
        all_checks = await execute_query(f"""
            SELECT * FROM {fqn('5_mon_cross_qrt_reconciliation')} {where}
        """)

        target_check = None
        for c in all_checks:
            if c.get("check_name") == check_name:
                target_check = c
                break

        if not target_check:
            target_check = all_checks[0] if all_checks else {}

        reporting_period = target_check.get("reporting_period", "Unknown")

        # Get relevant QRT summaries for context — fan out concurrently
        summary_tables = ["3_qrt_s0602_summary", "3_qrt_s0501_summary", "3_qrt_s2501_summary", "3_qrt_s2606_summary"]
        summary_results = await asyncio.gather(
            *[execute_query_cached(
                f"SELECT * FROM {fqn(t)} WHERE reporting_period = '{reporting_period}'",
                ttl_seconds=60,
            ) for t in summary_tables],
            return_exceptions=True,
        )
        summaries = {
            t: ([] if isinstance(r, Exception) else r)
            for t, r in zip(summary_tables, summary_results)
        }

        user_prompt = f"""Investigate this cross-QRT reconciliation issue for Bricksurance SE.
Reporting period: {reporting_period}.

## The Mismatch
Check: {target_check.get('check_name', '?')}
Description: {target_check.get('check_description', '?')}
Source QRT: {target_check.get('source_qrt', '?')} — Value: {target_check.get('source_value', '?')}
Target QRT: {target_check.get('target_qrt', '?')} — Value: {target_check.get('target_value', '?')}
Difference: {target_check.get('difference', '?')}
Tolerance: {target_check.get('tolerance', '?')}
Status: {target_check.get('status', '?')}

## All Reconciliation Checks (for context)
{json.dumps(all_checks, indent=2, default=str)}

## QRT Summaries
{json.dumps(summaries, indent=2, default=str)}

Explain WHY this mismatch exists. Consider:
- Is it a data issue, a timing difference, a methodology difference, or expected?
- Which specific numbers drive the gap?
- Is this blocking for submission or acceptable with a note?
- What remediation (if any) is needed?"""

        system_prompt = """You are a senior actuarial analyst investigating a cross-QRT reconciliation issue.
Explain the root cause of the mismatch in plain language. Be specific about which numbers don't match and why.
Output in markdown: ## Root Cause, ## Impact Assessment, ## Recommendation."""

        # Guardrails
        input_verdict = validate_input(user_prompt, user)
        if not input_verdict.passed:
            status_code = 429 if input_verdict.rate_limited else 400
            raise HTTPException(status_code, {"error": "Input guardrail failed", "guardrails": input_verdict.to_dict()})

        result = await generate_review(system_prompt, user_prompt, agent_name="recon_investigate")
        output_verdict = validate_output(result.text)
        review_text = truncate_output(result.text)

        response = {
            "check": target_check,
            "review_text": review_text,
            "model_used": result.model_used,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "guardrails": {
                "passed": input_verdict.passed and output_verdict.passed,
                "checks_run": input_verdict.checks_run + output_verdict.checks_run,
                "checks_passed": input_verdict.checks_passed + output_verdict.checks_passed,
                "checks_failed": input_verdict.checks_failed + output_verdict.checks_failed,
                "warnings": input_verdict.warnings + output_verdict.warnings,
                "failures": input_verdict.failures + output_verdict.failures,
                "pii_flags": output_verdict.pii_flags,
                "output_truncated": output_verdict.output_truncated,
                "rate_limited": input_verdict.rate_limited,
            },
        }
        # Persist for subsequent ?cached=1 / DEMO_MODE=cached lookups.
        try:
            await cache_persist(
                cache_key, "recon_investigate", check_name,
                target_check.get("reporting_period"), response, user=user,
            )
        except Exception:
            logger.debug("cache_persist (recon) skipped", exc_info=True)
        return response

    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.exception("Recon investigation failed")
        raise HTTPException(500, f"Investigation failed: {str(exc)}") from exc


# ── Agent #3: DQ Triage ─────────────────────────────────────────────────────

@router.post("/dq-investigate")
async def investigate_dq_failures(request: Request):
    """AI agent investigates data quality failures and hypothesises root causes."""
    user = get_request_user(request)

    try:
        # Get latest period
        period_rows = await execute_query(f"""
            SELECT MAX(reporting_period) AS p FROM {fqn('5_mon_dq_expectation_results')}
        """)
        reporting_period = period_rows[0]["p"] if period_rows else "Unknown"

        # Get all DQ results
        all_checks = await execute_query(f"""
            SELECT * FROM {fqn('5_mon_dq_expectation_results')}
            WHERE reporting_period = '{reporting_period}'
            ORDER BY pipeline_name, table_name
        """)

        # Filter to failing only
        failing_checks = [c for c in all_checks if int(c.get("failing_records", 0)) > 0]

        if not failing_checks:
            return {
                "review_text": "## All Clear\n\nNo data quality failures detected for the current reporting period. All DLT expectations are passing.",
                "model_used": "none",
                "guardrails": {"passed": True, "checks_run": 0, "checks_passed": 0, "checks_failed": 0, "warnings": [], "failures": [], "pii_flags": [], "output_truncated": False, "rate_limited": False},
            }

        # Get SLA data for context
        try:
            sla_rows = await execute_query(f"""
                SELECT * FROM {fqn('5_mon_pipeline_sla_status')}
                WHERE reporting_period = '{reporting_period}'
            """)
        except Exception:
            sla_rows = []

        def fmt(rows):
            return json.dumps(rows, indent=2, default=str) if rows else "No data available."

        user_prompt = DQ_TRIAGE_PROMPT.format(
            entity_name="Bricksurance SE",
            reporting_period=reporting_period,
            failing_checks=fmt(failing_checks),
            all_checks=fmt(all_checks),
            sla_data=fmt(sla_rows),
        )

        # Guardrails
        input_verdict = validate_input(user_prompt, user)
        if not input_verdict.passed:
            status_code = 429 if input_verdict.rate_limited else 400
            raise HTTPException(status_code, {"error": "Input guardrail failed", "guardrails": input_verdict.to_dict()})

        result = await generate_review(DQ_TRIAGE_SYSTEM, user_prompt, agent_name="dq_triage")
        output_verdict = validate_output(result.text)
        review_text = truncate_output(result.text)

        return {
            "reporting_period": reporting_period,
            "failing_count": len(failing_checks),
            "review_text": review_text,
            "model_used": result.model_used,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "guardrails": {
                "passed": input_verdict.passed and output_verdict.passed,
                "checks_run": input_verdict.checks_run + output_verdict.checks_run,
                "checks_passed": input_verdict.checks_passed + output_verdict.checks_passed,
                "checks_failed": input_verdict.checks_failed + output_verdict.checks_failed,
                "warnings": input_verdict.warnings + output_verdict.warnings,
                "failures": input_verdict.failures + output_verdict.failures,
                "pii_flags": output_verdict.pii_flags,
                "output_truncated": output_verdict.output_truncated,
                "rate_limited": input_verdict.rate_limited,
            },
        }

    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.exception("DQ triage failed")
        raise HTTPException(500, f"DQ investigation failed: {str(exc)}") from exc

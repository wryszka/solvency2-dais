#!/usr/bin/env python3
"""Phase 5 narrative-staging seed.

Creates and populates the tables the eight-scene demo runs against:
  - 6_demo_data_feeds        — feed metadata incl. the late ABN AMRO custodian feed
  - 6_demo_event_log         — external storm / event log (Storm Henrik 16-18 Dec + history)
  - 6_demo_solvency_daily    — 90 days of daily solvency ratios with explainable inflections
  - 6_demo_cyber_book        — current cyber book reference (GWP / loss ratio / RI structure)
  - 6_demo_orsa_history      — 30 days of standing-stress projection drift
  - 6_demo_sf_challenger     — SF Challenger approval state (Laurence + Sarah + Michael)
  - 6_demo_whatif_runs       — what-if scenario history (Scene 6)

Idempotent: clears + re-inserts. Run after generate_data + seed_governance.
"""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any

PROFILE = os.environ.get("DATABRICKS_PROFILE", "DEV")
CATALOG = os.environ.get("CATALOG", "lr_dev_aws_us_catalog")
SCHEMA = os.environ.get("SCHEMA", "solvency2demo_v2")
WAREHOUSE_ID = os.environ.get("WAREHOUSE_ID", "a3b61648ea4809e3")


def fqn(t: str) -> str:
    return f"`{CATALOG}`.`{SCHEMA}`.`{t}`"


def run_sql(stmt: str) -> dict:
    payload = {"warehouse_id": WAREHOUSE_ID, "statement": stmt, "wait_timeout": "30s"}
    r = subprocess.run(
        ["databricks", "api", "post", "/api/2.0/sql/statements",
         "--profile", PROFILE, "--json", json.dumps(payload)],
        capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        raise SystemExit(f"databricks CLI failed: {r.stderr}\n{stmt[:200]}")
    return json.loads(r.stdout)


def assert_succeeded(res: dict, label: str) -> None:
    state = res.get("status", {}).get("state", "?")
    if state != "SUCCEEDED":
        err = res.get("status", {}).get("error", {}).get("message", res)
        raise SystemExit(f"{label} failed: state={state}\n{err}")


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return f"CAST('{v.strftime('%Y-%m-%d %H:%M:%S')}' AS TIMESTAMP)"
    if isinstance(v, list):
        return "array(" + ",".join(lit(x) for x in v) + ")"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def insert_rows(table: str, columns: list[str], rows: list[tuple]) -> None:
    if not rows:
        print(f"  (no rows for {table})")
        return
    BATCH = 50
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        values = ",\n".join("(" + ",".join(lit(v) for v in row) + ")" for row in batch)
        stmt = f"INSERT INTO {fqn(table)} ({','.join(columns)}) VALUES\n{values}"
        res = run_sql(stmt)
        assert_succeeded(res, f"insert {table} batch")
    print(f"  + {len(rows):>3} rows → {table}")


# ── DDL ─────────────────────────────────────────────────────────────────────

DDL = [
    ("6_demo_data_feeds", """
        feed_name STRING, source_system STRING, source_party STRING,
        owner_contact_name STRING, owner_contact_role STRING, owner_contact_email STRING,
        expected_at TIMESTAMP, received_at TIMESTAMP, status STRING,
        last_contact_at TIMESTAMP, last_contact_method STRING, last_contact_notes STRING,
        eta_at TIMESTAMP, blocks_qrts ARRAY<STRING>, stale_models ARRAY<STRING>,
        recon_phantom_eur DOUBLE, notes STRING, reporting_period STRING
    """),
    ("6_demo_event_log", """
        event_id STRING, event_name STRING, event_type STRING,
        start_date DATE, end_date DATE, region STRING,
        peak_intensity DOUBLE, peak_intensity_unit STRING,
        affected_lobs ARRAY<STRING>, modelled_aal_eur_m DOUBLE,
        notes STRING
    """),
    ("6_demo_solvency_daily", """
        observed_date DATE, ratio_pct DOUBLE,
        scr_eur DOUBLE, own_funds_eur DOUBLE,
        delta_vs_prior_pp DOUBLE, driver STRING, driver_class STRING
    """),
    ("6_demo_cyber_book", """
        as_of_date DATE, gwp_eur DOUBLE, loss_ratio DOUBLE,
        reinsurance_qs_pct DOUBLE, reinsurance_xol_attach_eur DOUBLE,
        scr_allocation_eur DOUBLE, accounts_smalmedium_pct DOUBLE,
        notes STRING
    """),
    ("6_demo_orsa_history", """
        observed_date DATE, scenario_id STRING, scenario_name STRING,
        year_offset INT, projection_year INT, ratio_pct DOUBLE,
        scr_eur DOUBLE, own_funds_eur DOUBLE, run_label STRING
    """),
    ("6_demo_sf_challenger", """
        challenger_version STRING, calibration_label STRING,
        submitted_by STRING, submitted_role STRING, submitted_at TIMESTAMP,
        approver_name STRING, approver_role STRING, approver_status STRING,
        approver_oo_until DATE, deputy_name STRING, deputy_role STRING,
        deputy_status STRING, reminders_sent INT, last_reminder_at TIMESTAMP,
        scr_delta_pct DOUBLE, ratio_before_pct DOUBLE, ratio_after_pct DOUBLE,
        methodology_changes ARRAY<STRING>, current_state STRING,
        promoted_at TIMESTAMP, promoted_by STRING
    """),
    ("6_demo_whatif_runs", """
        run_id STRING, scenario_label STRING, scenario_payload_json STRING,
        result_json STRING, narrative STRING, second_opinion STRING,
        ran_at TIMESTAMP, ran_by STRING
    """),
    ("gold_orsa_draft", """
        version INT, section_id STRING, section_title STRING,
        body_markdown STRING, status STRING,
        last_quantitative_refresh TIMESTAMP, last_narrative_review TIMESTAMP,
        order_index INT, generated_by STRING
    """),
]


def ensure_tables() -> None:
    for tbl, schema in DDL:
        run_sql(f"CREATE TABLE IF NOT EXISTS {fqn(tbl)} ({schema}) USING DELTA")
    print(f"  ✓ {len(DDL)} demo tables ensured")


# ── Seed data ───────────────────────────────────────────────────────────────

NOW = datetime(2025, 12, 8, 12, 0, 0, tzinfo=timezone.utc)


def seed_data_feeds() -> None:
    expected_friday = datetime(2025, 12, 5, 17, 0, 0, tzinfo=timezone.utc)        # 18:00 CET = 17:00 UTC
    received_monday = datetime(2025, 12, 8,  8, 47, 0, tzinfo=timezone.utc)       # 09:47 CET
    last_contact   = datetime(2025, 12, 8, 10,  0, 0, tzinfo=timezone.utc)        # 11:00 CET
    eta            = datetime(2025, 12, 8, 13, 30, 0, tzinfo=timezone.utc)        # 14:30 CET

    rows = [
        # The headline late feed (Scene 3)
        (
            "custodian_holdings_abn", "ABN AMRO Custody Services", "ABN AMRO",
            "Janusz Kowalski", "Custody Operations Lead, Amsterdam", "janusz.kowalski@abnamro.example.com",
            expected_friday, received_monday, "received_late",
            last_contact, "Slack escalation to ops lead",
            "Auto-email Mon 08:15 CET; Slack escalation Mon 11:00 CET; Janusz responded ETA validate+ingest 14:30",
            eta,
            ["S.06.02"],
            ["standard_formula:market_risk"],
            2_300_000.0,
            "Custodian holdings file delivered Mon 09:47 CET vs Fri 18:00 CET expected. 2d15h47m late. "
            "Cause: ABN AMRO weekend batch reprocessing — root caught + acknowledged. Phantom €2.3M asset/own-funds "
            "break in cross-QRT recon will resolve once feed lands.",
            "2025-Q4",
        ),
        # Other expected feeds — on time, named for context
        (
            "policies_pas", "Bricksurance Policy Administration System", "Bricksurance internal",
            "Internal", "PAS Operations", "pas-ops@bricksurance.example.com",
            datetime(2025, 12, 5, 17, 0, tzinfo=timezone.utc), datetime(2025, 12, 5, 16, 12, tzinfo=timezone.utc),
            "received_on_time", None, None, None, None,
            ["S.05.01", "S.12.01"], [], 0.0, "Standard quarterly close batch.", "2025-Q4",
        ),
        (
            "claims_pas", "Bricksurance Claims Administration", "Bricksurance internal",
            "Internal", "Claims Operations", "claims-ops@bricksurance.example.com",
            datetime(2025, 12, 5, 17, 0, tzinfo=timezone.utc), datetime(2025, 12, 5, 16, 5, tzinfo=timezone.utc),
            "received_on_time", None, None, None, None,
            ["S.05.01", "S.26.06"], ["reserving_pnc"], 0.0, "Includes Storm Henrik claim notifications (16-18 Dec).", "2025-Q4",
        ),
        (
            "exposures_underwriting", "Underwriting platform", "Bricksurance internal",
            "Internal", "Underwriting Ops", "uw-ops@bricksurance.example.com",
            datetime(2025, 12, 5, 17, 0, tzinfo=timezone.utc), datetime(2025, 12, 5, 16, 30, tzinfo=timezone.utc),
            "received_on_time", None, None, None, None,
            ["S.26.06"], ["igloo_cat"], 0.0, "Exposure layers ready for cat engine.", "2025-Q4",
        ),
        (
            "ri_treaties", "ReinsurePro", "Munich Re — broker channel",
            "Internal", "Reinsurance Operations", "ri-ops@bricksurance.example.com",
            datetime(2025, 12, 6, 17, 0, tzinfo=timezone.utc), datetime(2025, 12, 7,  9, 12, tzinfo=timezone.utc),
            "received_on_time", None, None, None, None,
            ["S.26.06", "S.05.01"], [], 0.0, "Q4 cession statement, no schema changes.", "2025-Q4",
        ),
    ]
    insert_rows(
        "6_demo_data_feeds",
        ["feed_name", "source_system", "source_party",
         "owner_contact_name", "owner_contact_role", "owner_contact_email",
         "expected_at", "received_at", "status",
         "last_contact_at", "last_contact_method", "last_contact_notes",
         "eta_at", "blocks_qrts", "stale_models",
         "recon_phantom_eur", "notes", "reporting_period"],
        rows,
    )


def seed_event_log() -> None:
    rows = [
        ("storm_henrik_2025",  "Storm Henrik",   "windstorm",
         datetime(2025, 12, 16).date(), datetime(2025, 12, 18).date(),
         "Northern Germany + Denmark", 142.0, "km/h peak gust",
         ["property", "motor_liability"], 137.8,
         "Severe European windstorm. Peak gust 142 km/h Skagen. ~70% of Q4 cat loss concentrated in this 3-day window."),
        ("storm_eunice_2022",  "Storm Eunice",   "windstorm",
         datetime(2022, 2, 16).date(), datetime(2022, 2, 19).date(),
         "UK + NW Europe", 196.0, "km/h peak gust",
         ["property"], 218.0,
         "Reference event for storm calibration. Used as comparator in Igloo reasonableness checks."),
        ("storm_ylenia_2022",  "Storm Ylenia",   "windstorm",
         datetime(2022, 2, 17).date(), datetime(2022, 2, 18).date(),
         "Northern Germany + Denmark", 152.0, "km/h peak gust",
         ["property", "motor_liability"], 124.0,
         "Closest comparator to Henrik by region + intensity. Loss-to-event-severity ratio used as benchmark."),
        ("storm_otto_2023",    "Storm Otto",     "windstorm",
         datetime(2023, 2, 17).date(), datetime(2023, 2, 17).date(),
         "Denmark + Northern Germany", 130.0, "km/h peak gust",
         ["property"], 45.0,
         "Mid-tier reference event."),
    ]
    insert_rows(
        "6_demo_event_log",
        ["event_id", "event_name", "event_type", "start_date", "end_date", "region",
         "peak_intensity", "peak_intensity_unit", "affected_lobs", "modelled_aal_eur_m", "notes"],
        rows,
    )


def seed_solvency_daily() -> None:
    """90 days of daily solvency ratios drifting around 211% with explainable inflections."""
    import random
    random.seed(42)

    end_date = datetime(2025, 12, 8).date()
    rows: list[tuple] = []

    # Build a base series with gentle random walk around 211
    base = 211.0
    series: list[float] = []
    for _ in range(90):
        base += (random.random() - 0.5) * 0.4
        series.append(round(base, 1))

    # Inject inflections (working backwards from today, day index 89 = today)
    inflections = {
        # ~22 days ago = 16 Nov; we want 16 Dec to be visible — 90 days ago = 9 Sep, last 90 ends today 8 Dec
        # Storm Henrik losses notified 16 Dec: that's outside our 90-day window ending 8 Dec.
        # Adjust narrative dates so the inflections fall inside the window.
        # Reframe: use 27 Nov, 1 Dec, 4 Dec for storm/custodian/equity drift.
        85: ("Storm Henrik claims notification (intra-quarter run)", "claims", -1.2),
        86: ("Equity rebound — DAX +1.4%", "market", 0.6),
        87: ("Custodian valuation drop reflecting EUR softening", "market", -0.4),
        88: ("Property cat IBNR refresh from Igloo Q4 candidate", "claims", -0.2),
    }
    cur = series[0]
    for i in range(90):
        if i in inflections:
            label, klass, delta = inflections[i]
            cur += delta
            ratio = round(cur, 1)
            rows.append((
                end_date - timedelta(days=89 - i), ratio, 556_000_000.0, 1_850_000_000.0 * (ratio / 333.0),
                round(delta, 2), label, klass,
            ))
        else:
            cur += series[i] - (series[i - 1] if i > 0 else series[i])
            ratio = round(cur, 1)
            rows.append((
                end_date - timedelta(days=89 - i), ratio, 556_000_000.0, 1_850_000_000.0 * (ratio / 333.0),
                round(ratio - (rows[-1][1] if rows else ratio), 2),
                "—", "drift",
            ))

    insert_rows(
        "6_demo_solvency_daily",
        ["observed_date", "ratio_pct", "scr_eur", "own_funds_eur",
         "delta_vs_prior_pp", "driver", "driver_class"],
        rows,
    )


def seed_cyber_book() -> None:
    rows = [(
        datetime(2025, 12, 8).date(),
        18_000_000.0, 0.62,
        0.40, 5_000_000.0,
        6_400_000.0, 78.0,
        "Q4 2025 cyber book snapshot. SME-heavy (78% of GWP from accounts <£500K). "
        "Reinsurance program: 40% quota share + £5M XOL above. SCR allocation £6.4M.",
    )]
    insert_rows(
        "6_demo_cyber_book",
        ["as_of_date", "gwp_eur", "loss_ratio",
         "reinsurance_qs_pct", "reinsurance_xol_attach_eur",
         "scr_allocation_eur", "accounts_smalmedium_pct", "notes"],
        rows,
    )


def seed_orsa_history() -> None:
    """30 days × 3 standing stresses × 4 year-offsets (0..3)."""
    end_date = datetime(2025, 12, 8).date()
    scenarios = [
        ("natcat_1_in_200",     "1-in-200 nat cat",          [333, 257, 250, 251]),
        ("equity_minus_30",     "Equity shock −30%",          [333, 245, 248, 252]),
        ("mass_lapse_plus_35",  "Mass lapse +35%",            [333, 195, 165, 142]),  # drifts down 142→138
    ]
    rows: list[tuple] = []
    import random; random.seed(7)
    for d in range(30):
        observed = end_date - timedelta(days=29 - d)
        # mass-lapse trough drifts from 142 (29d ago) to 138 (today)
        ml_drift = 142 - (4.0 * d / 29.0)
        for sid, sname, base in scenarios:
            for yo, base_ratio in enumerate(base):
                if sid == "mass_lapse_plus_35" and yo == 3:
                    ratio = round(ml_drift + (random.random() - 0.5) * 0.5, 1)
                else:
                    ratio = round(base_ratio + (random.random() - 0.5) * 1.5, 1)
                rows.append((
                    observed, sid, sname, yo, 2025 + yo,
                    ratio, 556_000_000.0, 1_850_000_000.0 * (ratio / 333.0),
                    f"{observed.isoformat()}-{sid}",
                ))
    insert_rows(
        "6_demo_orsa_history",
        ["observed_date", "scenario_id", "scenario_name",
         "year_offset", "projection_year", "ratio_pct",
         "scr_eur", "own_funds_eur", "run_label"],
        rows,
    )


def seed_sf_challenger() -> None:
    rows = [(
        "v2.2", "2026 calibration",
        "Laurence Ryszka", "Chief Actuary", datetime(2025, 12, 5, 16, 30, tzinfo=timezone.utc),
        "Sarah Chen", "Head of Risk Function", "out_of_office",
        datetime(2025, 12, 10).date(),
        "Michael Brandt", "Deputy Head of Risk Function", "available",
        3, datetime(2025, 12, 14, 9, 0, tzinfo=timezone.utc),
        4.0, 211.0, 203.0,
        ["Tighter non-life UW correlation (+1.5%)",
         "Higher operational risk parameter (+1.0%)",
         "Updated lapse stress severity (+1.5%)"],
        "pending_approval",
        None, None,
    )]
    insert_rows(
        "6_demo_sf_challenger",
        ["challenger_version", "calibration_label",
         "submitted_by", "submitted_role", "submitted_at",
         "approver_name", "approver_role", "approver_status",
         "approver_oo_until", "deputy_name", "deputy_role",
         "deputy_status", "reminders_sent", "last_reminder_at",
         "scr_delta_pct", "ratio_before_pct", "ratio_after_pct",
         "methodology_changes", "current_state",
         "promoted_at", "promoted_by"],
        rows,
    )


def seed_orsa_draft() -> None:
    """Single current version (v1) of the continuous ORSA draft, all 8 sections."""
    last_q = datetime(2025, 12, 8, 2, 14, tzinfo=timezone.utc)        # nightly refresh
    last_n = datetime(2025, 11, 18, 16, 30, tzinfo=timezone.utc)      # last manual edit
    annual_review = datetime(2025, 7, 24, 10, 0, tzinfo=timezone.utc) # board statement

    sections = [
        (1, "risk_profile", "Risk profile", "live", last_q, last_n, """\
The Group's Q4 2025 risk profile is dominated by non-life underwriting risk
(catastrophe driven) and market risk on the asset portfolio. The Solvency
Capital Requirement stands at **EUR 556 M** with eligible own funds of
**EUR 1.85 B**, producing a coverage ratio of **333%** at year-end. Today's
reading is **208.7%** reflecting intra-quarter movements (Storm Henrik
notifications, custodian valuation drop, Igloo Q4 IBNR refresh).

Material concentration in property + motor underwriting in Northern Germany
and Denmark — the regions exposed to the December storm — remains within
internal risk-appetite tolerances. No new top-of-the-house risks identified
since the prior board update."""),

        (2, "capital_adequacy", "Capital adequacy assessment", "live", last_q, last_n, """\
Eligible own funds composition: **Tier 1 unrestricted EUR 1.62 B (88%)**,
Tier 1 restricted EUR 0.10 B, Tier 2 EUR 0.13 B. The composition exceeds
the regulatory tiering caps with a comfortable margin.

Coverage of MCR is in excess of 5x. Coverage of SCR after the Q4 close
projection sits at **205%** under business-plan growth. The Group
considers itself well-capitalised on a base-case forward look."""),

        (3, "sf_appropriateness", "Standard formula appropriateness", "stable", last_q, datetime(2025, 9, 4, 11, 0, tzinfo=timezone.utc), """\
The Group continues to use the EIOPA Standard Formula. The 2026 calibration
Challenger model (v2.2) is in active review by the Risk Function — see
Lab → Standard Formula. SCR delta vs production is **+4.0%**, driven by:

- Tighter non-life UW correlation (+1.5%)
- Higher operational risk parameter (+1.0%)
- Updated lapse stress severity (+1.5%)

The Standard Formula remains appropriate for the Group's risk profile.
The Actuarial Function has not identified any material divergence between
SF assumptions and the Group's underwriting reality that would warrant a
partial internal model."""),

        (4, "stress_scenario_testing", "Stress and scenario testing", "live", last_q, last_n, """\
Three standing stresses are projected nightly (continuous ORSA):

- **1-in-200 nat cat:** trough ratio ~257% at year 0, recovers to ~252% by year 3
- **Equity shock −30%:** trough ratio ~245% at year 0, recovers to ~252% by year 3
- **Mass lapse +35%:** trough ratio ~138% at year 3 (drifting down from ~142%
  three weeks ago, driven by recent unit-linked lapse experience)

The mass-lapse trough is the binding stress and has been deteriorating over
the last 30 days. The drift is consistent with the +34% Q4 unit-linked lapse
uplift observed in the bronze layer. The Risk Function recommends the lapse
assumption refresh proposed for the 2026 calibration captures this trend
appropriately; no immediate action beyond the standing approval queue."""),

        (5, "reverse_stress_testing", "Reverse stress testing", "live", last_q, last_n, """\
Reverse stress to test the Group's ability to remain solvent at the MCR
floor identified the following extreme combinations:

- A simultaneous 1-in-500 European windstorm + −40% equity shock would
  reduce coverage to ~140% — within tolerances but flagged
- A pandemic-style mass lapse of +60% across life portfolios over 12 months
  would reduce coverage to ~105% — non-binding given lapse stress already
  modelled at +35%
- A counterparty default cascade combining the largest reinsurance recoverable
  with the top-3 bond exposures simultaneously would reduce coverage to ~165%

None of the above scenarios are considered realistic in isolation; their
purpose is to identify the binding constraint, which remains mass-lapse
behaviour in the unit-linked book."""),

        (6, "capital_projection", "Capital projection over business plan (3-year)", "live", last_q, last_n, """\
Under the business plan (premium growth + planned capital management
actions), the projected solvency-ratio path is:

| Year | Base | Mass lapse +35% |
|------|------|-----------------|
| 0    | 333% | 195%            |
| +1y  | 320% | 165%            |
| +2y  | 312% | 142%            |
| +3y  | 305% | 138%            |

Capital generation is positive on a base case in every year. No planned
distributions threaten the internal risk-appetite floor of 175% under
base case. Under the binding stress (mass lapse) the coverage path
remains above MCR but below internal appetite from year 1 onwards."""),

        (7, "conclusions", "Conclusions and overall solvency needs statement", "annual_review", last_q, annual_review, """\
The Board concludes that the Group's overall solvency needs are well covered
by the current capital position. The Group remains well-capitalised on a
base case and resilient to the standing stresses tested. The mass-lapse
exposure in the unit-linked book is the binding constraint and is
continuously monitored.

The Group's capital management policy, reinsurance program, and risk
appetite framework remain appropriate for the current and projected risk
profile."""),

        (8, "board_statement", "Board statement", "annual_review", annual_review, annual_review, """\
The Board has reviewed the Own Risk and Solvency Assessment, including the
quantitative results, methodology, and conclusions, and confirms that:

(a) the assessment provides a true and fair view of the Group's overall
solvency needs;
(b) the standard formula remains appropriate for the Group's risk profile;
(c) the Group has, at the date of this assessment, sufficient eligible own
funds to cover both regulatory capital requirements and internally
defined economic capital needs over the projected planning horizon.

Approved by the Board of Directors at its meeting of **24 July 2025**.
Reviewed at the **18 November 2025** governance committee."""),
    ]

    rows = [(1, sid, title, body, status, last_q, last_n, order, "actuarial.team@bricksurance.eu")
            for order, sid, title, status, last_q, last_n, body in sections]
    insert_rows(
        "gold_orsa_draft",
        ["version", "section_id", "section_title", "body_markdown", "status",
         "last_quantitative_refresh", "last_narrative_review", "order_index", "generated_by"],
        rows,
    )


def main() -> None:
    print(f"Phase 5 narrative seed in {CATALOG}.{SCHEMA}")
    ensure_tables()
    print("\nClearing previous demo state…")
    for tbl, _ in DDL:
        assert_succeeded(run_sql(f"DELETE FROM {fqn(tbl)}"), f"delete {tbl}")
    print("\nSeeding…")
    seed_data_feeds()
    seed_event_log()
    seed_solvency_daily()
    seed_cyber_book()
    seed_orsa_history()
    seed_sf_challenger()
    seed_orsa_draft()
    print("\nPhase 5 seed complete.")


if __name__ == "__main__":
    main()

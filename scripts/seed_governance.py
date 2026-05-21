#!/usr/bin/env python3
"""Seed the 6_gov_* tables for the Workbench Phase 1 demo.

Idempotent: clears existing rows, then inserts a fresh seed set.

Run locally against the DEV workspace via SQL warehouse:
    python3 scripts/seed_governance.py

Or against any workspace by setting env vars:
    DATABRICKS_PROFILE=PROD CATALOG=... SCHEMA=... WAREHOUSE_ID=... \
        python3 scripts/seed_governance.py

Mirrors the seed logic in src/01_Bootstrap_Governance/bootstrap_governance.py
but uses the SQL warehouse path so it can run from a laptop. The notebook
version is the canonical bundle-deployable runner; this is the dev quick
iteration path.
"""
from __future__ import annotations

import os
import json
import subprocess
import uuid
from datetime import datetime, timezone, timedelta

# All workspace-specific values must come from env. deploy_demo.sh exports
# these from databricks.yml. Defaults match dev so an interactive run
# with the DEV profile works; deploy_demo.sh overrides everything.
PROFILE = os.environ.get("DATABRICKS_PROFILE", "DEV")
CATALOG = os.environ.get("CATALOG", "lr_dev_aws_us_catalog")
SCHEMA = os.environ.get("SCHEMA", "solvency2_workbench")
WAREHOUSE_ID = os.environ.get("WAREHOUSE_ID", "a3b61648ea4809e3")
YEAR = int(os.environ.get("REPORTING_YEAR", os.environ.get("YEAR", "2025")))


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
        # ARRAY<STRING> literal
        return "array(" + ",".join(lit(x) for x in v) + ")"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def insert_rows(table: str, columns: list[str], rows: list[tuple]) -> None:
    if not rows:
        print(f"  (no rows for {table})")
        return
    # Insert in batches of 50 to keep statements small
    BATCH = 50
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        values = ",\n".join("(" + ",".join(lit(v) for v in row) + ")" for row in batch)
        stmt = f"INSERT INTO {fqn(table)} ({','.join(columns)}) VALUES\n{values}"
        res = run_sql(stmt)
        assert_succeeded(res, f"insert {table} batch")
    print(f"  ✓ inserted {len(rows)} rows into {table}")


def _ts(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 17, 0, 0, tzinfo=timezone.utc)


def main() -> None:
    print(f"Seeding governance tables in {CATALOG}.{SCHEMA} via warehouse {WAREHOUSE_ID}")

    # Truncate
    for t in ["6_gov_overlays", "6_gov_promotions", "6_gov_model_aliases", "6_gov_model_diagnostics"]:
        assert_succeeded(run_sql(f"DELETE FROM {fqn(t)}"), f"delete {t}")
    print("  (cleared existing rows)")

    quarters = [
        (f"{YEAR}-Q1", _ts(YEAR, 4, 15)),
        (f"{YEAR}-Q2", _ts(YEAR, 7, 15)),
        (f"{YEAR}-Q3", _ts(YEAR, 10, 15)),
        (f"{YEAR}-Q4", _ts(YEAR + 1, 1, 15)),
    ]

    # ── External engine aliases ─────────────────────────────────────────────
    external_models = [
        ("igloo_cat",    "4_eng_stochastic_results"),
        ("prophet_life", "4_eng_prophet_results"),
    ]
    alias_rows: list[tuple] = []
    for model_id, table in external_models:
        for i, (q, t) in enumerate(quarters):
            alias = "production" if i == len(quarters) - 1 else "archive"
            alias_rows.append((model_id, alias, f"{q} v1", table, q, t, "actuarial.team@bricksurance.eu"))
        next_q = f"{YEAR + 1}-Q1"
        alias_rows.append((
            model_id, "candidate", f"{next_q} v1-rc1", table, next_q,
            _ts(YEAR + 1, 1, 28), "senior.actuary@bricksurance.eu",
        ))
    insert_rows(
        "6_gov_model_aliases",
        ["model_id", "alias", "version_label", "artefact_table", "reporting_period", "set_at", "set_by"],
        alias_rows,
    )

    # ── Promotions ──────────────────────────────────────────────────────────
    models_for_promotion = [
        ("reserving_pnc",    "native"),
        ("reserving_life",   "native"),
        ("standard_formula", "native"),
        ("igloo_cat",        "external"),
        ("prophet_life",     "external"),
    ]
    promo_rows: list[tuple] = []
    for model_name, model_type in models_for_promotion:
        for i, (q, t) in enumerate(quarters):
            version = f"{q} v1"
            prior_version = f"{quarters[i - 1][0]} v1" if i > 0 else None
            from_alias = "candidate" if i > 0 else None
            promo_rows.append((
                str(uuid.uuid4()), model_name, model_type, from_alias, "production",
                prior_version, version, q, True,
                f"Promoted for {q} close. Diagnostics within tolerance, sign-off complete.",
                "chief.actuary@bricksurance.eu", t - timedelta(days=2),
                "actuarial.team@bricksurance.eu", t - timedelta(days=1), "approved",
            ))
        # Only the two models that actually have a Q4 candidate awaiting
        # sign-off get a pending row. Cat and life engines run cleanly on
        # their current Champion calibrations.
        if model_name in ("reserving_pnc", "standard_formula"):
            current_q = f"{YEAR}-Q4"
            current_t = _ts(YEAR + 1, 1, 28)
            promo_rows.append((
                str(uuid.uuid4()), model_name, model_type, None, "candidate",
                f"{YEAR}-Q4 v1", f"{current_q} v1-rc1", current_q, False,
                f"Recalibration candidate for {current_q}. Diagnostics in review.",
                None, None, "senior.actuary@bricksurance.eu", current_t, "pending",
            ))
    insert_rows(
        "6_gov_promotions",
        ["promotion_id", "model_name", "model_type", "from_alias", "to_alias",
         "from_version", "to_version", "quarter", "diagnostics_passed", "justification",
         "approver", "approved_at", "promoted_by", "promoted_at", "status"],
        promo_rows,
    )

    # ── Overlays ────────────────────────────────────────────────────────────
    q4 = f"{YEAR}-Q4"
    q4_create = _ts(YEAR + 1, 1, 8)
    q4_approve = _ts(YEAR + 1, 1, 12)
    overlay_rows: list[tuple] = [
        # Q4 storm
        (str(uuid.uuid4()), "reserving_pnc", q4, "property", None,
         18_500_000.0, "increase", "one_off_event",
         "Late-Dec 2025 European wind storm (storm_dec_2025). 2,266 claims tagged storm-event in last 14 days "
         "of December — concentrated 60% of property claim count. Chain-ladder development factor inflated to "
         "1.18x to capture the late-reported tail. Consistent with prior storm-event pattern (2022 Eunice, 2023 Otto). "
         "Approved by Chief Actuary 2026-01-12.",
         "senior.reserving.actuary@bricksurance.eu", q4_create,
         "chief.actuary@bricksurance.eu", q4_approve, "approved",
         ["s0501.R0210.gross_premiums_written:property", "s0501.R0310.gross_claims_incurred:property",
          "s2501.R0040.SCR_non_life", "s2606.R0010.premium_reserve_risk:property"],
         "new", None),
        # Q4 motor 2023 AY
        (str(uuid.uuid4()), "reserving_pnc", q4, "motor_liability", 2023,
         -2_000_000.0, "decrease", "methodology_judgement",
         "Single large bodily-injury claim in 2023 AY (claim ID MOTOR-2023-08812) settled for EUR 2.1M, "
         "originally projected at EUR 4.0M based on chain-ladder. Adjustment removes the over-projection on "
         "this single distorting claim. BF method on the residual triangle. Reviewed against industry data — "
         "methodology consistent with peers.",
         "senior.reserving.actuary@bricksurance.eu", q4_create,
         "chief.actuary@bricksurance.eu", q4_approve, "approved",
         ["s0501.R0310.gross_claims_incurred:motor_liability", "s2606.R0010.premium_reserve_risk:motor_liability"],
         "new", None),
        # Q4 liability tail
        (str(uuid.uuid4()), "reserving_pnc", q4, "general_liability", None,
         4_500_000.0, "increase", "tail_extension",
         "Tail factor extended from 1.02 to 1.04 for general liability following internal review of long-tail "
         "PI claim emergence. Latent claim notification delays observed in 2024-2025 vintage. Methodology aligned "
         "with EIOPA guidance on long-tail liability lines. Renewed from prior tail extension applied in 2024-Q4.",
         "senior.reserving.actuary@bricksurance.eu", q4_create,
         "chief.actuary@bricksurance.eu", q4_approve, "approved",
         ["s0501.R0310.gross_claims_incurred:general_liability", "s2606.R0010.premium_reserve_risk:general_liability"],
         "renewed_from_prior", None),
    ]
    # Q1, Q2, Q3 historical overlays
    for qi, (q, t) in enumerate(quarters[:3]):
        if qi == 0:
            overlay_rows.append((
                str(uuid.uuid4()), "reserving_pnc", q, "motor_liability", 2022,
                -800_000.0, "decrease", "data_correction",
                "Reclass of three subrogation recoveries originally booked gross. Net impact -EUR 0.8M.",
                "senior.reserving.actuary@bricksurance.eu", t - timedelta(days=10),
                "chief.actuary@bricksurance.eu", t - timedelta(days=7), "approved",
                ["s0501.R0310.gross_claims_incurred:motor_liability"],
                "new", None,
            ))
        elif qi == 1:
            overlay_rows.append((
                str(uuid.uuid4()), "reserving_pnc", q, "general_liability", None,
                3_200_000.0, "increase", "tail_extension",
                "Tail factor extension applied for general liability following emergence of long-tail PI claims. "
                "Initial application; renewed each subsequent quarter.",
                "senior.reserving.actuary@bricksurance.eu", t - timedelta(days=10),
                "chief.actuary@bricksurance.eu", t - timedelta(days=7), "approved",
                ["s0501.R0310.gross_claims_incurred:general_liability",
                 "s2606.R0010.premium_reserve_risk:general_liability"],
                "new", None,
            ))
        else:
            overlay_rows.append((
                str(uuid.uuid4()), "reserving_life", q, "life_unit_linked", None,
                1_500_000.0, "increase", "methodology_judgement",
                "Lapse assumption for unit-linked refined upward following observed Q3 experience deterioration. "
                "Best-estimate lapse rate 1.45% to 1.65%.",
                "senior.reserving.actuary@bricksurance.eu", t - timedelta(days=10),
                "chief.actuary@bricksurance.eu", t - timedelta(days=7), "approved",
                ["s1201.R0010.best_estimate_life", "lifeuw.R0010.lapse_risk"],
                "new", None,
            ))
    insert_rows(
        "6_gov_overlays",
        ["overlay_id", "model_name", "quarter", "line_of_business", "accident_year",
         "magnitude_eur", "direction", "category", "rationale", "author", "created_at",
         "approver", "approved_at", "status", "linked_qrt_cells", "lifecycle_action", "prior_overlay_id"],
        overlay_rows,
    )

    # ── Diagnostics ─────────────────────────────────────────────────────────
    DIAG_TEMPLATES = {
        "reserving_pnc": [
            ("variance_vs_prior_reserves_pct", -2.0, 8.0,  "reserves vs prior quarter (%)"),
            ("triangle_consistency_score",      0.85, 1.0,  "actual vs expected on Q-1 cohort"),
            ("ifrs17_pop_consistency_pct",     -3.0, 3.0,   "vs IFRS 17 best-estimate (%)"),
        ],
        "reserving_life": [
            ("variance_vs_prior_be_pct",       -1.5, 4.0,   "best-estimate vs prior (%)"),
            ("lapse_assumption_drift_bps",    -10.0, 20.0,  "lapse vs Q-1 (bps)"),
        ],
        "standard_formula": [
            ("scr_variance_vs_prior_pct",      -3.0, 6.0,   "SCR vs prior quarter (%)"),
            ("submodule_consistency_pass_n",    9.0, 10.0,  "of 10 sub-modules within tolerance"),
        ],
        "igloo_cat": [
            ("var_99_5_eur_m",                400.0, 600.0, "99.5% VaR (EUR M)"),
            ("tvar_99_5_eur_m",               500.0, 750.0, "99.5% TVaR (EUR M)"),
            ("reasonableness_vs_aal_pct",      80.0, 130.0, "modelled / AAL (%)"),
        ],
        "prophet_life": [
            ("be_5000_scenarios_eur_m",       1900.0, 2100.0, "best estimate over 5K scenarios (EUR M)"),
            ("convergence_score",              0.95,    1.0,  "scenario convergence"),
        ],
    }
    import random
    random.seed(42)
    diag_rows: list[tuple] = []
    for model_name, _ in models_for_promotion:
        for q, t in quarters:
            for diag_name, lo, hi, label in DIAG_TEMPLATES.get(model_name, []):
                mid = (lo + hi) / 2
                spread = (hi - lo) * 0.3
                val = mid + spread * (random.random() - 0.5) * 2
                diag_rows.append((
                    model_name, f"{q} v1", q, diag_name, val, label, lo, hi, lo <= val <= hi, t,
                ))
    insert_rows(
        "6_gov_model_diagnostics",
        ["model_name", "version_label", "reporting_period", "diagnostic_name", "metric_value",
         "metric_text", "threshold_low", "threshold_high", "passed", "computed_at"],
        diag_rows,
    )

    print()
    for tbl in ["6_gov_overlays", "6_gov_promotions", "6_gov_model_aliases", "6_gov_model_diagnostics"]:
        res = run_sql(f"SELECT COUNT(*) AS n FROM {fqn(tbl)}")
        n = res.get("result", {}).get("data_array", [["?"]])[0][0]
        print(f"  {tbl:<35s} {n:>6} rows")

    print("\nGovernance seed complete.")


if __name__ == "__main__":
    main()

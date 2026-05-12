# Databricks notebook source
# MAGIC %md
# MAGIC # Bootstrap Governance Tables + Historical State
# MAGIC
# MAGIC Creates the four `6_gov_*` tables and seeds them with realistic per-quarter
# MAGIC state for Q1, Q2, Q3, Q4 2025. Idempotent — safe to re-run.
# MAGIC
# MAGIC Tables created:
# MAGIC - `6_gov_overlays`           — actuarial-judgement overlays register
# MAGIC - `6_gov_promotions`         — model promotion event log
# MAGIC - `6_gov_model_aliases`      — alias state for external engines (Igloo, Prophet)
# MAGIC - `6_gov_model_diagnostics`  — per-version diagnostics snapshot
# MAGIC
# MAGIC State seeded:
# MAGIC - 5 model rows (reserving_pnc, reserving_life, standard_formula, igloo_cat, prophet_life)
# MAGIC - 4 quarters × promotion records → each quarter has its own production version
# MAGIC - Three Q4 2025 overlays (storm +18%, motor 2023 AY -€2M, liability tail extension)
# MAGIC - One overlay per Q1/Q2/Q3 so historical retrieval shows real per-quarter state
# MAGIC - Diagnostics snapshots per quarter so the Lab Diagnostics tab has content
# MAGIC
# MAGIC Run AFTER `bootstrap_archive` (which generates Q1-Q4 raw data) and AFTER
# MAGIC the SF/reserving model registration notebooks.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("reporting_year", "2025")

catalog = dbutils.widgets.get("catalog_name")
schema = dbutils.widgets.get("schema_name")
year = dbutils.widgets.get("reporting_year")

print(f"Catalog: {catalog}")
print(f"Schema:  {schema}")
print(f"Year:    {year}")

spark.sql(f"USE CATALOG {catalog}")
spark.sql(f"USE SCHEMA {schema}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Create governance tables (CREATE IF NOT EXISTS — idempotent)

# COMMAND ----------

spark.sql("""
CREATE TABLE IF NOT EXISTS `6_gov_overlays` (
  overlay_id STRING,
  model_name STRING,
  quarter STRING,
  line_of_business STRING,
  accident_year INT,
  magnitude_eur DOUBLE,
  direction STRING,
  category STRING,
  rationale STRING,
  author STRING,
  created_at TIMESTAMP,
  approver STRING,
  approved_at TIMESTAMP,
  status STRING,
  linked_qrt_cells ARRAY<STRING>,
  lifecycle_action STRING,
  prior_overlay_id STRING
) USING DELTA
COMMENT 'Actuarial-judgement overlays register. Each row is one judgement applied to a model output for a quarter.'
""")

spark.sql("""
CREATE TABLE IF NOT EXISTS `6_gov_promotions` (
  promotion_id STRING,
  model_name STRING,
  model_type STRING,
  from_alias STRING,
  to_alias STRING,
  from_version STRING,
  to_version STRING,
  quarter STRING,
  diagnostics_passed BOOLEAN,
  justification STRING,
  approver STRING,
  approved_at TIMESTAMP,
  promoted_by STRING,
  promoted_at TIMESTAMP,
  status STRING
) USING DELTA
COMMENT 'Model promotion event log. Captures alias movements (production / candidate / archive) for native and external models.'
""")

spark.sql("""
CREATE TABLE IF NOT EXISTS `6_gov_model_aliases` (
  model_id STRING,
  alias STRING,
  version_label STRING,
  artefact_table STRING,
  reporting_period STRING,
  set_at TIMESTAMP,
  set_by STRING
) USING DELTA
COMMENT 'Alias state for external-engine models (Igloo, Prophet). Mirrors MLflow alias semantics for native UC models.'
""")

spark.sql("""
CREATE TABLE IF NOT EXISTS `6_gov_model_diagnostics` (
  model_name STRING,
  version_label STRING,
  reporting_period STRING,
  diagnostic_name STRING,
  metric_value DOUBLE,
  metric_text STRING,
  threshold_low DOUBLE,
  threshold_high DOUBLE,
  passed BOOLEAN,
  computed_at TIMESTAMP
) USING DELTA
COMMENT 'Per-version diagnostics snapshot — variance vs prior, reasonableness checks, triangle consistency.'
""")

print("✓ Governance tables created.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Seed external-engine alias state
# MAGIC
# MAGIC Igloo (cat risk) and Prophet (life UW) write to UC tables. The "model" is the
# MAGIC dataset they produce; the alias points at a labelled version-period pair.

# COMMAND ----------

from datetime import datetime, timezone, timedelta
import uuid

def _ts(year_int, month, day):
    return datetime(year_int, month, day, 17, 0, 0, tzinfo=timezone.utc)

# Truncate then re-seed (idempotent)
spark.sql("DELETE FROM `6_gov_model_aliases`")
spark.sql("DELETE FROM `6_gov_promotions`")

# External engines: per-quarter version labels. Production = current quarter, candidate = next.
external_models = [
    ("igloo_cat",    "4_eng_stochastic_results", "WTW Igloo"),
    ("prophet_life", "4_eng_prophet_results",    "FIS Prophet"),
]

quarters = [
    (f"{year}-Q1", _ts(int(year), 4, 15)),
    (f"{year}-Q2", _ts(int(year), 7, 15)),
    (f"{year}-Q3", _ts(int(year), 10, 15)),
    (f"{year}-Q4", _ts(int(year)+1, 1, 15)),
]

# Each external model: production alias = latest quarter, archives for prior, candidate for next calibration
external_alias_rows = []
for model_id, table, _vendor in external_models:
    for i, (q, t) in enumerate(quarters):
        version_label = f"{q} v1"
        alias = "production" if i == len(quarters) - 1 else "archive"
        external_alias_rows.append((model_id, alias, version_label, table, q, t, "actuarial.team@bricksurance.eu"))
    # Q1 2026 candidate (recalibration in review for next year)
    external_alias_rows.append((
        model_id, "candidate", f"{int(year)+1}-Q1 v1-rc1", table, f"{int(year)+1}-Q1",
        _ts(int(year)+1, 1, 28), "senior.actuary@bricksurance.eu",
    ))

spark.createDataFrame(
    external_alias_rows,
    "model_id STRING, alias STRING, version_label STRING, artefact_table STRING, reporting_period STRING, set_at TIMESTAMP, set_by STRING",
).write.mode("append").saveAsTable("`6_gov_model_aliases`")

print(f"✓ Seeded {len(external_alias_rows)} external-engine alias rows.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Seed promotion records — uniform across native + external
# MAGIC
# MAGIC One promotion event per (model, quarter). Older quarters approved + complete;
# MAGIC current quarter has both an approved promotion and a pending candidate.

# COMMAND ----------

models_for_promotion = [
    ("reserving_pnc",     "native"),
    ("reserving_life",    "native"),
    ("standard_formula",  "native"),
    ("igloo_cat",         "external"),
    ("prophet_life",      "external"),
]

promotion_rows = []

for model_name, model_type in models_for_promotion:
    for i, (q, t) in enumerate(quarters):
        is_current = (i == len(quarters) - 1)
        version = f"{q} v1"
        prior_version = f"{quarters[i-1][0]} v1" if i > 0 else None
        promotion_rows.append((
            str(uuid.uuid4()),
            model_name,
            model_type,
            "candidate" if i > 0 else None,                    # from_alias
            "production",                                       # to_alias
            prior_version,                                      # from_version
            version,                                            # to_version
            q,                                                  # quarter
            True,                                               # diagnostics_passed
            f"Promoted for {q} close. Diagnostics within tolerance, sign-off complete.",
            "chief.actuary@bricksurance.eu",                    # approver
            t - timedelta(days=2),                              # approved_at
            "actuarial.team@bricksurance.eu",                   # promoted_by
            t - timedelta(days=1),                              # promoted_at
            "approved",                                         # status
        ))
    # Q1 next-year candidate (pending) for each model
    next_q = f"{int(year)+1}-Q1"
    next_t = _ts(int(year)+1, 1, 28)
    promotion_rows.append((
        str(uuid.uuid4()),
        model_name, model_type,
        None, "candidate",
        f"{year}-Q4 v1", f"{next_q} v1-rc1",
        next_q, False,
        f"Recalibration candidate for {next_q}. Diagnostics in review.",
        None, None,
        "senior.actuary@bricksurance.eu",
        next_t,
        "pending",
    ))

spark.createDataFrame(
    promotion_rows,
    "promotion_id STRING, model_name STRING, model_type STRING, from_alias STRING, to_alias STRING, "
    "from_version STRING, to_version STRING, quarter STRING, diagnostics_passed BOOLEAN, "
    "justification STRING, approver STRING, approved_at TIMESTAMP, promoted_by STRING, "
    "promoted_at TIMESTAMP, status STRING",
).write.mode("append").saveAsTable("`6_gov_promotions`")

print(f"✓ Seeded {len(promotion_rows)} promotion records (5 models × 5 quarters).")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Seed overlays
# MAGIC
# MAGIC Three Q4 overlays (the headline ones) plus one per Q1/Q2/Q3 so historical
# MAGIC retrieval has real content per quarter.

# COMMAND ----------

spark.sql("DELETE FROM `6_gov_overlays`")

overlay_rows = []

# ── Q4 2025: three headline overlays ─────────────────────────────────────────

q4 = f"{year}-Q4"
q4_create = _ts(int(year)+1, 1, 8)
q4_approve = _ts(int(year)+1, 1, 12)

storm_id = str(uuid.uuid4())
overlay_rows.append((
    storm_id,
    "reserving_pnc", q4,
    "property", None,
    18_500_000.0, "increase",
    "one_off_event",
    "Late-Dec 2025 European wind storm (storm_dec_2025). 2,266 claims tagged storm-event in last 14 days of December — concentrated 60% of property claim count. Chain-ladder development factor inflated to 1.18× to capture the late-reported tail. Consistent with prior storm-event pattern (2022 Eunice, 2023 Otto). Approved by Chief Actuary 2026-01-12.",
    "senior.reserving.actuary@bricksurance.eu",
    q4_create,
    "chief.actuary@bricksurance.eu",
    q4_approve,
    "approved",
    ["s0501.R0210.gross_premiums_written:property", "s0501.R0310.gross_claims_incurred:property", "s2501.R0040.SCR_non_life", "s2606.R0010.premium_reserve_risk:property"],
    "new",
    None,
))

motor_id = str(uuid.uuid4())
overlay_rows.append((
    motor_id,
    "reserving_pnc", q4,
    "motor_liability", 2023,
    -2_000_000.0, "decrease",
    "methodology_judgement",
    "Single large bodily-injury claim in 2023 AY (claim ID MOTOR-2023-08812) settled for €2.1M, originally projected at €4.0M based on chain-ladder. Adjustment removes the over-projection on this single distorting claim. BF method on the residual triangle. Reviewed against industry data — methodology consistent with peers.",
    "senior.reserving.actuary@bricksurance.eu",
    q4_create,
    "chief.actuary@bricksurance.eu",
    q4_approve,
    "approved",
    ["s0501.R0310.gross_claims_incurred:motor_liability", "s2606.R0010.premium_reserve_risk:motor_liability"],
    "new",
    None,
))

tail_id = str(uuid.uuid4())
overlay_rows.append((
    tail_id,
    "reserving_pnc", q4,
    "general_liability", None,
    4_500_000.0, "increase",
    "tail_extension",
    "Tail factor extended from 1.02 to 1.04 for general liability following internal review of long-tail PI claim emergence. Latent claim notification delays observed in 2024-2025 vintage. Methodology aligned with EIOPA guidance on long-tail liability lines. Renewed from prior tail extension applied in 2024-Q4.",
    "senior.reserving.actuary@bricksurance.eu",
    q4_create,
    "chief.actuary@bricksurance.eu",
    q4_approve,
    "approved",
    ["s0501.R0310.gross_claims_incurred:general_liability", "s2606.R0010.premium_reserve_risk:general_liability"],
    "renewed_from_prior",
    None,
))

# ── Q1, Q2, Q3 2025: one overlay each (historical retrieval needs real content) ─

for qi, (q, t) in enumerate(quarters[:3]):
    qi_id = str(uuid.uuid4())
    if qi == 0:
        # Q1: small motor adjustment
        overlay_rows.append((
            qi_id, "reserving_pnc", q, "motor_liability", 2022,
            -800_000.0, "decrease", "data_correction",
            "Reclass of three subrogation recoveries originally booked gross. Net impact -€0.8M.",
            "senior.reserving.actuary@bricksurance.eu",
            t - timedelta(days=10),
            "chief.actuary@bricksurance.eu",
            t - timedelta(days=7),
            "approved",
            ["s0501.R0310.gross_claims_incurred:motor_liability"],
            "new", None,
        ))
    elif qi == 1:
        # Q2: liability tail extension (precursor to Q4 renewal)
        overlay_rows.append((
            qi_id, "reserving_pnc", q, "general_liability", None,
            3_200_000.0, "increase", "tail_extension",
            "Tail factor extension applied for general liability following emergence of long-tail PI claims. Initial application; renewed each subsequent quarter.",
            "senior.reserving.actuary@bricksurance.eu",
            t - timedelta(days=10),
            "chief.actuary@bricksurance.eu",
            t - timedelta(days=7),
            "approved",
            ["s0501.R0310.gross_claims_incurred:general_liability", "s2606.R0010.premium_reserve_risk:general_liability"],
            "new", None,
        ))
    else:
        # Q3: life lapse methodology refinement
        overlay_rows.append((
            qi_id, "reserving_life", q, "life_unit_linked", None,
            1_500_000.0, "increase", "methodology_judgement",
            "Lapse assumption for unit-linked refined upward following observed Q3 experience deterioration. Best-estimate lapse rate 1.45% → 1.65%.",
            "senior.reserving.actuary@bricksurance.eu",
            t - timedelta(days=10),
            "chief.actuary@bricksurance.eu",
            t - timedelta(days=7),
            "approved",
            ["s1201.R0010.best_estimate_life", "lifeuw.R0010.lapse_risk"],
            "new", None,
        ))

spark.createDataFrame(
    overlay_rows,
    "overlay_id STRING, model_name STRING, quarter STRING, line_of_business STRING, accident_year INT, "
    "magnitude_eur DOUBLE, direction STRING, category STRING, rationale STRING, author STRING, "
    "created_at TIMESTAMP, approver STRING, approved_at TIMESTAMP, status STRING, "
    "linked_qrt_cells ARRAY<STRING>, lifecycle_action STRING, prior_overlay_id STRING",
).write.mode("append").saveAsTable("`6_gov_overlays`")

print(f"✓ Seeded {len(overlay_rows)} overlays (3 Q4 headline + 3 historical).")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Seed diagnostics snapshots
# MAGIC
# MAGIC Per (model, quarter) — variance vs prior, reasonableness check, triangle consistency.
# MAGIC The Lab Diagnostics tab reads from this.

# COMMAND ----------

spark.sql("DELETE FROM `6_gov_model_diagnostics`")

import random
random.seed(42)

diag_rows = []

DIAG_TEMPLATES = {
    "reserving_pnc": [
        ("variance_vs_prior_reserves_pct", -2.0, 8.0, "reserves vs prior quarter (%)"),
        ("triangle_consistency_score",      0.85, 1.0, "actual vs expected on Q-1 cohort"),
        ("ifrs17_pop_consistency_pct",     -3.0, 3.0,  "vs IFRS 17 best-estimate (%)"),
    ],
    "reserving_life": [
        ("variance_vs_prior_be_pct",       -1.5, 4.0,  "best-estimate vs prior (%)"),
        ("lapse_assumption_drift_bps",    -10.0, 20.0, "lapse vs Q-1 (bps)"),
    ],
    "standard_formula": [
        ("scr_variance_vs_prior_pct",      -3.0, 6.0,  "SCR vs prior quarter (%)"),
        ("submodule_consistency_pass_n",    9.0, 10.0, "of 10 sub-modules within tolerance"),
    ],
    "igloo_cat": [
        ("var_99_5_eur_m",                400.0, 600.0, "99.5% VaR (€M)"),
        ("tvar_99_5_eur_m",               500.0, 750.0, "99.5% TVaR (€M)"),
        ("reasonableness_vs_aal_pct",      80.0, 130.0, "modelled / AAL (%)"),
    ],
    "prophet_life": [
        ("be_5000_scenarios_eur_m",       1900.0, 2100.0, "best estimate over 5K scenarios (€M)"),
        ("convergence_score",              0.95,    1.0, "scenario convergence"),
    ],
}

for model_name, _ in models_for_promotion:
    for q, t in quarters:
        for diag_name, lo, hi, label in DIAG_TEMPLATES.get(model_name, []):
            # Deterministic value within range
            mid = (lo + hi) / 2
            spread = (hi - lo) * 0.3
            val = mid + spread * (random.random() - 0.5) * 2
            diag_rows.append((
                model_name, f"{q} v1", q, diag_name, val, label, lo, hi, lo <= val <= hi, t,
            ))

spark.createDataFrame(
    diag_rows,
    "model_name STRING, version_label STRING, reporting_period STRING, diagnostic_name STRING, "
    "metric_value DOUBLE, metric_text STRING, threshold_low DOUBLE, threshold_high DOUBLE, "
    "passed BOOLEAN, computed_at TIMESTAMP",
).write.mode("append").saveAsTable("`6_gov_model_diagnostics`")

print(f"✓ Seeded {len(diag_rows)} diagnostics rows.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Verify

# COMMAND ----------

for tbl in ["6_gov_overlays", "6_gov_promotions", "6_gov_model_aliases", "6_gov_model_diagnostics"]:
    n = spark.table(tbl).count()
    print(f"  {tbl:35s} {n:>6,} rows")

print()
print("Sample — current overlays for Q4:")
display(spark.sql(f"""
    SELECT quarter, model_name, line_of_business, magnitude_eur, direction, category, status, lifecycle_action
    FROM `6_gov_overlays` WHERE quarter = '{year}-Q4'
    ORDER BY ABS(magnitude_eur) DESC
"""))

print("Sample — Q4 promotions per model:")
display(spark.sql(f"""
    SELECT model_name, model_type, to_version, status, approver
    FROM `6_gov_promotions` WHERE quarter = '{year}-Q4' OR quarter = '{int(year)+1}-Q1'
    ORDER BY model_name, quarter
"""))

print()
print("=" * 60)
print("  Governance bootstrap complete.")
print("=" * 60)

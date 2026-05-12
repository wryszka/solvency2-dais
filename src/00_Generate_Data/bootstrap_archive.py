# Databricks notebook source
# MAGIC %md
# MAGIC # Bootstrap Archive Data (Q1–Q3)
# MAGIC
# MAGIC Generates synthetic data for Q1, Q2, Q3 of the reporting year.
# MAGIC These quarters form the "previously completed" QRT archive that exists
# MAGIC before the live demo begins.
# MAGIC
# MAGIC **Run once during initial deployment.** Q4 is left for the live demo.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "main")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("reporting_year", "2025")
dbutils.widgets.text("entity_name", "Bricksurance SE")
dbutils.widgets.text("include_q4", "true")  # set false to leave Q4 for the live demo

catalog = dbutils.widgets.get("catalog_name")
schema = dbutils.widgets.get("schema_name")
reporting_year = dbutils.widgets.get("reporting_year")
entity_name = dbutils.widgets.get("entity_name")
include_q4 = dbutils.widgets.get("include_q4").lower() == "true"

quarters = [1, 2, 3, 4] if include_q4 else [1, 2, 3]
print(f"Bootstrapping archive for {reporting_year} Q{quarters[0]}–Q{quarters[-1]}")
print(f"Catalog: {catalog}")
print(f"Schema:  {schema}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Generate data for Q1, Q2, Q3

# COMMAND ----------

for quarter in quarters:
    rp = f"{reporting_year}-Q{quarter}"
    print(f"\n{'='*70}")
    print(f"  Generating data for {rp}")
    print(f"{'='*70}\n")

    dbutils.notebook.run(
        "./generate_data",
        timeout_seconds=900,
        arguments={
            "catalog_name": catalog,
            "schema_name": schema,
            "reporting_period": rp,
            "mode": "full_reset" if quarter == quarters[0] else "append",
            "entity_name": entity_name,
        }
    )
    print(f"  {rp} complete.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify

# COMMAND ----------

spark.sql(f"USE CATALOG {catalog}")
spark.sql(f"USE SCHEMA {schema}")

tables = [
    # Config
    "0_cfg_feed_sla", "0_cfg_bafin_questions", "0_cfg_assumption_versions",
    # Non-life bronze
    "1_raw_counterparties", "1_raw_assets", "1_raw_policies", "1_raw_premiums",
    "1_raw_claims", "1_raw_expenses",
    "1_raw_reinsurance", "1_raw_claims_triangles", "1_raw_risk_factors",
    "7_ref_scr_parameters",
    "1_raw_volume_measures", "1_raw_exposures",
    "4_eng_stochastic_results", "4_eng_prophet_results",
    "1_raw_own_funds", "1_raw_balance_sheet",
    # Life bronze
    "1_raw_life_policies", "1_raw_life_claims", "1_raw_life_lapses",
    "1_raw_life_mortality_experience", "1_raw_life_assumptions", "1_raw_life_reserves",
]

print("=" * 70)
print("  ARCHIVE DATA SUMMARY")
print("=" * 70)

for t in tables:
    try:
        total = spark.table(t).count()
        # Count distinct reporting periods for tables that have the column
        try:
            periods = [r["reporting_period"] for r in spark.sql(f"SELECT DISTINCT reporting_period FROM {t} ORDER BY reporting_period").collect()]
            print(f"  {t:30s} {total:>10,} rows  periods: {', '.join(periods)}")
        except Exception:
            print(f"  {t:30s} {total:>10,} rows  (master table)")
    except Exception:
        print(f"  {t:30s} NOT FOUND")

print("=" * 70)
print(f"  Archive bootstrap complete — periods Q{quarters[0]}–Q{quarters[-1]} {reporting_year}.")
print("=" * 70)

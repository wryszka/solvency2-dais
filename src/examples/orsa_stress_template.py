# Databricks notebook source
# MAGIC %md
# MAGIC # Worked example — Defining a new ORSA stress scenario
# MAGIC
# MAGIC > **Worked example — illustrative methodology, not production actuarial science.**
# MAGIC
# MAGIC ## What this notebook does
# MAGIC
# MAGIC Shows how to add a new ORSA stress scenario to the platform. Three steps:
# MAGIC
# MAGIC 1. Define the scenario in `0_cfg_orsa_scenarios` (one row + a list of shocks).
# MAGIC 2. Trigger the platform's ORSA engine via the `/api/orsa/run` endpoint.
# MAGIC 3. Inspect the projected capital path + AI-generated narrative.
# MAGIC
# MAGIC The point is: the *actuary* defines the scenario as a config. The *platform*
# MAGIC handles the projection mechanics, persistence, and narrative generation.
# MAGIC No code change required to add a scenario.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("base_period", "2025-Q4")

catalog = dbutils.widgets.get("catalog_name")
schema  = dbutils.widgets.get("schema_name")
period  = dbutils.widgets.get("base_period")

import json

spark.sql(f"USE CATALOG {catalog}")
spark.sql(f"USE SCHEMA {schema}")

# COMMAND ----------

# MAGIC %md ## 1. Define a new scenario as a config row
# MAGIC
# MAGIC Each scenario lists the SF sub-modules whose charge gets multiplied. The engine
# MAGIC re-runs the SF aggregation with the shocked sub-module charges and projects
# MAGIC three years forward using the business-plan growth + ratio assumptions.

# COMMAND ----------

new_scenario = {
    "scenario_id":  "example_inflation_shock",
    "name":         "Example — sustained inflation shock",
    "description":  "Worked example: 4-pp uplift to general inflation sustained over 3 years. "
                    "Hits reserve risk (claims inflation), longevity (life), expense (life + non-life).",
    "shocks": json.dumps([
        {"module": "non_life", "sub_module": "premium_reserve", "multiplier": 1.15},
        {"module": "life",     "sub_module": "longevity",       "multiplier": 1.10},
        {"module": "life",     "sub_module": "expense",         "multiplier": 1.20},
        {"module": "health",   "sub_module": "expense",         "multiplier": 1.20},
    ]),
}

spark.sql(f"""
    DELETE FROM `0_cfg_orsa_scenarios` WHERE scenario_id = '{new_scenario['scenario_id']}'
""")
spark.sql(f"""
    INSERT INTO `0_cfg_orsa_scenarios` (scenario_id, name, description, shocks_json)
    VALUES ('{new_scenario['scenario_id']}',
            '{new_scenario['name']}',
            '{new_scenario['description'].replace("'", "''")}',
            '{new_scenario['shocks']}')
""")

print(f"✓ Inserted scenario {new_scenario['scenario_id']} into 0_cfg_orsa_scenarios")
display(spark.sql("SELECT scenario_id, name FROM `0_cfg_orsa_scenarios` ORDER BY scenario_id"))

# COMMAND ----------

# MAGIC %md ## 2. Trigger the ORSA engine
# MAGIC
# MAGIC In the app, the user clicks "Run scenario" on the ORSA page. Behind the scenes
# MAGIC that POSTs to `/api/orsa/run` which:
# MAGIC
# MAGIC   - reads the base SCR + own funds for the period
# MAGIC   - applies the shocks
# MAGIC   - re-runs the SF aggregation with shocked charges
# MAGIC   - projects 3 years using `0_cfg_business_plan` growth + ratio assumptions
# MAGIC   - persists the result to `gold_orsa_results`
# MAGIC
# MAGIC From this notebook you'd call the API directly. Skipping the HTTP call here —
# MAGIC the next cell shows you the result format.

# COMMAND ----------

# MAGIC %md ## 3. After running — inspect the capital path

# COMMAND ----------

# Show what the engine would produce. Real run lives in the ORSA page.
display(spark.sql(f"""
    SELECT scenario_id, projection_year, year_offset, is_base,
           ROUND(scr_eur/1e6, 1) AS scr_eur_m,
           ROUND(eligible_own_funds_eur/1e6, 1) AS of_eur_m,
           solvency_ratio_pct
    FROM `gold_orsa_results`
    WHERE base_period = '{period}'
    ORDER BY scenario_id, year_offset, is_base DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Take-aways
# MAGIC
# MAGIC - Adding a scenario is a *config change*, not a code change. The platform owns
# MAGIC   the projection mechanics; the actuary owns the scenario design.
# MAGIC - The result is a Delta table (`gold_orsa_results`) — versioned, queryable, joinable.
# MAGIC - The AI narrative generation (`/api/orsa/narrative`) reads this table plus the
# MAGIC   business plan and produces an SFCR-grade narrative paragraph that cites every
# MAGIC   number back to its source.
# MAGIC - Compare to running this in a spreadsheet: no version, no audit, no narrative,
# MAGIC   no automatic flow into the SFCR.

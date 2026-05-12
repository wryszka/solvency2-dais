# Databricks notebook source
# MAGIC %md
# MAGIC # Prophet Life Model — Export, Run, Import
# MAGIC
# MAGIC Mirrors the Igloo notebook but for the life book. Simulates the integration
# MAGIC with an external life modelling engine (Prophet / RAFM / MoSes) that takes
# MAGIC in-force data + assumptions and produces best estimate liabilities and
# MAGIC life UW SCR sub-modules (mortality, longevity, lapse, expense, life cat).
# MAGIC
# MAGIC **Workflow:**
# MAGIC 1. Export life in-force + assumptions to a UC Volume (CSV file sent to Prophet)
# MAGIC 2. Run stochastic projection (5,000 scenarios)
# MAGIC 3. Import results from Volume (VaR/TVaR by LoB × sub-module)
# MAGIC 4. Write to `prophet_run_results` table for downstream DLT consumption
# MAGIC 5. Log the run to `4_eng_life_run_log` for audit trail
# MAGIC
# MAGIC In production, steps 2-3 would be an API call to the Prophet server or a
# MAGIC file watch on SFTP. Here we mock it using pre-generated stochastic output.

# COMMAND ----------

import uuid
import time
from datetime import datetime, timezone

# COMMAND ----------

try:
    catalog = dbutils.widgets.get("catalog_name")
except Exception:
    catalog = "main"
try:
    schema = dbutils.widgets.get("schema_name")
except Exception:
    schema = "solvency2_workbench"

spark.sql(f"USE CATALOG {catalog}")
spark.sql(f"USE SCHEMA {schema}")

# Reporting period: explicit widget wins, otherwise pick the latest available.
try:
    rp_widget = dbutils.widgets.get("reporting_period")
except Exception:
    rp_widget = ""
if rp_widget:
    rp = rp_widget
else:
    rp = spark.sql("SELECT MAX(reporting_period) FROM `1_raw_life_reserves`").first()[0]

run_id = str(uuid.uuid4())[:8]
print(f"Catalog:           {catalog}")
print(f"Schema:            {schema}")
print(f"Reporting period:  {rp}")
print(f"Prophet run ID:    {run_id}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1: Export In-Force + Assumptions to Volume (Prophet Input)

# COMMAND ----------

# Volume for Prophet inputs/outputs — separate from Igloo to keep audit trails clean
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.`4_eng_life_exchange`")
volume_base = f"/Volumes/{catalog}/{schema}/4_eng_life_exchange"
input_path = f"{volume_base}/input_inforce_{rp.replace('-', '')}.csv"

# Build the in-force snapshot Prophet would consume — aggregated to LoB level
# (a real Prophet run would consume per-policy data; aggregation keeps the demo fast)
inforce_df = spark.sql(f"""
    SELECT lob_code, lob_name, lob_eiopa_name,
           in_force_count, avg_sum_assured_or_income_eur,
           best_estimate_liability_eur, risk_margin_eur,
           assumption_version, reporting_period
    FROM `1_raw_life_reserves`
    WHERE reporting_period = '{rp}'
""")
inforce_count = inforce_df.count()

inforce_df.toPandas().to_csv(input_path, index=False)
print(f"Exported {inforce_count} life LoB in-force aggregates to:")
print(f"  {input_path}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2: Run Prophet Stochastic Projection (Mock)
# MAGIC
# MAGIC In production this would be:
# MAGIC ```
# MAGIC POST https://prophet-server.internal/api/v1/runs
# MAGIC {
# MAGIC   "input_file": "input_inforce_2025Q4.csv",
# MAGIC   "scenarios": 5000,
# MAGIC   "horizon_years": 60,
# MAGIC   "modules": ["mortality", "longevity", "lapse", "expense", "life_cat"],
# MAGIC   "model_version": "7.4.2"
# MAGIC }
# MAGIC ```

# COMMAND ----------

print("=" * 60)
print("  PROPHET LIFE STOCHASTIC ENGINE v7.4.2")
print("=" * 60)
print(f"  Input:        {inforce_count} LoB in-force aggregates")
print(f"  Scenarios:    5,000")
print(f"  Horizon:      60 years")
print(f"  Sub-modules:  mortality, longevity, lapse, expense, life_cat")
print("=" * 60)
print()
print("  Initializing actuarial assumptions...")
time.sleep(1)
print("  Building cashflow projection grid...")
time.sleep(2)
print("  Running 5,000 scenarios...")
time.sleep(3)
print("  Aggregating sub-module VaR / TVaR...")
time.sleep(1)
print("  Projection complete.")
print()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3: Import Results from Volume (Prophet Output)

# COMMAND ----------

# Read the pre-generated 4_eng_prophet_results (our mock output)
results_df = spark.sql(f"""
    SELECT lob_code, lob_name, sub_module,
           var_eur, tvar_eur, scenario_count, model_version,
           reporting_period
    FROM `4_eng_prophet_results`
    WHERE reporting_period = '{rp}'
""")
result_count = results_df.count()
output_path = f"{volume_base}/output_results_{rp.replace('-', '')}.csv"
results_df.toPandas().to_csv(output_path, index=False)
print(f"Prophet output received: {result_count} result rows")
print(f"  Output file: {output_path}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4: Write Results to Delta Table

# COMMAND ----------

from pyspark.sql.functions import lit
reimported = spark.read.csv(output_path, header=True, inferSchema=True)
reimported = reimported.withColumn("prophet_run_id", lit(run_id))

reimported.write.format("delta").mode("overwrite").option("overwriteSchema", "true") \
    .saveAsTable(f"{catalog}.{schema}.prophet_run_results")
spark.sql(
    f"COMMENT ON TABLE {catalog}.{schema}.prophet_run_results IS "
    "'Prophet life stochastic output imported from Volume — VaR/TVaR by LoB and SCR sub-module'"
)
cnt = spark.table(f"{catalog}.{schema}.prophet_run_results").count()
print(f"Wrote {cnt} rows to prophet_run_results (run_id: {run_id})")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 5: Log the Run

# COMMAND ----------

from pyspark.sql.types import StructType, StructField, StringType, IntegerType, TimestampType

run_log = [{
    "run_id": run_id,
    "reporting_period": rp,
    "model_name": "Prophet",
    "model_version": "7.4.2",
    "num_scenarios": 5000,
    "num_modules": 5,
    "inforce_lob_count": inforce_count,
    "result_count": result_count,
    "input_path": input_path,
    "output_path": output_path,
    "status": "SUCCESS",
    "started_at": datetime.now(timezone.utc),
    "completed_at": datetime.now(timezone.utc),
}]
schema_def = StructType([
    StructField("run_id", StringType()),
    StructField("reporting_period", StringType()),
    StructField("model_name", StringType()),
    StructField("model_version", StringType()),
    StructField("num_scenarios", IntegerType()),
    StructField("num_modules", IntegerType()),
    StructField("inforce_lob_count", IntegerType()),
    StructField("result_count", IntegerType()),
    StructField("input_path", StringType()),
    StructField("output_path", StringType()),
    StructField("status", StringType()),
    StructField("started_at", TimestampType()),
    StructField("completed_at", TimestampType()),
])

log_df = spark.createDataFrame(run_log, schema=schema_def)
log_df.write.format("delta").mode("append").saveAsTable(f"{catalog}.{schema}.`4_eng_life_run_log`")
spark.sql(
    f"COMMENT ON TABLE {catalog}.{schema}.`4_eng_life_run_log` IS "
    "'Prophet life run audit log — timestamps, scenario count, file paths'"
)

# COMMAND ----------

print("=" * 60)
print("  PROPHET RUN COMPLETE")
print("=" * 60)
print(f"  Run ID:       {run_id}")
print(f"  Period:       {rp}")
print(f"  Sub-modules:  mortality, longevity, lapse, expense, life_cat")
print(f"  Result rows:  {result_count}")
print("=" * 60)

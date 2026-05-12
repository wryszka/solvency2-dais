# Databricks notebook source
# MAGIC %md
# MAGIC # Worked example — Chain Ladder reserving (P&C)
# MAGIC
# MAGIC > **Worked example — illustrative methodology, not production actuarial science.**
# MAGIC > Replace the chain-ladder logic with your own validated method or your
# MAGIC > consultancy's IP. The point of this notebook is to show how a reserving
# MAGIC > method becomes a *governed UC artefact* — versioned, aliased, lineage-tracked.
# MAGIC
# MAGIC ## What this notebook does
# MAGIC
# MAGIC 1. Reads the Q4 2025 synthetic claims triangle (`1_raw_claims_triangles`).
# MAGIC 2. Computes development factors from the triangle (volume-weighted average).
# MAGIC 3. Applies the factors plus a tail extension to project ultimates by LoB and AY.
# MAGIC 4. Registers the result as `example_reserving_chain_ladder` MLflow pyfunc in UC.
# MAGIC 5. Sets the `candidate` alias on the new version (NEVER auto-promotes to production).
# MAGIC
# MAGIC ## Why this matters
# MAGIC
# MAGIC The methodology (chain ladder) is illustrative — but the *infrastructure* around it
# MAGIC is production-grade. Same registration + alias + diagnostics pattern as the
# MAGIC `reserving_pnc` production model in `src/02_Reserving_Model/`.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("reporting_period", "2025-Q4")

catalog = dbutils.widgets.get("catalog_name")
schema  = dbutils.widgets.get("schema_name")
period  = dbutils.widgets.get("reporting_period")

import mlflow
import mlflow.pyfunc
from mlflow.models.signature import ModelSignature
from mlflow.types.schema import Schema, ColSpec
from mlflow import MlflowClient
import pandas as pd
import numpy as np
import json
import tempfile

mlflow.set_registry_uri("databricks-uc")

# COMMAND ----------

# MAGIC %md ## 1. Pull the triangle

# COMMAND ----------

triangle = spark.sql(f"""
    SELECT lob_name AS line_of_business,
           CAST(accident_year AS INT)     AS accident_year,
           CAST(development_period AS INT) AS development_year,
           CAST(cumulative_paid AS DOUBLE) AS cumulative_paid
    FROM {catalog}.{schema}.`1_raw_claims_triangles`
    WHERE reporting_period = '{period}'
""").toPandas()

display(triangle.head(20))
print(f"\n{len(triangle)} triangle rows · "
      f"{triangle['line_of_business'].nunique()} LoBs · "
      f"AY {triangle['accident_year'].min()}-{triangle['accident_year'].max()}")

# COMMAND ----------

# MAGIC %md ## 2. Compute volume-weighted development factors per LoB

# COMMAND ----------

def compute_development_factors(df: pd.DataFrame) -> dict[str, list[float]]:
    """For each LoB and dev period d, factor = sum(paid at d+1) / sum(paid at d)
    over all accident years where both points exist.
    """
    factors: dict[str, list[float]] = {}
    for lob, g in df.groupby("line_of_business"):
        max_dev = int(g["development_year"].max())
        per_lob: list[float] = []
        for d in range(max_dev):
            num = g[g["development_year"] == d + 1]
            den = g[g["development_year"] == d]
            paired = num.merge(den, on="accident_year", suffixes=("_n", "_d"))
            if len(paired) == 0:
                per_lob.append(1.0)
                continue
            f = paired["cumulative_paid_n"].sum() / paired["cumulative_paid_d"].sum()
            per_lob.append(round(float(f), 4))
        factors[lob] = per_lob
    return factors


development_factors = compute_development_factors(triangle)
for lob, fs in development_factors.items():
    print(f"  {lob:25s}  factors = {fs}")

# COMMAND ----------

# MAGIC %md ## 3. Define the pyfunc + signature (same shape as production model)

# COMMAND ----------

class ChainLadderExample(mlflow.pyfunc.PythonModel):
    """Chain-ladder reserving — illustrative."""

    def load_context(self, context):
        with open(context.artifacts["parameters"], "r") as f:
            self.params = json.load(f)

    def predict(self, context, model_input, params=None):
        p = self.params
        df = model_input.copy()

        latest = df.sort_values(["line_of_business", "accident_year", "development_year"]).groupby(
            ["line_of_business", "accident_year"], as_index=False
        ).agg(latest_paid=("cumulative_paid", "last"),
              latest_dev=("development_year", "max"))

        out = []
        for _, r in latest.iterrows():
            lob = r["line_of_business"]
            ay = int(r["accident_year"])
            paid = float(r["latest_paid"])
            dev = int(r["latest_dev"])
            factors = p["development_factors"].get(lob, [1.0])
            tail = float(p["tail_factors"].get(lob, 1.02))
            ult = paid
            for f in factors[dev:]:
                ult *= float(f)
            ult *= tail
            out.append({
                "line_of_business": lob,
                "accident_year": ay,
                "ultimate_eur": round(ult, 2),
                "ibnr_eur": round(max(ult - paid, 0.0), 2),
            })
        return pd.DataFrame(out)


input_schema = Schema([
    ColSpec("string", "line_of_business"),
    ColSpec("integer", "accident_year"),
    ColSpec("integer", "development_year"),
    ColSpec("double", "cumulative_paid"),
])
output_schema = Schema([
    ColSpec("string", "line_of_business"),
    ColSpec("integer", "accident_year"),
    ColSpec("double", "ultimate_eur"),
    ColSpec("double", "ibnr_eur"),
])
signature = ModelSignature(inputs=input_schema, outputs=output_schema)

# COMMAND ----------

# MAGIC %md ## 4. Register as `example_reserving_chain_ladder` (separate from production namespace)

# COMMAND ----------

params = {
    "calibration_label": f"chain_ladder_{period}",
    "calibration_period": period,
    "development_factors": development_factors,
    "tail_factors": {lob: 1.02 for lob in development_factors},
    "method": "volume_weighted_chain_ladder",
}

with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
    json.dump(params, f)
    params_path = f.name

model_name = f"{catalog}.{schema}.example_reserving_chain_ladder"

with mlflow.start_run(run_name=f"example_chain_ladder__{period}"):
    info = mlflow.pyfunc.log_model(
        artifact_path="model",
        python_model=ChainLadderExample(),
        artifacts={"parameters": params_path},
        registered_model_name=model_name,
        signature=signature,
        pip_requirements=["numpy", "pandas"],
    )

print(f"✓ Registered {model_name}")

# COMMAND ----------

# MAGIC %md ## 5. Set `candidate` alias — NEVER auto-promote to production

# COMMAND ----------

client = MlflowClient(registry_uri="databricks-uc")
versions = sorted(client.search_model_versions(f"name='{model_name}'"), key=lambda v: int(v.version))
latest = versions[-1].version
client.set_registered_model_alias(model_name, "candidate", latest)
print(f"✓ Alias 'candidate' → v{latest}")
print()
print("=" * 60)
print("This worked-example model is in the example_* namespace.")
print("It will NEVER be auto-promoted to production. To use it in")
print("close, the actuary must:")
print("  1. Validate the methodology against your firm's standards")
print("  2. Run the diagnostics suite")
print("  3. Use the Lab UI to promote candidate → production with sign-off")
print("=" * 60)

# COMMAND ----------

# MAGIC %md ## 6. Smoke test — load + predict

# COMMAND ----------

m = mlflow.pyfunc.load_model(f"models:/{model_name}@candidate")
result = m.predict(triangle)
display(result.head(20))
print(f"\nTotal IBNR across all LoBs / AYs: EUR {result['ibnr_eur'].sum():,.0f}")

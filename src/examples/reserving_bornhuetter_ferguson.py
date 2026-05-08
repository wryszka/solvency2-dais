# Databricks notebook source
# MAGIC %md
# MAGIC # Worked example — Bornhuetter-Ferguson reserving (P&C)
# MAGIC
# MAGIC > **Worked example — illustrative methodology, not production actuarial science.**
# MAGIC > Replace the BF logic with your own validated method or your consultancy's IP.
# MAGIC
# MAGIC ## What this notebook does
# MAGIC
# MAGIC Bornhuetter-Ferguson combines:
# MAGIC   - An expected loss ratio (a-priori expectation of losses, often from pricing)
# MAGIC   - The age-to-ultimate development factor from chain ladder
# MAGIC
# MAGIC Ultimate = paid + (ELR × premium × (1 − 1/age_to_ult_factor))
# MAGIC
# MAGIC BF dampens the volatility of pure chain ladder when triangles have
# MAGIC few claims at early development. It's the standard sanity-check method
# MAGIC paired with chain ladder.
# MAGIC
# MAGIC Same UC registration + alias pattern as `reserving_chain_ladder.py`.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2demo_v2")
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
import json
import tempfile

mlflow.set_registry_uri("databricks-uc")

# COMMAND ----------

# MAGIC %md ## 1. Pull triangle + premium volume

# COMMAND ----------

triangle = spark.sql(f"""
    SELECT lob_name AS line_of_business,
           CAST(accident_year AS INT)     AS accident_year,
           CAST(development_period AS INT) AS development_year,
           CAST(cumulative_paid AS DOUBLE) AS cumulative_paid
    FROM {catalog}.{schema}.`1_raw_claims_triangles`
    WHERE reporting_period = '{period}'
""").toPandas()

premiums = spark.sql(f"""
    SELECT lob_name AS line_of_business, CAST(YEAR(transaction_date) AS INT) AS accident_year,
           CAST(SUM(gwp) AS DOUBLE) AS earned_premium
    FROM {catalog}.{schema}.`1_raw_premiums`
    WHERE reporting_period <= '{period}'
    GROUP BY lob_name, YEAR(transaction_date)
""").toPandas()

# Expected loss ratio (a-priori) — illustrative, normally from pricing
elr = {
    "property":          0.65,
    "motor_liability":   0.78,
    "general_liability": 0.72,
    "credit_suretyship": 0.55,
}

# COMMAND ----------

# MAGIC %md ## 2. Compute age-to-ultimate factors (volume-weighted)

# COMMAND ----------

def age_to_ultimate(df: pd.DataFrame) -> dict[str, list[float]]:
    """For each LoB compute the cumulative product factor from each dev period to ultimate."""
    # Volume-weighted dev factors per lob
    factors: dict[str, list[float]] = {}
    for lob, g in df.groupby("line_of_business"):
        max_dev = int(g["development_year"].max())
        per_lob: list[float] = []
        for d in range(max_dev):
            num = g[g["development_year"] == d + 1]
            den = g[g["development_year"] == d]
            paired = num.merge(den, on="accident_year", suffixes=("_n", "_d"))
            if len(paired) == 0:
                per_lob.append(1.0); continue
            per_lob.append(float(paired["cumulative_paid_n"].sum() / paired["cumulative_paid_d"].sum()))
        # Cumulative product from each dev period onward + tail of 1.02
        cum = []
        prod = 1.02
        for f in reversed(per_lob):
            prod *= f
            cum.append(round(prod, 4))
        cum.reverse()
        factors[lob] = cum + [1.02]   # last = tail
    return factors


age_to_ult = age_to_ultimate(triangle)
for lob, fs in age_to_ult.items():
    print(f"  {lob:25s}  age-to-ult factors = {fs}")

# COMMAND ----------

# MAGIC %md ## 3. Define BF pyfunc

# COMMAND ----------

class BornhuetterFergusonExample(mlflow.pyfunc.PythonModel):
    def load_context(self, context):
        with open(context.artifacts["parameters"], "r") as f:
            self.params = json.load(f)

    def predict(self, context, model_input, params=None):
        p = self.params
        df = model_input.copy()
        latest = df.sort_values(["line_of_business", "accident_year", "development_year"]).groupby(
            ["line_of_business", "accident_year"], as_index=False
        ).agg(latest_paid=("cumulative_paid", "last"),
              latest_dev=("development_year", "max"),
              earned_premium=("earned_premium", "first"))

        out = []
        for _, r in latest.iterrows():
            lob = r["line_of_business"]
            ay = int(r["accident_year"])
            paid = float(r["latest_paid"])
            dev = int(r["latest_dev"])
            ep = float(r["earned_premium"] or 0)
            elr_lob = float(p["elr"].get(lob, 0.7))
            atu = p["age_to_ult"].get(lob, [1.02])
            atu_at_dev = float(atu[dev]) if dev < len(atu) else float(atu[-1])
            unreported_factor = 1.0 - 1.0 / max(atu_at_dev, 0.001)
            bf_ult = paid + elr_lob * ep * unreported_factor
            out.append({
                "line_of_business": lob,
                "accident_year": ay,
                "bf_ultimate_eur": round(bf_ult, 2),
                "bf_ibnr_eur": round(max(bf_ult - paid, 0.0), 2),
            })
        return pd.DataFrame(out)


signature = ModelSignature(
    inputs=Schema([
        ColSpec("string", "line_of_business"),
        ColSpec("integer", "accident_year"),
        ColSpec("integer", "development_year"),
        ColSpec("double", "cumulative_paid"),
        ColSpec("double", "earned_premium"),
    ]),
    outputs=Schema([
        ColSpec("string", "line_of_business"),
        ColSpec("integer", "accident_year"),
        ColSpec("double", "bf_ultimate_eur"),
        ColSpec("double", "bf_ibnr_eur"),
    ]),
)

# COMMAND ----------

# MAGIC %md ## 4. Register

# COMMAND ----------

params = {
    "calibration_label": f"bornhuetter_ferguson_{period}",
    "calibration_period": period,
    "elr": elr,
    "age_to_ult": age_to_ult,
    "method": "bornhuetter_ferguson",
}

with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
    json.dump(params, f); params_path = f.name

model_name = f"{catalog}.{schema}.example_reserving_bornhuetter_ferguson"

with mlflow.start_run(run_name=f"example_bf__{period}"):
    mlflow.pyfunc.log_model(
        artifact_path="model",
        python_model=BornhuetterFergusonExample(),
        artifacts={"parameters": params_path},
        registered_model_name=model_name,
        signature=signature,
        pip_requirements=["numpy", "pandas"],
    )

client = MlflowClient(registry_uri="databricks-uc")
versions = sorted(client.search_model_versions(f"name='{model_name}'"), key=lambda v: int(v.version))
client.set_registered_model_alias(model_name, "candidate", versions[-1].version)
print(f"✓ Registered {model_name} as candidate v{versions[-1].version}")

# COMMAND ----------

# MAGIC %md ## 5. Compare BF ultimate vs chain ladder ultimate

# COMMAND ----------

bf_input = triangle.merge(premiums, on=["line_of_business", "accident_year"], how="left")
bf_input["earned_premium"] = bf_input["earned_premium"].fillna(0.0)
bf_model = mlflow.pyfunc.load_model(f"models:/{model_name}@candidate")
bf_out = bf_model.predict(bf_input)
display(bf_out.head(15))
print(f"\nBF total IBNR: EUR {bf_out['bf_ibnr_eur'].sum():,.0f}")
print("Compare against chain-ladder example to see the smoothing effect.")

# Databricks notebook source
# MAGIC %md
# MAGIC # Reserving Models — Register in Unity Catalog
# MAGIC
# MAGIC Registers two MLflow pyfunc models in Unity Catalog:
# MAGIC - `reserving_pnc`   — chain-ladder over P&C claims triangles
# MAGIC - `reserving_life`  — best-estimate life reserves projection
# MAGIC
# MAGIC Both are mock-quality actuarial science. The point of registering them is the
# MAGIC governance interface — versions, aliases, lineage, audit. The methodology itself
# MAGIC is a worked example. **Replace with your own validated method or your consultancy's IP.**
# MAGIC
# MAGIC Pattern mirrors the `standard_formula` registration in `src/03_QRT_S2501_SCR/`.
# MAGIC Two versions per model: production (current calibration) + candidate (recalibration in review).

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2_workbench")

catalog = dbutils.widgets.get("catalog_name")
schema = dbutils.widgets.get("schema_name")

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

# Idempotency: skip both registrations if both pyfunc models already have
# 2+ versions with production + candidate aliases. The per-version registration
# helper below also has its own per-calibration-label dedupe.
def _models_already_registered() -> bool:
    try:
        client = MlflowClient(registry_uri="databricks-uc")
        for m in [f"{catalog}.{schema}.reserving_pnc", f"{catalog}.{schema}.reserving_life"]:
            versions = client.search_model_versions(f"name='{m}'")
            if len(versions) < 2:
                return False
            aliases_seen = set()
            for v in versions:
                for a in (v.aliases or []):
                    aliases_seen.add(a)
            if "production" not in aliases_seen or "candidate" not in aliases_seen:
                return False
        return True
    except Exception:
        return False


if _models_already_registered():
    print(f"✓ reserving_pnc + reserving_life already have production + candidate aliases — skipping")
    dbutils.notebook.exit("ALREADY_REGISTERED")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Reserving — P&C (chain ladder)

# COMMAND ----------

class ChainLadderReservingModel(mlflow.pyfunc.PythonModel):
    """Chain-ladder reserving over claims triangles.

    Parameters (artefacts):
      - development_factors: dict[lob -> list of age-to-age factors]
      - tail_factors: dict[lob -> tail factor]
      - calibration_label: e.g. '2025-Q4 v1'

    Input DataFrame:
      - line_of_business, accident_year, development_year, cumulative_paid

    Output:
      - line_of_business, accident_year, ultimate_eur, ibnr_eur
    """

    def load_context(self, context):
        with open(context.artifacts["parameters"], "r") as f:
            self.params = json.load(f)

    def predict(self, context, model_input, params=None):
        p = self.params
        df = model_input.copy()

        # Take latest paid per (lob, accident_year)
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
            ibnr = max(ult - paid, 0.0)
            out.append({
                "line_of_business": lob,
                "accident_year": ay,
                "ultimate_eur": round(ult, 2),
                "ibnr_eur": round(ibnr, 2),
            })

        return pd.DataFrame(out)


pnc_input = Schema([
    ColSpec("string", "line_of_business"),
    ColSpec("integer", "accident_year"),
    ColSpec("integer", "development_year"),
    ColSpec("double", "cumulative_paid"),
])
pnc_output = Schema([
    ColSpec("string", "line_of_business"),
    ColSpec("integer", "accident_year"),
    ColSpec("double", "ultimate_eur"),
    ColSpec("double", "ibnr_eur"),
])
pnc_signature = ModelSignature(inputs=pnc_input, outputs=pnc_output)

# Calibration v1 (current production) — illustrative factor set
pnc_params_v1 = {
    "calibration_label": "2025-Q4 v1",
    "development_factors": {
        "property":          [1.45, 1.18, 1.08, 1.04, 1.02],
        "motor_liability":   [1.65, 1.35, 1.15, 1.08, 1.04, 1.02, 1.01],
        "general_liability": [1.85, 1.50, 1.25, 1.12, 1.06, 1.03, 1.02],
        "credit_suretyship": [1.30, 1.12, 1.05, 1.02],
    },
    "tail_factors": {
        "property":          1.02,
        "motor_liability":   1.04,
        "general_liability": 1.04,
        "credit_suretyship": 1.02,
    },
}

# Calibration v2 (candidate) — slightly tighter tail on motor based on 2024-2025 emergence
pnc_params_v2 = {
    "calibration_label": "2026-Q1 v1-rc1",
    "development_factors": pnc_params_v1["development_factors"],
    "tail_factors": {
        "property":          1.02,
        "motor_liability":   1.03,
        "general_liability": 1.05,
        "credit_suretyship": 1.02,
    },
}

# COMMAND ----------

def register_pyfunc_with_params(model_name, py_model, signature, params_dict, comment):
    # Idempotent: skip re-registration if a version with this calibration_label
    # already exists. Avoids accumulating duplicate versions on every notebook run.
    try:
        client = MlflowClient(registry_uri="databricks-uc")
        existing = client.search_model_versions(f"name='{model_name}'")
        for v in existing:
            if v.tags and v.tags.get("calibration_label") == params_dict["calibration_label"]:
                print(f"  ↺ {model_name} v{v.version} already has calibration {params_dict['calibration_label']} — skipping")
                return
    except Exception:
        pass

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(params_dict, f)
        params_path = f.name
    with mlflow.start_run(run_name=f"{model_name.split('.')[-1]}__{params_dict['calibration_label']}"):
        info = mlflow.pyfunc.log_model(
            artifact_path="model",
            python_model=py_model,
            artifacts={"parameters": params_path},
            registered_model_name=model_name,
            signature=signature,
            pip_requirements=["numpy", "pandas"],
        )
        try:
            client = MlflowClient(registry_uri="databricks-uc")
            mv = info.registered_model_version
            client.set_model_version_tag(
                name=model_name, version=str(mv),
                key="calibration_label", value=params_dict["calibration_label"],
            )
        except Exception as e:
            print(f"  (could not set calibration_label tag: {e})")

pnc_model_name = f"{catalog}.{schema}.reserving_pnc"

register_pyfunc_with_params(pnc_model_name, ChainLadderReservingModel(), pnc_signature, pnc_params_v1,
                            "P&C reserving — chain ladder, v1 (2025-Q4 production)")
register_pyfunc_with_params(pnc_model_name, ChainLadderReservingModel(), pnc_signature, pnc_params_v2,
                            "P&C reserving — chain ladder, v2 (2026-Q1 candidate)")

print(f"✓ Registered {pnc_model_name} (v1, v2)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Reserving — Life

# COMMAND ----------

class LifeReservingModel(mlflow.pyfunc.PythonModel):
    """Best-estimate life reserves projection.

    Mock methodology — discounts expected cashflows under best-estimate assumptions.

    Input DataFrame:
      - product_line, projection_year, expected_cashflow

    Output:
      - product_line, best_estimate_eur, risk_margin_eur
    """

    def load_context(self, context):
        with open(context.artifacts["parameters"], "r") as f:
            self.params = json.load(f)

    def predict(self, context, model_input, params=None):
        p = self.params
        discount_rate = float(p["discount_rate_pct"]) / 100.0
        cor_rate = float(p["cost_of_capital_pct"]) / 100.0
        df = model_input.copy()

        out = []
        for product, g in df.groupby("product_line"):
            be = 0.0
            for _, r in g.iterrows():
                t = int(r["projection_year"])
                cf = float(r["expected_cashflow"])
                be += cf / ((1.0 + discount_rate) ** t)
            risk_margin = be * cor_rate * 5  # mock: 5-year average duration
            out.append({
                "product_line": product,
                "best_estimate_eur": round(be, 2),
                "risk_margin_eur": round(risk_margin, 2),
            })

        return pd.DataFrame(out)


life_input = Schema([
    ColSpec("string", "product_line"),
    ColSpec("integer", "projection_year"),
    ColSpec("double", "expected_cashflow"),
])
life_output = Schema([
    ColSpec("string", "product_line"),
    ColSpec("double", "best_estimate_eur"),
    ColSpec("double", "risk_margin_eur"),
])
life_signature = ModelSignature(inputs=life_input, outputs=life_output)

life_params_v1 = {
    "calibration_label": "2025-Q4 v1",
    "discount_rate_pct": 2.5,
    "cost_of_capital_pct": 6.0,
}

life_params_v2 = {
    "calibration_label": "2026-Q1 v1-rc1",
    "discount_rate_pct": 2.7,
    "cost_of_capital_pct": 6.0,
}

life_model_name = f"{catalog}.{schema}.reserving_life"

register_pyfunc_with_params(life_model_name, LifeReservingModel(), life_signature, life_params_v1,
                            "Life reserving — BE projection, v1 (2025-Q4 production)")
register_pyfunc_with_params(life_model_name, LifeReservingModel(), life_signature, life_params_v2,
                            "Life reserving — BE projection, v2 (2026-Q1 candidate)")

print(f"✓ Registered {life_model_name} (v1, v2)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Set aliases (production + candidate)
# MAGIC
# MAGIC Same alias scheme as `standard_formula`:
# MAGIC - `production` → v1 (active in close)
# MAGIC - `candidate`  → v2 (in review for next quarter)
# MAGIC
# MAGIC Also keep `Champion`/`Challenger` aliases for backward compat with the existing UI.

# COMMAND ----------

client = MlflowClient(registry_uri="databricks-uc")

for model_name in [pnc_model_name, life_model_name]:
    versions = sorted(
        client.search_model_versions(f"name='{model_name}'"),
        key=lambda v: int(v.version),
    )
    if len(versions) < 2:
        print(f"⚠ {model_name} has only {len(versions)} versions — re-run registration")
        continue
    v1 = versions[-2].version
    v2 = versions[-1].version
    client.set_registered_model_alias(model_name, "production", v1)
    client.set_registered_model_alias(model_name, "candidate",  v2)
    client.set_registered_model_alias(model_name, "Champion",   v1)   # backward compat
    client.set_registered_model_alias(model_name, "Challenger", v2)
    print(f"✓ {model_name}: production=v{v1}, candidate=v{v2}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Smoke test — load production and predict on real claims data

# COMMAND ----------

triangle = spark.sql(f"""
    SELECT lob_name AS line_of_business,
           CAST(accident_year AS INT) AS accident_year,
           CAST(development_period AS INT) AS development_year,
           CAST(cumulative_paid AS DOUBLE) AS cumulative_paid
    FROM {catalog}.{schema}.`1_raw_claims_triangles`
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {catalog}.{schema}.`1_raw_claims_triangles`)
""").toPandas()

if len(triangle) > 0:
    pnc_prod = mlflow.pyfunc.load_model(f"models:/{pnc_model_name}@production")
    out = pnc_prod.predict(triangle)
    print("✓ Reserving P&C production smoke test:")
    display(out.head(20))
else:
    print("⚠ No claims triangle data found — skipping smoke test")

# COMMAND ----------

print()
print("=" * 60)
print("  Reserving model registration complete.")
print("=" * 60)

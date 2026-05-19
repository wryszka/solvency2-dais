# Databricks notebook source
# MAGIC %md
# MAGIC # Standard Formula Model — Register in Unity Catalog
# MAGIC
# MAGIC Registers the **Solvency II Standard Formula** as an MLflow model in Unity Catalog.
# MAGIC
# MAGIC Two versions are registered:
# MAGIC - **Version 1 (2025 calibration):** EIOPA's 2025 parameter set
# MAGIC - **Version 2 (2026 calibration):** Updated factors reflecting new risk landscape
# MAGIC
# MAGIC The model takes risk factor charges as input and produces:
# MAGIC - Sub-module aggregations (market, non-life, etc.)
# MAGIC - BSCR via correlation matrix
# MAGIC - Operational risk add-on
# MAGIC - Final SCR
# MAGIC
# MAGIC **Why a model in UC?** Actuarial models need governance — who changed what,
# MAGIC when was it approved, which version was used for a given reporting period.
# MAGIC Unity Catalog gives us lineage, access control, and audit trail for free.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Define the Standard Formula Model

# COMMAND ----------

import mlflow
import mlflow.pyfunc
from mlflow.models.signature import ModelSignature
from mlflow.types.schema import Schema, ColSpec
import numpy as np
import pandas as pd
import json

# Define model signature for Unity Catalog registration
input_schema = Schema([
    ColSpec("string", "risk_module"),
    ColSpec("string", "risk_sub_module"),
    ColSpec("double", "charge_eur"),
])
output_schema = Schema([
    ColSpec("string", "component"),
    ColSpec("double", "amount_eur"),
    ColSpec("string", "description"),
])
sf_signature = ModelSignature(inputs=input_schema, outputs=output_schema)

# COMMAND ----------

class StandardFormulaModel(mlflow.pyfunc.PythonModel):
    """
    Solvency II Standard Formula SCR calculation engine.

    Parameters (stored as model artifacts):
      - bscr_correlation: 5x5 correlation matrix between BSCR modules
      - market_correlation: 6x6 correlation matrix between market sub-modules
      - nl_prem_res_factors: premium & reserve risk factors by LoB
      - nl_correlation: correlation matrix between non-life LoBs
      - op_risk_factor: operational risk as % of earned 1_raw_premiums
      - lac_dt_cap: loss-absorbing capacity of deferred taxes cap (%)
      - calibration_year: 2025 or 2026
    """

    def load_context(self, context):
        """Load model parameters from artifacts."""
        with open(context.artifacts["parameters"], "r") as f:
            self.params = json.load(f)

    def _aggregate_correlated(self, charges, corr_matrix, labels):
        """Aggregate charges using a correlation matrix: sqrt(sum_i sum_j rho_ij * C_i * C_j)."""
        n = len(labels)
        total = 0.0
        for i in range(n):
            for j in range(n):
                ci = charges.get(labels[i], 0.0)
                cj = charges.get(labels[j], 0.0)
                rho = corr_matrix[i][j]
                total += rho * ci * cj
        return np.sqrt(max(total, 0.0))

    def predict(self, context, model_input, params=None):
        """
        Calculate SCR from risk factor charges.

        Input DataFrame columns:
          - risk_module: market, default, non_life, health, life
          - risk_sub_module: e.g. equity, interest_rate, premium_reserve, etc.
          - charge_eur: the sub-module capital charge

        Returns DataFrame with SCR breakdown.
        """
        p = self.params

        # --- Market risk aggregation ---
        mkt_labels = p["market_labels"]
        mkt_corr = p["market_correlation"]
        mkt_charges = {}
        for _, row in model_input[model_input["risk_module"] == "market"].iterrows():
            mkt_charges[row["risk_sub_module"]] = float(row["charge_eur"])
        scr_market = self._aggregate_correlated(mkt_charges, mkt_corr, mkt_labels)

        # --- Default risk: simple sum of type 1 and type 2 ---
        default_rows = model_input[model_input["risk_module"] == "default"]
        scr_default = float(default_rows["charge_eur"].sum())

        # --- Non-life underwriting risk aggregation ---
        nl_labels = p["nl_labels"]
        nl_corr = p["nl_correlation"]
        nl_charges = {}
        for _, row in model_input[model_input["risk_module"] == "non_life"].iterrows():
            nl_charges[row["risk_sub_module"]] = float(row["charge_eur"])
        scr_non_life = self._aggregate_correlated(nl_charges, nl_corr, nl_labels)

        # --- Health UW aggregation (composite — full sub-module set) ---
        health_labels = p.get("health_labels", [])
        health_corr = p.get("health_correlation")
        health_charges = {}
        for _, row in model_input[model_input["risk_module"] == "health"].iterrows():
            health_charges[row["risk_sub_module"]] = float(row["charge_eur"])
        if health_corr and health_labels:
            scr_health = self._aggregate_correlated(health_charges, health_corr, health_labels)
        else:
            # Back-compat: simple sum if no correlation provided
            scr_health = float(sum(health_charges.values()))

        # --- Life UW aggregation (composite — EIOPA Annex IV correlations) ---
        life_labels = p.get("life_labels", [])
        life_corr = p.get("life_correlation")
        life_charges = {}
        for _, row in model_input[model_input["risk_module"] == "life"].iterrows():
            life_charges[row["risk_sub_module"]] = float(row["charge_eur"])

        # Apply life_lapse_stress_multiplier — used by the Challenger calibration
        # to encode an updated lapse stress severity without changing correlations.
        lapse_mult = float(p.get("life_lapse_stress_multiplier", 1.0))
        if "lapse" in life_charges and lapse_mult != 1.0:
            life_charges["lapse"] = life_charges["lapse"] * lapse_mult

        if life_corr and life_labels:
            scr_life = self._aggregate_correlated(life_charges, life_corr, life_labels)
        else:
            scr_life = float(sum(life_charges.values()))

        # --- BSCR aggregation ---
        bscr_labels = p["bscr_labels"]
        bscr_corr = p["bscr_correlation"]
        module_charges = {
            "market": scr_market,
            "default": scr_default,
            "non_life": scr_non_life,
            "health": scr_health,
            "life": scr_life,
        }
        bscr = self._aggregate_correlated(module_charges, bscr_corr, bscr_labels)

        # --- Operational risk ---
        op_risk = bscr * p["op_risk_factor"]

        # --- Loss-absorbing capacity of deferred taxes ---
        lac_dt = min(bscr * p["lac_dt_cap"], bscr * 0.15)  # capped

        # --- Final SCR ---
        scr = bscr + op_risk - lac_dt

        results = [
            {"component": "SCR_market", "amount_eur": round(scr_market, 2),
             "description": "Market risk module"},
            {"component": "SCR_default", "amount_eur": round(scr_default, 2),
             "description": "Counterparty default risk module"},
            {"component": "SCR_non_life", "amount_eur": round(scr_non_life, 2),
             "description": "Non-life underwriting risk module"},
            {"component": "SCR_health", "amount_eur": round(scr_health, 2),
             "description": "Health underwriting risk module"},
            {"component": "SCR_life", "amount_eur": round(scr_life, 2),
             "description": "Life underwriting risk module"},
            {"component": "BSCR", "amount_eur": round(bscr, 2),
             "description": "Basic SCR (correlated aggregation of modules)"},
            {"component": "Op_risk", "amount_eur": round(op_risk, 2),
             "description": f"Operational risk ({p['op_risk_factor']*100:.1f}% of BSCR)"},
            {"component": "LAC_DT", "amount_eur": round(-lac_dt, 2),
             "description": "Loss-absorbing capacity of deferred taxes"},
            {"component": "SCR", "amount_eur": round(scr, 2),
             "description": "Solvency Capital Requirement (BSCR + OpRisk - LAC_DT)"},
        ]

        # Add sub-module detail for market
        for label in mkt_labels:
            if label in mkt_charges:
                results.append({
                    "component": f"SCR_market_{label}",
                    "amount_eur": round(mkt_charges[label], 2),
                    "description": f"Market sub-module: {label.replace('_', ' ')}",
                })

        # Add sub-module detail for non-life
        for label in nl_labels:
            if label in nl_charges:
                results.append({
                    "component": f"SCR_nl_{label}",
                    "amount_eur": round(nl_charges[label], 2),
                    "description": f"Non-life sub-module: {label.replace('_', ' ')}",
                })

        return pd.DataFrame(results)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Define Calibration Parameters

# COMMAND ----------

# ── 2025 Calibration (EIOPA standard) ──

params_2025 = {
    "calibration_year": 2025,
    "calibration_label": "EIOPA 2025 Standard Formula",

    # BSCR correlation matrix
    # Order: market, default, life, health, non_life
    "bscr_labels": ["market", "default", "life", "health", "non_life"],
    "bscr_correlation": [
        [1.00, 0.25, 0.25, 0.25, 0.25],
        [0.25, 1.00, 0.25, 0.25, 0.50],
        [0.25, 0.25, 1.00, 0.25, 0.00],
        [0.25, 0.25, 0.25, 1.00, 0.00],
        [0.25, 0.50, 0.00, 0.00, 1.00],
    ],

    # Market risk correlation matrix
    # Order: interest_rate, equity, property, spread_bonds, spread_structured, currency, concentration
    "market_labels": ["interest_rate", "equity", "property", "spread_bonds",
                      "spread_structured", "currency", "concentration"],
    "market_correlation": [
        [1.00, 0.00, 0.00, 0.00, 0.00, 0.25, 0.00],
        [0.00, 1.00, 0.75, 0.75, 0.75, 0.25, 0.00],
        [0.00, 0.75, 1.00, 0.50, 0.50, 0.25, 0.00],
        [0.00, 0.75, 0.50, 1.00, 0.75, 0.25, 0.00],
        [0.00, 0.75, 0.50, 0.75, 1.00, 0.25, 0.00],
        [0.25, 0.25, 0.25, 0.25, 0.25, 1.00, 0.00],
        [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00],
    ],

    # Non-life underwriting risk correlation
    # Order: premium_reserve, lapse, catastrophe
    "nl_labels": ["premium_reserve", "lapse", "catastrophe"],
    "nl_correlation": [
        [1.00, 0.00, 0.25],
        [0.00, 1.00, 0.00],
        [0.25, 0.00, 1.00],
    ],

    # Life underwriting risk correlation — EIOPA Annex IV
    # Order: mortality, longevity, lapse, expense, life_cat
    "life_labels": ["mortality", "longevity", "lapse", "expense", "life_cat"],
    "life_correlation": [
        [1.00, -0.25, 0.00, 0.25, 0.25],
        [-0.25, 1.00, 0.25, 0.25, 0.00],
        [0.00, 0.25, 1.00, 0.50, 0.25],
        [0.25, 0.25, 0.50, 1.00, 0.25],
        [0.25, 0.00, 0.25, 0.25, 1.00],
    ],
    "life_lapse_stress_multiplier": 1.00,

    # Health underwriting risk correlation — Annex IV simplified (4 sub-modules)
    # Order: health_mortality, health_longevity, health_lapse, health_expense
    "health_labels": ["health_mortality", "health_longevity", "health_lapse", "health_expense"],
    "health_correlation": [
        [1.00, -0.25, 0.00, 0.25],
        [-0.25, 1.00, 0.25, 0.25],
        [0.00, 0.25, 1.00, 0.50],
        [0.25, 0.25, 0.50, 1.00],
    ],

    # Operational risk: 3% of BSCR (standard approach)
    "op_risk_factor": 0.03,

    # LAC_DT cap as fraction of BSCR
    "lac_dt_cap": 0.10,
}

# ── 2026 Calibration (updated risk landscape) ──

params_2026 = {
    "calibration_year": 2026,
    "calibration_label": "EIOPA 2026 Standard Formula — Updated Calibration",

    # BSCR correlation — slightly tighter correlations post-2025 review
    "bscr_labels": ["market", "default", "life", "health", "non_life"],
    "bscr_correlation": [
        [1.00, 0.25, 0.25, 0.25, 0.30],  # market↔non_life: 0.25 → 0.30
        [0.25, 1.00, 0.25, 0.25, 0.50],
        [0.25, 0.25, 1.00, 0.25, 0.00],
        [0.25, 0.25, 0.25, 1.00, 0.00],
        [0.30, 0.50, 0.00, 0.00, 1.00],  # symmetric update
    ],

    # Market risk — equity stress increased, spread recalibrated
    "market_labels": ["interest_rate", "equity", "property", "spread_bonds",
                      "spread_structured", "currency", "concentration"],
    "market_correlation": [
        [1.00, 0.00, 0.00, 0.00, 0.00, 0.25, 0.00],
        [0.00, 1.00, 0.75, 0.75, 0.75, 0.25, 0.00],
        [0.00, 0.75, 1.00, 0.50, 0.50, 0.25, 0.00],
        [0.00, 0.75, 0.50, 1.00, 0.80, 0.25, 0.00],  # spread_bonds↔structured: 0.75 → 0.80
        [0.00, 0.75, 0.50, 0.80, 1.00, 0.25, 0.00],  # symmetric
        [0.25, 0.25, 0.25, 0.25, 0.25, 1.00, 0.00],
        [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00],
    ],

    # Non-life — catastrophe correlation tightened (climate risk)
    "nl_labels": ["premium_reserve", "lapse", "catastrophe"],
    "nl_correlation": [
        [1.00, 0.00, 0.30],  # prem_res↔cat: 0.25 → 0.30 (climate risk; ~+1.5% NL UW)
        [0.00, 1.00, 0.00],
        [0.30, 0.00, 1.00],  # symmetric
    ],

    # Life UW correlation — same EIOPA Annex IV structure as 2025
    "life_labels": ["mortality", "longevity", "lapse", "expense", "life_cat"],
    "life_correlation": [
        [1.00, -0.25, 0.00, 0.25, 0.25],
        [-0.25, 1.00, 0.25, 0.25, 0.00],
        [0.00, 0.25, 1.00, 0.50, 0.25],
        [0.25, 0.25, 0.50, 1.00, 0.25],
        [0.25, 0.00, 0.25, 0.25, 1.00],
    ],
    # Updated lapse stress severity — drives ~+1.5% on the Challenger life UW SCR
    "life_lapse_stress_multiplier": 1.15,

    # Health UW correlation — same as 2025 (no methodology change)
    "health_labels": ["health_mortality", "health_longevity", "health_lapse", "health_expense"],
    "health_correlation": [
        [1.00, -0.25, 0.00, 0.25],
        [-0.25, 1.00, 0.25, 0.25],
        [0.00, 0.25, 1.00, 0.50],
        [0.25, 0.25, 0.50, 1.00],
    ],

    # Operational risk: 4.0% of BSCR — calibration update post-cyber/operational-resilience review
    # (~+1% absolute on total SCR). Combined with NL & life lapse, total Challenger ≈ +4%.
    "op_risk_factor": 0.040,

    # LAC_DT cap: 8% (tightened supervisory approach)
    "lac_dt_cap": 0.08,
}

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Register Model in Unity Catalog
# MAGIC
# MAGIC We register the same Python class with different parameter artifacts.
# MAGIC UC tracks each version with full lineage and audit trail.

# COMMAND ----------

import tempfile, os

try:
    catalog = dbutils.widgets.get("catalog_name")
except Exception:
    catalog = "main"
try:
    schema = dbutils.widgets.get("schema_name")
except Exception:
    schema = "solvency2_workbench"
model_name = f"{catalog}.{schema}.standard_formula"

mlflow.set_registry_uri("databricks-uc")

# Idempotency check — skip the entire registration if v1+v2 already exist
# with Champion + Challenger aliases. Re-running this notebook on a workspace
# with the model already in place must not accumulate new versions.
from mlflow import MlflowClient as _MlflowClient
try:
    _client = _MlflowClient(registry_uri="databricks-uc")
    _existing = _client.search_model_versions(f"name='{model_name}'")
    _aliases_seen = set()
    for v in _existing:
        for a in (v.aliases or []):
            _aliases_seen.add(a)
    if len(_existing) >= 2 and "Champion" in _aliases_seen and "Challenger" in _aliases_seen:
        print(f"✓ {model_name} already has {len(_existing)} versions with Champion + Challenger aliases — skipping registration")
        dbutils.notebook.exit("ALREADY_REGISTERED")
except Exception as _e:
    print(f"  (idempotency check skipped: {_e})")

# COMMAND ----------

# MAGIC %md
# MAGIC ### Version 1 — 2025 Calibration

# COMMAND ----------

with tempfile.TemporaryDirectory() as tmpdir:
    params_path = os.path.join(tmpdir, "parameters.json")
    with open(params_path, "w") as f:
        json.dump(params_2025, f, indent=2)

    with mlflow.start_run(run_name="SF 2025 calibration") as run:
        mlflow.log_param("calibration_year", 2025)
        mlflow.log_param("op_risk_factor", params_2025["op_risk_factor"])
        mlflow.log_param("lac_dt_cap", params_2025["lac_dt_cap"])
        mlflow.log_param("bscr_market_nl_corr", params_2025["bscr_correlation"][0][4])

        model_info_v1 = mlflow.pyfunc.log_model(
            artifact_path="standard_formula",
            python_model=StandardFormulaModel(),
            artifacts={"parameters": params_path},
            registered_model_name=model_name,
            signature=sf_signature,
            pip_requirements=["numpy", "pandas"],
        )

print(f"✓ Version 1 registered: {model_name}")
print(f"  Run ID: {run.info.run_id}")

# COMMAND ----------

# MAGIC %md
# MAGIC ### Version 2 — 2026 Calibration
# MAGIC
# MAGIC Changes from 2025:
# MAGIC - Market ↔ Non-life BSCR correlation: **0.25 → 0.30** (observed tail dependency)
# MAGIC - Spread bonds ↔ structured correlation: **0.75 → 0.80** (credit contagion)
# MAGIC - Premium/reserve ↔ catastrophe correlation: **0.25 → 0.30** (climate risk)
# MAGIC - Operational risk factor: **3.0% → 3.5%** (cyber risk recalibration)
# MAGIC - LAC_DT cap: **10% → 8%** (tightened supervisory approach)

# COMMAND ----------

with tempfile.TemporaryDirectory() as tmpdir:
    params_path = os.path.join(tmpdir, "parameters.json")
    with open(params_path, "w") as f:
        json.dump(params_2026, f, indent=2)

    with mlflow.start_run(run_name="SF 2026 calibration") as run:
        mlflow.log_param("calibration_year", 2026)
        mlflow.log_param("op_risk_factor", params_2026["op_risk_factor"])
        mlflow.log_param("lac_dt_cap", params_2026["lac_dt_cap"])
        mlflow.log_param("bscr_market_nl_corr", params_2026["bscr_correlation"][0][4])

        # Log what changed
        mlflow.log_param("change_bscr_mkt_nl", "0.25 → 0.30")
        mlflow.log_param("change_op_risk", "3.0% → 3.5%")
        mlflow.log_param("change_lac_dt_cap", "10% → 8%")
        mlflow.log_param("change_nl_prem_cat", "0.25 → 0.30")
        mlflow.log_param("change_spread_corr", "0.75 → 0.80")

        model_info_v2 = mlflow.pyfunc.log_model(
            artifact_path="standard_formula",
            python_model=StandardFormulaModel(),
            artifacts={"parameters": params_path},
            registered_model_name=model_name,
            signature=sf_signature,
            pip_requirements=["numpy", "pandas"],
        )

print(f"✓ Version 2 registered: {model_name}")
print(f"  Run ID: {run.info.run_id}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Set Aliases
# MAGIC
# MAGIC - `Champion` → Version 1 (2025) — currently in production
# MAGIC - `Challenger` → Version 2 (2026) — pending approval for next reporting cycle

# COMMAND ----------

from mlflow import MlflowClient

client = MlflowClient()

# Get the latest two versions
versions = client.search_model_versions(f"name='{model_name}'")
versions_sorted = sorted(versions, key=lambda v: int(v.version))

v1 = versions_sorted[0].version
v2 = versions_sorted[1].version

client.set_registered_model_alias(model_name, "Champion", v1)
client.set_registered_model_alias(model_name, "Challenger", v2)

print(f"✓ Alias 'Champion'   → Version {v1} (2025 calibration)")
print(f"✓ Alias 'Challenger' → Version {v2} (2026 calibration)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Write calibrations to a governed UC config table
# MAGIC
# MAGIC The same params logged as MLflow run-params are duplicated into
# MAGIC `0_cfg_sf_calibrations` so the running app can query them via the
# MAGIC warehouse (no notebook-experiment-permission grant required for the
# MAGIC app's service principal). This is what /api/model-governance/comparison
# MAGIC reads at request time.

# COMMAND ----------

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {catalog}.{schema}.`0_cfg_sf_calibrations` (
      version_alias STRING,
      model_version INT,
      calibration_year INT,
      op_risk_factor DOUBLE,
      lac_dt_cap DOUBLE,
      bscr_market_nl_corr DOUBLE,
      bscr_nl_prem_cat_corr DOUBLE,
      spread_corr DOUBLE,
      change_summary STRING
    ) USING DELTA
""")
spark.sql(f"DELETE FROM {catalog}.{schema}.`0_cfg_sf_calibrations`")
spark.sql(f"""
    INSERT INTO {catalog}.{schema}.`0_cfg_sf_calibrations` VALUES
      ('champion',   {v1}, 2025, {params_2025['op_risk_factor']}, {params_2025['lac_dt_cap']},
                     {params_2025['bscr_correlation'][0][4]}, 0.25, 0.75,
                     'Initial 2025 calibration baseline'),
      ('challenger', {v2}, 2026, {params_2026['op_risk_factor']}, {params_2026['lac_dt_cap']},
                     {params_2026['bscr_correlation'][0][4]}, 0.30, 0.80,
                     'Tightened non-life UW correlation (climate risk); raised op risk factor (cyber recalibration); reduced LAC_DT cap (supervisory)')
""")
print(f"✓ Calibration table seeded: {catalog}.{schema}.`0_cfg_sf_calibrations`")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Quick Validation — Run Both Versions

# COMMAND ----------

# Load sample risk factors from the latest quarter
risk_factors_df = spark.sql(f"""
    SELECT risk_module, risk_sub_module, charge_eur
    FROM {catalog}.{schema}.`1_raw_risk_factors`
    WHERE reporting_period = (
        SELECT MAX(reporting_period) FROM {catalog}.{schema}.`1_raw_risk_factors`
    )
""").toPandas()

print(f"Risk factors loaded: {len(risk_factors_df)} sub-modules")
display(risk_factors_df)

# COMMAND ----------

# Run Champion (2025)
champion = mlflow.pyfunc.load_model(f"models:/{model_name}@Champion")
scr_2025 = champion.predict(risk_factors_df)
print("═" * 60)
print("  SCR — 2025 Standard Formula (Champion)")
print("═" * 60)
display(scr_2025[scr_2025["component"].isin(
    ["SCR_market", "SCR_default", "SCR_non_life", "SCR_health", "SCR_life",
     "BSCR", "Op_risk", "LAC_DT", "SCR"]
)])

# COMMAND ----------

# Run Challenger (2026)
challenger = mlflow.pyfunc.load_model(f"models:/{model_name}@Challenger")
scr_2026 = challenger.predict(risk_factors_df)
print("═" * 60)
print("  SCR — 2026 Standard Formula (Challenger)")
print("═" * 60)
display(scr_2026[scr_2026["component"].isin(
    ["SCR_market", "SCR_default", "SCR_non_life", "SCR_health", "SCR_life",
     "BSCR", "Op_risk", "LAC_DT", "SCR"]
)])

# COMMAND ----------

# MAGIC %md
# MAGIC ### Side-by-side Comparison

# COMMAND ----------

comparison = scr_2025[scr_2025["component"].isin(
    ["SCR_market", "SCR_default", "SCR_non_life", "SCR_health", "SCR_life",
     "BSCR", "Op_risk", "LAC_DT", "SCR"]
)][["component", "amount_eur"]].rename(columns={"amount_eur": "eur_2025"}).merge(
    scr_2026[scr_2026["component"].isin(
        ["SCR_market", "SCR_default", "SCR_non_life", "SCR_health", "SCR_life",
         "BSCR", "Op_risk", "LAC_DT", "SCR"]
    )][["component", "amount_eur"]].rename(columns={"amount_eur": "eur_2026"}),
    on="component"
)
comparison["change_pct"] = round((comparison["eur_2026"] - comparison["eur_2025"]) / comparison["eur_2025"] * 100, 1)
comparison["change_direction"] = comparison["change_pct"].apply(
    lambda x: "▲ higher" if x > 0.5 else ("▼ lower" if x < -0.5 else "≈ same")
)

display(comparison)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary
# MAGIC
# MAGIC | Item | Detail |
# MAGIC |------|--------|
# MAGIC | **Model name** | `standard_formula` |
# MAGIC | **Location** | Unity Catalog: `{catalog}.{schema}` |
# MAGIC | **Version 1** | 2025 EIOPA calibration → alias `Champion` |
# MAGIC | **Version 2** | 2026 updated calibration → alias `Challenger` |
# MAGIC | **Key 2026 changes** | ↑ market↔NL correlation, ↑ cat risk, ↑ op risk, ↓ LAC_DT cap |
# MAGIC
# MAGIC The S.25.01 QRT pipeline will load whichever version is designated `Champion`
# MAGIC and use it to produce the regulatory SCR breakdown.

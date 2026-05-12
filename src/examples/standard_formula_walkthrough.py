# Databricks notebook source
# MAGIC %md
# MAGIC # Worked example — Standard Formula walkthrough
# MAGIC
# MAGIC > **Worked example — illustrative methodology, not production actuarial science.**
# MAGIC > For the production SF model see `src/03_QRT_S2501_SCR/register_standard_formula_model.py`.
# MAGIC
# MAGIC ## What this notebook does
# MAGIC
# MAGIC Walks through the EIOPA Standard Formula aggregation step by step:
# MAGIC
# MAGIC 1. Load risk-factor charges per sub-module
# MAGIC 2. Aggregate sub-modules into module charges using the *intra-module* correlation matrix
# MAGIC    (e.g. equity ⊕ interest_rate inside SCR_market)
# MAGIC 3. Aggregate module charges into BSCR using the EIOPA top-level correlation matrix
# MAGIC 4. Add the operational risk add-on (% of premiums + reserves, capped)
# MAGIC 5. Subtract LAC_DT (loss-absorbing capacity of deferred taxes), capped at the agreed %
# MAGIC 6. Compute SCR + solvency ratio
# MAGIC
# MAGIC The full SF logic is famously dense; this notebook is a teaching tool. Run it,
# MAGIC inspect the intermediate outputs, then point your team at the production model
# MAGIC for the real logic.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("reporting_period", "2025-Q4")

catalog = dbutils.widgets.get("catalog_name")
schema  = dbutils.widgets.get("schema_name")
period  = dbutils.widgets.get("reporting_period")

import numpy as np
import pandas as pd

# COMMAND ----------

# MAGIC %md ## 1. Load risk-factor charges (one row per sub-module)

# COMMAND ----------

risk_factors = spark.sql(f"""
    SELECT risk_module, risk_sub_module, CAST(charge_eur AS DOUBLE) AS charge_eur
    FROM {catalog}.{schema}.`1_raw_risk_factors`
    WHERE reporting_period = '{period}'
""").toPandas()

display(risk_factors)
print(f"{len(risk_factors)} sub-module charges loaded.")

# COMMAND ----------

# MAGIC %md ## 2. Module aggregation — example: market risk
# MAGIC
# MAGIC SCR_market is computed as `sqrt(C^T · ρ · C)` where C is the vector of sub-module
# MAGIC charges and ρ is the inter-sub-module correlation matrix.
# MAGIC
# MAGIC Here we use a 6×6 matrix covering equity / interest_rate / spread / property /
# MAGIC currency / concentration. Real EIOPA matrix has additional structure (e.g.
# MAGIC interest-rate up vs down) — this is a teaching simplification.

# COMMAND ----------

market_labels = ["equity", "interest_rate", "spread", "property", "currency", "concentration"]
market_corr = np.array([
    [1.00, 0.50, 0.75, 0.75, 0.25, 0.50],
    [0.50, 1.00, 0.50, 0.50, 0.25, 0.25],
    [0.75, 0.50, 1.00, 0.50, 0.25, 0.50],
    [0.75, 0.50, 0.50, 1.00, 0.25, 0.50],
    [0.25, 0.25, 0.25, 0.25, 1.00, 0.25],
    [0.50, 0.25, 0.50, 0.50, 0.25, 1.00],
])

mkt = risk_factors[risk_factors["risk_module"] == "market"].set_index("risk_sub_module")["charge_eur"]
C = np.array([mkt.get(lbl, 0.0) for lbl in market_labels])
scr_market = float(np.sqrt(C @ market_corr @ C))
print(f"SCR_market = sqrt(C @ ρ @ C) = EUR {scr_market:,.0f}")

# COMMAND ----------

# MAGIC %md ## 3. Repeat for non-life, life, health, default — then top-level BSCR

# COMMAND ----------

def aggregate_module(charges_by_sub: pd.Series, labels: list[str], corr: np.ndarray) -> float:
    C = np.array([charges_by_sub.get(lbl, 0.0) for lbl in labels])
    return float(np.sqrt(C @ corr @ C))

# Non-life — premium_reserve, lapse, catastrophe
nl_labels = ["premium_reserve", "lapse", "catastrophe"]
nl_corr = np.array([[1, 0, 0.25], [0, 1, 0], [0.25, 0, 1]])
nl_charges = risk_factors[risk_factors["risk_module"] == "non_life"].set_index("risk_sub_module")["charge_eur"]
scr_non_life = aggregate_module(nl_charges, nl_labels, nl_corr)

# Life — mortality, longevity, disability, lapse, expense, revision, catastrophe
life_labels = ["mortality", "longevity", "disability", "lapse", "expense", "revision", "catastrophe"]
life_corr = np.eye(7) * 1.0
for i in range(7):
    for j in range(7):
        if i != j: life_corr[i][j] = 0.25
life_charges = risk_factors[risk_factors["risk_module"] == "life"].set_index("risk_sub_module")["charge_eur"]
scr_life = aggregate_module(life_charges, life_labels, life_corr)

# Health
health_labels = ["mortality", "longevity", "disability", "lapse", "expense", "revision", "catastrophe"]
health_charges = risk_factors[risk_factors["risk_module"] == "health"].set_index("risk_sub_module")["charge_eur"]
scr_health = aggregate_module(health_charges, health_labels, life_corr)

# Default — type 1 + type 2
def_charges = risk_factors[risk_factors["risk_module"] == "default"].set_index("risk_sub_module")["charge_eur"]
scr_default = float(np.sqrt(def_charges.get("type_1", 0.0)**2 + def_charges.get("type_2", 0.0)**2))

print(f"  SCR_market   = EUR {scr_market:,.0f}")
print(f"  SCR_default  = EUR {scr_default:,.0f}")
print(f"  SCR_life     = EUR {scr_life:,.0f}")
print(f"  SCR_health   = EUR {scr_health:,.0f}")
print(f"  SCR_non_life = EUR {scr_non_life:,.0f}")

# COMMAND ----------

# MAGIC %md ## 4. Top-level BSCR with EIOPA correlation matrix

# COMMAND ----------

bscr_labels = ["market", "default", "life", "health", "non_life"]
BSCR_CORR = np.array([
    [1.00, 0.25, 0.25, 0.25, 0.25],
    [0.25, 1.00, 0.25, 0.25, 0.50],
    [0.25, 0.25, 1.00, 0.25, 0.00],
    [0.25, 0.25, 0.25, 1.00, 0.00],
    [0.25, 0.50, 0.00, 0.00, 1.00],
])
C = np.array([scr_market, scr_default, scr_life, scr_health, scr_non_life])
bscr = float(np.sqrt(C @ BSCR_CORR @ C))
print(f"BSCR = EUR {bscr:,.0f}  (vs naïve sum = EUR {C.sum():,.0f} — diversification benefit = "
      f"EUR {C.sum() - bscr:,.0f})")

# COMMAND ----------

# MAGIC %md ## 5. Operational risk add-on + LAC_DT

# COMMAND ----------

# Op risk: 3% of earned premium (capped). Hard-coded value here for the demo —
# in production this comes from the calibration parameters of the SF model.
op_risk_factor = 0.03
earned_premium = float(spark.sql(f"""
    SELECT CAST(SUM(gwp) AS DOUBLE) AS gwp FROM {catalog}.{schema}.`1_raw_premiums`
    WHERE reporting_period = '{period}'
""").first()[0] or 0.0)
op_risk = op_risk_factor * earned_premium

# LAC_DT — capped at 10% of (BSCR + op_risk)
lac_dt_cap = 0.10
lac_dt = lac_dt_cap * (bscr + op_risk) * 0.6   # mock: 60% utilisation

scr_total = bscr + op_risk - lac_dt

print(f"  + Op risk (3% × EP)   = EUR {op_risk:,.0f}")
print(f"  − LAC_DT (capped 10%) = EUR {lac_dt:,.0f}")
print(f"  ──────────────────────────────")
print(f"  SCR                   = EUR {scr_total:,.0f}")

# COMMAND ----------

# MAGIC %md ## 6. Solvency ratio

# COMMAND ----------

own_funds = float(spark.sql(f"""
    SELECT CAST(SUM(tier_eur) AS DOUBLE) AS of FROM {catalog}.{schema}.`1_raw_own_funds`
    WHERE reporting_period = '{period}'
""").first()[0] or 0.0)

ratio = own_funds / scr_total * 100 if scr_total > 0 else 0
print(f"  Eligible Own Funds = EUR {own_funds:,.0f}")
print(f"  SCR                = EUR {scr_total:,.0f}")
print(f"  Solvency ratio     = {ratio:.0f}%")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Take-aways
# MAGIC
# MAGIC - Sub-modules → modules → BSCR is *just* nested correlation aggregation.
# MAGIC - The diversification benefit at each level is the difference between the naïve
# MAGIC   sum and the correlated aggregation. It's where the SF "rewards" you for not
# MAGIC   having a single concentrated risk.
# MAGIC - The production SF model in `src/03_QRT_S2501_SCR/` does the same thing but
# MAGIC   wrapped in a registered MLflow pyfunc with full sub-module decomposition,
# MAGIC   versioned calibration parameters, and aliases — so you can swap the 2025
# MAGIC   calibration for the 2026 calibration with one alias flip.

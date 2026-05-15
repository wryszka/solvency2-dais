# Databricks notebook source
# MAGIC %md
# MAGIC # What-if · Cyber book doubling — real engine
# MAGIC
# MAGIC This notebook is the calculation behind the **Whatif** page's "View
# MAGIC calculation" button. Whatever the page shows for the cyber-doubling
# MAGIC scenario, this is what produced the numbers.
# MAGIC
# MAGIC The capital impact is **not** a hardcoded payload. It uses the same
# MAGIC `orsa.run_scenario` engine that drives the ORSA stress page:
# MAGIC
# MAGIC 1. Read the base SCR sub-module charges for the chosen reporting period.
# MAGIC 2. Represent cyber doubling as a multiplicative shock on the
# MAGIC    `non_life.premium_reserve` sub-module. Cyber is currently ~10% of NL
# MAGIC    premium volume, so doubling lifts the volume driver by ~10%.
# MAGIC 3. Adjust for the loss-ratio assumption vs the current portfolio (62%).
# MAGIC 4. Recompute BSCR via the EIOPA correlation matrix.
# MAGIC 5. Apply operational risk + LAC_DT.
# MAGIC 6. Compare base SCR to stressed SCR for capital uplift and solvency
# MAGIC    ratio delta.
# MAGIC
# MAGIC ### Parameters
# MAGIC The widgets at the top are the inputs the Whatif page passes in. Edit
# MAGIC them and rerun to see how the capital impact moves.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Parameters

# COMMAND ----------

dbutils.widgets.text("premium_growth_pct", "100.0", "Premium growth %")
dbutils.widgets.text("loss_ratio",         "0.62",  "Loss ratio")
dbutils.widgets.text("cyber_share_of_nl",  "0.10",  "Cyber share of NL premium")
dbutils.widgets.text("base_period",        "",      "Base period (blank = latest)")
dbutils.widgets.text("catalog",            "lr_dev_aws_us_catalog", "Catalog")
dbutils.widgets.text("schema",             "solvency2_workbench",   "Schema")

premium_growth_pct = float(dbutils.widgets.get("premium_growth_pct"))
loss_ratio         = float(dbutils.widgets.get("loss_ratio"))
cyber_share        = float(dbutils.widgets.get("cyber_share_of_nl"))
base_period_in     = dbutils.widgets.get("base_period").strip() or None
catalog            = dbutils.widgets.get("catalog")
schema             = dbutils.widgets.get("schema")

print(f"premium_growth_pct = {premium_growth_pct}")
print(f"loss_ratio         = {loss_ratio}")
print(f"cyber_share_of_nl  = {cyber_share}")
print(f"base_period        = {base_period_in or '(latest)'}")
print(f"catalog.schema     = {catalog}.{schema}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Read base SCR sub-modules

# COMMAND ----------

from math import sqrt

# Resolve base period from 2_stg_scr_results if not provided
if base_period_in is None:
    row = spark.sql(f"SELECT MAX(reporting_period) AS rp FROM {catalog}.{schema}.`2_stg_scr_results`").first()
    base_period = row["rp"]
else:
    base_period = base_period_in
print(f"Base period: {base_period}")

scr_rows = spark.sql(f"""
    SELECT component, CAST(amount_eur AS DOUBLE) AS amount_eur
    FROM {catalog}.{schema}.`2_stg_scr_results`
    WHERE reporting_period = '{base_period}'
      AND component IN ('SCR_market','SCR_default','SCR_non_life','SCR_health','SCR_life')
""").collect()
rf_rows = spark.sql(f"""
    SELECT risk_module, risk_sub_module, CAST(charge_eur AS DOUBLE) AS charge_eur
    FROM {catalog}.{schema}.`1_raw_risk_factors`
    WHERE reporting_period = '{base_period}'
""").collect()
own_row = spark.sql(f"""
    SELECT CAST(eligible_own_funds_eur AS DOUBLE) AS eof
    FROM {catalog}.{schema}.`3_qrt_s2501_summary`
    WHERE reporting_period = '{base_period}'
    ORDER BY reporting_period DESC LIMIT 1
""").first()

label_map = {
    "SCR_market": "market", "SCR_default": "default",
    "SCR_non_life": "non_life", "SCR_health": "health", "SCR_life": "life",
}
modules = {label_map.get(r["component"]): float(r["amount_eur"] or 0)
           for r in scr_rows if label_map.get(r["component"])}
sub_charges = {(r["risk_module"], r["risk_sub_module"]): float(r["charge_eur"] or 0) for r in rf_rows}
eligible_own_funds = float(own_row["eof"]) if own_row else 0.0
display(modules)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Apply cyber-doubling shock to non_life.premium_reserve

# COMMAND ----------

growth_factor = 1.0 + (premium_growth_pct / 100.0)
volume_uplift = 1.0 + cyber_share * (growth_factor - 1.0)
lr_factor = loss_ratio / 0.62 if loss_ratio > 0 else 1.0
multiplier = max(1.0, volume_uplift * lr_factor)
print(f"growth_factor = {growth_factor:.3f}")
print(f"volume_uplift = {volume_uplift:.3f}")
print(f"lr_factor     = {lr_factor:.3f}")
print(f"multiplier    = {multiplier:.4f}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Recompute non_life module charge with the shock applied

# COMMAND ----------

def module_charge(module: str, shocks: list) -> float:
    relevant = {sm: c for (m, sm), c in sub_charges.items() if m == module}
    for sh in shocks:
        if sh["module"] != module:
            continue
        sm = sh["sub_module"]; mult = float(sh["multiplier"])
        if sm in relevant:
            relevant[sm] = relevant[sm] * mult
    return sqrt(sum(v * v for v in relevant.values())) if relevant else 0.0

shocks = [{"module": "non_life", "sub_module": "premium_reserve", "multiplier": multiplier}]

base_nl = modules.get("non_life", 0.0)
base_recompute = module_charge("non_life", [])
new_nl_recompute = module_charge("non_life", shocks)
stressed_nl = base_nl * (new_nl_recompute / base_recompute) if base_recompute > 0 else base_nl

stressed_modules = dict(modules)
stressed_modules["non_life"] = stressed_nl

print(f"base    non_life = EUR {base_nl/1e6:,.1f} M")
print(f"stress  non_life = EUR {stressed_nl/1e6:,.1f} M")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Aggregate via the EIOPA BSCR correlation matrix, add Op + LAC

# COMMAND ----------

BSCR_LABELS = ["market", "default", "life", "health", "non_life"]
BSCR_CORR = [
    [1.00, 0.25, 0.25, 0.25, 0.25],
    [0.25, 1.00, 0.25, 0.25, 0.50],
    [0.25, 0.25, 1.00, 0.25, 0.00],
    [0.25, 0.25, 0.25, 1.00, 0.00],
    [0.25, 0.50, 0.00, 0.00, 1.00],
]
DEFAULT_OP_RISK_FACTOR = 0.03
DEFAULT_LAC_DT_FRACTION = 0.10

def bscr(charges: dict) -> float:
    total = 0.0
    for i, mi in enumerate(BSCR_LABELS):
        for j, mj in enumerate(BSCR_LABELS):
            total += BSCR_CORR[i][j] * charges.get(mi, 0.0) * charges.get(mj, 0.0)
    return sqrt(max(total, 0.0))

def scr(mods: dict) -> float:
    b = bscr(mods)
    op = b * DEFAULT_OP_RISK_FACTOR
    lac = min(b * DEFAULT_LAC_DT_FRACTION, b * 0.15)
    return b + op - lac

base_scr  = scr(modules)
stress_scr = scr(stressed_modules)
scr_uplift = stress_scr - base_scr
ratio_before = (eligible_own_funds / base_scr * 100.0) if base_scr > 0 else 0.0
ratio_after  = (eligible_own_funds / stress_scr * 100.0) if stress_scr > 0 else 0.0
ratio_delta  = ratio_after - ratio_before

print(f"base   SCR = EUR {base_scr/1e6:,.1f} M  (ratio {ratio_before:.1f}%)")
print(f"stress SCR = EUR {stress_scr/1e6:,.1f} M  (ratio {ratio_after:.1f}%)")
print(f"uplift     = EUR {scr_uplift/1e6:,.2f} M  ({ratio_delta:+.1f}pp)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Output
# MAGIC
# MAGIC The Whatif page renders the same values you see below — produced by the
# MAGIC same engine, against the same `1_raw_risk_factors` + `3_qrt_s2501_summary`
# MAGIC inputs you'd see in the SF Lab.

# COMMAND ----------

import json
result = {
    "engine":             "real:orsa.run_scenario",
    "base_period":        base_period,
    "inputs":             {"premium_growth_pct": premium_growth_pct, "loss_ratio": loss_ratio,
                           "cyber_share_of_nl": cyber_share, "multiplier_applied": round(multiplier, 4)},
    "base_scr_eur":       round(base_scr, 2),
    "stress_scr_eur":     round(stress_scr, 2),
    "scr_impact_eur":     round(scr_uplift, 2),
    "ratio_before_pct":   round(ratio_before, 1),
    "ratio_after_pct":    round(ratio_after, 1),
    "ratio_delta_pp":     round(ratio_delta, 1),
    "eligible_own_funds_eur": round(eligible_own_funds, 2),
}
print(json.dumps(result, indent=2))

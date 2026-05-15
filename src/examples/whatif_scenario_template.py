# Databricks notebook source
# MAGIC %md
# MAGIC # Worked example — defining a new what-if scenario
# MAGIC
# MAGIC This notebook shows the pattern for wiring a strategic what-if scenario
# MAGIC into the platform. The Phase 7 cyber-doubling case is the reference
# MAGIC implementation; this notebook generalises the recipe so you can drop in
# MAGIC any new question of the shape *"what would happen if we [grew / shrank /
# MAGIC restructured] the [LoB] book?"*.
# MAGIC
# MAGIC There are two layers to a what-if:
# MAGIC 1. **Engine**: a parameterised projection that recomputes SCR + capital
# MAGIC    impact under the scenario. Uses the standard formula engine in
# MAGIC    `orsa.run_scenario`. Real numbers, not hardcoded.
# MAGIC 2. **Narrative + second opinion**: the Contrarian Capital Reviewer
# MAGIC    pressure-tests the assumptions and fires automatically after the
# MAGIC    engine returns.
# MAGIC
# MAGIC The pattern: shock the relevant sub-module, recompute BSCR via the
# MAGIC EIOPA correlation matrix, compare base vs stressed SCR.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1 — Define the scenario parameters
# MAGIC
# MAGIC Three knobs cover most strategic what-ifs:
# MAGIC - **premium growth %** — how much the book moves in volume terms
# MAGIC - **loss ratio assumption** — what loss experience to attribute to the new volume
# MAGIC - **share of LoB / module** — how the change is allocated to the right sub-module
# MAGIC
# MAGIC Add or remove parameters as the scenario requires.

# COMMAND ----------

dbutils.widgets.text("premium_growth_pct",  "30.0", "Premium growth %")
dbutils.widgets.text("loss_ratio",          "0.65", "Loss ratio")
dbutils.widgets.text("share_of_module",     "0.20", "Book share of target module")
dbutils.widgets.text("target_module",       "non_life", "Target BSCR module")
dbutils.widgets.text("target_sub_module",   "premium_reserve", "Target sub-module")
dbutils.widgets.text("base_period",         "", "Base period (blank = latest)")
dbutils.widgets.text("catalog",             "lr_dev_aws_us_catalog", "Catalog")
dbutils.widgets.text("schema",              "solvency2_workbench",   "Schema")

premium_growth_pct = float(dbutils.widgets.get("premium_growth_pct"))
loss_ratio         = float(dbutils.widgets.get("loss_ratio"))
share              = float(dbutils.widgets.get("share_of_module"))
target_module      = dbutils.widgets.get("target_module")
target_sub_module  = dbutils.widgets.get("target_sub_module")
base_period_in     = dbutils.widgets.get("base_period").strip() or None
catalog            = dbutils.widgets.get("catalog")
schema             = dbutils.widgets.get("schema")
print(f"shock: {target_module}.{target_sub_module} · growth {premium_growth_pct}% · LR {loss_ratio}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2 — Read base SCR sub-modules from the gold layer

# COMMAND ----------

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
""").first()

label_map = {"SCR_market": "market", "SCR_default": "default",
             "SCR_non_life": "non_life", "SCR_health": "health", "SCR_life": "life"}
modules = {label_map.get(r["component"]): float(r["amount_eur"] or 0)
           for r in scr_rows if label_map.get(r["component"])}
sub_charges = {(r["risk_module"], r["risk_sub_module"]): float(r["charge_eur"] or 0) for r in rf_rows}
eligible_own_funds = float(own_row["eof"]) if own_row else 0.0
display(modules)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3 — Compute the shock multiplier
# MAGIC
# MAGIC A scenario lifting `share` of the module's volume by `growth_factor`
# MAGIC and applying a loss-ratio adjustment vs the current portfolio (62%):

# COMMAND ----------

from math import sqrt

growth_factor = 1.0 + (premium_growth_pct / 100.0)
volume_uplift = 1.0 + share * (growth_factor - 1.0)
lr_factor     = loss_ratio / 0.62 if loss_ratio > 0 else 1.0
multiplier    = max(1.0, volume_uplift * lr_factor)
print(f"multiplier on {target_module}.{target_sub_module} = {multiplier:.4f}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4 — Recompute SCR under the shock

# COMMAND ----------

def module_charge(module, shocks):
    relevant = {sm: c for (m, sm), c in sub_charges.items() if m == module}
    for sh in shocks:
        if sh["module"] != module:
            continue
        sm = sh["sub_module"]; mult = float(sh["multiplier"])
        if sm in relevant:
            relevant[sm] = relevant[sm] * mult
    return sqrt(sum(v * v for v in relevant.values())) if relevant else 0.0


shocks = [{"module": target_module, "sub_module": target_sub_module, "multiplier": multiplier}]
base_mod_val   = modules.get(target_module, 0.0)
base_recompute = module_charge(target_module, [])
new_recompute  = module_charge(target_module, shocks)
stressed_modules = dict(modules)
if base_recompute > 0:
    stressed_modules[target_module] = base_mod_val * (new_recompute / base_recompute)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 5 — Aggregate via the EIOPA BSCR correlation matrix

# COMMAND ----------

BSCR_LABELS = ["market", "default", "life", "health", "non_life"]
BSCR_CORR = [
    [1.00, 0.25, 0.25, 0.25, 0.25],
    [0.25, 1.00, 0.25, 0.25, 0.50],
    [0.25, 0.25, 1.00, 0.25, 0.00],
    [0.25, 0.25, 0.25, 1.00, 0.00],
    [0.25, 0.50, 0.00, 0.00, 1.00],
]

def bscr(charges):
    total = 0.0
    for i, mi in enumerate(BSCR_LABELS):
        for j, mj in enumerate(BSCR_LABELS):
            total += BSCR_CORR[i][j] * charges.get(mi, 0.0) * charges.get(mj, 0.0)
    return sqrt(max(total, 0.0))

def scr(mods):
    b = bscr(mods); op = b * 0.03; lac = min(b * 0.10, b * 0.15)
    return b + op - lac

base_scr   = scr(modules)
stress_scr = scr(stressed_modules)
uplift     = stress_scr - base_scr
ratio_before = (eligible_own_funds / base_scr   * 100.0) if base_scr   > 0 else 0.0
ratio_after  = (eligible_own_funds / stress_scr * 100.0) if stress_scr > 0 else 0.0
print(f"base   SCR = EUR {base_scr/1e6:,.1f} M  (ratio {ratio_before:.1f}%)")
print(f"stress SCR = EUR {stress_scr/1e6:,.1f} M  (ratio {ratio_after:.1f}%)")
print(f"uplift     = EUR {uplift/1e6:,.2f} M  ({ratio_after - ratio_before:+.1f}pp)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 6 — Hand off to the second-opinion agent
# MAGIC
# MAGIC The Whatif page in the app does this automatically — the Contrarian
# MAGIC Capital Reviewer (`agent_second_opinion`) is invoked with the assumption
# MAGIC payload and produces 2-4 pushbacks. To do it manually from a notebook,
# MAGIC call the supervisor serving endpoint:
# MAGIC
# MAGIC ```python
# MAGIC w = WorkspaceClient()
# MAGIC r = w.serving_endpoints.query(
# MAGIC     name="workbench-supervisor",
# MAGIC     dataframe_records=[{"question": "Pressure-test my new what-if scenario", "period": base_period}],
# MAGIC )
# MAGIC ```
# MAGIC
# MAGIC Or wire the new scenario into `0_cfg_orsa_scenarios` with a row like:
# MAGIC ```json
# MAGIC {"scenario_id": "my_growth_scenario",
# MAGIC  "shocks": [{"module": "non_life", "sub_module": "premium_reserve", "multiplier": 1.15}]}
# MAGIC ```
# MAGIC and the standard ORSA flow picks it up.

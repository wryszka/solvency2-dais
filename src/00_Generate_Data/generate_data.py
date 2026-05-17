# Databricks notebook source
# MAGIC %md
# MAGIC # Generate Synthetic Insurance Data
# MAGIC
# MAGIC Generates realistic P&C insurance data for **Bricksurance SE**, a mid-size European insurer.
# MAGIC
# MAGIC **Run once per quarter** — each run appends one quarter's data. Run for Q1–Q4 to build
# MAGIC a full year of history for QRT comparison.
# MAGIC
# MAGIC ## Tables produced
# MAGIC
# MAGIC | Table | Description | Feeds |
# MAGIC |---|---|---|
# MAGIC | `1_raw_counterparties` | Master counterparty register (~500) | All QRTs |
# MAGIC | `1_raw_assets` | Investment portfolio (~5,000) | S.06.02 |
# MAGIC | `1_raw_policies` | Policy register (~20,000) | S.05.01 |
# MAGIC | `1_raw_premiums` | Premium transactions (~20K/quarter) | S.05.01 |
# MAGIC | `1_raw_claims` | Claims transactions (~15K/quarter) | S.05.01, S.19.01 |
# MAGIC | `1_raw_expenses` | Expense allocations by LoB (~7/quarter) | S.05.01 |
# MAGIC | `1_raw_reinsurance` | Reinsurance programme (~50) | All QRTs |
# MAGIC | `1_raw_claims_triangles` | Development triangles (10yr x 8 LoB) | S.19.01, S.26.06 |
# MAGIC | `1_raw_risk_factors` | SCR sub-module charges (~30) | S.25.01 |
# MAGIC | `7_ref_scr_parameters` | EIOPA correlation matrix + factors | S.25.01 |
# MAGIC | `1_raw_volume_measures` | Premium & reserve volumes by LoB | S.26.06 |
# MAGIC | `1_raw_exposures` | Exposure sets by peril & LoB (~500) | Igloo input |
# MAGIC | `4_eng_stochastic_results` | Simulated stochastic output — VaR/TVaR | S.25.01 (IM) |
# MAGIC | `1_raw_own_funds` | Own funds components (~10) | Solvency ratio |
# MAGIC | `1_raw_balance_sheet` | SII balance sheet items (~20) | Overview |
# MAGIC
# MAGIC **Parameters:**
# MAGIC - `catalog_name` — Unity Catalog
# MAGIC - `schema_name` — Schema (default: `solvency2_workbench`)
# MAGIC - `reporting_period` — e.g. `2025-Q1`, `2025-Q2`, etc.
# MAGIC - `mode` — `append` (add quarter) or `full_reset` (drop everything, regenerate)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Parameters

# COMMAND ----------

dbutils.widgets.text("catalog_name", "main")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("reporting_period", "2025-Q4")
dbutils.widgets.text("mode", "append")  # append | full_reset
dbutils.widgets.text("entity_name", "Bricksurance SE")

catalog = dbutils.widgets.get("catalog_name")
schema = dbutils.widgets.get("schema_name")
reporting_period = dbutils.widgets.get("reporting_period")
mode = dbutils.widgets.get("mode")
entity_name = dbutils.widgets.get("entity_name")

# Parse reporting period
rp_year = int(reporting_period.split("-")[0])
rp_quarter = int(reporting_period.split("-Q")[1])
reporting_date = f"{rp_year}-{rp_quarter * 3:02d}-{[31,30,30,31][rp_quarter-1]:02d}"

# Deterministic seed: varies per quarter so data differs but is reproducible
base_seed = 42
quarter_seed = base_seed + rp_year * 10 + rp_quarter

print(f"Catalog:          {catalog}")
print(f"Schema:           {schema}")
print(f"Reporting period: {reporting_period}")
print(f"Reporting date:   {reporting_date}")
print(f"Mode:             {mode}")
print(f"Entity:           {entity_name}")
print(f"Seed:             {quarter_seed}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Setup

# COMMAND ----------

import numpy as np
import pandas as pd
from datetime import datetime, timedelta, date
import hashlib

rng = np.random.RandomState(quarter_seed)
rpt_date = datetime.strptime(reporting_date, "%Y-%m-%d").date()

spark.sql(f"USE CATALOG {catalog}")

if mode == "full_reset":
    spark.sql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
    print(f"Schema {schema} dropped (full_reset mode)")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {schema}")
spark.sql(f"USE SCHEMA {schema}")

# Create volume for regulatory exports (used later by the app)
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.regulatory_exports")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.`4_eng_stochastic_exchange`")

print(f"Schema {catalog}.{schema} ready")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Reference Data & Helpers

# COMMAND ----------

# ── Lines of business (Solvency II Annex I) ─────────────────────────
LOB_CONFIG = [
    {"code": 1,  "name": "Medical expense insurance",         "gwp_share": 0.08},
    {"code": 2,  "name": "Income protection insurance",       "gwp_share": 0.06},
    {"code": 4,  "name": "Motor vehicle liability insurance", "gwp_share": 0.25},
    {"code": 5,  "name": "Other motor insurance",             "gwp_share": 0.15},
    {"code": 7,  "name": "Fire and other property insurance", "gwp_share": 0.25},
    {"code": 8,  "name": "General liability insurance",       "gwp_share": 0.13},
    {"code": 12, "name": "Miscellaneous financial loss",      "gwp_share": 0.08},
]
LOB_CODES = [l["code"] for l in LOB_CONFIG]
LOB_NAMES = {l["code"]: l["name"] for l in LOB_CONFIG}
GWP_SHARES = {l["code"]: l["gwp_share"] for l in LOB_CONFIG}

# ── EUR targets (annual, millions) ──────────────────────────────────
TOTAL_ASSETS_M = 6500.0
TOTAL_GWP_M = 2000.0
TARGET_COMBINED_RATIO = 0.96
TARGET_SCR_M = 1150.0
TARGET_OWN_FUNDS_M = 2000.0

# Quarter-over-quarter growth & seasonal factors
QUARTERLY_GROWTH = 0.008   # ~3.2% annual growth
SEASONAL_FACTORS = {1: 0.95, 2: 0.98, 3: 1.02, 4: 1.05}  # Q4 heaviest

# ── Countries ────────────────────────────────────────────────────────
SOVEREIGN_COUNTRIES = ["DE", "FR", "NL", "IT", "ES", "BE", "AT"]
SOVEREIGN_NAMES = {
    "DE": "Federal Republic of Germany", "FR": "Republic of France",
    "NL": "Kingdom of the Netherlands", "IT": "Republic of Italy",
    "ES": "Kingdom of Spain", "BE": "Kingdom of Belgium",
    "AT": "Republic of Austria",
}
SOVEREIGN_WEIGHTS = [0.25, 0.20, 0.15, 0.15, 0.10, 0.08, 0.07]

CORPORATE_SECTORS = {
    "K64": "Financial services", "K65": "Insurance", "C20": "Chemicals",
    "D35": "Energy", "H49": "Transport", "J61": "Telecoms",
    "C29": "Automotive", "F41": "Construction", "G47": "Retail",
}

CUSTODIANS = [
    "Euroclear Bank SA/NV", "Clearstream Banking AG",
    "BNP Paribas Securities Services", "Deutsche Bank AG – Custody",
    "State Street Bank GmbH",
]

SP_RATINGS = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-",
              "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-",
              "B+", "B", "B-", "CCC+", "CCC", "NR"]
RATING_TO_CQS = {
    "AAA": 0, "AA+": 0, "AA": 0, "AA-": 0,
    "A+": 1, "A": 1, "A-": 1,
    "BBB+": 2, "BBB": 2, "BBB-": 2,
    "BB+": 3, "BB": 3, "BB-": 3,
    "B+": 4, "B": 4, "B-": 4,
    "CCC+": 5, "CCC": 5, "NR": 6,
}

REINSURER_NAMES = [
    "Munich Re AG", "Swiss Re Ltd", "Hannover Rueck SE",
    "SCOR SE", "General Reinsurance AG", "PartnerRe Ltd",
    "Everest Re Group", "TransRe", "RenaissanceRe Holdings",
]

LOB_CESSION = {1: 0.15, 2: 0.15, 4: 0.25, 5: 0.20, 7: 0.30, 8: 0.25, 12: 0.20}

CLAIM_CAUSES = {
    1:  ["illness", "hospitalisation", "outpatient", "chronic"],
    2:  ["disability", "long_term_illness", "accident", "mental_health"],
    4:  ["collision", "pedestrian", "multi_vehicle", "single_vehicle"],
    5:  ["theft", "vandalism", "hail", "windscreen", "fire"],
    7:  ["fire", "water_damage", "storm", "burglary", "subsidence"],
    8:  ["product_liability", "professional_indemnity", "public_liability"],
    12: ["fraud", "business_interruption", "cyber", "credit_default"],
}

LOB_SEVERITY_MU = {1: 8.5, 2: 8.8, 4: 9.2, 5: 8.0, 7: 9.0, 8: 9.5, 12: 9.0}
LOB_SEVERITY_SIGMA = {1: 1.2, 2: 1.3, 4: 1.4, 5: 1.1, 7: 1.5, 8: 1.6, 12: 1.4}

# ── Corp name pools ──────────────────────────────────────────────────
_corp_first = ["Alpha", "Beta", "Gamma", "Delta", "Euro", "Nord", "Atlas",
               "Hansa", "Rhein", "Baltic", "Iberian", "Nordic", "Helvetia",
               "Continental", "Maritime", "Alpen", "Titan", "Orion", "Polaris",
               "Apex", "Nexus", "Vertex", "Zenith", "Prima", "Optima", "Nova"]
_corp_suffix = ["AG", "SE", "GmbH", "NV", "SA", "SAS", "BV", "SpA", "Ltd", "Plc"]
_corp_mid = ["Capital", "Finance", "Holdings", "Industries", "Group", "Invest",
             "Partners", "Solutions", "Services", "Technologies", "Energy",
             "Logistics", "Trading", "Insurance", "Securities", "Asset Management"]

# ── Helpers ──────────────────────────────────────────────────────────

def make_lei(seed_str):
    h = hashlib.sha256(f"{base_seed}_{seed_str}".encode()).hexdigest().upper()
    return h[:20]

def make_isin(country, idx):
    h = hashlib.md5(f"{base_seed}_{country}_{idx}".encode()).hexdigest().upper()
    return f"{country}{h[:9]}0"

def random_date(start, end, n=1):
    delta = (end - start).days
    if delta <= 0:
        return [start] * n
    days = rng.randint(0, delta, size=n)
    return [start + timedelta(int(d)) for d in days]

def to_eur(x):
    return round(float(x), 2)

def gen_market_values(n, total_target, sigma=0.8):
    raw = rng.lognormal(mean=0.0, sigma=sigma, size=n)
    return raw / raw.sum() * total_target

def table_exists(table_name):
    return spark.catalog.tableExists(f"{catalog}.{schema}.{table_name}")

def fqn(table_name):
    """Fully qualified table name with backtick quoting for numbered prefixes."""
    return f"`{catalog}`.`{schema}`.`{table_name}`"

def write_table(df_pandas, table_name, description, mode="overwrite"):
    """Write a pandas DataFrame to Delta. mode='overwrite' or 'append'.

    Always allows schema evolution: overwrite uses overwriteSchema, append
    uses mergeSchema. This keeps quarter-on-quarter backfills happy when a
    new column is added to the data generator.
    """
    full_name = fqn(table_name)
    sdf = spark.createDataFrame(df_pandas)
    writer = sdf.write.format("delta").mode(mode)
    if mode == "overwrite":
        writer = writer.option("overwriteSchema", "true")
    else:
        writer = writer.option("mergeSchema", "true")
    writer.saveAsTable(full_name)
    cnt = spark.table(full_name).count()
    spark.sql(f"COMMENT ON TABLE {full_name} IS '{description}'")
    print(f"  {table_name}: {cnt} rows")
    return cnt

def write_quarterly_table(df_pandas, table_name, description):
    """Write per-quarter data: deletes existing quarter rows then appends."""
    full_name = fqn(table_name)
    if table_exists(table_name):
        spark.sql(f"DELETE FROM {full_name} WHERE reporting_period = '{reporting_period}'")
        write_table(df_pandas, table_name, description, mode="append")
    else:
        write_table(df_pandas, table_name, description, mode="overwrite")

# Seasonal + growth multiplier for this quarter
seasonal = SEASONAL_FACTORS[rp_quarter]
quarters_from_base = (rp_year - 2025) * 4 + rp_quarter
growth = (1 + QUARTERLY_GROWTH) ** quarters_from_base

print(f"Seasonal factor: {seasonal}, Growth factor: {growth:.4f}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 0. Config tables
# MAGIC
# MAGIC Static reference + scenario configuration that persists across quarters.
# MAGIC These tables are deterministic — overwritten every run, so the latest
# MAGIC definition always wins.

# COMMAND ----------

# ── 0a. Feed SLA configuration ──────────────────────────────────────
# Drives the Control Tower freshness check. Each row is one expected feed
# with the SLA in business days after period close. The 5_mon_pipeline_sla_status
# table joins against this to compute on_time / late / missing per period.
feed_sla_rows = [
    # Non-life
    {"feed_name": "1_raw_assets",        "source_system": "Custodian",   "sla_business_days": 3, "criticality": "high",   "owner_team": "Investments"},
    {"feed_name": "1_raw_premiums",      "source_system": "Policy Mgmt", "sla_business_days": 3, "criticality": "high",   "owner_team": "Finance"},
    {"feed_name": "1_raw_claims",        "source_system": "Claims Mgmt", "sla_business_days": 3, "criticality": "high",   "owner_team": "Claims"},
    {"feed_name": "1_raw_expenses",      "source_system": "ERP",         "sla_business_days": 5, "criticality": "medium", "owner_team": "Finance"},
    {"feed_name": "1_raw_reinsurance",   "source_system": "RI Broker",   "sla_business_days": 3, "criticality": "high",   "owner_team": "Reinsurance"},
    {"feed_name": "1_raw_risk_factors",  "source_system": "Market Data", "sla_business_days": 2, "criticality": "high",   "owner_team": "Risk"},
    {"feed_name": "1_raw_exposures",     "source_system": "Underwriting","sla_business_days": 5, "criticality": "medium", "owner_team": "Underwriting"},
    # Life
    {"feed_name": "1_raw_life_policies",            "source_system": "Life Admin",    "sla_business_days": 3, "criticality": "high",   "owner_team": "Life Ops"},
    {"feed_name": "1_raw_life_claims",              "source_system": "Life Admin",    "sla_business_days": 3, "criticality": "high",   "owner_team": "Life Ops"},
    {"feed_name": "1_raw_life_lapses",              "source_system": "Life Admin",    "sla_business_days": 5, "criticality": "medium", "owner_team": "Life Actuarial"},
    {"feed_name": "1_raw_life_mortality_experience","source_system": "Life Actuarial","sla_business_days": 7, "criticality": "medium", "owner_team": "Life Actuarial"},
    {"feed_name": "1_raw_life_assumptions",         "source_system": "Life Actuarial","sla_business_days": 7, "criticality": "high",   "owner_team": "Life Actuarial"},
]
write_table(pd.DataFrame(feed_sla_rows), "0_cfg_feed_sla",
            "SLA configuration per source data feed — drives Control Tower freshness checks")

# ── 0b. BaFin questions fixture ─────────────────────────────────────
# Pre-staged regulator questions used by the Regulator Q&A workflow.
# Q4 2025 carries one realistic post-submission inquiry as a fixture.
bafin_rows = [
    {
        "question_id": "BFN-2026-001",
        "regulator": "BaFin",
        "received_date": "2026-01-26",  # 2 weeks after Q4 2025 submission
        "reporting_period": "2025-Q4",
        "topic": "Property reserves Q4 2025",
        "question": (
            "Please explain the 240bp combined ratio increase in Property line "
            "Q4 vs Q3 2025, with reference to your reserving methodology and "
            "any catastrophe events."
        ),
        "expected_context": "Storm event Dec 2025; reserve methodology; materiality",
        "status": "open",
        "due_date": "2026-02-09",
    },
]
write_table(pd.DataFrame(bafin_rows), "0_cfg_bafin_questions",
            "Pre-staged regulator (BaFin) questions used by the Regulator Q&A workflow")

# ── 0c. Assumption versions ─────────────────────────────────────────
# Models used to compute reserves / SCR have versioned assumption sets.
# This table catalogues which assumption version was active each period.
assumption_rows = [
    {"asset_class": "life", "version": "2024-v1", "effective_from": "2024-01-01", "effective_to": "2024-12-31",
     "summary": "Base mortality DAV2008T; lapse curve 2024 calibration; risk-free curve 2024-Q4 EIOPA"},
    {"asset_class": "life", "version": "2025-v1", "effective_from": "2025-01-01", "effective_to": "2025-12-31",
     "summary": "Updated mortality (-2% mortality improvement); lapse 2025 calibration; risk-free 2025-Q4 EIOPA"},
    {"asset_class": "life", "version": "2026-v1-candidate", "effective_from": "2026-01-01", "effective_to": None,
     "summary": "Higher unit-linked lapse stress (+15%); annuitant longevity updated; candidate for Q1 2026 cycle"},
    {"asset_class": "nonlife", "version": "2024-v1", "effective_from": "2024-01-01", "effective_to": "2024-12-31",
     "summary": "Standard formula 2024 USP; cat scenarios calibrated 2023"},
    {"asset_class": "nonlife", "version": "2025-v1", "effective_from": "2025-01-01", "effective_to": "2025-12-31",
     "summary": "Standard formula 2025 USP; cat scenarios refreshed for European storm risk"},
    {"asset_class": "nonlife", "version": "2026-v1-candidate", "effective_from": "2026-01-01", "effective_to": None,
     "summary": "Tighter NL UW correlation (~+1.5%); higher op risk parameter (~+1%); candidate for Q1 2026"},
]
write_table(pd.DataFrame(assumption_rows), "0_cfg_assumption_versions",
            "Versioned actuarial assumption sets — Champion + Challenger calibrations")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Counterparties
# MAGIC
# MAGIC Master register — written once, not per-quarter.

# COMMAND ----------

# Only generate if table doesn't exist or full_reset
_cp_exists = spark.catalog.tableExists(f"{catalog}.{schema}.`1_raw_counterparties`")

if not _cp_exists or mode == "full_reset":
    countries_pool = SOVEREIGN_COUNTRIES + ["LU", "IE", "FI", "SE", "DK", "PT", "CH"]
    nace_codes = list(CORPORATE_SECTORS.keys())
    cp_types = ["issuer", "issuer", "issuer", "issuer", "reinsurer", "bank"]
    rating_weights = np.array(
        [0.05] + [0.07]*3 + [0.10]*3 + [0.09]*3 + [0.04]*3 + [0.02]*3 + [0.01]*2 + [0.01]
    )
    rating_weights /= rating_weights.sum()

    counterparties = []
    for i in range(500):
        first = _corp_first[rng.randint(len(_corp_first))]
        mid = _corp_mid[rng.randint(len(_corp_mid))]
        suffix = _corp_suffix[rng.randint(len(_corp_suffix))]
        country = countries_pool[rng.randint(len(countries_pool))]
        rating = rng.choice(SP_RATINGS, p=rating_weights)

        counterparties.append({
            "counterparty_id": f"CP{i+1:05d}",
            "counterparty_name": f"{first} {mid} {suffix}",
            "lei": make_lei(f"cp_{i}"),
            "country": country,
            "sector_nace": nace_codes[rng.randint(len(nace_codes))],
            "credit_rating": rating,
            "credit_quality_step": int(RATING_TO_CQS[rating]),
            "counterparty_type": cp_types[rng.randint(len(cp_types))],
            "is_regulated": bool(rng.random() < 0.7),
        })

    write_table(pd.DataFrame(counterparties), "1_raw_counterparties",
                "Master counterparty register — issuers, reinsurers, banks")
else:
    print("  counterparties: already exists, skipping")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Assets (~5,000)
# MAGIC
# MAGIC Investment portfolio snapshot at quarter-end. Overwrites each quarter —
# MAGIC asset valuations change quarter to quarter.

# COMMAND ----------

N_ASSETS = 5000
TOTAL_MV = TOTAL_ASSETS_M * 1e6 * (1 + rng.uniform(-0.03, 0.03))  # slight variation

alloc = {"government_bonds": 0.60, "corporate_bonds": 0.20, "equity": 0.10, "ciu": 0.05, "property": 0.05}
n_gov = int(N_ASSETS * 0.60)
n_corp = int(N_ASSETS * 0.20)
n_eq = int(N_ASSETS * 0.10)
n_ciu = int(N_ASSETS * 0.05)
n_oth = N_ASSETS - n_gov - n_corp - n_eq - n_ciu

# Load 1_raw_counterparties for issuer linkage
df_cp = spark.table(f"{catalog}.{schema}.`1_raw_counterparties`").toPandas()
issuers = df_cp[df_cp["counterparty_type"] == "issuer"]

assets_rows = []
idx = 0

# -- Government bonds --
gov_mv = gen_market_values(n_gov, TOTAL_MV * alloc["government_bonds"], 0.9)
for i in range(n_gov):
    country = rng.choice(SOVEREIGN_COUNTRIES, p=SOVEREIGN_WEIGHTS)
    cic = f"{country}11"
    acq_date = random_date(date(2015,1,1), date(2025,6,30))[0]
    mat_years = rng.uniform(3, 15)
    mat_date = acq_date + timedelta(days=int(mat_years * 365.25))
    coupon = round(rng.uniform(0.005, 0.035), 4)
    par = to_eur(gov_mv[i] * rng.uniform(0.92, 1.08))
    mod_dur = round(rng.uniform(2.5, 12.0), 2)
    rating = rng.choice(["AAA","AA+","AA","AA-","A+","A"], p=[0.25,0.20,0.20,0.15,0.10,0.10])

    assets_rows.append({
        "asset_id": f"A{idx+1:06d}",
        "asset_name": f"{SOVEREIGN_NAMES[country]} {coupon*100:.2f}% {mat_date.year}",
        "issuer_name": SOVEREIGN_NAMES[country],
        "issuer_lei": make_lei(f"sov_{country}"),
        "issuer_country": country,
        "issuer_sector": "O84",
        "cic_code": cic,
        "currency": "EUR",
        "acquisition_date": acq_date,
        "maturity_date": mat_date,
        "par_value": par,
        "acquisition_cost": to_eur(gov_mv[i] * rng.uniform(0.95, 1.02)),
        "market_value_eur": to_eur(gov_mv[i]),
        "sii_value": to_eur(gov_mv[i] * rng.uniform(0.98, 1.02)),
        "accrued_interest": to_eur(par * coupon * rng.uniform(0.0, 0.5)),
        "coupon_rate": coupon,
        "credit_rating": rating,
        "credit_quality_step": int(RATING_TO_CQS[rating]),
        "portfolio_type": "Non-life",
        "custodian_name": rng.choice(CUSTODIANS),
        "is_listed": True,
        "infrastructure_flag": False,
        "modified_duration": mod_dur,
        "asset_class": "government_bonds",
        "reporting_period": reporting_period,
    })
    idx += 1

# -- Corporate bonds --
corp_mv = gen_market_values(n_corp, TOTAL_MV * alloc["corporate_bonds"], 0.85)
for i in range(n_corp):
    cp = issuers.iloc[rng.randint(len(issuers))]
    cic_suffix = rng.choice(["21", "22"], p=[0.85, 0.15])
    acq_date = random_date(date(2016,1,1), date(2025,6,30))[0]
    mat_years = rng.uniform(2, 10)
    mat_date = acq_date + timedelta(days=int(mat_years * 365.25))
    coupon = round(rng.uniform(0.015, 0.06), 4)
    par = to_eur(corp_mv[i] * rng.uniform(0.90, 1.10))
    mod_dur = round(rng.uniform(1.5, 8.0), 2)
    rating_w = np.array([0.02,0.05,0.08,0.10,0.12,0.15,0.12,0.10,0.08,0.06,0.04,0.03,0.02,0.01,0.01,0.005,0.002,0.002,0.001])
    rating_w /= rating_w.sum()
    rating = rng.choice(SP_RATINGS, p=rating_w)

    assets_rows.append({
        "asset_id": f"A{idx+1:06d}",
        "asset_name": f"{cp['counterparty_name']} {coupon*100:.2f}% {mat_date.year}",
        "issuer_name": cp["counterparty_name"],
        "issuer_lei": cp["lei"],
        "issuer_country": cp["country"],
        "issuer_sector": cp["sector_nace"],
        "cic_code": f"XL{cic_suffix}",
        "currency": "EUR",
        "acquisition_date": acq_date,
        "maturity_date": mat_date,
        "par_value": par,
        "acquisition_cost": to_eur(corp_mv[i] * rng.uniform(0.93, 1.05)),
        "market_value_eur": to_eur(corp_mv[i]),
        "sii_value": to_eur(corp_mv[i] * rng.uniform(0.97, 1.03)),
        "accrued_interest": to_eur(par * coupon * rng.uniform(0.0, 0.5)),
        "coupon_rate": coupon,
        "credit_rating": rating,
        "credit_quality_step": int(RATING_TO_CQS[rating]),
        "portfolio_type": "Non-life",
        "custodian_name": rng.choice(CUSTODIANS),
        "is_listed": True,
        "infrastructure_flag": bool(rng.random() < 0.05),
        "modified_duration": mod_dur,
        "asset_class": "corporate_bonds",
        "reporting_period": reporting_period,
    })
    idx += 1

# -- Equity --
_equity_names = [
    "Allianz SE", "AXA SA", "Zurich Insurance", "Generali SpA",
    "SAP SE", "Siemens AG", "ASML Holding NV", "TotalEnergies SE",
    "LVMH SE", "Unilever NV", "Nestlé SA", "Roche Holding AG",
    "Novartis AG", "Sanofi SA", "BNP Paribas SA", "Deutsche Bank AG",
    "ING Group NV", "Banco Santander SA", "Iberdrola SA", "Enel SpA",
]
eq_mv = gen_market_values(n_eq, TOTAL_MV * alloc["equity"], 0.7)
for i in range(n_eq):
    eq_name = _equity_names[i % len(_equity_names)]
    acq_date = random_date(date(2015,1,1), date(2025,6,30))[0]
    assets_rows.append({
        "asset_id": f"A{idx+1:06d}",
        "asset_name": eq_name,
        "issuer_name": eq_name,
        "issuer_lei": make_lei(f"eq_{i}"),
        "issuer_country": rng.choice(SOVEREIGN_COUNTRIES),
        "issuer_sector": rng.choice(["K64","C29","J61","D35","G47"]),
        "cic_code": "XL31",
        "currency": "EUR",
        "acquisition_date": acq_date,
        "maturity_date": None,
        "par_value": None,
        "acquisition_cost": to_eur(eq_mv[i] * rng.uniform(0.60, 1.10)),
        "market_value_eur": to_eur(eq_mv[i]),
        "sii_value": to_eur(eq_mv[i]),
        "accrued_interest": 0.0,
        "coupon_rate": None,
        "credit_rating": None,
        "credit_quality_step": None,
        "portfolio_type": "Non-life",
        "custodian_name": rng.choice(CUSTODIANS),
        "is_listed": True,
        "infrastructure_flag": False,
        "modified_duration": None,
        "asset_class": "equity",
        "reporting_period": reporting_period,
    })
    idx += 1

# -- CIUs --
ciu_mv = gen_market_values(n_ciu, TOTAL_MV * alloc["ciu"], 0.65)
_ciu_types = [("41","Equity Fund"),("42","Debt Fund"),("43","Money Market Fund"),
              ("44","Asset Allocation Fund"),("45","Real Estate Fund")]
for i in range(n_ciu):
    suffix, fund_type = _ciu_types[i % len(_ciu_types)]
    fund_name = f"{_corp_first[rng.randint(len(_corp_first))]} {fund_type}"
    assets_rows.append({
        "asset_id": f"A{idx+1:06d}",
        "asset_name": fund_name,
        "issuer_name": fund_name,
        "issuer_lei": make_lei(f"ciu_{i}"),
        "issuer_country": rng.choice(["LU","IE","DE","FR","NL"]),
        "issuer_sector": "K64",
        "cic_code": f"XL{suffix}",
        "currency": "EUR",
        "acquisition_date": random_date(date(2017,1,1), date(2025,6,30))[0],
        "maturity_date": None,
        "par_value": None,
        "acquisition_cost": to_eur(ciu_mv[i] * rng.uniform(0.85, 1.05)),
        "market_value_eur": to_eur(ciu_mv[i]),
        "sii_value": to_eur(ciu_mv[i]),
        "accrued_interest": 0.0,
        "coupon_rate": None,
        "credit_rating": None,
        "credit_quality_step": None,
        "portfolio_type": "Non-life",
        "custodian_name": rng.choice(CUSTODIANS),
        "is_listed": True,
        "infrastructure_flag": False,
        "modified_duration": None,
        "asset_class": "ciu",
        "reporting_period": reporting_period,
    })
    idx += 1

# -- Property / Other --
oth_mv = gen_market_values(n_oth, TOTAL_MV * alloc["property"], 0.6)
for i in range(n_oth):
    assets_rows.append({
        "asset_id": f"A{idx+1:06d}",
        "asset_name": f"Property Investment {i+1}",
        "issuer_name": f"Bricksurance Real Estate {i+1}",
        "issuer_lei": make_lei(f"prop_{i}"),
        "issuer_country": rng.choice(SOVEREIGN_COUNTRIES),
        "issuer_sector": "L68",
        "cic_code": "XL91",
        "currency": "EUR",
        "acquisition_date": random_date(date(2015,1,1), date(2024,6,30))[0],
        "maturity_date": None,
        "par_value": None,
        "acquisition_cost": to_eur(oth_mv[i] * rng.uniform(0.70, 1.00)),
        "market_value_eur": to_eur(oth_mv[i]),
        "sii_value": to_eur(oth_mv[i]),
        "accrued_interest": 0.0,
        "coupon_rate": None,
        "credit_rating": None,
        "credit_quality_step": None,
        "portfolio_type": "Non-life",
        "custodian_name": "Direct holding",
        "is_listed": False,
        "infrastructure_flag": False,
        "modified_duration": None,
        "asset_class": "property",
        "reporting_period": reporting_period,
    })
    idx += 1

df_assets = pd.DataFrame(assets_rows)

# ── Pain E — duplicate custodian bond entry in 2025-Q4 ──
# One Q4 row has an extra entry for the same asset with a duplicated row.
# Total assets in S.06.02 will be exactly EUR 2_300_000 higher than what
# own-funds reconciliation reflects. Discoverable by grouping assets by
# (asset_name, issuer_name) and looking for the duplicate.
PAIN_DUPE_ASSET = (reporting_period == "2025-Q4")
if PAIN_DUPE_ASSET:
    bond_rows = df_assets[df_assets["asset_class"].isin(["corporate_bonds", "government_bonds"])]
    if len(bond_rows) > 0:
        target = bond_rows.iloc[0].to_dict()
        duplicate = dict(target)
        duplicate["sii_value"] = 2_300_000.00
        duplicate["market_value_eur"] = 2_300_000.00
        # Distinct asset_id so DLT row constraints don't drop it, but the
        # asset_name + issuer + cic_code match the original — the discoverable clue.
        duplicate["asset_id"] = f"{target.get('asset_id', 'A')}-DUP"
        df_assets = pd.concat([df_assets, pd.DataFrame([duplicate])], ignore_index=True)

write_quarterly_table(df_assets, "1_raw_assets", "Investment portfolio — quarter-end snapshot")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Policies (~20,000)
# MAGIC
# MAGIC Written once (master register). Policies span multiple quarters.

# COMMAND ----------

_pol_exists = spark.catalog.tableExists(f"{catalog}.{schema}.`1_raw_policies`")

if not _pol_exists or mode == "full_reset":
    N_POLICIES = 20000
    policies = []
    for i in range(N_POLICIES):
        lob = LOB_CONFIG[rng.randint(len(LOB_CONFIG))]
        inception = random_date(date(2023,1,1), date(2025,9,30))[0]
        expiry = inception + timedelta(days=365)
        gwp = to_eur(rng.lognormal(mean=9.5, sigma=1.2) * GWP_SHARES[lob["code"]])

        policies.append({
            "policy_id": f"POL{i+1:06d}",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "inception_date": inception,
            "expiry_date": expiry,
            "gross_written_premium": gwp,
            "currency": "EUR",
            "country": rng.choice(SOVEREIGN_COUNTRIES),
            "status": rng.choice(["active","active","active","lapsed","cancelled"], p=[0.70,0.15,0.05,0.05,0.05]),
        })

    write_table(pd.DataFrame(policies), "1_raw_policies", "Policy register — all active and historical policies")
else:
    print("  policies: already exists, skipping")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Premiums (per quarter, ~20K transactions)
# MAGIC
# MAGIC Appended each quarter. Represents earned/written 1_raw_premiums by LoB.

# COMMAND ----------

quarterly_gwp = TOTAL_GWP_M * 1e6 / 4 * seasonal * growth
premiums = []

for lob in LOB_CONFIG:
    lob_gwp = quarterly_gwp * lob["gwp_share"]
    n_txn = int(2500 * lob["gwp_share"] / 0.08)  # roughly proportional
    txn_amounts = gen_market_values(n_txn, lob_gwp, sigma=0.6)

    cession_rate = LOB_CESSION[lob["code"]]

    for j in range(n_txn):
        gross = to_eur(txn_amounts[j])
        ri_share = to_eur(gross * cession_rate * rng.uniform(0.8, 1.2))
        net = to_eur(gross - ri_share)

        premiums.append({
            "transaction_id": f"PR-{reporting_period}-{lob['code']}-{j+1:05d}",
            "policy_id": f"POL{rng.randint(1, 20001):06d}",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "reporting_period": reporting_period,
            "gross_written_premium": gross,
            "gross_earned_premium": to_eur(gross * rng.uniform(0.90, 1.00)),
            "reinsurers_share_written": ri_share,
            "reinsurers_share_earned": to_eur(ri_share * rng.uniform(0.90, 1.00)),
            "net_written_premium": net,
            "net_earned_premium": to_eur(net * rng.uniform(0.90, 1.00)),
            "currency": "EUR",
        })

write_quarterly_table(pd.DataFrame(premiums), "1_raw_premiums",
            "Premium transactions by LoB — one quarter per run")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Claims (per quarter, ~15K transactions)
# MAGIC
# MAGIC Appended each quarter. Detailed claim events.

# COMMAND ----------

claims = []
PROPERTY_LOB = 7  # Fire and other property insurance
PAIN_PROPERTY_STORM = (reporting_period == "2025-Q4")
PAIN_LEGACY_DQ_BREAK = (reporting_period == "2025-Q4")

for lob in LOB_CONFIG:
    n_claims = int(15000 * lob["gwp_share"]) + rng.randint(-50, 50)

    # Pain C — December storm: concentrate 60% of property claim count in the
    # last 14 days of December, with a fat-tailed amount distribution. The
    # incurred uplift drives ~+18% on Q4 property BEL via the existing reserve
    # mapping.
    storm_concentrated = (PAIN_PROPERTY_STORM and lob["code"] == PROPERTY_LOB)
    storm_n = int(n_claims * 0.60) if storm_concentrated else 0

    for j in range(n_claims):
        is_storm = storm_concentrated and j < storm_n

        if is_storm:
            # Storm severity: many small + several large (long-tail)
            base_mu = LOB_SEVERITY_MU[lob["code"]] + 0.30
            base_sig = LOB_SEVERITY_SIGMA[lob["code"]] + 0.40
            severity = to_eur(rng.lognormal(base_mu, base_sig))
        else:
            severity = to_eur(rng.lognormal(LOB_SEVERITY_MU[lob["code"]], LOB_SEVERITY_SIGMA[lob["code"]]))

        paid_pct = rng.uniform(0.3, 1.0)
        gross_paid = to_eur(severity * paid_pct)
        gross_incurred = to_eur(severity)
        cession = LOB_CESSION[lob["code"]]
        ri_paid = to_eur(gross_paid * cession * rng.uniform(0.8, 1.2))
        ri_incurred = to_eur(gross_incurred * cession * rng.uniform(0.8, 1.2))

        if is_storm:
            # Concentrate loss_date in Dec 18-31 of reporting year
            day_offset = rng.randint(0, 14)
            loss_date = date(rp_year, 12, 18) + timedelta(days=int(day_offset))
        else:
            loss_date = random_date(
                date(rp_year, (rp_quarter-1)*3+1, 1),
                rpt_date
            )[0]

        claims.append({
            "claim_id": f"CLM-{reporting_period}-{lob['code']}-{j+1:06d}",
            "policy_id": f"POL{rng.randint(1, 20001):06d}",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "reporting_period": reporting_period,
            "loss_date": loss_date,
            "notification_date": loss_date + timedelta(days=int(rng.exponential(15))),
            "cause": rng.choice(CLAIM_CAUSES[lob["code"]]),
            "gross_paid": gross_paid,
            "gross_incurred": gross_incurred,
            "gross_reserved": to_eur(gross_incurred - gross_paid),
            "reinsurers_share_paid": ri_paid,
            "reinsurers_share_incurred": ri_incurred,
            "net_paid": to_eur(gross_paid - ri_paid),
            "net_incurred": to_eur(gross_incurred - ri_incurred),
            "status": rng.choice(["open","open","settled","reopened"], p=[0.4,0.3,0.25,0.05]),
            "currency": "EUR",
            # Pain B/C tagging: system migration source + storm event tag.
            # In Q1-Q3 every row is core_v3; in Q4 a 47-row legacy block is
            # injected below, and storm-concentrated rows get an event_id.
            "system_source": "core_v3",
            "event_id": ("storm_dec_2025" if is_storm else None),
        })

# ── Pain B — 47 legacy_pre_migration rows with negative paid_amount in Q4 ──
# These will be quarantined by the existing DLT expectation that drops
# negative paid amounts. The system_source field is the discoverable clue.
if PAIN_LEGACY_DQ_BREAK:
    for k in range(47):
        # Spread across LoBs proportional to GWP share, but use a known mix
        lob = LOB_CONFIG[k % len(LOB_CONFIG)]
        # Legacy system reported these as REVERSALS — negative paid amount
        bad_amount = -1.0 * float(rng.uniform(50, 5000))
        claims.append({
            "claim_id": f"CLM-{reporting_period}-LEGACY-{k+1:04d}",
            "policy_id": f"POL{rng.randint(1, 20001):06d}",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "reporting_period": reporting_period,
            "loss_date": date(rp_year, 11, 1) + timedelta(days=int(rng.randint(0, 60))),
            "notification_date": date(rp_year, 12, 1),
            "cause": "subrogation_reversal",
            "gross_paid": to_eur(bad_amount),     # negative — will fail DLT EXPECT
            "gross_incurred": to_eur(bad_amount),
            "gross_reserved": to_eur(0.0),
            "reinsurers_share_paid": to_eur(0.0),
            "reinsurers_share_incurred": to_eur(0.0),
            "net_paid": to_eur(bad_amount),
            "net_incurred": to_eur(bad_amount),
            "status": "settled",
            "currency": "EUR",
            "system_source": "legacy_pre_migration",  # the discoverable clue
            "event_id": None,
        })

write_quarterly_table(pd.DataFrame(claims), "1_raw_claims",
            "Claims transactions — loss events with paid/incurred/reserved (system_source tags migration cohort)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Expenses (per quarter, by LoB)

# COMMAND ----------

expenses = []
for lob in LOB_CONFIG:
    lob_gwp_q = TOTAL_GWP_M * 1e6 / 4 * lob["gwp_share"] * seasonal * growth
    acquisition = to_eur(lob_gwp_q * rng.uniform(0.12, 0.18))
    administrative = to_eur(lob_gwp_q * rng.uniform(0.05, 0.09))
    claims_mgmt = to_eur(lob_gwp_q * rng.uniform(0.03, 0.06))
    overhead = to_eur(lob_gwp_q * rng.uniform(0.02, 0.04))
    investment_mgmt = to_eur(lob_gwp_q * rng.uniform(0.005, 0.015))
    other = to_eur(lob_gwp_q * rng.uniform(0.005, 0.01))

    expenses.append({
        "lob_code": lob["code"],
        "lob_name": lob["name"],
        "reporting_period": reporting_period,
        "acquisition_expenses": acquisition,
        "administrative_expenses": administrative,
        "claims_management_expenses": claims_mgmt,
        "overhead_expenses": overhead,
        "investment_management_expenses": investment_mgmt,
        "other_expenses": other,
        "total_expenses": to_eur(acquisition + administrative + claims_mgmt + overhead + investment_mgmt + other),
        "currency": "EUR",
    })

write_quarterly_table(pd.DataFrame(expenses), "1_raw_expenses",
            "Expense allocation by LoB — quarterly breakdown")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Reinsurance Programme
# MAGIC
# MAGIC Written once — treaty structure doesn't change per quarter.

# COMMAND ----------

_ri_exists = spark.catalog.tableExists(f"{catalog}.{schema}.`1_raw_reinsurance`")

if not _ri_exists or mode == "full_reset":
    ri_rows = []
    treaty_idx = 0
    for lob in LOB_CONFIG:
        # Quota share
        ri_rows.append({
            "treaty_id": f"RI{treaty_idx+1:04d}",
            "treaty_name": f"QS {lob['name'][:20]}",
            "treaty_type": "quota_share",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "reinsurer": rng.choice(REINSURER_NAMES),
            "cession_rate": round(LOB_CESSION[lob["code"]], 3),
            "retention": round(1 - LOB_CESSION[lob["code"]], 3),
            "limit_eur": None,
            "deductible_eur": None,
            "inception_date": date(rp_year, 1, 1),
            "expiry_date": date(rp_year, 12, 31),
            "currency": "EUR",
        })
        treaty_idx += 1

        # Excess of loss
        lob_gwp = TOTAL_GWP_M * 1e6 * lob["gwp_share"]
        ri_rows.append({
            "treaty_id": f"RI{treaty_idx+1:04d}",
            "treaty_name": f"XL {lob['name'][:20]}",
            "treaty_type": "excess_of_loss",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "reinsurer": rng.choice(REINSURER_NAMES),
            "cession_rate": None,
            "retention": None,
            "limit_eur": to_eur(lob_gwp * rng.uniform(0.15, 0.30)),
            "deductible_eur": to_eur(lob_gwp * rng.uniform(0.01, 0.05)),
            "inception_date": date(rp_year, 1, 1),
            "expiry_date": date(rp_year, 12, 31),
            "currency": "EUR",
        })
        treaty_idx += 1

    write_table(pd.DataFrame(ri_rows), "1_raw_reinsurance",
                "Reinsurance programme — QS and XL treaties by LoB")
else:
    print("  reinsurance: already exists, skipping")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8. Claims Triangles (10 accident years x 8 LoBs)
# MAGIC
# MAGIC Development triangles for reserving. Regenerated per quarter as new development is observed.

# COMMAND ----------

# Triangle config — same LoBs, different tail patterns
TRIANGLE_LOB = {
    1: {"name": "Medical expense",  "ultimate_base": 50_000_000,  "tail": "short"},
    2: {"name": "Income protection","ultimate_base": 35_000_000,  "tail": "medium"},
    4: {"name": "Motor liability",  "ultimate_base": 100_000_000, "tail": "long"},
    5: {"name": "Other motor",      "ultimate_base": 45_000_000,  "tail": "short"},
    7: {"name": "Property",         "ultimate_base": 55_000_000,  "tail": "medium"},
    8: {"name": "General liability", "ultimate_base": 70_000_000,  "tail": "long"},
    12:{"name": "Misc financial",   "ultimate_base": 20_000_000,  "tail": "medium"},
}

DEV_PATTERNS = {
    "long":   [0.15, 0.35, 0.52, 0.65, 0.75, 0.83, 0.89, 0.93, 0.96, 0.98],
    "medium": [0.30, 0.55, 0.72, 0.83, 0.90, 0.94, 0.97, 0.985, 0.995, 1.00],
    "short":  [0.50, 0.78, 0.90, 0.95, 0.975, 0.99, 0.995, 0.998, 1.00, 1.00],
}
IBNR_FACTORS = {
    "long":   [1.60, 1.45, 1.30, 1.20, 1.12, 1.08, 1.05, 1.03, 1.01, 1.00],
    "medium": [1.40, 1.28, 1.18, 1.10, 1.06, 1.03, 1.02, 1.01, 1.005, 1.00],
    "short":  [1.25, 1.12, 1.06, 1.03, 1.015, 1.005, 1.002, 1.001, 1.00, 1.00],
}

accident_years = list(range(rp_year - 10 + 1, rp_year))
tri_rows = []

for lob_code, cfg in TRIANGLE_LOB.items():
    tail = cfg["tail"]
    pattern = DEV_PATTERNS[tail]
    ibnr_pat = IBNR_FACTORS[tail]

    for ay in accident_years:
        years_from_start = ay - accident_years[0]
        growth_f = (1.03) ** years_from_start
        noise = 1.0 + rng.uniform(-0.15, 0.15)
        ultimate = cfg["ultimate_base"] * growth_f * noise
        max_dev = min(10, rp_year - ay)

        cum_paid = 0.0
        cum_inc = 0.0

        for dev in range(1, max_dev + 1):
            target_cum_paid = ultimate * pattern[dev-1] * (1 + rng.uniform(-0.03, 0.03))
            if target_cum_paid < cum_paid:
                target_cum_paid = cum_paid + abs(rng.normal(0, ultimate * 0.005))
            inc_paid = round(target_cum_paid - cum_paid, 2)
            cum_paid = round(cum_paid + inc_paid, 2)

            ibnr_mult = max(1.0, ibnr_pat[dev-1] * (1 + rng.uniform(-0.02, 0.02)))
            target_cum_inc = cum_paid * ibnr_mult
            if target_cum_inc < cum_inc:
                target_cum_inc = cum_inc + abs(rng.normal(0, ultimate * 0.002))
            if target_cum_inc < cum_paid:
                target_cum_inc = cum_paid
            inc_inc = round(target_cum_inc - cum_inc, 2)
            cum_inc = round(cum_inc + inc_inc, 2)

            tri_rows.append({
                "accident_year": int(ay),
                "development_period": int(dev),
                "lob_code": int(lob_code),
                "lob_name": cfg["name"],
                "incremental_paid": round(inc_paid, 2),
                "incremental_incurred": round(inc_inc, 2),
                "cumulative_paid": round(cum_paid, 2),
                "cumulative_incurred": round(cum_inc, 2),
                "reporting_period": reporting_period,
            })

write_quarterly_table(pd.DataFrame(tri_rows), "1_raw_claims_triangles",
            "Claims development triangles — paid & incurred by AY, dev period, LoB")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8L. Life Book (composite insurer — life side of the balance sheet)
# MAGIC
# MAGIC Six bronze tables matching the depth of the non-life side. Together they
# MAGIC support life best-estimate liability calculation, S.12.01 (Life TPs), and
# MAGIC the Prophet mock engine that produces life UW SCR sub-modules.

# COMMAND ----------

# ── Life book reference data ─────────────────────────────────────────
LIFE_LOBS = [
    # (code, eiopa_lob, internal_name, mix_share, mean_sa_eur, sa_sigma, premium_pct,
    #  mean_age, age_sigma, base_lapse_pa, in_force_target_at_q1_2025)
    {"code": 29, "lob": "with_profit",  "name": "Insurance with profit participation",
     "mix": 0.25, "mean_sa": 40_000,  "sa_sigma": 0.7, "premium_pct": 0.020,
     "mean_age": 58, "age_sigma": 10, "base_lapse": 0.040, "in_force_target": 12500},
    {"code": 30, "lob": "unit_linked", "name": "Index-linked and unit-linked insurance",
     "mix": 0.35, "mean_sa": 25_000,  "sa_sigma": 0.9, "premium_pct": 0.025,
     "mean_age": 45, "age_sigma": 12, "base_lapse": 0.070, "in_force_target": 17500},
    {"code": 31, "lob": "term",        "name": "Other life insurance — Term",
     "mix": 0.20, "mean_sa": 100_000, "sa_sigma": 0.8, "premium_pct": 0.003,
     "mean_age": 40, "age_sigma": 9,  "base_lapse": 0.080, "in_force_target": 10000},
    {"code": 32, "lob": "whole_of_life","name": "Other life insurance — Whole of life",
     "mix": 0.10, "mean_sa": 30_000,  "sa_sigma": 0.6, "premium_pct": 0.050,
     "mean_age": 70, "age_sigma": 8,  "base_lapse": 0.030, "in_force_target": 5000},
    {"code": 33, "lob": "annuity",     "name": "Annuities stemming from non-life contracts",
     "mix": 0.05, "mean_sa": 15_000,  "sa_sigma": 0.5, "premium_pct": 0.000,
     "mean_age": 75, "age_sigma": 7,  "base_lapse": 0.005, "in_force_target": 2500},
    {"code": 34, "lob": "health_slt",  "name": "Health SLT insurance",
     "mix": 0.05, "mean_sa": 5_000,   "sa_sigma": 0.4, "premium_pct": 0.040,
     "mean_age": 50, "age_sigma": 11, "base_lapse": 0.100, "in_force_target": 2500},
]

# Simplified mortality table (qx, base) — derived from DAV2008T-style aggregate.
# 5-year age bands; we interpolate by age inside a band.
MORTALITY_BANDS = {
    20: 0.00050, 25: 0.00060, 30: 0.00075, 35: 0.00100, 40: 0.00150,
    45: 0.00220, 50: 0.00330, 55: 0.00500, 60: 0.00780, 65: 0.01200,
    70: 0.01900, 75: 0.03100, 80: 0.05300, 85: 0.09000, 90: 0.15000,
    95: 0.25000, 100: 0.40000,
}
def qx(age: int) -> float:
    """Annual mortality rate for an age (interpolated linearly between bands)."""
    age = max(20, min(100, age))
    lower = (age // 5) * 5
    upper = lower + 5
    if upper > 100:
        return MORTALITY_BANDS[100]
    q_lo = MORTALITY_BANDS[lower]
    q_hi = MORTALITY_BANDS[min(upper, 100)]
    frac = (age - lower) / 5
    return q_lo + (q_hi - q_lo) * frac

LIFE_COUNTRY_WEIGHTS = {"DE": 0.40, "FR": 0.30, "IT": 0.20, "NL": 0.05, "BE": 0.03, "ES": 0.02}

# Total in-force target ≈ 50_000
TOTAL_LIFE_POLICIES = sum(l["in_force_target"] for l in LIFE_LOBS)

print(f"Life book design: {TOTAL_LIFE_POLICIES} in-force policies across {len(LIFE_LOBS)} LoBs")

# COMMAND ----------

# ── 8L.1 — 1_raw_life_policies (master, written once) ───────────────
# Each policy has: id, lob, country, age_at_issue, current_age, sex, sum_assured,
# annual_premium, issue_date, status (in_force/lapsed/matured/dead), exit_date.
# We generate the *book as of 2025-12-31* and then derive in-force at any past
# date using issue_date + exit_date filters.

# Run only on Q1 of any year — master table doesn't need quarterly regeneration
LIFE_MASTER_TABLE = "1_raw_life_policies"
if not table_exists(LIFE_MASTER_TABLE):
    rng_life = np.random.RandomState(base_seed + 1000)
    # Issue dates spread over 30 years (1996-01-01 through 2025-12-31) to simulate
    # an established book with a realistic duration distribution.
    issue_start = date(1996, 1, 1)
    issue_end = date(2025, 12, 31)
    issue_span_days = (issue_end - issue_start).days

    rows = []
    pid = 100_000_000
    for lob in LIFE_LOBS:
        n = lob["in_force_target"]
        # Generate roughly 1.7x policies — some lapsed/matured before 2025-12-31
        n_total = int(n * 1.7)
        # Issue date: more recent issues are more likely to still be in-force
        # so weight issue_date to be more recent (right-skewed)
        issue_offset = (rng_life.beta(2.0, 1.5, size=n_total) * issue_span_days).astype(int)
        issue_dates = pd.to_datetime(pd.Timestamp(issue_start)) + pd.to_timedelta(issue_offset, unit="D")

        ages_at_issue = np.clip(
            rng_life.normal(lob["mean_age"] - 5, lob["age_sigma"], n_total).round().astype(int),
            18, 90
        )
        sex = rng_life.choice(["M", "F"], size=n_total, p=[0.52, 0.48])
        countries = rng_life.choice(
            list(LIFE_COUNTRY_WEIGHTS.keys()),
            size=n_total,
            p=list(LIFE_COUNTRY_WEIGHTS.values()),
        )

        # Sum assured / income — log-normal scaled to LoB mean
        sa = np.exp(rng_life.normal(np.log(lob["mean_sa"]), lob["sa_sigma"], n_total))
        sa = np.round(np.clip(sa, lob["mean_sa"] * 0.1, lob["mean_sa"] * 25), 2)

        # Annual premium — % of SA (annuities are single-premium; we record purchase price)
        if lob["lob"] == "annuity":
            annual_premium = np.zeros(n_total)
            single_premium = np.round(sa * 12, 2)  # 12x annual income as approx purchase price
        else:
            annual_premium = np.round(sa * lob["premium_pct"], 2)
            single_premium = np.zeros(n_total)

        # Decide who's still in-force at 2025-12-31. We assume:
        #   - constant exit hazard at lob["base_lapse"] per year (simple Markov)
        #   - some fraction matured naturally for term/WoL based on policy term
        years_held = ((pd.Timestamp("2025-12-31") - issue_dates) / pd.Timedelta(days=365.25)).values
        # Survival to 2025-12-31 for the in-force decision
        survival_prob = (1 - lob["base_lapse"]) ** np.maximum(years_held, 0)
        # Add mortality drag — coarse but enough for the demo
        mortality_drag = np.array([1 - qx(int(a))*y*0.5 for a, y in zip(ages_at_issue, np.maximum(years_held, 0))])
        survival_prob = np.clip(survival_prob * mortality_drag, 0.05, 1.0)
        random_draw = rng_life.random(n_total)
        in_force_at_2025q4 = random_draw < survival_prob

        # Take the first n that are in-force; fill the rest with not-in-force to reach n_total
        # (reorder so the number of in-force at end-of-2025 ≈ in_force_target)
        order = np.argsort(~in_force_at_2025q4)  # in-force first
        # Keep all rows; the in_force flag drives status
        for k in range(n_total):
            i = order[k] if k < n else order[k]
            still_in_force = bool(in_force_at_2025q4[i])
            if still_in_force:
                status = "in_force"
                exit_date_val = None
            else:
                # Lapsed somewhere between issue_date and 2025-12-31
                lapse_offset = rng_life.uniform(0.2, 0.95) * max(years_held[i], 0.1) * 365
                exit_dt = issue_dates[i] + pd.to_timedelta(int(lapse_offset), unit="D")
                if exit_dt > pd.Timestamp("2025-12-31"):
                    exit_dt = pd.Timestamp("2025-12-31")
                # Mortality vs lapse mix — older policyholders more likely "deceased"
                if rng_life.random() < (qx(int(ages_at_issue[i]) + int(years_held[i])) * 5):
                    status = "deceased"
                else:
                    status = "lapsed" if lob["lob"] != "annuity" else "matured"
                exit_date_val = exit_dt.date().isoformat()

            current_age = int(ages_at_issue[i] + years_held[i])
            rows.append({
                "policy_id": f"L{pid + k:09d}",
                "lob_code": lob["code"],
                "lob_name": lob["lob"],
                "lob_eiopa_name": lob["name"],
                "country": countries[i],
                "currency": "EUR",
                "sex": sex[i],
                "age_at_issue": int(ages_at_issue[i]),
                "current_age": current_age,
                "issue_date": issue_dates[i].date().isoformat(),
                "status": status,
                "exit_date": exit_date_val,
                "sum_assured_eur": float(sa[i]) if lob["lob"] != "annuity" else 0.0,
                "annuity_income_eur": float(sa[i]) if lob["lob"] == "annuity" else 0.0,
                "annual_premium_eur": float(annual_premium[i]),
                "single_premium_eur": float(single_premium[i]),
                "premium_frequency": "annual" if annual_premium[i] > 0 else "single",
            })
        pid += n_total

    write_table(pd.DataFrame(rows), LIFE_MASTER_TABLE,
                "Life policy register — full book (in_force, lapsed, deceased, matured)")
else:
    print(f"  {LIFE_MASTER_TABLE}: already exists — skipping master regeneration")

# COMMAND ----------

# ── 8L.2 — 1_raw_life_assumptions (master, versioned per asset class) ──
# Granular per-(LoB × parameter × version) view — overwritten so latest wins.
LIFE_ASSUMPTIONS_TABLE = "1_raw_life_assumptions"
assumption_rows = []
# Active assumption set per period
period_to_version = {
    "2024-Q1": "2024-v1", "2024-Q2": "2024-v1", "2024-Q3": "2024-v1", "2024-Q4": "2024-v1",
    "2025-Q1": "2025-v1", "2025-Q2": "2025-v1", "2025-Q3": "2025-v1", "2025-Q4": "2025-v1",
}
for lob in LIFE_LOBS:
    for version, calibration_year, lapse_uplift, mortality_uplift in [
        ("2024-v1", 2024, 1.00, 1.000),
        ("2025-v1", 2025, 1.00, 0.980),  # 2% mortality improvement
        ("2026-v1-candidate", 2026, 1.15, 0.975),  # +15% lapse stress for UL; further mortality update
    ]:
        # Lapse stress only really moves unit-linked in the candidate — others unchanged
        if version == "2026-v1-candidate" and lob["lob"] != "unit_linked":
            applied_lapse_uplift = 1.05  # small uplift for everything else
        else:
            applied_lapse_uplift = lapse_uplift
        assumption_rows.append({
            "version": version,
            "calibration_year": calibration_year,
            "lob_code": lob["code"],
            "lob_name": lob["lob"],
            "base_lapse_rate_pa": round(lob["base_lapse"], 4),
            "stressed_lapse_rate_pa": round(lob["base_lapse"] * applied_lapse_uplift, 4),
            "mortality_multiplier": round(mortality_uplift, 4),
            "expense_per_policy_eur": 65.0 if version != "2026-v1-candidate" else 70.0,
            "discount_curve_source": f"EIOPA risk-free {calibration_year}-Q4",
        })
write_table(pd.DataFrame(assumption_rows), LIFE_ASSUMPTIONS_TABLE,
            "Granular life actuarial assumptions per (LoB, version) — used by Prophet mock engine")

# COMMAND ----------

# ── 8L.3 — 1_raw_life_lapses (quarterly) ────────────────────────────
# Quarterly lapse experience: count of policies lapsed in this quarter, by
# LoB × policy duration band. Pain D engineering happens here:
# in 2025-Q4 only, unit-linked lapses spike by x1.35.

# Read in-force snapshot from master (only counts in-force at quarter start)
# Quarter-start = first day of (rp_year, rp_quarter)
quarter_start = pd.Timestamp(f"{rp_year}-{(rp_quarter-1)*3+1:02d}-01")
quarter_end = pd.Timestamp(reporting_date)

life_master_df = spark.table(fqn(LIFE_MASTER_TABLE)).toPandas()
life_master_df["issue_date"] = pd.to_datetime(life_master_df["issue_date"])
life_master_df["exit_date"] = pd.to_datetime(life_master_df["exit_date"])

# In-force at quarter start = issued before quarter_start AND (no exit OR exit after quarter_start)
in_force_mask = (
    (life_master_df["issue_date"] <= quarter_start) &
    ((life_master_df["exit_date"].isna()) | (life_master_df["exit_date"] > quarter_start))
)
in_force_df = life_master_df.loc[in_force_mask].copy()
in_force_df["duration_yrs"] = ((quarter_start - in_force_df["issue_date"]) / pd.Timedelta(days=365.25)).clip(lower=0)
in_force_df["duration_band"] = pd.cut(
    in_force_df["duration_yrs"],
    bins=[-0.01, 1, 3, 5, 10, 20, 100],
    labels=["0-1y", "1-3y", "3-5y", "5-10y", "10-20y", "20y+"],
)

# Pain D: unit-linked lapse spike in 2025-Q4 only
def lapse_uplift(lob_name: str, period: str) -> float:
    if period == "2025-Q4" and lob_name == "unit_linked":
        return 1.35
    return 1.00

lapse_rows = []
for lob in LIFE_LOBS:
    sub = in_force_df[in_force_df["lob_code"] == lob["code"]]
    if sub.empty:
        continue
    quarterly_base_lapse = lob["base_lapse"] / 4.0
    uplift = lapse_uplift(lob["lob"], reporting_period)
    for band, band_df in sub.groupby("duration_band", observed=True):
        n_in_force = len(band_df)
        if n_in_force == 0:
            continue
        # Duration drives a slight lapse curve shape (newer business lapses more)
        band_factor = {"0-1y": 1.4, "1-3y": 1.2, "3-5y": 1.0, "5-10y": 0.85, "10-20y": 0.6, "20y+": 0.4}.get(str(band), 1.0)
        lapse_rate_q = quarterly_base_lapse * uplift * band_factor
        n_lapsed = int(round(n_in_force * lapse_rate_q))
        # Surrender value: rough 80% of premium reserve (modeled as 70% of SA-equivalent)
        avg_sa = float(band_df["sum_assured_eur"].mean()) if lob["lob"] != "annuity" else float(band_df["annuity_income_eur"].mean())
        avg_surrender_value = round(0.70 * avg_sa, 2)
        lapse_rows.append({
            "reporting_period": reporting_period,
            "lob_code": lob["code"],
            "lob_name": lob["lob"],
            "duration_band": str(band),
            "in_force_at_quarter_start": n_in_force,
            "lapsed_in_quarter": n_lapsed,
            "lapse_rate_quarterly": round(lapse_rate_q, 5),
            "annualised_lapse_rate": round(lapse_rate_q * 4, 5),
            "avg_surrender_value_eur": avg_surrender_value,
            "total_surrender_payment_eur": round(avg_surrender_value * n_lapsed, 2),
            "assumption_version": period_to_version.get(reporting_period, "unknown"),
        })
write_quarterly_table(pd.DataFrame(lapse_rows), "1_raw_life_lapses",
            "Quarterly life lapse experience by LoB and policy duration band")

# COMMAND ----------

# ── 8L.4 — 1_raw_life_claims (quarterly) ────────────────────────────
# Death + surrender + annuity-payment events recorded this quarter.
claim_rows = []
claim_id_seq = base_seed * 100_000 + (rp_year * 100 + rp_quarter) * 10_000

for lob in LIFE_LOBS:
    sub = in_force_df[in_force_df["lob_code"] == lob["code"]]
    if sub.empty:
        continue
    # Death claims: expected deaths = sum(qx_per_quarter) over in-force
    # Use simple per-policy q based on current age (approximated)
    ages = sub["current_age"].values.astype(int)
    qx_pa = np.array([qx(int(a)) for a in ages])
    qx_q = qx_pa / 4.0
    # Mortality calibration: 2025-v1 multiplier of 0.98
    mort_mult = 1.000 if reporting_period.startswith("2024") else 0.980
    expected_deaths = float(np.sum(qx_q * mort_mult))
    n_deaths = int(round(expected_deaths))

    if lob["lob"] == "annuity":
        # Annuities pay quarterly while annuitant alive — record one row per policy
        n_payments = len(sub)
        if n_payments > 0:
            avg_payment = float(sub["annuity_income_eur"].mean()) / 4.0
            for _ in range(min(n_payments, 5_000)):  # cap to keep volume manageable
                claim_id_seq += 1
                claim_rows.append({
                    "claim_id": f"LC{claim_id_seq:010d}",
                    "policy_id": None,  # aggregated
                    "reporting_period": reporting_period,
                    "lob_code": lob["code"],
                    "lob_name": lob["lob"],
                    "claim_type": "annuity_payment",
                    "claim_date": (quarter_end - pd.Timedelta(days=int(rng.uniform(0, 90)))).date().isoformat(),
                    "amount_eur": round(avg_payment, 2),
                    "currency": "EUR",
                    "status": "paid",
                })
    else:
        # Death claims
        if n_deaths > 0:
            sample_deaths = sub.sample(n=min(n_deaths, len(sub)), random_state=quarter_seed + lob["code"])
            for _, r in sample_deaths.iterrows():
                claim_id_seq += 1
                claim_rows.append({
                    "claim_id": f"LC{claim_id_seq:010d}",
                    "policy_id": r["policy_id"],
                    "reporting_period": reporting_period,
                    "lob_code": lob["code"],
                    "lob_name": lob["lob"],
                    "claim_type": "death",
                    "claim_date": (quarter_end - pd.Timedelta(days=int(rng.uniform(0, 90)))).date().isoformat(),
                    "amount_eur": float(r["sum_assured_eur"]),
                    "currency": "EUR",
                    "status": "paid",
                })
        # Surrenders for non-annuity products are captured in the lapses table — no duplicate.

write_quarterly_table(pd.DataFrame(claim_rows), "1_raw_life_claims",
            "Life claims (death + annuity payments) recorded in the quarter")

# COMMAND ----------

# ── 8L.5 — 1_raw_life_mortality_experience (quarterly) ──────────────
# Actual vs expected deaths by 5-year age band, for the experience study.
mortality_rows = []
for band_lo in range(20, 100, 5):
    band_hi = band_lo + 5
    sub = in_force_df[(in_force_df["current_age"] >= band_lo) & (in_force_df["current_age"] < band_hi)]
    if len(sub) == 0:
        continue
    # Expected qx is the band's table value, quarterly
    expected_qx_q = MORTALITY_BANDS.get(band_lo, MORTALITY_BANDS[max(MORTALITY_BANDS.keys())]) / 4.0
    expected_deaths = round(float(len(sub) * expected_qx_q), 2)
    # Actual deaths — pull from claims table for this band
    band_claim_count = sum(
        1 for c in claim_rows
        if c["claim_type"] == "death" and band_lo <= int(life_master_df.loc[life_master_df["policy_id"] == c["policy_id"], "current_age"].iloc[0]) < band_hi
    ) if claim_rows else 0
    # Approximate actual = expected ± noise to keep the demo realistic
    actual_deaths = max(0, int(round(expected_deaths * rng.uniform(0.85, 1.10))))
    mortality_rows.append({
        "reporting_period": reporting_period,
        "age_band": f"{band_lo}-{band_hi-1}",
        "exposed_lives": len(sub),
        "expected_deaths": expected_deaths,
        "actual_deaths": actual_deaths,
        "ae_ratio": round(actual_deaths / expected_deaths, 3) if expected_deaths > 0 else None,
        "table_basis": "DAV2008T (composite)",
    })
write_quarterly_table(pd.DataFrame(mortality_rows), "1_raw_life_mortality_experience",
            "Actual vs expected mortality by age band — quarterly experience study")

# COMMAND ----------

# ── 8L.6 — 1_raw_life_reserves (quarterly) ──────────────────────────
# Best estimate liability (BEL) by life LoB. Simplified projection: per LoB,
# BEL = in-force × (avg_sum_assured × bel_factor) where bel_factor encodes
# the present value of future benefits net of premiums under standard assumptions.

BEL_FACTORS = {
    "with_profit": 0.85,    # mature book — high reserve relative to SA
    "unit_linked": 0.92,    # closely tracks unit value
    "term": 0.05,           # very low — only mortality reserve for the term
    "whole_of_life": 0.65,  # significant savings element
    "annuity": 12.0,        # PV of future income payments — multiple of annual
    "health_slt": 0.30,     # short-term renewable
}

reserve_rows = []
for lob in LIFE_LOBS:
    sub = in_force_df[in_force_df["lob_code"] == lob["code"]]
    if sub.empty:
        continue
    if lob["lob"] == "annuity":
        avg_sa = float(sub["annuity_income_eur"].mean())
    else:
        avg_sa = float(sub["sum_assured_eur"].mean())
    n_in_force = len(sub)
    bel_factor = BEL_FACTORS[lob["lob"]]

    # Pain D flow-through: unit-linked lapse spike in 2025-Q4 increases BEL ~+2.3%
    # (deteriorated lapse experience implies lower future profit margin = more BEL)
    bel_uplift = 1.0
    if reporting_period == "2025-Q4" and lob["lob"] == "unit_linked":
        bel_uplift = 1.023

    bel = round(n_in_force * avg_sa * bel_factor * bel_uplift, 2)
    risk_margin = round(bel * 0.06, 2)  # ~6% of BEL — simplified Solvency II RM proxy

    reserve_rows.append({
        "reporting_period": reporting_period,
        "lob_code": lob["code"],
        "lob_name": lob["lob"],
        "lob_eiopa_name": lob["name"],
        "in_force_count": n_in_force,
        "avg_sum_assured_or_income_eur": round(avg_sa, 2),
        "best_estimate_liability_eur": bel,
        "risk_margin_eur": risk_margin,
        "technical_provisions_eur": round(bel + risk_margin, 2),
        "assumption_version": period_to_version.get(reporting_period, "unknown"),
        "discount_curve_source": f"EIOPA risk-free {reporting_period}",
    })
write_quarterly_table(pd.DataFrame(reserve_rows), "1_raw_life_reserves",
            "Life best-estimate liabilities and risk margin by LoB (quarterly snapshot)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8L.7 Prophet Results (simulated life stochastic output)
# MAGIC
# MAGIC Mirrors the Igloo pattern but for the life book. Per (LoB × sub_module),
# MAGIC produces VaR / TVaR for the SF life UW SCR sub-modules:
# MAGIC mortality, longevity, lapse, expense, life_cat. Runs here (before section 9)
# MAGIC because the SCR risk_factors composite charges depend on Prophet output.

# COMMAND ----------

# Simplified life UW SCR sub-module sizing (relative to BEL).
# Real numbers would come from a stochastic projection; we use deterministic
# multipliers calibrated to be plausible for a mid-size composite book.
LIFE_SUBMODULE_FACTORS = {
    # (lob_name): {sub_module: factor_of_BEL}
    "with_profit":   {"mortality": 0.005, "longevity": 0.012, "lapse": 0.018, "expense": 0.005, "life_cat": 0.003},
    "unit_linked":   {"mortality": 0.003, "longevity": 0.002, "lapse": 0.030, "expense": 0.006, "life_cat": 0.002},
    "term":          {"mortality": 0.080, "longevity": 0.000, "lapse": 0.025, "expense": 0.010, "life_cat": 0.020},
    "whole_of_life": {"mortality": 0.010, "longevity": 0.008, "lapse": 0.012, "expense": 0.005, "life_cat": 0.005},
    "annuity":       {"mortality": 0.000, "longevity": 0.060, "lapse": 0.000, "expense": 0.005, "life_cat": 0.000},
    "health_slt":    {"mortality": 0.020, "longevity": 0.005, "lapse": 0.025, "expense": 0.015, "life_cat": 0.010},
}

# Read this period's life reserves to get BEL by LoB
life_bel = {r["lob_name"]: float(r["best_estimate_liability_eur"])
            for r in reserve_rows}

prophet_rows = []
for lob in LIFE_LOBS:
    bel = life_bel.get(lob["lob"], 0.0)
    if bel <= 0:
        continue
    for sub_module, factor in LIFE_SUBMODULE_FACTORS[lob["lob"]].items():
        var = bel * factor
        # TVaR is ~1.15-1.30x VaR for life; use deterministic 1.20
        tvar = var * 1.20
        # Pain D flow: unit-linked lapse stress is markedly higher in 2025-Q4
        if reporting_period == "2025-Q4" and lob["lob"] == "unit_linked" and sub_module == "lapse":
            var *= 1.40
            tvar *= 1.40
        prophet_rows.append({
            "reporting_period": reporting_period,
            "lob_code": lob["code"],
            "lob_name": lob["lob"],
            "sub_module": sub_module,
            "var_eur": to_eur(var),
            "tvar_eur": to_eur(tvar),
            "scenario_count": 5000,
            "model_version": "Prophet 7.4.2",
            "run_timestamp": datetime.now().isoformat(),
        })

write_quarterly_table(pd.DataFrame(prophet_rows), "4_eng_prophet_results",
            "Simulated Prophet life stochastic output — VaR/TVaR by life LoB and SCR sub-module")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 9. SCR Parameters & Risk Factors
# MAGIC
# MAGIC EIOPA Standard Formula parameters — correlation matrix and sub-module charges.
# MAGIC Written once (these are regulatory constants + calibrated inputs).

# COMMAND ----------

_scr_exists = spark.catalog.tableExists(f"{catalog}.{schema}.`7_ref_scr_parameters`")

if not _scr_exists or mode == "full_reset":
    # EIOPA correlation matrix for BSCR aggregation
    modules = ["market", "default", "life", "health", "non_life"]
    corr_matrix = [
        [1.00, 0.25, 0.25, 0.25, 0.25],
        [0.25, 1.00, 0.25, 0.25, 0.50],
        [0.25, 0.25, 1.00, 0.25, 0.00],
        [0.25, 0.25, 0.25, 1.00, 0.00],
        [0.25, 0.50, 0.00, 0.00, 1.00],
    ]

    scr_params = []
    for i, mod_i in enumerate(modules):
        for j, mod_j in enumerate(modules):
            scr_params.append({
                "parameter_type": "bscr_correlation",
                "module_i": mod_i,
                "module_j": mod_j,
                "value": corr_matrix[i][j],
                "description": f"BSCR correlation: {mod_i} vs {mod_j}",
            })

    # Market risk sub-module correlations
    market_subs = ["interest_rate", "equity", "property", "spread", "currency", "concentration"]
    mkt_corr = [
        [1.00, 0.00, 0.00, 0.00, 0.25, 0.00],
        [0.00, 1.00, 0.75, 0.75, 0.25, 0.00],
        [0.00, 0.75, 1.00, 0.50, 0.25, 0.00],
        [0.00, 0.75, 0.50, 1.00, 0.25, 0.00],
        [0.25, 0.25, 0.25, 0.25, 1.00, 0.00],
        [0.00, 0.00, 0.00, 0.00, 0.00, 1.00],
    ]
    for i, sub_i in enumerate(market_subs):
        for j, sub_j in enumerate(market_subs):
            scr_params.append({
                "parameter_type": "market_correlation",
                "module_i": sub_i,
                "module_j": sub_j,
                "value": mkt_corr[i][j],
                "description": f"Market risk correlation: {sub_i} vs {sub_j}",
            })

    # Op risk factor
    scr_params.append({
        "parameter_type": "op_risk_factor",
        "module_i": "operational",
        "module_j": "operational",
        "value": 0.03,
        "description": "Operational risk as % of earned 1_raw_premiums",
    })

    write_table(pd.DataFrame(scr_params), "7_ref_scr_parameters",
                "EIOPA Standard Formula parameters — correlation matrices and calibration factors")
else:
    print("  scr_parameters: already exists, skipping")

# COMMAND ----------

# Risk factors — SCR sub-module charges. These vary per quarter (market conditions).
risk_factors = []

# Market risk sub-modules
mkt_charges = {
    "interest_rate_up": to_eur(rng.uniform(180, 220) * 1e6 * growth),
    "interest_rate_down": to_eur(rng.uniform(150, 190) * 1e6 * growth),
    "equity_type1": to_eur(rng.uniform(200, 280) * 1e6 * growth),
    "equity_type2": to_eur(rng.uniform(30, 50) * 1e6 * growth),
    "property": to_eur(rng.uniform(60, 90) * 1e6 * growth),
    "spread_bonds": to_eur(rng.uniform(120, 160) * 1e6 * growth),
    "spread_structured": to_eur(rng.uniform(10, 25) * 1e6 * growth),
    "currency": to_eur(rng.uniform(80, 120) * 1e6 * growth),
    "concentration": to_eur(rng.uniform(20, 40) * 1e6 * growth),
}
for name, charge in mkt_charges.items():
    risk_factors.append({
        "risk_module": "market",
        "risk_sub_module": name,
        "charge_eur": charge,
        "reporting_period": reporting_period,
        "description": f"Market risk: {name.replace('_', ' ')}",
    })

# Default risk
risk_factors.append({
    "risk_module": "default",
    "risk_sub_module": "type1_financial",
    "charge_eur": to_eur(rng.uniform(60, 100) * 1e6 * growth),
    "reporting_period": reporting_period,
    "description": "Counterparty default: financial institutions",
})
risk_factors.append({
    "risk_module": "default",
    "risk_sub_module": "type2_receivables",
    "charge_eur": to_eur(rng.uniform(15, 30) * 1e6 * growth),
    "reporting_period": reporting_period,
    "description": "Counterparty default: receivables",
})

# Non-life underwriting risk
nl_charges = {
    "premium_reserve": to_eur(rng.uniform(250, 350) * 1e6 * growth),
    "lapse": to_eur(rng.uniform(20, 40) * 1e6 * growth),
    "catastrophe": to_eur(rng.uniform(100, 160) * 1e6 * growth),
}
for name, charge in nl_charges.items():
    risk_factors.append({
        "risk_module": "non_life",
        "risk_sub_module": name,
        "charge_eur": charge,
        "reporting_period": reporting_period,
        "description": f"Non-life UW risk: {name.replace('_', ' ')}",
    })

# Health underwriting (composite — full sub-module set)
# Use deterministic factors driven by health book BEL where it exists.
health_slt_bel = sum(
    r["best_estimate_liability_eur"] for r in reserve_rows if r["lob_name"] == "health_slt"
)
# Health UW charges roughly proportional to health BEL; minimum floor for non-zero books.
health_charges_eur = {
    "health_mortality": max(8e6, health_slt_bel * 0.020),
    "health_longevity": max(2e6, health_slt_bel * 0.005),
    "health_lapse":     max(6e6, health_slt_bel * 0.025),
    "health_expense":   max(4e6, health_slt_bel * 0.015),
}
for name, charge in health_charges_eur.items():
    risk_factors.append({
        "risk_module": "health",
        "risk_sub_module": name,
        "charge_eur": to_eur(charge * growth),
        "reporting_period": reporting_period,
        "description": f"Health UW: {name.replace('health_', '').replace('_', ' ')}",
    })

# Life underwriting (composite — driven by Prophet sub-module output)
# Sum Prophet VaR per sub-module across all life LoBs (excludes health_slt — that's in 'health' module).
life_submodule_totals = {"mortality": 0.0, "longevity": 0.0, "lapse": 0.0,
                         "expense": 0.0, "life_cat": 0.0}
for row in prophet_rows:
    if row["lob_name"] == "health_slt":
        continue
    sub = row["sub_module"]
    if sub in life_submodule_totals:
        life_submodule_totals[sub] += float(row["var_eur"])

for sub, total in life_submodule_totals.items():
    risk_factors.append({
        "risk_module": "life",
        "risk_sub_module": sub,
        "charge_eur": to_eur(total),  # already includes growth via Prophet inputs
        "reporting_period": reporting_period,
        "description": f"Life UW: {sub.replace('_', ' ')} (from Prophet)",
    })

write_quarterly_table(pd.DataFrame(risk_factors), "1_raw_risk_factors",
            "SCR sub-module charges by risk module — recalculated each quarter")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 10. Volume Measures (for S.26.06)

# COMMAND ----------

volume_rows = []
for lob_code, cfg in TRIANGLE_LOB.items():
    ultimate = cfg["ultimate_base"] * (1.03)**9
    combined_ratio = rng.uniform(0.92, 0.98)
    earned_premium_net = round(ultimate / combined_ratio, 2)
    written_next = round(earned_premium_net * 1.03 * (1 + rng.uniform(-0.02, 0.05)), 2)
    reserve_factors = {"long": 1.80, "medium": 1.10, "short": 0.55}
    be_claims = round(earned_premium_net * reserve_factors[cfg["tail"]] * (1 + rng.uniform(-0.10, 0.10)), 2)
    premium_prov_factors = {"long": 0.25, "medium": 0.18, "short": 0.10}
    be_premium = round(earned_premium_net * premium_prov_factors[cfg["tail"]] * (1 + rng.uniform(-0.05, 0.05)), 2)

    volume_rows.append({
        "lob_code": int(lob_code),
        "lob_name": cfg["name"],
        "earned_premium_net": earned_premium_net,
        "written_premium_net_next_year": written_next,
        "best_estimate_claims_provision": be_claims,
        "best_estimate_premium_provision": be_premium,
        "reporting_period": reporting_period,
    })

write_quarterly_table(pd.DataFrame(volume_rows), "1_raw_volume_measures",
            "Premium & reserve volume measures by LoB — feeds S.26.06")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 11. Exposures (Igloo input — by peril & LoB)
# MAGIC
# MAGIC Simulated exposure sets that would be sent to a stochastic engine like Igloo.

# COMMAND ----------

PERILS = ["windstorm", "flood", "earthquake", "hail", "subsidence", "freeze", "wildfire"]
exposure_rows = []

for lob in LOB_CONFIG:
    for peril in PERILS:
        # Not all LoBs are exposed to all perils
        if lob["code"] in [1, 2] and peril not in ["flood", "earthquake"]:
            continue  # health/income not exposed to most nat cat
        if lob["code"] == 12 and peril not in ["flood", "earthquake"]:
            continue

        n_risks = int(rng.uniform(20, 200))
        tsi = to_eur(rng.lognormal(18, 1.5))  # total sum insured
        agg_deductible = to_eur(tsi * rng.uniform(0.001, 0.01))
        agg_limit = to_eur(tsi * rng.uniform(0.5, 1.0))

        exposure_rows.append({
            "exposure_id": f"EXP-{lob['code']}-{peril[:4].upper()}-{reporting_period}",
            "lob_code": lob["code"],
            "lob_name": lob["name"],
            "peril": peril,
            "number_of_risks": n_risks,
            "total_sum_insured_eur": tsi,
            "aggregate_deductible_eur": agg_deductible,
            "aggregate_limit_eur": agg_limit,
            "currency": "EUR",
            "reporting_period": reporting_period,
        })

write_quarterly_table(pd.DataFrame(exposure_rows), "1_raw_exposures",
            "Exposure sets by peril & LoB — input for stochastic engine (Igloo)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 12. Igloo Results (simulated stochastic output)
# MAGIC
# MAGIC Simulates what a stochastic engine (Igloo / RAFM / ReMetrica) would return:
# MAGIC VaR & TVaR at various return periods, by peril and LoB, gross/net/ceded.

# COMMAND ----------

RETURN_PERIODS = [10, 25, 50, 100, 200, 500]
igloo_rows = []

for lob in LOB_CONFIG:
    lob_gwp = TOTAL_GWP_M * 1e6 * lob["gwp_share"]

    for peril in PERILS:
        # Skip non-exposed combinations
        if lob["code"] in [1, 2] and peril not in ["flood", "earthquake"]:
            continue
        if lob["code"] == 12 and peril not in ["flood", "earthquake"]:
            continue

        # Base AAL (average annual loss) as fraction of GWP
        aal_pct = rng.uniform(0.005, 0.04)
        aal_gross = lob_gwp * aal_pct

        for rp in RETURN_PERIODS:
            # VaR scales with log of the return period — calibrated so the 1-in-200
            # quantile is roughly 1.3 × AAL, which keeps non-life UW SCR in
            # sensible proportion to the total SCR for a €556M-SCR composite.
            # Earlier versions used `rp * scale` which produced values ~200×
            # too large at 1-in-200.
            scale = np.log(rp) / np.log(200)
            quantile_multiplier = scale * 1.3
            var_gross = to_eur(aal_gross * quantile_multiplier * rng.uniform(0.85, 1.15))
            tvar_gross = to_eur(var_gross * rng.uniform(1.10, 1.35))

            cession = LOB_CESSION[lob["code"]]
            var_ceded = to_eur(var_gross * cession * rng.uniform(0.7, 1.0))
            tvar_ceded = to_eur(tvar_gross * cession * rng.uniform(0.7, 1.0))

            igloo_rows.append({
                "lob_code": lob["code"],
                "lob_name": lob["name"],
                "peril": peril,
                "return_period": rp,
                "var_gross_eur": var_gross,
                "tvar_gross_eur": tvar_gross,
                "var_ceded_eur": var_ceded,
                "tvar_ceded_eur": tvar_ceded,
                "var_net_eur": to_eur(var_gross - var_ceded),
                "tvar_net_eur": to_eur(tvar_gross - tvar_ceded),
                "num_simulations": 10000,
                "model_version": "Igloo 5.2.1",
                "run_timestamp": datetime.now().isoformat(),
                "reporting_period": reporting_period,
            })

write_quarterly_table(pd.DataFrame(igloo_rows), "4_eng_stochastic_results",
            "Simulated stochastic engine output — VaR/TVaR by peril, LoB, return period")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 13. Own Funds & Balance Sheet

# COMMAND ----------

# Own funds components — calibrated so total OF ≈ EUR 1.17B against SCR ≈ EUR 556M,
# giving a Q-end solvency ratio of ~210% (matches the daily series shown on the
# Control Tower; broadly in line with the European mid-cap composite distribution).
# Earlier values (EUR 500M / 200M / 600-800M / etc.) produced ~333% which clashed
# with every other surface — see number-audit report for the reconciliation.
own_funds_rows = [
    {"component": "ordinary_share_capital", "tier": 1, "amount_eur": to_eur(300e6 * growth), "reporting_period": reporting_period},
    {"component": "share_premium", "tier": 1, "amount_eur": to_eur(125e6 * growth), "reporting_period": reporting_period},
    {"component": "reconciliation_reserve", "tier": 1, "amount_eur": to_eur(rng.uniform(400, 500) * 1e6 * growth), "reporting_period": reporting_period},
    {"component": "subordinated_liabilities_t1", "tier": 1, "amount_eur": to_eur(100e6 * growth), "reporting_period": reporting_period},
    {"component": "subordinated_liabilities_t2", "tier": 2, "amount_eur": to_eur(rng.uniform(140, 180) * 1e6 * growth), "reporting_period": reporting_period},
    {"component": "ancillary_own_funds", "tier": 3, "amount_eur": to_eur(rng.uniform(20, 40) * 1e6 * growth), "reporting_period": reporting_period},
]

write_quarterly_table(pd.DataFrame(own_funds_rows), "1_raw_own_funds",
            "Own funds components by tier — feeds solvency ratio")

# Balance sheet items
total_assets_val = to_eur(TOTAL_ASSETS_M * 1e6 * (1 + rng.uniform(-0.02, 0.02)) * growth)
tp_val = to_eur(total_assets_val * rng.uniform(0.55, 0.65))
other_liabilities = to_eur(total_assets_val * rng.uniform(0.05, 0.10))
excess = to_eur(total_assets_val - tp_val - other_liabilities)

bs_rows = [
    {"item": "total_assets", "category": "1_raw_assets", "amount_eur": total_assets_val, "reporting_period": reporting_period},
    {"item": "investments", "category": "1_raw_assets", "amount_eur": to_eur(total_assets_val * 0.92), "reporting_period": reporting_period},
    {"item": "reinsurance_recoverables", "category": "1_raw_assets", "amount_eur": to_eur(total_assets_val * 0.05), "reporting_period": reporting_period},
    {"item": "cash_and_equivalents", "category": "1_raw_assets", "amount_eur": to_eur(total_assets_val * 0.03), "reporting_period": reporting_period},
    {"item": "technical_provisions_gross", "category": "liabilities", "amount_eur": tp_val, "reporting_period": reporting_period},
    {"item": "reinsurance_payables", "category": "liabilities", "amount_eur": to_eur(total_assets_val * 0.03), "reporting_period": reporting_period},
    {"item": "other_liabilities", "category": "liabilities", "amount_eur": other_liabilities, "reporting_period": reporting_period},
    {"item": "excess_of_assets_over_liabilities", "category": "equity", "amount_eur": excess, "reporting_period": reporting_period},
]

write_quarterly_table(pd.DataFrame(bs_rows), "1_raw_balance_sheet",
            "Solvency II balance sheet — 1_raw_assets, liabilities, excess")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 14. Pipeline SLA Status (for Control Tower)
# MAGIC
# MAGIC Tracks when each data feed arrived relative to SLA deadlines.
# MAGIC Simulates realistic arrival patterns — most on time, some late.

# COMMAND ----------

sla_deadline_day = 15  # 15th of month after quarter-end
sla_month = (rp_quarter * 3) % 12 + 1
sla_year = rp_year if sla_month > 1 else rp_year + 1
sla_deadline = datetime(sla_year, sla_month, sla_deadline_day, 18, 0, 0)
quarter_close = datetime(rp_year, rp_quarter * 3, 30, 18, 0, 0) if rp_quarter in (2, 3) else (
    datetime(rp_year, rp_quarter * 3, 31, 18, 0, 0)
)

# Source mapping (display labels). The SLA business-day target itself comes
# from 0_cfg_feed_sla so the Control Tower reads a single source of truth.
FEED_SOURCES = {
    "1_raw_assets":                   "Investment Platform (Simcorp)",
    "1_raw_premiums":                 "Policy Admin System (Guidewire)",
    "1_raw_claims":                   "Claims Management System",
    "1_raw_expenses":                 "Finance / ERP (SAP)",
    "1_raw_risk_factors":             "Risk Engine (Igloo/RAFM)",
    "1_raw_reinsurance":              "RI Admin (Solvara)",
    "1_raw_exposures":                "Underwriting Platform",
    "1_raw_life_policies":            "Life Admin (Prophet Front-Office)",
    "1_raw_life_claims":              "Life Admin (Prophet Front-Office)",
    "1_raw_life_lapses":              "Life Admin (Prophet Front-Office)",
    "1_raw_life_mortality_experience":"Life Actuarial Workbench",
    "1_raw_life_assumptions":         "Life Actuarial Workbench",
}

# Pain A — late RI feed: in Q1-Q3 it arrives ~t+2/3, in Q4 it arrives at t+11
# (8 days late vs 3-business-day SLA). All other feeds stay clean.
def _arrival_days_after_close(feed_name: str) -> int:
    if feed_name == "1_raw_reinsurance":
        return 11 if reporting_period == "2025-Q4" else int(rng.choice([2, 2, 3, 3]))
    if feed_name == "1_raw_expenses":
        return 6 if reporting_period == "2025-Q4" else int(rng.choice([3, 4, 4, 5]))
    return int(rng.choice([1, 2, 2, 3, 3]))

# Per-feed SLA in business days (must match 0_cfg_feed_sla.sla_business_days)
SLA_BUSINESS_DAYS = {row["feed_name"]: int(row["sla_business_days"]) for row in feed_sla_rows}

sla_rows = []
for feed_name, source in FEED_SOURCES.items():
    days_after_close = _arrival_days_after_close(feed_name)
    arrival = quarter_close + timedelta(days=days_after_close, hours=int(rng.uniform(0, 8)))
    feed_received_timestamp = arrival.isoformat()
    # On-time = arrived within the per-feed SLA business days of quarter close.
    # We approximate business days as calendar days for simplicity (5/7 weekend
    # adjustment is small and the demo intent is clarity, not calendar mechanics).
    sla_bd = SLA_BUSINESS_DAYS.get(feed_name, 5)
    feed_deadline = quarter_close + timedelta(days=sla_bd)
    on_time = arrival <= feed_deadline
    status = "on_time" if on_time else "late"

    try:
        feed_count = spark.table(f"{catalog}.{schema}.`{feed_name}`").filter(
            f"reporting_period = '{reporting_period}'"
        ).count()
    except Exception:
        feed_count = int(rng.uniform(1000, 50000))

    dq_pass = round(rng.uniform(0.985, 1.0), 4)
    if feed_name == "1_raw_expenses" and rp_quarter == 4:
        dq_pass = round(rng.uniform(0.965, 0.985), 4)
    if feed_name == "1_raw_claims" and reporting_period == "2025-Q4":
        # Pain B taints Q4 claims — visible drop in pass rate
        dq_pass = round(rng.uniform(0.955, 0.978), 4)

    # Notes intentionally blank — the freshness tab + Ownership tab carry the
    # detail; the row-level note was redundant with the status badge.
    notes = ""

    sla_rows.append({
        "reporting_period": reporting_period,
        "feed_name": feed_name,
        "source_system": source,
        "sla_deadline": sla_deadline,
        "actual_arrival": arrival,
        "feed_received_timestamp": feed_received_timestamp,
        "row_count": feed_count,
        "status": status,
        "dq_pass_rate": dq_pass,
        "notes": notes,
    })

write_quarterly_table(pd.DataFrame(sla_rows), "5_mon_pipeline_sla_status",
            "Pipeline SLA tracking — feed arrival times vs deadlines for Control Tower")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 15. DQ Expectation Results (for DQ Dashboard)
# MAGIC
# MAGIC Synthetic DLT expectation results mirroring what the pipeline produces.

# COMMAND ----------

DQ_EXPECTATIONS = [
    # S.06.02 pipeline
    {"pipeline": "S.06.02 List of Assets", "table": "2_stg_assets_enriched",
     "expectation": "asset_id_not_null", "action": "DROP ROW", "base_total": 5000},
    {"pipeline": "S.06.02 List of Assets", "table": "2_stg_assets_enriched",
     "expectation": "sii_value_positive", "action": "FAIL UPDATE", "base_total": 5000},
    {"pipeline": "S.06.02 List of Assets", "table": "2_stg_assets_enriched",
     "expectation": "cic_code_valid", "action": "DROP ROW", "base_total": 5000},
    {"pipeline": "S.06.02 List of Assets", "table": "2_stg_assets_enriched",
     "expectation": "currency_not_null", "action": "DROP ROW", "base_total": 5000},
    {"pipeline": "S.06.02 List of Assets", "table": "3_qrt_s0602_list_of_assets",
     "expectation": "c0040_asset_id_present", "action": "DROP ROW", "base_total": 5000},
    {"pipeline": "S.06.02 List of Assets", "table": "3_qrt_s0602_list_of_assets",
     "expectation": "c0170_sii_positive", "action": "FAIL UPDATE", "base_total": 5000},
    # S.05.01 pipeline
    {"pipeline": "S.05.01 Premiums Claims Expenses", "table": "2_stg_premiums_by_lob",
     "expectation": "gross_written_positive", "action": "DROP ROW", "base_total": 7},
    {"pipeline": "S.05.01 Premiums Claims Expenses", "table": "2_stg_premiums_by_lob",
     "expectation": "net_equals_gross_minus_ri", "action": "WARN", "base_total": 7},
    {"pipeline": "S.05.01 Premiums Claims Expenses", "table": "2_stg_claims_by_lob",
     "expectation": "gross_incurred_positive", "action": "DROP ROW", "base_total": 7},
    {"pipeline": "S.05.01 Premiums Claims Expenses", "table": "3_qrt_s0501_summary",
     "expectation": "combined_ratio_realistic", "action": "DROP ROW", "base_total": 7},
    # S.25.01 pipeline
    {"pipeline": "S.25.01 SCR Template", "table": "3_qrt_s2501_scr_breakdown",
     "expectation": "row_id_present", "action": "DROP ROW", "base_total": 17},
    {"pipeline": "S.25.01 SCR Template", "table": "3_qrt_s2501_scr_breakdown",
     "expectation": "amount_not_null", "action": "DROP ROW", "base_total": 17},
    {"pipeline": "S.25.01 SCR Template", "table": "3_qrt_s2501_summary",
     "expectation": "solvency_ratio_positive", "action": "FAIL UPDATE", "base_total": 1},
    {"pipeline": "S.25.01 SCR Template", "table": "3_qrt_s2501_summary",
     "expectation": "scr_positive", "action": "FAIL UPDATE", "base_total": 1},
    # S.26.06 pipeline
    {"pipeline": "S.26.06 NL UW Risk Template", "table": "2_stg_cat_risk_by_lob",
     "expectation": "var_net_positive", "action": "DROP ROW", "base_total": 35},
    {"pipeline": "S.26.06 NL UW Risk Template", "table": "2_stg_cat_risk_by_lob",
     "expectation": "return_period_valid", "action": "DROP ROW", "base_total": 35},
    {"pipeline": "S.26.06 NL UW Risk Template", "table": "2_stg_premium_reserve_risk",
     "expectation": "volume_measure_positive", "action": "FAIL UPDATE", "base_total": 7},
    {"pipeline": "S.26.06 NL UW Risk Template", "table": "3_qrt_s2606_nl_uw_risk",
     "expectation": "amount_not_null", "action": "DROP ROW", "base_total": 7},
    {"pipeline": "S.26.06 NL UW Risk Template", "table": "3_qrt_s2606_summary",
     "expectation": "cat_risk_positive", "action": "FAIL UPDATE", "base_total": 1},
    {"pipeline": "S.26.06 NL UW Risk Template", "table": "3_qrt_s2606_summary",
     "expectation": "diversified_scr_positive", "action": "FAIL UPDATE", "base_total": 1},
]

dq_rows = []
for exp in DQ_EXPECTATIONS:
    total = exp["base_total"]
    # Most expectations pass perfectly; a few have small failure counts
    if rng.random() < 0.3:  # 30% of checks have some failures
        failing = int(rng.uniform(1, max(2, total * 0.005)))
    else:
        failing = 0
    # Quality improves over time
    if rp_quarter > 1 and failing > 0:
        failing = max(0, failing - rp_quarter + 1)

    passing = total - failing
    dq_rows.append({
        "reporting_period": reporting_period,
        "pipeline_name": exp["pipeline"],
        "table_name": exp["table"],
        "expectation_name": exp["expectation"],
        "total_records": total,
        "passing_records": passing,
        "failing_records": failing,
        "pass_rate": round(passing / total, 4) if total > 0 else 1.0,
        "action": exp["action"],
        "evaluated_at": sla_deadline - timedelta(hours=int(rng.uniform(1, 48))),
    })

write_quarterly_table(pd.DataFrame(dq_rows), "5_mon_dq_expectation_results",
            "DQ expectation results — pass/fail rates from DLT pipeline expectations")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 16. Cross-QRT Reconciliation (for Reconciliation Tab)

# COMMAND ----------

recon_rows = []

# Check 1: Total SII 1_raw_assets (S.06.02) vs balance sheet
try:
    s0602_total = float(spark.sql(f"""
        SELECT SUM(CAST(C0170_Total_Solvency_II_Amount AS DOUBLE))
        FROM {catalog}.{schema}.`3_qrt_s0602_list_of_assets`
        WHERE reporting_period = '{reporting_period}'
    """).first()[0] or 0)
except Exception:
    s0602_total = TOTAL_ASSETS_M * 1e6

try:
    bs_total = float(spark.sql(f"""
        SELECT CAST(amount_eur AS DOUBLE)
        FROM {catalog}.{schema}.`1_raw_balance_sheet`
        WHERE item = 'total_assets' AND reporting_period = '{reporting_period}'
    """).first()[0] or 0)
except Exception:
    bs_total = s0602_total * rng.uniform(0.98, 1.02)

diff = abs(s0602_total - bs_total)
recon_rows.append({
    "reporting_period": reporting_period,
    "check_name": "total_assets_s0602_vs_balance_sheet",
    "check_description": "Total SII 1_raw_assets from S.06.02 should match balance sheet total assets",
    "source_qrt": "S.06.02",
    "target_qrt": "Balance Sheet",
    "source_value": round(s0602_total, 2),
    "target_value": round(bs_total, 2),
    "difference": round(diff, 2),
    "tolerance": round(bs_total * 0.02, 2),
    "status": "MATCH" if diff < bs_total * 0.02 else "MISMATCH",
})

# Check 1b — strict "no surprise increment" check.
# S.06.02 vs the asset side derived from own funds + liabilities. We use a
# €1M tolerance so a duplicate-bond style gap is unambiguously flagged.
recon_rows.append({
    "reporting_period": reporting_period,
    "check_name": "s0602_vs_own_funds_plus_liabilities",
    "check_description": (
        "Sum of S.06.02 SII amounts must reconcile to own funds + technical provisions "
        "+ other liabilities within €1M. Larger gaps usually indicate duplicate or missing "
        "investment positions in the custodian feed."
    ),
    "source_qrt": "S.06.02",
    "target_qrt": "S.25.01 (own funds derived)",
    "source_value": round(s0602_total, 2),
    "target_value": round(bs_total, 2),
    "difference": round(diff, 2),
    "tolerance": 1_000_000.00,
    "status": "MATCH" if diff < 1_000_000 else "MISMATCH",
})

# Check 2: GWP in S.05.01 vs sum of premium transactions
try:
    s0501_gwp = float(spark.sql(f"""
        SELECT SUM(CAST(amount_eur AS DOUBLE))
        FROM {catalog}.{schema}.`3_qrt_s0501_premiums_claims_expenses`
        WHERE template_row_id = 'R0110' AND lob_code = 0 AND reporting_period = '{reporting_period}'
    """).first()[0] or 0)
except Exception:
    s0501_gwp = quarterly_gwp

try:
    prem_gwp = float(spark.sql(f"""
        SELECT SUM(gross_written_premium)
        FROM {catalog}.{schema}.`1_raw_premiums`
        WHERE reporting_period = '{reporting_period}'
    """).first()[0] or 0)
except Exception:
    prem_gwp = s0501_gwp * rng.uniform(0.99, 1.01)

diff2 = abs(s0501_gwp - prem_gwp)
recon_rows.append({
    "reporting_period": reporting_period,
    "check_name": "gwp_s0501_vs_premiums",
    "check_description": "Gross written premium in S.05.01 Total should match sum of premium transactions",
    "source_qrt": "S.05.01",
    "target_qrt": "Premiums (Bronze)",
    "source_value": round(s0501_gwp, 2),
    "target_value": round(prem_gwp, 2),
    "difference": round(diff2, 2),
    "tolerance": round(prem_gwp * 0.01, 2),
    "status": "MATCH" if diff2 < prem_gwp * 0.01 else "MISMATCH",
})

# Check 3: SCR < Eligible Own Funds (solvency OK)
try:
    solv = spark.sql(f"""
        SELECT scr_eur, eligible_own_funds_eur
        FROM {catalog}.{schema}.`3_qrt_s2501_summary`
        WHERE reporting_period = '{reporting_period}'
    """).first()
    scr_val = float(solv[0] or 0)
    eof_val = float(solv[1] or 0)
except Exception:
    scr_val = TARGET_SCR_M * 1e6
    eof_val = TARGET_OWN_FUNDS_M * 1e6

recon_rows.append({
    "reporting_period": reporting_period,
    "check_name": "scr_vs_own_funds",
    "check_description": "Eligible own funds must exceed SCR for solvency compliance",
    "source_qrt": "S.25.01",
    "target_qrt": "Own Funds",
    "source_value": round(scr_val, 2),
    "target_value": round(eof_val, 2),
    "difference": round(eof_val - scr_val, 2),
    "tolerance": 0,
    "status": "MATCH" if eof_val > scr_val else "MISMATCH",
})

# Check 4: Number of 1_raw_assets in S.06.02 vs raw 1_raw_assets table
try:
    qrt_count = int(spark.sql(f"""
        SELECT COUNT(*) FROM {catalog}.{schema}.`3_qrt_s0602_list_of_assets`
        WHERE reporting_period = '{reporting_period}'
    """).first()[0] or 0)
except Exception:
    qrt_count = N_ASSETS

recon_rows.append({
    "reporting_period": reporting_period,
    "check_name": "asset_count_s0602_vs_raw",
    "check_description": "Asset count in S.06.02 should match raw 1_raw_assets (minus DQ drops)",
    "source_qrt": "S.06.02",
    "target_qrt": "Assets (Bronze)",
    "source_value": float(qrt_count),
    "target_value": float(N_ASSETS),
    "difference": float(abs(qrt_count - N_ASSETS)),
    "tolerance": 10.0,
    "status": "MATCH" if abs(qrt_count - N_ASSETS) <= 10 else "WITHIN_TOLERANCE",
})

# Check 5: Pain G — reserve-capital divergence
# Reserving committee updated property dev factor mid-Q4 (storm overlay), but the
# capital model is running off the Q3 reserving parameter. SCR understated by ~€8M.
# This row is engineered to MATCH for Q1-Q3 and MISMATCH for Q4 to surface the issue.
is_q4_with_storm_overlay = reporting_period.endswith("-Q4")
divergence_eur = 8_200_000.0 if is_q4_with_storm_overlay else 0.0
recon_rows.append({
    "reporting_period": reporting_period,
    "check_name": "reserve_capital_divergence",
    "check_description": (
        "Reserving model property dev factor must equal capital model property dev factor. "
        "Mid-quarter overlay updates to reserving must be propagated to the capital model "
        "before close. Difference reflects SCR understatement attributable to stale parameter."
    ),
    "source_qrt": "S.05.01",
    "target_qrt": "S.25.01",
    "source_value": round(divergence_eur, 2),
    "target_value": 0.0,
    "difference": round(divergence_eur, 2),
    "tolerance": 1_000_000.0,
    "status": "MISMATCH" if is_q4_with_storm_overlay else "MATCH",
})

write_quarterly_table(pd.DataFrame(recon_rows), "5_mon_cross_qrt_reconciliation",
            "Cross-QRT reconciliation checks — consistency validation between QRTs")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 17. Model Registry Log (for Model Governance Tab)

# COMMAND ----------

model_rows = []

# Champion (v1, 2025 calibration) — used for all quarters
try:
    champ_scr = float(spark.sql(f"""
        SELECT amount_eur FROM {catalog}.{schema}.`2_stg_scr_results`
        WHERE component = 'SCR' AND reporting_period = '{reporting_period}'
    """).first()[0] or 0)
except Exception:
    champ_scr = TARGET_SCR_M * 1e6 * growth

model_rows.append({
    "reporting_period": reporting_period,
    "model_name": "standard_formula",
    "model_version": 1,
    "alias": "Champion",
    "calibration_year": 2025,
    "scr_result_eur": round(champ_scr, 2),
    "run_timestamp": sla_deadline - timedelta(days=3),
    "registered_by": "laurence.ryszka@databricks.com",
    "description": "EIOPA 2025 Standard Formula — production calibration",
})

# Challenger (v2, 2026 calibration) — shows what-if
challenger_scr = champ_scr * rng.uniform(1.02, 1.06)  # slightly higher due to tighter correlations
model_rows.append({
    "reporting_period": reporting_period,
    "model_name": "standard_formula",
    "model_version": 2,
    "alias": "Challenger",
    "calibration_year": 2026,
    "scr_result_eur": round(challenger_scr, 2),
    "run_timestamp": sla_deadline - timedelta(days=2),
    "registered_by": "laurence.ryszka@databricks.com",
    "description": "EIOPA 2026 Updated Calibration — tighter market/NL correlation, higher op risk",
})

write_quarterly_table(pd.DataFrame(model_rows), "5_mon_model_registry_log",
            "Model version usage log — Champion vs Challenger SCR results per quarter")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary

# COMMAND ----------

print("=" * 70)
print(f"  DATA GENERATION COMPLETE — {reporting_period}")
print("=" * 70)
print(f"  Catalog: {catalog}")
print(f"  Schema:  {schema}")
print(f"  Mode:    {mode}")
print()

tables = [
    "1_raw_counterparties", "1_raw_assets", "1_raw_policies", "1_raw_premiums", "1_raw_claims", "1_raw_expenses",
    "1_raw_reinsurance", "1_raw_claims_triangles", "1_raw_risk_factors", "7_ref_scr_parameters",
    "1_raw_volume_measures", "1_raw_exposures", "4_eng_stochastic_results", "1_raw_own_funds", "1_raw_balance_sheet",
    "5_mon_pipeline_sla_status", "5_mon_dq_expectation_results", "5_mon_cross_qrt_reconciliation",
    "5_mon_model_registry_log",
]

for t in tables:
    try:
        cnt = spark.table(f"{catalog}.{schema}.{t}").count()
        print(f"  {t:30s} {cnt:>10,} rows")
    except Exception:
        print(f"  {t:30s} NOT FOUND")

print()
print("=" * 70)

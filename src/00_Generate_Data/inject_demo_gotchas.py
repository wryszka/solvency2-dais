# Databricks notebook source
# MAGIC %md
# MAGIC # Inject Demo "Gotchas" — Realistic Issues for AI Agents to Find
# MAGIC
# MAGIC This notebook injects 4 subtle but realistic issues into the Q3 2025 data.
# MAGIC These are the kind of issues that take an experienced actuary hours to spot —
# MAGIC but the AI agents will flag them in seconds.
# MAGIC
# MAGIC **Issues injected:**
# MAGIC
# MAGIC | # | Issue | Where | What the AI should say |
# MAGIC |---|-------|-------|----------------------|
# MAGIC | 1 | Large fire claim hiding in Property | S.05.01 claims | "Property combined ratio driven by single EUR 12.3M claim" |
# MAGIC | 2 | Reinsurance cession rate quietly dropped | S.05.01 premiums | "Net exposure increased — cession dropped from 30% to 18%" |
# MAGIC | 3 | Asset duration vs market risk mismatch | S.06.02 + S.25.01 | "Implied sensitivity 65% higher than duration suggests" |
# MAGIC | 4 | Stochastic tail too thin for windstorm | S.26.06 igloo results | "TVaR/VaR ratio of 1.15 — expected 1.5-2.0 for windstorm" |
# MAGIC | 5 | Custodian migration breaks 4 asset CIC codes | S.06.02 assets | "4 assets with null CICs — all from Euroclear. Likely custodian migration." |
# MAGIC
# MAGIC **Run this ONCE after the initial data generation, before the demo.**

# COMMAND ----------

# MAGIC %md
# MAGIC ## Parameters

# COMMAND ----------

dbutils.widgets.text("catalog_name", "main")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("target_period", "2025-Q3")

catalog = dbutils.widgets.get("catalog_name")
schema = dbutils.widgets.get("schema_name")
period = dbutils.widgets.get("target_period")

fqn = lambda t: f"`{catalog}`.`{schema}`.`{t}`"

print(f"Injecting gotchas into {catalog}.{schema} for {period}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gotcha 1: Large Fire Claim Hiding in Property (LoB 7)
# MAGIC
# MAGIC A single EUR 12.3M fire claim in a LoB that normally runs at 85% combined ratio.
# MAGIC The aggregate combined ratio will look like ~97% — not obviously alarming.
# MAGIC But strip out this one claim and it's 82%. The AI should spot this.

# COMMAND ----------

spark.sql(f"""
    INSERT INTO {fqn('1_raw_claims')} VALUES (
        'CLM-{period}-7-FIRE01',   -- claim_id (distinctive for demo)
        'POL007777',                -- policy_id
        7,                          -- lob_code (Fire & property)
        'Fire and other damage to property insurance',
        '{period}',
        '2025-09-15',               -- loss_date (mid-quarter)
        '2025-09-16',               -- notification_date (next day — large losses notified fast)
        'fire',                     -- cause
        8200000.00,                 -- gross_paid (partial — still adjusting)
        12300000.00,                -- gross_incurred (full estimate)
        4100000.00,                 -- gross_reserved
        2460000.00,                 -- RI share paid (only 20% — see gotcha 2)
        2460000.00,                 -- RI share incurred
        5740000.00,                 -- net_paid
        9840000.00,                 -- net_incurred (EUR 9.84M net — painful)
        'open',
        'EUR'
    )
""")

print("  Gotcha 1: Injected EUR 12.3M fire claim in Property (LoB 7)")
print("  -> Gross incurred: EUR 12.3M | Net incurred: EUR 9.84M (only 20% ceded)")
print("  -> This will push Property combined ratio from ~85% to ~97%")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gotcha 2: Reinsurance Cession Rate Quietly Dropped
# MAGIC
# MAGIC Property (LoB 7) cession rate dropped from 30% to 18% at the January renewal.
# MAGIC The 1_raw_reinsurance table still shows the old 30% rate (treaty not updated),
# MAGIC but the actual premium and claims data reflects the new 18% rate.
# MAGIC
# MAGIC The AI should notice: "Gross premium up 3% but net premium up 18% for Property —
# MAGIC the reinsurance cession appears to have changed."

# COMMAND ----------

# Reduce the RI share on all Property Q3 1_raw_premiums to reflect the new 18% cession
# (previously generated with 30% cession)
spark.sql(f"""
    UPDATE {fqn('1_raw_premiums')}
    SET reinsurers_share_written = ROUND(gross_written_premium * 0.18, 2),
        reinsurers_share_earned  = ROUND(gross_earned_premium * 0.18, 2),
        net_written_premium      = ROUND(gross_written_premium * 0.82, 2),
        net_earned_premium       = ROUND(gross_earned_premium * 0.82, 2)
    WHERE lob_code = 7 AND reporting_period = '{period}'
""")

# Also reduce RI share on Property claims (except the large fire which we already set to 20%)
spark.sql(f"""
    UPDATE {fqn('1_raw_claims')}
    SET reinsurers_share_paid     = ROUND(gross_paid * 0.18, 2),
        reinsurers_share_incurred = ROUND(gross_incurred * 0.18, 2),
        net_paid                  = ROUND(gross_paid * 0.82, 2),
        net_incurred              = ROUND(gross_incurred * 0.82, 2)
    WHERE lob_code = 7
      AND reporting_period = '{period}'
      AND claim_id != 'CLM-{period}-7-FIRE01'
""")

print("  Gotcha 2: Reduced Property RI cession from 30% to 18% in premium & claims data")
print("  -> Reinsurance treaty table still shows old 30% rate (not updated)")
print("  -> Net risk exposure jumped ~17% without anyone explicitly flagging it")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gotcha 3: Asset Duration vs Market Risk Mismatch
# MAGIC
# MAGIC Reduce the average duration of government bonds to 3.2 years (from ~6-7).
# MAGIC But leave the market risk SCR charge unchanged.
# MAGIC
# MAGIC The AI should notice: "With average duration 3.2 years on EUR 3.9B govies,
# MAGIC the expected DV01 is ~EUR 125M per 100bps. But the interest rate risk
# MAGIC component implies EUR 200M — a 60% discrepancy."

# COMMAND ----------

# Lower the duration on government bonds
spark.sql(f"""
    UPDATE {fqn('1_raw_assets')}
    SET modified_duration = ROUND(modified_duration * 0.45, 2)
    WHERE asset_class = 'government_bonds'
      AND reporting_period = '{period}'
""")

# Verify the new average
avg_dur = spark.sql(f"""
    SELECT ROUND(AVG(modified_duration), 1) AS avg_dur,
           COUNT(*) AS n_bonds
    FROM {fqn('1_raw_assets')}
    WHERE asset_class = 'government_bonds'
      AND reporting_period = '{period}'
""").first()

print(f"  Gotcha 3: Reduced gov bond avg duration to {avg_dur['avg_dur']} years ({avg_dur['n_bonds']} bonds)")
print("  -> Market risk SCR charge left unchanged — creates an implied sensitivity gap")
print("  -> AI should question: 'Duration implies DV01 of X, but market risk charge implies Y'")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gotcha 4: Stochastic Tail Too Thin for Windstorm
# MAGIC
# MAGIC Compress the TVaR relative to VaR for windstorm peril.
# MAGIC Normal European windstorm: TVaR/VaR ratio at 1-in-200 should be 1.5–2.0×.
# MAGIC We'll set it to 1.12× — suspiciously thin. Either the simulation count
# MAGIC is too low (convergence issue) or the tail is being truncated.

# COMMAND ----------

# Make windstorm TVaR almost equal to VaR (thin tail)
spark.sql(f"""
    UPDATE {fqn('4_eng_stochastic_results')}
    SET tvar_gross_eur = ROUND(var_gross_eur * 1.12, 2),
        tvar_net_eur   = ROUND(var_net_eur * 1.12, 2),
        tvar_ceded_eur = ROUND(var_ceded_eur * 1.12, 2)
    WHERE peril = 'windstorm'
      AND reporting_period = '{period}'
      AND return_period >= 200
""")

# Verify
ratios = spark.sql(f"""
    SELECT peril, return_period,
           ROUND(tvar_net_eur / NULLIF(var_net_eur, 0), 2) AS tvar_var_ratio
    FROM {fqn('4_eng_stochastic_results')}
    WHERE reporting_period = '{period}'
      AND return_period = 200
    ORDER BY tvar_var_ratio
""").toPandas()

print("  Gotcha 4: Compressed windstorm TVaR/VaR ratio at 1-in-200")
print("  -> TVaR/VaR ratios by peril at 1-in-200:")
for _, r in ratios.iterrows():
    flag = " << THIN TAIL" if r['tvar_var_ratio'] < 1.20 else ""
    print(f"     {r['peril']:15s} {r['tvar_var_ratio']:.2f}x{flag}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gotcha 5: Custodian Migration Breaks 4 Asset Records
# MAGIC
# MAGIC Simcorp migrated a batch of asset custodians last week. The custodian feed
# MAGIC arrived but 4 assets now have null CIC codes — the migration didn't carry
# MAGIC through the asset classification properly.
# MAGIC
# MAGIC The DLT expectation `cic_code_valid` will quarantine these 4 rows.
# MAGIC The Data Quality dashboard will show 4 failing records.
# MAGIC The DQ Triage agent should hypothesise the custodian migration as the cause.

# COMMAND ----------

# Null out CIC codes on 4 specific assets all from the same custodian
spark.sql(f"""
    UPDATE {fqn('1_raw_assets')}
    SET cic_code = NULL,
        custodian_name = 'Euroclear Bank SA/NV (migrated)'
    WHERE asset_id IN (
        SELECT asset_id FROM {fqn('1_raw_assets')}
        WHERE reporting_period = '{period}'
          AND custodian_name = 'Euroclear Bank SA/NV'
        ORDER BY asset_id
        LIMIT 4
    )
    AND reporting_period = '{period}'
""")

# Verify
affected = spark.sql(f"""
    SELECT asset_id, asset_name, custodian_name, cic_code
    FROM {fqn('1_raw_assets')}
    WHERE reporting_period = '{period}'
      AND cic_code IS NULL
""").toPandas()

print(f"  Gotcha 5: Nulled CIC code on {len(affected)} assets from migrated custodian")
for _, r in affected.iterrows():
    print(f"     {r['asset_id']}: {str(r['asset_name'])[:50]} | custodian: {r['custodian_name']}")
print("  -> DLT expectation cic_code_valid will quarantine these rows")
print("  -> DQ Triage agent should identify the custodian migration pattern")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary
# MAGIC
# MAGIC Five gotchas injected. Now re-run the QRT pipelines to propagate changes:
# MAGIC
# MAGIC 1. S.06.02 pipeline — will quarantine 4 assets with null CICs
# MAGIC 2. S.05.01 pipeline — will pick up the large claim + changed cession rates
# MAGIC 3. S.25.01 pipeline — SCR unchanged, but now inconsistent with duration
# MAGIC 4. S.26.06 pipeline — will pick up the thin windstorm tail
# MAGIC
# MAGIC Then demo the AI agents — they should flag all 5 issues.
# MAGIC
# MAGIC **Expected AI findings:**
# MAGIC
# MAGIC | Agent | Expected Finding |
# MAGIC |-------|-----------------|
# MAGIC | **Actuarial Review (S.05.01)** | "Property combined ratio driven by single EUR 12.3M fire claim. Excluding this, attritional CR is 82%." |
# MAGIC | **Actuarial Review (S.05.01)** | "Net premium for Property up 18% while gross up only 3% — reinsurance cession rate appears to have changed from 30% to 18%." |
# MAGIC | **Cross-QRT Consistency** | "Gov bond duration of 3.2 years implies DV01 of EUR ~125M, but market risk charge of EUR 200M implies significantly higher sensitivity." |
# MAGIC | **Stochastic Engine** | "Windstorm TVaR/VaR ratio of 1.12x at 1-in-200 is abnormally thin. Expected 1.5-2.0x for European windstorm. Possible convergence issue or tail truncation." |
# MAGIC | **DQ Triage** | "4 assets with null CIC codes — all from the same custodian (Euroclear). Likely custodian migration last week — re-request feed with proper CIC mapping." |

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gotcha 6: Talk-Track Scenario — S.05.01 Held Pending New Claims Feed
# MAGIC
# MAGIC Sets up a coherent end-to-end story the supervisor agent can tell when asked
# MAGIC "what's the status of our QRTs, are we at risk of missing the deadline?"
# MAGIC
# MAGIC State after this gotcha:
# MAGIC - The claims feed for S.05.01 has been flagged late + DQ failure
# MAGIC - Other feeds are on time and clean
# MAGIC - Submission deadline = Friday this week
# MAGIC - New claims feed expected by Monday morning

# COMMAND ----------

# Mark the claims feed as "delayed — DQ rejected, awaiting resubmission"
spark.sql(f"""
    UPDATE {fqn('5_mon_pipeline_sla_status')}
    SET status = 'late',
        dq_pass_rate = 0.892,
        notes = 'DQ rejected — subrogation reversal anomaly detected, feed sent back to Claims Mgmt; new version expected Monday'
    WHERE feed_name LIKE '%claim%'
      AND reporting_period = '{period}'
""")

# Add a synthetic DQ failure that ties to the narrative — high failure rate on subrogation column
# (use existing 5_mon_dq_expectation_results — add a new failing check)
spark.sql(f"""
    INSERT INTO {fqn('5_mon_dq_expectation_results')}
    (reporting_period, pipeline_name, table_name, expectation_name,
     total_records, passing_records, failing_records, pass_rate, action, evaluated_at)
    VALUES (
        '{period}',
        'S.05.01 Premiums Claims Expenses',
        '2_stg_claims_by_lob',
        'subrogation_within_threshold',
        14815, 13190, 1625,
        0.8903,
        'FAIL UPDATE',
        TIMESTAMP'2025-10-13 14:32:00'
    )
""")

print("  Gotcha 6: Talk-track scenario set")
print("  -> Claims feed flagged 'late' with DQ rejection note")
print("  -> Subrogation expectation now shows 1,625 / 14,815 failing records (89.0% pass)")
print("  -> Supervisor agent should narrate: 'S.05.01 held — claims feed rejected, awaiting Monday resubmission'")
print("  -> Other 3 QRTs remain clean — not at risk of missing Friday deadline")

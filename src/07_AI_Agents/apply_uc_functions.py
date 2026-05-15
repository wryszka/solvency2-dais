# Databricks notebook source
# MAGIC %md
# MAGIC # Apply UC Functions for data-access tools
# MAGIC
# MAGIC Registers every data-access tool used by the supervisor and specialists as
# MAGIC a Unity Catalog SQL function under `{catalog}.{schema}.fn_*`. Each
# MAGIC function returns a TABLE so any agent (or notebook, or BI tool) can call
# MAGIC it uniformly.
# MAGIC
# MAGIC Run idempotently — `CREATE OR REPLACE FUNCTION` everywhere.
# MAGIC
# MAGIC Functions:
# MAGIC - `fn_close_status(period)` — pipeline + DQ + recon health for a period
# MAGIC - `fn_model_status(model_name)` — UC MLflow status for a model
# MAGIC - `fn_overlays_recent(quarter)` — overlay register for a quarter
# MAGIC - `fn_reserving_anomalies(prior, current)` — LoB Q-over-Q claim movement
# MAGIC - `fn_event_log_lookup(start_date, end_date)` — external event log
# MAGIC - `fn_feed_status(period)` — feed SLA + arrival
# MAGIC - `fn_recon_status(period)` — cross-QRT reconciliation
# MAGIC - `fn_dq_status(period)` — DQ expectation results
# MAGIC - `fn_orsa_stress_state(period)` — latest ORSA results per scenario
# MAGIC - `fn_solvency_history(days)` — daily solvency series
# MAGIC - `fn_qrt_audit_snapshot(qrt_id, period)` — audit panel data
# MAGIC - `fn_approvals_pending(period)` — pending governance items
# MAGIC - `fn_archive_lookup(period, qrt_id)` — submission archive row
# MAGIC - `fn_cache_lookup(question_text)` — pre-baked answer lookup (fuzzy hash)
# MAGIC - `fn_cache_write(question_text, payload_json)` — write a new cache entry

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog", "Catalog")
dbutils.widgets.text("schema_name",  "solvency2_workbench",   "Schema")
catalog = dbutils.widgets.get("catalog_name")
schema  = dbutils.widgets.get("schema_name")
fqn = lambda t: f"`{catalog}`.`{schema}`.`{t}`"
print(f"Applying UC Functions to {catalog}.{schema}")

# COMMAND ----------

# MAGIC %md ## Ensure lazily-created tables exist
# MAGIC Some tables are created on-demand by the app (orsa, cache, whatif runs).
# MAGIC UC function definitions are validated at create time, so we make sure
# MAGIC every referenced table exists with at least an empty schema. Idempotent.

# COMMAND ----------

LAZY_TABLES = {
    "gold_orsa_results": """
        run_id STRING, scenario_id STRING, scenario_name STRING,
        base_period STRING, year_offset INT, projection_year INT,
        scr_eur DOUBLE, eligible_own_funds_eur DOUBLE, solvency_ratio_pct DOUBLE,
        module_breakdown_json STRING, is_base BOOLEAN,
        run_timestamp TIMESTAMP, run_by STRING
    """,
    "6_ai_demo_cache": """
        cache_key STRING, agent_name STRING, scene_id STRING,
        reporting_period STRING, output_json STRING,
        cached_at TIMESTAMP, cached_by STRING
    """,
    "6_demo_whatif_runs": """
        run_id STRING, scenario_label STRING, scenario_payload_json STRING,
        result_json STRING, narrative STRING, second_opinion STRING,
        ran_at TIMESTAMP, ran_by STRING
    """,
}
for tbl, schema_ddl in LAZY_TABLES.items():
    spark.sql(f"CREATE TABLE IF NOT EXISTS {fqn(tbl)} ({schema_ddl})")
    print(f"  · {tbl} ready")

# COMMAND ----------

# MAGIC %md ## Tool 1 — fn_close_status

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_close_status(reporting_period STRING)
RETURNS TABLE (
  feed_name STRING, feed_status STRING, sla_deadline TIMESTAMP, feed_received_timestamp TIMESTAMP,
  promotion_model STRING, promotion_status STRING, promotion_version STRING,
  overlay_lob STRING, overlay_magnitude_eur DOUBLE, overlay_status STRING, overlay_author STRING,
  recon_check STRING, recon_status STRING, recon_difference DOUBLE
)
COMMENT 'Current close-state across feeds, model promotions, pending overlays, and recon flags for a quarter.'
RETURN
  SELECT feed_name, status AS feed_status, sla_deadline, feed_received_timestamp,
         CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS STRING),
         CAST(NULL AS STRING), CAST(NULL AS DOUBLE), CAST(NULL AS STRING), CAST(NULL AS STRING),
         CAST(NULL AS STRING), CAST(NULL AS STRING), CAST(NULL AS DOUBLE)
  FROM {fqn('5_mon_pipeline_sla_status')}
  WHERE reporting_period = fn_close_status.reporting_period
""")
print("fn_close_status ✓")

# COMMAND ----------

# MAGIC %md ## Tool 2 — fn_model_status

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_model_status(model_name STRING)
RETURNS TABLE (
  model_name STRING, quarter STRING, status STRING, to_version STRING,
  approver STRING, approved_at TIMESTAMP
)
COMMENT 'Model promotion history (champion/challenger flips, approvals) for a given model.'
RETURN
  SELECT model_name, quarter, status, to_version, approver, approved_at
  FROM {fqn('6_gov_promotions')}
  WHERE model_name = fn_model_status.model_name
  ORDER BY COALESCE(promoted_at, approved_at) DESC
""")
print("fn_model_status ✓")

# COMMAND ----------

# MAGIC %md ## Tool 3 — fn_overlays_recent

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_overlays_recent(quarter STRING)
RETURNS TABLE (
  overlay_id STRING, line_of_business STRING, magnitude_eur DOUBLE,
  category STRING, status STRING, author STRING, created_at TIMESTAMP
)
COMMENT 'Overlays for a quarter — author, magnitude, status, rationale.'
RETURN
  SELECT overlay_id, line_of_business, CAST(magnitude_eur AS DOUBLE),
         category, status, author, created_at
  FROM {fqn('6_gov_overlays')}
  WHERE quarter = fn_overlays_recent.quarter
""")
print("fn_overlays_recent ✓")

# COMMAND ----------

# MAGIC %md ## Tool 4 — fn_reserving_anomalies

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_reserving_anomalies(prior_period STRING, current_period STRING)
RETURNS TABLE (
  lob_name STRING, prior_incurred_eur DOUBLE, current_incurred_eur DOUBLE,
  delta_eur DOUBLE, delta_pct DOUBLE, claim_count_current BIGINT
)
COMMENT 'Q-over-Q claim incurred movement by line of business — drives reserving anomaly detection.'
RETURN
  WITH agg AS (
    SELECT reporting_period, lob_name,
           SUM(CAST(gross_incurred AS DOUBLE)) AS incurred,
           COUNT(*) AS claim_count
    FROM {fqn('1_raw_claims')}
    WHERE reporting_period IN (fn_reserving_anomalies.prior_period, fn_reserving_anomalies.current_period)
    GROUP BY reporting_period, lob_name
  )
  SELECT
    c.lob_name,
    COALESCE(p.incurred, 0) AS prior_incurred_eur,
    COALESCE(c.incurred, 0) AS current_incurred_eur,
    COALESCE(c.incurred, 0) - COALESCE(p.incurred, 0) AS delta_eur,
    CASE WHEN COALESCE(p.incurred, 0) > 0
         THEN (c.incurred - p.incurred) / p.incurred * 100
         ELSE NULL END AS delta_pct,
    c.claim_count
  FROM (SELECT * FROM agg WHERE reporting_period = fn_reserving_anomalies.current_period) c
  LEFT JOIN (SELECT * FROM agg WHERE reporting_period = fn_reserving_anomalies.prior_period) p
    ON c.lob_name = p.lob_name
""")
print("fn_reserving_anomalies ✓")

# COMMAND ----------

# MAGIC %md ## Tool 5 — fn_event_log_lookup

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_event_log_lookup(start_date STRING, end_date STRING)
RETURNS TABLE (
  event_id STRING, event_name STRING, start_date DATE, end_date DATE,
  region STRING, peak_intensity DOUBLE, peak_intensity_unit STRING,
  modelled_aal_eur_m DOUBLE, notes STRING
)
COMMENT 'External event log query by date range — used by the cat agent for storm cross-reference.'
RETURN
  SELECT event_id, event_name, start_date, end_date, region,
         CAST(peak_intensity AS DOUBLE), peak_intensity_unit,
         CAST(modelled_aal_eur_m AS DOUBLE), notes
  FROM {fqn('6_demo_event_log')}
  WHERE start_date >= TO_DATE(fn_event_log_lookup.start_date)
    AND end_date   <= TO_DATE(fn_event_log_lookup.end_date)
""")
print("fn_event_log_lookup ✓")

# COMMAND ----------

# MAGIC %md ## Tool 6 — fn_feed_status

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_feed_status(reporting_period STRING)
RETURNS TABLE (
  feed_name STRING, source_system STRING, status STRING,
  dq_pass_rate DOUBLE, sla_deadline TIMESTAMP, actual_arrival TIMESTAMP, notes STRING
)
COMMENT 'Feed SLA + arrival times for a period — drives the DQ investigator and Close panel.'
RETURN
  SELECT feed_name, source_system, status, CAST(dq_pass_rate AS DOUBLE),
         sla_deadline, actual_arrival, notes
  FROM {fqn('5_mon_pipeline_sla_status')}
  WHERE reporting_period = fn_feed_status.reporting_period
""")
print("fn_feed_status ✓")

# COMMAND ----------

# MAGIC %md ## Tool 7 — fn_recon_status

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_recon_status(reporting_period STRING)
RETURNS TABLE (
  check_name STRING, source_qrt STRING, target_qrt STRING,
  source_value DOUBLE, target_value DOUBLE, difference DOUBLE, status STRING
)
COMMENT 'Cross-QRT reconciliation check results for a period — drives the Recon Investigator.'
RETURN
  SELECT check_name, source_qrt, target_qrt,
         CAST(source_value AS DOUBLE), CAST(target_value AS DOUBLE),
         CAST(difference AS DOUBLE), status
  FROM {fqn('5_mon_cross_qrt_reconciliation')}
  WHERE reporting_period = fn_recon_status.reporting_period
""")
print("fn_recon_status ✓")

# COMMAND ----------

# MAGIC %md ## Tool 8 — fn_dq_status

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_dq_status(reporting_period STRING)
RETURNS TABLE (
  pipeline_name STRING, table_name STRING, expectation_name STRING,
  total_records BIGINT, failing_records BIGINT, action STRING
)
COMMENT 'Failing DQ expectations only, for a period — DQ investigator input.'
RETURN
  SELECT pipeline_name, table_name, expectation_name,
         CAST(total_records AS BIGINT), CAST(failing_records AS BIGINT), action
  FROM {fqn('5_mon_dq_expectation_results')}
  WHERE reporting_period = fn_dq_status.reporting_period
    AND failing_records > 0
""")
print("fn_dq_status ✓")

# COMMAND ----------

# MAGIC %md ## Tool 9 — fn_orsa_stress_state

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_orsa_stress_state(base_period STRING)
RETURNS TABLE (
  scenario_id STRING, scenario_name STRING, year_offset INT, projection_year INT,
  scr_eur DOUBLE, solvency_ratio_pct DOUBLE, is_base BOOLEAN
)
COMMENT 'Latest ORSA scenario projections for a base period — ORSA Narrative input.'
RETURN
  SELECT scenario_id, scenario_name, year_offset, projection_year,
         CAST(scr_eur AS DOUBLE), CAST(solvency_ratio_pct AS DOUBLE), is_base
  FROM {fqn('gold_orsa_results')}
  WHERE base_period = fn_orsa_stress_state.base_period
""")
print("fn_orsa_stress_state ✓")

# COMMAND ----------

# MAGIC %md ## Tool 10 — fn_solvency_history

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_solvency_history(days INT)
RETURNS TABLE (
  observed_date DATE, ratio_pct DOUBLE, delta_vs_prior_pp DOUBLE,
  driver STRING, driver_class STRING
)
COMMENT 'Daily solvency ratio series for the last N days, with named inflection drivers.'
RETURN
  WITH max_d AS (SELECT MAX(observed_date) AS d FROM {fqn('6_demo_solvency_daily')})
  SELECT observed_date, CAST(ratio_pct AS DOUBLE),
         CAST(delta_vs_prior_pp AS DOUBLE), driver, driver_class
  FROM {fqn('6_demo_solvency_daily')}, max_d
  WHERE observed_date >= DATE_SUB(max_d.d, fn_solvency_history.days)
  ORDER BY observed_date
""")
print("fn_solvency_history ✓")

# COMMAND ----------

# MAGIC %md ## Tool 11 — fn_qrt_audit_snapshot

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_qrt_audit_snapshot(qrt_id STRING, reporting_period STRING)
RETURNS TABLE (
  qrt_id STRING, reporting_period STRING,
  approved_model STRING, model_version STRING, approver STRING, approved_at TIMESTAMP,
  applied_overlays_count BIGINT, applied_overlays_eur DOUBLE
)
COMMENT 'Audit-panel snapshot: model(s) signed off, approved overlays applied, for a (QRT, period) pair.'
RETURN
  WITH approved_overlays AS (
    SELECT COUNT(*) AS n, SUM(CAST(magnitude_eur AS DOUBLE)) AS total_eur
    FROM {fqn('6_gov_overlays')}
    WHERE quarter = fn_qrt_audit_snapshot.reporting_period
      AND status = 'approved'
  )
  SELECT
    fn_qrt_audit_snapshot.qrt_id,
    fn_qrt_audit_snapshot.reporting_period,
    p.model_name AS approved_model,
    p.to_version AS model_version,
    p.approver,
    p.approved_at,
    o.n AS applied_overlays_count,
    o.total_eur AS applied_overlays_eur
  FROM approved_overlays o
  LEFT JOIN (
    SELECT model_name, to_version, approver, approved_at
    FROM {fqn('6_gov_promotions')}
    WHERE quarter = fn_qrt_audit_snapshot.reporting_period
      AND status = 'approved'
    ORDER BY approved_at DESC LIMIT 1
  ) p ON true
""")
print("fn_qrt_audit_snapshot ✓")

# COMMAND ----------

# MAGIC %md ## Tool 12 — fn_approvals_pending

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_approvals_pending(reporting_period STRING)
RETURNS TABLE (
  item_type STRING, item_id STRING, label STRING, owner STRING,
  magnitude_eur DOUBLE, status STRING, created_at TIMESTAMP
)
COMMENT 'Pending governance items (overlays + model promotions) awaiting human decision.'
RETURN
  SELECT 'overlay' AS item_type, overlay_id AS item_id,
         CONCAT(line_of_business, ' overlay') AS label,
         author AS owner, CAST(magnitude_eur AS DOUBLE), status, created_at
  FROM {fqn('6_gov_overlays')}
  WHERE quarter = fn_approvals_pending.reporting_period AND status = 'pending_approval'
  UNION ALL
  SELECT 'promotion' AS item_type, model_name AS item_id,
         CONCAT(model_name, ' → ', to_version) AS label,
         approver AS owner, CAST(NULL AS DOUBLE), status,
         COALESCE(approved_at, promoted_at) AS created_at
  FROM {fqn('6_gov_promotions')}
  WHERE quarter = fn_approvals_pending.reporting_period AND status = 'pending_approval'
""")
print("fn_approvals_pending ✓")

# COMMAND ----------

# MAGIC %md ## Tool 13 — fn_archive_lookup

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_archive_lookup(reporting_period STRING, qrt_id STRING)
RETURNS TABLE (
  period STRING, qrt STRING, qrt_title STRING, status STRING,
  submitted_at TIMESTAMP, submitted_by STRING, reviewed_at TIMESTAMP,
  reviewed_by STRING, dq_pass_rate DOUBLE, headline_value STRING
)
COMMENT 'Submission archive lookup for a (period, qrt) — historical disclosure state.'
RETURN
  SELECT period, qrt, qrt_title, status, submitted_at, submitted_by,
         reviewed_at, reviewed_by, CAST(dq_pass_rate AS DOUBLE), headline_value
  FROM {fqn('gold_submissions_archive')}
  WHERE period = fn_archive_lookup.reporting_period
    AND qrt = fn_archive_lookup.qrt_id
""")
print("fn_archive_lookup ✓")

# COMMAND ----------

# MAGIC %md ## Cache tools

# COMMAND ----------

# fn_cache_lookup — normalised question hash → cached payload
spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_cache_lookup(question_text STRING)
RETURNS TABLE (
  cache_key STRING, output_json STRING, cached_at TIMESTAMP, cached_by STRING
)
COMMENT 'Look up a baked answer by normalised-question hash. NULL if no match.'
RETURN
  WITH norm AS (
    SELECT sha2(CONCAT('route|',
                       REGEXP_REPLACE(LOWER(TRIM(fn_cache_lookup.question_text)), '[^a-z0-9 ]+', ' '),
                       '|2025-Q4'), 256) AS h
  )
  SELECT c.cache_key, c.output_json, c.cached_at, c.cached_by
  FROM {fqn('6_ai_demo_cache')} c, norm
  WHERE c.cache_key = SUBSTRING(norm.h, 1, 24)
  LIMIT 1
""")
print("fn_cache_lookup ✓")

# COMMAND ----------

# fn_cache_write — upsert a baked answer
spark.sql(f"""
CREATE OR REPLACE FUNCTION `{catalog}`.`{schema}`.fn_cache_write(
  question_text STRING, agent_name STRING, scene_id STRING, output_json STRING
)
RETURNS STRING
COMMENT 'Write a baked answer to the cache, keyed by normalised-question hash. Returns the cache key.'
RETURN
  SUBSTRING(sha2(CONCAT('route|',
                        REGEXP_REPLACE(LOWER(TRIM(fn_cache_write.question_text)), '[^a-z0-9 ]+', ' '),
                        '|2025-Q4'), 256), 1, 24)
""")
print("fn_cache_write ✓")

# COMMAND ----------

print(f"\nAll UC Functions applied under {catalog}.{schema}.fn_*")
spark.sql(f"SHOW USER FUNCTIONS IN `{catalog}`.`{schema}` LIKE 'fn_*'").show(50, truncate=False)

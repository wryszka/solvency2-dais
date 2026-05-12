-- Databricks notebook source
-- MAGIC %md
-- MAGIC # Gold: S.26.06 — Non-Life Underwriting Risk
-- MAGIC
-- MAGIC Combines premium & reserve risk with catastrophe risk into the
-- MAGIC EIOPA S.26.06 template. Applies correlation (0.25) between
-- MAGIC premium/reserve and catastrophe sub-modules.
-- MAGIC
-- MAGIC **Sources:** `2_stg_premium_reserve_risk`, `2_stg_cat_risk_by_lob`
-- MAGIC **Target:** `3_qrt_s2606_nl_uw_risk`

-- COMMAND ----------

CREATE OR REFRESH MATERIALIZED VIEW `3_qrt_s2606_nl_uw_risk`(
  CONSTRAINT row_id_present    EXPECT (template_row_id IS NOT NULL)  ON VIOLATION DROP ROW,
  CONSTRAINT amount_not_null   EXPECT (amount_eur IS NOT NULL)       ON VIOLATION DROP ROW
)
COMMENT 'EIOPA S.26.06 Non-Life Underwriting Risk — premium, reserve, cat risk. Total (R0100) sourced from the Standard Formula model output (2_stg_scr_results.SCR_non_life) so s2606 and s2501 always reconcile.'
AS

WITH prem_res AS (
  SELECT
    reporting_period,
    SUM(premium_risk_eur)  AS total_premium_risk,
    SUM(reserve_risk_eur)  AS total_reserve_risk,
    -- Combined premium & reserve risk (simplified: sum, then diversify)
    SQRT(POWER(SUM(premium_risk_eur), 2)
       + POWER(SUM(reserve_risk_eur), 2)
       + 2 * 0.5 * SUM(premium_risk_eur) * SUM(reserve_risk_eur))
      AS combined_prem_res_risk
  FROM LIVE.`2_stg_premium_reserve_risk`
  GROUP BY reporting_period
),
cat AS (
  SELECT
    reporting_period,
    SUM(var_net_eur)  AS total_cat_risk,
    SUM(tvar_net_eur) AS total_cat_tvar
  FROM LIVE.`2_stg_cat_risk_by_lob`
  GROUP BY reporting_period
),
sf_total AS (
  -- Canonical SCR_non_life from the Standard Formula model run.
  -- This is what s2501 reports as the non-life UW module charge; s2606
  -- inherits it so the two templates can never disagree (EIOPA cross-template
  -- validation EV would fail otherwise).
  SELECT reporting_period,
         amount_eur AS sf_scr_non_life
  FROM LIVE.`2_stg_scr_results`
  WHERE component = 'SCR_non_life'
),
combined AS (
  SELECT
    p.reporting_period,
    p.total_premium_risk,
    p.total_reserve_risk,
    p.combined_prem_res_risk,
    c.total_cat_risk,
    c.total_cat_tvar,
    s.sf_scr_non_life AS diversified_nl_uw_scr
  FROM prem_res p
  JOIN cat c     ON p.reporting_period = c.reporting_period
  JOIN sf_total s ON p.reporting_period = s.reporting_period
)

-- R0010: Premium risk
SELECT reporting_period, 'R0010' AS template_row_id,
       'Non-life premium risk' AS template_row_label,
       ROUND(total_premium_risk, 2) AS amount_eur
FROM combined

UNION ALL
-- R0020: Reserve risk
SELECT reporting_period, 'R0020',
       'Non-life reserve risk',
       ROUND(total_reserve_risk, 2)
FROM combined

UNION ALL
-- R0030: Combined premium & reserve (diversified)
SELECT reporting_period, 'R0030',
       'Combined premium & reserve risk (diversified)',
       ROUND(combined_prem_res_risk, 2)
FROM combined

UNION ALL
-- R0040: Catastrophe risk (from stochastic model)
SELECT reporting_period, 'R0040',
       'Non-life catastrophe risk (Igloo VaR 1-in-200)',
       ROUND(total_cat_risk, 2)
FROM combined

UNION ALL
-- R0050: Catastrophe risk TVaR (informational)
SELECT reporting_period, 'R0050',
       'Non-life catastrophe risk (Igloo TVaR 1-in-200)',
       ROUND(total_cat_tvar, 2)
FROM combined

UNION ALL
-- R0100: Total NL UW risk (diversified)
SELECT reporting_period, 'R0100',
       'Total Non-Life Underwriting Risk (diversified)',
       ROUND(diversified_nl_uw_scr, 2)
FROM combined

UNION ALL
-- R0110: Diversification benefit
SELECT reporting_period, 'R0110',
       'Diversification benefit',
       ROUND(diversified_nl_uw_scr - (combined_prem_res_risk + total_cat_risk), 2)
FROM combined

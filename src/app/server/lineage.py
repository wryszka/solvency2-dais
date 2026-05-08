"""Curated lineage map for the Audit Panel.

For demo reliability we ship a hand-curated dependency graph rather than relying
on the live UC lineage API. The graph encodes how each QRT cell traces back from
gold tables → silver → bronze → models → raw feeds, plus the model versions and
overlays that contributed.

Schema:
  QRT_LINEAGE[qrt_id] = {
    "qrt_table": str,
    "summary_table": str,
    "produced_by": [model_ids],          # which Lab models flow into this QRT
    "source_tables": [
        {"name": str, "layer": "bronze|silver|gold|engine|reference",
         "columns_used": [str], "described": str}
    ],
    "code_notebooks": [
        {"path": str, "described": str}
    ],
  }
"""
from __future__ import annotations

QRT_LINEAGE: dict[str, dict] = {
    "s0602": {
        "qrt_table":     "3_qrt_s0602_list_of_assets",
        "summary_table": "3_qrt_s0602_summary",
        "produced_by":   [],
        "source_tables": [
            {"name": "1_raw_assets",          "layer": "bronze",   "columns_used": ["asset_id", "isin", "sii_value"], "described": "Asset master from custodian feed."},
            {"name": "1_raw_counterparties",  "layer": "bronze",   "columns_used": ["lei", "rating"],                   "described": "Counterparty reference data."},
            {"name": "2_stg_assets_enriched", "layer": "silver",   "columns_used": ["*"],                               "described": "Assets joined to counterparty + currency."},
        ],
        "code_notebooks": [
            {"path": "src/02_QRT_S0602/gold_s0602.sql",                "described": "Gold mapping → S.06.02 EIOPA template."},
            {"path": "src/02_QRT_S0602/gold_s0602_summary.sql",        "described": "Aggregate by CIC class."},
        ],
    },
    "s0501": {
        "qrt_table":     "3_qrt_s0501_premiums_claims_expenses",
        "summary_table": "3_qrt_s0501_summary",
        "produced_by":   ["reserving_pnc"],
        "source_tables": [
            {"name": "1_raw_premiums",        "layer": "bronze",   "columns_used": ["lob_code", "gwp"],                   "described": "Premium transactions."},
            {"name": "1_raw_claims",          "layer": "bronze",   "columns_used": ["lob_code", "gross_paid", "gross_incurred"], "described": "Claim transactions."},
            {"name": "1_raw_claims_triangles","layer": "bronze",   "columns_used": ["lob_name", "accident_year", "cumulative_paid"], "described": "Aggregated claims triangles for reserving."},
            {"name": "1_raw_expenses",        "layer": "bronze",   "columns_used": ["lob_code", "expense_eur"],           "described": "Expense allocations."},
            {"name": "2_stg_premiums_by_lob", "layer": "silver",   "columns_used": ["*"],                                 "described": "Premium roll-up by LoB."},
            {"name": "2_stg_claims_by_lob",   "layer": "silver",   "columns_used": ["*"],                                 "described": "Claims roll-up by LoB."},
        ],
        "code_notebooks": [
            {"path": "src/02_Reserving_Model/register_reserving_models.py", "described": "Reserving pyfunc registration (chain ladder + BF)."},
            {"path": "src/01_QRT_S0501/gold_s0501.sql",                     "described": "Gold S.05.01 template builder."},
            {"path": "src/01_QRT_S0501/gold_s0501_summary.sql",             "described": "Per-LoB aggregation."},
        ],
    },
    "s2501": {
        "qrt_table":     "3_qrt_s2501_scr_breakdown",
        "summary_table": "3_qrt_s2501_summary",
        "produced_by":   ["standard_formula", "igloo_cat", "prophet_life"],
        "source_tables": [
            {"name": "1_raw_risk_factors",    "layer": "bronze",   "columns_used": ["risk_module", "risk_sub_module", "charge_eur"], "described": "Sub-module charges feeding the SF aggregation."},
            {"name": "1_raw_own_funds",       "layer": "bronze",   "columns_used": ["tier_eur"],                          "described": "Own funds for solvency-ratio computation."},
            {"name": "2_stg_scr_results",     "layer": "silver",   "columns_used": ["component", "amount_eur"],           "described": "Standard formula model output."},
            {"name": "4_eng_stochastic_results", "layer": "engine", "columns_used": ["var_99_5", "tvar_99_5"],           "described": "Igloo cat output (NL UW component)."},
            {"name": "4_eng_prophet_results", "layer": "engine",   "columns_used": ["scenario", "be_cashflow"],           "described": "Prophet life output (Life UW component)."},
        ],
        "code_notebooks": [
            {"path": "src/03_QRT_S2501_SCR/register_standard_formula_model.py", "described": "SF model pyfunc registration."},
            {"path": "src/03_QRT_S2501_SCR/run_standard_formula.py",            "described": "Loads production alias and runs SF on the period's risk factors."},
            {"path": "src/03_QRT_S2501_SCR/gold_s2501_scr_breakdown.sql",       "described": "Maps to EIOPA S.25.01 template."},
            {"path": "src/03_QRT_S2501_SCR/gold_s2501_summary.sql",             "described": "Solvency ratio + own-funds tiering."},
        ],
    },
    "s2606": {
        "qrt_table":     "3_qrt_s2606_nl_uw_risk",
        "summary_table": "3_qrt_s2606_summary",
        "produced_by":   ["reserving_pnc", "igloo_cat"],
        "source_tables": [
            {"name": "1_raw_volume_measures","layer": "bronze",   "columns_used": ["lob", "premium_volume", "reserve_volume"], "described": "Volume measures for premium/reserve risk."},
            {"name": "1_raw_exposures",      "layer": "bronze",   "columns_used": ["peril", "lob", "tiv"],                  "described": "Exposure data feeding Igloo cat."},
            {"name": "2_stg_premium_reserve_risk", "layer": "silver", "columns_used": ["*"],                              "described": "Premium + reserve risk staging."},
            {"name": "2_stg_cat_risk_by_lob","layer": "silver",   "columns_used": ["*"],                                  "described": "Cat risk roll-up from Igloo output."},
            {"name": "4_eng_stochastic_results", "layer": "engine","columns_used": ["aal", "var_99_5"],                   "described": "Igloo cat run output."},
        ],
        "code_notebooks": [
            {"path": "src/04_QRT_S2606_NL_Risk/run_igloo_model.py",       "described": "Runs the (mock) WTW Igloo cat engine via UC volume exchange."},
            {"path": "src/04_QRT_S2606_NL_Risk/gold_s2606_nl_uw_risk.sql","described": "EIOPA S.26.06 template builder."},
            {"path": "src/04_QRT_S2606_NL_Risk/gold_s2606_summary.sql",   "described": "Sub-module aggregation."},
        ],
    },
    "s1201": {
        "qrt_table":     "3_qrt_s1201_life_technical_provisions",
        "summary_table": "3_qrt_s1201_summary",
        "produced_by":   ["reserving_life", "prophet_life"],
        "source_tables": [
            {"name": "1_raw_life_policies",  "layer": "bronze",   "columns_used": ["product_line", "in_force_count"],     "described": "Life policy master."},
            {"name": "1_raw_life_reserves",  "layer": "bronze",   "columns_used": ["product_line", "best_estimate"],      "described": "Life reserves."},
            {"name": "1_raw_life_assumptions","layer": "bronze",  "columns_used": ["mortality_rate", "lapse_rate"],       "described": "Best-estimate assumptions."},
            {"name": "2_stg_life_tp_components", "layer": "silver","columns_used": ["*"],                                 "described": "TP component buildout."},
            {"name": "4_eng_prophet_results", "layer": "engine",  "columns_used": ["scenario", "be_cashflow"],            "described": "Prophet 5K-scenario output."},
        ],
        "code_notebooks": [
            {"path": "src/04b_QRT_Life_UW_Risk/run_prophet_model.py",        "described": "Runs the (mock) FIS Prophet life engine."},
            {"path": "src/02_Reserving_Model/register_reserving_models.py", "described": "Life best-estimate pyfunc registration."},
            {"path": "src/05_QRT_S1201/gold_s1201_life_tps.sql",            "described": "Life TPs gold table builder."},
        ],
    },
}


def get_lineage(qrt_id: str) -> dict | None:
    return QRT_LINEAGE.get(qrt_id.lower())

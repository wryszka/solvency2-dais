#!/usr/bin/env python3
"""Composite Solvency II dashboard for the dev deployment.

Five pages:
  1. Composite Overview     — solvency ratio, SCR, OF, BEL split
  2. P&C (S.06.02 + S.05.01 + S.26.06)
  3. Life (S.12.01 + Life UW + lapse trend)
  4. SCR breakdown (S.25.01 modules + Champion vs Challenger placeholder)
  5. Pipeline & DQ          — cross-pillar control tower

Usage:
  python3 scripts/create_dashboard_v2.py [DASHBOARD_ID]

If DASHBOARD_ID is provided, the existing dashboard is updated; otherwise
a new dashboard is created and the ID printed for app.yaml.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid

CATALOG = os.environ.get("CATALOG", "lr_dev_aws_us_catalog")
SCHEMA = os.environ.get("SCHEMA", "solvency2_workbench")
WAREHOUSE_ID = os.environ.get("WAREHOUSE_ID", "a3b61648ea4809e3")
PROFILE = os.environ.get("DATABRICKS_PROFILE", "DEV")
PARENT_PATH = os.environ.get("PARENT_PATH", "/Users/laurence.ryszka@databricks.com")
FQN = f"{CATALOG}.{SCHEMA}"

DASHBOARD_ID = sys.argv[1] if len(sys.argv) > 1 else None


def uid() -> str:
    return uuid.uuid4().hex[:8]


# ── Datasets ──────────────────────────────────────────────────────────

datasets: list[dict] = []


def ds(name: str, display: str, sql: str) -> str:
    """Register a dataset (single-line SQL only — Lakeview chokes on newlines)."""
    oneline = " ".join(s.strip() for s in sql.strip().splitlines())
    datasets.append({"name": name, "displayName": display, "queryLines": [oneline]})
    return name


# Solvency / SCR
ds_kpi_latest = ds("ds_kpi_latest", "Latest KPIs", f"""
    SELECT reporting_period, solvency_ratio_pct,
           ROUND(scr_eur / 1e6, 1) AS scr_m,
           ROUND(eligible_own_funds_eur / 1e6, 1) AS eof_m,
           ROUND(surplus_eur / 1e6, 1) AS surplus_m
    FROM {FQN}.3_qrt_s2501_summary
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.3_qrt_s2501_summary)""")

ds_solvency_trend = ds("ds_solvency_trend", "Solvency trend", f"""
    SELECT reporting_period, solvency_ratio_pct,
           ROUND(scr_eur / 1e6, 1) AS scr_m,
           ROUND(eligible_own_funds_eur / 1e6, 1) AS eof_m
    FROM {FQN}.3_qrt_s2501_summary ORDER BY reporting_period""")

ds_scr_breakdown = ds("ds_scr_breakdown", "SCR breakdown", f"""
    SELECT reporting_period, template_row_label,
           ROUND(amount_eur / 1e6, 1) AS amount_m
    FROM {FQN}.3_qrt_s2501_scr_breakdown
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.3_qrt_s2501_scr_breakdown)
      AND template_row_id IN ('R0010','R0020','R0030','R0040','R0050','R0100','R0130')
    ORDER BY template_row_id""")

# P&C — assets, P&L, NL UW
ds_assets_by_cic = ds("ds_assets_by_cic", "Assets by CIC", f"""
    SELECT cic_category_name AS cic_category,
           ROUND(SUM(CAST(total_sii_amount AS DOUBLE)) / 1e6, 1) AS sii_m
    FROM {FQN}.3_qrt_s0602_summary
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.3_qrt_s0602_summary)
    GROUP BY cic_category_name ORDER BY sii_m DESC""")

ds_pnl_by_lob = ds("ds_pnl_by_lob", "P&L by LoB (latest)", f"""
    SELECT lob_name,
           ROUND(combined_ratio_pct, 1) AS combined_ratio_pct,
           ROUND(loss_ratio_pct, 1) AS loss_ratio_pct,
           ROUND(expense_ratio_pct, 1) AS expense_ratio_pct
    FROM {FQN}.3_qrt_s0501_summary
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.3_qrt_s0501_summary)
      AND lob_name <> 'Total'
    ORDER BY combined_ratio_pct DESC""")

ds_nl_uw = ds("ds_nl_uw", "Non-Life UW SCR", f"""
    SELECT reporting_period,
           ROUND(total_nl_uw_scr / 1e6, 1) AS nl_uw_m,
           ROUND(cat_pct_of_total, 1) AS cat_pct
    FROM {FQN}.3_qrt_s2606_summary ORDER BY reporting_period""")

# Life — TPs, Life UW, lapse trend
ds_life_tps = ds("ds_life_tps", "Life TPs by LoB", f"""
    SELECT lob_name,
           ROUND(SUM(best_estimate_liability_eur) / 1e6, 1) AS bel_m,
           ROUND(SUM(risk_margin_eur) / 1e6, 1) AS rm_m
    FROM {FQN}.1_raw_life_reserves
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.1_raw_life_reserves)
    GROUP BY lob_name ORDER BY bel_m DESC""")

ds_life_uw = ds("ds_life_uw", "Life UW SCR sub-modules", f"""
    SELECT reporting_period,
           ROUND(mortality_eur / 1e6, 1) AS mortality_m,
           ROUND(longevity_eur / 1e6, 1) AS longevity_m,
           ROUND(lapse_eur / 1e6, 1) AS lapse_m,
           ROUND(expense_eur / 1e6, 1) AS expense_m,
           ROUND(life_cat_eur / 1e6, 1) AS life_cat_m,
           ROUND(total_life_uw_scr / 1e6, 1) AS total_m
    FROM {FQN}.3_qrt_life_uw_risk_summary ORDER BY reporting_period""")

ds_lapse_trend = ds("ds_lapse_trend", "Unit-linked lapse trend", f"""
    SELECT reporting_period,
           ROUND(SUM(lapsed_in_quarter) * 100.0 /
                 NULLIF(SUM(in_force_at_quarter_start), 0), 3) AS lapse_pct
    FROM {FQN}.1_raw_life_lapses WHERE lob_name = 'unit_linked'
    GROUP BY reporting_period ORDER BY reporting_period""")

# Pipeline / DQ
ds_dq_trend = ds("ds_dq_trend", "DQ pass rate trend", f"""
    SELECT reporting_period,
           ROUND(SUM(passing_records) * 100.0 /
                 NULLIF(SUM(total_records), 0), 1) AS pass_rate_pct
    FROM {FQN}.5_mon_dq_expectation_results GROUP BY reporting_period ORDER BY reporting_period""")

ds_sla_status = ds("ds_sla_status", "Feed SLA status (latest)", f"""
    SELECT feed_name, source_system, status, dq_pass_rate, notes
    FROM {FQN}.5_mon_pipeline_sla_status
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.5_mon_pipeline_sla_status)
    ORDER BY status DESC, feed_name""")

ds_recon = ds("ds_recon", "Cross-QRT reconciliation (latest)", f"""
    SELECT check_name, source_qrt, target_qrt,
           ROUND(source_value / 1e6, 1) AS source_m,
           ROUND(target_value / 1e6, 1) AS target_m,
           ROUND(difference / 1e6, 2) AS diff_m,
           status
    FROM {FQN}.5_mon_cross_qrt_reconciliation
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {FQN}.5_mon_cross_qrt_reconciliation)
    ORDER BY status, check_name""")


# ── Widget builders ───────────────────────────────────────────────────

def counter(ds_name: str, field: str, title: str) -> dict:
    return {
        "name": uid(),
        "queries": [{"name": "main_query", "query": {
            "datasetName": ds_name,
            "fields": [{"name": field, "expression": f"`{field}`"}],
            "disaggregated": True,
        }}],
        "spec": {
            "version": 2, "widgetType": "counter",
            "encodings": {"value": {"fieldName": field, "displayName": title}},
            "frame": {"showTitle": True, "title": title},
        },
    }


def bar(ds_name: str, x: str, y: str, title: str, color: str | None = None, stacked: bool = False) -> dict:
    y_name = f"sum_{y}"
    fields = [
        {"name": x, "expression": f"`{x}`"},
        {"name": y_name, "expression": f"SUM(`{y}`)"},
    ]
    if color:
        fields.append({"name": color, "expression": f"`{color}`"})
    enc = {
        "x": {"fieldName": x, "scale": {"type": "categorical"}, "displayName": x},
        "y": {"fieldName": y_name, "scale": {"type": "quantitative"}, "displayName": y},
    }
    if color:
        enc["color"] = {"fieldName": color, "scale": {"type": "categorical"}, "displayName": color}
    if stacked:
        enc["y"]["scale"]["stackMode"] = "stacked"
    return {
        "name": uid(),
        "queries": [{"name": "main_query", "query": {
            "datasetName": ds_name, "fields": fields, "disaggregated": False,
        }}],
        "spec": {"version": 3, "widgetType": "bar", "encodings": enc,
                 "frame": {"showTitle": True, "title": title}},
    }


def line(ds_name: str, x: str, y: str, title: str) -> dict:
    y_name = f"sum_{y}"
    return {
        "name": uid(),
        "queries": [{"name": "main_query", "query": {
            "datasetName": ds_name,
            "fields": [
                {"name": x, "expression": f"`{x}`"},
                {"name": y_name, "expression": f"SUM(`{y}`)"},
            ],
            "disaggregated": False,
        }}],
        "spec": {
            "version": 3, "widgetType": "line",
            "encodings": {
                "x": {"fieldName": x, "scale": {"type": "categorical"}, "displayName": x},
                "y": {"fieldName": y_name, "scale": {"type": "quantitative"}, "displayName": y},
            },
            "frame": {"showTitle": True, "title": title},
        },
    }


def pie(ds_name: str, angle: str, color: str, title: str) -> dict:
    angle_name = f"sum_{angle}"
    return {
        "name": uid(),
        "queries": [{"name": "main_query", "query": {
            "datasetName": ds_name,
            "fields": [
                {"name": angle_name, "expression": f"SUM(`{angle}`)"},
                {"name": color, "expression": f"`{color}`"},
            ],
            "disaggregated": False,
        }}],
        "spec": {
            "version": 3, "widgetType": "pie",
            "encodings": {
                "angle": {"fieldName": angle_name, "scale": {"type": "quantitative"}, "displayName": angle},
                "color": {"fieldName": color, "scale": {"type": "categorical"}, "displayName": color},
            },
            "frame": {"showTitle": True, "title": title},
        },
    }


def table(ds_name: str, cols: list[tuple[str, str]], title: str) -> dict:
    """cols: list of (field_name, display_name)"""
    fields = [{"name": c, "expression": f"`{c}`"} for c, _ in cols]
    columns = [
        {"fieldName": c, "type": "string", "displayName": d, "visible": True, "order": i}
        for i, (c, d) in enumerate(cols)
    ]
    return {
        "name": uid(),
        "queries": [{"name": "main_query", "query": {
            "datasetName": ds_name, "fields": fields, "disaggregated": True,
        }}],
        "spec": {
            "version": 1, "widgetType": "table",
            "encodings": {"columns": columns},
            "frame": {"showTitle": True, "title": title},
        },
    }


def lay(widget: dict, x: int, y: int, w: int, h: int) -> dict:
    return {"widget": widget, "position": {"x": x, "y": y, "width": w, "height": h}}


# ── Layouts ──────────────────────────────────────────────────────────

overview_layout = [
    lay(counter(ds_kpi_latest, "solvency_ratio_pct", "Solvency Ratio %"), 0, 0, 2, 3),
    lay(counter(ds_kpi_latest, "scr_m", "SCR (EUR M)"),                  2, 0, 2, 3),
    lay(counter(ds_kpi_latest, "eof_m", "Eligible Own Funds (EUR M)"),   4, 0, 2, 3),
    lay(line(ds_solvency_trend, "reporting_period", "solvency_ratio_pct", "Solvency Ratio Trend"), 0, 3, 6, 4),
    lay(bar(ds_scr_breakdown, "template_row_label", "amount_m", "SCR Modules — latest period"),    0, 7, 6, 5),
]

pnc_layout = [
    lay(pie(ds_assets_by_cic, "sii_m", "cic_category", "Assets by CIC (latest)"),            0, 0, 3, 5),
    lay(bar(ds_pnl_by_lob, "lob_name", "combined_ratio_pct", "Combined Ratio by LoB"),       3, 0, 3, 5),
    lay(line(ds_nl_uw, "reporting_period", "nl_uw_m", "Non-Life UW SCR trend"),               0, 5, 3, 4),
    lay(line(ds_nl_uw, "reporting_period", "cat_pct", "NL Cat % of total"),                   3, 5, 3, 4),
]

life_layout = [
    lay(pie(ds_life_tps, "bel_m", "lob_name", "Life BEL by LoB (latest)"),                    0, 0, 3, 5),
    lay(bar(ds_life_tps, "lob_name", "rm_m", "Life Risk Margin by LoB"),                       3, 0, 3, 5),
    lay(line(ds_life_uw, "reporting_period", "total_m", "Life UW SCR trend"),                  0, 5, 3, 4),
    lay(line(ds_lapse_trend, "reporting_period", "lapse_pct", "Unit-linked lapse rate trend"),3, 5, 3, 4),
    lay(table(ds_life_uw,
              [("reporting_period", "Period"), ("mortality_m", "Mortality"),
               ("longevity_m", "Longevity"), ("lapse_m", "Lapse"),
               ("expense_m", "Expense"), ("life_cat_m", "Life Cat"),
               ("total_m", "Total (diversified)")],
              "Life UW sub-modules over time"),                                                0, 9, 6, 4),
]

scr_layout = [
    lay(bar(ds_scr_breakdown, "template_row_label", "amount_m", "SCR breakdown — latest period"), 0, 0, 6, 5),
    lay(line(ds_solvency_trend, "reporting_period", "scr_m", "SCR trend (EUR M)"),                 0, 5, 3, 4),
    lay(line(ds_solvency_trend, "reporting_period", "eof_m", "Eligible Own Funds trend"),          3, 5, 3, 4),
]

pipeline_layout = [
    lay(line(ds_dq_trend, "reporting_period", "pass_rate_pct", "DQ pass rate trend"),               0, 0, 6, 4),
    lay(table(ds_sla_status,
              [("feed_name", "Feed"), ("source_system", "Source"),
               ("status", "Status"), ("dq_pass_rate", "DQ pass"), ("notes", "Notes")],
              "Feed SLA status — latest"),                                                          0, 4, 6, 4),
    lay(table(ds_recon,
              [("check_name", "Check"), ("source_qrt", "Source"), ("target_qrt", "Target"),
               ("source_m", "Source (EUR M)"), ("target_m", "Target (EUR M)"),
               ("diff_m", "Diff (EUR M)"), ("status", "Status")],
              "Cross-QRT reconciliation — latest"),                                                 0, 8, 6, 5),
]


# ── Assemble + deploy ────────────────────────────────────────────────

serialized = {
    "datasets": datasets,
    "pages": [
        {"name": uid(), "displayName": "Composite Overview",
         "pageType": "PAGE_TYPE_CANVAS", "layout": overview_layout},
        {"name": uid(), "displayName": "P&C",
         "pageType": "PAGE_TYPE_CANVAS", "layout": pnc_layout},
        {"name": uid(), "displayName": "Life",
         "pageType": "PAGE_TYPE_CANVAS", "layout": life_layout},
        {"name": uid(), "displayName": "SCR breakdown",
         "pageType": "PAGE_TYPE_CANVAS", "layout": scr_layout},
        {"name": uid(), "displayName": "Pipeline & DQ",
         "pageType": "PAGE_TYPE_CANVAS", "layout": pipeline_layout},
    ],
    "uiSettings": {
        "theme": {"widgetHeaderAlignment": "ALIGNMENT_UNSPECIFIED"},
        "applyModeEnabled": False,
    },
}

serialized_json = json.dumps(serialized)

if DASHBOARD_ID:
    print(f"Updating dashboard {DASHBOARD_ID} (dev)...")
    payload = {"serialized_dashboard": serialized_json}
    result = subprocess.run(
        ["databricks", "api", "patch", f"/api/2.0/lakeview/dashboards/{DASHBOARD_ID}",
         "--profile", PROFILE, "--json", json.dumps(payload)],
        capture_output=True, text=True,
    )
else:
    print("Creating dashboard (dev)...")
    payload = {
        "display_name": "Solvency II Composite — dev",
        "warehouse_id": WAREHOUSE_ID,
        "parent_path": PARENT_PATH,
        "serialized_dashboard": serialized_json,
    }
    result = subprocess.run(
        ["databricks", "api", "post", "/api/2.0/lakeview/dashboards",
         "--profile", PROFILE, "--json", json.dumps(payload)],
        capture_output=True, text=True,
    )

if result.returncode != 0:
    print(f"Error: {result.stderr}", file=sys.stderr)
    sys.exit(1)

resp = json.loads(result.stdout)
dashboard_id = resp.get("dashboard_id", DASHBOARD_ID)
print(f"DASHBOARD_ID={dashboard_id}")

# Publish
print("Publishing...")
pub = subprocess.run(
    ["databricks", "api", "post",
     f"/api/2.0/lakeview/dashboards/{dashboard_id}/published",
     "--profile", PROFILE,
     "--json", json.dumps({"warehouse_id": WAREHOUSE_ID, "embed_credentials": True})],
    capture_output=True, text=True,
)
if pub.returncode != 0:
    print(f"Publish warning: {pub.stderr}", file=sys.stderr)

print("Done.")

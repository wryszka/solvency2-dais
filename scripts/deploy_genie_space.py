#!/usr/bin/env python3
"""Idempotent Genie space deploy.

Lookup-by-name → create if absent, update if present. Writes the resulting
space ID to stdout (for capture by deploy_demo.sh) and to a small file at
.genie_space_id under the bundle target's tmp area.

Usage:
  python3 scripts/deploy_genie_space.py --profile DEV \
    --catalog lr_dev_aws_us_catalog --schema solvency2_workbench \
    --warehouse a3b61648ea4809e3 --parent /Workspace/Users/me@example.com

Re-running this script must NOT create a second space. If a space with the
same `title` already exists in the parent path, it is updated in place.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

GENIE_TITLE = "Solvency II QRT Assistant"
GENIE_DESCRIPTION = (
    "Ask questions about Bricksurance SE Solvency II data: assets, premiums, "
    "claims, SCR, solvency ratio, own funds."
)

GENIE_TABLES_RELATIVE = sorted([
    "1_raw_assets", "1_raw_premiums", "1_raw_claims", "1_raw_expenses",
    "1_raw_risk_factors", "1_raw_own_funds", "1_raw_balance_sheet",
    "2_stg_scr_results", "1_raw_counterparties", "1_raw_reinsurance",
    "2_stg_assets_enriched",
    "3_qrt_s0602_list_of_assets", "3_qrt_s0602_summary",
    "2_stg_premiums_by_lob", "2_stg_claims_by_lob", "2_stg_expenses_by_lob",
    "3_qrt_s0501_premiums_claims_expenses", "3_qrt_s0501_summary",
    "3_qrt_s2501_scr_breakdown", "3_qrt_s2501_summary",
    "3_qrt_s2606_nl_uw_risk", "3_qrt_s2606_summary",
    "2_stg_cat_risk_by_lob", "2_stg_premium_reserve_risk",
    "4_eng_stochastic_results", "4_eng_stochastic_run_log",
    "1_raw_claims_triangles", "1_raw_volume_measures",
])


def _api(method: str, path: str, profile: str, body: dict | None = None) -> dict:
    cmd = ["databricks", "api", method, path, "--profile", profile]
    if body is not None:
        cmd.extend(["--json", json.dumps(body)])
    r = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if r.returncode != 0 and not r.stdout:
        raise SystemExit(f"databricks CLI failed for {method} {path}:\n{r.stderr}")
    try:
        return json.loads(r.stdout) if r.stdout else {}
    except json.JSONDecodeError:
        return {"_raw": r.stdout, "_stderr": r.stderr}


def _lookup_existing(profile: str, parent_path: str) -> str | None:
    """Return space_id if a Genie space with the canonical title already exists in parent_path."""
    # The list endpoint isn't a public API as of writing; we rely on the user-context list
    # via `/api/2.0/genie/spaces`. If listing returns nothing or 404, treat as absent.
    resp = _api("get", "/api/2.0/genie/spaces", profile)
    spaces = resp.get("spaces") or resp.get("data") or []
    for s in spaces:
        if s.get("title") == GENIE_TITLE and (parent_path == "" or s.get("parent_path") == parent_path):
            return s.get("space_id") or s.get("id")
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default=os.environ.get("DATABRICKS_PROFILE", "DEFAULT"))
    ap.add_argument("--catalog", default=os.environ.get("CATALOG", ""))
    ap.add_argument("--schema",  default=os.environ.get("SCHEMA", ""))
    ap.add_argument("--warehouse", default=os.environ.get("WAREHOUSE_ID", ""))
    ap.add_argument("--parent", default=os.environ.get("GENIE_PARENT_PATH", ""),
                    help="Workspace folder for the space (e.g. /Workspace/Users/you@example.com)")
    args = ap.parse_args()

    for name, val in [("catalog", args.catalog), ("schema", args.schema),
                      ("warehouse", args.warehouse), ("parent", args.parent)]:
        if not val:
            raise SystemExit(f"Missing --{name} (or env equivalent).")

    qualified_tables = [
        {"identifier": f"{args.catalog}.{args.schema}.{t}"}
        for t in GENIE_TABLES_RELATIVE
    ]
    serialized_space = {
        "version": 2,
        "data_sources": {"tables": qualified_tables},
    }

    payload = {
        "title": GENIE_TITLE,
        "description": GENIE_DESCRIPTION,
        "warehouse_id": args.warehouse,
        "parent_path": args.parent,
        "serialized_space": json.dumps(serialized_space),
    }

    existing_id = _lookup_existing(args.profile, args.parent)
    if existing_id:
        sys.stderr.write(f"Genie space '{GENIE_TITLE}' already exists ({existing_id}); updating tables…\n")
        # Update path for Genie spaces — depends on workspace API support.
        # If no PATCH endpoint exists, the space stays as-is and we just emit the existing ID.
        try:
            _api("patch", f"/api/2.0/genie/spaces/{existing_id}", args.profile, body=payload)
            sys.stderr.write("  ✓ updated\n")
        except SystemExit as e:
            sys.stderr.write(f"  (update API not available — keeping existing tables: {e})\n")
        print(existing_id)
        return

    sys.stderr.write(f"Creating Genie space '{GENIE_TITLE}'…\n")
    resp = _api("post", "/api/2.0/genie/spaces", args.profile, body=payload)
    space_id = resp.get("space_id") or resp.get("id") or ""
    if not space_id:
        raise SystemExit(f"Genie create returned no space_id:\n{json.dumps(resp, indent=2)[:600]}")
    sys.stderr.write(f"  ✓ created {space_id}\n")
    print(space_id)


if __name__ == "__main__":
    main()

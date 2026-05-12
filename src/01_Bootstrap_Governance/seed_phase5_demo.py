# Databricks notebook source
# MAGIC %md
# MAGIC # Phase 5 demo seed (bundle-runnable)
# MAGIC
# MAGIC Wraps `scripts/seed_phase5.py` as a serverless-runnable notebook so
# MAGIC `databricks bundle run governance_setup` includes the Phase 5 narrative
# MAGIC tables (`6_demo_data_feeds`, `6_demo_event_log`, `6_demo_solvency_daily`,
# MAGIC `6_demo_cyber_book`, `6_demo_orsa_history`, `6_demo_sf_challenger`,
# MAGIC `6_demo_whatif_runs`, `gold_orsa_draft`, `gold_submissions_archive`).
# MAGIC
# MAGIC The script's logic is identical to the laptop run; we just call its
# MAGIC `main()` after setting CATALOG / SCHEMA / WAREHOUSE_ID env vars from the
# MAGIC widget values.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema_name", "solvency2_workbench")
dbutils.widgets.text("warehouse_id", "a3b61648ea4809e3")
dbutils.widgets.text("databricks_profile", "DEV")

import os
os.environ["CATALOG"] = dbutils.widgets.get("catalog_name")
os.environ["SCHEMA"]  = dbutils.widgets.get("schema_name")
os.environ["WAREHOUSE_ID"] = dbutils.widgets.get("warehouse_id")
os.environ["DATABRICKS_PROFILE"] = dbutils.widgets.get("databricks_profile")

# COMMAND ----------

import sys, importlib.util
from pathlib import Path

# The bundle uploads the whole repo; the script lives at workspace_path/scripts/seed_phase5.py
# Resolve relative to this notebook (which is in src/01_Bootstrap_Governance/).
notebook_path = Path(__file__).parent if "__file__" in dir() else Path("/Workspace") / dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get().strip("/").rsplit("/", 1)[0]

# Robust path search: walk up to find the repo root that contains scripts/seed_phase5.py
def _find_seed_script() -> Path:
    candidates: list[Path] = []
    try:
        # Notebook context — workspace path
        ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
        nb = "/Workspace" + ctx.notebookPath().get()
        candidates.append(Path(nb).parent)
    except Exception:
        pass
    candidates.append(Path.cwd())
    for start in candidates:
        for parent in [start, *start.parents]:
            cand = parent / "scripts" / "seed_phase5.py"
            if cand.exists():
                return cand
    raise FileNotFoundError("Could not locate scripts/seed_phase5.py from notebook context")


seed_script = _find_seed_script()
print(f"Loading {seed_script}")

spec = importlib.util.spec_from_file_location("seed_phase5", seed_script)
mod = importlib.util.module_from_spec(spec)
sys.modules["seed_phase5"] = mod
spec.loader.exec_module(mod)

# COMMAND ----------

mod.main()

print()
print("Phase 5 demo seed complete.")

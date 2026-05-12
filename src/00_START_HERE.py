# Databricks notebook source
# MAGIC %md
# MAGIC # Solvency II QRT Demo (Agentic)
# MAGIC
# MAGIC 5 AI agents that review insurance regulatory reports before human sign-off.
# MAGIC They find issues that take actuaries hours to spot — in 15 seconds.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## First-Time Installation (from your laptop terminal)
# MAGIC
# MAGIC ### Prerequisites
# MAGIC - Databricks CLI v0.200+ installed (`brew install databricks` or `pip install databricks-cli`)
# MAGIC - Access to a Databricks workspace with Unity Catalog
# MAGIC - A SQL warehouse (serverless recommended)
# MAGIC
# MAGIC ### Steps
# MAGIC
# MAGIC ```bash
# MAGIC # 1. Clone the repo
# MAGIC git clone https://github.com/wryszka/solvency2_workbench-pnc-agentic.git
# MAGIC cd solvency2_workbench-pnc-agentic
# MAGIC
# MAGIC # 2. Authenticate to your workspace
# MAGIC databricks auth login --profile DEFAULT --host https://YOUR-WORKSPACE.cloud.databricks.com
# MAGIC
# MAGIC # 3. Run the deploy script (creates everything: schema, tables, pipelines, app)
# MAGIC bash deploy_demo.sh --catalog YOUR_CATALOG_NAME
# MAGIC
# MAGIC # This takes ~15 minutes and will:
# MAGIC #   - Create the solvency2_workbench schema
# MAGIC #   - Generate Q1-Q3 synthetic data
# MAGIC #   - Deploy 4 DLT pipelines via Databricks Asset Bundles
# MAGIC #   - Register the MLflow Standard Formula model
# MAGIC #   - Trigger all 4 QRT pipelines
# MAGIC #   - Create the Lakeview dashboard and Genie space
# MAGIC #   - Deploy the Databricks App (FastAPI + React)
# MAGIC ```
# MAGIC
# MAGIC If you prefer to do it step by step instead of `deploy_demo.sh`:
# MAGIC 1. Open this workspace folder
# MAGIC 2. Go to **00_Generate_Data / 02_bootstrap_archive** and run it (generates data)
# MAGIC 3. Back in your terminal: `databricks bundle deploy -t dev` (creates pipelines)
# MAGIC 4. Go to the Workflows page in the workspace and trigger the 4 QRT jobs
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## Before Each Demo
# MAGIC
# MAGIC 1. Open **00_Generate_Data / 04_inject_demo_gotchas** and run it (injects 4 hidden issues)
# MAGIC 2. Re-trigger the S.05.01 and S.26.06 pipelines from the Workflows page
# MAGIC 3. Open the app (URL printed by deploy script, or find it in Databricks Apps)
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## Demo Scripts
# MAGIC
# MAGIC - **05_AI_Agents / 01_demo_agent_eli5** — simplified version, good for recording
# MAGIC - **05_AI_Agents / 02_demo_agent_walkthrough** — technical version with live code cells
# MAGIC - **05_AI_Agents / 03_agentic_security_framework** — IT security & governance deep-dive
# MAGIC
# MAGIC The full demo script with what-to-click and what-to-say is in:
# MAGIC **00_Generate_Data / 01_setup_guide_and_demo_script**
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## What's in This Workspace
# MAGIC
# MAGIC | Folder | What's inside |
# MAGIC |--------|--------------|
# MAGIC | **00_Generate_Data** | Data generation, setup guide, demo prep, teardown |
# MAGIC | **01_QRT_S0602_Assets** | DLT pipeline notebooks for S.06.02 (List of Assets) |
# MAGIC | **02_QRT_S0501_PnL** | DLT pipeline notebooks for S.05.01 (Premiums, Claims & Expenses) |
# MAGIC | **03_QRT_S2501_SCR** | DLT pipeline + MLflow model for S.25.01 (SCR Standard Formula) |
# MAGIC | **04_QRT_S2606_NL_Risk** | DLT pipeline + stochastic engine for S.26.06 (NL UW Risk) |
# MAGIC | **05_AI_Agents** | Demo notebooks and security framework |
# MAGIC
# MAGIC **Schema:** `solvency2_workbench` in your workspace catalog
# MAGIC
# MAGIC **Cleanup:** Open **00_Generate_Data / 99_full_teardown** to remove everything

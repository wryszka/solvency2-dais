# Databricks notebook source
# MAGIC %md
# MAGIC # Solvency II QRT Demo (Agentic) — Setup & Demo Guide
# MAGIC
# MAGIC ## What Is This?
# MAGIC
# MAGIC A Solvency II regulatory reporting platform on Databricks with **5 AI agents** that help actuaries
# MAGIC review QRTs before submission. The agents find issues that take hours to spot manually — in 15 seconds.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## Workspace Folder Structure
# MAGIC
# MAGIC ```
# MAGIC solvency2_workbench-agentic/
# MAGIC ├── 00_Generate_Data/
# MAGIC │   ├── 00_START_HERE          <-- YOU ARE HERE
# MAGIC │   ├── generate_data           -- Creates all tables for one quarter
# MAGIC │   ├── bootstrap_archive       -- Runs generate_data for Q1, Q2, Q3
# MAGIC │   ├── inject_demo_gotchas     -- Injects 4 hidden issues for AI to find
# MAGIC │   └── full_teardown           -- Deletes everything (cleanup)
# MAGIC │
# MAGIC ├── 01_QRT_S0602_Assets/        -- DLT pipeline notebooks (S.06.02)
# MAGIC ├── 02_QRT_S0501_PnL/           -- DLT pipeline notebooks (S.05.01)
# MAGIC ├── 03_QRT_S2501_SCR/           -- DLT pipeline + MLflow model (S.25.01)
# MAGIC ├── 04_QRT_S2606_NL_Risk/       -- DLT pipeline + stochastic engine (S.26.06)
# MAGIC │
# MAGIC └── 05_AI_Agents/
# MAGIC     ├── demo_agent_walkthrough   -- Technical demo notebook (run during demo)
# MAGIC     ├── demo_agent_eli5          -- Simplified demo notebook (for recording)
# MAGIC     └── agentic_security_framework -- IT security & governance doc
# MAGIC ```
# MAGIC
# MAGIC ## Data Schema (`solvency2_workbench`)
# MAGIC
# MAGIC Tables use numbered layer prefixes — they sort in pipeline order in Unity Catalog:
# MAGIC
# MAGIC ```
# MAGIC 1_raw_*    Bronze: 13 source feed tables (assets, claims, premiums, etc.)
# MAGIC 2_stg_*    Silver: 7 cleansed/aggregated tables (DLT materialized views)
# MAGIC 3_qrt_*    Gold: 8 EIOPA template tables (the actual QRT output)
# MAGIC 4_eng_*    Stochastic engine: 2 tables (simulation results + run log)
# MAGIC 5_mon_*    Monitoring: 4 tables (SLA, DQ, reconciliation, model versions)
# MAGIC 6_ai_*     AI agent outputs: 2 tables (reviews + approvals)
# MAGIC 7_ref_*    Reference data: 1 table (SCR correlation matrix)
# MAGIC ```
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## INSTALLATION (first time, ~15 min)
# MAGIC
# MAGIC ### Option A: One-click deploy script (from your laptop)
# MAGIC
# MAGIC ```bash
# MAGIC git clone https://github.com/wryszka/solvency2_workbench-pnc-agentic.git
# MAGIC cd solvency2_workbench-pnc-agentic
# MAGIC databricks auth login --profile DEFAULT
# MAGIC bash deploy_demo.sh
# MAGIC ```
# MAGIC
# MAGIC This creates everything: schema, tables, DLT pipelines, MLflow model, dashboard, Genie space, app.
# MAGIC
# MAGIC ### Option B: Step-by-step from the workspace
# MAGIC
# MAGIC 1. **Run `bootstrap_archive`** — generates Q1, Q2, Q3 data (~6 min)
# MAGIC    - Set `catalog_name` = `lr_serverless_aws_us_catalog`
# MAGIC    - Set `schema_name` = `solvency2_workbench`
# MAGIC
# MAGIC 2. **Deploy the DAB bundle** (from your laptop):
# MAGIC    ```bash
# MAGIC    databricks bundle deploy -t dev
# MAGIC    ```
# MAGIC    This creates the 4 DLT pipelines and workflow jobs.
# MAGIC
# MAGIC 3. **Register the MLflow model** — run `03_QRT_S2501_SCR/register_standard_formula_model`
# MAGIC
# MAGIC 4. **Trigger all 4 QRT pipelines** (from Workflows UI or CLI)
# MAGIC
# MAGIC 5. **Deploy the app**:
# MAGIC    ```bash
# MAGIC    databricks apps deploy solvency2-workbench \
# MAGIC      --source-code-path /Workspace/Users/$USER/.bundle/solvency2_workbench-pnc/dev/files/src/app
# MAGIC    ```
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## DEMO PREP (before each demo, ~5 min)
# MAGIC
# MAGIC 1. **Run `inject_demo_gotchas`** — injects 4 hidden issues into Q3 data
# MAGIC    - EUR 12.3M fire claim hiding in Property
# MAGIC    - Reinsurance cession dropped from 30% to 18%
# MAGIC    - Asset duration vs market risk charge mismatch
# MAGIC    - Windstorm stochastic tail too thin
# MAGIC
# MAGIC 2. **Re-trigger S.05.01 and S.26.06 pipelines** — to propagate changes through DLT
# MAGIC
# MAGIC 3. **Open the app**: `https://solvency2-workbench-7474659673789953.aws.databricksapps.com`
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## DEMO SCRIPT (~15 min)
# MAGIC
# MAGIC ### Act 1: The Platform (5 min)
# MAGIC
# MAGIC | Step | Where | What to show | What to say |
# MAGIC |------|-------|-------------|------------|
# MAGIC | 1 | App → Monitor | KPIs, feed status, reconciliation | "First thing every morning — have my feeds arrived?" |
# MAGIC | 2 | App → Data Quality | Pass rates, trend, per-pipeline | "99.9% pass rate. Bad data doesn't propagate." |
# MAGIC | 3 | App → Reports → S.25.01 | Content, Template, Comparison tabs | "This is what BaFin will see." |
# MAGIC | 4 | S.25.01 → Lineage | Pipeline DAG with SQL | "Full audit trail, every step." |
# MAGIC | 5 | S.25.01 → Model Governance | Champion vs Challenger | "Which version did we use? One click." |
# MAGIC
# MAGIC ### Act 2: The AI Agents (8 min) — the "wow" part
# MAGIC
# MAGIC | Step | Where | What to click | What to say |
# MAGIC |------|-------|--------------|------------|
# MAGIC | 6 | S.05.01 → Approve tab | **Generate AI Review** | "Property looks fine at 97%. Watch what the AI finds." |
# MAGIC | 7 | Read the review | Expand Guardrails banner | "It found the EUR 12.3M fire AND the reinsurance cession change." |
# MAGIC | 8 | Monitor → Cross-QRT | **Run Consistency Review** | "Now it reads all 4 QRTs together. Watch the duration gap." |
# MAGIC | 9 | S.26.06 → Stochastic Engine | **Review Stochastic Engine** | "Windstorm tail too thin — 1.12x vs expected 1.5-2.0x." |
# MAGIC | 10 | Data Quality | **Investigate DQ Issues** | "When checks fail, the agent explains why in 10 seconds." |
# MAGIC | 11 | Regulator Q&A | Type: "BaFin response for property spike" | "15-second draft with actual data references." |
# MAGIC
# MAGIC ### Act 3: Security & Governance (2 min)
# MAGIC
# MAGIC | Step | Where | What to show | What to say |
# MAGIC |------|-------|-------------|------------|
# MAGIC | 12 | Any review → Guardrails | Expand panel | "12 controls, 7 layers. The AI can never approve." |
# MAGIC | 13 | Any review → Governance | Expand panel | "Every Databricks feature mapped to a security control." |
# MAGIC | 14 | S.05.01 → Approve tab | Click **Approve** | "The human always decides. AI did the first 3 hours." |
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## 5 AI AGENTS
# MAGIC
# MAGIC | # | Agent | Where in App | What it finds |
# MAGIC |---|-------|-------------|--------------|
# MAGIC | 1 | **Actuarial Review** | Any QRT → Approve tab | Large losses, cession changes, ratio anomalies |
# MAGIC | 2 | **Regulator Q&A** | Top nav → Regulator Q&A | Answers questions, drafts BaFin responses |
# MAGIC | 3 | **DQ Triage** | Data Quality → Investigate | Root causes of DQ failures |
# MAGIC | 4 | **Cross-QRT Consistency** | Monitor → Run Consistency | Duration/risk gaps across QRTs |
# MAGIC | 5 | **Stochastic Engine** | S.26.06 → Stochastic Engine | Tail thickness, convergence, exposure gaps |
# MAGIC
# MAGIC All agents use **Databricks Foundation Model API** (Claude Sonnet preferred, Llama 70B fallback),
# MAGIC with **12 security controls** across 7 layers. See `05_AI_Agents/agentic_security_framework` for details.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## HIDDEN ISSUES (injected by `inject_demo_gotchas`)
# MAGIC
# MAGIC | # | Issue | QRT | What the AI says |
# MAGIC |---|-------|-----|-----------------|
# MAGIC | 1 | EUR 12.3M fire claim in Property | S.05.01 | "97% CR driven by single claim. Excluding: 82%." |
# MAGIC | 2 | RI cession dropped 30% → 18% | S.05.01 | "Net premium up 18% vs gross up 3%." |
# MAGIC | 3 | Duration 3.2yr vs risk charge gap | Cross-QRT | "Implied sensitivity 60% higher than duration suggests." |
# MAGIC | 4 | Windstorm TVaR/VaR = 1.12x | S.26.06 | "Expected 1.5-2.0x. Possible tail truncation." |
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## THE PUNCHLINE
# MAGIC
# MAGIC *"The AI did the first 3 hours of work. The actuary spent 5 minutes on judgment."*
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## TEARDOWN
# MAGIC
# MAGIC Run `full_teardown` to remove all tables, pipelines, and the app.

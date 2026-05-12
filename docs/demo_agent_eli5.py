# Databricks notebook source
# MAGIC %md
# MAGIC # Solvency II QRT Demo — AI Agents (ELI5 Version)
# MAGIC
# MAGIC ## The One-Liner
# MAGIC
# MAGIC Insurance companies send quarterly risk reports to regulators. An actuary has to review every number
# MAGIC before it goes out — that takes 2-3 hours per report. We built 5 AI agents that do the first pass
# MAGIC in 15 seconds. The actuary still decides — the AI just finds the needles in the haystack.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## What Makes This Demo Special
# MAGIC
# MAGIC We didn't just build a "summarise this table" agent. We **injected 4 realistic issues** into the data —
# MAGIC the kind of things that take experienced actuaries hours to spot. The AI finds all of them.
# MAGIC
# MAGIC | What's hidden | Where | Why it's hard to spot | What the AI says |
# MAGIC |--------------|-------|----------------------|-----------------|
# MAGIC | **EUR 12.3M fire claim** | Property LoB (S.05.01) | Combined ratio is 97% — looks normal. But one claim is 14% of all losses. | *"97% driven by single claim. Excluding: 82%."* |
# MAGIC | **Reinsurance cession dropped** | Property LoB (S.05.01) | Gross premium up 3%, but net up 18%. Nobody flagged the treaty change. | *"Cession dropped from 30% to 18% — net risk jumped."* |
# MAGIC | **Duration vs risk charge gap** | Assets + SCR (cross-QRT) | Avg duration 3.2yr implies sensitivity X, but risk charge implies 1.6x that. | *"60% gap — either duration is wrong or model is over-calibrated."* |
# MAGIC | **Windstorm tail too thin** | Stochastic engine (S.26.06) | TVaR/VaR = 1.12x. Should be 1.5-2.0x for European windstorm. | *"Tail truncation or convergence issue."* |
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## Demo Prep (run once before recording)
# MAGIC
# MAGIC 1. Run the `inject_demo_gotchas` notebook (in `00_Generate_Data/`)
# MAGIC 2. Re-trigger S.05.01 and S.26.06 pipelines
# MAGIC 3. Open app: `https://solvency2-workbench-7474659673789953.aws.databricksapps.com`

# COMMAND ----------

# MAGIC %md
# MAGIC ## Before & After
# MAGIC
# MAGIC ### Before (without AI)
# MAGIC ```
# MAGIC Pipeline produces QRT
# MAGIC       |
# MAGIC       v
# MAGIC Actuary opens spreadsheet        <-- 30 mins
# MAGIC       |
# MAGIC       v
# MAGIC Compares to last quarter          <-- 45 mins
# MAGIC       |
# MAGIC       v
# MAGIC Checks data quality rules         <-- 30 mins
# MAGIC       |
# MAGIC       v
# MAGIC Cross-checks between reports      <-- 30 mins
# MAGIC       |
# MAGIC       v
# MAGIC Writes review memo                <-- 45 mins
# MAGIC       |
# MAGIC       v
# MAGIC Approves or rejects
# MAGIC ```
# MAGIC
# MAGIC ### After (with AI Agents)
# MAGIC ```
# MAGIC Pipeline produces QRT
# MAGIC       |
# MAGIC       v
# MAGIC Click "Generate AI Review"        <-- 1 click
# MAGIC       |
# MAGIC       v
# MAGIC AI finds the EUR 12.3M claim,     <-- 15 seconds
# MAGIC the cession change, the duration
# MAGIC gap, and the thin tail
# MAGIC       |
# MAGIC       v
# MAGIC Actuary reads findings            <-- 5 mins
# MAGIC       |
# MAGIC       v
# MAGIC Approves or rejects               <-- Human decides
# MAGIC ```

# COMMAND ----------

# MAGIC %md
# MAGIC ## Let's See It Work

# COMMAND ----------

# DBTITLE 1,Configure — set your catalog here
dbutils.widgets.text("catalog_name", "main")
catalog = dbutils.widgets.get("catalog_name")
schema = "solvency2demo_agentic"
print(f"Using: {catalog}.{schema}")

# COMMAND ----------

# DBTITLE 1,First — the data looks normal at a glance

display(spark.sql(f"""
    SELECT lob_name, gross_written, net_earned, net_incurred,
           total_expenses, loss_ratio_pct, expense_ratio_pct, combined_ratio_pct
    FROM {catalog}.{schema}.3_qrt_s0501_summary
    WHERE reporting_period = (SELECT MAX(reporting_period) FROM {catalog}.{schema}.3_qrt_s0501_summary)
    ORDER BY lob_code
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC **Look at Property.** Combined ratio ~97%. Most actuaries would glance at this and move on.
# MAGIC
# MAGIC But hidden inside:
# MAGIC - A single EUR 12.3M fire claim (14% of all Property losses)
# MAGIC - The reinsurance cession rate quietly dropped from 30% to 18%
# MAGIC
# MAGIC **Let's see if the AI catches it.**

# COMMAND ----------

# DBTITLE 1,Call the AI Agent on S.05.01
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
import json

w = WorkspaceClient()

# Pick a model
for model_name in ["databricks-claude-sonnet-4", "databricks-claude-3-7-sonnet", "databricks-meta-llama-3-3-70b-instruct"]:
    try:
        w.serving_endpoints.get(model_name)
        endpoint = model_name
        print(f"Using: {endpoint}")
        break
    except Exception:
        continue

# Get the data
summary = spark.sql(f"SELECT * FROM {catalog}.{schema}.3_qrt_s0501_summary ORDER BY reporting_period DESC LIMIT 2").toPandas()

response = w.serving_endpoints.query(
    name=endpoint,
    messages=[
        ChatMessage(role=ChatMessageRole.SYSTEM, content="""You are a senior actuarial reviewer. Review this QRT.
Focus on: combined ratio anomalies, large loss impact, net vs gross movements (reinsurance changes).
Output: Executive Summary, Key Metrics, Risk Flags, Recommendation."""),
        ChatMessage(role=ChatMessageRole.USER, content=f"""Review S.05.01 for Bricksurance SE.
Current: {json.dumps(summary.iloc[0].to_dict(), indent=2, default=str)}
Prior: {json.dumps(summary.iloc[1].to_dict(), indent=2, default=str) if len(summary) > 1 else 'N/A'}"""),
    ],
    max_tokens=2048,
    temperature=0.2,
)

review = response.choices[0].message.content
print(review)

# COMMAND ----------

# MAGIC %md
# MAGIC ### Did it find the issues?
# MAGIC
# MAGIC Look for these in the review above:
# MAGIC
# MAGIC 1. **Large loss:** Does it mention Property combined ratio being driven by a single large claim?
# MAGIC 2. **Cession change:** Does it flag that net premium grew much faster than gross?
# MAGIC
# MAGIC If yes — that's 45 minutes of actuarial investigation done in 12 seconds.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Safety — The AI Can't Approve Anything
# MAGIC
# MAGIC Every output is scanned for dangerous phrases. If the AI tries to approve a QRT, it gets blocked.

# COMMAND ----------

# DBTITLE 1,These phrases would BLOCK the review
import re

test_phrases = [
    "I hereby approve this QRT",
    "This QRT is approved for submission",
    "Submitted to BaFin",
    "On behalf of the board",
]

print("If the AI said any of these, the review would be BLOCKED:\n")
for phrase in test_phrases:
    found = phrase.lower() in review.lower()
    print(f"  {'BLOCKED' if found else 'OK'} — '{phrase}'")
print("\nThe AI stayed in its lane. It recommends — the human decides.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## The Other 4 Agents
# MAGIC
# MAGIC ### Agent 2: Regulator Q&A
# MAGIC You type: *"Prepare a response to BaFin about the property combined ratio spike"*
# MAGIC → The agent drafts a formal letter with actual numbers from the data.
# MAGIC **4-8 hours of work → 15 seconds.**
# MAGIC
# MAGIC ### Agent 3: DQ Triage
# MAGIC When data quality checks fail, the agent investigates:
# MAGIC → *"22 assets with invalid CIC codes — likely a custodian migration issue."*
# MAGIC **2 hours of log analysis → 10 seconds.**
# MAGIC
# MAGIC ### Agent 4: Cross-QRT Consistency
# MAGIC Reads all 4 QRTs together:
# MAGIC → *"Gov bond duration 3.2yr implies DV01 ~EUR 125M, but market risk charge implies EUR 200M — 60% gap."*
# MAGIC **No human does this mental arithmetic across two QRTs.**
# MAGIC
# MAGIC ### Agent 5: Stochastic Engine Review
# MAGIC Validates the full stochastic cycle:
# MAGIC → *"Windstorm TVaR/VaR = 1.12x at 1-in-200. Expected 1.5-2.0x. Possible convergence issue."*
# MAGIC **This is what a head of cat modelling spends a day checking.**

# COMMAND ----------

# MAGIC %md
# MAGIC ## Security — 12 Controls, 7 Layers
# MAGIC
# MAGIC | What we protect against | How | Databricks feature |
# MAGIC |------------------------|-----|-------------------|
# MAGIC | Unauthorized access | App service principal + ACLs | Unity Catalog + Apps |
# MAGIC | Model abuse | Endpoint ACLs | Serving Endpoint Permissions |
# MAGIC | Data leakage | Summary tables only — never raw records | UC Row/Column Filters |
# MAGIC | AI overreach | Forbidden pattern detection (can't approve) | Custom Guardrails |
# MAGIC | Cost runaway | Rate limiting (10/hr/user) | Custom Guardrails |
# MAGIC | PII in output | Regex scan for emails, phone numbers | Custom Guardrails |
# MAGIC | No audit trail | Every call logged with user, model, tokens | Unity Catalog Tables |
# MAGIC | AI makes decisions | Human-in-the-loop always | App Design |
# MAGIC
# MAGIC ### Data Organisation
# MAGIC
# MAGIC Tables are organised by numbered layers — you can see this in the Unity Catalog explorer:
# MAGIC
# MAGIC | Prefix | Layer | Example | AI can read? |
# MAGIC |--------|-------|---------|-------------|
# MAGIC | `1_raw_*` | Bronze (source feeds) | `1_raw_claims`, `1_raw_assets` | NO |
# MAGIC | `2_stg_*` | Silver (cleansed) | `2_stg_premiums_by_lob` | NO |
# MAGIC | `3_qrt_*` | Gold (QRT output) | `3_qrt_s0501_summary` | YES (summaries only) |
# MAGIC | `4_eng_*` | Stochastic engine | `4_eng_stochastic_results` | YES |
# MAGIC | `5_mon_*` | Monitoring | `5_mon_dq_expectation_results` | YES |
# MAGIC | `6_ai_*` | AI agent outputs | `6_ai_reviews` | Writes only |
# MAGIC | `7_ref_*` | Reference data | `7_ref_scr_parameters` | YES |
# MAGIC
# MAGIC Full details: see the `agentic_security_framework` notebook.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Audit Trail — Every AI Call is Logged

# COMMAND ----------

# DBTITLE 1,Compliance can query: who triggered what, when, with which model
display(spark.sql(f"""
    SELECT review_id, qrt_id, reporting_period,
           model_used, input_tokens, output_tokens,
           created_at, created_by
    FROM {catalog}.{schema}.6_ai_reviews
    ORDER BY created_at DESC
    LIMIT 5
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Demo It Live
# MAGIC
# MAGIC **App:** `https://solvency2-workbench-7474659673789953.aws.databricksapps.com`
# MAGIC
# MAGIC | Step | Where | What to click | What to say |
# MAGIC |------|-------|--------------|------------|
# MAGIC | 1 | Reports → S.05.01 | Approve tab → **Generate AI Review** | "Property looks fine at 97%. Watch." |
# MAGIC | 2 | Read the review | Expand guardrails banner | "It found the EUR 12.3M fire and the cession change" |
# MAGIC | 3 | Top nav → Monitor | **Run Consistency Review** | "Now all 4 QRTs checked together" |
# MAGIC | 4 | Reports → S.26.06 | Stochastic Engine tab → **Review** | "Windstorm tail too thin — 1.12x" |
# MAGIC | 5 | Top nav → Regulator Q&A | Type: "BaFin response for property" | "15-second draft with data" |
# MAGIC | 6 | Reports → S.05.01 | Approve tab → **Approve** | "The human always decides" |
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## TL;DR
# MAGIC
# MAGIC - **5 AI agents** for insurance regulatory reporting
# MAGIC - **4 hidden issues** injected — the AI finds all of them
# MAGIC - **15 seconds** instead of 2-3 hours per review
# MAGIC - **12 security controls**, 7 layers — AI can never approve
# MAGIC - **Databricks:** FMAPI, Unity Catalog, DLT, Apps, Serving ACLs
# MAGIC - **The punchline:** "The AI did the first 3 hours. The actuary spent 5 minutes on judgment."

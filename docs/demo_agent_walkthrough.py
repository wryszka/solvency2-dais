# Databricks notebook source
# MAGIC %md
# MAGIC # Solvency II QRT Demo — AI Agents Walkthrough (Technical)
# MAGIC
# MAGIC ## What This Demo Shows
# MAGIC
# MAGIC A Solvency II regulatory reporting platform with **5 AI agents** that assist actuaries
# MAGIC in reviewing QRTs before submission. The agents find issues that take hours to spot manually —
# MAGIC in 15 seconds.
# MAGIC
# MAGIC ### Demo Prep Checklist
# MAGIC 1. Run `inject_demo_gotchas` notebook (injects 4 realistic issues into Q3 data)
# MAGIC 2. Re-trigger S.05.01 and S.26.06 DLT pipelines to propagate changes
# MAGIC 3. Open the app: `https://solvency2-workbench-7474659673789953.aws.databricksapps.com`
# MAGIC
# MAGIC ### Hidden Issues the AI Will Find
# MAGIC
# MAGIC We injected 4 subtle but realistic problems into the data. These are the kind of issues
# MAGIC that take an experienced actuary 2-3 hours to find in a spreadsheet:
# MAGIC
# MAGIC | # | Issue | QRT | What the AI should say | Why it matters |
# MAGIC |---|-------|-----|----------------------|----------------|
# MAGIC | 1 | **EUR 12.3M fire claim hiding in Property** | S.05.01 | "Combined ratio 97% driven by single claim. Excluding: 82%." | Aggregate looks fine — large loss is hidden |
# MAGIC | 2 | **Reinsurance cession dropped from 30% to 18%** | S.05.01 | "Net premium up 18% vs gross up 3% — cession rate changed." | Net risk exposure jumped without anyone flagging it |
# MAGIC | 3 | **Asset duration vs market risk mismatch** | S.06.02 + S.25.01 | "Duration 3.2yr implies DV01 ~EUR 125M, but charge is EUR 200M — 60% gap." | Cross-QRT inconsistency no human catches without a calculator |
# MAGIC | 4 | **Windstorm tail too thin** | S.26.06 | "TVaR/VaR = 1.12x at 1-in-200. Expected 1.5-2.0x." | Stochastic model may be underestimating tail risk |
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### Architecture
# MAGIC
# MAGIC ```
# MAGIC ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
# MAGIC │ QRT Pipeline │───>│ Summary Data │───>│  AI Agent        │───>│ Human Review │
# MAGIC │ (DLT + Jobs) │    │ (Gold tables)│    │  (FMAPI + Guard) │    │ (Approve/Rej)│
# MAGIC └─────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
# MAGIC       │                    │                     │                     │
# MAGIC       ▼                    ▼                     ▼                     ▼
# MAGIC  Unity Catalog       Row/Col Filters      Audit in UC Table     Approval Table
# MAGIC  Lineage             Serving ACLs         Guardrail Verdicts    PDF Certificate
# MAGIC ```
# MAGIC
# MAGIC **Key principle:** The AI agent is an *advisor*, never a *decision-maker*.
# MAGIC
# MAGIC ### Schema Organisation (`solvency2demo_agentic`)
# MAGIC
# MAGIC All tables use numbered layer prefixes so they sort in pipeline order:
# MAGIC
# MAGIC ```
# MAGIC 1_raw_*            Bronze: 13 source feed tables (assets, claims, premiums, etc.)
# MAGIC 2_stg_*            Silver: 7 cleansed/aggregated tables (DLT materialized views)
# MAGIC 3_qrt_*            Gold: 8 EIOPA template tables (the actual QRT output)
# MAGIC 4_eng_*            Stochastic engine: 2 tables (results + run log)
# MAGIC 5_mon_*            Monitoring: 4 tables (SLA, DQ, reconciliation, model versions)
# MAGIC 6_ai_*             AI agent outputs: 2 tables (reviews + approvals)
# MAGIC 7_ref_*            Reference data: 1 table (SCR correlation matrix)
# MAGIC ```
# MAGIC
# MAGIC **The AI agents only read `3_qrt_*` and `5_mon_*` tables (summaries).
# MAGIC They never access `1_raw_*` (individual policyholder/claims records).**

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. The Data the Agent Sees
# MAGIC
# MAGIC The agent receives **pre-aggregated summary data only** — never raw policyholder records.

# COMMAND ----------

# DBTITLE 1,Configure — set your catalog here
dbutils.widgets.text("catalog_name", "main")
catalog = dbutils.widgets.get("catalog_name")
schema = "solvency2demo_agentic"
print(f"Using: {catalog}.{schema}")

# COMMAND ----------

# DBTITLE 1,S.25.01 SCR Summary — what the Actuarial Review Agent reads

display(spark.sql(f"""
    SELECT * FROM {catalog}.{schema}.3_qrt_s2501_summary
    ORDER BY reporting_period DESC
    LIMIT 2
"""))

# COMMAND ----------

# DBTITLE 1,S.05.01 P&L Summary — where the large loss and cession change are hiding
display(spark.sql(f"""
    SELECT * FROM {catalog}.{schema}.3_qrt_s0501_summary
    ORDER BY reporting_period DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC **Look at Property (LoB 7).** The combined ratio is ~97% — looks fine at first glance.
# MAGIC But there's a EUR 12.3M fire claim hiding in there, and the reinsurance cession
# MAGIC dropped from 30% to 18%. The agent will spot both.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. How the Agent Works
# MAGIC
# MAGIC | Component | Implementation |
# MAGIC |-----------|---------------|
# MAGIC | **Model** | Claude Sonnet (preferred) or Meta Llama 3.3 70B (fallback) |
# MAGIC | **System prompt** | Senior actuarial reviewer persona with structured output |
# MAGIC | **User prompt** | Per-QRT template filled with summary data, DQ, reconciliation |
# MAGIC | **Temperature** | 0.2 (low creativity, high consistency) |
# MAGIC | **Guardrails** | 12 controls across 7 layers (see Security Framework notebook) |
# MAGIC | **Latency** | ~8-15 seconds |

# COMMAND ----------

# DBTITLE 1,Calling the Agent Programmatically
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
import json

w = WorkspaceClient()

# Try Sonnet first, fall back to Llama
for ep in ["databricks-claude-sonnet-4", "databricks-claude-3-7-sonnet", "databricks-meta-llama-3-3-70b-instruct"]:
    try:
        w.serving_endpoints.get(ep)
        endpoint = ep
        print(f"Using: {endpoint}")
        break
    except Exception:
        continue

# COMMAND ----------

# DBTITLE 1,Generate Review for S.05.01 — watch it find the large loss
summary = spark.sql(f"SELECT * FROM {catalog}.{schema}.3_qrt_s0501_summary ORDER BY reporting_period DESC LIMIT 2").toPandas()
current = summary.iloc[0].to_dict() if len(summary) > 0 else {}
prior = summary.iloc[1].to_dict() if len(summary) > 1 else {}

system_prompt = """You are a senior actuarial reviewer at a European P&C insurance company.
Review this QRT and produce a structured assessment. Focus on:
- Combined ratio by LoB — flag any anomalies
- Large loss impact — if a ratio spiked, investigate whether it's one large claim or a trend
- Net vs gross movements — flag reinsurance cession changes
- Period-over-period changes with quantified drivers
Output in markdown with: Executive Summary, Key Metrics, Period-over-Period Analysis, Risk Flags, Recommendation."""

user_prompt = f"""Review the S.05.01 — Premiums, Claims & Expenses QRT for Bricksurance SE.
Reporting period: {current.get('reporting_period', 'Unknown')}.

Current: {json.dumps(current, indent=2, default=str)}
Prior: {json.dumps(prior, indent=2, default=str)}
"""

response = w.serving_endpoints.query(
    name=endpoint,
    messages=[
        ChatMessage(role=ChatMessageRole.SYSTEM, content=system_prompt),
        ChatMessage(role=ChatMessageRole.USER, content=user_prompt),
    ],
    max_tokens=2048,
    temperature=0.2,
)

review_text = response.choices[0].message.content
print(review_text)

# COMMAND ----------

# MAGIC %md
# MAGIC ### What to highlight in the review above:
# MAGIC
# MAGIC 1. **Did it find the large fire claim?** Look for mention of Property LoB 7 combined ratio,
# MAGIC    and whether it identified that it's driven by a single large loss.
# MAGIC 2. **Did it catch the cession rate change?** Look for commentary on net vs gross premium
# MAGIC    divergence — "net premium up significantly more than gross."
# MAGIC
# MAGIC These are the two issues that would take a human actuary 30-45 minutes each to investigate.
# MAGIC The agent found them in ~12 seconds.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Guardrails — Defence in Depth
# MAGIC
# MAGIC | Layer | Controls |
# MAGIC |-------|----------|
# MAGIC | **Identity & Access** | App service principal, workspace ACLs |
# MAGIC | **Model Access** | Serving endpoint ACL — only app SP can call the LLM |
# MAGIC | **Input** | 50K char cap, 10/hr rate limit, summary-only data scope |
# MAGIC | **Output** | Forbidden patterns (can't approve), required sections, PII scan, truncation |
# MAGIC | **Audit** | Every call logged to `6_ai_reviews` with model, tokens, user, timestamp |
# MAGIC | **Human-in-the-Loop** | AI produces review, never decision |

# COMMAND ----------

# DBTITLE 1,Guardrails check — the AI cannot approve
import re

forbidden = [
    (r"(?i)I\s+hereby\s+approv", "Must not approve"),
    (r"(?i)this\s+QRT\s+is\s+(?:hereby\s+)?approved", "Must not approve"),
    (r"(?i)submitted?\s+to\s+(?:the\s+)?(?:regulator|BaFin|EIOPA)", "Must not claim submission"),
    (r"(?i)on\s+behalf\s+of\s+the\s+board", "Must not claim authority"),
]

for pattern, reason in forbidden:
    status = "BLOCKED" if re.search(pattern, review_text) else "PASS"
    print(f"  [{status}] {reason}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. All 5 Agents — What Each Finds
# MAGIC
# MAGIC | Agent | Where in App | Injected Issue It Should Find |
# MAGIC |-------|-------------|------------------------------|
# MAGIC | **Actuarial Review** | S.05.01 → Approve tab | EUR 12.3M fire claim + cession rate drop |
# MAGIC | **Cross-QRT Consistency** | Monitor → Run Consistency Review | Asset duration vs market risk charge gap |
# MAGIC | **Stochastic Engine** | S.26.06 → Stochastic Engine tab | Windstorm TVaR/VaR tail too thin |
# MAGIC | **DQ Triage** | Data Quality → Investigate | Explains quarantined rows pattern |
# MAGIC | **Regulator Q&A** | Regulator Q&A → ask a question | Grounded answers from all 4 QRTs |
# MAGIC
# MAGIC ### Demo flow (recommended order):
# MAGIC
# MAGIC **Start with the "boring" view** — show S.05.01 summary. Property at 97%. Looks fine.
# MAGIC
# MAGIC **Then click Generate AI Review** — the agent says "97% is driven by a single EUR 12.3M fire.
# MAGIC Strip it out and attritional is 82%. Also, net premium up 18% vs gross up 3% — RI cession changed."
# MAGIC
# MAGIC **Audience reaction:** "How did it know that from summary data?"
# MAGIC
# MAGIC **Then show Cross-QRT** — agent finds the duration/risk mismatch across S.06.02 and S.25.01.
# MAGIC No human does this cross-check without a calculator.
# MAGIC
# MAGIC **Then show Stochastic Engine** — agent flags windstorm tail too thin.
# MAGIC This is what a head of cat modelling spends a day validating.
# MAGIC
# MAGIC **Then show Regulator Q&A** — type "Prepare a response to BaFin about the property
# MAGIC combined ratio spike" and the agent drafts a formal letter with data references.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Live Demo in the App
# MAGIC
# MAGIC **App URL:** `https://solvency2-workbench-7474659673789953.aws.databricksapps.com`
# MAGIC
# MAGIC | Step | Where | What to do | What to say |
# MAGIC |------|-------|-----------|------------|
# MAGIC | 1 | S.05.01 → Approve | Click **Generate AI Review** | "Watch it find the large loss and cession change" |
# MAGIC | 2 | Expand Guardrails | Click the banner | "12 controls, 7 layers — it can never approve" |
# MAGIC | 3 | Monitor → Cross-QRT | Click **Run Consistency Review** | "Now it reads all 4 QRTs together" |
# MAGIC | 4 | S.26.06 → Stochastic | Click **Review Stochastic Engine** | "It validates the full stochastic cycle" |
# MAGIC | 5 | Data Quality | Click **Investigate DQ Issues** | "When checks fail, the agent explains why" |
# MAGIC | 6 | Regulator Q&A | Type a question | "Draft a BaFin response in 15 seconds" |
# MAGIC | 7 | Approve tab | Click Approve | "The human always decides — AI just did the first 3 hours" |

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Audit Trail

# COMMAND ----------

# DBTITLE 1,Every AI review is logged — who, when, which model, how many tokens
display(spark.sql(f"""
    SELECT review_id, qrt_id, reporting_period, model_used,
           input_tokens, output_tokens, created_at, created_by
    FROM {catalog}.{schema}.6_ai_reviews
    ORDER BY created_at DESC
    LIMIT 10
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary
# MAGIC
# MAGIC | Capability | Before | After (with 5 Agents) |
# MAGIC |-----------|--------|----------------------|
# MAGIC | QRT review time | 2-3 hours per template | ~15 seconds |
# MAGIC | Large loss detection | Manual claim-by-claim | Automatic — "97% driven by single EUR 12.3M claim" |
# MAGIC | RI cession change | Noticed at renewal (months later) | Flagged immediately — "net up 18% vs gross up 3%" |
# MAGIC | Cross-QRT consistency | Mental arithmetic across spreadsheets | Explicit — "duration 3.2yr but charge implies 5.2yr" |
# MAGIC | Stochastic validation | Day of cat modelling review | 15 seconds — "windstorm tail too thin at 1.12x" |
# MAGIC | Regulator response | 4-8 hours drafting | 15 second first draft with data references |
# MAGIC | Human decision | Always | Always (agents are advisory only) |
# MAGIC
# MAGIC ### Databricks Components
# MAGIC
# MAGIC - **Foundation Model API** — Claude Sonnet / Llama 70B
# MAGIC - **Unity Catalog** — Data governance, model registry, audit tables
# MAGIC - **DLT** — Data quality expectations
# MAGIC - **Databricks Apps** — Secure deployment with SP isolation
# MAGIC - **Serving Endpoint ACLs** — Model access control
# MAGIC - **Lakehouse Monitoring** — Observability (configurable)

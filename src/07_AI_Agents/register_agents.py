# Databricks notebook source
# MAGIC %md
# MAGIC # Register supervisor + specialist agents in Unity Catalog
# MAGIC
# MAGIC Logs every agent as an `mlflow.pyfunc.PythonModel` under
# MAGIC `{catalog}.{schema}.agent_*`. Each agent is independently invocable,
# MAGIC versionable, and traceable via MLflow.
# MAGIC
# MAGIC Agents:
# MAGIC - `agent_cat_review` — stochastic cat output + event log cross-reference
# MAGIC - `agent_orsa_narrative` — ORSA section drafting
# MAGIC - `agent_senior_reserving` — reserving anomalies + overlay proposals
# MAGIC - `agent_second_opinion` — contrarian what-if review
# MAGIC - `agent_recon_investigator` — cross-QRT reconciliation root cause
# MAGIC - `agent_dq_investigator` — data-quality investigation
# MAGIC - `agent_workbench_supervisor` — classifies + routes to specialists
# MAGIC
# MAGIC Each agent's `predict(model_input)` accepts a single-row DataFrame with
# MAGIC columns `question, period` and returns a single-row response.
# MAGIC
# MAGIC The supervisor invokes specialists in-process (instantiates the class)
# MAGIC rather than via `mlflow.pyfunc.load_model` — this preserves the
# MAGIC governance story (each specialist is a registered, versioned, traceable
# MAGIC UC artefact) without paying 7 cold-start penalties per supervisor call.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "lr_dev_aws_us_catalog", "Catalog")
dbutils.widgets.text("schema_name",  "solvency2_workbench",   "Schema")
dbutils.widgets.text("fm_endpoint",  "databricks-claude-sonnet-4", "FM endpoint")
dbutils.widgets.text("warehouse_id", "a3b61648ea4809e3", "SQL Warehouse ID (for data access from agents)")
catalog = dbutils.widgets.get("catalog_name")
schema  = dbutils.widgets.get("schema_name")
fm_endpoint  = dbutils.widgets.get("fm_endpoint")
warehouse_id = dbutils.widgets.get("warehouse_id")
print(f"Catalog/schema: {catalog}.{schema}")
print(f"FM endpoint:    {fm_endpoint}")
print(f"Warehouse:      {warehouse_id}")

# COMMAND ----------

# MAGIC %pip install -q mlflow>=2.16 databricks-sdk databricks-sql-connector pandas
# dbutils.library.restartPython()

# COMMAND ----------

import mlflow, os, json, re
mlflow.set_registry_uri("databricks-uc")

# COMMAND ----------

# MAGIC %md ## Shared agent base class

# COMMAND ----------

AGENTS_PYFILE = "/tmp/workbench_agents.py"

with open(AGENTS_PYFILE, "w") as f:
    f.write('''"""Specialist agents — shared module.

Each class is a self-contained mlflow.pyfunc.PythonModel subclass with its own
prompt + data shape. The supervisor agent imports + instantiates all of them
in-process. Each class is independently loggable to UC as an agent_* model.
"""
import json
import os
import re
import hashlib
from typing import Any

import mlflow
import pandas as pd


# ── FM API helper ───────────────────────────────────────────────────────────

def call_fm(messages: list, endpoint: str, max_tokens: int = 800) -> tuple[str, str, int, int]:
    """Call a Databricks Foundation Model serving endpoint. Returns
    (text, model_used, input_tokens, output_tokens)."""
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
    w = WorkspaceClient()
    chat_messages = [
        ChatMessage(role=ChatMessageRole.SYSTEM if m["role"] == "system" else ChatMessageRole.USER,
                    content=m["content"])
        for m in messages
    ]
    r = w.serving_endpoints.query(name=endpoint, messages=chat_messages,
                                  max_tokens=max_tokens, temperature=0.2)
    choice = r.choices[0] if r.choices else None
    text = (choice.message.content if choice and choice.message else "") or ""
    usage = r.usage
    return text, endpoint, (usage.prompt_tokens if usage else 0), (usage.completion_tokens if usage else 0)


# ── SQL helper (Databricks SQL connector — no Spark needed at serve time) ───

def run_sql(sql: str, params: list | None = None) -> list[dict]:
    from databricks import sql as dbsql
    host = os.environ.get("DATABRICKS_HOST", "").replace("https://", "")
    warehouse = os.environ.get("WAREHOUSE_HTTP_PATH", "")
    token = os.environ.get("DATABRICKS_TOKEN", "")
    if not host or not warehouse:
        return []
    with dbsql.connect(server_hostname=host, http_path=warehouse,
                       access_token=token) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            cols = [c[0] for c in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]


def fqn(catalog: str, schema: str, table: str) -> str:
    return f"`{catalog}`.`{schema}`.`{table}`"


# ── Base specialist agent ───────────────────────────────────────────────────

class BaseSpecialistAgent(mlflow.pyfunc.PythonModel):
    """Subclasses set NAME, SCOPE, DATA_SOURCES, SYSTEM_PROMPT, fetch(), format_user_prompt()."""
    NAME = "BaseSpecialist"
    SCOPE = ""
    DATA_SOURCES: list[str] = []
    SYSTEM_PROMPT = ""

    def load_context(self, context):
        self._catalog = os.environ.get("CATALOG_NAME", "lr_dev_aws_us_catalog")
        self._schema  = os.environ.get("SCHEMA_NAME",  "solvency2_workbench")
        self._fm      = os.environ.get("FM_ENDPOINT",  "databricks-claude-sonnet-4")

    def fetch(self, question: str, period: str) -> dict[str, Any]:
        return {}

    def format_user_prompt(self, question: str, period: str, data: dict) -> str:
        return f"Question: {question}\\n\\nPeriod: {period}\\n\\nData:\\n{json.dumps(data, default=str, indent=2)[:4000]}"

    def predict(self, context, model_input):
        if hasattr(model_input, "to_dict"):
            rows = model_input.to_dict(orient="records")
        elif isinstance(model_input, list):
            rows = model_input
        elif isinstance(model_input, dict):
            rows = [model_input]
        else:
            rows = [{"question": str(model_input), "period": "2025-Q4"}]
        results = []
        for r in rows:
            question = r.get("question", "")
            period = r.get("period", "2025-Q4")
            with mlflow.start_span(name=f"{self.NAME}.predict") as span:
                span.set_attribute("question", question)
                span.set_attribute("period", period)
                data = self.fetch(question, period)
                user_prompt = self.format_user_prompt(question, period, data)
                text, model_used, inp_tok, out_tok = call_fm(
                    [{"role": "system", "content": self.SYSTEM_PROMPT},
                     {"role": "user", "content": user_prompt}],
                    endpoint=self._fm, max_tokens=900,
                )
                span.set_attribute("model_used", model_used)
                results.append({
                    "agent": self.NAME,
                    "text": text,
                    "data_sources": self.DATA_SOURCES,
                    "model_used": model_used,
                    "input_tokens": inp_tok,
                    "output_tokens": out_tok,
                })
        return pd.DataFrame(results)


# ── Specialist 1: Cat ───────────────────────────────────────────────────────

class CatAgent(BaseSpecialistAgent):
    NAME = "agent_cat_review"
    SCOPE = "Stochastic cat output review, event log cross-reference."
    DATA_SOURCES = ["fn_event_log_lookup", "2_stg_cat_risk_by_lob"]
    SYSTEM_PROMPT = (
        "You are the Cat Modelling Agent. You review the stochastic catastrophe "
        "output from the Igloo engine against the external event log and quote "
        "specific events that drove the modelled loss. End with a recommendation: "
        "Accept / Re-run with adjusted assumption / Escalate."
    )

    def fetch(self, question, period):
        c, s = self._catalog, self._schema
        events = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_event_log_lookup')}('2025-09-01', '2026-01-01')")
        return {"events": events[:6]}


# ── Specialist 2: ORSA narrative ────────────────────────────────────────────

class OrsaNarrativeAgent(BaseSpecialistAgent):
    NAME = "agent_orsa_narrative"
    SCOPE = "ORSA section drafting, board narrative, stress commentary."
    DATA_SOURCES = ["fn_orsa_stress_state"]
    SYSTEM_PROMPT = (
        "You are the ORSA Narrative Agent. You draft commentary for ORSA "
        "scenarios — board-paper grade. Cite the actual numbers from the data "
        "block. Length: 200-300 words."
    )

    def fetch(self, question, period):
        c, s = self._catalog, self._schema
        rows = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_orsa_stress_state')}('{period}')")
        return {"results": rows[:40]}


# ── Specialist 3: Senior reserving ──────────────────────────────────────────

class SeniorReservingAgent(BaseSpecialistAgent):
    NAME = "agent_senior_reserving"
    SCOPE = "Reserving anomaly detection, overlay proposals."
    DATA_SOURCES = ["fn_reserving_anomalies", "fn_overlays_recent"]
    SYSTEM_PROMPT = (
        "You are the Senior Reserving Actuary. You surface reserving anomalies "
        "between quarters and propose overlays for the human actuary to consider. "
        "You do NOT create overlays — only the Overlays Register UI does that. "
        "End with: 'This decision is yours.'"
    )

    def fetch(self, question, period):
        c, s = self._catalog, self._schema
        prior = _prior_period(period)
        moves = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_reserving_anomalies')}('{prior}', '{period}')")
        overlays = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_overlays_recent')}('{period}')")
        return {"prior_period": prior, "movements": moves[:6], "existing_overlays": overlays}


# ── Specialist 4: Second opinion ────────────────────────────────────────────

class SecondOpinionAgent(BaseSpecialistAgent):
    NAME = "agent_second_opinion"
    SCOPE = "Contrarian review of strategic what-if scenarios."
    DATA_SOURCES = ["6_demo_whatif_runs"]
    SYSTEM_PROMPT = (
        "You are the Contrarian Capital Reviewer. You pressure-test scenario "
        "assumptions before they reach a board paper. Surface 2-4 specific "
        "evidence-based pushbacks. Each pushback cites a data source. End with "
        "one constructive recommendation."
    )

    def fetch(self, question, period):
        c, s = self._catalog, self._schema
        runs = run_sql(f"SELECT scenario_label, result_json, ran_at FROM {fqn(c, s, '6_demo_whatif_runs')} ORDER BY ran_at DESC LIMIT 3")
        return {"recent_whatif_runs": runs}


# ── Specialist 5: Recon investigator ────────────────────────────────────────

class ReconInvestigatorAgent(BaseSpecialistAgent):
    NAME = "agent_recon_investigator"
    SCOPE = "Cross-QRT reconciliation gap explanation."
    DATA_SOURCES = ["fn_recon_status"]
    SYSTEM_PROMPT = (
        "You are the Recon Investigator. For each cross-QRT mismatch, give the "
        "source/target cell, magnitude, likely cause (timing, classification, "
        "unit, methodology), and the resolution step. If all checks MATCH, say "
        "so plainly with the count."
    )

    def fetch(self, question, period):
        c, s = self._catalog, self._schema
        checks = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_recon_status')}('{period}')")
        return {"checks": checks}


# ── Specialist 6: DQ investigator ───────────────────────────────────────────

class DqInvestigatorAgent(BaseSpecialistAgent):
    NAME = "agent_dq_investigator"
    SCOPE = "Data quality root cause: failing expectations, late feeds, schema drift."
    DATA_SOURCES = ["fn_feed_status", "fn_dq_status"]
    SYSTEM_PROMPT = (
        "You are the DQ Investigator. Explain data quality failures across the "
        "ingestion pipelines. Cite specific feeds + expectation names. Who owns "
        "it; what's next?"
    )

    def fetch(self, question, period):
        c, s = self._catalog, self._schema
        feeds = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_feed_status')}('{period}')")
        dq = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_dq_status')}('{period}')")
        return {"feeds": feeds, "failing_dq": dq}


# ── Supervisor ──────────────────────────────────────────────────────────────

SUPERVISOR_CLASSIFIER_PROMPT = """You are a routing classifier. Given a user
question about a Solvency II reporting cycle, pick ONE specialist from the
catalogue who is best positioned to answer.

Reply with ONLY a JSON object on a single line:
{"specialist_key": "<key>", "confidence": <0-1>, "reason": "<one short sentence>"}

If unsure, pick 'general'. If purely numeric data query, pick 'genie'."""


class SupervisorAgent(mlflow.pyfunc.PythonModel):
    NAME = "agent_workbench_supervisor"
    SPECIALISTS_CLS = {
        "cat":             CatAgent,
        "orsa":            OrsaNarrativeAgent,
        "reserving":       SeniorReservingAgent,
        "second_opinion":  SecondOpinionAgent,
        "recon":           ReconInvestigatorAgent,
        "dq":              DqInvestigatorAgent,
    }
    CATALOGUE_TEXT = (
        "- cat: Cat Modelling Agent. Triggers: Igloo, cat losses, storm impact, S.26.06.\\n"
        "- orsa: ORSA Narrative Agent. Triggers: ORSA, stress, scenario, board paper.\\n"
        "- reserving: Senior Reserving Actuary. Triggers: reserves, triangle, LoB movement.\\n"
        "- second_opinion: Contrarian Reviewer. Triggers: what-if, scenario assumption.\\n"
        "- recon: Recon Investigator. Triggers: reconciliation, mismatch.\\n"
        "- dq: DQ Investigator. Triggers: DQ, late feed, quarantined, expectation.\\n"
        "- genie: Free-form SQL. Triggers: show me, count, sum, by LoB.\\n"
        "- general: Operational state. Triggers: outstanding, status, what's left."
    )

    def load_context(self, context):
        self._catalog = os.environ.get("CATALOG_NAME", "lr_dev_aws_us_catalog")
        self._schema  = os.environ.get("SCHEMA_NAME",  "solvency2_workbench")
        self._fm      = os.environ.get("FM_ENDPOINT",  "databricks-claude-sonnet-4")
        self._specialists = {}
        for key, cls in self.SPECIALISTS_CLS.items():
            agent = cls()
            agent.load_context(context)
            self._specialists[key] = agent

    def _classify(self, question: str) -> dict:
        try:
            user = f"Available specialists:\\n{self.CATALOGUE_TEXT}\\n\\nUser question:\\n{question}\\n\\nReturn the JSON object."
            text, _, _, _ = call_fm(
                [{"role": "system", "content": SUPERVISOR_CLASSIFIER_PROMPT},
                 {"role": "user",   "content": user}],
                endpoint=self._fm, max_tokens=120,
            )
            m = re.search(r"\\{[^{}]+\\}", text)
            if not m:
                return {"specialist_key": "general", "confidence": 0.0, "reason": "no-json"}
            obj = json.loads(m.group(0))
            key = obj.get("specialist_key", "general")
            if key not in self.SPECIALISTS_CLS and key not in ("genie", "general"):
                key = "general"
            return {"specialist_key": key, "confidence": float(obj.get("confidence", 0.5)),
                    "reason": str(obj.get("reason", ""))[:240]}
        except Exception as exc:
            return {"specialist_key": "general", "confidence": 0.0, "reason": f"classifier-failed: {exc}"}

    def _cache_lookup(self, question: str):
        try:
            c, s = self._catalog, self._schema
            rows = run_sql(f"SELECT * FROM {fqn(c, s, 'fn_cache_lookup')}(?)", [question])
            if rows:
                payload = json.loads(rows[0]["output_json"] or "{}")
                payload["_cached_at"] = str(rows[0].get("cached_at"))
                payload["_cache_key"] = rows[0].get("cache_key")
                return payload
        except Exception:
            return None
        return None

    def predict(self, context, model_input):
        if hasattr(model_input, "to_dict"):
            rows = model_input.to_dict(orient="records")
        elif isinstance(model_input, list):
            rows = model_input
        elif isinstance(model_input, dict):
            rows = [model_input]
        else:
            rows = [{"question": str(model_input), "period": "2025-Q4"}]
        outs = []
        for r in rows:
            question = r.get("question", "")
            period = r.get("period", "2025-Q4")
            with mlflow.start_span(name="supervisor.predict") as span:
                span.set_attribute("question", question)
                # 1. Cache lookup
                cached = self._cache_lookup(question)
                if cached and cached.get("answer"):
                    outs.append({
                        "agent": "agent_workbench_supervisor",
                        "specialist_key": cached.get("specialist_key", "general"),
                        "text": cached["answer"],
                        "data_sources": cached.get("data_sources", []),
                        "model_used": cached.get("model_used", "cached"),
                        "cached": True, "baked": cached.get("baked", False),
                        "confidence": cached.get("confidence", 1.0),
                        "classifier_reason": cached.get("classifier_reason", "from cache"),
                    })
                    continue
                # 2. Classify
                cls = self._classify(question)
                span.set_attribute("specialist_key", cls["specialist_key"])
                # 3. Invoke specialist (in-process — each is a registered UC agent)
                specialist = self._specialists.get(cls["specialist_key"])
                if specialist is None:
                    # general / genie / unknown — return a clarifying answer
                    outs.append({
                        "agent": "agent_workbench_supervisor",
                        "specialist_key": cls["specialist_key"],
                        "text": (
                            "I'd route this to Genie or general workbench tools, "
                            "but those aren't wired into this agent endpoint yet. "
                            "Try a more specific question — e.g. 'why did property "
                            "reserves move?' or 'what did the cat agent say about Igloo output?'"
                        ),
                        "data_sources": [], "model_used": "supervisor",
                        "cached": False, "baked": False,
                        "confidence": cls["confidence"], "classifier_reason": cls["reason"],
                    })
                    continue
                resp = specialist.predict(context, pd.DataFrame([{"question": question, "period": period}]))
                row = resp.iloc[0].to_dict()
                outs.append({
                    "agent": "agent_workbench_supervisor",
                    "specialist_key": cls["specialist_key"],
                    "text": row["text"],
                    "data_sources": row["data_sources"],
                    "model_used": row["model_used"],
                    "cached": False, "baked": False,
                    "confidence": cls["confidence"], "classifier_reason": cls["reason"],
                })
        return pd.DataFrame(outs)


def _prior_period(period: str) -> str:
    try:
        year, q = period.split("-Q"); y, qn = int(year), int(q)
        return f"{y-1}-Q4" if qn == 1 else f"{y}-Q{qn-1}"
    except Exception:
        return period
''')
print("Wrote agents module")

# COMMAND ----------

# Import the shared module
import importlib.util
spec = importlib.util.spec_from_file_location("workbench_agents", AGENTS_PYFILE)
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
print("Loaded:", [c.__name__ for c in (
    mod.CatAgent, mod.OrsaNarrativeAgent, mod.SeniorReservingAgent,
    mod.SecondOpinionAgent, mod.ReconInvestigatorAgent, mod.DqInvestigatorAgent,
    mod.SupervisorAgent,
)])

# COMMAND ----------

# MAGIC %md ## Log + register each agent in UC

# COMMAND ----------

import pandas as pd
input_example = pd.DataFrame([{"question": "What is outstanding for Q4 close?", "period": "2025-Q4"}])

PIP_REQS = ["mlflow>=2.16", "databricks-sdk", "databricks-sql-connector", "pandas"]
SPECIALIST_CLASSES = {
    "agent_cat_review":         mod.CatAgent,
    "agent_orsa_narrative":     mod.OrsaNarrativeAgent,
    "agent_senior_reserving":   mod.SeniorReservingAgent,
    "agent_second_opinion":     mod.SecondOpinionAgent,
    "agent_recon_investigator": mod.ReconInvestigatorAgent,
    "agent_dq_investigator":    mod.DqInvestigatorAgent,
}

for uc_name, cls in SPECIALIST_CLASSES.items():
    full = f"{catalog}.{schema}.{uc_name}"
    with mlflow.start_run(run_name=uc_name) as run:
        mlflow.pyfunc.log_model(
            artifact_path=uc_name,
            python_model=cls(),
            code_paths=[AGENTS_PYFILE],
            pip_requirements=PIP_REQS,
            input_example=input_example,
            registered_model_name=full,
        )
    print(f"Registered {full}")

# Supervisor
with mlflow.start_run(run_name="agent_workbench_supervisor") as run:
    mlflow.pyfunc.log_model(
        artifact_path="agent_workbench_supervisor",
        python_model=mod.SupervisorAgent(),
        code_paths=[AGENTS_PYFILE],
        pip_requirements=PIP_REQS,
        input_example=input_example,
        registered_model_name=f"{catalog}.{schema}.agent_workbench_supervisor",
    )
print(f"Registered {catalog}.{schema}.agent_workbench_supervisor")

# COMMAND ----------

# MAGIC %md ## Tag latest version of each with @Production alias

# COMMAND ----------

from mlflow.tracking import MlflowClient
client = MlflowClient()
ALL_AGENTS = list(SPECIALIST_CLASSES) + ["agent_workbench_supervisor"]
for name in ALL_AGENTS:
    full = f"{catalog}.{schema}.{name}"
    versions = client.search_model_versions(f"name='{full}'")
    if not versions:
        continue
    latest = max(versions, key=lambda v: int(v.version))
    client.set_registered_model_alias(name=full, alias="Production", version=latest.version)
    print(f"{full} v{latest.version} → @Production")

print("\nAll agents registered + tagged @Production.")

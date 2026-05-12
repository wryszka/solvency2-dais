# Databricks notebook source
# MAGIC %md
# MAGIC # Register AI Agents in Unity Catalog Model Registry
# MAGIC
# MAGIC Registers all 5 agents as MLflow models in Unity Catalog for governance,
# MAGIC versioning, and Mosaic AI integration.
# MAGIC
# MAGIC Each agent is logged as a `pyfunc` model with:
# MAGIC - Agent metadata (name, description, prompt template)
# MAGIC - Input/output signature
# MAGIC - Tags for the Databricks model serving UI
# MAGIC
# MAGIC This enables: version history, promotion (Champion/Challenger), access control,
# MAGIC and Lakehouse Monitoring on agent outputs.

# COMMAND ----------

dbutils.widgets.text("catalog_name", "main")
catalog = dbutils.widgets.get("catalog_name")
schema = "solvency2_workbench"

print(f"Registering agents in: {catalog}.{schema}")

# COMMAND ----------

import mlflow
import mlflow.pyfunc
from mlflow.models.signature import ModelSignature
from mlflow.types import Schema, ColSpec

mlflow.set_registry_uri("databricks-uc")

# Common signature for all agents
input_schema = Schema([
    ColSpec("string", "system_prompt"),
    ColSpec("string", "user_prompt"),
])
output_schema = Schema([
    ColSpec("string", "review_text"),
    ColSpec("string", "model_used"),
    ColSpec("long", "input_tokens"),
    ColSpec("long", "output_tokens"),
])
signature = ModelSignature(inputs=input_schema, outputs=output_schema)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Agent Definitions

# COMMAND ----------

AGENTS = [
    {
        "name": "actuarial_review",
        "description": "Reviews a single QRT and produces a structured actuarial assessment. Compares current vs prior period, checks DQ, flags risk items.",
        "qrts": ["S.06.02", "S.05.01", "S.25.01", "S.26.06"],
        "guardrails": "12 controls: input validation, rate limiting, forbidden patterns, PII detection, required sections, output truncation",
        "model": "Claude Sonnet (preferred) / Llama 70B (fallback)",
    },
    {
        "name": "dq_triage",
        "description": "Investigates data quality failures, hypothesises root causes, and recommends remediation actions with owners.",
        "qrts": ["All pipelines"],
        "guardrails": "Same 12 controls",
        "model": "Claude Sonnet (preferred) / Llama 70B (fallback)",
    },
    {
        "name": "cross_qrt_consistency",
        "description": "Reads all 4 QRT summaries together and validates cross-template consistency with actuarial reasoning.",
        "qrts": ["S.06.02", "S.05.01", "S.25.01", "S.26.06"],
        "guardrails": "Same 12 controls",
        "model": "Claude Sonnet (preferred) / Llama 70B (fallback)",
    },
    {
        "name": "stochastic_engine",
        "description": "Reviews stochastic engine inputs/outputs for S.26.06. Validates exposures, checks VaR/TVaR reasonableness, engine-agnostic.",
        "qrts": ["S.26.06"],
        "guardrails": "Same 12 controls",
        "model": "Claude Sonnet (preferred) / Llama 70B (fallback)",
    },
    {
        "name": "regulator_qa",
        "description": "Solvency II regulatory chatbot. Answers questions, drafts regulator responses, prepares board briefings from QRT data.",
        "qrts": ["All"],
        "guardrails": "Same 12 controls",
        "model": "Claude Sonnet (preferred) / Llama 70B (fallback)",
    },
]

# COMMAND ----------

# MAGIC %md
# MAGIC ## Register Each Agent

# COMMAND ----------

class AgentModel(mlflow.pyfunc.PythonModel):
    """Wrapper for registering agent metadata in UC."""

    def __init__(self, agent_config):
        self.config = agent_config

    def predict(self, context, model_input):
        # This is a metadata-only registration.
        # The actual agent logic runs in the Databricks App.
        return {"status": "Agent runs in Databricks App, not this endpoint",
                "agent": self.config["name"],
                "description": self.config["description"]}


for agent in AGENTS:
    model_name = f"{catalog}.{schema}.agent_{agent['name']}"
    print(f"\nRegistering: {model_name}")

    with mlflow.start_run(run_name=f"register_{agent['name']}"):
        mlflow.log_params({
            "agent_name": agent["name"],
            "description": agent["description"][:250],
            "qrts": ", ".join(agent["qrts"]),
            "model": agent["model"],
            "guardrails": agent["guardrails"][:250],
            "framework": "Databricks Apps + Foundation Model API",
        })

        mlflow.pyfunc.log_model(
            artifact_path="agent",
            python_model=AgentModel(agent),
            signature=signature,
            registered_model_name=model_name,
        )

    # Set alias
    client = mlflow.MlflowClient()
    versions = client.search_model_versions(f"name='{model_name}'")
    if versions:
        latest = max(versions, key=lambda v: int(v.version))
        client.set_registered_model_alias(model_name, "Production", latest.version)
        print(f"  Registered v{latest.version} with Production alias")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify Registration

# COMMAND ----------

print(f"\n{'='*60}")
print(f"Registered agents in {catalog}.{schema}:")
print(f"{'='*60}")

client = mlflow.MlflowClient()
for agent in AGENTS:
    model_name = f"{catalog}.{schema}.agent_{agent['name']}"
    try:
        versions = client.search_model_versions(f"name='{model_name}'")
        latest = max(versions, key=lambda v: int(v.version)) if versions else None
        aliases = latest.aliases if latest and hasattr(latest, 'aliases') else []
        print(f"\n  {agent['name']}:")
        print(f"    Model: {model_name}")
        print(f"    Version: {latest.version if latest else '?'}")
        print(f"    Aliases: {', '.join(aliases) if aliases else 'none'}")
        print(f"    Status: {latest.status if latest else '?'}")
    except Exception as e:
        print(f"\n  {agent['name']}: ERROR — {e}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## What This Gives Us
# MAGIC
# MAGIC Each agent is now a **registered model in Unity Catalog**:
# MAGIC
# MAGIC - **Version history** — every change to agent config is tracked
# MAGIC - **Aliases** — Production/Staging/Development lifecycle
# MAGIC - **Access control** — who can query which agent
# MAGIC - **Lineage** — which tables the agent reads, which it writes
# MAGIC - **Monitoring** — Lakehouse Monitoring on the `6_ai_reviews` output table
# MAGIC
# MAGIC The actual agent execution still runs in the Databricks App (FastAPI),
# MAGIC but the registration gives us the governance story for Mosaic AI.

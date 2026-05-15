# Databricks notebook source
# MAGIC %md
# MAGIC # Deploy the supervisor as a Model Serving endpoint
# MAGIC
# MAGIC Creates (or updates) a serving endpoint named `workbench-supervisor` that
# MAGIC serves `{catalog}.{schema}.agent_workbench_supervisor@Production` with
# MAGIC scale-to-zero. The app's `/api/supervisor/route` proxies to this
# MAGIC endpoint when `SUPERVISOR_ENDPOINT_NAME` is set.
# MAGIC
# MAGIC Idempotent — re-running rolls the served entity to the latest model
# MAGIC version (still aliased @Production).

# COMMAND ----------

dbutils.widgets.text("catalog_name",   "lr_dev_aws_us_catalog", "Catalog")
dbutils.widgets.text("schema_name",    "solvency2_workbench",   "Schema")
dbutils.widgets.text("endpoint_name",  "workbench-supervisor",  "Endpoint name")
dbutils.widgets.text("workload_size",  "Small",                 "Workload size")
dbutils.widgets.text("fm_endpoint",    "databricks-claude-sonnet-4", "FM endpoint env-var")
dbutils.widgets.text("warehouse_http_path", "/sql/1.0/warehouses/a3b61648ea4809e3", "Warehouse HTTP path")

catalog   = dbutils.widgets.get("catalog_name")
schema    = dbutils.widgets.get("schema_name")
endpoint  = dbutils.widgets.get("endpoint_name")
size      = dbutils.widgets.get("workload_size")
fm_ep     = dbutils.widgets.get("fm_endpoint")
wh_path   = dbutils.widgets.get("warehouse_http_path")
full_model = f"{catalog}.{schema}.agent_workbench_supervisor"
print(f"Deploying {endpoint} from {full_model}@Production (size={size})")

# COMMAND ----------

# MAGIC %pip install -q databricks-sdk mlflow>=2.16
# dbutils.library.restartPython()

# COMMAND ----------

import time
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import (
    EndpointCoreConfigInput, ServedEntityInput,
)
from mlflow.tracking import MlflowClient

w = WorkspaceClient()
mc = MlflowClient(registry_uri="databricks-uc")

# Resolve the @Production version number (serving APIs want the version string)
versions = mc.search_model_versions(f"name='{full_model}'")
if not versions:
    raise RuntimeError(f"No registered versions for {full_model}. Run register_agents first.")
latest = max(versions, key=lambda v: int(v.version))
print(f"Serving {full_model} v{latest.version}")

served_entity = ServedEntityInput(
    name="supervisor",
    entity_name=full_model,
    entity_version=latest.version,
    workload_size=size,
    scale_to_zero_enabled=True,
    environment_vars={
        "CATALOG_NAME":       catalog,
        "SCHEMA_NAME":        schema,
        "FM_ENDPOINT":        fm_ep,
        "WAREHOUSE_HTTP_PATH": wh_path,
    },
)
config = EndpointCoreConfigInput(name=endpoint, served_entities=[served_entity])

existing = None
try:
    existing = w.serving_endpoints.get(endpoint)
except Exception:
    existing = None

if existing:
    print(f"Endpoint {endpoint} exists — updating config…")
    w.serving_endpoints.update_config(name=endpoint, served_entities=[served_entity])
else:
    print(f"Creating endpoint {endpoint}…")
    w.serving_endpoints.create(name=endpoint, config=config)

# Poll briefly for visibility, but don't block forever
for _ in range(6):
    ep = w.serving_endpoints.get(endpoint)
    ready = ep.state and ep.state.ready
    print(f"  state: {ready}")
    if str(ready) in ("READY", "EndpointStateReady.READY"):
        break
    time.sleep(15)

print(f"\nEndpoint {endpoint} is provisioned. Set SUPERVISOR_ENDPOINT_NAME={endpoint} in app.yaml.")

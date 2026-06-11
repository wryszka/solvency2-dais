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

# Pin the @Production alias to the served version so the served entity and any
# alias-based reference are deterministic.
try:
    mc.set_registered_model_alias(full_model, "Production", int(latest.version))
    print(f"Set alias @Production -> v{latest.version}")
except Exception as _e:
    print(f"(could not set @Production alias: {_e})")

# Inject Databricks auth from the notebook's runtime context so the pyfunc's
# WorkspaceClient() can call FM API endpoints + SQL warehouse from inside the
# serving container. (Model Serving doesn't expose DATABRICKS_TOKEN by default.)
ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
auth_host  = ctx.apiUrl().get()
auth_token = ctx.apiToken().get()
print(f"Injecting auth: host={auth_host[:40]}…, token=***{auth_token[-6:] if auth_token else ''}")

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
        "DATABRICKS_HOST":    auth_host,
        "DATABRICKS_TOKEN":   auth_token,
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

# Wait for READY and FAIL the job if the build doesn't come up. The old code
# polled for 90s then printed success regardless — so the task went green while
# the container build failed asynchronously, leaving no live endpoint. Block on
# the real terminal state instead (serving builds take 5–20 min from cold).
DEADLINE_MIN = 30
POLL_SECS = 20
elapsed = 0
final_ready = None
final_cfg = None
while elapsed < DEADLINE_MIN * 60:
    ep = w.serving_endpoints.get(endpoint)
    st = ep.state
    final_ready = str(st.ready) if st and st.ready is not None else None
    final_cfg = str(st.config_update) if st and st.config_update is not None else None
    print(f"  [{elapsed//60}m{elapsed%60:02d}s] ready={final_ready} config_update={final_cfg}")
    if final_ready in ("READY", "EndpointStateReady.READY"):
        break
    # Surface a failed build immediately rather than waiting out the deadline.
    if final_cfg and "FAILED" in final_cfg:
        # Pull the most recent build/update logs for the served entity.
        try:
            logs = w.serving_endpoints.get_open_api(endpoint)  # best-effort; not all SDKs
            print("  build logs:", str(logs)[:1000])
        except Exception:
            pass
        raise RuntimeError(
            f"Endpoint {endpoint} config update FAILED (config_update={final_cfg}). "
            f"Check the serving endpoint build logs in the workspace UI."
        )
    time.sleep(POLL_SECS)
    elapsed += POLL_SECS

if final_ready not in ("READY", "EndpointStateReady.READY"):
    raise RuntimeError(
        f"Endpoint {endpoint} did not reach READY within {DEADLINE_MIN} min "
        f"(last ready={final_ready}, config_update={final_cfg}). Failing the job so "
        f"this isn't silently reported as success."
    )

print(f"\n✓ Endpoint {endpoint} is READY and serving {full_model} v{latest.version}.")
print(f"  Set SUPERVISOR_ENDPOINT_NAME={endpoint} in app.yaml (already wired in databricks.yml).")

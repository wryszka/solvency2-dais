#!/usr/bin/env bash
# ============================================================================
# Deploy Actuarial Workbench (Solvency II demo) end-to-end.
#
# Single-command flow. Idempotent — safe to re-run for healing.
#
# Usage:
#   bash deploy_demo.sh                                   # uses dev target defaults
#   bash deploy_demo.sh --target prod                     # different target
#   bash deploy_demo.sh --catalog X --schema Y \
#                        --warehouse Z --profile P        # override per-flag
#
# What it does, in order:
#   1. Validate prerequisites (CLI, profile, FM endpoint)
#   2. databricks bundle deploy — uploads notebooks, creates volumes, app, jobs
#   3. databricks bundle run governance_setup — registers MLflow models + seeds gov tables
#   4. Deploy Lakeview dashboard (idempotent)
#   5. Deploy Genie space (idempotent via scripts/deploy_genie_space.py)
#   6. Re-deploy bundle with dashboard_id + genie_space_id as bundle vars
#   7. Apply remaining grants to app service principal
#   8. Print URLs
# ============================================================================

set -euo pipefail

# ── Args ──
TARGET="${BUNDLE_TARGET:-dev}"
CATALOG=""
SCHEMA=""
WAREHOUSE=""
PROFILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)    TARGET="$2"; shift 2;;
        --catalog)   CATALOG="$2"; shift 2;;
        --schema)    SCHEMA="$2"; shift 2;;
        --warehouse) WAREHOUSE="$2"; shift 2;;
        --profile)   PROFILE="$2"; shift 2;;
        -h|--help)
            grep '^#' "$0" | head -25; exit 0;;
        *) echo "Unknown arg: $1"; exit 2;;
    esac
done

# Read the target's defaults from databricks.yml so script defaults track the
# bundle. We resolve via `databricks bundle validate -o json` and parse.
echo "==> Resolving target '$TARGET' from databricks.yml…"
RESOLVED=$(databricks bundle validate -t "$TARGET" -o json 2>/dev/null || true)
[[ -z "$CATALOG" ]]   && CATALOG=$(echo "$RESOLVED"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('variables',{}).get('catalog_name',{}).get('value',''))" 2>/dev/null || echo "")
[[ -z "$SCHEMA" ]]    && SCHEMA=$(echo "$RESOLVED"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('variables',{}).get('schema_name',{}).get('value',''))" 2>/dev/null || echo "")
[[ -z "$WAREHOUSE" ]] && WAREHOUSE=$(echo "$RESOLVED" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('variables',{}).get('warehouse_id',{}).get('value',''))" 2>/dev/null || echo "")
[[ -z "$PROFILE" ]]   && PROFILE=$(echo "$RESOLVED"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('variables',{}).get('databricks_profile',{}).get('value',''))" 2>/dev/null || echo "DEFAULT")
APP_NAME=$(echo "$RESOLVED"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('variables',{}).get('app_name',{}).get('value',''))" 2>/dev/null || echo "actuarial-workbench")

[[ -z "$CATALOG" ]] && { echo "ERROR: catalog not resolved. Pass --catalog explicitly."; exit 1; }
[[ -z "$SCHEMA" ]]  && { echo "ERROR: schema not resolved. Pass --schema explicitly."; exit 1; }

echo "    catalog:   $CATALOG"
echo "    schema:    $SCHEMA"
echo "    warehouse: $WAREHOUSE"
echo "    profile:   $PROFILE"
echo "    app_name:  $APP_NAME"
echo "    target:    $TARGET"
echo

# Export for child scripts
export CATALOG SCHEMA WAREHOUSE_ID="$WAREHOUSE" APP_NAME DATABRICKS_PROFILE="$PROFILE"

# ── 1. Validate prerequisites ──
echo "==> 1/8  Validating prerequisites…"
command -v databricks >/dev/null || { echo "  databricks CLI not found"; exit 1; }
databricks current-user me --profile "$PROFILE" >/dev/null \
    || { echo "  Profile $PROFILE not authenticated. Run: databricks auth login --profile $PROFILE"; exit 1; }
echo "    ✓ CLI authenticated"

# Verify the catalog exists — the bundle creates schemas/tables/MVs inside,
# but the catalog itself is a workspace-governance decision and must exist
# beforehand. Fail loud with a copy-paste resolution.
if ! databricks api post /api/2.0/sql/statements --profile "$PROFILE" --json "{
    \"warehouse_id\": \"$WAREHOUSE\",
    \"statement\": \"DESCRIBE CATALOG \\\`$CATALOG\\\`\",
    \"wait_timeout\": \"15s\"
}" >/dev/null 2>&1; then
    echo
    echo "    ✗ Catalog '$CATALOG' not accessible."
    echo "      Either it does not exist, or you lack USE CATALOG."
    echo
    echo "      To create the catalog (if you have CREATE CATALOG):"
    echo "        databricks catalogs create --name $CATALOG --profile $PROFILE"
    echo
    echo "      To grant USE CATALOG to yourself:"
    echo "        databricks api post /api/2.1/unity-catalog/permissions/catalog/$CATALOG \\"
    echo "          --profile $PROFILE --json '{\"changes\":[{\"principal\":\"<you>\",\"add\":[\"USE CATALOG\"]}]}'"
    echo
    exit 1
fi
echo "    ✓ Catalog '$CATALOG' accessible"

# Schema gets auto-created by the first bundle resource that needs it, but
# verify the user has CREATE SCHEMA up-front to fail fast otherwise.
databricks api post /api/2.0/sql/statements --profile "$PROFILE" --json "{
    \"warehouse_id\": \"$WAREHOUSE\",
    \"statement\": \"CREATE SCHEMA IF NOT EXISTS \\\`$CATALOG\\\`.\\\`$SCHEMA\\\`\",
    \"wait_timeout\": \"15s\"
}" >/dev/null 2>&1 \
    && echo "    ✓ Schema '$SCHEMA' present (or created)" \
    || { echo "    ✗ Cannot create schema '$SCHEMA' in catalog '$CATALOG' — check CREATE SCHEMA grant"; exit 1; }

# ── 2. Bundle deploy ──
echo "==> 2/9  Bundle deploy ($TARGET)…"
databricks bundle deploy -t "$TARGET" --profile "$PROFILE" \
    --var "catalog_name=$CATALOG" \
    --var "schema_name=$SCHEMA" \
    --var "warehouse_id=$WAREHOUSE"
echo "    ✓ bundle deployed"

# ── 2b. Volumes (idempotent CREATE IF NOT EXISTS — bundle doesn't support adoption of pre-existing volumes) ──
echo "==> 2b/9  Ensuring UC volumes…"
for vol in regulatory_exports "4_eng_stochastic_exchange" "4_eng_life_exchange"; do
    databricks api post /api/2.0/sql/statements --profile "$PROFILE" --json "{
        \"warehouse_id\": \"$WAREHOUSE\",
        \"statement\": \"CREATE VOLUME IF NOT EXISTS \\\`$CATALOG\\\`.\\\`$SCHEMA\\\`.\\\`$vol\\\`\",
        \"wait_timeout\": \"30s\"
    }" >/dev/null 2>&1 \
        && echo "    ✓ $vol" \
        || echo "    (warn: failed to ensure $vol — continuing)"
done

# ── 2c. Resolve app.yaml templates ──
#
# Databricks Apps does NOT interpret ${var.X} in app.yaml env values — it's
# bundle templating, and the bundle only substitutes for declared `apps:`
# resources (which we don't have yet — Apps resource support in DABs is
# still maturing). Without this step, the deployed app's env vars contain
# literal "${var.warehouse_id}" strings and every SQL call fails with
# `InvalidParameterValue: ${var.warehouse_id} is not a valid endpoint id`.
echo "==> 2c/9  Resolving app.yaml templates and uploading resolved copy…"
USERNAME_FROM_PROFILE=$(databricks current-user me --profile "$PROFILE" -o json | python3 -c "import sys,json; print(json.load(sys.stdin).get('userName',''))")
BUNDLE_NAME=$(echo "$RESOLVED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('bundle',{}).get('name',''))" 2>/dev/null || echo "solvency2_workbench")
APP_YAML_PATH="/Workspace/Users/$USERNAME_FROM_PROFILE/.bundle/$BUNDLE_NAME/$TARGET/files/src/app/app.yaml"
RESOLVED_APP_YAML=$(mktemp)
sed \
  -e "s|\${var.catalog_name}|$CATALOG|g" \
  -e "s|\${var.schema_name}|$SCHEMA|g" \
  -e "s|\${var.warehouse_id}|$WAREHOUSE|g" \
  -e "s|\${var.app_display_name}|Actuarial Workbench|g" \
  -e "s|\${var.dashboard_id}||g" \
  -e "s|\${var.genie_space_id}||g" \
  -e "s|\${var.backstage_notebook_path}||g" \
  -e "s|\${var.pricing_app_url}||g" \
  -e "s|\${var.fm_model_endpoints}||g" \
  src/app/app.yaml > "$RESOLVED_APP_YAML"
databricks workspace import "$APP_YAML_PATH" --format AUTO --file "$RESOLVED_APP_YAML" --overwrite --profile "$PROFILE" 2>&1 | tail -1
rm -f "$RESOLVED_APP_YAML"
echo "    ✓ app.yaml resolved at $APP_YAML_PATH"

# ── 3. Bundle run: governance + seed (idempotent — register notebooks skip if already registered) ──
echo "==> 3/8  Running governance_setup job (registers MLflow models, seeds governance + Phase 5 tables)…"
databricks bundle run governance_setup -t "$TARGET" --profile "$PROFILE" 2>&1 | tail -3
echo "    ✓ governance + seed complete"

# ── 4. Lakeview dashboard ──
DASHBOARD_ID=""
if [[ -f scripts/create_dashboard_v2.py ]]; then
    echo "==> 4/8  Lakeview dashboard (idempotent)…"
    DASHBOARD_OUT=$(python3 scripts/create_dashboard_v2.py 2>&1 || true)
    DASHBOARD_ID=$(echo "$DASHBOARD_OUT" | grep -oE '[a-f0-9]{32}' | head -1 || echo "")
    if [[ -n "$DASHBOARD_ID" ]]; then
        echo "    ✓ dashboard $DASHBOARD_ID"
    else
        echo "    (dashboard create skipped or failed — see scripts/create_dashboard_v2.py output)"
    fi
else
    echo "==> 4/8  scripts/create_dashboard_v2.py not present — skipping dashboard"
fi

# ── 5. Genie space ──
GENIE_ID=""
USERNAME=$(databricks current-user me --profile "$PROFILE" -o json | python3 -c "import sys,json; print(json.load(sys.stdin).get('userName',''))")
if [[ -f scripts/deploy_genie_space.py && -n "$USERNAME" ]]; then
    echo "==> 5/8  Genie space (idempotent)…"
    GENIE_ID=$(python3 scripts/deploy_genie_space.py \
        --profile "$PROFILE" --catalog "$CATALOG" --schema "$SCHEMA" \
        --warehouse "$WAREHOUSE" --parent "/Workspace/Users/$USERNAME" 2>/dev/null || echo "")
    if [[ -n "$GENIE_ID" ]]; then
        echo "    ✓ Genie space $GENIE_ID"
    else
        echo "    (Genie create returned no ID — workspace may not have Genie permissions)"
    fi
else
    echo "==> 5/8  Genie deploy script or username missing — skipping Genie"
fi

# ── 6. Re-deploy bundle with dashboard_id + genie_space_id baked in ──
if [[ -n "$DASHBOARD_ID" || -n "$GENIE_ID" ]]; then
    echo "==> 6/8  Re-deploying bundle with runtime resource IDs…"
    databricks bundle deploy -t "$TARGET" --profile "$PROFILE" \
        --var "catalog_name=$CATALOG" \
        --var "schema_name=$SCHEMA" \
        --var "warehouse_id=$WAREHOUSE" \
        --var "dashboard_id=$DASHBOARD_ID" \
        --var "genie_space_id=$GENIE_ID"
    # The app resource was deployed in step 2 with empty IDs; redeploying the
    # bundle propagates the new env var values into app.yaml automatically.
    echo "    ✓ bundle re-deployed with dashboard_id=$DASHBOARD_ID genie_space_id=$GENIE_ID"
else
    echo "==> 6/8  No dashboard / Genie IDs — skipping re-deploy"
fi

# ── 7. App service principal grants ──
echo "==> 7/8  Applying app service-principal grants (fail loud on error)…"
APP_SP=$(databricks apps get "$APP_NAME" --profile "$PROFILE" -o json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('service_principal_client_id',''))" 2>/dev/null || echo "")
if [[ -n "$APP_SP" ]]; then
    echo "    Granting USE CATALOG / ALL PRIVILEGES ON SCHEMA / CAN_USE warehouse to SP $APP_SP…"
    databricks api post /api/2.0/sql/statements --profile "$PROFILE" --json "{
        \"warehouse_id\": \"$WAREHOUSE\",
        \"statement\": \"GRANT USE CATALOG ON CATALOG \\\`$CATALOG\\\` TO \\\`$APP_SP\\\`\",
        \"wait_timeout\": \"30s\"
    }" >/dev/null || { echo "    GRANT USE CATALOG failed"; exit 1; }
    databricks api post /api/2.0/sql/statements --profile "$PROFILE" --json "{
        \"warehouse_id\": \"$WAREHOUSE\",
        \"statement\": \"GRANT ALL PRIVILEGES ON SCHEMA \\\`$CATALOG\\\`.\\\`$SCHEMA\\\` TO \\\`$APP_SP\\\`\",
        \"wait_timeout\": \"30s\"
    }" >/dev/null || { echo "    GRANT ALL PRIVILEGES failed"; exit 1; }
    databricks api patch "/api/2.0/permissions/sql/warehouses/$WAREHOUSE" --profile "$PROFILE" --json "{
        \"access_control_list\": [{
            \"service_principal_name\": \"$APP_SP\",
            \"permission_level\": \"CAN_USE\"
        }]
    }" >/dev/null || { echo "    Warehouse permission grant failed"; exit 1; }
    echo "    ✓ grants applied"
else
    echo "    (App SP not yet known — app may not be deployed; grants skipped)"
fi

# ── 8. Final URLs ──
echo "==> 8/8  Final URLs"
APP_URL=$(databricks apps get "$APP_NAME" --profile "$PROFILE" -o json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
WS_HOST=$(databricks current-user me --profile "$PROFILE" -o json 2>/dev/null \
    | python3 -c "import sys,json; print('https://' + json.load(sys.stdin).get('userName','').split('@')[1]) if False else None; print('')" || echo "")

echo
echo "============================================================================"
echo "  DEPLOY COMPLETE"
echo "============================================================================"
[[ -n "$APP_URL" ]]      && echo "  App:        $APP_URL"
[[ -n "$DASHBOARD_ID" ]] && echo "  Dashboard:  $DASHBOARD_ID"
[[ -n "$GENIE_ID" ]]     && echo "  Genie:      $GENIE_ID"
echo "  Catalog:    $CATALOG"
echo "  Schema:     $SCHEMA"
echo
echo "  Next: bash scripts/preflight_check.sh --profile $PROFILE"
echo "============================================================================"

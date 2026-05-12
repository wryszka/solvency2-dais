#!/usr/bin/env bash
# ============================================================================
# Remove Solvency II QRT Demo (Agentic)
#
# Deletes all demo assets: schema + tables, DLT pipelines, jobs, app,
# workspace folder, and DAB bundle state.
#
# Usage:
#   bash remove_demo.sh --catalog YOUR_CATALOG
#   bash remove_demo.sh --catalog YOUR_CATALOG --profile STAGING
# ============================================================================

set -euo pipefail

PROFILE="${DATABRICKS_PROFILE:-DEV}"
CATALOG=""
SCHEMA="solvency2demo_v2"
WORKSPACE_DIR=""
WAREHOUSE_ID=""
SKIP_CONFIRM=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --profile)  PROFILE="$2"; shift 2 ;;
        --catalog)  CATALOG="$2"; shift 2 ;;
        --schema)   SCHEMA="$2"; shift 2 ;;
        --folder)   WORKSPACE_DIR="$2"; shift 2 ;;
        --yes)      SKIP_CONFIRM="true"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ -z "$CATALOG" ]]; then
    echo "ERROR: --catalog is required."
    echo ""
    echo "Usage: bash remove_demo.sh --catalog YOUR_CATALOG"
    exit 1
fi

# Auto-detect workspace folder
if [[ -z "$WORKSPACE_DIR" ]]; then
    USERNAME=$(databricks current-user me --profile "$PROFILE" -o json 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])" 2>/dev/null || echo "unknown")
    WORKSPACE_DIR="/Workspace/Users/${USERNAME}/solvency-ii-qrt-demo-agentic"
fi

echo "============================================================================"
echo "  This will DELETE the following:"
echo "============================================================================"
echo ""
echo "  Schema:    $CATALOG.$SCHEMA (all tables)"
echo "  Folder:    $WORKSPACE_DIR"
echo "  App:       solvency2-qrt-ai"
echo "  Pipelines: All [dev *] QRT pipelines"
echo "  Jobs:      All [dev *] QRT jobs"
echo "  Bundle:    .databricks/ local state"
echo ""

if [[ -z "$SKIP_CONFIRM" ]]; then
    read -p "  Are you sure? (yes/no): " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        echo "  Aborted."
        exit 0
    fi
fi

echo ""

# 1. Drop schema (CASCADE deletes all tables)
echo ">> Dropping schema $CATALOG.$SCHEMA..."
databricks api post /api/2.0/sql/statements --json "{
    \"warehouse_id\": \"$WAREHOUSE_ID\",
    \"statement\": \"DROP SCHEMA IF EXISTS $CATALOG.$SCHEMA CASCADE\",
    \"wait_timeout\": \"30s\"
}" --profile "$PROFILE" 2>/dev/null && echo "   Schema dropped." || echo "   Schema drop failed (may not exist)."

# 2. Delete workspace folder
echo ">> Deleting workspace folder..."
databricks workspace delete "$WORKSPACE_DIR" --recursive --profile "$PROFILE" 2>/dev/null \
    && echo "   Folder deleted." || echo "   Folder not found."

# 3. Delete the app
echo ">> Deleting app..."
databricks apps delete solvency2-qrt-ai --profile "$PROFILE" 2>/dev/null \
    && echo "   App deleted." || echo "   App not found."

# 4. Destroy DAB bundle (removes pipelines and jobs)
echo ">> Destroying DAB bundle..."
databricks bundle destroy --profile "$PROFILE" --auto-approve 2>&1 \
    | while read -r line; do echo "   $line"; done \
    || echo "   Bundle destroy failed (may not exist)."

# 5. Clean local state
echo ">> Cleaning local bundle state..."
rm -rf .databricks/bundle 2>/dev/null
echo "   Local state cleaned."

echo ""
echo "============================================================================"
echo "  REMOVAL COMPLETE"
echo "============================================================================"
echo ""
echo "  All demo assets have been removed."
echo "  To redeploy: bash deploy_demo.sh --catalog $CATALOG"
echo "============================================================================"

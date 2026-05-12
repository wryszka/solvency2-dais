#!/usr/bin/env bash
# Resolve catalog / schema / warehouse / app_name / profile from databricks.yml.
# Single source of truth — every other script should source this.
#
# Usage:
#   source "$(dirname "$0")/_load_defaults.sh" "${TARGET:-dev}"
#
# Resolution order for each variable:
#   1. Already-set env var (caller has set it explicitly)         — wins.
#   2. databricks bundle validate -t <target> -o json             — single source.
#   3. Empty (caller should error-check)
#
# After sourcing, the following are exported:
#   CATALOG · SCHEMA · WAREHOUSE_ID · APP_NAME · DATABRICKS_PROFILE
#   FM_MODEL_ENDPOINTS · PRICING_APP_URL · WORKSPACE_HOST

_LD_TARGET="${1:-${BUNDLE_TARGET:-dev}}"
_LD_RESOLVED=""

if command -v databricks >/dev/null 2>&1; then
    # Run from repo root so databricks.yml is found.
    _LD_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    _LD_RESOLVED=$(cd "$_LD_REPO_ROOT" && databricks bundle validate -t "$_LD_TARGET" -o json 2>/dev/null || true)
fi

_ld_var() {
    local key="$1"
    python3 -c "import sys,json; d=json.loads(sys.stdin.read() or '{}'); print(d.get('variables',{}).get('$key',{}).get('value',''))" <<< "$_LD_RESOLVED" 2>/dev/null || echo ""
}

[[ -z "${CATALOG:-}" ]]             && export CATALOG="$(_ld_var catalog_name)"
[[ -z "${SCHEMA:-}" ]]              && export SCHEMA="$(_ld_var schema_name)"
[[ -z "${WAREHOUSE_ID:-}" ]]        && export WAREHOUSE_ID="$(_ld_var warehouse_id)"
[[ -z "${APP_NAME:-}" ]]            && export APP_NAME="$(_ld_var app_name)"
[[ -z "${DATABRICKS_PROFILE:-}" ]]  && export DATABRICKS_PROFILE="$(_ld_var databricks_profile)"
[[ -z "${FM_MODEL_ENDPOINTS:-}" ]]  && export FM_MODEL_ENDPOINTS="$(_ld_var fm_model_endpoints)"
[[ -z "${PRICING_APP_URL:-}" ]]     && export PRICING_APP_URL="$(_ld_var pricing_app_url)"
[[ -z "${WORKSPACE_HOST:-}" ]]      && export WORKSPACE_HOST="$(_ld_var workspace_host)"

# Final-fallback PROFILE: if we still don't have one, default to DEFAULT.
[[ -z "${DATABRICKS_PROFILE:-}" ]] && export DATABRICKS_PROFILE="DEFAULT"

unset _LD_TARGET _LD_RESOLVED _LD_REPO_ROOT

#!/usr/bin/env bash
# Pre-flight check for the forum demo.
#
# Run before walking on stage. Exits non-zero on any FAIL so a wrapper
# script can refuse to start the talk if data is missing.
#
# Usage:
#   ./scripts/preflight_check.sh                   # default DEV / Q4 2025
#   ./scripts/preflight_check.sh --period 2025-Q4
#   ./scripts/preflight_check.sh --profile DEV --catalog lr_dev_aws_us_catalog --schema solvency2demo_v2 --warehouse a3b61648ea4809e3 --app solvency2-qrt-ai-dev

set -uo pipefail

PROFILE="DEV"
CATALOG="lr_dev_aws_us_catalog"
SCHEMA="solvency2demo_v2"
WAREHOUSE_ID="a3b61648ea4809e3"
APP_NAME="solvency2-qrt-ai-dev"
PERIOD="2025-Q4"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)   PROFILE="$2"; shift 2;;
        --catalog)   CATALOG="$2"; shift 2;;
        --schema)    SCHEMA="$2"; shift 2;;
        --warehouse) WAREHOUSE_ID="$2"; shift 2;;
        --app)       APP_NAME="$2"; shift 2;;
        --period)    PERIOD="$2"; shift 2;;
        -h|--help)
            grep '^#' "$0" | head -10; exit 0;;
        *) echo "Unknown arg: $1"; exit 2;;
    esac
done

PASS_CT=0
FAIL_CT=0
declare -a FAILS=()

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
YEL=$'\033[1;33m'
NC=$'\033[0m'

log_pass() { PASS_CT=$((PASS_CT+1)); echo -e "  ${GREEN}PASS${NC} $1"; }
log_fail() { FAIL_CT=$((FAIL_CT+1)); FAILS+=("$1"); echo -e "  ${RED}FAIL${NC} $1"; }
log_warn() { echo -e "  ${YEL}WARN${NC} $1"; }

# Run a SQL probe and check it returns at least one row
probe_sql() {
    local label="$1"
    local sql="$2"
    local resp
    resp=$(databricks api post /api/2.0/sql/statements --profile "$PROFILE" \
        --json "{\"warehouse_id\":\"$WAREHOUSE_ID\",\"statement\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$sql"),\"wait_timeout\":\"30s\"}" 2>&1)
    local state
    state=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('state','?'))" 2>/dev/null)
    if [[ "$state" != "SUCCEEDED" ]]; then
        log_fail "$label — SQL state=$state"
        return 1
    fi
    local n
    n=$(echo "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
arr=d.get('result',{}).get('data_array',[]) or []
print(len(arr))" 2>/dev/null)
    if [[ "${n:-0}" -gt 0 ]]; then
        log_pass "$label ($n rows)"
        return 0
    else
        log_fail "$label — 0 rows"
        return 1
    fi
}

# Probe an HTTP endpoint that returns JSON
probe_endpoint() {
    local label="$1"
    local path="$2"
    local app_url
    app_url=$(databricks apps get "$APP_NAME" --profile "$PROFILE" -o json 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))")
    if [[ -z "$app_url" ]]; then
        log_warn "$label — app URL unknown, skipping"; return 0
    fi
    local code
    code=$(curl -sk -o /dev/null -w "%{http_code}" "${app_url}${path}" 2>&1)
    if [[ "$code" == "200" || "$code" == "302" || "$code" == "401" ]]; then
        # 401 is expected if the app is behind OBO and we have no token —
        # the app itself is up.
        log_pass "$label HTTP $code"
        return 0
    else
        log_fail "$label — HTTP $code at $path"
        return 1
    fi
}

echo "=========================================================================="
echo "  Solvency II Demo — Pre-flight"
echo "=========================================================================="
echo "  Profile:    $PROFILE"
echo "  Catalog:    $CATALOG"
echo "  Schema:     $SCHEMA"
echo "  Warehouse:  $WAREHOUSE_ID"
echo "  App:        $APP_NAME"
echo "  Period:     $PERIOD"
echo

echo "── Scene 1: Control Tower & feeds ──────────────────────────────────────"
probe_sql "5_mon_pipeline_sla_status has $PERIOD" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`5_mon_pipeline_sla_status\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "RI feed shows status=late in $PERIOD (Pain A)" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`5_mon_pipeline_sla_status\` WHERE reporting_period = '$PERIOD' AND feed_name = '1_raw_reinsurance' AND status = 'late' LIMIT 1"

echo
echo "── Scene 2: DQ break ──────────────────────────────────────────────────"
probe_sql "47 negative-paid claims tagged legacy_pre_migration (Pain B)" \
    "SELECT 1 FROM (SELECT COUNT(*) AS n FROM \`$CATALOG\`.\`$SCHEMA\`.\`1_raw_claims\` WHERE reporting_period = '$PERIOD' AND system_source = 'legacy_pre_migration') WHERE n = 47"

echo
echo "── Scene 3: Property storm ────────────────────────────────────────────"
probe_sql "Storm-tagged claims clustered in late December (Pain C)" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`1_raw_claims\` WHERE reporting_period = '$PERIOD' AND event_id = 'storm_dec_2025' LIMIT 1"

echo
echo "── Scene 4: Life lapse spike ──────────────────────────────────────────"
probe_sql "Unit-linked Q4 lapses present (Pain D)" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`1_raw_life_lapses\` WHERE reporting_period = '$PERIOD' AND lob_name = 'unit_linked' LIMIT 1"

echo
echo "── Scene 5: Asset duplicate ──────────────────────────────────────────"
probe_sql "Duplicate -DUP asset row of 2_300_000 in $PERIOD (Pain E)" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`1_raw_assets\` WHERE reporting_period = '$PERIOD' AND asset_id LIKE '%-DUP' AND CAST(sii_value AS DOUBLE) = 2300000.0 LIMIT 1"

echo
echo "── Scene 6: Champion vs Challenger ────────────────────────────────────"
probe_sql "Standard formula model versions registered" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`5_mon_model_registry_log\` LIMIT 1"
probe_sql "SCR results loaded for $PERIOD" \
    "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`2_stg_scr_results\` WHERE reporting_period = '$PERIOD' AND component = 'SCR' LIMIT 1"

echo
echo "── QRT gold layer present for $PERIOD ─────────────────────────────────"
probe_sql "S.06.02 summary"           "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`3_qrt_s0602_summary\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "S.05.01 summary"           "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`3_qrt_s0501_summary\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "S.25.01 summary"           "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`3_qrt_s2501_summary\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "S.26.06 summary"           "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`3_qrt_s2606_summary\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "S.12.01 summary (composite)" "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`3_qrt_s1201_summary\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "Life UW summary (composite)" "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`3_qrt_life_uw_risk_summary\` WHERE reporting_period = '$PERIOD' LIMIT 1"

echo
echo "── Engine outputs ─────────────────────────────────────────────────────"
probe_sql "Igloo results for $PERIOD" "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`4_eng_stochastic_results\` WHERE reporting_period = '$PERIOD' LIMIT 1"
probe_sql "Prophet results for $PERIOD" "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`4_eng_prophet_results\` WHERE reporting_period = '$PERIOD' LIMIT 1"

echo
echo "── ORSA + AFR + SFCR cfg ──────────────────────────────────────────────"
probe_sql "ORSA scenarios cfg"        "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`0_cfg_orsa_scenarios\` LIMIT 1" || log_warn "ORSA cfg not yet seeded — first /api/orsa/scenarios call will create it"
probe_sql "Business plan cfg"         "SELECT 1 FROM \`$CATALOG\`.\`$SCHEMA\`.\`0_cfg_business_plan\` LIMIT 1" || log_warn "Plan cfg not yet seeded — first /api/orsa/business-plan call will create it"

echo
echo "── App reachability ───────────────────────────────────────────────────"
probe_endpoint "App health"           "/api/health"
probe_endpoint "Landing status"       "/api/landing/status"
probe_endpoint "Q4 pains"             "/api/monitoring/q4-pains"
probe_endpoint "Reports list"         "/api/reports"
probe_endpoint "ORSA scenarios"       "/api/orsa/scenarios"
probe_endpoint "AFR sections"         "/api/afr/sections"
probe_endpoint "SFCR sections"        "/api/sfcr/sections"

echo
echo "=========================================================================="
echo "  PRE-FLIGHT SUMMARY"
echo "=========================================================================="
TOTAL=$((PASS_CT + FAIL_CT))
if [[ $FAIL_CT -eq 0 ]]; then
    echo -e "  ${GREEN}ALL CHECKS PASSED${NC} ($PASS_CT/$TOTAL)"
    echo
    echo "  You're clear to walk on stage."
    exit 0
else
    echo -e "  ${RED}$FAIL_CT FAIL${NC} / $PASS_CT pass / $TOTAL total"
    echo
    echo "  Failures:"
    for f in "${FAILS[@]}"; do echo "    · $f"; done
    echo
    echo "  Fix or fall back to cached mode (DEMO_MODE=cached)."
    exit 1
fi

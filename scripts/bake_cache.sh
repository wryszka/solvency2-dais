#!/usr/bin/env bash
# Pre-bake all AI outputs into the demo cache so the live talk has a
# safety net (DEMO_MODE=cached or ?cached=1 will use these).
#
# Walks every (section, scenario) and runs the agent live ONCE, persisting
# the result to 6_ai_demo_cache. Run after data is loaded and before the
# talk. Idempotent — re-running just refreshes the cache.

set -uo pipefail

# Resolve from databricks.yml (single source of truth).
source "$(dirname "$0")/_load_defaults.sh" "${TARGET:-dev}"
PROFILE="$DATABRICKS_PROFILE"
PERIOD="${PERIOD:-2025-Q4}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile) PROFILE="$2"; shift 2;;
        --app)     APP_NAME="$2"; shift 2;;
        --period)  PERIOD="$2"; shift 2;;
        *) echo "Unknown arg: $1"; exit 2;;
    esac
done

APP_URL=$(databricks apps get "$APP_NAME" --profile "$PROFILE" -o json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))")
if [[ -z "$APP_URL" ]]; then
    echo "App $APP_NAME not found via profile $PROFILE."
    exit 1
fi

# OBO bearer for app calls
TOKEN=$(databricks auth token --profile "$PROFILE" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
if [[ -z "$TOKEN" ]]; then
    echo "No CLI token. Run 'databricks auth login --profile $PROFILE' first."
    exit 1
fi

bake_section() {
    local module="$1"   # afr | sfcr | rsr
    local section="$2"
    echo "  · ${module} / ${section}"
    curl -fsS -X POST "${APP_URL}/api/${module}/draft?cached=0" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"section_id\":\"${section}\",\"reporting_period\":\"${PERIOD}\"}" \
        --max-time 180 > /dev/null \
    || echo "    ! failed"
}

bake_orsa_narrative() {
    local scenario="$1"
    echo "  · orsa / ${scenario}"
    # ORSA needs a run first
    local run_id
    run_id=$(curl -fsS -X POST "${APP_URL}/api/orsa/run?cached=0" \
        -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
        --data "{\"scenario_id\":\"${scenario}\"}" --max-time 60 \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('run_id',''))" 2>/dev/null)
    if [[ -z "$run_id" ]]; then
        echo "    ! ORSA run failed"; return
    fi
    curl -fsS -X POST "${APP_URL}/api/orsa/narrative?cached=0" \
        -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
        --data "{\"run_id\":\"${run_id}\"}" --max-time 180 > /dev/null \
    || echo "    ! narrative failed"
}

echo "=========================================================================="
echo "  Demo cache bake — $APP_URL  (period $PERIOD)"
echo "=========================================================================="

echo "AFR sections:"
for s in tps_adequacy uw_policy_adequacy ri_adequacy internal_model; do
    bake_section "afr" "$s"
done

echo "SFCR sections:"
for s in business_performance system_of_governance risk_profile valuation_solvency capital_management; do
    bake_section "sfcr" "$s"
done

echo "RSR sections:"
for s in business_performance system_of_governance risk_profile valuation_solvency capital_management supervisor_uw_detail supervisor_capital_planning; do
    bake_section "rsr" "$s"
done

echo "ORSA narratives:"
for s in natcat_1_in_200 equity_minus_30 mass_lapse_plus_35 reserve_plus_10 rates_minus_100bps; do
    bake_orsa_narrative "$s"
done

# Senior Reserving Actuary — primes the FM endpoint and warms up the agent.
# This call doesn't currently use the cache table (the agent endpoint is live-only),
# but hitting it once before the talk warms the model + the SQL warehouse + any
# transitive caches in the FM endpoint. Worth ~3-5s shaved off the first stage call.
echo "Senior Reserving Actuary:"
echo "  · agents / reserving/review (warmup)"
curl -fsS "${APP_URL}/api/agents/reserving/review?period_q4=${PERIOD}&period_q3=2025-Q3" \
    -H "Authorization: Bearer ${TOKEN}" --max-time 120 > /dev/null \
|| echo "    ! warmup failed"

echo "Workbench Assistant:"
echo "  · agents / workbench/ask (warmup)"
curl -fsS -X POST "${APP_URL}/api/agents/workbench/ask" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    --data "{\"question\":\"What is outstanding for Q4 close?\",\"period\":\"${PERIOD}\"}" \
    --max-time 120 > /dev/null \
|| echo "    ! warmup failed"

echo
echo "Bake complete."
echo "  · AFR/SFCR/RSR/ORSA — cached in 6_ai_demo_cache (?cached=1 or DEMO_MODE=cached)"
echo "  · Reserving + Workbench agents — live-only, but warmed for first call"

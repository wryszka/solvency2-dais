"""ORSA — Own Risk and Solvency Assessment.

Deterministic scenario engine: take the base SCR from 2_stg_scr_results,
apply scenario-level multipliers to specific sub-modules, recompute BSCR
via the EIOPA correlation matrix, and project 3 years forward using the
0_cfg_business_plan growth + ratio assumptions.

Tables managed here:
- 0_cfg_orsa_scenarios       (cfg, seeded on first call)
- 0_cfg_business_plan        (cfg, seeded on first call)
- gold_orsa_results          (per-run + per-year output)
- gold_orsa_narratives       (AI-drafted narrative versions)
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from math import sqrt
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from server.config import fqn, get_request_user
from server.sql import execute_query, execute_query_cached
from server.ai import generate_review

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orsa", tags=["orsa"])


# ── Standard formula correlation (subset matching register_standard_formula_model) ──
BSCR_LABELS = ["market", "default", "life", "health", "non_life"]
BSCR_CORR = [
    [1.00, 0.25, 0.25, 0.25, 0.25],
    [0.25, 1.00, 0.25, 0.25, 0.50],
    [0.25, 0.25, 1.00, 0.25, 0.00],
    [0.25, 0.25, 0.25, 1.00, 0.00],
    [0.25, 0.50, 0.00, 0.00, 1.00],
]

DEFAULT_OP_RISK_FACTOR = 0.03
DEFAULT_LAC_DT = 0.10


# ── Scenario seed catalog ───────────────────────────────────────────────────
DEFAULT_SCENARIOS: list[dict[str, Any]] = [
    {
        "scenario_id": "natcat_1_in_200",
        "name": "1-in-200 nat cat event",
        "description": "Severe European storm event — multiplies non-life catastrophe charge by 2.5×.",
        "shocks": [{"module": "non_life", "sub_module": "catastrophe", "multiplier": 2.5}],
    },
    {
        "scenario_id": "equity_minus_30",
        "name": "Equity shock −30%",
        "description": "Market-wide equity sell-off — equity charge ×1.5.",
        "shocks": [{"module": "market", "sub_module": "equity", "multiplier": 1.5}],
    },
    {
        "scenario_id": "mass_lapse_plus_35",
        "name": "Mass lapse +35%",
        "description": "Persistency shock across non-life lapse and life lapse — both ×1.5.",
        "shocks": [
            {"module": "non_life", "sub_module": "lapse", "multiplier": 1.5},
            {"module": "life",     "sub_module": "lapse", "multiplier": 1.5},
        ],
    },
    {
        "scenario_id": "reserve_plus_10",
        "name": "Reserve deterioration +10%",
        "description": "Prior-year reserve strengthening — premium/reserve charge ×1.10.",
        "shocks": [{"module": "non_life", "sub_module": "premium_reserve", "multiplier": 1.10}],
    },
    {
        "scenario_id": "rates_minus_100bps",
        "name": "Interest rate −100bps (parallel)",
        "description": "Parallel downward shift of the risk-free curve — interest-rate charge ×1.30.",
        "shocks": [{"module": "market", "sub_module": "interest_rate", "multiplier": 1.30}],
    },
]

DEFAULT_BUSINESS_PLAN = [
    # year_offset: years from base (1, 2, 3)
    # premium_growth_pct: applied to premium_reserve and lapse charges (volume driven)
    # expected_loss_ratio / expense_ratio: not used by the engine yet, kept for narrative grounding
    {"year_offset": 1, "premium_growth_pct": 3.5, "expected_loss_ratio": 67.0, "expected_expense_ratio": 28.0},
    {"year_offset": 2, "premium_growth_pct": 3.0, "expected_loss_ratio": 67.5, "expected_expense_ratio": 27.5},
    {"year_offset": 3, "premium_growth_pct": 2.8, "expected_loss_ratio": 68.0, "expected_expense_ratio": 27.0},
]


# ── Bootstrap helpers ────────────────────────────────────────────────────────

async def _ensure_orsa_tables() -> None:
    """Create cfg + output tables on first call. Idempotent.

    Seeds the scenario catalog and 3-year business plan with sensible defaults
    if the cfg tables are empty.
    """
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn('0_cfg_orsa_scenarios')} ("
        " scenario_id STRING, name STRING, description STRING,"
        " shocks_json STRING)"
    )
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn('0_cfg_business_plan')} ("
        " year_offset INT, premium_growth_pct DOUBLE,"
        " expected_loss_ratio DOUBLE, expected_expense_ratio DOUBLE)"
    )
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn('gold_orsa_results')} ("
        " run_id STRING, scenario_id STRING, scenario_name STRING,"
        " base_period STRING, year_offset INT, projection_year INT,"
        " scr_eur DOUBLE, eligible_own_funds_eur DOUBLE, solvency_ratio_pct DOUBLE,"
        " module_breakdown_json STRING, is_base BOOLEAN,"
        " run_timestamp TIMESTAMP, run_by STRING)"
    )
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn('gold_orsa_narratives')} ("
        " narrative_id STRING, run_id STRING, scenario_id STRING, version INT,"
        " prompt STRING, narrative_text STRING, model_used STRING,"
        " input_tokens INT, output_tokens INT, generated_at TIMESTAMP, generated_by STRING)"
    )

    # Seed scenarios if empty
    rows = await execute_query(f"SELECT COUNT(*) AS n FROM {fqn('0_cfg_orsa_scenarios')}")
    if rows and int(rows[0]["n"] or 0) == 0:
        for s in DEFAULT_SCENARIOS:
            await execute_query(
                f"INSERT INTO {fqn('0_cfg_orsa_scenarios')} (scenario_id, name, description, shocks_json) "
                "VALUES (:sid, :name, :desc, :shocks)",
                parameters=[
                    StatementParameterListItem(name="sid",    value=s["scenario_id"]),
                    StatementParameterListItem(name="name",   value=s["name"]),
                    StatementParameterListItem(name="desc",   value=s["description"]),
                    StatementParameterListItem(name="shocks", value=json.dumps(s["shocks"])),
                ],
            )

    # Seed business plan if empty
    rows = await execute_query(f"SELECT COUNT(*) AS n FROM {fqn('0_cfg_business_plan')}")
    if rows and int(rows[0]["n"] or 0) == 0:
        for r in DEFAULT_BUSINESS_PLAN:
            await execute_query(
                f"INSERT INTO {fqn('0_cfg_business_plan')} "
                "(year_offset, premium_growth_pct, expected_loss_ratio, expected_expense_ratio) "
                "VALUES (:yo, :pg, :lr, :er)",
                parameters=[
                    StatementParameterListItem(name="yo", value=str(r["year_offset"]),               type="INT"),
                    StatementParameterListItem(name="pg", value=str(r["premium_growth_pct"]),        type="DOUBLE"),
                    StatementParameterListItem(name="lr", value=str(r["expected_loss_ratio"]),       type="DOUBLE"),
                    StatementParameterListItem(name="er", value=str(r["expected_expense_ratio"]),    type="DOUBLE"),
                ],
            )


# ── Engine ───────────────────────────────────────────────────────────────────

def _bscr(charges: dict[str, float]) -> float:
    """Aggregate module charges via the BSCR correlation matrix."""
    total = 0.0
    for i, mi in enumerate(BSCR_LABELS):
        for j, mj in enumerate(BSCR_LABELS):
            total += BSCR_CORR[i][j] * charges.get(mi, 0.0) * charges.get(mj, 0.0)
    return sqrt(max(total, 0.0))


def _scr(modules: dict[str, float]) -> float:
    bscr = _bscr(modules)
    op = bscr * DEFAULT_OP_RISK_FACTOR
    lac = min(bscr * DEFAULT_LAC_DT, bscr * 0.15)
    return bscr + op - lac


async def _load_base_modules(period: str) -> tuple[dict[str, float], dict[tuple[str, str], float], float]:
    """Read base SCR sub-module charges + own funds for the chosen period.

    Returns (module_totals, sub_module_charges, eligible_own_funds_eur).
    Module totals are the per-module SCRs from 2_stg_scr_results; sub-module
    charges are the inputs from 1_raw_risk_factors so we can apply shocks.
    """
    scr_q = f"""
        SELECT component, CAST(amount_eur AS DOUBLE) AS amount_eur
        FROM {fqn('2_stg_scr_results')}
        WHERE reporting_period = :period
          AND component IN ('SCR_market','SCR_default','SCR_non_life','SCR_health','SCR_life')
    """
    rf_q = f"""
        SELECT risk_module, risk_sub_module, CAST(charge_eur AS DOUBLE) AS charge_eur
        FROM {fqn('1_raw_risk_factors')}
        WHERE reporting_period = :period
    """
    own_q = f"""
        SELECT CAST(eligible_own_funds_eur AS DOUBLE) AS eof
        FROM {fqn('3_qrt_s2501_summary')}
        WHERE reporting_period = :period
        ORDER BY reporting_period DESC LIMIT 1
    """
    p = [StatementParameterListItem(name="period", value=period)]
    scr_rows, rf_rows, own_rows = await asyncio.gather(
        execute_query(scr_q, parameters=p),
        execute_query(rf_q, parameters=p),
        execute_query(own_q, parameters=p),
    )

    label_map = {
        "SCR_market": "market", "SCR_default": "default",
        "SCR_non_life": "non_life", "SCR_health": "health", "SCR_life": "life",
    }
    modules: dict[str, float] = {}
    for r in scr_rows:
        key = label_map.get(r["component"])
        if key:
            modules[key] = float(r["amount_eur"] or 0)

    sub_charges: dict[tuple[str, str], float] = {}
    for r in rf_rows:
        sub_charges[(r["risk_module"], r["risk_sub_module"])] = float(r["charge_eur"] or 0)

    eligible_own_funds = float(own_rows[0]["eof"]) if own_rows else 0.0
    return modules, sub_charges, eligible_own_funds


def _apply_shocks_to_module(
    module: str,
    sub_charges: dict[tuple[str, str], float],
    shocks: list[dict[str, Any]],
) -> float:
    """Recompute the module SCR after applying scenario shocks to its sub-modules.

    Simple square-root sum-of-squares over sub-modules — keeps the engine
    deterministic and demo-grade. Shocks are multiplicative.
    """
    relevant = {sm: charge for (m, sm), charge in sub_charges.items() if m == module}
    for shock in shocks:
        if shock["module"] != module:
            continue
        sm = shock["sub_module"]
        mult = float(shock.get("multiplier", 1.0))
        if sm in relevant:
            relevant[sm] = relevant[sm] * mult
    if not relevant:
        return 0.0
    return sqrt(sum(v * v for v in relevant.values()))


def _project_year(modules: dict[str, float], premium_growth_pct: float) -> dict[str, float]:
    """Project module charges one year forward using the business plan growth."""
    g = 1.0 + (premium_growth_pct / 100.0)
    out = dict(modules)
    # Volume-driven modules grow with premium; market / default stay flat.
    for k in ("non_life", "life", "health"):
        if k in out:
            out[k] = out[k] * g
    return out


# ── Routes ───────────────────────────────────────────────────────────────────

class OrsaRunRequest(BaseModel):
    scenario_id: str
    base_period: str | None = None  # default: latest period in 2_stg_scr_results


@router.get("/scenarios")
async def list_scenarios():
    """Return the scenario catalog."""
    try:
        await _ensure_orsa_tables()
        rows = await execute_query_cached(
            f"SELECT scenario_id, name, description, shocks_json FROM {fqn('0_cfg_orsa_scenarios')} ORDER BY scenario_id",
            ttl_seconds=120,
        )
        out = []
        for r in rows:
            try:
                shocks = json.loads(r["shocks_json"] or "[]")
            except Exception:
                shocks = []
            out.append({
                "scenario_id": r["scenario_id"],
                "name": r["name"],
                "description": r["description"],
                "shocks": shocks,
            })
        return {"scenarios": out}
    except Exception as exc:
        logger.exception("ORSA scenarios fetch failed")
        raise HTTPException(500, str(exc)) from exc


@router.get("/business-plan")
async def get_business_plan():
    """Return the 3-year business plan assumption grid."""
    await _ensure_orsa_tables()
    rows = await execute_query_cached(
        f"SELECT year_offset, premium_growth_pct, expected_loss_ratio, expected_expense_ratio "
        f"FROM {fqn('0_cfg_business_plan')} ORDER BY year_offset",
        ttl_seconds=300,
    )
    return {"plan": rows}


@router.post("/run")
async def run_scenario(req: OrsaRunRequest, request: Request):
    """Apply a scenario, compute base + stressed SCR for years 0..3, persist."""
    await _ensure_orsa_tables()
    user = get_request_user(request)

    # Resolve base period
    if not req.base_period:
        rows = await execute_query(
            f"SELECT MAX(reporting_period) AS rp FROM {fqn('2_stg_scr_results')}"
        )
        base_period = rows[0]["rp"] if rows and rows[0]["rp"] else None
    else:
        base_period = req.base_period
    if not base_period:
        raise HTTPException(400, "Cannot determine base period — 2_stg_scr_results is empty")

    # Look up scenario
    s_rows = await execute_query(
        f"SELECT scenario_id, name, shocks_json FROM {fqn('0_cfg_orsa_scenarios')} WHERE scenario_id = :sid",
        parameters=[StatementParameterListItem(name="sid", value=req.scenario_id)],
    )
    if not s_rows:
        raise HTTPException(404, f"Unknown scenario: {req.scenario_id}")
    scen = s_rows[0]
    try:
        shocks = json.loads(scen["shocks_json"] or "[]")
    except Exception:
        shocks = []

    base_modules, sub_charges, eligible_own_funds = await _load_base_modules(base_period)
    if not base_modules:
        raise HTTPException(400, f"No SCR data for period {base_period} — run the standard formula first")

    # Stressed module charges in year 0
    stressed_modules = dict(base_modules)
    for module in BSCR_LABELS:
        new_charge = _apply_shocks_to_module(module, sub_charges, shocks)
        if new_charge > 0:
            # Use the larger of (recomputed-from-sub-modules) and (existing module total)
            # multiplied by the same ratio. Falls back gracefully when sub-modules
            # don't perfectly reconstruct the module total in the synthetic data.
            base_module = base_modules.get(module, 0.0)
            base_recompute = _apply_shocks_to_module(module, sub_charges, [])
            ratio = (new_charge / base_recompute) if base_recompute > 0 else 1.0
            stressed_modules[module] = base_module * ratio

    plan_rows = await execute_query_cached(
        f"SELECT year_offset, premium_growth_pct FROM {fqn('0_cfg_business_plan')} ORDER BY year_offset",
        ttl_seconds=300,
    )
    plan = [(int(r["year_offset"]), float(r["premium_growth_pct"])) for r in plan_rows]

    run_id = str(uuid.uuid4())
    run_ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    base_year = int(base_period.split("-")[0])
    rows_to_insert: list[dict[str, Any]] = []

    # Year 0 — base + stressed
    base_scr = _scr(base_modules)
    stress_scr = _scr(stressed_modules)
    for is_base, mods, scr_val in ((True, base_modules, base_scr), (False, stressed_modules, stress_scr)):
        ratio = (eligible_own_funds / scr_val * 100.0) if scr_val > 0 else 0.0
        rows_to_insert.append({
            "run_id": run_id, "scenario_id": req.scenario_id, "scenario_name": scen["name"],
            "base_period": base_period, "year_offset": 0, "projection_year": base_year,
            "scr_eur": round(scr_val, 2),
            "eligible_own_funds_eur": round(eligible_own_funds, 2),
            "solvency_ratio_pct": round(ratio, 1),
            "module_breakdown_json": json.dumps({k: round(v, 2) for k, v in mods.items()}),
            "is_base": is_base,
            "run_timestamp": run_ts, "run_by": user,
        })

    # Years 1..3 — projected base + stressed
    proj_base = dict(base_modules)
    proj_stress = dict(stressed_modules)
    for yo, growth in plan:
        proj_base = _project_year(proj_base, growth)
        proj_stress = _project_year(proj_stress, growth)
        b_scr = _scr(proj_base)
        s_scr = _scr(proj_stress)
        for is_base, mods, scr_val in ((True, proj_base, b_scr), (False, proj_stress, s_scr)):
            ratio = (eligible_own_funds / scr_val * 100.0) if scr_val > 0 else 0.0
            rows_to_insert.append({
                "run_id": run_id, "scenario_id": req.scenario_id, "scenario_name": scen["name"],
                "base_period": base_period, "year_offset": yo, "projection_year": base_year + yo,
                "scr_eur": round(scr_val, 2),
                "eligible_own_funds_eur": round(eligible_own_funds, 2),
                "solvency_ratio_pct": round(ratio, 1),
                "module_breakdown_json": json.dumps({k: round(v, 2) for k, v in mods.items()}),
                "is_base": is_base,
                "run_timestamp": run_ts, "run_by": user,
            })

    # Persist
    for r in rows_to_insert:
        await execute_query(
            f"INSERT INTO {fqn('gold_orsa_results')} "
            "(run_id, scenario_id, scenario_name, base_period, year_offset, projection_year, "
            " scr_eur, eligible_own_funds_eur, solvency_ratio_pct, module_breakdown_json, is_base, "
            " run_timestamp, run_by) "
            "VALUES (:run_id, :sid, :sname, :bp, :yo, :py, :scr, :eof, :ratio, :mods, :is_base, "
            "        CAST(:ts AS TIMESTAMP), :user)",
            parameters=[
                StatementParameterListItem(name="run_id", value=r["run_id"]),
                StatementParameterListItem(name="sid",    value=r["scenario_id"]),
                StatementParameterListItem(name="sname",  value=r["scenario_name"]),
                StatementParameterListItem(name="bp",     value=r["base_period"]),
                StatementParameterListItem(name="yo",     value=str(r["year_offset"]), type="INT"),
                StatementParameterListItem(name="py",     value=str(r["projection_year"]), type="INT"),
                StatementParameterListItem(name="scr",    value=str(r["scr_eur"]), type="DOUBLE"),
                StatementParameterListItem(name="eof",    value=str(r["eligible_own_funds_eur"]), type="DOUBLE"),
                StatementParameterListItem(name="ratio",  value=str(r["solvency_ratio_pct"]), type="DOUBLE"),
                StatementParameterListItem(name="mods",   value=r["module_breakdown_json"]),
                StatementParameterListItem(name="is_base", value="true" if r["is_base"] else "false", type="BOOLEAN"),
                StatementParameterListItem(name="ts",     value=r["run_timestamp"]),
                StatementParameterListItem(name="user",   value=r["run_by"]),
            ],
        )

    return {
        "run_id": run_id,
        "scenario_id": req.scenario_id,
        "scenario_name": scen["name"],
        "base_period": base_period,
        "rows": rows_to_insert,
    }


@router.get("/runs")
async def list_runs(scenario_id: str | None = None):
    """List recent ORSA runs for the picker."""
    await _ensure_orsa_tables()
    if scenario_id:
        rows = await execute_query(
            f"SELECT DISTINCT run_id, scenario_id, scenario_name, base_period, run_timestamp, run_by "
            f"FROM {fqn('gold_orsa_results')} WHERE scenario_id = :sid "
            f"ORDER BY run_timestamp DESC LIMIT 20",
            parameters=[StatementParameterListItem(name="sid", value=scenario_id)],
        )
    else:
        rows = await execute_query(
            f"SELECT DISTINCT run_id, scenario_id, scenario_name, base_period, run_timestamp, run_by "
            f"FROM {fqn('gold_orsa_results')} ORDER BY run_timestamp DESC LIMIT 20"
        )
    return {"runs": rows}


@router.get("/run/{run_id}")
async def get_run(run_id: str):
    """Return the full result set for one ORSA run (years 0..3 × base/stressed)."""
    await _ensure_orsa_tables()
    rows = await execute_query(
        f"SELECT * FROM {fqn('gold_orsa_results')} WHERE run_id = :rid "
        f"ORDER BY year_offset, is_base DESC",
        parameters=[StatementParameterListItem(name="rid", value=run_id)],
    )
    return {"run_id": run_id, "rows": rows}


# ── Narrative generation ─────────────────────────────────────────────────────

ORSA_NARRATIVE_SYSTEM = """You are the Chief Risk Officer of Bricksurance SE, a mid-size European
composite insurer (P&C + Life on one balance sheet). You write the ORSA scenario commentary
for the Board's risk committee. Tone: precise, factual, conservative. Length: 200–300 words
of plain prose. Refer only to the numbers in the data block. Do NOT recommend regulatory
filings, do NOT claim authority to approve. Cite sub-module deltas where material."""

ORSA_NARRATIVE_PROMPT = """Draft the ORSA section narrative for scenario "{scenario_name}".

## Base period
{base_period}

## Capital path under base vs scenario
{capital_path}

## Module breakdown — base vs scenario, year 0
{module_breakdown}

## Business plan assumptions
{business_plan}

Write the narrative now."""


class OrsaNarrativeRequest(BaseModel):
    run_id: str


@router.post("/narrative")
async def generate_narrative(req: OrsaNarrativeRequest, request: Request):
    await _ensure_orsa_tables()
    user = get_request_user(request)

    rows = await execute_query(
        f"SELECT scenario_id, scenario_name, base_period, year_offset, projection_year, "
        f"       scr_eur, eligible_own_funds_eur, solvency_ratio_pct, module_breakdown_json, is_base "
        f"FROM {fqn('gold_orsa_results')} WHERE run_id = :rid "
        f"ORDER BY year_offset, is_base DESC",
        parameters=[StatementParameterListItem(name="rid", value=req.run_id)],
    )
    if not rows:
        raise HTTPException(404, "Run not found")

    scenario_name = rows[0]["scenario_name"]
    scenario_id = rows[0]["scenario_id"]
    base_period = rows[0]["base_period"]

    # Build capital-path text
    cap_lines = []
    for r in rows:
        flag = "base" if r["is_base"] else "scenario"
        cap_lines.append(
            f"- year {r['year_offset']} ({r['projection_year']}) {flag}: "
            f"SCR EUR {r['scr_eur']:,.0f}, OF EUR {r['eligible_own_funds_eur']:,.0f}, "
            f"ratio {r['solvency_ratio_pct']}%"
        )

    # Year-0 base vs stressed module breakdown
    y0_base = next((r for r in rows if r["year_offset"] == 0 and r["is_base"]), None)
    y0_stress = next((r for r in rows if r["year_offset"] == 0 and not r["is_base"]), None)
    mod_lines = []
    if y0_base and y0_stress:
        try:
            base_mods = json.loads(y0_base["module_breakdown_json"])
            stress_mods = json.loads(y0_stress["module_breakdown_json"])
            for k in BSCR_LABELS:
                b = base_mods.get(k, 0.0); s = stress_mods.get(k, 0.0)
                delta_pct = round((s - b) / b * 100, 1) if b else 0.0
                mod_lines.append(f"- {k}: base EUR {b:,.0f} → scenario EUR {s:,.0f} ({delta_pct:+}%)")
        except Exception:
            pass

    plan_rows = await execute_query_cached(
        f"SELECT year_offset, premium_growth_pct, expected_loss_ratio, expected_expense_ratio "
        f"FROM {fqn('0_cfg_business_plan')} ORDER BY year_offset",
        ttl_seconds=300,
    )
    plan_lines = [
        f"- year +{r['year_offset']}: premium growth {r['premium_growth_pct']}%, "
        f"loss ratio {r['expected_loss_ratio']}%, expense ratio {r['expected_expense_ratio']}%"
        for r in plan_rows
    ]

    user_prompt = ORSA_NARRATIVE_PROMPT.format(
        scenario_name=scenario_name,
        base_period=base_period,
        capital_path="\n".join(cap_lines) or "(none)",
        module_breakdown="\n".join(mod_lines) or "(no module breakdown)",
        business_plan="\n".join(plan_lines) or "(none)",
    )

    result = await generate_review(ORSA_NARRATIVE_SYSTEM, user_prompt, agent_name="orsa_narrative")

    # Versioning — count existing narratives for this run
    v_rows = await execute_query(
        f"SELECT COUNT(*) AS n FROM {fqn('gold_orsa_narratives')} WHERE run_id = :rid",
        parameters=[StatementParameterListItem(name="rid", value=req.run_id)],
    )
    version = int((v_rows[0] or {}).get("n", 0) or 0) + 1
    narrative_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    await execute_query(
        f"INSERT INTO {fqn('gold_orsa_narratives')} "
        "(narrative_id, run_id, scenario_id, version, prompt, narrative_text, "
        " model_used, input_tokens, output_tokens, generated_at, generated_by) "
        "VALUES (:nid, :rid, :sid, :ver, :prompt, :text, :model, :inp, :out, "
        "        CAST(:ts AS TIMESTAMP), :user)",
        parameters=[
            StatementParameterListItem(name="nid",    value=narrative_id),
            StatementParameterListItem(name="rid",    value=req.run_id),
            StatementParameterListItem(name="sid",    value=scenario_id),
            StatementParameterListItem(name="ver",    value=str(version), type="INT"),
            StatementParameterListItem(name="prompt", value=user_prompt),
            StatementParameterListItem(name="text",   value=result.text),
            StatementParameterListItem(name="model",  value=result.model_used),
            StatementParameterListItem(name="inp",    value=str(result.input_tokens), type="INT"),
            StatementParameterListItem(name="out",    value=str(result.output_tokens), type="INT"),
            StatementParameterListItem(name="ts",     value=ts),
            StatementParameterListItem(name="user",   value=user),
        ],
    )

    return {
        "narrative_id": narrative_id,
        "run_id": req.run_id,
        "version": version,
        "narrative_text": result.text,
        "model_used": result.model_used,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
    }


@router.get("/narratives/{run_id}")
async def list_narratives(run_id: str):
    await _ensure_orsa_tables()
    rows = await execute_query(
        f"SELECT narrative_id, version, narrative_text, model_used, input_tokens, output_tokens, "
        f"       generated_at, generated_by "
        f"FROM {fqn('gold_orsa_narratives')} WHERE run_id = :rid ORDER BY version DESC",
        parameters=[StatementParameterListItem(name="rid", value=run_id)],
    )
    return {"narratives": rows}

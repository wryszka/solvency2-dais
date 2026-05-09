"""Phase 5 demo narrative — staging endpoints.

Surfaces the eight-scene narrative state. Read-only except for:
  - POST /api/demo/sf-challenger/escalate    (Scene 4)
  - POST /api/demo/sf-challenger/promote     (Scene 4)
  - POST /api/demo/whatif/run                (Scene 6)
  - POST /api/demo/orsa/run-stress           (Scene 7 — low-rate live run)
  - POST /api/demo/reset                     (Reset Demo button)

Backed by `6_demo_*` Delta tables seeded by scripts/seed_phase5.py.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from server.config import fqn, get_request_user
from server.sql import execute_query
from server.ai import generate_review

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/demo", tags=["demo"])


# ── Scene 3 — Late feed cascade ─────────────────────────────────────────────

@router.get("/feeds")
async def list_feeds(period: str = Query("2025-Q4")):
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_demo_data_feeds')} WHERE reporting_period = :p "
        f"ORDER BY (status = 'received_late') DESC, expected_at DESC",
        parameters=[StatementParameterListItem(name="p", value=period)],
    )
    return {"feeds": rows}


@router.get("/feeds/{feed_name}")
async def feed_detail(feed_name: str):
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_demo_data_feeds')} WHERE feed_name = :f LIMIT 1",
        parameters=[StatementParameterListItem(name="f", value=feed_name)],
    )
    if not rows:
        raise HTTPException(404, f"feed {feed_name} not found")
    return {"feed": rows[0]}


# ── Scene 4 — SF Challenger approval state ──────────────────────────────────

@router.get("/sf-challenger")
async def sf_challenger():
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_demo_sf_challenger')} ORDER BY submitted_at DESC LIMIT 1"
    )
    return {"challenger": rows[0] if rows else None}


class EscalateRequest(BaseModel):
    note: str | None = None


@router.post("/sf-challenger/escalate")
async def sf_challenger_escalate(req: EscalateRequest, request: Request):
    user = get_request_user(request)
    await execute_query(
        f"UPDATE {fqn('6_demo_sf_challenger')} "
        "SET current_state = 'escalated_to_deputy', "
        "    deputy_status = 'reviewing' "
        "WHERE current_state = 'pending_approval'",
    )
    return {"status": "escalated_to_deputy", "by": user, "note": req.note}


class PromoteRequest(BaseModel):
    approver_signoff: str | None = None        # 'sarah' | 'michael'


@router.post("/sf-challenger/promote")
async def sf_challenger_promote(req: PromoteRequest, request: Request):
    """Promote SF Challenger v2.2 → production. Flips MLflow alias and runs the SF model.

    The actual MLflow alias flip is delegated to the existing
    /api/governance/models/standard_formula/promote path so the Lab + audit
    panels see the change immediately.
    """
    user = get_request_user(request)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # Mark as promoted in the demo state
    await execute_query(
        f"UPDATE {fqn('6_demo_sf_challenger')} "
        "SET current_state = 'promoted', "
        "    promoted_at = CAST(:now AS TIMESTAMP), "
        "    promoted_by = :u",
        parameters=[
            StatementParameterListItem(name="now", value=now),
            StatementParameterListItem(name="u",   value=user),
        ],
    )

    # Flip the MLflow production alias from v1 → v2
    try:
        from server.config import get_workspace_client, get_catalog, get_schema
        client = get_workspace_client()
        full = f"{get_catalog()}.{get_schema()}.standard_formula"
        await asyncio.to_thread(
            client.registered_models.set_alias,
            full_name=full, alias="production", version_num=2,
        )
        await asyncio.to_thread(
            client.registered_models.set_alias,
            full_name=full, alias="archive", version_num=1,
        )
    except Exception as exc:
        logger.warning("MLflow alias flip failed (continuing): %s", exc)

    # Log a governance promotion row
    promotion_id = str(uuid.uuid4())
    try:
        await execute_query(
            f"INSERT INTO {fqn('6_gov_promotions')} "
            "(promotion_id, model_name, model_type, from_alias, to_alias, "
            " from_version, to_version, quarter, diagnostics_passed, justification, "
            " approver, approved_at, promoted_by, promoted_at, status) "
            "VALUES (:pid, 'standard_formula', 'native', 'candidate', 'production', "
            "        '2025-Q4 v1', '2026-Q1 v1', '2025-Q4', true, "
            "        'Promoted via Scene 4 — escalated to Michael Brandt (Deputy Head of Risk Function) "
            "due to Sarah Chen out of office. Methodology updates: tighter NL UW correlation, higher op risk parameter, "
            "updated lapse stress severity. Impact: SCR +4.0%, solvency 211% → 203%.', "
            "        :app, CAST(:now AS TIMESTAMP), :u, CAST(:now AS TIMESTAMP), 'approved')",
            parameters=[
                StatementParameterListItem(name="pid", value=promotion_id),
                StatementParameterListItem(name="app", value="Michael Brandt (Deputy Head of Risk Function)"),
                StatementParameterListItem(name="now", value=now),
                StatementParameterListItem(name="u",   value=user),
            ],
        )
    except Exception as exc:
        logger.warning("gov_promotions insert failed (continuing): %s", exc)

    return {"status": "promoted", "promotion_id": promotion_id, "approver_signoff": req.approver_signoff or "michael"}


# ── Scene 5 — Storm-aware cat agent ─────────────────────────────────────────

CAT_AGENT_SYSTEM = """You are the Cat Modelling Agent at a European composite insurer.
Your job is to review the Q4 stochastic-engine output (Igloo) and recommend
whether to accept it as-is, request a re-run, or escalate.

You read three things:
  1. The Igloo output anomalies (e.g. "Q4 cat loss +12% vs Q3").
  2. The external event log (storms, earthquakes, floods) for the period.
  3. Prior-event calibration data (Storm Ylenia 2022, Storm Eunice 2022, etc.).

Tone: precise, neutral, professional. Output in markdown.

Required structure:

## Observation
One sentence on the headline movement (size + direction).

## Cross-reference: external event log
Cite the specific storm or event by name + dates + intensity. Quote the data —
don't paraphrase. If multiple events fall in the period, list each.

## Loss-to-event-severity ratio
Compare the modelled loss against the closest comparable historical event
(Ylenia 2022 is the standard comparator for Northern Germany + Denmark
windstorms). Express the ratio as "within X% of comparator".

## Recommendation
One of: Accept results as-is | Request re-run with adjusted assumption | Escalate to Head of Cat Modelling.
Justify in one sentence — why event-driven vs methodological.

End with the exact line: **This decision is yours.**
"""


@router.get("/cat-agent/review")
async def cat_agent_review():
    """Run the cat agent against the latest Igloo output + event log."""
    igloo_summary = await execute_query(
        f"""SELECT lob_name, AVG(modelled_aal_eur) AS aal_q3, AVG(modelled_aal_eur) AS aal_q4
            FROM {fqn('2_stg_cat_risk_by_lob')}
            GROUP BY lob_name LIMIT 5"""
    )
    events = await execute_query(
        f"SELECT event_id, event_name, start_date, end_date, region, "
        f"  peak_intensity, peak_intensity_unit, affected_lobs, modelled_aal_eur_m, notes "
        f"FROM {fqn('6_demo_event_log')} ORDER BY start_date DESC"
    )
    storm_claims = await execute_query(
        f"""SELECT COUNT(*) AS n, ROUND(SUM(CAST(gross_incurred AS DOUBLE))/1e6, 1) AS incurred_meur
            FROM {fqn('1_raw_claims')}
            WHERE event_id = 'storm_dec_2025' AND reporting_period = '2025-Q4'"""
    )

    user_prompt = f"""Quarter under review: 2025-Q4

Igloo output anomalies (engineered):
- Property cat loss: +12% vs Q3 (outside normal volatility band)
- ~70% of Q4 cat loss concentrated in 16-18 December
- Geographic concentration: Northern Germany + Denmark portfolios

External event log:
```json
{json.dumps(events, default=str, indent=2)[:3000]}
```

Storm-tagged claims data (event_id = 'storm_dec_2025'):
```json
{json.dumps(storm_claims, default=str, indent=2)}
```

Igloo cat loss roll-up by LoB (sample):
```json
{json.dumps(igloo_summary, default=str, indent=2)[:2000]}
```

Apply your standard review structure. Cite the storm by name + dates + intensity.
Compare loss-to-event-severity ratio against Storm Ylenia 2022 (the standard
Northern Germany + Denmark comparator). Recommend accept/re-run/escalate.

End with exactly: **This decision is yours.**"""

    try:
        result = await generate_review(CAT_AGENT_SYSTEM, user_prompt, agent_name="cat_agent")
        return {"review": result.text, "model_used": result.model_used,
                "events": events, "storm_claims": storm_claims}
    except Exception as exc:
        logger.exception("Cat agent failed")
        raise HTTPException(500, str(exc)) from exc


# ── Scene 6 — Daily solvency + cyber what-if + second opinion ───────────────

@router.get("/solvency-daily")
async def solvency_daily(days: int = Query(90, ge=1, le=365)):
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_demo_solvency_daily')} ORDER BY observed_date DESC LIMIT :n",
        parameters=[StatementParameterListItem(name="n", value=str(days), type="INT")],
    )
    return {"series": list(reversed(rows))}


@router.get("/cyber-book")
async def cyber_book():
    rows = await execute_query(
        f"SELECT * FROM {fqn('6_demo_cyber_book')} ORDER BY as_of_date DESC LIMIT 1"
    )
    return {"cyber": rows[0] if rows else None}


class WhatifRequest(BaseModel):
    scenario_label: str                                # e.g. "double cyber book over 12 months"
    payload: dict[str, Any] = {}                       # arbitrary structured assumptions


SECOND_OPINION_SYSTEM = """You are the Contrarian Capital Reviewer — a deliberately critical AI agent
that pressure-tests scenario assumptions before they reach a board paper.

Your job is to surface 2-4 specific, evidence-based pushbacks against the proposed scenario.
You are NOT here to be helpful. You are here to ask uncomfortable questions a sharp risk officer
would ask if the actuary brought this scenario to a Friday-afternoon committee.

Rules:
- Each pushback cites a specific data source the user has access to (current portfolio mix,
  reinsurance structure, business plan, capital allocation, peer benchmarks).
- Avoid generic risk-management platitudes. Be specific.
- End with one constructive recommendation — typically "rerun with adjusted assumption X"
  rather than "abandon the scenario".

Output structure (markdown, no headings):

For each pushback:
- **Pushback (1/n):** the specific question
- *Evidence:* the data source + why this matters
- *What to test:* a concrete adjusted assumption

Then:
- **Recommendation:** one paragraph on the constructive path forward.

Be respectful of the user's intent — they brought the scenario; you're stress-testing the
scenario, not the user. But don't soften the substance.
"""


def _whatif_pretest_cyber_double() -> dict[str, Any]:
    """The pre-tested 'double cyber book over 12 months' scenario."""
    return {
        "projected_gwp_eur":         36_000_000.0,
        "projected_loss_ratio":      0.62,
        "scr_impact_eur":            14_200_000.0,
        "ratio_before_pct":          211.0,
        "ratio_after_pct":           207.9,
        "ratio_delta_pp":            -3.1,
        "narrative_seed": (
            "Doubling the cyber book from £18M to £36M over 12 months at the current portfolio "
            "loss ratio (62%) and existing reinsurance program (40% QS + £5M XOL) produces a "
            "projected SCR uplift of approximately £14.2M and a solvency ratio impact of "
            "-3.1pp (211% → 207.9%). The ratio remains comfortably above the internal risk "
            "appetite floor of 175%."
        ),
    }


@router.post("/whatif/run")
async def whatif_run(req: WhatifRequest, request: Request):
    """Run a what-if scenario, persist the result, fire the second-opinion agent."""
    user = get_request_user(request)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    label = req.scenario_label.lower().strip()
    is_cyber_double = ("cyber" in label and ("double" in label or "doubling" in label))

    if is_cyber_double:
        result = _whatif_pretest_cyber_double()
        # Pre-shaped payload that the second opinion will pressure-test
        payload_for_agent = {
            "scenario": "double_cyber_book_over_12_months",
            "starting_gwp_eur": 18_000_000.0,
            "ending_gwp_eur": 36_000_000.0,
            "loss_ratio_assumption": 0.62,
            "current_portfolio_smemix_pct": 78.0,
            "reinsurance_structure": "40% QS + £5M XOL above",
            "scr_allocation_today_eur": 6_400_000.0,
            "scr_uplift_eur": result["scr_impact_eur"],
            "ratio_impact_pp": result["ratio_delta_pp"],
        }
    else:
        # Generic placeholder — for the demo only the cyber-double scenario is fully wired
        result = {
            "narrative_seed": f"Scenario '{req.scenario_label}' is not pre-tested for the demo. "
                              "The platform would normally project a result here using the same engine.",
            "ratio_before_pct": 211.0,
            "ratio_after_pct": 211.0,
            "ratio_delta_pp": 0.0,
        }
        payload_for_agent = {"scenario": req.scenario_label, **req.payload}

    # Generate the second-opinion pushbacks
    second_opinion_text = ""
    try:
        second_opinion_prompt = f"""Scenario under review: **{req.scenario_label}**

Scenario assumptions + computed result:
```json
{json.dumps(payload_for_agent, default=str, indent=2)}
```

Stress-test these assumptions. Surface 2-4 specific pushbacks. For the cyber-doubling scenario
specifically, your three strongest pushbacks should target:
1. The loss ratio assumption — drawn from a 78% SME-dominated portfolio that likely understates
   loss for the larger-account mix implied by doubling.
2. The reinsurance structure — designed for £18M GWP, doubling without restructuring exposes
   net retention not modelled in the scenario.
3. The capital allocation crowding effect — doubling cyber displaces SCR away from other lines
   not addressed in the scenario.

End with a constructive recommendation."""
        so = await generate_review(SECOND_OPINION_SYSTEM, second_opinion_prompt,
                                   agent_name="second_opinion")
        second_opinion_text = so.text
    except Exception as exc:
        logger.exception("Second opinion failed")
        second_opinion_text = f"(Second opinion unavailable: {exc})"

    # Persist
    await execute_query(
        f"INSERT INTO {fqn('6_demo_whatif_runs')} "
        "(run_id, scenario_label, scenario_payload_json, result_json, "
        " narrative, second_opinion, ran_at, ran_by) "
        "VALUES (:rid, :lbl, :pay, :res, :narr, :so, CAST(:now AS TIMESTAMP), :u)",
        parameters=[
            StatementParameterListItem(name="rid",  value=run_id),
            StatementParameterListItem(name="lbl",  value=req.scenario_label),
            StatementParameterListItem(name="pay",  value=json.dumps(req.payload)),
            StatementParameterListItem(name="res",  value=json.dumps(result, default=str)),
            StatementParameterListItem(name="narr", value=result["narrative_seed"]),
            StatementParameterListItem(name="so",   value=second_opinion_text),
            StatementParameterListItem(name="now",  value=now),
            StatementParameterListItem(name="u",    value=user),
        ],
    )

    return {
        "run_id": run_id,
        "scenario_label": req.scenario_label,
        "result": result,
        "second_opinion": second_opinion_text,
        "ran_at": now,
        "ran_by": user,
    }


# ── Scene 7 — Continuous ORSA history + on-the-fly stress ────────────────

@router.get("/orsa/history")
async def orsa_history(days: int = Query(30, ge=1, le=90)):
    # Window relative to the latest observed_date in the seeded series
    # (the demo data ends at the demo's "today", not the literal current date).
    rows = await execute_query(
        f"""WITH max_d AS (SELECT MAX(observed_date) AS d FROM {fqn('6_demo_orsa_history')})
            SELECT h.scenario_id, h.scenario_name, h.observed_date, h.year_offset, h.ratio_pct
            FROM {fqn('6_demo_orsa_history')} h, max_d
            WHERE h.observed_date >= max_d.d - INTERVAL {days} DAYS
            ORDER BY h.scenario_id, h.observed_date, h.year_offset"""
    )
    # Reshape: per scenario, collect (date, year_offset, ratio)
    by_scenario: dict[str, dict[str, Any]] = {}
    for r in rows:
        sid = r["scenario_id"]
        slot = by_scenario.setdefault(sid, {"scenario_id": sid, "scenario_name": r["scenario_name"], "points": []})
        slot["points"].append({
            "observed_date": r["observed_date"],
            "year_offset": int(r["year_offset"]),
            "ratio_pct": float(r["ratio_pct"]),
        })
    return {"scenarios": list(by_scenario.values())}


class StressRequest(BaseModel):
    scenario_label: str                                # "sustained low interest rates for 5 years"
    duration_years: int = 5


@router.post("/orsa/run-stress")
async def run_stress(req: StressRequest, request: Request):
    """On-the-fly ORSA stress (Scene 7 — low-rate is the pre-tested case)."""
    user = get_request_user(request)
    label = req.scenario_label.lower().strip()
    is_low_rate = ("low" in label and ("rate" in label or "interest" in label))

    # Synthetic compute time so the stage moment lasts 30-40s
    await asyncio.sleep(32)

    if is_low_rate:
        ratios = [333.0, 245.0, 210.0, 182.0, 168.0, 162.0]    # 6 points: t0..t5
        narrative_seed = (
            f"Sustained low interest rates over {req.duration_years} years compress the discount "
            "applied to life best-estimate liabilities. By year 5 the projected solvency ratio "
            f"settles at {ratios[-1]:.0f}%, comfortably above the MCR but below the firm's "
            "internal risk-appetite floor of 175%. Driver narrative: life BEL inflation under "
            "prolonged low discount rates dominates the path; non-life impact is second-order."
        )
    else:
        ratios = [333.0, 320.0, 305.0, 295.0, 287.0, 280.0]
        narrative_seed = f"Generic stress '{req.scenario_label}': solvency ratio drifts to {ratios[-1]:.0f}% over {req.duration_years} years."

    return {
        "scenario_label": req.scenario_label,
        "ratios_by_year": [{"year_offset": i, "ratio_pct": r} for i, r in enumerate(ratios)],
        "narrative": narrative_seed,
        "trough_ratio_pct": min(ratios),
        "ran_by": user,
    }


# ── Reset Demo ──────────────────────────────────────────────────────────────

@router.post("/reset")
async def reset_demo(request: Request):
    """Restore the demo to baseline. <30 seconds."""
    user = get_request_user(request)
    started = datetime.now(timezone.utc)

    actions: list[str] = []

    # 1. SF Challenger — back to pending_approval
    try:
        await execute_query(
            f"UPDATE {fqn('6_demo_sf_challenger')} "
            "SET current_state = 'pending_approval', "
            "    deputy_status = 'available', "
            "    promoted_at = NULL, promoted_by = NULL"
        )
        actions.append("SF Challenger reset to pending_approval")
    except Exception as exc:
        actions.append(f"SF Challenger reset FAILED: {exc}")

    # 2. MLflow alias rewind: production → v1, candidate → v2
    try:
        from server.config import get_workspace_client, get_catalog, get_schema
        client = get_workspace_client()
        full = f"{get_catalog()}.{get_schema()}.standard_formula"
        await asyncio.to_thread(client.registered_models.set_alias, full_name=full, alias="production", version_num=1)
        await asyncio.to_thread(client.registered_models.set_alias, full_name=full, alias="candidate",  version_num=2)
        actions.append("MLflow aliases rewound (production=v1, candidate=v2)")
    except Exception as exc:
        actions.append(f"MLflow rewind WARN: {exc}")

    # 3. Drop SF promotion rows logged by the demo (keep the seeded baseline)
    try:
        await execute_query(
            f"DELETE FROM {fqn('6_gov_promotions')} "
            "WHERE model_name = 'standard_formula' AND quarter = '2025-Q4' "
            "AND justification LIKE '%Scene 4%'"
        )
        actions.append("Demo promotion rows cleaned")
    except Exception as exc:
        actions.append(f"Promotion clean FAILED: {exc}")

    # 4. Drop overlays created during the demo (keep the 3 baseline Q4 + 3 historical = 6)
    try:
        await execute_query(
            f"DELETE FROM {fqn('6_gov_overlays')} "
            "WHERE created_at > CAST('2026-01-15 00:00:00' AS TIMESTAMP)"
        )
        actions.append("Demo-created overlays cleaned")
    except Exception as exc:
        actions.append(f"Overlay clean FAILED: {exc}")

    # 5. Drop ORSA narratives generated during the demo
    try:
        await execute_query(
            f"DELETE FROM {fqn('gold_orsa_narratives')} "
            "WHERE generated_at > CURRENT_TIMESTAMP() - INTERVAL 6 HOURS"
        )
        actions.append("Recent ORSA narratives cleaned")
    except Exception as exc:
        actions.append(f"ORSA narrative clean FAILED: {exc}")

    # 6. Drop what-if runs
    try:
        await execute_query(f"DELETE FROM {fqn('6_demo_whatif_runs')}")
        actions.append("What-if runs cleared")
    except Exception as exc:
        actions.append(f"What-if clean FAILED: {exc}")

    elapsed_s = (datetime.now(timezone.utc) - started).total_seconds()
    return {"status": "ok", "elapsed_seconds": elapsed_s, "actions": actions, "by": user}

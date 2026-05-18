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

    # Flip the MLflow alias: whatever's currently @Challenger becomes @Champion +
    # @production; whatever was @Champion previously becomes @archive. No version
    # literals in this code — re-running register notebooks does not break promote.
    try:
        from server.config import get_workspace_client, get_catalog, get_schema
        client = get_workspace_client()
        full = f"{get_catalog()}.{get_schema()}.standard_formula"
        rm = await asyncio.to_thread(client.registered_models.get, full_name=full, include_aliases=True)
        aliases = {a.alias_name.lower(): str(a.version_num) for a in (rm.aliases or [])}
        challenger_v = aliases.get("challenger") or aliases.get("candidate")
        champion_v = aliases.get("champion") or aliases.get("production")
        if challenger_v:
            await asyncio.to_thread(
                client.registered_models.set_alias,
                full_name=full, alias="production", version_num=int(challenger_v),
            )
            await asyncio.to_thread(
                client.registered_models.set_alias,
                full_name=full, alias="Champion", version_num=int(challenger_v),
            )
        if champion_v and champion_v != challenger_v:
            await asyncio.to_thread(
                client.registered_models.set_alias,
                full_name=full, alias="archive", version_num=int(champion_v),
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
        f"""SELECT lob_name, AVG(var_gross_eur) AS var_gross_eur,
                   AVG(tvar_gross_eur) AS tvar_gross_eur,
                   AVG(var_net_eur) AS var_net_eur
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


# Track Igloo cat-output approval state for the Lab card. Bare-bones demo
# state — promotes the cat module candidate to production by inserting a
# governance row + flipping the MLflow alias on igloo_cat.

@router.post("/cat-agent/approve")
async def cat_agent_approve(request: Request):
    user = get_request_user(request)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    promotion_id = str(uuid.uuid4())

    # MLflow alias flip on igloo_cat — candidate → production. Best-effort.
    try:
        from server.config import get_workspace_client, get_catalog, get_schema
        client = get_workspace_client()
        full = f"{get_catalog()}.{get_schema()}.igloo_cat"
        rm = await asyncio.to_thread(client.registered_models.get, full_name=full, include_aliases=True)
        aliases = {a.alias_name.lower(): int(a.version_num) for a in (rm.aliases or [])}
        cand_v = aliases.get("candidate") or aliases.get("challenger")
        if cand_v:
            await asyncio.to_thread(
                client.registered_models.set_alias,
                full_name=full, alias="production", version_num=cand_v,
            )
            await asyncio.to_thread(
                client.registered_models.set_alias,
                full_name=full, alias="Champion", version_num=cand_v,
            )
    except Exception as exc:
        logger.warning("Igloo MLflow alias flip skipped: %s", exc)

    # Governance promotion row
    try:
        await execute_query(
            f"INSERT INTO {fqn('6_gov_promotions')} "
            "(promotion_id, model_name, model_type, from_alias, to_alias, "
            " from_version, to_version, quarter, diagnostics_passed, justification, "
            " approver, approved_at, promoted_by, promoted_at, status) "
            "VALUES (:pid, 'igloo_cat', 'external', 'candidate', 'production', "
            "        'Q-1', 'Q-current', '2026-Q2', true, "
            "        'Q2 Igloo stochastic cat output reviewed and approved. "
            "Cat agent recommended ACCEPT — +12% vs prior quarter is event-driven "
            "(Storm Henrik, 16-18 December 2025, 142 km/h peak gust, Northern Germany + Denmark). "
            "Loss-to-event-severity within calibration band against Storm Ylenia 2022 comparator.', "
            "        :u, CAST(:now AS TIMESTAMP), :u, CAST(:now AS TIMESTAMP), 'approved')",
            parameters=[
                StatementParameterListItem(name="pid", value=promotion_id),
                StatementParameterListItem(name="now", value=now),
                StatementParameterListItem(name="u",   value=user),
            ],
        )
    except Exception as exc:
        logger.warning("Igloo gov_promotions insert failed: %s", exc)

    return {"status": "approved", "promotion_id": promotion_id, "approved_at": now, "approved_by": user}


@router.get("/cat-agent/state")
async def cat_agent_state():
    """Return current promotion state for igloo_cat — used by Lab card."""
    try:
        rows = await execute_query(
            f"SELECT promoted_at, promoted_by, status FROM {fqn('6_gov_promotions')} "
            f"WHERE model_name = 'igloo_cat' AND status = 'approved' "
            f"ORDER BY promoted_at DESC LIMIT 1"
        )
        if rows:
            return {"state": "promoted", "promoted_at": str(rows[0].get("promoted_at")), "promoted_by": rows[0].get("promoted_by")}
    except Exception:
        pass
    return {"state": "pending_review"}


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


async def _whatif_cyber_double_real(
    *,
    premium_growth_pct: float = 100.0,
    loss_ratio: float = 0.62,
    period: str | None = None,
) -> dict[str, Any]:
    """Real cyber-doubling impact via the existing orsa.run_scenario engine.

    Doubling the cyber book (~10% of NL premium volume by exposure) is
    represented as a multiplicative shock on the non_life.premium_reserve
    sub-module. The shock magnitude blends the volume effect with a
    loss-ratio adjustment vs the current portfolio (62%). The computation
    reuses orsa internals so the resulting SCR uplift is consistent with
    what the standard formula model would produce in a full scenario run.
    """
    from server.routes.orsa import (
        _ensure_orsa_tables, _load_base_modules,
        _apply_shocks_to_module, _scr,
    )
    from server.config import fqn as _fqn

    await _ensure_orsa_tables()
    if not period:
        rows = await execute_query(
            f"SELECT MAX(reporting_period) AS rp FROM {_fqn('2_stg_scr_results')}"
        )
        period = rows[0]["rp"] if rows and rows[0]["rp"] else "2025-Q4"

    base_modules, sub_charges, eligible_own_funds = await _load_base_modules(period)
    if not base_modules:
        # Fall back to legacy hardcoded payload if no SCR data exists yet
        return _whatif_pretest_cyber_double_fallback()

    # Cyber book exposure is ~3.3% of non-life premium volume (EUR 18M cyber
    # vs ~EUR 550M total NL GWP). Doubling it adds ~3.3% to the volume driver
    # of non_life.premium_reserve. The loss-ratio adjustment scales the
    # charge proportionally vs the current book LR (0.62).
    growth_factor = 1.0 + (premium_growth_pct / 100.0)            # 2.0 default
    cyber_share = 0.033
    volume_uplift = 1.0 + cyber_share * (growth_factor - 1.0)     # 1.033 default
    lr_factor = loss_ratio / 0.62 if loss_ratio > 0 else 1.0
    multiplier = max(1.0, volume_uplift * lr_factor)
    shocks = [{"module": "non_life", "sub_module": "premium_reserve", "multiplier": multiplier}]

    stressed = dict(base_modules)
    base_nl = base_modules.get("non_life", 0.0)
    base_recompute = _apply_shocks_to_module("non_life", sub_charges, [])
    new_nl_recompute = _apply_shocks_to_module("non_life", sub_charges, shocks)
    if base_recompute > 0:
        stressed["non_life"] = base_nl * (new_nl_recompute / base_recompute)

    base_scr = _scr(base_modules)
    stress_scr = _scr(stressed)
    scr_uplift = stress_scr - base_scr

    ratio_before = (eligible_own_funds / base_scr * 100.0) if base_scr > 0 else 0.0
    ratio_after = (eligible_own_funds / stress_scr * 100.0) if stress_scr > 0 else 0.0
    ratio_delta = ratio_after - ratio_before

    # GWP projection — starts from current cyber book size in 6_demo_cyber_book
    cyber_rows = await execute_query(
        f"SELECT * FROM {_fqn('6_demo_cyber_book')} ORDER BY as_of_date DESC LIMIT 1"
    )
    cyber_gwp_today = float(cyber_rows[0]["gwp_eur"]) if cyber_rows else 18_000_000.0
    projected_gwp = cyber_gwp_today * growth_factor

    narrative = (
        f"Doubling the cyber book from EUR {cyber_gwp_today/1e6:.1f}M to "
        f"EUR {projected_gwp/1e6:.1f}M over 12 months at a {int(loss_ratio*100)}% loss ratio "
        f"and the current reinsurance program is computed via the standard formula engine: "
        f"non-life premium/reserve sub-module shocked by ×{multiplier:.2f}, "
        f"BSCR recomputed via the EIOPA correlation matrix. "
        f"Projected SCR uplift EUR {scr_uplift/1e6:.1f}M; solvency ratio impact "
        f"{ratio_delta:+.1f}pp ({ratio_before:.1f}% → {ratio_after:.1f}%)."
    )

    return {
        "engine": "real:orsa.run_scenario",
        "base_period": period,
        "inputs": {
            "premium_growth_pct": premium_growth_pct,
            "loss_ratio": loss_ratio,
            "cyber_share_of_nl": cyber_share,
            "multiplier_applied": round(multiplier, 4),
        },
        "projected_gwp_eur":    round(projected_gwp, 2),
        "projected_loss_ratio": loss_ratio,
        "scr_impact_eur":       round(scr_uplift, 2),
        "ratio_before_pct":     round(ratio_before, 1),
        "ratio_after_pct":      round(ratio_after, 1),
        "ratio_delta_pp":       round(ratio_delta, 1),
        "base_scr_eur":         round(base_scr, 2),
        "stress_scr_eur":       round(stress_scr, 2),
        "eligible_own_funds_eur": round(eligible_own_funds, 2),
        "narrative_seed":       narrative,
    }


def _whatif_pretest_cyber_double_fallback() -> dict[str, Any]:
    """Only used when SCR base period has no data yet — keeps the demo working
    before the first SF run lands."""
    return {
        "engine": "fallback:pretest",
        "projected_gwp_eur":         36_000_000.0,
        "projected_loss_ratio":      0.62,
        "scr_impact_eur":            14_200_000.0,
        "ratio_before_pct":          211.0,
        "ratio_after_pct":           207.9,
        "ratio_delta_pp":            -3.1,
        "narrative_seed": (
            "Doubling the cyber book from EUR 18M to EUR 36M over 12 months at 62% loss "
            "ratio. Pretest payload (SCR results not yet populated for the current period)."
        ),
    }


@router.get("/whatif/notebook-url")
async def whatif_notebook_url(scenario: str = Query("cyber_doubling")):
    """Return a deep-link URL into the workspace for a what-if calculation
    notebook. The notebook lives in the deployed bundle under
    `src/06_What_If_Scenarios/<scenario>` and is computed dynamically from
    the running app's file location — no hardcoded user paths.
    """
    import os
    from server.config import get_workspace_host
    host = get_workspace_host().rstrip("/")
    # Bundle files root comes from env (set by app.yaml at deploy time).
    # __file__ is the in-container path on Databricks Apps and cannot be used
    # to derive the workspace path.
    root = os.environ.get("BUNDLE_FILES_ROOT", "").rstrip("/")
    rel = os.path.join("src", "06_What_If_Scenarios", scenario)
    if root:
        notebook_path = os.path.normpath(os.path.join(root, rel))
    else:
        notebook_path = "/Workspace" + os.path.normpath("/" + rel)
    # Strip .py / .sql — bundle-deployed notebooks lose the extension.
    for ext in (".py", ".sql"):
        if notebook_path.endswith(ext):
            notebook_path = notebook_path[: -len(ext)]
            break
    # Fragment expects path relative to the workspace tree root (no /Workspace).
    frag_path = notebook_path[len("/Workspace"):] if notebook_path.startswith("/Workspace") else notebook_path
    url = f"{host}/#workspace{frag_path}"
    return {"url": url, "path": notebook_path, "scenario": scenario}


@router.post("/whatif/run")
async def whatif_run(req: WhatifRequest, request: Request):
    """Run a what-if scenario, persist the result, fire the second-opinion agent."""
    user = get_request_user(request)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    label = req.scenario_label.lower().strip()
    is_cyber_double = ("cyber" in label and ("double" in label or "doubling" in label))

    if is_cyber_double:
        # Real engine: pulls base SCR, applies premium/reserve shock, recomputes BSCR
        premium_growth_pct = float(req.payload.get("premium_growth_pct", 100.0))
        loss_ratio = float(req.payload.get("loss_ratio", 0.62))
        result = await _whatif_cyber_double_real(
            premium_growth_pct=premium_growth_pct,
            loss_ratio=loss_ratio,
        )
        payload_for_agent = {
            "scenario": "double_cyber_book_over_12_months",
            "engine": result.get("engine"),
            "inputs": result.get("inputs"),
            "base_scr_eur": result.get("base_scr_eur"),
            "stress_scr_eur": result.get("stress_scr_eur"),
            "scr_uplift_eur": result["scr_impact_eur"],
            "ratio_before_pct": result["ratio_before_pct"],
            "ratio_after_pct": result["ratio_after_pct"],
            "ratio_impact_pp": result["ratio_delta_pp"],
            "loss_ratio_assumption": loss_ratio,
            "current_portfolio_smemix_pct": 78.0,
            "reinsurance_structure": "40% QS + €5M XOL above",
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
2. The reinsurance structure — designed for €18M GWP, doubling without restructuring exposes
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

@router.get("/archive/submissions")
async def archive_submissions():
    """All submissions archive rows. Sorted: in-progress first, then most-recent submitted."""
    rows = await execute_query(
        f"SELECT * FROM {fqn('gold_submissions_archive')} "
        f"ORDER BY (status = 'in_progress') DESC, submitted_at DESC NULLS LAST, qrt"
    )
    return {"submissions": rows}


@router.get("/archive/pdf/{period}/{qrt}")
async def archive_pdf(period: str, qrt: str):
    """Generate a simple PDF on demand for the given (period, qrt) row."""
    from fastapi.responses import Response
    rows = await execute_query(
        f"SELECT * FROM {fqn('gold_submissions_archive')} "
        f"WHERE period = :p AND qrt = :q LIMIT 1",
        parameters=[
            StatementParameterListItem(name="p", value=period),
            StatementParameterListItem(name="q", value=qrt),
        ],
    )
    if not rows:
        raise HTTPException(404, f"submission {period}/{qrt} not found")
    sub = rows[0]

    # Build PDF with fpdf2 (already in requirements)
    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(500, "fpdf2 not installed")

    pdf = FPDF(unit="mm", format="A4")
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    # Header band
    pdf.set_fill_color(30, 64, 175)
    pdf.rect(0, 0, 210, 30, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_xy(15, 8)
    pdf.cell(180, 5, "BRICKSURANCE SE  ·  COMPOSITE INSURANCE  ·  SOLVENCY II")
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_xy(15, 14)
    pdf.cell(180, 9, sub["qrt_title"] or sub["qrt"])

    # Body
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(15, 40)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(180, 6, f"{sub['qrt']} · {sub['period']}")
    pdf.ln(8)

    pdf.set_font("Helvetica", "", 10)
    def kv(label: str, value: str) -> None:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(110, 110, 110)
        pdf.cell(40, 5, label)
        pdf.set_text_color(30, 30, 30)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 5, str(value))
        pdf.ln(6)

    kv("Entity",        "Bricksurance SE")
    kv("LEI",           "5493001KJTIIGC8Y1R12")
    kv("Reporting period", sub["period"])
    kv("Status",        (sub.get("status") or "").replace("_", " ").upper())
    kv("Submitted",     str(sub.get("submitted_at") or "—"))
    kv("Submitted by",  sub.get("submitted_by") or "—")
    kv("Reviewed by",   sub.get("reviewed_by") or "—")
    kv("Reviewed at",   str(sub.get("reviewed_at") or "—"))
    kv("Cycle (days)",  str(sub.get("cycle_days") or "—"))
    kv("DQ pass rate",  f"{sub.get('dq_pass_rate', '—')}%")
    kv("Feeds complete", sub.get("feeds_complete") or "—")

    # Headline metric box
    pdf.ln(3)
    pdf.set_draw_color(30, 64, 175)
    pdf.set_fill_color(241, 245, 249)
    pdf.rect(15, pdf.get_y(), 180, 22, "DF")
    pdf.set_xy(20, pdf.get_y() + 4)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(0, 5, sub.get("headline_metric") or "Headline")
    pdf.set_xy(20, pdf.get_y() + 5)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(30, 64, 175)
    pdf.cell(0, 9, sub.get("headline_value") or "—")
    pdf.ln(15)

    # Narrative
    if sub.get("narrative"):
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(110, 110, 110)
        pdf.cell(0, 5, "NOTES")
        pdf.ln(6)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 30)
        pdf.multi_cell(180, 5, sub["narrative"])
        pdf.ln(3)

    # Footer
    pdf.set_y(-25)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 4, "Generated on demand from canonical Unity Catalog tables. Reflects current state for the chosen period.")
    pdf.ln(4)
    pdf.cell(0, 4, f"Audit snapshot: {sub.get('audit_snapshot_id') or '—'}")

    pdf_bytes = bytes(pdf.output())
    filename = f"{period}_{qrt}_Bricksurance.pdf".replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/orsa/draft")
async def orsa_draft():
    """Latest version of the continuous ORSA draft, all sections."""
    rows = await execute_query(
        f"WITH max_v AS (SELECT MAX(version) AS v FROM {fqn('gold_orsa_draft')}) "
        f"SELECT d.* FROM {fqn('gold_orsa_draft')} d, max_v "
        f"WHERE d.version = max_v.v ORDER BY d.order_index"
    )
    return {"version": rows[0]["version"] if rows else None, "sections": rows}


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

    # Synthetic compute time — short enough to not die on stage, long enough
    # to feel like real engine work is happening.
    await asyncio.sleep(8)

    if is_low_rate:
        ratios = [210.0, 199.0, 188.0, 178.0, 170.0, 162.0]    # 6 points: t0..t5; year-5 = 162%
        narrative_seed = (
            f"Sustained low interest rates over {req.duration_years} years compress the discount "
            "applied to life best-estimate liabilities. By year 5 the projected solvency ratio "
            f"settles at {ratios[-1]:.0f}%, comfortably above the MCR but below the firm's "
            "internal risk-appetite floor of 175%. Driver narrative: life BEL inflation under "
            "prolonged low discount rates dominates the path; non-life impact is second-order."
        )
    else:
        ratios = [210.0, 204.0, 198.0, 194.0, 191.0, 189.0]
        narrative_seed = f"Generic stress '{req.scenario_label}': solvency ratio drifts to {ratios[-1]:.0f}% over {req.duration_years} years."

    return {
        "scenario_label": req.scenario_label,
        "ratios_by_year": [{"year_offset": i, "ratio_pct": r} for i, r in enumerate(ratios)],
        "narrative": narrative_seed,
        "trough_ratio_pct": min(ratios),
        "ran_by": user,
    }


# ── Time-relative rebase ────────────────────────────────────────────────────
#
# Compute every demo date anchor from today() at reset time, so a fresh
# `Reset Demo` always reads as "this is happening this week" regardless of
# the calendar date. The seed_phase5.py script is the bootstrap; this is
# the in-app rebase that mirrors it but uses execute_query so it can run
# against a live deployment.

def _quarter_for(date: "datetime") -> tuple[int, int, "datetime", "datetime"]:
    """Return (year, q_num, q_start, q_end_exclusive) for date."""
    q = (date.month - 1) // 3 + 1
    start_month = (q - 1) * 3 + 1
    start = datetime(date.year, start_month, 1, tzinfo=timezone.utc)
    if q == 4:
        end = datetime(date.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(date.year, start_month + 3, 1, tzinfo=timezone.utc)
    return date.year, q, start, end


def _quarter_label(year: int, q: int) -> str:
    return f"{year}-Q{q}"


def _last_weekday_on_or_before(date: "datetime", weekday: int) -> "datetime":
    """Most recent date with the given weekday (0=Mon..6=Sun) on or before `date`."""
    delta = (date.weekday() - weekday) % 7
    return date - timedelta(days=delta)


def _next_weekday_after(date: "datetime", weekday: int) -> "datetime":
    delta = (weekday - date.weekday()) % 7
    if delta == 0:
        delta = 7
    return date + timedelta(days=delta)


async def _rebase_demo_state() -> dict[str, str]:
    """Rewrite all date-anchored Phase 5 demo state to be relative to today."""
    today = datetime.now(timezone.utc).replace(microsecond=0)
    today_date = today.replace(hour=0, minute=0, second=0)
    yyyy, q, q_start, q_end_excl = _quarter_for(today_date)
    q_end = q_end_excl - timedelta(days=1)
    current_period = _quarter_label(yyyy, q)
    deadline = q_end + timedelta(weeks=5)

    # Late-feed anchors: last Friday before today (expected), last Monday before today (received).
    # Handle weekend resets gracefully (e.g. running on a Tuesday → Monday=yesterday is fine).
    FRIDAY, MONDAY, SATURDAY, WEDNESDAY = 4, 0, 5, 2
    last_friday  = _last_weekday_on_or_before(today_date, FRIDAY).replace(hour=17, minute=0, tzinfo=timezone.utc)   # 18:00 CET
    last_monday  = _last_weekday_on_or_before(today_date, MONDAY).replace(hour=8, minute=47, tzinfo=timezone.utc)   # 09:47 CET
    if last_monday >= today:                  # if "last Monday" is later than today (impossible, but guard)
        last_monday = last_monday - timedelta(days=7)
    monday_email = last_monday.replace(hour=7, minute=15)                      # 08:15 CET auto-email
    monday_slack = last_monday.replace(hour=10, minute=0)                      # 11:00 CET escalation
    today_eta    = today.replace(hour=12, minute=30, second=0)                 # 14:30 CET
    next_wednesday = _next_weekday_after(today_date, WEDNESDAY).date()         # Sarah back from OOO

    # Storm date — place inside current quarter so the cat agent's "current period storm"
    # narrative is coherent. Two weeks before quarter-end works for any quarter.
    storm_end   = (q_end - timedelta(days=14)).date()
    storm_start = (q_end - timedelta(days=16)).date()

    last_saturday = _last_weekday_on_or_before(today_date, SATURDAY).replace(hour=2, minute=47, tzinfo=timezone.utc)
    nightly_orsa  = today_date.replace(hour=2, minute=14, tzinfo=timezone.utc)

    # ── 1. Data feeds ───────────────────────────────────────────────────────
    feeds_table = fqn("6_demo_data_feeds")
    await execute_query(f"DELETE FROM {feeds_table}")
    feeds_rows = [
        # Late ABN AMRO custodian (Scene 3 deep-dive) — anchored relative to today
        ("custodian_holdings_abn", "ABN AMRO Custody Services", "ABN AMRO",
         "Janusz Kowalski", "Custody Operations Lead, Amsterdam", "janusz.kowalski@abnamro.example.com",
         last_friday, last_monday, "received_late",
         monday_slack, "Slack escalation to ops lead",
         "Auto-email Mon 08:15 CET; Slack escalation Mon 11:00 CET; Janusz responded ETA validate+ingest 14:30",
         today_eta, ["S.06.02"], ["standard_formula:market_risk"],
         2_300_000.0,
         "Custodian holdings file delivered late vs Friday 18:00 CET expected. Cause: ABN AMRO weekend "
         "batch reprocessing. Phantom EUR 2.3M asset/own-funds break in cross-QRT recon resolves once feed lands.",
         current_period),
        # Late reinsurance bordereau — Scene 3 primary attention item (matches
        # Pain A "Reinsurance feed late"). Real ingestion table 1_raw_reinsurance
        # carries the same feed_name; this row carries the broker contact +
        # escalation timeline + downstream impact for the FeedDetail surface.
        ("1_raw_reinsurance", "Munich Re — quarterly bordereau", "Munich Re",
         "Anja Vogel", "Senior Treaty Administrator, Munich",
         "anja.vogel@munichre.example.com",
         q_end.replace(hour=18, minute=0, tzinfo=timezone.utc),
         (q_end + timedelta(days=8)).replace(hour=14, minute=15, tzinfo=timezone.utc),
         "received_late",
         (q_end + timedelta(days=6)).replace(hour=9, minute=30, tzinfo=timezone.utc),
         "Email + Slack escalation to broker channel",
         "Auto-email D+1, D+3, D+5; Slack escalation D+6 to broker channel; Anja acknowledged D+6 ETA D+8 14:30 CET; quarterly batch was reprocessed at Munich Re after a treaty-mapping update.",
         (q_end + timedelta(days=8)).replace(hour=16, minute=30, tzinfo=timezone.utc),
         ["S.26.06", "S.25.01", "S.05.01"],
         ["reserving_pnc:reinsurance_recoverables", "reserving_life:reinsurance_recoverables", "standard_formula:default_risk"],
         0.0,
         "Quarterly cession statement delayed 8 business days. Blocks technical-provision recoverable calculations "
         "across non-life + life books and the default-risk sub-module of the standard formula. Three teams waiting. "
         "Broker has acknowledged; ETA end of this week.",
         current_period),
        # On-time peer feeds (received during current quarter close)
        ("policies_pas", "Bricksurance Policy Administration System", "Bricksurance internal",
         "Internal", "PAS Operations", "pas-ops@bricksurance.example.com",
         last_friday, last_friday - timedelta(hours=1), "received_on_time", None, None, None, None,
         ["S.05.01", "S.12.01"], [], 0.0, "Standard close batch.", current_period),
        ("claims_pas", "Bricksurance Claims Administration", "Bricksurance internal",
         "Internal", "Claims Operations", "claims-ops@bricksurance.example.com",
         last_friday, last_friday - timedelta(hours=1), "received_on_time", None, None, None, None,
         ["S.05.01", "S.26.06"], ["reserving_pnc"], 0.0,
         "Includes storm-event claim notifications.", current_period),
        ("exposures_underwriting", "Underwriting platform", "Bricksurance internal",
         "Internal", "Underwriting Ops", "uw-ops@bricksurance.example.com",
         last_friday, last_friday - timedelta(hours=1), "received_on_time", None, None, None, None,
         ["S.26.06"], ["igloo_cat"], 0.0, "Exposure layers ready for cat engine.", current_period),
    ]
    for r in feeds_rows:
        params = []
        for i, v in enumerate(r):
            params.append(StatementParameterListItem(name=f"p{i}", value=_demo_param_value(v)))
        cells_lit = "array(" + ",".join("'" + c.replace("'", "''") + "'" for c in (r[13] or [])) + ")"
        stale_lit = "array(" + ",".join("'" + c.replace("'", "''") + "'" for c in (r[14] or [])) + ")"
        # Build INSERT with positional cast for timestamps
        await execute_query(
            f"INSERT INTO {feeds_table} "
            "(feed_name, source_system, source_party, owner_contact_name, owner_contact_role, owner_contact_email, "
            " expected_at, received_at, status, last_contact_at, last_contact_method, last_contact_notes, "
            " eta_at, blocks_qrts, stale_models, recon_phantom_eur, notes, reporting_period) VALUES ("
            ":p0, :p1, :p2, :p3, :p4, :p5, "
            "CAST(:p6 AS TIMESTAMP), CAST(:p7 AS TIMESTAMP), :p8, "
            f"CAST(NULLIF(:p9, '') AS TIMESTAMP), {_nullable(':p10')}, {_nullable(':p11')}, "
            f"CAST(NULLIF(:p12, '') AS TIMESTAMP), {cells_lit}, {stale_lit}, "
            ":p15, :p16, :p17)",
            parameters=params,
        )

    # ── 1b. Pipeline SLA status — repair the current-period rows so the
    # freshness tab and the status badge agree, and so only the reinsurance
    # feed shows as late. (Pain B — claims DQ — sits on a different surface.)
    sla_status_table = fqn("5_mon_pipeline_sla_status")
    quarter_close = q_end.replace(hour=18, minute=0, tzinfo=timezone.utc)
    # SLA business days per feed (mirrors 0_cfg_feed_sla without depending on it
    # being readable at runtime — the table is small and the values are stable).
    sla_business_days_by_feed = {
        "1_raw_assets":                   3,
        "1_raw_premiums":                 3,
        "1_raw_claims":                   3,
        "1_raw_expenses":                 5,
        "1_raw_reinsurance":              3,
        "1_raw_risk_factors":             2,
        "1_raw_exposures":                5,
        "1_raw_volume_measures":          5,
        "1_raw_counterparties":           1,
        "1_raw_balance_sheet":            5,
        "1_raw_own_funds":                5,
        "1_raw_claims_triangles":         3,
        "1_raw_life_policies":            3,
        "1_raw_life_claims":              3,
        "1_raw_life_lapses":              5,
        "1_raw_life_mortality_experience":7,
        "1_raw_life_assumptions":         7,
    }
    try:
        # Repair ALL periods in the SLA status table — the Freshness drill-down
        # shows history, so leaving older quarters with the old QRT-submission
        # deadline values produces "12 days early" vs a "late" badge.
        # Only the current period keeps the reinsurance "late" story; all
        # prior periods get on-time values for reinsurance too, so the trend
        # looks clean.
        existing = await execute_query(
            f"SELECT DISTINCT feed_name, reporting_period FROM {sla_status_table}"
        )
        for row in existing:
            fn = row.get("feed_name")
            rp = row.get("reporting_period")
            if not fn or not rp:
                continue
            # Compute that period's quarter-close from the YYYY-Qn label.
            try:
                yr_str, q_str = rp.split("-Q")
                yr = int(yr_str); qn = int(q_str)
                last_month = qn * 3
                if last_month in (4, 6, 9, 11):
                    last_day = 30
                elif last_month == 2:
                    last_day = 29 if yr % 4 == 0 and (yr % 100 != 0 or yr % 400 == 0) else 28
                else:
                    last_day = 31
                period_close = datetime(yr, last_month, last_day, 18, 0, 0, tzinfo=timezone.utc)
            except Exception:
                period_close = quarter_close
            sla_bd = sla_business_days_by_feed.get(fn, 5)
            feed_deadline = period_close + timedelta(days=sla_bd)
            if fn == "1_raw_reinsurance" and rp == current_period:
                # Only the live period keeps the late story.
                arrival = period_close + timedelta(days=11, hours=4)
                status_v = "late"
            else:
                arrival_days = max(1, sla_bd - 1)
                arrival = period_close + timedelta(days=arrival_days, hours=3)
                status_v = "on_time"
            await execute_query(
                f"UPDATE {sla_status_table} "
                "SET sla_deadline = CAST(:dl AS TIMESTAMP), "
                "    actual_arrival = CAST(:ar AS TIMESTAMP), "
                "    feed_received_timestamp = :ar, "
                "    status = :st, "
                "    notes = '' "
                "WHERE feed_name = :fn AND reporting_period = :rp",
                parameters=[
                    StatementParameterListItem(name="dl", value=feed_deadline.isoformat()),
                    StatementParameterListItem(name="ar", value=arrival.isoformat()),
                    StatementParameterListItem(name="st", value=status_v),
                    StatementParameterListItem(name="fn", value=fn),
                    StatementParameterListItem(name="rp", value=rp),
                ],
            )
    except Exception as exc:
        logger.warning("SLA status repair skipped: %s", exc)

    # ── 2. Solvency daily series — rolling 90 days ending today ─────────────
    solvency_table = fqn("6_demo_solvency_daily")
    await execute_query(f"DELETE FROM {solvency_table}")
    import random
    rng = random.Random(42)
    base = 211.0
    series: list[tuple] = []
    cur = base
    for d in range(90):
        observed = (today_date - timedelta(days=89 - d)).date()
        # Engineer the four named inflections in the last week
        if d == 85:
            cur += -1.2
            ratio = round(cur, 1)
            driver, klass, delta = "Storm-event claims notification", "claims", -1.2
        elif d == 86:
            cur += 0.6
            ratio = round(cur, 1)
            driver, klass, delta = "Equity rebound — DAX +1.4%", "market", 0.6
        elif d == 87:
            cur += -0.4
            ratio = round(cur, 1)
            driver, klass, delta = "Custodian valuation drop", "market", -0.4
        elif d == 88:
            cur += -0.2
            ratio = round(cur, 1)
            driver, klass, delta = "Property cat IBNR refresh from Igloo candidate", "claims", -0.2
        else:
            cur += (rng.random() - 0.5) * 0.4
            ratio = round(cur, 1)
            driver, klass, delta = "—", "drift", round(ratio - (series[-1][1] if series else ratio), 2)
        # Anchor the implied own-funds figure to the s2501 reality (~210% baseline,
        # ~EUR 1.17B OF against ~EUR 556M SCR). Earlier 1.85B/333% pair clashed
        # with every other surface — see number-audit reconciliation.
        series.append((observed, ratio, 556_000_000.0, 1_168_000_000.0 * (ratio / 210.0), float(delta), driver, klass))

    # Insert in batches via parameterised statements
    for i in range(0, len(series), 30):
        batch = series[i:i + 30]
        values = []
        for j, (od, r, scr, of, delta, drv, klass) in enumerate(batch):
            drv_lit = "'" + str(drv).replace("'", "''") + "'"
            klass_lit = "'" + str(klass).replace("'", "''") + "'"
            values.append(f"(CAST('{od.isoformat()}' AS DATE), {r}, {scr}, {of}, {delta}, {drv_lit}, {klass_lit})")
        await execute_query(
            f"INSERT INTO {solvency_table} (observed_date, ratio_pct, scr_eur, own_funds_eur, delta_vs_prior_pp, driver, driver_class) VALUES "
            + ", ".join(values)
        )

    # ── 3. ORSA history — rolling 30 days × 3 stresses × 4 year-offsets ─────
    orsa_hist_table = fqn("6_demo_orsa_history")
    await execute_query(f"DELETE FROM {orsa_hist_table}")
    # Baselines re-calibrated to 210% (the canonical baseline shared across
    # Control Tower, s2501 gold and the new Pillar 3 panels). Drift profiles
    # are preserved as percentages-of-baseline so the demo narrative still lands.
    SCENARIOS = [
        ("natcat_1_in_200",     "1-in-200 nat cat",          [210, 162, 158, 159]),
        ("equity_minus_30",     "Equity shock −30%",          [210, 155, 156, 159]),
        ("mass_lapse_plus_35",  "Mass lapse +35%",            [210, 175, 155, 141]),
    ]
    rng2 = random.Random(7)
    orsa_rows: list[str] = []
    for d in range(30):
        observed = (today_date - timedelta(days=29 - d)).date()
        # Mass lapse year-3 trough drifts from 141% (30d ago) to 138% today,
        # matching the runbook's -3.6pp drift narrative. Stays comfortably
        # above the SCR floor; below the firm's 175% risk appetite.
        ml_drift = 141 - (3.0 * d / 29.0)
        for sid, sname, base_ratios in SCENARIOS:
            for yo, base_ratio in enumerate(base_ratios):
                if sid == "mass_lapse_plus_35" and yo == 3:
                    ratio = round(ml_drift + (rng2.random() - 0.5) * 0.5, 1)
                else:
                    ratio = round(base_ratio + (rng2.random() - 0.5) * 1.5, 1)
                py = today_date.year + yo
                orsa_rows.append(
                    f"(CAST('{observed.isoformat()}' AS DATE), '{sid}', "
                    f"'{sname.replace(chr(39), chr(39)*2)}', {yo}, {py}, {ratio}, "
                    f"556000000.0, {1_168_000_000.0 * (ratio / 210.0)}, "
                    f"'{observed.isoformat()}-{sid}')"
                )
    for i in range(0, len(orsa_rows), 80):
        batch = orsa_rows[i:i + 80]
        await execute_query(
            f"INSERT INTO {orsa_hist_table} (observed_date, scenario_id, scenario_name, year_offset, projection_year, "
            f"ratio_pct, scr_eur, own_funds_eur, run_label) VALUES "
            + ", ".join(batch)
        )

    # ── 4. SF Challenger — submitted 9d ago, 3 reminders, OOO until next Wed ─
    nine_days_ago = today - timedelta(days=9)
    six_days_ago  = today - timedelta(days=6)
    today_reminder = today.replace(hour=9, minute=0)
    await execute_query(
        f"UPDATE {fqn('6_demo_sf_challenger')} SET "
        f"submitted_at = CAST(:s AS TIMESTAMP), "
        f"approver_oo_until = CAST(:o AS DATE), "
        f"last_reminder_at = CAST(:r AS TIMESTAMP), "
        f"approver_status = 'out_of_office', "
        f"deputy_status = 'available', "
        f"current_state = 'pending_approval', "
        f"promoted_at = NULL, promoted_by = NULL",
        parameters=[
            StatementParameterListItem(name="s", value=nine_days_ago.strftime("%Y-%m-%d %H:%M:%S")),
            StatementParameterListItem(name="o", value=next_wednesday.isoformat()),
            StatementParameterListItem(name="r", value=today_reminder.strftime("%Y-%m-%d %H:%M:%S")),
        ],
    )
    # Retain six_days_ago / nine_days_ago variable names for clarity
    _ = six_days_ago

    # ── 5. Storm event — shift Henrik to current quarter's late period ──────
    storm_table = fqn("6_demo_event_log")
    await execute_query(f"DELETE FROM {storm_table} WHERE event_id = 'storm_henrik_2025'")
    await execute_query(
        f"INSERT INTO {storm_table} "
        f"(event_id, event_name, event_type, start_date, end_date, region, peak_intensity, "
        f"peak_intensity_unit, affected_lobs, modelled_aal_eur_m, notes) VALUES "
        f"('storm_henrik_2025', 'Storm Henrik', 'windstorm', "
        f"CAST('{storm_start.isoformat()}' AS DATE), CAST('{storm_end.isoformat()}' AS DATE), "
        f"'Northern Germany + Denmark', 142.0, 'km/h peak gust', "
        f"array('property', 'motor_liability'), 137.8, "
        f"'Severe European windstorm in current quarter. Peak gust 142 km/h Skagen. ~70%% of cat loss concentrated in this 3-day window.')"
    )

    # ── 6. Cyber book — refresh as_of_date to today ─────────────────────────
    await execute_query(
        f"UPDATE {fqn('6_demo_cyber_book')} SET as_of_date = CAST(:t AS DATE)",
        parameters=[StatementParameterListItem(name="t", value=today_date.date().isoformat())],
    )

    # ── 7. ORSA draft — refresh nightly timestamps on live sections ─────────
    await execute_query(
        f"UPDATE {fqn('gold_orsa_draft')} SET last_quantitative_refresh = CAST(:t AS TIMESTAMP) "
        f"WHERE status = 'live'",
        parameters=[StatementParameterListItem(name="t", value=nightly_orsa.strftime("%Y-%m-%d %H:%M:%S"))],
    )

    # ── 8. Submissions archive — move in_progress row to current_period ─────
    # Drop any in_progress rows then re-insert under the current period name.
    arch = fqn("gold_submissions_archive")
    await execute_query(f"DELETE FROM {arch} WHERE status = 'in_progress'")
    in_prog_qrts = [
        ("S.05.01", "Premiums, Claims & Expenses",  "qrt"),
        ("S.06.02", "Asset Register",                "qrt"),
        ("S.12.01", "Life Technical Provisions",      "qrt"),
        ("S.25.01", "SCR — Standard Formula",         "qrt"),
        ("S.26.06", "Non-Life Underwriting Risk",     "qrt"),
    ]
    for qrt, title, doc_type in in_prog_qrts:
        await execute_query(
            f"INSERT INTO {arch} "
            f"(period, qrt, qrt_title, doc_type, status, "
            f" submitted_at, submitted_by, reviewed_by, reviewed_at, "
            f" cycle_days, dq_pass_rate, feeds_complete, "
            f" headline_metric, headline_value, narrative, audit_snapshot_id) VALUES "
            f"(:p, :q, :t, :d, 'in_progress', NULL, 'Laurence Ryszka', NULL, NULL, "
            f" NULL, 99.2, '7/8', 'Status', 'Drafting', "
            f" 'In progress. ABN AMRO custodian feed running late (Janusz Kowalski following up). "
            f"All other feeds received on schedule.', :s)",
            parameters=[
                StatementParameterListItem(name="p", value=current_period),
                StatementParameterListItem(name="q", value=qrt),
                StatementParameterListItem(name="t", value=title),
                StatementParameterListItem(name="d", value=doc_type),
                StatementParameterListItem(name="s", value=f"snap-{current_period}-{qrt.replace('.', '')}"),
            ],
        )

    return {
        "today": today_date.date().isoformat(),
        "current_period": current_period,
        "current_period_end": q_end.date().isoformat(),
        "deadline": deadline.date().isoformat(),
        "storm_date": storm_end.isoformat(),
        "last_friday": last_friday.date().isoformat(),
        "last_monday": last_monday.date().isoformat(),
        "next_wednesday_oo": next_wednesday.isoformat(),
    }


def _demo_param_value(v) -> str:
    """Shape a value for an SDK StatementParameterListItem (string-only)."""
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, list):
        return ""               # arrays handled with literal substitution
    return str(v)


def _nullable(param_ref: str) -> str:
    return f"NULLIF({param_ref}, '')"


# ── Period state — single source of truth for the in-progress quarter ──────

@router.get("/period-state")
async def period_state():
    """Returns current_period, deadline, days remaining — used by the Today header."""
    today = datetime.now(timezone.utc).replace(microsecond=0)
    yyyy, q, _qs, q_end_excl = _quarter_for(today)
    q_end = q_end_excl - timedelta(days=1)
    deadline = q_end + timedelta(weeks=5)

    def business_days_between(a: "datetime", b: "datetime") -> int:
        if b <= a: return 0
        days = 0; cur = a.date(); end = b.date()
        while cur <= end:
            if cur.weekday() < 5: days += 1
            cur = cur + timedelta(days=1)
        return days

    return {
        "today": today.date().isoformat(),
        "current_period": _quarter_label(yyyy, q),
        "current_period_end": q_end.date().isoformat(),
        "deadline": deadline.date().isoformat(),
        "business_days_to_deadline": business_days_between(today, deadline),
        "status": "in_progress",
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
        # Rewind aliases to their pre-promote position. Find the lowest +
        # highest version numbers; lowest → production, highest → candidate.
        # Avoids version literals so re-running register notebooks doesn't break this.
        rm = await asyncio.to_thread(client.registered_models.get, full_name=full, include_aliases=True)
        versions = await asyncio.to_thread(client.model_versions.list, full_name=full)
        version_nums = sorted(int(v.version) for v in versions)
        if len(version_nums) >= 2:
            base_v, candidate_v = version_nums[0], version_nums[-1]
            await asyncio.to_thread(client.registered_models.set_alias, full_name=full, alias="production", version_num=base_v)
            await asyncio.to_thread(client.registered_models.set_alias, full_name=full, alias="Champion",   version_num=base_v)
            await asyncio.to_thread(client.registered_models.set_alias, full_name=full, alias="candidate",  version_num=candidate_v)
            await asyncio.to_thread(client.registered_models.set_alias, full_name=full, alias="Challenger", version_num=candidate_v)
            actions.append(f"MLflow aliases rewound (production=v{base_v}, candidate=v{candidate_v})")
        else:
            actions.append(f"MLflow rewind WARN: only {len(version_nums)} version(s) found, skipped")
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

    # 4. Drop overlays created during the demo. The seeded baseline overlays
    # carry the deterministic seed-author prefix; anything else was created
    # interactively during the demo session and should be removed.
    try:
        await execute_query(
            f"DELETE FROM {fqn('6_gov_overlays')} "
            "WHERE author NOT LIKE 'senior.reserving.actuary@%'"
        )
        actions.append("Demo-created overlays cleaned (kept seeded baseline)")
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

    # 7. ORSA draft — keep baseline version 1, drop any versions created during demo
    try:
        await execute_query(f"DELETE FROM {fqn('gold_orsa_draft')} WHERE version > 1")
        actions.append("ORSA draft rewound to baseline (v1)")
    except Exception as exc:
        actions.append(f"ORSA draft rewind FAILED: {exc}")

    # 8. Rebase all date-anchored state to today (Phase 5d evergreen demo)
    try:
        rebase_info = await _rebase_demo_state()
        actions.append(f"Dates rebased to today ({rebase_info['today']}, current period {rebase_info['current_period']})")
    except Exception as exc:
        logger.exception("rebase failed")
        actions.append(f"Rebase FAILED: {exc}")

    elapsed_s = (datetime.now(timezone.utc) - started).total_seconds()
    return {"status": "ok", "elapsed_seconds": elapsed_s, "actions": actions, "by": user}


@router.post("/rebase")
async def rebase_only(request: Request):
    """Run only the time-relative rebase (no approval / overlay rewinds)."""
    user = get_request_user(request)
    started = datetime.now(timezone.utc)
    info = await _rebase_demo_state()
    elapsed_s = (datetime.now(timezone.utc) - started).total_seconds()
    return {"status": "ok", "elapsed_seconds": elapsed_s, "by": user, **info}

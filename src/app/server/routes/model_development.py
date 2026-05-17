"""Phase 9 — Model Development destination endpoints.

Surfaces notebook catalogues with dynamically-resolved workspace URLs:
- /native-models   — native model notebooks (reserving, SF, ORSA engine, recon)
- /worked-examples — src/examples/ + new whatif_scenario_template
- /external-engines — Igloo and Prophet integration notebooks
- /notebook-url   — generic resolver: relative repo path → workspace URL

No new data — every entry references existing notebook source files. URLs
resolve dynamically from the running app's __file__ position (bundle-deployed
notebooks land alongside the app under .../bundle/<bundle>/<target>/files/).
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from server.config import get_workspace_host

router = APIRouter(prefix="/api/model-development", tags=["model-development"])


def _bundle_files_root() -> str:
    """Compute the workspace path to <bundle_files>/ from this module's __file__.

    Module location: <bundle_files>/src/app/server/routes/model_development.py
    Four parents up → <bundle_files>/. On local dev this points at the repo root.
    """
    here = os.path.abspath(__file__)
    p = here
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def _workspace_url(rel_path: str) -> str:
    """Resolve a repo-relative notebook path to a workspace deep-link."""
    host = get_workspace_host()
    root = _bundle_files_root()
    full = os.path.normpath(os.path.join(root, rel_path))
    if full.startswith("/Workspace"):
        return f"{host}#notebook{full}"
    # Local dev — show a synthesised path so the UI renders something useful
    return f"{host}#notebook/Workspace{full}"


# ── Static catalogues ────────────────────────────────────────────────────────

NATIVE_MODELS: list[dict[str, Any]] = [
    {
        "model_id": "reserving_pnc",
        "name": "Reserving — P&C",
        "domain": "Reserving (Non-Life)",
        "methodology": "Chain ladder with Bornhuetter-Ferguson overlay for long-tail lines.",
        "status": "Production",
        "illustrative": True,
        "notebook": "src/02_Reserving_Model/register_reserving_models.py",
        "linked_artefacts": ["S.05.01", "S.25.01", "S.26.06"],
    },
    {
        "model_id": "reserving_life",
        "name": "Reserving — Life",
        "domain": "Reserving (Life)",
        "methodology": "Best estimate + risk margin via cashflow projection; Prophet-anchored assumptions.",
        "status": "Production",
        "illustrative": True,
        "notebook": "src/02_Reserving_Model/register_reserving_models.py",
        "linked_artefacts": ["S.12.01", "S.25.01"],
    },
    {
        "model_id": "standard_formula",
        "name": "Standard Formula SCR aggregation",
        "domain": "Capital (Pillar 1)",
        "methodology": "Module + sub-module charges aggregated via the EIOPA BSCR correlation matrix. Operational risk + LAC_DT applied.",
        "status": "Production",
        "illustrative": True,
        "notebook": "src/03_QRT_S2501_SCR/register_standard_formula_model.py",
        "linked_artefacts": ["S.25.01", "SFCR §E", "RSR §E"],
    },
    {
        "model_id": "orsa_stress",
        "name": "ORSA stress projection engine",
        "domain": "Governance (Pillar 2)",
        "methodology": "Multiplicative shocks on sub-module charges, BSCR recompute, 3-year projection via business plan growth.",
        "status": "Production",
        "illustrative": True,
        "notebook": "src/app/server/routes/orsa.py",
        "linked_artefacts": ["ORSA narrative", "Scene 6 what-if", "Scene 7 stress"],
    },
    {
        "model_id": "cross_qrt_recon",
        "name": "Cross-QRT reconciliation engine",
        "domain": "Quality (cross-pillar)",
        "methodology": "Pairwise reconciliation checks across QRTs (assets vs market risk, GWP vs volume measures, BE vs TPs).",
        "status": "Production",
        "illustrative": False,
        "notebook": "src/00_Generate_Data/generate_data.py",
        "linked_artefacts": ["5_mon_cross_qrt_reconciliation"],
    },
    {
        "model_id": "risk_margin",
        "name": "Risk margin (Life)",
        "domain": "Reserving (Life)",
        "methodology": "Cost-of-capital approach on the non-hedgeable risk SCR projection.",
        "status": "Production",
        "illustrative": True,
        "notebook": "src/05_QRT_S1201_Life_TPs/gold_s1201_life_technical_provisions.sql",
        "linked_artefacts": ["S.12.01"],
    },
]


WORKED_EXAMPLES: list[dict[str, Any]] = [
    {
        "title": "Reserving — Chain Ladder walkthrough",
        "description": "Classic chain ladder development on a paid triangle; tail-fit selection; ultimate + IBNR breakdown.",
        "methodology": "Chain Ladder",
        "notebook": "src/examples/reserving_chain_ladder.py",
    },
    {
        "title": "Reserving — Bornhuetter-Ferguson walkthrough",
        "description": "BF method against the chain-ladder result; credibility weighting; expected loss ratio sensitivity.",
        "methodology": "Bornhuetter-Ferguson",
        "notebook": "src/examples/reserving_bornhuetter_ferguson.py",
    },
    {
        "title": "Standard Formula walkthrough",
        "description": "Module + sub-module SCR build-up; BSCR aggregation via the EIOPA correlation matrix; LAC_DT + operational risk.",
        "methodology": "Standard Formula",
        "notebook": "src/examples/standard_formula_walkthrough.py",
    },
    {
        "title": "ORSA stress — adding a new scenario",
        "description": "How to add a new ORSA stress scenario to 0_cfg_orsa_scenarios and project it through run_scenario.",
        "methodology": "ORSA projection",
        "notebook": "src/examples/orsa_stress_template.py",
    },
    {
        "title": "What-if scenario template",
        "description": "Define a new what-if scenario using the ORSA run_scenario engine. Pattern established by the cyber-doubling case (Phase 7).",
        "methodology": "What-if projection",
        "notebook": "src/examples/whatif_scenario_template.py",
    },
]


EXTERNAL_ENGINES: list[dict[str, Any]] = [
    {
        "engine": "WTW Igloo",
        "kind": "Non-life cat (stochastic)",
        "computes": "Stochastic catastrophe loss generation for European perils — VaR, TVaR, AAL.",
        "integration_flow": [
            "Export exposures + reinsurance structure to a UC Volume",
            "Trigger Igloo run via the engine's API or scheduled batch",
            "Read result file from the volume",
            "Ingest into 4_eng_stochastic_exchange, then 2_stg_cat_risk_by_lob",
            "Cat agent reviews output against the external event log",
        ],
        "notebook": "src/examples/standard_formula_walkthrough.py",
        "exchange_volume": "UC Volume · 4_eng_stochastic_exchange",
    },
    {
        "engine": "FIS Prophet",
        "kind": "Life UW + cat (5K-scenario projection)",
        "computes": "Per-policy 5K-scenario cashflow projection for life best estimate + risk margin + life UW stresses.",
        "integration_flow": [
            "Export in-force + assumption set to a UC Volume",
            "Trigger Prophet run",
            "Read scenario cashflow output",
            "Ingest into 4_eng_life_exchange, then 2_stg_life_tp_components",
            "reserving_life pyfunc consumes the cashflow set",
        ],
        "notebook": "src/02_Reserving_Model/register_reserving_models.py",
        "exchange_volume": "UC Volume · 4_eng_life_exchange",
    },
]


@router.get("/native-models")
async def list_native_models():
    out = []
    for m in NATIVE_MODELS:
        out.append({**m, "workspace_url": _workspace_url(m["notebook"])})
    return {"models": out}


@router.get("/worked-examples")
async def list_worked_examples():
    out = []
    for e in WORKED_EXAMPLES:
        out.append({**e, "workspace_url": _workspace_url(e["notebook"])})
    return {"examples": out}


@router.get("/external-engines")
async def list_external_engines():
    out = []
    for e in EXTERNAL_ENGINES:
        out.append({**e, "workspace_url": _workspace_url(e["notebook"])})
    return {"engines": out}


@router.get("/notebook-url")
async def notebook_url(path: str = Query(..., description="Repo-relative notebook path (e.g. src/examples/foo.py)")):
    if path.startswith("/") or ".." in path:
        raise HTTPException(400, "Path must be repo-relative and not contain '..'")
    return {"path": path, "url": _workspace_url(path)}

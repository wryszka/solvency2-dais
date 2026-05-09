# Solvency II at the Speed of Lakehouse

> **Databricks as the actuarial workbench.** Comprehensive Solvency II solution as the proof case
> — reserving, standard formula, ORSA, governance, disclosure, all on one platform. *Vehicle not
> cargo*: the platform is real, the actuarial science is illustrative. Built for the conversation
> about where the next decade of actuarial work lives. Forum talk: **"Solvency II at the Speed of
> Lakehouse."**

## What this is and isn't

**This is** a platform demo showing how actuarial work — reserving, capital, ORSA, disclosure —
operates when unified on Databricks with full governance, lineage, and AI assistance. The four
polished demo scenes (Control Tower, Senior Reserving Actuary + Overlays, Audit panel on a QRT,
ORSA scenario run) are designed for live forum delivery.

**This isn't** actuarial software. The reserving and capital models are illustrative. Real
implementations would use the customer's own validated methodology, their consultancy's IP, or
specialist tools (Igloo, Prophet, ResQ) integrated as peer models. Igloo and Prophet appear
as peer rows in the Actuarial Lab — same governance interface as the native UC models — to
make exactly that point.

The workbench horizon (`/horizon`, `/adjacencies`) walks the broader story: same data, same
governance, same AI applied to pricing, IFRS 17, claims analytics, reinsurance optimisation,
customer analytics, capital steering. Solvency II proves the model; the next workflow extends
from here.

---

Bricksurance SE — a synthetic mid-size European composite (P&C + Life on one balance sheet) —
closes its Q4 2025 reporting cycle in front of you. The demo surfaces seven engineered
operational pains, walks the actuarial team's response, and shows the same actuarial engines
(Prophet, Igloo) as governed peers in the Actuarial Lab.

## Architecture in one line

```
  Bronze (raw feeds + life book)
    → Silver (cleansed / aggregated)
       → Gold (EIOPA QRTs · S.06.02 · S.05.01 · S.12.01 · S.25.01 · S.26.06 · Life UW)
          → AI agents (ORSA · AFR · SFCR · RSR · Senior Reserving Actuary · Workbench Assistant)
             → PDF / Word / Lakeview / Genie

  Stochastic engines (peer-rows in the Actuarial Lab):
    Igloo  — non-life cat
    Prophet — life UW (mortality, longevity, lapse, expense, life cat)

  Governance (the layer that ties it together):
    UC tables · MLflow alias workflow · Overlays Register · Audit panel · Lineage graph
```

## Pillar architecture

| Pillar | Colour | Deliverables in the app |
|---|---|---|
| **1 — Capital** | Blue | SCR & Standard Formula · Reserving (P&C) · Reserving (Life) · Non-Life UW Risk · Life UW Risk · Asset Register |
| **Actuarial Lab** | Slate | Models (peer rows) · Overlays Register · Adjacencies |
| **2 — Governance** | Green | ORSA · Model Governance · Actuarial Function (Article 48) · Internal Controls |
| **3 — Disclosure** | Amber | QRT Submission Pack · SFCR · RSR · Regulator Q&A |
| Cross | Slate | Control Tower · Data Quality · Workbench Horizon |

## For forum demo operators

Read these in order:

1. **[`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md)** — full forum talk script (25-min canonical + 15-min cut, opening verbatim, scene-by-scene click sequences, recovery lines, audience-flex matrix, 9-question tangent recovery).
2. **[`docs/cue_cards.md`](docs/cue_cards.md)** — A5-printable cue cards, one card per scene, glance-readable on stage.
3. **[`docs/demo_fallbacks/index.html`](docs/demo_fallbacks/index.html)** — single-page static fallback if the live app fails. Open it in a browser before the talk so it's cached.
4. **[`scripts/preflight_check.sh`](scripts/preflight_check.sh)** — 38 SQL + HTTP probes including Phase 1 governance + historical Q1/Q2/Q3 + audit panel. Exits non-zero on any failure.
5. **[`scripts/bake_cache.sh`](scripts/bake_cache.sh)** — pre-bake AI outputs into `6_ai_demo_cache` for AFR/SFCR/RSR/ORSA + warm the live-only Senior Reserving Actuary and Workbench Assistant agents.

In the app, three operator hooks:

- `?mode=forum` on `/` — projector-friendly large-font landing.
- `/architecture` — single-page React-SVG asset, screenshottable as a slide.
- `/horizon` — the closing visual: workbench at centre, adjacent domains orbiting outward.
- Sidebar **Live | Cached** toggle — flip mid-talk if the FM API misbehaves.

## Bundle targets

| Target | Workspace | Catalog | Schema | Purpose |
|---|---|---|---|---|
| `dev` | `fevm-lr-serverless-aws-us` | `lr_serverless_aws_us_catalog` | `solvency2demo_agentic` | Frozen — old live demo |
| `dev_v2` | `fevm-lr-dev-aws-us` | `lr_dev_aws_us_catalog` | `solvency2demo_v2` | Active forum-talk dev |
| `prod` | (configurable) | (configurable) | (configurable) | Promotion target |

`main` branch is reserved for serverless promotion; day-to-day work happens on `dev`.

## Setup

Requires the Databricks CLI v0.200+ with Asset Bundles. All jobs run on serverless.

```bash
# Validate
databricks bundle validate -t dev_v2

# Deploy (or use `make deploy-dev`)
databricks bundle deploy -t dev_v2 --profile DEV
databricks apps deploy solvency2-qrt-ai-dev \
  --source-code-path "/Workspace/Users/<you>/.bundle/solvency-ii-qrt-demo/dev_v2/files/src/app" \
  --profile DEV

# One-time: register reserving models + seed governance tables on serverless
databricks bundle run governance_setup -t dev_v2 --profile DEV

# Pre-flight + bake cache before the demo
make preflight
make bake-cache
```

The `Makefile` carries shortcuts: `make preflight`, `make bake-cache`, `make deploy-dev`,
`make cue-cards.pdf` (renders cue cards through pandoc).

## Repository structure

```
├── DEMO_RUNBOOK.md                       # Forum talk script
├── Makefile                              # Common operator targets
├── README.md
├── databricks.yml                        # Bundle config (variables + targets)
├── docs/
│   ├── cue_cards.md                      # A5-printable cue cards (one per scene)
│   └── demo_fallbacks/index.html         # Single-page static demo fallback
├── resources/                            # DLT pipeline + job definitions per QRT
│   └── governance_setup_job.yml          # Reserving models + 6_gov_* bootstrap
├── scripts/
│   ├── preflight_check.sh                # 38 SQL + HTTP probes
│   ├── bake_cache.sh                     # Pre-bake AI outputs + warm agents
│   ├── seed_governance.py                # Local seed for 6_gov_* tables
│   ├── create_dashboard.py               # FEVM Lakeview dashboard
│   └── create_dashboard_v2.py            # Composite (dev_v2) Lakeview dashboard
└── src/
    ├── 00_Generate_Data/                 # Synthetic data + bootstrap + teardown
    ├── 01_Bootstrap_Governance/          # 6_gov_* tables + historical Q1/Q2/Q3 state
    ├── 02_Reserving_Model/               # Chain-ladder + life BE pyfuncs in UC
    ├── 03_QRT_S2501_SCR/                 # Standard formula MLflow model + run
    ├── 04_QRT_S2606_NL_Risk/             # Non-life UW + Igloo
    ├── 04b_QRT_Life_UW_Risk/             # Life UW + Prophet
    ├── 05_QRT_S1201_Life_TPs/            # Life Technical Provisions
    ├── examples/                         # Worked-example notebooks (chain ladder, BF, SF, ORSA template)
    └── app/                              # FastAPI + React app
```

## Variables

| Variable | Default | Description |
|---|---|---|
| `catalog_name` | `main` | Unity Catalog (override per target) |
| `schema_name` | `solvency2demo` | Schema for all demo tables |
| `entity_name` | `Bricksurance SE` | Synthetic undertaking name |
| `entity_lei` | `5493001KJTIIGC8Y1R12` | Synthetic LEI |
| `entity_type` | `composite` | `composite`, `life`, or `nonlife` |
| `reporting_date` | `2025-12-31` | Reference date |

## Engineered Q4 2025 pains (internal — not for the demo narrative)

The Q4 2025 quarter carries seven deliberate operational pains for the forum demo to surface.
Q1–Q3 stay clean to make the contrast visible.

| Pain | Surface | Discoverable via |
|---|---|---|
| **A** RI feed late by 8 business days | `5_mon_pipeline_sla_status` for `1_raw_reinsurance` (t+11 only in Q4) | Control Tower freshness |
| **B** 47 negative-paid claims | `1_raw_claims` rows tagged `system_source = 'legacy_pre_migration'` | DLT expectation drops them |
| **C** December storm | 60% of property claims clustered Dec 18–31; `event_id = 'storm_dec_2025'` | Storm-tag aggregation |
| **D** Life lapse spike | Unit-linked lapse rate ×1.35 in Q4 only → ~+2.3% Q4 life BEL | `1_raw_life_lapses` Q3 vs Q4 |
| **E** €2.3M asset/own-funds gap | Duplicate ISIN custodian bond in Q4 | `5_mon_cross_qrt_reconciliation` + `-DUP` asset_id |
| **F** Champion vs Challenger +4% SCR | `params_2026` in `register_standard_formula_model.py` | Model Governance comparison view |
| **G** Reserve-capital divergence | Q4 reserving committee bumped property dev factor; capital model still on Q3 parameter | `5_mon_cross_qrt_reconciliation` (`reserve_capital_divergence` row) |

A BaFin question fixture (`0_cfg_bafin_questions`) carries the regulator inquiry that follows
submission and ties to Pain C.

## Disclaimer

Not a Databricks product. A working demonstration of what can be built on the platform.
Synthetic data; illustrative templates and AI prompts. Do not rely on for actual regulatory
submissions. Reserving, SF, Igloo, and Prophet are mock or example-quality — *vehicle, not cargo*.

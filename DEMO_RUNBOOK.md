# Solvency II at the Speed of Lakehouse — Forum Talk Runbook

> Forum talk script. 25-minute canonical version, with a 15-minute cut clearly marked.
> Bricksurance SE — a mid-size European composite (P&C + Life on one balance sheet) — is closing
> Q4 2025 on a single platform.

---

## Quick links (DEV deployment)

| Asset | URL |
|---|---|
| **App (DEV)** | https://solvency2-qrt-ai-dev-7474656169654171.aws.databricksapps.com |
| **Forum-mode landing** | …/?mode=forum |
| **Architecture asset** | …/architecture |
| **Lakeview dashboard** | https://fevm-lr-dev-aws-us.cloud.databricks.com/dashboardsv3/01f14b083d0f106f98420906328d6fd5 |
| **Genie space** | https://fevm-lr-dev-aws-us.cloud.databricks.com/genie/rooms/01f14b086fda159fa26b3344740e6db5 |
| **Schema** | `lr_dev_aws_us_catalog.solvency2demo_v2` |
| **Pre-flight** | `./scripts/preflight_check.sh` (run before walking on stage) |
| **Cache bake** | `./scripts/bake_cache.sh` (run once before the talk) |
| **Cue cards** | [`docs/cue_cards.md`](docs/cue_cards.md) |
| **Fallback summary** | [`docs/demo_fallbacks/index.html`](docs/demo_fallbacks/index.html) |

> **Pre-flight required before stage:** run `./scripts/preflight_check.sh`. If it returns non-zero,
> fix or fall back to cached mode (sidebar toggle → "Cached") before going on.

---

## Title slide

**Solvency II at the Speed of Lakehouse**
A working demo of the actuarial cycle on Databricks. Bricksurance SE, Q4 2025.

Talk length: 25 min canonical, 15 min cut available. Three sections:

1. **Opening** (3 min) — regime + integration tax problem
2. **Demo: Monday morning at a composite** (3:30 → 22:30 — 19 min)
3. **Close** (2:30) — architectural takeaway

---

## Opening (3 min, verbatim)

> *(Stand at the side of the stage. Architecture page open behind you, but don't talk to it yet.)*

Solvency II is the European prudential framework for insurance.
It's been live since 2016. Three pillars:
**Pillar 1**, the capital you must hold.
**Pillar 2**, the governance around how you decide what to hold.
**Pillar 3**, the disclosure of both — to your supervisor, and to the public.

If you're an insurance actuary in Europe, your year is structured by these pillars.
You spend the first six weeks of every quarter producing the Pillar 1 quantitative reporting templates.
You spend the rest of the year producing Pillar 2 reports — your ORSA, your actuarial function report, your model governance — and the public Pillar 3 SFCR.

> *(Walk centre stage. Click to architecture diagram.)*

This is what most insurers' Solvency II stack looks like underneath.
Prophet for life valuation. Igloo for cat models. ResQ or Radar for non-life reserving.
Tagetik or one of its competitors for the actual reporting templates.
Excel filling the gaps. SharePoint for the audit trail. FTP and email for everything that doesn't fit.

I've sat in actuarial functions for ten years. I have never seen this be calm.
The integration cost — pulling the same numbers between these systems, reconciling them,
explaining differences to the auditor — is the **integration tax**, and it's where most of the cycle's stress lives.

> *(Click to right-hand side of architecture diagram.)*

What you're going to see today: the same engines, on a single layer.
Prophet still does life. Igloo still does cat. The actuarial method doesn't change.
What changes is the surface area on top — pipelines, governance, disclosure all sitting on
the same data, the same governance, the same audit trail.

Bricksurance SE — a synthetic mid-size European composite — is going to close their
Q4 2025 cycle in front of you. Twenty minutes. Three pillars.

> **Talk title beat:** *Solvency II at the Speed of Lakehouse.*

---

## Demo opening — set the scene (3:30, 30 seconds)

> *(Click to the app. Forum-mode landing.)*

This is Maria's view on Monday morning. She's the Head of Finance & Reporting at Bricksurance.
The reporting deadline is Friday. The cycle she's running covers about
EUR 6.4 billion of assets, EUR 2 billion of GWP on the P&C side, and EUR 2 billion of life
technical provisions. Composite, in one place.

Three pillars. Capital. Governance. Disclosure.
Each column shows the deliverables and a live status pill — green, amber, red.

> **[15-MIN CUT]** Skip the colour explanation; just say "three pillars" and click into Monitor.

---

## Scene 1 — Control Tower (4:00, 1:30 → 5:30)

> *(Click "Begin demo →" / Monitor.)*

This is the Control Tower. Same data layer, but framed as **what does Maria need to know in 60 seconds?**
Six attention items at the top — these are real, computed live.

1. **Reinsurance feed late** — the broker bordereau arrived eight business days late. There is the timestamp.
2. **47 quarantined claims** — flagged by the DLT expectation, all tagged `legacy_pre_migration`.
3. **December storm** — 60% of property claims clustered on the 18th–31st, tagged `storm_dec_2025`.
4. **Life lapse spike** — unit-linked book up 34% relative to Q3.
5. **EUR 2.3M reconciliation gap** — a duplicate ISIN in the asset register.
6. **Challenger model pending** — 2026 calibration sitting next to Champion at +4% SCR.

Six things to triage. Every other process this team uses — email, Excel, spreadsheets — is
designed to delay you noticing these. This screen is designed to make you notice in 60 seconds.

> **Punchline:** *Same data. Different surface.*

> **[15-MIN CUT]** Walk through 3 of the 6 (A, C, E). Skip D and F.
> **Recovery:** if Q4 pains panel shows "0 firing", the data didn't load — switch to cached mode and continue.

---

## Scene 2 — Drill into Pain B: the DQ break (5:30 → 7:00, 1:30)

> *(Click on Pain B card → Data Quality.)*

47 claims, all from a system source called `legacy_pre_migration`. Sister systems — `core_v3` —
processed everything else fine. Look at the gross_paid column: every one of them is negative.
A subrogation reversal pattern that the legacy system reports as a negative, the new core
expects as a separate event.

> *(Open SQL panel.)*

Same Unity Catalog table. Same DLT expectation that quarantined them — this is a row constraint:
`gross_paid >= 0`. The 47 rows didn't make it into the gold layer. They're not in S.05.01. They're not in any QRT.

> **Punchline:** *The DLT pipeline didn't ask for permission. It quarantined and continued.*

> **[15-MIN CUT]** Skip — already established the principle in scene 1.

---

## Scene 3 — Pillar 1: SCR breakdown (7:00 → 9:00, 2:00)

> *(Click /scr — Pillar 1 chip.)*

S.25.01 — the SCR template. The full standard formula breakdown. Five risk modules — market,
default, life, health, non-life. They're correlated through the Annex IV correlation matrix.
This is real actuarial maths. **The model that runs this is registered in Unity Catalog.**

> *(Open Model Governance.)*

Champion v2025. Challenger v2026. The Challenger encodes: NL UW correlation +1.5%, op risk → 4%,
life lapse stress ×1.15. Live calculation, ~+4% SCR.

> *(Point at the side-by-side numbers.)*

Whoever decides whether Challenger gets promoted to Champion — that's a Pillar 2 governance decision —
records it here. Buttons. Comments. Persisted.

The point: **the actuarial calculation, the model registry, and the approval decision live in the same place.**

> **Punchline:** *Pillar 1 + Pillar 2, not stitched together.*

> **[15-MIN CUT]** Skip the model-governance side — stay on the SCR breakdown.

---

## Scene 4 — Pillar 2: ORSA (9:00 → 13:00, 4:00) — KEYNOTE SCENE

> *(Click /orsa.)*

ORSA — Own Risk and Solvency Assessment. Pillar 2. Forward-looking.

Five pre-loaded scenarios. Pick the December storm — 1-in-200 nat cat. Run.

> *(Click Run scenario. ~3 seconds.)*

Same SCR engine that produced Pillar 1's number, now applying the scenario shock.
Recomputed BSCR. Three years of projection using the business plan assumptions.

> *(Point at the capital path chart.)*

Solvency ratio under base. Solvency ratio under scenario. You can see exactly where it gets uncomfortable.

> *(Click Generate narrative.)*

Foundation Model API. Reads the actual numbers from this run, drafts the Board commentary.
Pillar 2 chip top-right of the result.

> *(Read first sentence of narrative aloud.)*

Same numbers. Same data. Now in language a Board can read in five minutes.

> **Punchline:** *ORSA isn't a separate document anymore. It's a button.*

> **[15-MIN CUT]** Skip narrative generation — just show the chart and move on. Saves ~90s.
> **Recovery:** if the narrative call fails, sidebar toggle to Cached and click Generate again.

---

## Scene 5 — Pillar 3: SFCR with citations (13:00 → 16:30, 3:30)

> *(Click /sfcr.)*

Pillar 3, public disclosure. Five sections. Click "Generate draft" on Section C — Risk Profile.

> *(Wait ~5 seconds. Output appears.)*

Look at the inline chips. **Every quantitative claim is anchored to the gold table and cell it came from.**
You can hover, you can click, an auditor can trace the path from the public report
down to the raw data in seconds.

> *(Click Preview to show citations rendered as chips.)*

Same engine drafts every section. Same engine drafts the RSR — the supervisor-only twin —
with two extra confidential sections.

> **Punchline:** *Disclosure that an auditor can trust because they can verify it.*

> **[15-MIN CUT]** Skip the preview/click-through; just generate one section and read the first paragraph.

---

## Scene 6 — Internal Controls + close (16:30 → 19:30, 3:00)

> *(Click /internal-controls.)*

12 AI guardrails. Layered. Each one points at the source code that implements it.

> *(Point at the architectural assertions.)*

Three architectural invariants this platform enforces:
1. AI cannot approve. The approval workflow requires a human X-Forwarded-User. AI agents have no path to approve.
2. AI is read-only against regulatory tables. App service principal has SELECT on raw/staging/gold;
   only `6_ai_*` tables (drafts, narratives, approvals) are writable.
3. Every AI output is hashed. AFR + SFCR + ORSA narratives all carry SHA-256 content hashes.

The audit trail is a Delta table. Every API call. Who, when, status, duration.

> **Punchline:** *Pillar 2 governance isn't a policy document. It's the architecture.*

> **[15-MIN CUT]** Skip the audit log; show only the matrix + 3 invariants.

---

## Close (22:30 → 25:00, 2:30)

> *(Click back to Architecture page.)*

Same engines. Same actuarial methods. New surface area.

You don't need to rebuild Prophet. You don't need to throw away Igloo. The **integration tax**
is what gets removed when the data, the pipelines, the AI, and the disclosure all sit on
the same governed substrate.

For a mid-size composite — Bricksurance — this means the actuarial team spends Friday
producing the regulatory submission instead of producing it on Wednesday and then
spending Thursday and Friday explaining the differences between five copies of the same number.

This isn't a Databricks product. It's a working demonstration of what you can build on Databricks.
The source is on GitHub. Deploy it to your own workspace, point it at your own data.

> **Closing line:** *Solvency II at the speed of lakehouse — same regulation, less tax.*

---

## Recovery cheatsheet

| If this fails… | Do this. |
|---|---|
| Q4 pains panel shows zero firing | Refresh; if still zero, fix data (re-run preflight). Don't read from the spec. |
| ORSA "Run scenario" hangs | Sidebar toggle → Cached. Click Run again. |
| ORSA narrative fails | Sidebar toggle → Cached. The bake is pre-populated. |
| AFR / SFCR draft fails | Same — switch to Cached and re-click Generate. |
| Whole app is down | Go to `docs/demo_fallbacks/index.html` (open the file or print-to-PDF beforehand). |
| Slide doesn't render the architecture | Open `/architecture` in a second tab during opening; use it as the slide. |

## Cuts at a glance

| Scene | 25-min | 15-min |
|---|---|---|
| Opening | 3:00 | 1:30 (skip detail of integration tax) |
| Scene 1 — Control Tower | 1:30 | 1:00 (3 of 6 pains) |
| Scene 2 — DQ break | 1:30 | SKIP |
| Scene 3 — SCR + Model Gov | 2:00 | 1:00 (skip Model Gov) |
| Scene 4 — ORSA | 4:00 | 3:00 (skip narrative) |
| Scene 5 — SFCR | 3:30 | 2:00 (skip preview) |
| Scene 6 — Internal Controls | 3:00 | 2:00 (skip audit) |
| Close | 2:30 | 1:30 |
| **Total** | **25:00** | **13:00** (room for 2 min of drift) |

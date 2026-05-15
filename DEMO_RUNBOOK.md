# Solvency II at the Speed of Lakehouse — Forum Talk Runbook

**Insurance Industry Forum · Bricksurance SE · Q4 2025**
**Slot: 25 minutes (15-minute cut also marked)**

---

## Thesis — locked

> Databricks is the **actuarial workbench** of the next decade — the place where actuarial work *lives*, not another tool to be plugged in alongside the others. Solvency II is the proof case. The same data, the same governance, the same AI applies to every other actuarial workflow tomorrow.

> **Comprehensive build, surgical demo.** The platform is built broadly enough to handle ad-hoc questions on stage. Only four scenes are polished to keynote quality. Reserving, SF, Igloo, and Prophet stay mock or example-quality — *vehicle, not cargo*. The actuarial science isn't ours; it stays where it is. The layer underneath is what the workbench provides, for the first time.

---

## The four polished scenes

| # | Time | Scene | Where to click |
|---|------|-------|----------------|
| 1 | 3:00–6:30  | **Control Tower** — operational pain visibility | `/monitor` |
| 2 | 6:30–11:00 | **Senior Reserving Actuary + Overlays** | `/lab/reserving_pnc` |
| 3 | 11:00–15:00| **Audit panel on a QRT** | `/report/s0501` → Audit tab |
| 4 | 15:00–20:00| **ORSA scenario run** | `/orsa` |

Plus the **Workbench Assistant** (floating chat, every page) for tangent recovery.

---

## Audience-flex matrix

This is a starting point, not gospel. Read the room and swap.

| Audience | Scene 1 | Scene 2 | Scene 3 | Scene 4 |
|---|---|---|---|---|
| **Forum / mixed** (default) | Control Tower | Reserving agent + overlay | Audit panel | ORSA stress |
| **Chief Actuary 1:1** | Actuarial Lab + dev/prod | Reserving agent + overlay | Overlays Register lifecycle | Cross-QRT recon catch (Pain G) |
| **CFO / CRO 1:1** | Control Tower | ORSA stress | Audit panel | Workbench landing |
| **Big4 implementation lead** | Lab + dev/prod | Audit panel | SFCR drafting | Regulator Q&A |
| **CTO / data lead** | Lab + dev/prod | Lineage tab in audit panel | Ask Workbench | Workbench landing |
| **Regulator** | Audit panel | Overlays Register | Cross-QRT recon | Internal Controls |

---

## Pre-flight before walking on stage

```bash
make preflight                           # 30+-check probe; green/red per check
./scripts/bake_cache.sh                  # cache AI outputs for the 4 scenes
```

Both must pass. If preflight fails on a scene used in your selected matrix row, set `DEMO_MODE=cached` in the app's `app.yaml` and redeploy — the cached path serves the AFR / SFCR / RSR / ORSA panels even when the FM API is down.

---

# 25-minute talk script

## 1. Open — verbatim · 0:00–3:00

> **"Good morning. I want to start with a question.**
>
> *[pause]*
>
> **Who in your organisation is responsible for the entire Solvency II process? Not a pillar. Not a QRT. Not a reserving cycle. The whole thing — from data arriving to disclosure being submitted.**
>
> *[pause]*
>
> **If you're like most insurers I've worked with, the honest answer is: nobody. Or more accurately — a senior actuary holds it in their head, a finance director holds it in a spreadsheet, and a Big4 implementation from a few years ago holds it in code nobody touches anymore.**
>
> *[pause]*
>
> **This isn't a criticism of your team. It's the structure of the market. Every tool you've bought is excellent at its slice. ResQ is the best at being ResQ. Igloo is the best at being Igloo. Tagetik is the best at being Tagetik. But none of them have a commercial reason to care about what happens upstream of them or downstream of them. Their job is their slice. The whole picture isn't anybody's job.**
>
> *[pause]*
>
> **So what we're going to show you today isn't another tool for your stack. It's what your Solvency II function looks like when *somebody finally owns the whole view*. Built on data you already have. Running on infrastructure most of you already have. With AI and governance most of you have already paid for.**
>
> *[pause]*
>
> **The actuarial science stays where it is. The capital models, the reserving methodologies, the stochastic engines — those are decades of work, they're not what we're touching. We're showing you the layer underneath that ties all of it together for the first time.**
>
> *[pause]*
>
> **Let's go to the Monday after Q4 close."**

---

## 2. Scene 1 — Control Tower · 3:00–6:30

**Click:** sidebar → Control Tower (`/monitor`).

**Operator notes:**
- The slate-900 hero strip shows "Q4 2025", deadline 2026-02-22, business-day countdown, pulsing health dot, four KPI tiles. Let the audience read it for two beats.
- **Key landing:** *"This is the Monday morning view nobody on your team has today."*
- Walk down the screen, naming each engineered pain as you go (read the labels on the Q4 attention items panel, in order):
  - **Pain A** — RI feed late
  - **Pain B** — 47 quarantined claims (legacy_pre_migration source)
  - **Pain C** — Property reserve spike (Dec storm tagged)
  - **Pain D** — Life lapse uplift (unit-linked Q4 vs Q3)
  - **Pain E** — Asset / own-funds reconciliation gap
  - **Pain F** — Challenger model pending
  - **Pain G** — Reserve-capital divergence (Q4 reserving overlay applied; capital model still on Q3 parameter)
- Don't fix anything yet. The point is *visibility* — every problem on one screen, not buried six clicks down.
- **Closing line:** *"Every one of these would normally take a senior actuary an hour of triage to even find. Here, they're the first thing you see Monday morning."*

**[15-min cut]** — keep but cap at 2 minutes. Skip Pain F + Pain G in the read-through; just point at them.

---

## 3. Scene 2 — Senior Reserving Actuary + Overlays · 6:30–11:00

**Click:** sidebar → Actuarial Lab → Reserving — P&C (`/lab/reserving_pnc`).

**This is the actuarial wow moment. Most important scene. Don't rush.**

**Operator notes:**

1. Open the model detail page. Show the 5 tabs (Versions / Diagnostics / Approvals / Lineage / Promote). Let the audience see this is a registered MLflow model with a production alias and a candidate, just like SF.
2. Above the tabs, point at the Senior Reserving Actuary panel. *"This is where the platform stops being passive. The agent reads the production reserving output, compares to last quarter, and surfaces what's worth a senior actuary's eye."*
3. **Click "Run reserving review."** Four-stage progress sequencer plays. Then output streams in, character by character.
4. While it streams, narrate:
   > *"The agent isn't running the actuarial science. It's reading the same numbers the reserving committee will look at, comparing against last quarter, and flagging the material movements. The methodology stays where it is."*
5. When the streaming finishes, point at the "Proposed overlays" cards. *"For each anomaly, the agent proposes an overlay. Magnitude, category, rationale. But — crucially — the agent cannot create overlays."*
6. Read the ending line aloud: **"This decision is yours."**
   > *"That phrase isn't a UX flourish. It's the architecture. Agent does the analysis, actuary does the judgement, platform captures both with full audit."*
7. **Click "Create overlay from this suggestion"** on the property storm proposal.
8. Modal opens. *"Pre-filled from the agent's suggestion. The actuary edits — magnitude, rationale, whatever they need. Then submits for approval."* Edit the rationale slightly to prove it's editable.
9. **Click "Submit for approval."** Modal closes. The recent-overlays mini-feed below the panel updates immediately — the new overlay row flashes emerald.
10. **Click "approve"** on that row (you're playing both roles). The status flips to approved.
11. **Closing line:** *"That overlay is now part of the system. Lineage-linked to S.05.01 and S.25.01 cells. Carried into the audit panel of every QRT it affects. We didn't fix anything in code. The actuarial team did their job; the platform recorded that they did."*

**[15-min cut]** — keep the streaming + the "decision is yours" moment + the modal. Skip the simulated approval click.

---

## 4. Scene 3 — Audit panel on a QRT · 11:00–15:00

**Click:** sidebar → Reserving & TPs (P&C) → opens `/report/s0501` → click the **Audit** tab.

**Operator notes:**

1. *"This is S.05.01 — premiums, claims, and expenses for Q4. The QRT itself is in the Content tab. We're going straight to Audit, because every QRT carries this, automatically, every quarter."*
2. **Data tab** — read the QRT-table version + timestamp at the top. Then the source-tables list. *"Each one has a row count for this quarter, plus the Delta version + timestamp it was at when this QRT was built. I can drill into any one to see the actual rows."*
3. **Code tab** — *"The notebooks that produced this QRT — git-tracked, every run logged. Not commentary; the actual artefacts."*
4. **Models tab** — point at `reserving_pnc` v9, approver, approved_at. *"The production reserving model that contributed to this QRT. Click through and we're back in the Lab — same model, same governance interface."*
5. **Approvals & Overlays tab** — show the three Q4 overlays, including the storm overlay we just created. *"Every overlay that affects this QRT, with author, approver, rationale, lineage-linked to specific cells."*
6. **Lineage tab** — the SVG dependency graph. Hover a node to highlight its dependencies; the unrelated nodes dim. *"Bronze, silver, models, gold. Hand-curated map of where every value in this QRT came from. Click any model node to open the Lab detail."*
7. **Closing line:** *"Every QRT carries this. Every quarter. Automatically. The audit isn't an attestation; it's the artefact. They're the same thing now."*

**[15-min cut]** — show Data + Lineage tabs only. Skip Code, Models, Approvals & Overlays in the read-through (mention they exist).

---

## 5. Scene 4 — ORSA scenario run · 15:00–20:00

**Click:** sidebar → ORSA (`/orsa`).

**The CFO/CRO wow moment. Not "AI can write" — "six weeks of work, an afternoon".**

**Operator notes:**

1. Read the page header. *"ORSA — Own Risk and Solvency Assessment. Pillar 2. Once a year, the board needs to know how the firm holds up under stress."*
2. Show the three scenario cards. *"1-in-200 nat cat. Equity shock minus 30%. Mass lapse plus 35%. The actuarial team defines these as configs in Unity Catalog, not code."*
3. Pick **1-in-200 nat cat**. **Click "Run scenario."**
4. Live progress panel renders for ~18 seconds. Five stages, sequenced, with check-marks lighting up as each completes. While it runs:
   > *"Behind the scenes: the engine reads the base SCR, applies the scenario shocks to specific sub-modules, re-aggregates BSCR through the EIOPA correlation matrix, projects three years forward using the business plan assumptions, and persists everything to a Delta table."*
5. **Capital path chart** appears with left-to-right reveal animation. Two lines — base in blue, stress in red/amber/green depending on severity. Lowest-stress point gets an annotation.
6. *"Three-year projection. Solvency ratio dips to ~257% in Year 0 and recovers as own funds rebuild. Above the regulatory threshold. The kind of chart the board needs to see, not invent."*
7. **Click "Generate narrative."** AI-drafted text streams in over ~20 seconds. While it streams:
   > *"This is the narrative drafted from the same data — same numbers, same scenario, same business plan. It's not 'AI generates text'. It's the platform writing the section a senior actuary would otherwise spend a week drafting from spreadsheets."*
8. When the stream finishes, the green "saved · gold_orsa_narratives" stamp appears. *"Versioned, hashed, audit-logged. If we re-run, we don't overwrite — we add a new version."*
9. **Closing line:** *"This used to be six weeks of Excel work and three days of writing. Now it's a thirty-second run and a paragraph that reads like an SFCR section. Not faster. Coherent."*

**[15-min cut]** — pre-stage one scenario already-run (visible as you arrive on the page). Run a fresh one but skip the narrative generation; show a previously-baked one instead.

---

## 6. Actuarial Workbench landing · 20:00–22:30

**Click:** sidebar brand → "Actuarial Workbench" (`/`) for the closing surface.

**Don't enumerate every tile.** Pick two or three based on the audience. The grid carries the rest.

### Audience-specific picks

| Audience | Highlight these tiles |
|---|---|
| **CFO / CRO** | Solvency II (live) · Pricing (live) · IFRS 17 (roadmap) |
| **Chief Actuary** | Solvency II · Reserving deep dive · SAS migration (in progress) |
| **Big4 / consultancy** | All eight — they're the implementation channel |
| **CTO / data lead** | Pattern reusability + governance consistency across all tiles |
| **Mixed forum** | Solvency II · Pricing · IFRS 17 · SAS migration |

### Operator notes

1. Land on `/`. *"Solvency II is what we showed today. Now look at this."*
2. *"Same data, same governance, same AI, same audit. Each tile extends from the platform you've already paid for."*
3. Pick the audience-specific tiles above. For each, hit two beats:
   - *"This is adjacent because [the description on the tile]."*
   - *"Same Lab interface, same overlays register, same audit panel. The work moves to where the data already lives."*
4. Hover over the in-progress tiles (SAS, Excel migration) — *"Two worked examples being built right now. Reserving + capital procedures, line by line, with parity tests."*
5. Pause for two beats. Don't talk over the grid.
6. **Closing line:** *"You didn't buy a Solvency II solution. You bought a workbench that does Solvency II beautifully today, IFRS 17 next year, pricing the year after. Same data. Same governance. Same AI. Same audit. The next workflow you're under pressure on extends from here."*

**[15-min cut]** — open the Workbench landing, deliver the closing line over the grid, then move to Close.

---

## 7. Close — verbatim · 22:30–25:00

> **"Let me land where I started.**
>
> *[pause]*
>
> **Solvency II didn't become simpler. The work didn't go away. The reserving committee still meets every quarter. The senior actuary still owns the technical-provisions calculation. The CFO still signs the SFCR. None of that changed.**
>
> *[pause]*
>
> **But the platform underneath it stopped being the thing that slowed you down. The data lives in one place. The governance is one motion. The AI is grounded in your numbers, not generic. The audit travels with the artefact. The whole picture is somebody's job — actually, it's everybody's job, because everyone is looking at the same view.**
>
> *[pause]*
>
> **What you saw today wasn't a faster Solvency II. It was a coherent one. And the same data, the same governance, the same AI applies to every other actuarial workflow tomorrow.**
>
> *[pause]*
>
> **Same Igloo. Same Prophet. Same reserving methodology. New surface area. The integration tax is what got removed.**
>
> *[pause]*
>
> **Solvency II at the speed of lakehouse — same regulation, less tax. Thank you."**

---

# Tangent recovery — anticipated questions

If someone asks something off-script, don't fight it. Use the **Workbench Assistant** (the floating violet button) for anything operational, or navigate to one of the affordances below.

### Q: "How would I model reserving in Databricks?"
**Open:** Model Development → Worked Examples → `reserving_chain_ladder.py`. Or open the notebook directly via the "Open in workspace" button.
**Say:** *"Worked example. Illustrative methodology — your actuaries or your consultants would build the production version. The platform around it is what you saw in the demo."*

### Q: "Show me Q1 2025's audit."
**Click:** Governance → Audit Trails → filter period = 2025-Q1 → click any QRT row.
**Say:** *"Every QRT carries its audit panel — data, code, models, approvals, lineage. Filtered library here, drill down to any one."*

### Q: "How do you govern AI agents?"
**Click:** Governance → AI Governance tab. Then the *View agent architecture* link.
**Say:** *"Every agent is a UC-registered MLflow model with a serving endpoint. Every routing decision is traced. The tools they call are UC Functions. Same governance interface as any other model."*

### Q: "How would we integrate our existing cat model / capital engine?"
**Click:** Model Development → External Engines → Igloo card.
**Say:** *"This is the pattern: export to a UC Volume, run the engine, ingest the result, validate. Five steps, all notebook code, all visible."*

### Q: "What's the status of [some specific operational thing] right now?"
**Click:** floating Workbench Assistant button (bottom right).
**Say:** *"Let me ask the assistant."*
Type the question. The agent queries the governance tables, summarises with citations, no write access. Reads from `6_gov_promotions`, `6_gov_overlays`, `5_mon_*`.

### Q: "Can you show me Q1 2025's data?"
**Navigate:** any QRT detail → date selector (when shipped) → Q1 2025.
**Say:** *"Delta time travel. The full Q1 audit, with Q1's overlays and Q1's model versions. Same affordance for any quarter, going back as far as your retention policy."*

### Q: "What about IFRS 17 / matching adjustment / group reporting?"
**Navigate:** Workbench landing (`/`) → click the IFRS 17 roadmap tile.
**Say:** *"On the roadmap — same architectural pattern. Data lives in UC, models live in MLflow with aliases, agents are read-only, audit travels with the artefact. The thesis doesn't change."*

### Q: "Are you replacing ResQ / Igloo / Prophet?"
**Click:** Actuarial Lab (`/lab`) — show that Igloo and Prophet are peer rows alongside native UC models.
**Say:** *"No. Look at the Lab — they're peers to native models, treated identically. If you want to keep them, keep them. If you want to migrate over time, the platform supports that. Customer choice. The point of the Lab is the *interface* — your governance team works with all five models the same way."*

### Q: "Who can create overlays? What's stopping someone from gaming the numbers?"
**Click:** Overlays Register — show an existing overlay's detail drawer.
**Say:** *"Overlays have authors, approvers, dates, magnitude, category, rationale, lineage-link to QRT cells. Magnitude-thresholded approvals. Every overlay is in a Delta table — versioned, audit-logged, queryable. Audit committee or supervisor sees the same view we do."*

### Q: "What happens if your AI hallucinates a number?"
**Click:** any AFR or SFCR draft — point at the citation chips inline `[3_qrt_s2501_summary · scr_eur]`.
**Say:** *"Every quantitative claim cites the underlying gold table cell. Auditor-traceable. If the model invents a number that doesn't trace, the citation chip is broken — visible. The drafting workflow is human-review, AI-assist, not AI-decide. The actuary signs the document."*

### Q: "How does this scale to a multi-entity group?"
**Say:** *"Each entity gets its own catalog — Unity Catalog handles the isolation. Group consolidation runs as a layered DLT pipeline that reads the entity-level gold tables and produces the group QRTs. Same workbench shape, multiple instances. Out of scope for today's demo."*

### Q: "What about regulatory changes? EIOPA updates, new templates."
**Click:** Lab → SF model → Versions.
**Say:** *"Calibration changes are model-version changes. New EIOPA factor set means a new candidate version of the SF model. Run diagnostics, get sign-off, promote. Same workflow whether the change is internal or regulatory."*

### Q: "What's the Workbench Assistant *not* able to do?"
**Say:** *"It cannot write. It has read-only access to the governance tables and the gold layer. It can answer 'where are we?' and 'where did this come from?'. It can't approve, promote, create overlays, or change a QRT. The actuary owns those actions. Same architectural decision as the reserving agent."*

---

# Operator timing reference

| Total elapsed | Should be on | Cue |
|---|---|---|
| 3:00 | Control Tower hero strip visible | "Monday morning view…" |
| 6:30 | Reserving Lab page open | "Most important scene." |
| 11:00 | S.05.01 Audit tab open | "Every QRT carries this." |
| 15:00 | ORSA page open | "Six weeks → an afternoon." |
| 20:00 | Workbench landing | "Workbench, not tool." |
| 22:30 | Close — verbatim | Land understated. |

If you're behind at 15:00, cut the Audit-tab walk to Data + Lineage only. If behind at 20:00, skip the per-tile walk — just open the landing and verbalise the closing line.

---

# What's *not* polished (don't open these on stage unless asked)

- AFR / SFCR / RSR drafting pages — work, but presentation-grade Phase 2 polish was scoped to the four scenes
- Internal Controls page — works
- Genie integration — works but slow on cold start
- Regulator Q&A — works

If a question takes you here, it's a tangent — keep it tight, then come back.

---

# Reference — current Q4 2025 numbers (Bricksurance SE composite)

- **SCR** EUR 556 M
- **Eligible own funds** EUR 1.85 B
- **Solvency ratio** 333%
- **NL UW SCR** EUR 524 M (61% catastrophe component)
- **Life TPs (best estimate)** EUR 2.0 B
- **Asset register** EUR 6.4 B
- **Gross written premium** EUR 2.0 B
- **Storm overlay** +EUR 18.5 M (one-off-event, property)
- **Motor 2023 AY overlay** −EUR 2.0 M (methodology, single distorting claim)
- **Liability tail extension** +EUR 4.5 M (renewed-from-prior)
- **Pain G — reserve-capital divergence** EUR 8.2 M understated SCR

---

*This runbook supersedes earlier versions. Deliverable by anyone who's read it.*

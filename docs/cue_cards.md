# Cue cards — Solvency II at the Speed of Lakehouse

> Print as PDF: `make cue-cards.pdf` (requires pandoc + xelatex). Each scene is a single A5
> page, glance-readable on stage. Numbers in `[brackets]` are total-elapsed targets, not
> scene durations.

---

## Card 0 — Pre-flight (60 seconds before walking on)

```
□ make preflight                                  must show 30+/30+ PASS
□ ./scripts/bake_cache.sh                         AI outputs warmed (re-run if any agent prompt changed)
□ Open Control Tower at /monitor                  hero strip + 7 pains visible
□ Verify floating Workbench Assistant button      bottom-right, every page
□ Cue cards visible (this doc, A5 folded)
□ Water within reach
```

If FM API is misbehaving:
```
□ Set DEMO_MODE=cached in src/app/app.yaml
□ Bundle deploy + re-import override + apps deploy
□ Verify cached AI outputs serve (?cached=1 on AFR/SFCR/RSR/ORSA endpoints)
```

---

## Card 1 — Open · 0:00 → [3:00]

**Click:** sidebar collapsed; clean projector showing Control Tower in background.

**Verbatim — read with pauses, no rush:**

> Good morning. I want to start with a question. *[pause]*
> Who in your organisation is responsible for the entire Solvency II process?
> Not a pillar. Not a QRT. Not a reserving cycle. The whole thing.
> *[pause]*
> If you're like most insurers I've worked with, the honest answer is: nobody.
> A senior actuary holds it in their head. A finance director holds it in a
> spreadsheet. A Big4 implementation holds it in code nobody touches anymore.
> *[pause]*
> ResQ is excellent at being ResQ. Igloo is excellent at being Igloo. None of
> them have a commercial reason to care about what happens upstream or
> downstream. The whole picture isn't anybody's job.
> *[pause]*
> Today we'll show what your Solvency II function looks like when *somebody
> finally owns the whole view*. Built on data you already have. With AI and
> governance most of you have already paid for.
> *[pause]*
> The actuarial science stays where it is. We're showing you the layer
> underneath that ties it all together. Let's go to the Monday after Q4 close.

---

## Card 2 — Scene 1 · Control Tower [3:00 → 6:30]

**Click:** sidebar → Control Tower (`/monitor`).

**Verbatim landing line:**
> *"This is the Monday morning view nobody on your team has today."*

**What to point at, in order (top to bottom):**
1. Hero strip → quarter, deadline countdown, traffic-light health, KPI tiles
2. Q4 attention items panel → walk Pains A through G

**Per-pain one-liner:**
- A: *"Reinsurance feed is 8 business days late."*
- B: *"47 quarantined claims, all from the legacy migration source."*
- C: *"Property reserves up — December storm tagged."*
- D: *"Life lapse spiked in unit-linked, +34%."*
- E: *"€2.3M reconciliation gap — duplicate ISIN in S.06.02."*
- F: *"Challenger model pending Chief Actuary sign-off."*
- G: *"Reserve-capital divergence — overlay applied to reserves, capital model still on Q3 parameter."*

**Closing line:**
> *"Each of these is normally an hour of senior-actuary triage. Here, they're the first thing you see Monday morning."*

**[15-min cut]** Cap at 2 min. Skip Pain F + G read-through.

**Recovery if hero doesn't load:**
- Refresh page once. If still blank, fall back to fallback HTML at `docs/demo_fallbacks/index.html`.

---

## Card 3 — Scene 2 · Senior Reserving Actuary [6:30 → 11:00]

**Click:** sidebar → Actuarial Lab → Reserving — P&C (`/lab/reserving_pnc`).

**This is the actuarial wow moment. Slow down.**

**Phrases verbatim — drop these as the moments land:**
- *"Same MLflow registration as SF. Production alias, candidate alias, diagnostics, lineage."*
- (after streaming starts) *"The agent isn't running the actuarial science. The methodology stays where it is."*
- (after streaming finishes) *"For each anomaly, the agent proposes an overlay. But the agent cannot create overlays."*
- (read on screen) **"This decision is yours."**
- *"That phrase isn't a UX flourish. It's the architecture."*
- (after Submit) *"Lineage-linked to S.05.01 and S.25.01. Carried into the audit panel of every QRT it affects."*

**Click sequence:**
1. **Run reserving review** → wait through 4-stage progress, ~12s before stream starts
2. **Create overlay from this suggestion** on the property storm proposal → modal opens pre-filled
3. Edit rationale slightly to prove editability → **Submit for approval** → modal closes, recent-overlays row flashes emerald
4. **approve** on that row (act both roles)

**[15-min cut]** Skip step 4 (the simulated approve). Stop at "submitted for approval".

**Recovery:**
- If review API errors out: page refresh once. Otherwise show pre-baked review from `6_ai_demo_cache` (cached path).
- If modal doesn't pre-fill: navigate to `/overlays?new=1&...` deep link manually.

---

## Card 4 — Scene 3 · Audit Panel [11:00 → 15:00]

**Click:** sidebar → Reserving & TPs (P&C) → opens `/report/s0501` → click **Audit** tab.

**Opening line:**
> *"This is S.05.01. The QRT is in the Content tab. We're going straight to Audit, because every QRT carries this, automatically, every quarter."*

**Tab walk — keep moving, ~30 seconds per tab:**
- **Data** → "Each source table — version, timestamp, row count for this quarter."
- **Code** → "The notebooks that produced it. Git-tracked."
- **Models** → "reserving_pnc v9. Click through and we're back in the Lab."
- **Approvals & Overlays** → "The three Q4 overlays, including the storm one we just created."
- **Lineage** → hover a node → "The dependency graph for every value in this QRT."

**Closing line:**
> *"Every QRT carries this. Every quarter. Automatically. The audit isn't an attestation; it's the artefact. They're the same thing now."*

**[15-min cut]** Show Data + Lineage only. Mention the others.

**Recovery:**
- If Audit tab errors: cached source-table list and lineage graph still render from `/api/qrt/s0501/audit` cached path.

---

## Card 5 — Scene 4 · ORSA [15:00 → 20:00]

**Click:** sidebar → ORSA (`/orsa`).

**Opening line:**
> *"ORSA — Own Risk and Solvency Assessment. Pillar 2. Once a year the board needs to know how the firm holds up under stress."*

**Click sequence:**
1. Pick **1-in-200 nat cat** scenario card
2. **Run scenario** → live progress panel renders 5 stages over ~18s
3. While running, narrate: *"Reads base SCR, applies shocks, re-aggregates BSCR, projects three years, persists to Delta."*
4. Capital path chart appears with LTR animation. Lowest-stress callout lands.
5. Read the chart aloud → "*Solvency ratio dips to ~257% Year 0 and recovers."*
6. **Generate narrative** → text streams in over ~20s
7. While streaming: *"This is the platform writing the section a senior actuary would otherwise spend a week drafting."*
8. When green "saved · gold_orsa_narratives" stamp appears: *"Versioned, hashed, audit-logged."*

**Closing line:**
> *"Six weeks of Excel and three days of writing → a thirty-second run and a paragraph that reads like an SFCR section. Not faster. Coherent."*

**[15-min cut]** Pre-stage one already-run scenario. Run a fresh one but skip narrative generation; show a baked one.

**Recovery:**
- If `runOrsaScenario` errors: most likely SCR-results cold path. Refresh once.
- If narrative streaming hangs > 30s: cancel via Re-generate, or show previously-saved narrative from `gold_orsa_narratives`.

---

## Card 6 — Actuarial Workbench landing [20:00 → 22:30]

**Click:** sidebar brand → `/` (Actuarial Workbench landing).

**One sentence per tile:**
- Solvency II → *"What we showed today — live."*
- Pricing → *"Same data, same governance, different regime — also live."*
- IFRS 17 → *"Different reporting framework, same workbench shape."*
- Claims analytics → *"Same lineage, applied to a different question."*
- Reinsurance → *"Same engines, optimisation problem on top."*
- SAS / Excel migration → *"The two worked examples being built right now."*

**Closing line:**
> *"You didn't buy a Solvency II solution. You bought a workbench that does Solvency II beautifully today, IFRS 17 next year, pricing the year after."*

**[15-min cut]** Skip entirely.

---

## Card 7 — Close · verbatim [22:30 → 25:00]

> Let me land where I started. *[pause]*
> Solvency II didn't become simpler. The work didn't go away. The reserving
> committee still meets every quarter. The senior actuary still owns the
> technical-provisions calculation. The CFO still signs the SFCR.
> *[pause]*
> But the platform underneath stopped being the thing that slowed you down.
> The data lives in one place. The governance is one motion. The AI is
> grounded in your numbers. The audit travels with the artefact. The whole
> picture is somebody's job — actually, it's everybody's job, because
> everyone is looking at the same view.
> *[pause]*
> What you saw today wasn't a faster Solvency II. It was a coherent one.
> *[pause]*
> Same Igloo. Same Prophet. Same reserving methodology. New surface area.
> The integration tax is what got removed.
> *[pause]*
> Solvency II at the speed of lakehouse — same regulation, less tax.
> Thank you.

---

## Card 8 — Tangent recovery quick-reference

| If they ask… | Do this |
|---|---|
| "How would I model X in Databricks?" | Open `src/examples/` notebook |
| "What's the status of Y right now?" | Floating Workbench Assistant button |
| "Show me Q1 2025." | QRT page → date selector |
| "IFRS 17 / matching adjustment / group?" | Workbench landing (or verbal: "same pattern") |
| "Replacing ResQ / Igloo / Prophet?" | Lab page → "they're peers, customer choice" |
| "Hallucinated numbers?" | AFR/SFCR draft → citation chips inline |
| "Multi-entity group?" | Verbal: "catalog per entity, group consolidation as DLT" |
| "Workbench Assistant scope?" | Verbal: "read-only, can't write, can't approve" |

If you're more than 90 seconds into a tangent, pull the audience back: *"Let's get back to Q4 close."*

---

## Card 9 — Numbers cheat sheet (Bricksurance SE Q4 2025)

```
SCR                       EUR 556 M
Eligible own funds        EUR 1.85 B
Solvency ratio            333%
NL UW SCR                 EUR 524 M  (61% cat)
Life TPs (best estimate)  EUR 2.0 B
Assets                    EUR 6.4 B
GWP                       EUR 2.0 B

Storm overlay (P)        +EUR 18.5 M  one_off_event
Motor 2023 AY overlay    -EUR  2.0 M  methodology_judgement
Liability tail (renewed) +EUR  4.5 M  tail_extension
Pain G divergence        +EUR  8.2 M  understated SCR
```

If audience asks for an exact number not on this card, say *"let me pull it up"* and use the Workbench Assistant.

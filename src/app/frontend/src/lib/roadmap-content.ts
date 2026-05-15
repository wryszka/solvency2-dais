/**
 * Roadmap stub content — one entry per roadmap tile.
 *
 * Adding a roadmap tile = (1) entry in workbench-tiles.ts, (2) entry here. No
 * per-tile component file needed.
 */
export interface RoadmapEntry {
  what: string;                                    // What this workflow covers (1 paragraph)
  workbench_capabilities: string[];                // Bullets — how it extends the workbench
  adjacent_links: { label: string; to: string }[]; // Live patterns to point at
}

export const ROADMAP_CONTENT: Record<string, RoadmapEntry> = {
  pricing: {
    what: "Rate-making for non-life lines: GLM/GBM models, market-rate alignment, " +
      "underwriting-control checks, bias monitoring across protected attributes. " +
      "The same exposure + claims data that feeds reserving and SF.",
    workbench_capabilities: [
      "GLM / GBM models registered in Unity Catalog as MLflow pyfuncs — same governance interface as the SF + reserving models in the Lab.",
      "Mosaic AI for serving real-time quote requests; production / candidate aliases for safe rollout of new rate plans.",
      "Bias monitoring as a Lab diagnostic: protected-attribute parity checks alongside the existing variance-vs-prior + reasonableness checks.",
      "Same Overlays Register pattern for underwriter overrides — magnitude, rationale, approver, audit-trailed.",
      "Same audit panel: every premium quote carries its source data, the model version that priced it, and the underwriter overlay (if any).",
    ],
    adjacent_links: [
      { label: 'See the model registry pattern (Standard Formula)', to: '/lab/standard_formula' },
      { label: 'See the overlay pattern (Overlays Register)', to: '/overlays' },
    ],
  },

  'ifrs-17': {
    what: "IFRS 17 financial reporting for insurance contracts: contract groups, " +
      "Contractual Service Margin (CSM), risk adjustment, fulfilment cashflows. Heavy " +
      "data overlap with Solvency II technical provisions.",
    workbench_capabilities: [
      "CSM + fulfilment-cashflow tables as a peer gold layer alongside the SII gold layer — same Delta + UC governance.",
      "Reuses the cashflow projection engine that drives life TPs (Prophet) — the IFRS 17 measurement model adds the CSM mechanics on top.",
      "Same audit panel: every CSM movement carries its lineage to the underlying contract group + assumption set.",
      "Same overlay register for unlocking adjustments and CSM smoothing decisions.",
      "Reverse path to SII: the CSM run can flag inconsistencies between IFRS 17 best-estimate and SII best-estimate.",
    ],
    adjacent_links: [
      { label: 'See the life technical provisions surface (S.12.01)', to: '/reserving-life' },
      { label: 'See the Audit panel pattern', to: '/report/s0501' },
    ],
  },

  reinsurance: {
    what: "Reinsurance program performance: treaty-level analytics, retrocession " +
      "optimisation, capital-relief modelling. Same exposures that feed Igloo's cat " +
      "model are the inputs an RI optimisation already needs.",
    workbench_capabilities: [
      "Treaty performance: per-treaty cession, recoveries, and net retention as a peer gold table.",
      "Retrocession optimisation: linear / convex programming models in UC reading the same exposure layers Igloo reads.",
      "Capital-relief calculator that ties RI structure changes back to the SF + Igloo SCR components — what-if for RI design.",
      "Same Lab interface — RI optimisation models are peer rows alongside reserving + SF + cat.",
      "Same audit + lineage: every RI decision carries its rationale, modelled benefit, and downstream SCR impact.",
    ],
    adjacent_links: [
      { label: 'See the cat engine (Igloo) in the Lab', to: '/lab/igloo_cat' },
      { label: 'See the Workbench landing', to: '/' },
    ],
  },

  'claims-analytics': {
    what: "Claim-level analytics: fraud signals, severity prediction, experience " +
      "monitoring, reserving feedback. Same claim transactions feeding S.05.01 and the " +
      "reserving model already feed these.",
    workbench_capabilities: [
      "Fraud / anomaly models registered alongside reserving and SF — uniform governance.",
      "Severity prediction at first notification of loss — informs case-reserve recommendations.",
      "Experience-monitoring dashboards drawn from the same gold tables, surfacing emerging trends to the reserving committee.",
      "Audit panel surfaces the model that flagged each claim, plus any analyst overrides as overlays.",
      "Closes the loop: insights from claims feed the next reserving + pricing cycle.",
    ],
    adjacent_links: [
      { label: 'See claim data in S.05.01', to: '/report/s0501' },
      { label: 'See the Senior Reserving Actuary agent', to: '/lab/reserving_pnc' },
    ],
  },

  'reserving-deep-dive': {
    what: "Deeper reserving capability beyond the chain-ladder + BF examples in the " +
      "Lab: methodology library, model validation framework, expert-judgement repository, " +
      "actual-vs-expected feedback loop.",
    workbench_capabilities: [
      "Methodology library: chain-ladder, Bornhuetter-Ferguson, Mack, GLM-based, peer-comparison — each registered in UC, governed identically.",
      "Validation framework: actual-vs-expected on a rolling cohort, automated tail-fit assessment, residual diagnostics — surfaces in the Lab Diagnostics tab.",
      "Expert-judgement repository builds on the Overlays Register — every judgement audit-trailed with rationale + magnitude.",
      "Quarter-over-quarter reserving committee dashboard with the Senior Reserving Actuary agent surfacing emerging trends.",
      "Direct lineage from each reserve estimate to the QRT cells it produces, surfaced in the audit panel.",
    ],
    adjacent_links: [
      { label: 'See the worked-example notebooks (chain-ladder, BF)', to: '/lab' },
      { label: 'See the Senior Reserving Actuary agent', to: '/lab/reserving_pnc' },
    ],
  },

  'sas-migration': {
    what: "Worked example — translating an actuarial SAS code-base (reserving procedures, " +
      "valuation routines, capital model logic) into PySpark / Spark SQL on the lakehouse. " +
      "The same actuarial methods, but governed, parallelisable, and auditable. Bring your " +
      "macros and DATA steps; leave with notebooks, MLflow-tracked models, and UC-managed " +
      "tables that any other workflow on the platform can read.",
    workbench_capabilities: [
      "Reference notebooks that take a representative SAS reserving program (chain-ladder + BF on triangles, with judgemental adjustments) and walk through the line-by-line conversion to PySpark — assignment-by-assignment, with both versions runnable side by side for parity testing.",
      "Pattern catalogue for the recurring SAS → PySpark conversions: DATA step → DataFrame transformation, PROC SQL → Spark SQL, PROC SUMMARY → groupBy, macro variables → notebook widgets, formats + informats → typed columns.",
      "MLflow-tracked parity harness: each conversion ships with paired runs (SAS reference vs PySpark candidate) on the same input data, with row-level diff reports and tolerance checks. Once parity holds for N quarters, the SAS leg is retired.",
      "UC governance from day one — the migrated routines land as pyfuncs in the Lab alongside reserving_pnc and standard_formula. Same Champion / Challenger flow, same diagnostics tab, same audit.",
      "Cost + performance side-by-side: SAS run-time + licence cost vs serverless DLT run-time on the same workload. Headline of every migration page.",
    ],
    adjacent_links: [
      { label: 'See the reserving model pattern (P&C)', to: '/lab/reserving_pnc' },
      { label: 'See the worked-example notebooks (chain-ladder)', to: '/lab' },
    ],
  },

  'excel-migration': {
    what: "Worked example — lifting an actuarial Excel model (reserve roll-forward, capital " +
      "model walk, valuation cashflow grid) into governed Delta tables + notebooks. The " +
      "spreadsheet's intent is preserved; the calculation moves into the lakehouse where " +
      "lineage, versioning, and the audit trail are first-class.",
    workbench_capabilities: [
      "Reference notebook that takes a representative actuarial Excel — a quarterly reserve roll-forward with linked SCR walk — and converts it: named ranges → typed columns, INDEX/MATCH + VLOOKUP → joins, array formulas → window functions, hidden tabs → intermediate Delta tables. Each step traces back to the original cell range.",
      "Pattern catalogue for the common shapes: pivot tables → groupBy + pivot, dependent dropdowns → parameterised notebook widgets, conditional formatting → Lakeview dashboard visuals, what-if scenario manager → governed scenario table feeding a notebook re-run.",
      "Snapshot + diff harness: every Excel-side recalculation is compared against the lakehouse-side run for the same period; row-level mismatches surface before the spreadsheet is retired. Parity must hold N quarters before the file is moved to read-only.",
      "Replace email-shaped overlays with the Overlays Register: every manual cell adjustment becomes an auditable overlay with author + approver + rationale, hashed and linked to the cell it touches.",
      "Output stays familiar — same numbers, same column layout, same sign-off chain — but now sits on UC with lineage, time-travel, and the AI agent layer reading from it.",
    ],
    adjacent_links: [
      { label: 'See the Overlays Register pattern', to: '/overlays' },
      { label: 'See the QRT audit panel (S.05.01)', to: '/report/s0501' },
    ],
  },
};

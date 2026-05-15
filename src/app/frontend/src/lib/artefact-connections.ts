/**
 * Per-artefact connections registry.
 *
 * Every Pillar 1 artefact page (and selected Pillar 2/3 ones later) renders
 * an ArtefactConnectionsPanel sourced from this config. Single source of
 * truth — the panel itself stays generic.
 *
 * To add a new artefact's connections: add an entry keyed by the canonical
 * id (e.g. 's2501', 'reserving_life'). The panel uses the registry key to
 * look up; if absent, the panel doesn't render.
 */

export interface ArtefactModelRef {
  model_id: string;              // matches /api/governance/models row
  role: string;                  // "produces" | "feeds" | "calibrates" — one phrase
  note?: string;                 // optional clarification
}

export interface ArtefactEngineRef {
  vendor: string;                // "WTW Igloo" / "FIS Prophet"
  kind: string;                  // "Non-life cat" / "Life UW + cat"
  role: string;                  // "stochastic loss generation"
  exchange: string;              // "UC Volume · 4_eng_stochastic_exchange"
}

export interface ArtefactConsumer {
  label: string;                 // "SFCR Section C — Risk Profile"
  to: string;                    // route
}

export interface ArtefactLink {
  label: string;
  to: string;
  kind: 'lab' | 'overlay' | 'agent' | 'example' | 'adjacent' | 'doc';
}

export interface ArtefactConfig {
  methodology: string;           // 2-4 sentences. Plain prose.
  inputs_bronze: string[];       // raw table names
  inputs_silver: string[];       // staging table names
  models: ArtefactModelRef[];
  engines?: ArtefactEngineRef[];
  downstream: ArtefactConsumer[];
  examples: ArtefactLink[];
  adjacent: ArtefactLink[];
  /** Reset-friendly link to the relevant Lab card. */
  primary_lab_link?: { model_id: string; label: string };
  /** Cell-prefix to look up overlays. e.g. 's0501.' for the reserving QRT. */
  overlay_cell_prefix?: string;
}

export const ARTEFACT_CONNECTIONS: Record<string, ArtefactConfig> = {
  /* ── S.25.01 SCR — the headline ─────────────────────────────────────── */
  s2501: {
    methodology:
      "Solvency Capital Requirement under the Standard Formula. Five module charges (market, counterparty default, life, health, non-life) aggregate via the EIOPA correlation matrix into the Basic SCR (BSCR). Operational risk = min(max(Op_premium, Op_provisions) + Op_UL, 30%·BSCR) is added. Loss-absorbing capacity of technical provisions (LAC_TP, for life with-profit) and loss-absorbing capacity of deferred taxes (LAC_DT) are subtracted, each limited by available recoverability. Inputs flow from the asset register, technical provisions, and the cat/life UW engines.",
    inputs_bronze: ["1_raw_risk_factors", "1_raw_own_funds"],
    inputs_silver: ["2_stg_scr_results"],
    models: [
      { model_id: "standard_formula", role: "produces the SCR breakdown and BSCR", note: "Champion v1 / Challenger v2 — alias-flipped on promote" },
      { model_id: "igloo_cat",        role: "feeds the SCR_non_life catastrophe sub-module" },
      { model_id: "prophet_life",     role: "feeds the SCR_life sub-modules" },
      { model_id: "reserving_pnc",    role: "calibrates the premium + reserve risk inputs" },
      { model_id: "reserving_life",   role: "calibrates the life best-estimate input" },
    ],
    engines: [
      { vendor: "WTW Igloo",   kind: "Non-life cat",  role: "stochastic loss generation for catastrophe risk",       exchange: "UC Volume · 4_eng_stochastic_exchange" },
      { vendor: "FIS Prophet", kind: "Life UW + cat", role: "5K-scenario projection for life sub-modules + cat",     exchange: "UC Volume · 4_eng_life_exchange" },
    ],
    downstream: [
      { label: "SFCR Section E — Capital Management",   to: "/sfcr" },
      { label: "RSR — Capital + supervisor disclosure", to: "/rsr" },
      { label: "ORSA continuous draft",                  to: "/orsa/draft" },
      { label: "Submissions Archive",                    to: "/archive" },
    ],
    examples: [
      { label: "Worked example — SF walkthrough (notebook)", to: "/lab", kind: "example" },
    ],
    adjacent: [
      { label: "Roadmap — IFRS 17",              to: "/roadmap/ifrs-17", kind: "adjacent" },
    ],
    primary_lab_link: { model_id: "standard_formula", label: "Standard Formula in the Lab" },
    overlay_cell_prefix: "s2501.",
  },

  /* ── S.05.01 Premiums, Claims & Expenses ─────────────────────────────── */
  s0501: {
    methodology:
      "Non-life premium and claim activity by EIOPA line-of-business. Premiums earned + written, claims paid + incurred, expenses, technical-result components — annual + quarterly templates. Reserves are the technical-provisions estimate from the chain-ladder + BF reserving model, with any approved overlays applied.",
    inputs_bronze: ["1_raw_premiums", "1_raw_claims", "1_raw_claims_triangles", "1_raw_expenses"],
    inputs_silver: ["2_stg_premiums_by_lob", "2_stg_claims_by_lob", "2_stg_premium_reserve_risk"],
    models: [
      { model_id: "reserving_pnc", role: "produces ultimate + IBNR by LoB and accident year" },
    ],
    downstream: [
      { label: "SFCR Section A — Business and Performance", to: "/sfcr" },
      { label: "RSR — same engine + supervisor sections",    to: "/rsr" },
      { label: "S.25.01 — feeds NL premium + reserve risk",  to: "/report/s2501" },
      { label: "Submissions Archive",                         to: "/archive" },
    ],
    examples: [
      { label: "Worked example — Chain ladder",         to: "/lab", kind: "example" },
      { label: "Worked example — Bornhuetter-Ferguson", to: "/lab", kind: "example" },
    ],
    adjacent: [
      { label: "Senior Reserving Actuary agent",     to: "/lab/reserving_pnc", kind: "agent" },
      { label: "Overlays Register",                  to: "/overlays", kind: "overlay" },
      { label: "Roadmap — Claims analytics",      to: "/roadmap/claims-analytics", kind: "adjacent" },
      { label: "Roadmap — Reserving deep dive",   to: "/roadmap/reserving-deep-dive", kind: "adjacent" },
    ],
    primary_lab_link: { model_id: "reserving_pnc", label: "Reserving (P&C) in the Lab" },
    overlay_cell_prefix: "s0501.",
  },

  /* ── S.06.02 Asset Register ──────────────────────────────────────────── */
  s0602: {
    methodology:
      "List of assets at the reporting date — Solvency II valuation, CIC classification, look-through for collective investments, currency, issuer + counterparty identifiers. No actuarial model; valuations come from the custodian feed plus look-through enrichment. Asset values feed the market-risk and counterparty-default modules of the SCR.",
    inputs_bronze: ["1_raw_assets", "1_raw_counterparties", "1_raw_balance_sheet"],
    inputs_silver: ["2_stg_assets_enriched"],
    models: [],
    downstream: [
      { label: "S.25.01 — feeds market risk + default risk sub-modules", to: "/report/s2501" },
      { label: "SFCR Section D — Valuation for Solvency Purposes",       to: "/sfcr" },
      { label: "Submissions Archive",                                     to: "/archive" },
    ],
    examples: [],
    adjacent: [
      { label: "Custodian feed status (ABN AMRO · Janusz Kowalski)", to: "/feeds/custodian_holdings_abn", kind: "doc" },
    ],
  },

  /* ── S.26.06 Non-Life UW Risk ────────────────────────────────────────── */
  s2606: {
    methodology:
      "Non-life underwriting risk SCR sub-module breakdown: premium + reserve risk, lapse risk, catastrophe risk. Cat is the stochastic component — generated by the Igloo engine on the firm's exposure layers, with reasonableness checks running on import. The cat agent surfaces anomalies (e.g. Q-over-Q +12%) and cross-references the external event log before sign-off.",
    inputs_bronze: ["1_raw_volume_measures", "1_raw_exposures", "1_raw_reinsurance"],
    inputs_silver: ["2_stg_premium_reserve_risk", "2_stg_cat_risk_by_lob"],
    models: [
      { model_id: "reserving_pnc", role: "calibrates premium + reserve risk volume measures" },
      { model_id: "igloo_cat",     role: "produces stochastic cat charge (VaR / TVaR / AAL)" },
    ],
    engines: [
      { vendor: "WTW Igloo", kind: "Non-life cat", role: "stochastic event-set simulation across European perils", exchange: "UC Volume · 4_eng_stochastic_exchange" },
    ],
    downstream: [
      { label: "S.25.01 — non-life UW SCR sub-module", to: "/report/s2501" },
      { label: "SFCR Section C — Risk Profile",        to: "/sfcr" },
      { label: "RSR — supervisor-only UW detail",       to: "/rsr" },
    ],
    examples: [],
    adjacent: [
      { label: "Cat Modelling Agent",                 to: "/lab/igloo_cat",       kind: "agent" },
      { label: "External event log",                  to: "/lab/igloo_cat",       kind: "doc" },
      { label: "Roadmap — Reinsurance optimisation", to: "/roadmap/reinsurance", kind: "adjacent" },
    ],
    primary_lab_link: { model_id: "igloo_cat", label: "Igloo cat engine in the Lab" },
    overlay_cell_prefix: "s2606.",
  },

  /* ── S.12.01 Life Technical Provisions ────────────────────────────────── */
  s1201: {
    methodology:
      "Life technical provisions: best estimate (discounted expected cashflows under best-estimate assumptions) + risk margin (cost-of-capital approach). Per product line — unit-linked, with-profits, protection. Cashflows projected by the Prophet engine over 5K scenarios; best estimate is the average present value, risk margin is the cost of holding non-hedgeable risk capital.",
    inputs_bronze: ["1_raw_life_policies", "1_raw_life_assumptions", "1_raw_life_reserves", "1_raw_life_lapses"],
    inputs_silver: ["2_stg_life_tp_components"],
    models: [
      { model_id: "reserving_life", role: "produces best estimate + risk margin" },
      { model_id: "prophet_life",   role: "generates the 5K-scenario cashflow set the BE averages over" },
    ],
    engines: [
      { vendor: "FIS Prophet", kind: "Life UW + cat", role: "per-policy stochastic projection across 5K scenarios", exchange: "UC Volume · 4_eng_life_exchange" },
    ],
    downstream: [
      { label: "S.25.01 — feeds the life sub-modules of SCR", to: "/report/s2501" },
      { label: "SFCR Section D — Valuation",                  to: "/sfcr" },
      { label: "Life UW Risk page — sub-module breakdown",    to: "/life-uw-risk" },
    ],
    examples: [],
    adjacent: [
      { label: "Roadmap — IFRS 17 (CSM / fulfilment cashflows)", to: "/roadmap/ifrs-17", kind: "adjacent" },
      { label: "Senior Reserving Actuary (life path)",                to: "/lab/reserving_life", kind: "agent" },
    ],
    primary_lab_link: { model_id: "prophet_life", label: "Prophet engine in the Lab" },
    overlay_cell_prefix: "s1201.",
  },

  /* ── Life reserving page (not a QRT, but its own surface) ─────────────── */
  reserving_life: {
    methodology:
      "Life best-estimate + risk margin. Inputs: in-force policy book, best-estimate assumptions (mortality, longevity, lapse, expense), reinsurance treaties. Cashflows projected per policy by the Prophet engine; the reserving_life pyfunc discounts them to produce the BE per product line. Risk margin via the standard cost-of-capital method.",
    inputs_bronze: ["1_raw_life_policies", "1_raw_life_assumptions", "1_raw_life_reserves"],
    inputs_silver: ["2_stg_life_tp_components"],
    models: [
      { model_id: "reserving_life", role: "produces best estimate + risk margin" },
      { model_id: "prophet_life",   role: "supplies the per-policy 5K-scenario cashflow set" },
    ],
    engines: [
      { vendor: "FIS Prophet", kind: "Life UW + cat", role: "per-policy stochastic projection · 5K scenarios", exchange: "UC Volume · 4_eng_life_exchange" },
    ],
    downstream: [
      { label: "S.12.01 — Life TPs (this page)",            to: "/reserving-life" },
      { label: "S.25.01 — feeds the life sub-modules",      to: "/report/s2501" },
      { label: "SFCR Section D — Valuation",                to: "/sfcr" },
    ],
    examples: [],
    adjacent: [
      { label: "Roadmap — IFRS 17",          to: "/roadmap/ifrs-17", kind: "adjacent" },
      { label: "Senior Reserving Actuary agent",  to: "/lab/reserving_life", kind: "agent" },
    ],
    primary_lab_link: { model_id: "reserving_life", label: "Reserving (Life) in the Lab" },
    overlay_cell_prefix: "s1201.",
  },

  /* ── Life UW Risk page ─────────────────────────────────────────────────── */
  life_uw_risk: {
    methodology:
      "Life underwriting risk SCR sub-module: mortality, longevity, disability, lapse, expense, revision, life catastrophe. Each sub-module is a stress applied to the best-estimate cashflows; the SCR component is the loss in eligible own funds under each stress. The Prophet engine runs the stress applications; results aggregate through the EIOPA life-UW correlation matrix.",
    inputs_bronze: ["1_raw_life_policies", "1_raw_life_assumptions", "1_raw_life_lapses", "1_raw_life_mortality_experience"],
    inputs_silver: ["2_stg_life_uw_risk_by_module"],
    models: [
      { model_id: "prophet_life", role: "applies the life UW stresses; aggregates via correlation matrix" },
    ],
    engines: [
      { vendor: "FIS Prophet", kind: "Life UW + cat", role: "per-policy stress application + aggregation", exchange: "UC Volume · 4_eng_life_exchange" },
    ],
    downstream: [
      { label: "S.25.01 — feeds the SCR_life module",   to: "/report/s2501" },
      { label: "SFCR Section C — Risk Profile",          to: "/sfcr" },
      { label: "ORSA continuous draft — stress section", to: "/orsa/draft" },
    ],
    examples: [],
    adjacent: [
      { label: "Prophet in the Lab",                              to: "/lab/prophet_life",       kind: "agent" },
      { label: "Roadmap — IFRS 17 (sensitivity overlap)",      to: "/roadmap/ifrs-17",        kind: "adjacent" },
    ],
    primary_lab_link: { model_id: "prophet_life", label: "Prophet engine in the Lab" },
  },
};

export function getArtefactConfig(qrtId: string): ArtefactConfig | undefined {
  return ARTEFACT_CONNECTIONS[qrtId.toLowerCase()];
}

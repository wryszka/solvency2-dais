/**
 * Per-page orientation strip — DAIS booth.
 *
 * One short, plain-English line per page, readable the moment the page opens:
 * "what am I looking at, and why does it matter." Rendered by <PageIntro/>,
 * mounted once in the AppShell layout (so every page gets one without editing
 * 30 page components). Keyed by route; dynamic routes match by prefix.
 *
 * Keep each entry to 1–2 sentences. This is for a Brickster talking to a
 * visitor at the stand, not documentation.
 */
export interface PageIntro {
  title: string;
  body: string;
}

const EXACT: Record<string, PageIntro> = {
  '/home': {
    title: 'Solvency II Workbench',
    body: 'The front door to the demo — a full Solvency II reporting process running on one Databricks platform. From here you can walk the whole cycle: data, capital, governance and disclosure.',
  },
  '/today': {
    title: 'Control Tower',
    body: 'The operational overview of the full Solvency process. See the current solvency ratio, where each report is in its cycle, and the main challenges to tackle today — the single screen a CRO or reporting lead would open first.',
  },
  '/reporting-cycle': {
    title: 'Reporting cycle',
    body: 'The end-to-end quarterly and annual calendar — every QRT, ORSA, SFCR and RSR with its owner, status and deadline. Shows how the whole regulatory process is orchestrated on one platform.',
  },
  '/learn': {
    title: 'Learn',
    body: 'Background for non-actuaries: what Solvency II is, the three pillars, and the key terms — so anyone watching the demo can follow what each screen is doing.',
  },
  '/instructions': {
    title: 'For Bricksters',
    body: 'Your run-sheet for the stand: what this demo shows, how to walk a visitor through it, the safe defaults, and how to reset if something gets changed.',
  },
  '/ingestion': {
    title: 'Data ingestion',
    body: 'Where the raw data lands — policies, claims, assets, market data — and how each feed is monitored as it flows into the lakehouse. The foundation everything downstream is built on.',
  },
  '/reconciliation': {
    title: 'Reconciliation',
    body: 'Where the numbers are tied back to source — sub-ledgers to general ledger, exposures to QRTs — with breaks flagged for investigation. The control that lets you sign off the figures.',
  },
  '/data-quality': {
    title: 'Data quality',
    body: 'Automated checks running over the data before it reaches the capital models — completeness, accuracy and consistency, with AI flagging anomalies. Bad data caught here, not in a regulatory filing.',
  },
  '/whatif': {
    title: 'What-if scenario',
    body: 'Pick a worked example and the engine projects the capital impact live, then a contrarian AI reviewer pressure-tests the assumptions — continuous solvency, before it ever becomes a board paper.',
  },
  '/pillar-1': {
    title: 'Pillar 1 — Capital',
    body: 'The quantitative core: technical provisions, the SCR Standard Formula, the MCR and own funds. This pillar is fully implemented in the demo — every module computes live and feeds the QRTs.',
  },
  '/pillar-2': {
    title: 'Pillar 2 — Governance',
    body: 'The qualitative side: the ORSA, the risk-management system, model governance and the actuarial function. Fully implemented here — see the governed, audited process behind the numbers.',
  },
  '/pillar-3': {
    title: 'Pillar 3 — Disclosure',
    body: 'What the insurer reports out: the QRTs, the SFCR (public) and the RSR (to the regulator). Fully implemented — the disclosures are generated straight from the governed data and models.',
  },
  '/reserving-life': {
    title: 'Life reserving',
    body: 'Best-estimate liabilities for the life book — model points, assumptions and projection — feeding the technical provisions in Pillar 1.',
  },
  '/life-uw-risk': {
    title: 'Life underwriting risk',
    body: 'The life underwriting risk sub-module of the SCR — mortality, longevity, lapse and expense shocks applied under the Standard Formula.',
  },
  '/lab': {
    title: 'Actuarial Lab',
    body: 'The governed model registry — every actuarial model with its version, validation status and lineage. Where models are built, tested and signed off before they touch a capital figure.',
  },
  '/overlays': {
    title: 'Expert-judgement overlays',
    body: 'The register of manual adjustments to model output — each with a rationale, owner and approval. Expert judgement made transparent and auditable, not buried in a spreadsheet.',
  },
  '/orsa': {
    title: 'ORSA',
    body: 'The Own Risk and Solvency Assessment — the firm’s forward-looking view of its own risks and capital needs over the planning horizon, with stress and scenario testing.',
  },
  '/orsa/draft': {
    title: 'ORSA draft',
    body: 'An AI-assisted first draft of the ORSA narrative, written from the live numbers and governance evidence — the actuary edits and owns it, the AI removes the blank-page problem.',
  },
  '/orsa/reverse-stress': {
    title: 'Reverse stress test',
    body: 'Works backwards from failure: what set of events would break the business model? The engine searches for the scenarios that breach solvency, so they can be planned against.',
  },
  '/afr': {
    title: 'Actuarial Function Report',
    body: 'The actuarial function’s annual opinion — on technical provisions, underwriting and reinsurance — assembled from the governed evidence across the platform.',
  },
  '/internal-controls': {
    title: 'Internal controls',
    body: 'The control framework over the reporting process — who checks what, when, and the evidence it ran. The audit trail that underpins sign-off.',
  },
  '/archive': {
    title: 'Disclosure archive',
    body: 'Every past filing kept versioned and reproducible — the exact data, models and numbers behind each historic SFCR, RSR and QRT submission.',
  },
  '/sfcr': {
    title: 'SFCR',
    body: 'The Solvency and Financial Condition Report — the public annual disclosure — generated straight from the governed data and models, not re-typed into a document.',
  },
  '/rsr': {
    title: 'RSR',
    body: 'The Regular Supervisory Report — the confidential, more detailed version for the regulator — built from the same governed source as everything else.',
  },
  '/regulator-qa': {
    title: 'Regulator Q&A',
    body: 'Ask a question the way a supervisor would, and get an answer grounded in the actual filed numbers and their lineage — every figure traceable back to source.',
  },
  '/architecture': {
    title: 'Architecture',
    body: 'How the whole thing is built on Databricks — the lakehouse, pipelines, models, governance and the app — on one platform end to end.',
  },
  '/agents': {
    title: 'Agent architecture',
    body: 'The AI agents at work across the process — what each one does, what it can see, and how a central supervisor routes a question to the right specialist.',
  },
  '/governance': {
    title: 'Model governance',
    body: 'Unity Catalog as the spine: every table, model and function versioned, permissioned and lineage-tracked. The governance that makes the numbers defensible.',
  },
  '/model-development': {
    title: 'Model development',
    body: 'How a model goes from idea to production — built, validated, registered and monitored — all inside the governed platform.',
  },
  '/genie': {
    title: 'Genie',
    body: 'Ask the data a question in plain English. Genie writes the SQL against the governed lakehouse and shows you the answer — and the query behind it.',
  },
};

const PREFIX: { prefix: string; intro: PageIntro }[] = [
  {
    prefix: '/report/',
    intro: {
      title: 'QRT report',
      body: 'A Quantitative Reporting Template — a regulatory form — populated straight from the governed data and capital models, with every figure traceable to source.',
    },
  },
  {
    prefix: '/feeds/',
    intro: {
      title: 'Data feed',
      body: 'A single inbound data feed in detail — what it carries, where it comes from and its health as it lands in the lakehouse.',
    },
  },
  {
    prefix: '/lab/',
    intro: {
      title: 'Model detail',
      body: 'One actuarial model in full — its version, validation, lineage and the figures it produces for the capital calculation.',
    },
  },
];

export function getPageIntro(pathname: string): PageIntro | null {
  if (EXACT[pathname]) return EXACT[pathname];
  const hit = PREFIX.find((p) => pathname.startsWith(p.prefix));
  return hit ? hit.intro : null;
}

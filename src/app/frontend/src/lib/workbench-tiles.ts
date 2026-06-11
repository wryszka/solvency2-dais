/**
 * Workbench tile registry — DAIS booth landing (single-app build).
 *
 * The hub is the front page of the Solvency II app at the booth. Only the
 * Solvency II tile is live — it opens the app's own landing (/home). Every
 * other tile opens a register-interest page describing the workflow, so
 * visitors can sign up to see it later.
 */
import {
  Shield, TrendingUp, FileSpreadsheet, Network, AlertOctagon, BarChart3,
  Code2, Table2, ScrollText, HeartPulse,
} from 'lucide-react';

export type TileStatus = 'live' | 'in_progress' | 'roadmap';

export interface Tile {
  slug: string;
  label: string;
  description: string;
  status: TileStatus;
  icon: React.ComponentType<{ className?: string }>;
  to: string;                      // '/home' for the live Solvency tile; others handled by the Hub
  accent?: 'blue';
  subtitle?: string;
}

export const TILES: Tile[] = [
  {
    slug: 'solvency-2',
    label: 'Solvency II',
    description: 'A working example of a full regulatory reporting process on Databricks. Solvency II is the EU/UK insurer capital-and-reporting regime — the US equivalent is the NAIC’s Risk-Based Capital (RBC), statutory filings, and US ORSA. See the whole cycle — data, models, governance, disclosure — run on one platform.',
    status: 'live',
    icon: Shield,
    to: '/home',
    accent: 'blue',
  },
  {
    slug: 'pricing',
    label: 'Pricing workbench',
    description: 'The full pricing loop on Databricks — ingest, build, price, investigate, govern. AI agents across it: data-quality checks, factor-lift explainers, model selection, and "why this price?" quote investigation via Genie + Mosaic AI.',
    status: 'live',
    icon: TrendingUp,
    to: '',
    subtitle: 'Commercial motor',
  },
  {
    slug: 'claims-workbench',
    label: 'Claims Intelligence Workbench',
    description: 'From first notice of loss to settlement on one governed platform. AI auto-closes the simple claims in minutes and flags the rest for a handler — with its reasoning shown. Built on the Databricks Smart Claims accelerator, extended with agentic AI.',
    status: 'live',
    icon: AlertOctagon,
    to: '',
    subtitle: 'Bricksurance SE',
  },
  {
    slug: 'lifecast',
    label: 'LifeCast',
    description: 'Life insurance liability modelling, end to end on real worked examples — governed model points and assumptions, best-estimate liability projection, ESG scenario testing and stochastic fan-out — with the actuarial engine logic versioned, audited and run on serverless.',
    status: 'in_progress',
    icon: HeartPulse,
    to: '',
    subtitle: 'Bricksurance Life · external app',
  },
  {
    slug: 'reinsurance',
    label: 'Reinsurance',
    description: 'Treaty performance, retrocession optimisation and capital relief — on the same exposures that feed the Solvency II catastrophe models.',
    status: 'in_progress',
    icon: Network,
    to: '',
  },
  {
    slug: 'ifrs-17',
    label: 'IFRS 17',
    description: 'Contract groups, CSM roll-forward, financial disclosure. Heavy data overlap with Solvency II technical provisions — the same lakehouse foundation, a second reporting lens.',
    status: 'roadmap',
    icon: FileSpreadsheet,
    to: '',
  },
  {
    slug: 'reserving-deep-dive',
    label: 'Reserving deep dive',
    description: 'Triangle methods, model validation, and a methodology library. Extends the chain-ladder + Bornhuetter-Ferguson examples already in the Solvency II Lab.',
    status: 'roadmap',
    icon: BarChart3,
    to: '',
  },
  {
    slug: 'sas-migration',
    label: 'SAS migration',
    description: 'Worked example — moving a legacy SAS program to PySpark / Spark SQL on the lakehouse with Genie Code. PROC SQL, DATA step + RETAIN, and PROC MEANS translated and run on governed Delta tables.',
    status: 'live',
    icon: Code2,
  to: '',
  },
  {
    slug: 'excel-migration',
    label: 'Excel migration',
    description: 'Worked example — lifting actuarial Excel + VBA (EIOPA RFR ingestion, Solvency II SCR Standard Formula) into governed Delta tables, DLT, MLflow, UC functions and a Lakeview dashboard, with an Excel round-trip and parity testing.',
    status: 'live',
    icon: Table2,
    to: '',
  },
  {
    slug: 'mrc-intelligence',
    label: 'MRC policy intelligence',
    description: "Lloyd's Market Reform Contract (MRC) PDFs turned into a governed knowledge graph using ACORD terminology — insured, broker, syndicate, limits, clauses, exclusions and the links between them, extracted with the Foundation Model API. A multi-agent assistant answers underwriter, broker and compliance questions over it.",
    status: 'live',
    icon: ScrollText,
    to: '',
    subtitle: "Lloyd's market · ACORD",
  },
];

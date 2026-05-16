/**
 * Workbench tile registry — single source of truth.
 *
 * To add a new tile (live or roadmap), edit this file and — for roadmap
 * tiles — create a stub at `src/pages/roadmap/{slug}.tsx`. Live tiles need
 * a real route registered in App.tsx and the same redeployability provisions
 * as Phase 6a (no hardcoded IDs, all variables in databricks.yml, all UC
 * objects declared in the bundle, all idempotent).
 *
 * See docs/ADDING_WORKBENCH_TILE.md for the full pattern.
 */
import {
  Shield, TrendingUp, FileSpreadsheet, Network, AlertOctagon, BarChart3,
  Code2, Table2,
} from 'lucide-react';

export type TileStatus = 'live' | 'in_progress' | 'roadmap';

export interface Tile {
  slug: string;                    // URL slug + key
  label: string;
  description: string;             // 1 line
  status: TileStatus;
  icon: React.ComponentType<{ className?: string }>;
  to: string;                      // navigate target
  accent?: 'blue';                 // live tile colour palette
}

export const TILES: Tile[] = [
  {
    slug: 'solvency-2',
    label: 'Solvency II',
    description: 'Capital, governance, disclosure, ORSA — full cycle with native model development and end-to-end audit trail.',
    status: 'live',
    icon: Shield,
    to: '/today',
    accent: 'blue',
  },
  {
    slug: 'pricing',
    label: 'Pricing',
    description: 'Rate-making, GBM models, bias monitoring. Same model registry pattern as the Solvency II Lab.',
    status: 'live',
    icon: TrendingUp,
    to: 'https://pricing-workbench-7474656169654171.aws.databricksapps.com/',
    accent: 'blue',
  },
  {
    slug: 'ifrs-17',
    label: 'IFRS 17',
    description: 'Contract groups, CSM, financial disclosure. Heavy data overlap with Solvency II technical provisions.',
    status: 'roadmap',
    icon: FileSpreadsheet,
    to: '/roadmap/ifrs-17',
  },
  {
    slug: 'reinsurance',
    label: 'Reinsurance',
    description: 'Treaty performance, retrocession optimisation, capital relief. Same exposures fed into Solvency II cat models.',
    status: 'roadmap',
    icon: Network,
    to: '/roadmap/reinsurance',
  },
  {
    slug: 'claims-analytics',
    label: 'Claims analytics',
    description: 'Fraud signals, experience monitoring, reserving feedback loop. Same claim data the reserving model already reads.',
    status: 'roadmap',
    icon: AlertOctagon,
    to: '/roadmap/claims-analytics',
  },
  {
    slug: 'reserving-deep-dive',
    label: 'Reserving deep dive',
    description: 'Triangle methods, model validation, methodology library. Extends the chain-ladder + BF examples already in the Lab.',
    status: 'roadmap',
    icon: BarChart3,
    to: '/roadmap/reserving-deep-dive',
  },
  {
    slug: 'sas-migration',
    label: 'SAS migration',
    description: 'Worked example — moving an actuarial SAS code-base to PySpark / Spark SQL on the lakehouse. Reserving, capital, valuation procedures translated step by step.',
    status: 'in_progress',
    icon: Code2,
    to: '/roadmap/sas-migration',
  },
  {
    slug: 'excel-migration',
    label: 'Excel migration',
    description: 'Worked example — lifting an actuarial Excel model (reserve roll-forward, capital model, valuation chain) into governed Delta tables + notebooks with the audit trail intact.',
    status: 'in_progress',
    icon: Table2,
    to: '/roadmap/excel-migration',
  },
];

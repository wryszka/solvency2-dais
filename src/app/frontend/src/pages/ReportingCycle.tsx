/**
 * Reporting Cycle door — the reference view.
 *
 * Three columns, one per Solvency II pillar. Every deliverable listed as a
 * clickable row with status. Click → opens the existing artefact page; the
 * Link sets `crumbs` in router state so the artefact page renders a
 * Breadcrumb.
 */
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Shield, BarChart3, BookOpen, Flame, FlaskConical, Landmark,
  Workflow, Scale, ScrollText, Lock,
  Archive as ArchiveIcon, Newspaper, FileText, Bot,
  ChevronRight, CheckCircle2, AlertTriangle, Clock,
} from 'lucide-react';
import PillarChip, { type Pillar } from '../components/PillarChip';
import { fetchLandingStatus, type LandingStatus, type TileStatus } from '../lib/api';

interface Deliverable {
  to: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Optional landing-status tile key — used for status indicator. */
  statusKey?: string;
}

interface PillarColumn {
  pillar: 1 | 2 | 3;
  heading: string;
  blurb: string;
  deliverables: Deliverable[];
}

const COLUMNS: PillarColumn[] = [
  {
    pillar: 1,
    heading: 'Pillar 1 — Capital',
    blurb: 'Calculation. The numbers underneath every disclosure.',
    deliverables: [
      { to: '/scr',           label: 'SCR & Standard Formula',           description: 'S.25.01 — module aggregation, BSCR, op risk, LAC_DT.',  icon: Shield,       statusKey: 's2501' },
      { to: '/reserving-pnc', label: 'Reserving — P&C',                  description: 'S.05.01 + technical-provisions calculation.',           icon: BarChart3,    statusKey: 's0501' },
      { to: '/reserving-life',label: 'Reserving — Life',                 description: 'S.12.01 — best-estimate + risk margin.',                icon: BookOpen },
      { to: '/nl-uw-risk',    label: 'Non-Life UW Risk',                 description: 'S.26.06 — premium, reserve, cat sub-modules.',          icon: Flame,        statusKey: 's2606' },
      { to: '/life-uw-risk',  label: 'Life UW Risk',                     description: 'Mortality, longevity, lapse, expense, cat.',            icon: FlaskConical },
      { to: '/assets',        label: 'Asset Register',                   description: 'S.06.02 — list of assets, look-through, CIC.',         icon: Landmark,     statusKey: 's0602' },
    ],
  },
  {
    pillar: 2,
    heading: 'Pillar 2 — Governance',
    blurb: 'Risk management. The judgement framework around the numbers.',
    deliverables: [
      { to: '/orsa',              label: 'ORSA',                  description: 'Own risk + solvency assessment. Stress projections + narrative.', icon: Workflow },
      { to: '/model-governance',  label: 'Model Governance',      description: 'Champion / Challenger comparison + approvals.',                  icon: Scale },
      { to: '/afr',               label: 'Actuarial Function',    description: 'Article 48 report — TPs, UW, reinsurance, internal model.',     icon: ScrollText },
      { to: '/internal-controls', label: 'Internal Controls',     description: 'AI guardrails + architectural assertions + audit log.',         icon: Lock },
    ],
  },
  {
    pillar: 3,
    heading: 'Pillar 3 — Disclosure',
    blurb: 'Reporting. What goes to the regulator and the public.',
    deliverables: [
      { to: '/archive',     label: 'QRT Submission Pack',  description: 'Quarterly + annual EIOPA templates with sign-off + history.',         icon: ArchiveIcon },
      { to: '/sfcr',        label: 'SFCR (Public)',         description: 'Article 51 — public solvency + financial condition report.',          icon: Newspaper },
      { to: '/rsr',         label: 'RSR (Supervisor)',      description: 'Annual supervisory report — same engine as SFCR + supervisor-only.',  icon: FileText },
      { to: '/regulator-qa',label: 'Regulator Q&A',         description: 'BaFin-style follow-up questions answered against the data.',          icon: Bot },
    ],
  },
];

const STATUS_VARIANT: Record<string, { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
  ok:           { icon: CheckCircle2,  cls: 'text-emerald-600', label: 'green' },
  approved:     { icon: CheckCircle2,  cls: 'text-emerald-600', label: 'approved' },
  pending:      { icon: Clock,         cls: 'text-amber-600',   label: 'pending' },
  blocked:      { icon: AlertTriangle, cls: 'text-red-600',     label: 'blocked' },
  warn:         { icon: AlertTriangle, cls: 'text-amber-600',   label: 'attention' },
};

export default function ReportingCycle() {
  const [status, setStatus] = useState<LandingStatus | null>(null);
  useEffect(() => { fetchLandingStatus().then(setStatus).catch(() => undefined); }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      <header>
        <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Reporting Cycle</h2>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-3xl">
          Solvency II's three-pillar structure. Click any deliverable to open it.
          This is the reference view — every artefact the platform ships, organised the
          way the regulation is.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {COLUMNS.map((col) => <PillarColumnCard key={col.pillar} col={col} status={status} />)}
      </div>

      <p className="text-[11px] text-gray-400 italic mt-2">
        Operational state ("where are we right now?") lives in <Link to="/today" className="text-blue-600 hover:underline">Today</Link>.
        How the regime works ("what does this all mean?") lives in <Link to="/learn" className="text-blue-600 hover:underline">Learn</Link>.
      </p>
    </div>
  );
}

function PillarColumnCard({ col, status }: { col: PillarColumn; status: LandingStatus | null }) {
  const colour = {
    1: { border: 'border-blue-300',   accent: 'bg-blue-50',   text: 'text-blue-900',   row: 'hover:bg-blue-50/40'   },
    2: { border: 'border-emerald-300',accent: 'bg-emerald-50',text: 'text-emerald-900',row: 'hover:bg-emerald-50/40'},
    3: { border: 'border-amber-300',  accent: 'bg-amber-50',  text: 'text-amber-900',  row: 'hover:bg-amber-50/40'  },
  }[col.pillar];

  return (
    <section className={`bg-white border-2 ${colour.border} rounded-xl overflow-hidden flex flex-col`}>
      <header className={`${colour.accent} px-4 py-3 border-b ${colour.border}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className={`text-base font-bold ${colour.text}`}>{col.heading}</h3>
          <PillarChip pillar={col.pillar as Pillar} size="sm" />
        </div>
        <p className={`text-xs ${colour.text} opacity-80 mt-0.5`}>{col.blurb}</p>
      </header>

      <ul className="divide-y divide-gray-100 flex-1">
        {col.deliverables.map((d) => {
          const Icon = d.icon;
          const tile = d.statusKey ? status?.tiles[d.statusKey] : undefined;
          const tStatus: TileStatus | undefined = tile?.status as TileStatus | undefined;
          const variant = tStatus ? STATUS_VARIANT[tStatus] : undefined;
          const VariantIcon = variant?.icon;
          return (
            <li key={d.to}>
              <Link
                to={d.to}
                state={{ crumbs: [
                  { label: 'Reporting Cycle', to: '/reporting-cycle' },
                  { label: col.heading },
                  { label: d.label },
                ] }}
                className={`flex items-center gap-3 px-4 py-3 ${colour.row} transition-colors`}
              >
                <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{d.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{d.description}</div>
                </div>
                {VariantIcon && (
                  <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold ${variant?.cls}`}>
                    <VariantIcon className="w-3 h-3" />
                    {variant?.label}
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

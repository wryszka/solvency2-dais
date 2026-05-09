/**
 * Adjacencies — the workbench horizon.
 *
 * Six cards. Same data, same governance, same AI — applied to other actuarial
 * workflows. Used as the talk's closing scene and as the conversation-opener
 * for follow-ups.
 */
import { Link } from 'react-router-dom';
import {
  TrendingUp, AlertOctagon, FileSpreadsheet, Network, Users, Target,
  ArrowRight, Compass, CheckCircle2, Wrench, Map,
} from 'lucide-react';
import PillarChip from '../components/PillarChip';

type Status = 'pattern_proven' | 'accelerator_available' | 'roadmap';

interface Adjacency {
  id: string;
  domain: string;
  icon: React.ComponentType<{ className?: string }>;
  why: string;
  pattern: string;
  status: Status;
  link?: { label: string; to: string; external?: boolean };
}

const STATUS_BADGE: Record<Status, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  pattern_proven:        { label: 'Pattern proven',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  accelerator_available: { label: 'Accelerator available', cls: 'bg-blue-50 text-blue-700 border-blue-200',           icon: Wrench },
  roadmap:               { label: 'Roadmap',               cls: 'bg-slate-50 text-slate-700 border-slate-200',         icon: Map },
};

const ADJACENCIES: Adjacency[] = [
  {
    id: 'pricing',
    domain: 'Pricing',
    icon: TrendingUp,
    why: 'Same exposure, claims, and policy data the workbench already holds. Pricing models live where reserving + SF live.',
    pattern: 'GLM/GBM models registered in Unity Catalog, served via Mosaic AI, governed identically to reserving and SF — versions, aliases, diagnostics, lineage.',
    status: 'accelerator_available',
    link: { label: 'Talk to us', to: '#' },
  },
  {
    id: 'claims_analytics',
    domain: 'Claims analytics & fraud',
    icon: AlertOctagon,
    why: 'The claim-level data feeding S.05.01 and the reserving model is the same data behind fraud detection and severity prediction.',
    pattern: 'Anomaly + severity models alongside the reserving pyfuncs. Same audit panel surfaces the model that flagged each claim.',
    status: 'pattern_proven',
    link: { label: 'Talk to us', to: '#' },
  },
  {
    id: 'ifrs17',
    domain: 'IFRS 17',
    icon: FileSpreadsheet,
    why: 'Heavy data overlap with Solvency II — technical provisions, reserves, contract groups, cashflow projections.',
    pattern: 'CSM / fulfilment-cashflow tables alongside the SII gold layer. Reuses the cashflow projection engine; adds the IFRS 17 measurement model as a peer pyfunc in the Lab.',
    status: 'roadmap',
  },
  {
    id: 'reinsurance',
    domain: 'Reinsurance optimisation',
    icon: Network,
    why: 'The exposures and the cat / NL UW engines are already the inputs an RI optimisation needs.',
    pattern: 'Linear / convex optimisation models in UC reading the same exposure layers Igloo reads. Output feeds the RI structure design and the SCR sub-modules.',
    status: 'pattern_proven',
  },
  {
    id: 'customer',
    domain: 'Customer & distribution analytics',
    icon: Users,
    why: 'Policy, premium, and lapse data already live in the bronze layer. Customer-level views are an aggregation, not a new pipeline.',
    pattern: 'Same governance + lineage; the segments / propensity / next-best-action models become Lab peers, with the same overlay register for sales-team judgement calls.',
    status: 'pattern_proven',
  },
  {
    id: 'capital_allocation',
    domain: 'Capital allocation & business steering',
    icon: Target,
    why: 'ORSA already projects capital under stress. Capital allocation is the same machinery turned around — allocate the SCR to lines of business and decisions.',
    pattern: 'Marginal-SCR + RAC calculations on top of the SF model output. Same overlays register for management judgement on allocation choices.',
    status: 'pattern_proven',
  },
];

export default function Adjacencies() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start gap-3">
        <Compass className="w-7 h-7 text-violet-700 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            Adjacencies
            <PillarChip pillar="cross" size="md" />
          </h2>
          <p className="text-base text-gray-600 mt-1.5 leading-relaxed">
            Solvency II is what we showed today. The workbench doesn't end here.
          </p>
        </div>
        <Link to="/horizon"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-violet-300 text-violet-700 rounded-md hover:bg-violet-50 text-xs font-semibold">
          Workbench horizon <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <section className="bg-gradient-to-br from-violet-50 via-blue-50/30 to-emerald-50/30 border border-violet-100 rounded-xl p-5 text-sm text-gray-800 leading-relaxed">
        <p>
          <strong>Same data, same governance, same AI, same audit.</strong> Solvency II proves the model. Each adjacency below extends from
          the platform you've already paid for — Unity Catalog tables, MLflow models with aliases, the agent + overlay pattern,
          and the audit panel. None of these require new infrastructure, only new domain models on top of it.
        </p>
        <p className="mt-2 text-gray-600">
          Status chips: <span className="font-semibold text-emerald-700">Pattern proven</span> means we have references implementations.
          <span className="mx-1">·</span>
          <span className="font-semibold text-blue-700">Accelerator available</span> means a productised starter exists today.
          <span className="mx-1">·</span>
          <span className="font-semibold text-slate-700">Roadmap</span> means committed direction, not built yet.
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ADJACENCIES.map((a) => <AdjacencyCard key={a.id} a={a} />)}
      </div>

      <section className="bg-slate-900 text-white rounded-xl p-6 mt-2">
        <div className="flex items-start gap-3">
          <Compass className="w-5 h-5 text-violet-300 mt-1" />
          <div>
            <h3 className="text-lg font-bold tracking-tight">The closing line</h3>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              You didn't buy a Solvency II solution. You bought a workbench that does Solvency II beautifully today,
              IFRS 17 next year, pricing the year after. Same data. Same governance. Same AI. Same audit. The next
              workflow you're under pressure on extends from here.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function AdjacencyCard({ a }: { a: Adjacency }) {
  const Icon = a.icon;
  const StatusIcon = STATUS_BADGE[a.status].icon;
  return (
    <article className="bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 transition-colors flex flex-col">
      <header className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-violet-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 leading-tight">{a.domain}</h3>
          <span className={`inline-flex items-center gap-1 mt-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${STATUS_BADGE[a.status].cls}`}>
            <StatusIcon className="w-2.5 h-2.5" />
            {STATUS_BADGE[a.status].label}
          </span>
        </div>
      </header>

      <div className="space-y-3 text-sm flex-1">
        <Block label="Why it's adjacent" body={a.why} />
        <Block label="Pattern" body={a.pattern} />
      </div>

      {a.link && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          {a.link.external ? (
            <a href={a.link.to} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900">
              {a.link.label} <ArrowRight className="w-3 h-3" />
            </a>
          ) : (
            <Link to={a.link.to}
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900">
              {a.link.label} <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">{label}</div>
      <p className="text-sm text-gray-700 leading-relaxed">{body}</p>
    </div>
  );
}

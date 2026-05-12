import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight, Shield, BarChart3, BookOpen, Flame, FlaskConical, Landmark,
  Workflow, Scale, ScrollText, Lock, Archive as ArchiveIcon, Newspaper, FileText, Bot,
  CheckCircle2, AlertTriangle, Clock, Activity, ShieldCheck, Layers,
} from 'lucide-react';
import PillarChip, { type Pillar, PILLAR_META } from '../components/PillarChip';
import { fetchLandingStatus, type LandingStatus, type TileStatus } from '../lib/api';

interface DeliverableTile {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const PILLAR_DELIVERABLES: Record<Exclude<Pillar, 'cross'>, { headline: string; tiles: DeliverableTile[] }> = {
  1: {
    headline: 'Capital — what we hold and why',
    tiles: [
      { key: 'scr',            label: 'SCR & Standard Formula', icon: Shield,        path: '/scr' },
      { key: 'reserving_pnc',  label: 'Reserving & TPs (P&C)',  icon: BarChart3,     path: '/reserving-pnc' },
      { key: 'reserving_life', label: 'Reserving & TPs (Life)', icon: BookOpen,      path: '/reserving-life' },
      { key: 'nl_uw_risk',     label: 'Non-Life UW Risk',       icon: Flame,         path: '/nl-uw-risk' },
      { key: 'life_uw_risk',   label: 'Life UW Risk',           icon: FlaskConical,  path: '/life-uw-risk' },
      { key: 'assets',         label: 'Asset Register',         icon: Landmark,      path: '/assets' },
    ],
  },
  2: {
    headline: 'Governance — how we run, decide, control',
    tiles: [
      { key: 'orsa',              label: 'ORSA',               icon: Workflow,    path: '/orsa' },
      { key: 'model_governance',  label: 'Model Governance',   icon: Scale,       path: '/model-governance' },
      { key: 'afr',               label: 'Actuarial Function', icon: ScrollText,  path: '/afr' },
      { key: 'internal_controls', label: 'Internal Controls',  icon: Lock,        path: '/internal-controls' },
    ],
  },
  3: {
    headline: 'Disclosure — what we report, to whom',
    tiles: [
      { key: 'qrt_pack',     label: 'QRT Submission Pack', icon: ArchiveIcon, path: '/archive' },
      { key: 'sfcr',         label: 'SFCR (Public)',       icon: Newspaper,   path: '/sfcr' },
      { key: 'rsr',          label: 'RSR (Supervisor)',    icon: FileText,    path: '/rsr' },
      { key: 'regulator_qa', label: 'Regulator Q&A',       icon: Bot,         path: '/regulator-qa' },
    ],
  },
};

const STATUS_VARIANT: Record<TileStatus, { Icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  ready:     { Icon: CheckCircle2,  cls: 'text-green-600' },
  pending:   { Icon: Clock,         cls: 'text-gray-400' },
  attention: { Icon: AlertTriangle, cls: 'text-amber-600' },
};

export default function Landing() {
  const [status, setStatus] = useState<LandingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const isForum = new URLSearchParams(location.search).get('mode') === 'forum';

  useEffect(() => {
    fetchLandingStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (isForum) return <ForumHero status={status} loading={loading} />;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-7">
      {/* Hero */}
      <div className="pt-2">
        <h2 className="text-3xl font-bold text-gray-900">Solvency II at the Speed of Lakehouse</h2>
        <p className="text-base text-gray-500 mt-1.5 leading-relaxed">
          Bricksurance SE — a mid-size European composite (P&C + Life on one balance sheet).
          Three doors below: today's operational state, the regime's reference view, or a guided
          walkthrough of how Solvency II works.
        </p>
      </div>

      {/* Two doors — primary entry points */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DoorCard
          to="/today"
          icon={Activity}
          title="Control Tower"
          tagline="Where are we now?"
          body="Operational state — late feeds, pending approvals, what needs doing, solvency tile + ORSA tile, recent overlays + pending model promotions."
          accent="amber"
        />
        <DoorCard
          to="/reporting-cycle"
          icon={Layers}
          title="Reporting Cycle"
          tagline="Three pillars, every artefact."
          body="Reference view. Pillar 1 calculation, Pillar 2 governance, Pillar 3 disclosure. Click any deliverable to open it."
          accent="blue"
        />
      </div>

      {/* Pillar preview — de-emphasised peek into Reporting Cycle */}
      <details className="bg-white rounded-lg border border-gray-200 p-4 group">
        <summary className="cursor-pointer flex items-center gap-2 text-sm">
          <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Pillar preview</span>
          <span className="text-gray-400">— peek at the Reporting Cycle without leaving home</span>
          <Link to="/reporting-cycle" className="ml-auto text-[11px] text-blue-600 font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
            Open Reporting Cycle →
          </Link>
        </summary>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-100">
          <PillarColumn pillar={1} status={status} loading={loading} />
          <PillarColumn pillar={2} status={status} loading={loading} />
          <PillarColumn pillar={3} status={status} loading={loading} />
        </div>
      </details>

      {/* Control Tower strip — quick glance, links into Today */}
      <ControlTowerStrip status={status} loading={loading} />

      {/* Workbench horizon — the closing frame */}
      <Link to="/horizon"
        className="block bg-gradient-to-br from-slate-900 via-slate-800 to-violet-900 rounded-xl p-5 text-white hover:from-slate-950 transition-colors group">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-violet-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-violet-300 font-bold">Workbench horizon</div>
            <h3 className="text-lg font-bold tracking-tight mt-0.5">
              Solvency II is what we showed today. The workbench is what runs the next decade.
            </h3>
            <p className="text-sm text-slate-300 mt-1">
              Pricing, IFRS 17, claims analytics, reinsurance optimisation, capital steering — same data, same governance, same AI.
            </p>
          </div>
          <span className="text-violet-200 font-semibold text-sm group-hover:translate-x-1 transition-transform whitespace-nowrap">View →</span>
        </div>
      </Link>

      {/* About this demo */}
      <details className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
        <summary className="font-semibold text-gray-800 cursor-pointer">About this demo</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Working demonstration of the Solvency II reporting cycle on Databricks. Pipelines, AI agents,
            model governance, and approval workflows all run on Declarative Pipelines, Unity Catalog,
            Foundation Model API, and Databricks Apps.
          </p>
          <p className="italic text-gray-600">
            Data is synthetic; templates and AI prompts are illustrative — vehicle, not cargo. Source code on GitHub —
            deployable to any Databricks workspace.
          </p>
        </div>
      </details>
    </div>
  );
}

function DoorCard({ to, icon: Icon, title, tagline, body, accent }: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tagline: string;
  body: string;
  accent: 'amber' | 'blue';
}) {
  const cls = {
    amber: { hover: 'hover:border-amber-400 hover:shadow-amber-100', iconBg: 'bg-amber-100 group-hover:bg-amber-200', iconColor: 'text-amber-700', title: 'text-amber-900', arrow: 'text-amber-700' },
    blue:  { hover: 'hover:border-blue-400 hover:shadow-blue-100',   iconBg: 'bg-blue-100 group-hover:bg-blue-200',   iconColor: 'text-blue-700',  title: 'text-blue-900',  arrow: 'text-blue-700' },
  }[accent];
  return (
    <Link to={to}
      className={`group bg-white border-2 border-gray-200 rounded-2xl p-5 transition-all hover:shadow-lg ${cls.hover} flex flex-col`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-12 h-12 rounded-xl ${cls.iconBg} flex items-center justify-center transition-colors`}>
          <Icon className={`w-6 h-6 ${cls.iconColor}`} />
        </div>
        <div className="flex-1">
          <h3 className={`text-2xl font-bold ${cls.title} tracking-tight`}>{title}</h3>
        </div>
      </div>
      <p className="text-sm font-semibold text-gray-800">{tagline}</p>
      <p className="text-xs text-gray-600 mt-1 leading-relaxed flex-1">{body}</p>
      <div className={`mt-3 inline-flex items-center gap-1 text-sm font-bold ${cls.arrow}`}>
        Open <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}

function PillarColumn({ pillar, status, loading }: {
  pillar: Exclude<Pillar, 'cross'>;
  status: LandingStatus | null;
  loading: boolean;
}) {
  const navigate = useNavigate();
  const meta = PILLAR_META[pillar];
  const def = PILLAR_DELIVERABLES[pillar];
  return (
    <section className="rounded-xl border-2 bg-white overflow-hidden" style={{ borderColor: meta.border }}>
      <header className="px-5 py-4" style={{ backgroundColor: meta.soft }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: meta.color }}>{meta.full}</h3>
          <PillarChip pillar={pillar} size="md" />
        </div>
        <p className="text-sm mt-0.5" style={{ color: meta.color, opacity: 0.85 }}>
          {def.headline}
        </p>
      </header>
      <ul className="divide-y divide-gray-100">
        {def.tiles.map((t) => {
          const tile = status?.tiles[t.key];
          const tileStatus: TileStatus = tile?.status ?? 'pending';
          const variant = STATUS_VARIANT[tileStatus];
          const StatusIcon = variant.Icon;
          return (
            <li key={t.key}>
              <button
                onClick={() => navigate(t.path)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group"
              >
                <t.icon className="w-4 h-4 text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{t.label}</div>
                  <div className={`text-[11px] ${variant.cls} mt-0.5 truncate`}>
                    {loading ? 'loading…' : (tile?.metric ?? '—')}
                  </div>
                </div>
                <StatusIcon className={`w-4 h-4 shrink-0 ${variant.cls}`} />
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ControlTowerStrip({ status, loading }: { status: LandingStatus | null; loading: boolean }) {
  const navigate = useNavigate();
  const ct = status?.control_tower;
  const lateMissing = ct?.feeds_late_or_missing ?? 0;
  const reconMm = ct?.recon_mismatches ?? 0;
  const reconTotal = ct?.recon_total ?? 0;
  const reconMatch = Math.max(0, reconTotal - reconMm);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-700" />
          <h3 className="text-sm font-bold text-gray-800">Control Tower — Monday morning view</h3>
          <PillarChip pillar="cross" size="sm" />
          {ct?.latest_period && (
            <span className="text-[11px] text-gray-500">period {ct.latest_period}</span>
          )}
        </div>
        <button
          onClick={() => navigate('/monitor')}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
        >
          Open Control Tower <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi
            icon={Activity}
            label="Feeds late or missing"
            value={String(lateMissing)}
            tone={lateMissing === 0 ? 'good' : 'warn'}
          />
          <Kpi
            icon={ShieldCheck}
            label="Reconciliation"
            value={`${reconMatch}/${reconTotal} match`}
            tone={reconMm === 0 ? 'good' : 'warn'}
          />
          <Kpi
            icon={CheckCircle2}
            label="QRT pack"
            value={status?.tiles['qrt_pack']?.metric ?? '—'}
            tone={status?.tiles['qrt_pack']?.status === 'attention' ? 'warn' : 'good'}
          />
          <Kpi
            icon={Clock}
            label="Submission deadline"
            value="Friday EOW"
            tone="neutral"
          />
        </div>
      )}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, tone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const cls = tone === 'good'
    ? 'border-green-200 bg-green-50/60 text-green-900'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50/60 text-amber-900'
      : 'border-gray-200 bg-white text-gray-700';
  const iconCls = tone === 'good' ? 'text-green-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-500';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <Icon className={`w-4 h-4 ${iconCls}`} />
      <div className="text-xl font-bold mt-1 truncate">{value}</div>
      <div className="text-[11px] opacity-80">{label}</div>
    </div>
  );
}

/* ── Forum-mode hero ─────────────────────────────────────────────────
 * Activated by ?mode=forum. Projector-friendly: large fonts, full-bleed
 * three-pillar layout, single "Begin demo" CTA → /monitor. The
 * default landing remains untouched for non-forum use.
 */
function ForumHero({ status, loading }: { status: LandingStatus | null; loading: boolean }) {
  const navigate = useNavigate();
  const period = status?.control_tower?.latest_period ?? '2025-Q4';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top — title strip */}
      <div className="px-12 pt-12 pb-6 text-center">
        <div className="text-sm uppercase tracking-[0.4em] text-slate-500">Forum talk</div>
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mt-3">
          Solvency II at the Speed of Lakehouse
        </h1>
        <p className="text-xl text-gray-500 mt-3">
          Bricksurance SE — a mid-size European composite — closing the {period} reporting cycle on a single platform.
        </p>
      </div>

      {/* 3 pillars taking the centre of the screen */}
      <div className="flex-1 px-12 grid grid-cols-3 gap-6 items-stretch">
        <ForumPillar pillar={1} status={status} loading={loading} />
        <ForumPillar pillar={2} status={status} loading={loading} />
        <ForumPillar pillar={3} status={status} loading={loading} />
      </div>

      {/* Begin CTA */}
      <div className="px-12 py-10 text-center">
        <button
          onClick={() => navigate('/monitor')}
          className="text-2xl font-bold px-10 py-4 rounded-xl bg-gray-900 text-white hover:bg-gray-800 shadow-lg"
        >
          Begin demo →
        </button>
      </div>
    </div>
  );
}

function ForumPillar({ pillar, status, loading }: {
  pillar: 1 | 2 | 3;
  status: LandingStatus | null;
  loading: boolean;
}) {
  const meta = PILLAR_META[pillar];
  const def = PILLAR_DELIVERABLES[pillar];
  return (
    <section className="rounded-2xl border-4 bg-white flex flex-col" style={{ borderColor: meta.border }}>
      <header className="px-8 py-6" style={{ backgroundColor: meta.soft }}>
        <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: meta.color }}>
          Pillar {pillar}
        </div>
        <h2 className="text-3xl font-bold mt-1" style={{ color: meta.color }}>
          {pillar === 1 ? 'Capital' : pillar === 2 ? 'Governance' : 'Disclosure'}
        </h2>
        <p className="text-base mt-1" style={{ color: meta.color, opacity: 0.85 }}>{def.headline}</p>
      </header>
      <ul className="flex-1 divide-y divide-gray-100 text-base">
        {def.tiles.slice(0, 5).map((t) => {
          const tile = status?.tiles[t.key];
          const tileStatus: TileStatus = tile?.status ?? 'pending';
          const v = STATUS_VARIANT[tileStatus];
          return (
            <li key={t.key} className="px-8 py-4 flex items-start gap-3">
              <v.Icon className={`w-5 h-5 mt-0.5 ${v.cls}`} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900">{t.label}</div>
                <div className={`text-sm ${v.cls} mt-0.5`}>{loading ? 'loading…' : (tile?.metric ?? '—')}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight, Shield, BarChart3, BookOpen, Flame, FlaskConical, Landmark,
  Workflow, Scale, ScrollText, Lock, Archive as ArchiveIcon, Newspaper, FileText, Bot,
  CheckCircle2, AlertTriangle, Clock, Activity, ShieldCheck,
} from 'lucide-react';
import PillarChip, { type Pillar, PILLAR_META } from '../components/PillarChip';
import { fetchSlaStatus, fetchDqSummary, fetchReconciliation, type Row } from '../lib/api';

interface DeliverableTile {
  label: string;
  status: 'ready' | 'pending' | 'attention';
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const PILLAR_DELIVERABLES: Record<Exclude<Pillar, 'cross'>, { headline: string; tiles: DeliverableTile[] }> = {
  1: {
    headline: 'Capital — what we hold and why',
    tiles: [
      { label: 'SCR & Standard Formula',  status: 'ready',     icon: Shield,        path: '/scr' },
      { label: 'Reserving & TPs (P&C)',   status: 'ready',     icon: BarChart3,     path: '/reserving-pnc' },
      { label: 'Reserving & TPs (Life)',  status: 'ready',     icon: BookOpen,      path: '/reserving-life' },
      { label: 'Non-Life UW Risk',        status: 'ready',     icon: Flame,         path: '/nl-uw-risk' },
      { label: 'Life UW Risk',            status: 'ready',     icon: FlaskConical,  path: '/life-uw-risk' },
      { label: 'Asset Register',          status: 'attention', hint: 'duplicate ISIN flagged', icon: Landmark, path: '/assets' },
    ],
  },
  2: {
    headline: 'Governance — how we run, decide, control',
    tiles: [
      { label: 'ORSA',                    status: 'pending',   hint: 'in progress', icon: Workflow,      path: '/orsa' },
      { label: 'Model Governance',        status: 'attention', hint: 'Challenger pending decision', icon: Scale, path: '/model-governance' },
      { label: 'Actuarial Function',      status: 'pending',   icon: ScrollText,    path: '/afr' },
      { label: 'Internal Controls',       status: 'ready',     icon: Lock,          path: '/internal-controls' },
    ],
  },
  3: {
    headline: 'Disclosure — what we report, to whom',
    tiles: [
      { label: 'QRT Submission Pack',     status: 'attention', hint: '5 of 5 ready, 1 quarantined', icon: ArchiveIcon, path: '/archive' },
      { label: 'SFCR (Public)',           status: 'pending',   icon: Newspaper,     path: '/sfcr' },
      { label: 'RSR (Supervisor)',        status: 'pending',   icon: FileText,      path: '/rsr' },
      { label: 'Regulator Q&A',           status: 'ready',     icon: Bot,           path: '/regulator-qa' },
    ],
  },
};

const STATUS_VARIANT: Record<DeliverableTile['status'], { Icon: React.ComponentType<{ className?: string }>; label: string }> = {
  ready:     { Icon: CheckCircle2,   label: 'ready' },
  pending:   { Icon: Clock,          label: 'pending' },
  attention: { Icon: AlertTriangle,  label: 'needs attention' },
};

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Hero */}
      <div className="pt-2">
        <h2 className="text-3xl font-bold text-gray-900">Solvency II — Composite Insurer Cycle</h2>
        <p className="text-base text-gray-500 mt-1">
          Bricksurance SE — a mid-size European composite (P&C + Life on one balance sheet).
          The cycle below is structured by the Solvency II three-pillar framework.
        </p>
      </div>

      {/* 3-column pillar hero */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PillarColumn pillar={1} navigate={navigate} />
        <PillarColumn pillar={2} navigate={navigate} />
        <PillarColumn pillar={3} navigate={navigate} />
      </div>

      {/* Control Tower strip — Monday-morning view */}
      <ControlTowerStrip />

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
            Data is synthetic; templates and AI prompts are illustrative. Source code on GitHub —
            deployable to any Databricks workspace.
          </p>
        </div>
      </details>
    </div>
  );
}

function PillarColumn({ pillar, navigate }: { pillar: Exclude<Pillar, 'cross'>; navigate: ReturnType<typeof useNavigate> }) {
  const meta = PILLAR_META[pillar];
  const def = PILLAR_DELIVERABLES[pillar];
  return (
    <section
      className="rounded-xl border-2 bg-white overflow-hidden"
      style={{ borderColor: meta.border }}
    >
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
          const StatusIcon = STATUS_VARIANT[t.status].Icon;
          const statusColor = t.status === 'ready'
            ? 'text-green-600'
            : t.status === 'attention' ? 'text-amber-600' : 'text-gray-400';
          return (
            <li key={t.label}>
              <button
                onClick={() => navigate(t.path)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group"
              >
                <t.icon className="w-4 h-4 text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{t.label}</div>
                  {t.hint && <div className={`text-[11px] ${statusColor} mt-0.5`}>{t.hint}</div>}
                </div>
                <StatusIcon className={`w-4 h-4 shrink-0 ${statusColor}`} />
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ControlTowerStrip() {
  const navigate = useNavigate();
  const [sla, setSla] = useState<Row[]>([]);
  const [dq, setDq] = useState<{ aggregate: Row | null }>({ aggregate: null });
  const [recon, setRecon] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchSlaStatus().then((r) => setSla(r.data)),
      fetchDqSummary().then(setDq),
      fetchReconciliation().then((r) => setRecon(r.data)),
    ])
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const lateMissing = sla.filter((f) => f.status === 'late' || f.status === 'missing').length;
  const passRate = dq.aggregate?.overall_pass_rate ?? '—';
  const reconMatch = recon.filter((r) => r.status === 'MATCH').length;
  const reconTotal = recon.length;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-700" />
          <h3 className="text-sm font-bold text-gray-800">Control Tower — Monday morning view</h3>
          <PillarChip pillar="cross" size="sm" />
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
            label="DQ pass rate"
            value={`${passRate}%`}
            tone={parseFloat(String(passRate)) >= 99 ? 'good' : 'warn'}
          />
          <Kpi
            icon={CheckCircle2}
            label="Reconciliation"
            value={`${reconMatch}/${reconTotal} match`}
            tone={reconMatch === reconTotal ? 'good' : 'warn'}
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
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[11px] opacity-80">{label}</div>
    </div>
  );
}

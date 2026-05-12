import { useState, useEffect } from 'react';
import {
  Scale, BarChart3, Database, ShieldCheck, FileSearch,
  GitCompare, FlaskConical, Bot, Workflow, History, ScrollText,
  CheckCircle2, XCircle, Clock, TrendingUp, AlertTriangle,
} from 'lucide-react';
import { fetchProcessMetrics, type ProcessMetrics } from '../lib/api';
import { Skeleton } from '../components/Skeleton';

type TabId = 'overview' | 'inventory';

export default function Governance() {
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Scale className="w-6 h-6 text-violet-600" />
          Governance
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Process health and an inventory of everything the platform records along the way
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabButton
          active={tab === 'overview'}
          onClick={() => setTab('overview')}
          icon={BarChart3}
          label="Process Overview"
          hint="KPIs and trends a process manager wants on a single screen"
        />
        <TabButton
          active={tab === 'inventory'}
          onClick={() => setTab('inventory')}
          icon={Database}
          label="Data Collected & Uses"
          hint="What we record across the process — and how it can be used"
        />
      </div>

      {tab === 'overview' && <ProcessOverview />}
      {tab === 'inventory' && <DataInventory />}
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, label, hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-violet-600 text-violet-700 bg-violet-50/50'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

/* ═══════════════════════ Tab 1: Process Overview ═══════════════════════ */

export function ProcessOverview() {
  const [metrics, setMetrics] = useState<ProcessMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProcessMetrics()
      .then(setMetrics)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
        Failed to load process metrics: {error || 'unknown'}
      </div>
    );
  }

  const k = metrics.kpis;

  return (
    <div className="space-y-5">
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 text-sm text-violet-900">
        <p>
          <strong>For the process owner.</strong> Where do submissions stand right now, how long do they take,
          and where is data quality drifting? Numbers below are aggregated across {k.periods_covered}{' '}
          reporting period{k.periods_covered === 1 ? '' : 's'}{' '}
          ({k.earliest_period} → {k.latest_period}).
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={CheckCircle2}
          label="Approval rate"
          value={k.approval_rate_pct != null ? `${k.approval_rate_pct}%` : '—'}
          sub={`${k.approved} of ${k.total_submissions} submissions`}
          tone={k.approval_rate_pct != null && k.approval_rate_pct >= 80 ? 'good' : 'warn'}
        />
        <KpiCard
          icon={Clock}
          label="Avg cycle time"
          value={k.avg_cycle_hours != null ? formatHours(k.avg_cycle_hours) : '—'}
          sub={k.median_cycle_hours != null ? `median ${formatHours(k.median_cycle_hours)}` : 'submit → approve'}
          tone="neutral"
        />
        <KpiCard
          icon={XCircle}
          label="Rejection rate"
          value={k.rejection_rate_pct != null ? `${k.rejection_rate_pct}%` : '—'}
          sub={`${k.rejected} rejected, ${k.pending} pending`}
          tone={k.rejection_rate_pct != null && k.rejection_rate_pct < 10 ? 'good' : 'warn'}
        />
        <KpiCard
          icon={Workflow}
          label="In flight"
          value={`${k.pending}`}
          sub="awaiting review"
          tone={k.pending > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* DQ + SLA trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PanelCard title="Data quality trend (live monitoring)" icon={ShieldCheck} hint="Aggregate pass-rate across all bronze tables, refreshed live. The Submissions Archive shows the DQ snapshot at sign-off — typically slightly lower because it includes feed-window incidents that resolved later.">
          <DqTrendBars data={metrics.dq_trend} />
        </PanelCard>
        <PanelCard title="Feed punctuality" icon={Workflow} hint="Late + missing feeds per period.">
          <SlaTrendBars data={metrics.sla_trend} />
        </PanelCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PanelCard title="Submissions per period" icon={TrendingUp} hint="Includes resubmissions.">
          <SubmissionsBars data={metrics.submissions_per_period} />
        </PanelCard>
        <PanelCard title="Approver workload" icon={ScrollText} hint="Top reviewers by submission count.">
          <PeopleList rows={metrics.top_reviewers} emptyText="No reviews recorded yet." />
        </PanelCard>
      </div>

      {/* Process callouts (manager Q&A) */}
      <Callouts metrics={metrics} />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const toneClass = tone === 'good'
    ? 'border-green-200 bg-green-50/60'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50/60'
      : 'border-gray-200 bg-white';
  const iconClass = tone === 'good' ? 'text-green-600' : tone === 'warn' ? 'text-amber-600' : 'text-violet-600';
  return (
    <div className={`rounded-lg border ${toneClass} p-4`}>
      <div className="flex items-center justify-between mb-1.5">
        <Icon className={`w-4 h-4 ${iconClass}`} />
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-700 font-medium mt-0.5">{label}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

function PanelCard({ title, icon: Icon, hint, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50/60 flex items-center gap-2">
        <Icon className="w-4 h-4 text-violet-600" />
        <div>
          <div className="text-sm font-bold text-gray-800">{title}</div>
          {hint && <div className="text-[10px] text-gray-500">{hint}</div>}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DqTrendBars({ data }: { data: ProcessMetrics['dq_trend'] }) {
  if (!data.length) return <Empty />;
  return (
    <div className="space-y-2">
      {data.map((row) => {
        const pct = parseFloat(String(row.pass_rate_pct ?? 0));
        const failing = parseInt(String(row.failing_checks ?? 0), 10);
        const tone = pct >= 99 ? 'bg-green-500' : pct >= 95 ? 'bg-amber-500' : 'bg-red-500';
        return (
          <div key={row.reporting_period} className="text-xs">
            <div className="flex justify-between mb-0.5">
              <span className="font-mono text-gray-700">{row.reporting_period}</span>
              <span className="font-medium text-gray-700">{pct}% {failing > 0 && <span className="text-amber-600">· {failing} failing</span>}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded overflow-hidden">
              <div className={`h-full ${tone} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SlaTrendBars({ data }: { data: ProcessMetrics['sla_trend'] }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((d) => parseInt(String(d.feed_count || 0), 10)));
  return (
    <div className="space-y-2">
      {data.map((row) => {
        const total = parseInt(String(row.feed_count || 0), 10);
        const late = parseInt(String(row.late_count || 0), 10);
        const missing = parseInt(String(row.missing_count || 0), 10);
        const onTime = parseInt(String(row.on_time_count || 0), 10);
        const w = (n: number) => total > 0 ? `${(n / max) * 100}%` : '0%';
        return (
          <div key={row.reporting_period} className="text-xs">
            <div className="flex justify-between mb-0.5">
              <span className="font-mono text-gray-700">{row.reporting_period}</span>
              <span className="text-gray-500">
                <span className="text-green-700">{onTime}</span> on-time
                {late > 0 && <> · <span className="text-amber-700">{late}</span> late</>}
                {missing > 0 && <> · <span className="text-red-700">{missing}</span> missing</>}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded overflow-hidden flex">
              <div className="h-full bg-green-500" style={{ width: w(onTime) }} />
              <div className="h-full bg-amber-500" style={{ width: w(late) }} />
              <div className="h-full bg-red-500" style={{ width: w(missing) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SubmissionsBars({ data }: { data: ProcessMetrics['submissions_per_period'] }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={row.period} className="text-xs">
          <div className="flex justify-between mb-0.5">
            <span className="font-mono text-gray-700">{row.period}</span>
            <span className="font-medium text-gray-700">{row.count}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded overflow-hidden">
            <div className="h-full bg-violet-500" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PeopleList({ rows, emptyText }: { rows: { name: string; count: number }[]; emptyText: string }) {
  if (!rows.length) return <div className="text-xs text-gray-400 italic">{emptyText}</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((p) => (
        <div key={p.name} className="flex items-center justify-between text-xs">
          <span className="text-gray-700 truncate">{p.name}</span>
          <span className="font-mono text-gray-500 ml-2">{p.count}</span>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-gray-400 italic">No data yet for this view.</div>;
}

function Callouts({ metrics }: { metrics: ProcessMetrics }) {
  const k = metrics.kpis;
  const callouts: { tone: 'good' | 'warn' | 'info'; icon: React.ComponentType<{ className?: string }>; text: string }[] = [];

  if (k.pending > 0) {
    callouts.push({
      tone: 'warn',
      icon: Clock,
      text: `${k.pending} submission${k.pending === 1 ? '' : 's'} awaiting review — see the Archive for the queue.`,
    });
  }
  if (k.rejected > 0) {
    callouts.push({
      tone: 'warn',
      icon: AlertTriangle,
      text: `${k.rejected} submission${k.rejected === 1 ? ' was' : 's were'} rejected and required resubmission.`,
    });
  }
  if (k.avg_cycle_hours != null && k.avg_cycle_hours < 72) {
    callouts.push({
      tone: 'good',
      icon: CheckCircle2,
      text: `Average submit→approve cycle is ${formatHours(k.avg_cycle_hours)} — comfortably within target.`,
    });
  }
  // Latest DQ
  const lastDq = metrics.dq_trend[metrics.dq_trend.length - 1];
  if (lastDq) {
    const pct = parseFloat(String(lastDq.pass_rate_pct ?? 0));
    if (pct < 99) {
      callouts.push({
        tone: 'warn',
        icon: ShieldCheck,
        text: `Latest period DQ pass rate is ${pct}% — review failing checks on the Monitor page before approval.`,
      });
    }
  }

  if (callouts.length === 0) {
    callouts.push({
      tone: 'good',
      icon: CheckCircle2,
      text: 'No outstanding action items. The process is on track.',
    });
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-gray-800">What needs my attention?</h3>
      <div className="space-y-1.5">
        {callouts.map((c, i) => {
          const cls = c.tone === 'warn'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : c.tone === 'good'
              ? 'border-green-200 bg-green-50 text-green-900'
              : 'border-blue-200 bg-blue-50 text-blue-900';
          return (
            <div key={i} className={`flex items-start gap-2 px-3 py-2 border rounded-md text-sm ${cls}`}>
              <c.icon className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{c.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/* ═══════════════════════ Tab 2: Data Collected & Uses ═══════════════════════ */

interface DataCategory {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  collected: { item: string; where: string }[];
  uses: string[];
}

const DATA_CATEGORIES: DataCategory[] = [
  {
    name: 'Raw regulatory data feeds',
    icon: Database,
    collected: [
      { item: 'Assets, premiums, claims, expenses, exposures, reinsurance, counterparties', where: '`1_raw_*` tables' },
      { item: 'Source system, ingest timestamp, file checksum', where: 'Per-row metadata in raw tables' },
      { item: 'Reporting period and entity LEI', where: 'Partition columns' },
    ],
    uses: [
      'Source-of-truth for all downstream QRT calculations',
      'Recoverability — every published number can be reconstructed from raw',
      'Regulatory inquiry response (EIOPA, NSAs)',
      'Internal investigations into specific portfolios or LoBs',
    ],
  },
  {
    name: 'Data quality outcomes',
    icon: ShieldCheck,
    collected: [
      { item: 'DLT expectation pass/fail counts per pipeline & table', where: '`5_mon_dq_expectation_results`' },
      { item: 'Constraint definitions and severity (warn / drop / fail)', where: 'DLT pipeline source' },
      { item: 'Failing-row samples and SQL', where: 'DQ investigation panel' },
    ],
    uses: [
      'Pre-submission gating — block approval when checks fail',
      'Trend analysis — DQ pass rate over time per feed',
      'Post-incident analysis — what failed, when, by how much',
      'Operational SLA reporting to the Risk Committee',
    ],
  },
  {
    name: 'Pipeline & SLA telemetry',
    icon: Workflow,
    collected: [
      { item: 'Feed arrival vs SLA deadline, status (on-time / late / missing)', where: '`5_mon_pipeline_sla_status`' },
      { item: 'Pipeline run duration and outcome', where: 'DLT system tables + monitoring layer' },
      { item: 'Free-text notes (e.g. "DQ rejected, awaiting resubmission Monday")', where: '`notes` column' },
    ],
    uses: [
      'Real-time deadline-risk view — "are we on track for Friday?"',
      'Cycle-time reduction — find the slowest steps and fix them',
      'Vendor / data-supplier SLA enforcement',
      'Capacity planning for warehouse and pipeline compute',
    ],
  },
  {
    name: 'Cross-QRT reconciliation',
    icon: GitCompare,
    collected: [
      { item: 'Named consistency checks across templates with source/target/diff/tolerance', where: '`5_mon_cross_qrt_reconciliation`' },
      { item: 'Pass/fail status with explanation', where: 'Same table' },
    ],
    uses: [
      'Block approval on material mismatches',
      'Identify methodology drift between teams',
      'Provide reviewer-ready evidence of internal consistency',
    ],
  },
  {
    name: 'Stochastic & SCR model runs',
    icon: FlaskConical,
    collected: [
      { item: 'Run ID, scenario count, calibration parameters, runtime', where: '`4_eng_stochastic_run_log`' },
      { item: 'Per-scenario distribution outputs (P-distribution, VaR, TVaR)', where: '`4_eng_stochastic_results`' },
      { item: 'Standard formula intermediate breakdowns', where: '`3_qrt_s2501_scr_breakdown`' },
      { item: 'Champion/Challenger model version per run', where: 'Bound to MLflow model version' },
    ],
    uses: [
      'Reproducibility — re-run any past period with the same inputs and get the same number',
      'Model validation / back-testing',
      'Sensitivity analysis for the Risk Committee',
      'Regulatory IMA inquiry response (if applicable)',
    ],
  },
  {
    name: 'Approval workflow & governance log',
    icon: ScrollText,
    collected: [
      { item: 'Submission and approval events with actor, timestamp, comments', where: '`6_ai_approvals`' },
      { item: 'Per-period Governance Log PDF (data + DQ + AI verdict snapshot)', where: 'Generated artefact' },
    ],
    uses: [
      'SOX-style audit trail',
      'External auditor evidence pack',
      'Regulator response — "show me the approval record for Q3 S.25.01"',
      'Internal post-mortem on rejected submissions',
    ],
  },
  {
    name: 'AI / agent telemetry',
    icon: Bot,
    collected: [
      { item: 'System prompt, user prompt, model used, input/output tokens', where: 'MLflow traces' },
      { item: 'Tool calls, arguments, durations, results', where: 'Supervisor reasoning trace' },
      { item: 'Guardrail outcomes (PII flags, length, refusal patterns)', where: '`server/guardrails.py` + log' },
      { item: 'AI Gateway events (rate limits, content filter hits)', where: 'Gateway logs' },
    ],
    uses: [
      'AI explainability for regulators and internal model risk teams',
      'Cost attribution per agent / per QRT',
      'Quality monitoring — flag outputs that drift from baseline',
      'Continuous improvement — what questions does the chat answer poorly?',
    ],
  },
  {
    name: 'Lineage & metadata',
    icon: History,
    collected: [
      { item: 'Column-level lineage from raw → staging → gold', where: 'Unity Catalog (automatic)' },
      { item: 'Table descriptions and column descriptions', where: 'UC `COMMENT` metadata' },
      { item: 'Permissions / GRANTs', where: 'Unity Catalog audit log' },
    ],
    uses: [
      'Impact analysis when a raw feed schema changes',
      'Compliance evidence for "where does this number come from?"',
      'Onboarding new analysts via auto-generated data dictionary',
      'Detection of unauthorized access attempts (audit log)',
    ],
  },
];

export function DataInventory() {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <FileSearch className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">What is collected, and what it's good for</p>
            <p>
              The platform records data at every step of the QRT cycle — not just the regulatory outputs. This
              page lists every category of data the platform persists, where it lives, and the kinds of questions
              it lets you answer. None of these are speculative future capabilities; everything below is wired up today.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DATA_CATEGORIES.map((cat) => (
          <div key={cat.name} className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-blue-50 border-b border-gray-200 flex items-center gap-2">
              <cat.icon className="w-4 h-4 text-violet-600" />
              <h4 className="text-sm font-bold text-gray-800">{cat.name}</h4>
            </div>
            <div className="p-4 space-y-3 text-sm flex-1">
              <div>
                <div className="text-[11px] uppercase tracking-wide font-bold text-gray-500 mb-1">Collected</div>
                <ul className="space-y-1">
                  {cat.collected.map((c, i) => (
                    <li key={i} className="text-gray-700 leading-snug">
                      <span>{c.item}</span>
                      <span className="text-gray-400 text-xs ml-1.5">— <code className="px-1 py-0.5 bg-gray-100 rounded text-[11px] font-mono text-violet-700">{c.where.replace(/`/g, '')}</code></span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide font-bold text-gray-500 mb-1">How it can be used</div>
                <ul className="space-y-0.5">
                  {cat.uses.map((u, i) => (
                    <li key={i} className="text-gray-600 text-xs leading-snug flex gap-1.5">
                      <span className="text-violet-400">•</span>
                      <span>{u}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

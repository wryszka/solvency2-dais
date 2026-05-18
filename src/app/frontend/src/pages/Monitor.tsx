import { useEffect, useState } from 'react';
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle, Bot,
  Sparkles, Shield, ChevronDown, ChevronUp, BarChart3, Database, GitCompare, Workflow, Scale,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { Skeleton, SkeletonTable } from '../components/Skeleton';
import Q4PainCallouts from '../components/Q4PainCallouts';
import ControlTowerHero, { type HealthLevel } from '../components/ControlTowerHero';
import ReadinessPanel from '../components/ReadinessPanel';
import PipelinePanel from '../components/PipelinePanel';
import { fetchSlaStatus, fetchDqSummary, fetchReconciliation, generateCrossQrtReview, fetchFeedDetail, investigateRecon, fetchOverlays, fetchPeriodState, formatEur, type Row, type CrossQrtReviewResponse, type FeedDetail, type ReconInvestigation, type PeriodState } from '../lib/api';
import { renderMarkdownSafe } from '../lib/markdown';
import { ProcessOverview, DataInventory } from './Governance';

type MonitorTab = 'overview' | 'ingestion' | 'reconciliation' | 'process' | 'catalog';

export default function Monitor({ initialTab = 'overview' }: { initialTab?: MonitorTab } = {}) {
  const [sla, setSla] = useState<Row[]>([]);
  const [dq, setDq] = useState<{ data: Row[]; aggregate: Row | null }>({ data: [], aggregate: null });
  const [recon, setRecon] = useState<Row[]>([]);
  const [pendingOverlays, setPendingOverlays] = useState<number>(0);
  const [activeOverlays, setActiveOverlays] = useState<number>(0);
  const [pendingApprovals, setPendingApprovals] = useState<number>(0);
  const [periodState, setPeriodState] = useState<PeriodState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MonitorTab>(initialTab);

  useEffect(() => {
    Promise.all([
      fetchSlaStatus().then((r) => setSla(r.data)),
      fetchDqSummary().then(setDq),
      fetchReconciliation().then((r) => setRecon(r.data)),
      fetchPeriodState().then(setPeriodState).catch(() => undefined),
      // Pending approvals = overlays awaiting + SF challenger if pending (count >= 0 derivable)
      fetchOverlays({ status: 'pending_approval' }).then((r) => setPendingOverlays(r.overlays.length)).catch(() => undefined),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Once we know the current period, fetch quarter-active overlays + pending-approvals total
  useEffect(() => {
    if (!periodState) return;
    fetchOverlays({ quarter: periodState.current_period }).then((r) => {
      setActiveOverlays(r.overlays.filter((o) => o.status === 'approved').length);
    }).catch(() => undefined);
    // SF Challenger is a single pending sign-off if current_state is pending_approval (always true post-rebase)
    setPendingApprovals(pendingOverlays + 1);
  }, [periodState, pendingOverlays]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
        <SkeletonTable rows={6} cols={5} />
        <SkeletonTable rows={4} cols={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
          Failed to load monitoring data: {error}
        </div>
      </div>
    );
  }

  const feedsLate = sla.filter((f) => f.status === 'late').length;
  const feedsMissing = sla.filter((f) => f.status === 'missing').length;
  const agg = dq.aggregate;
  const totalFailing = parseInt(agg?.total_failing || '0');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Hero strip — quarter, deadline, traffic-light health, three meaningful KPIs */}
      {periodState && (() => {
        const reconMismatches = recon.filter((r) => r.status !== 'MATCH').length;
        const fired = (feedsLate + feedsMissing) + (totalFailing > 0 ? 1 : 0) + (reconMismatches > 0 ? 1 : 0) + (pendingApprovals > 0 ? 1 : 0);
        const health: HealthLevel = fired === 0 ? 'green' : (feedsLate > 0 || reconMismatches > 0) ? 'amber' : 'amber';
        return (
          <ControlTowerHero
            period={periodState.current_period}
            deadline={periodState.deadline}
            businessDaysToDeadline={periodState.business_days_to_deadline}
            health={health}
            pendingApprovals={pendingApprovals}
            activeOverlays={activeOverlays}
          />
        );
      })()}

      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-bold text-gray-900">Control Tower</h2>
        <p className="text-xs text-gray-500">Bricksurance SE · Composite (P&amp;C + Life)</p>
      </div>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 -mt-1">
        <MonitorTabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={BarChart3} label="Overview" />
        <MonitorTabButton active={tab === 'ingestion'} onClick={() => setTab('ingestion')} icon={Workflow} label="Ingestion" />
        <MonitorTabButton active={tab === 'reconciliation'} onClick={() => setTab('reconciliation')} icon={GitCompare} label="Reconciliation" />
        <MonitorTabButton active={tab === 'process'} onClick={() => setTab('process')} icon={Scale} label="Process" />
        <MonitorTabButton active={tab === 'catalog'} onClick={() => setTab('catalog')} icon={Database} label="Data Catalog" />
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Q4 attention items — surfaces the 6 engineered Q4 2025 pains */}
          <Q4PainCallouts />

          <ReadinessPanel />
          <PipelinePanel />
        </div>
      )}

      {tab === 'ingestion' && <FeedStatusSection feeds={sla} />}
      {tab === 'reconciliation' && (
        <div className="space-y-5">
          <ReconSection checks={recon} />
          <CrossQrtReviewSection />
        </div>
      )}
      {tab === 'process' && <ProcessOverview />}
      {tab === 'catalog' && <DataInventory />}
    </div>
  );
}

function MonitorTabButton({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-600 text-blue-700 bg-blue-50/50'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function CrossQrtReviewSection() {
  const [result, setResult] = useState<CrossQrtReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showGuardrails, setShowGuardrails] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [loading]);

  async function handleReview() {
    setLoading(true);
    setError(null);
    setElapsed(0);
    try {
      const r = await generateCrossQrtReview();
      setResult(r);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-teal-50 to-cyan-50 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <Bot className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">AI Cross-QRT Consistency Review</h3>
              <p className="text-xs text-gray-500">Validates all 4 QRTs together with actuarial reasoning</p>
            </div>
          </div>
          {result && (
            <span className="text-xs text-gray-400 bg-white/60 px-2 py-1 rounded">
              {result.model_used} | {result.input_tokens + result.output_tokens} tokens
            </span>
          )}
        </div>
      </div>

      <div className="p-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
        )}

        {!result && !loading && (
          <div className="text-center py-6">
            <p className="text-sm text-gray-600 mb-3">
              The agent reads all 4 QRT summaries and validates cross-template consistency with actuarial reasoning.
            </p>
            <button onClick={handleReview} className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium">
              <Sparkles className="w-4 h-4" />
              Run Consistency Review
            </button>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="w-7 h-7 animate-spin text-teal-600 mx-auto" />
            <p className="text-sm text-gray-600 mt-3">Analysing cross-QRT consistency...</p>
            <p className="text-xs text-gray-400 mt-1">{elapsed}s elapsed</p>
          </div>
        )}

        {result && (
          <div>
            {result.guardrails && (
              <div className={`mb-3 rounded-lg border px-3 py-2 ${result.guardrails.passed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                <button onClick={() => setShowGuardrails(!showGuardrails)} className="flex items-center gap-2 w-full text-left">
                  <Shield className={`w-3.5 h-3.5 ${result.guardrails.passed ? 'text-green-600' : 'text-amber-600'}`} />
                  <span className="text-xs font-medium text-gray-700">Guardrails: {result.guardrails.checks_passed}/{result.guardrails.checks_run} passed</span>
                  {showGuardrails ? <ChevronUp className="w-3 h-3 ml-auto text-gray-400" /> : <ChevronDown className="w-3 h-3 ml-auto text-gray-400" />}
                </button>
                {showGuardrails && result.guardrails.warnings.length === 0 && result.guardrails.failures.length === 0 && (
                  <div className="mt-2 text-xs text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />All checks passed</div>
                )}
              </div>
            )}

            <div className="prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(result.review_text) }}
            />

            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">Period: {result.reporting_period}</span>
              <button onClick={handleReview} className="text-xs text-teal-600 hover:text-teal-700 font-medium">Re-run</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: 'green' | 'amber' | 'red';
  onClick?: () => void;
}) {
  const colors = {
    green: 'bg-green-50 border-green-200 text-green-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };
  const iconColors = {
    green: 'text-green-500',
    amber: 'text-amber-500',
    red: 'text-red-500',
  };

  return (
    <div
      className={`rounded-lg border p-4 ${colors[color]} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${iconColors[color]}`} />
        <span className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function FeedStatusSection({ feeds }: { feeds: Row[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Sort: missing → late → on-time-with-DQ-issue → on-time, then alphabetical.
  // Surfaces both attention items (late feed + DQ break) at the top so the eye
  // doesn't have to scan a wall of green feeds.
  const STATUS_RANK: Record<string, number> = { missing: 0, late: 1, on_time: 3 };
  const dqLow = (f: Row) => parseFloat(f.dq_pass_rate || '1') * 100 < 98;
  const sorted = [...feeds].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 9;
    const rb = STATUS_RANK[b.status] ?? 9;
    const aRank = ra === 3 && dqLow(a) ? 2 : ra;
    const bRank = rb === 3 && dqLow(b) ? 2 : rb;
    if (aRank !== bRank) return aRank - bRank;
    return (a.feed_name || '').localeCompare(b.feed_name || '');
  });
  const lateCount = feeds.filter((f) => f.status === 'late' || f.status === 'missing').length;
  const dqCount = feeds.filter((f) => f.status === 'on_time' && dqLow(f)).length;
  const okCount = feeds.length - lateCount - dqCount;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <h3 className="text-lg font-semibold text-gray-900">Data Ingestion — Source Assets</h3>
        <span className="text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wide">Unity Catalog</span>
        <span className="ml-auto text-xs text-gray-500">
          {lateCount > 0 && (
            <span className="text-amber-700 font-semibold mr-2">
              {lateCount} late
            </span>
          )}
          {dqCount > 0 && (
            <span className="text-rose-700 font-semibold mr-2">
              {dqCount} DQ issue{dqCount === 1 ? '' : 's'}
            </span>
          )}
          {okCount} clean
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Each row below is a tracked data asset (Unity Catalog table) with its source system, freshness vs SLA,
        row count, and DQ pass rate. Click any asset to drill into freshness history, completeness, expectations,
        and a sample of rows.
      </p>
      <div className="grid gap-2">
        {sorted.map((feed) => (
          <div key={feed.feed_name}>
            <FeedCard
              feed={feed}
              isExpanded={expanded === feed.feed_name}
              onClick={() => setExpanded(expanded === feed.feed_name ? null : feed.feed_name)}
            />
            {expanded === feed.feed_name && (
              <FeedDetailPanel feedName={feed.feed_name} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedCard({ feed, isExpanded, onClick }: { feed: Row; isExpanded: boolean; onClick: () => void }) {
  const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; badge: 'success' | 'warning' | 'error' }> = {
    on_time: { icon: CheckCircle2, color: 'text-green-500', badge: 'success' },
    late: { icon: AlertTriangle, color: 'text-amber-500', badge: 'warning' },
    missing: { icon: XCircle, color: 'text-red-500', badge: 'error' },
  };
  const cfg = statusConfig[feed.status] || statusConfig.missing;
  const Icon = cfg.icon;
  const dqPassPct = parseFloat(feed.dq_pass_rate || '1') * 100;
  const dqLow = dqPassPct < 98;

  return (
    <button
      onClick={onClick}
      className={`w-full bg-white rounded-lg border p-4 flex items-center justify-between text-left transition-all hover:shadow-md ${
        isExpanded ? 'border-blue-300 shadow-sm' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center gap-4">
        <Icon className={`w-5 h-5 ${dqLow && feed.status === 'on_time' ? 'text-rose-500' : cfg.color}`} />
        <div>
          <div className="font-semibold text-gray-900 capitalize flex items-center gap-2">
            {String(feed.feed_name).replace(/^1_raw_/, '').replace(/_/g, ' ')}
            {dqLow && (
              <span className="text-[10px] uppercase tracking-wide font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                DQ issue
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
            <code className="px-1.5 py-0.5 bg-gray-100 rounded font-mono text-[10px] text-blue-700">{feed.feed_name}</code>
            <span>·</span>
            <span>{feed.source_system}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6 text-sm">
        <div className="text-right">
          <div className="text-gray-500 text-xs">Rows</div>
          <div className="font-mono text-gray-800">{parseInt(feed.row_count || '0').toLocaleString()}</div>
        </div>
        <div className="text-right">
          <div className="text-gray-500 text-xs">DQ Pass</div>
          <div className={`font-mono ${dqLow ? 'text-rose-700 font-bold' : 'text-gray-800'}`}>{dqPassPct.toFixed(1)}%</div>
        </div>
        <div className="text-right min-w-[100px]">
          <div className="text-gray-500 text-xs">SLA</div>
          <StatusBadge
            label={feed.status === 'on_time' ? 'On Time' : feed.status === 'late' ? 'Late' : 'Missing'}
            variant={cfg.badge}
          />
        </div>
        <div className="flex items-center gap-1">
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>
    </button>
  );
}

function FeedDetailPanel({ feedName }: { feedName: string }) {
  const [detail, setDetail] = useState<FeedDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'freshness' | 'completeness' | 'dq' | 'data' | 'ownership'>('freshness');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchFeedDetail(feedName)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [feedName]);

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-b-lg border border-t-0 border-gray-200 p-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-b-lg border border-t-0 border-red-200 p-4 text-sm text-red-700">
        Failed to load feed detail: {error}
      </div>
    );
  }

  if (!detail) return null;

  const tabs = [
    { id: 'freshness' as const,    label: 'Freshness',     count: detail.freshness.length },
    { id: 'completeness' as const, label: 'Completeness',  count: detail.completeness.length },
    { id: 'dq' as const,           label: 'DQ Rules',      count: detail.dq_rules.length },
    { id: 'data' as const,         label: 'Data Preview',  count: detail.sample.length },
    { id: 'ownership' as const,    label: 'Ownership',     count: detail.ownership ? 1 : 0 },
  ];

  return (
    <div className="bg-white rounded-b-lg border border-t-0 border-gray-200 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-gray-50 px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count > 0 && <span className="ml-1 text-gray-400">({tab.count})</span>}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* Freshness tab */}
        {activeTab === 'freshness' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">SLA compliance history across reporting periods</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 font-medium">Period</th>
                  <th className="pb-2 font-medium">SLA Deadline</th>
                  <th className="pb-2 font-medium">Actual Arrival</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Rows</th>
                  <th className="pb-2 font-medium text-right">DQ Pass</th>
                </tr>
              </thead>
              <tbody>
                {detail.freshness.map((row) => {
                  const deadline = new Date(row.sla_deadline);
                  const arrival = new Date(row.actual_arrival);
                  const daysEarly = Math.round((deadline.getTime() - arrival.getTime()) / 86400000);
                  return (
                    <tr key={row.reporting_period} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-900">{row.reporting_period}</td>
                      <td className="py-2 text-gray-600">{deadline.toLocaleDateString()}</td>
                      <td className="py-2 text-gray-600">
                        {arrival.toLocaleDateString()}
                        <span className={`ml-2 text-xs ${daysEarly >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {daysEarly >= 0 ? `${daysEarly}d early` : `${Math.abs(daysEarly)}d late`}
                        </span>
                      </td>
                      <td className="py-2">
                        <StatusBadge
                          label={row.status === 'on_time' ? 'On Time' : row.status === 'late' ? 'Late' : 'Missing'}
                          variant={row.status === 'on_time' ? 'success' : row.status === 'late' ? 'warning' : 'error'}
                        />
                      </td>
                      <td className="py-2 text-right font-mono text-gray-800">{parseInt(row.row_count || '0').toLocaleString()}</td>
                      <td className="py-2 text-right font-mono text-gray-800">{(parseFloat(row.dq_pass_rate || '1') * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Completeness tab */}
        {activeTab === 'completeness' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">Row count comparison across periods — flags unexpected changes</p>
            <div className="grid gap-3">
              {detail.completeness.map((row) => {
                const current = parseInt(row.row_count || '0');
                const change = row.change_pct ? parseFloat(row.change_pct) : null;
                return (
                  <div key={row.reporting_period} className="flex items-center gap-4 p-3 rounded-lg border border-gray-100">
                    <div className="font-medium text-gray-900 w-20">{row.reporting_period}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2 bg-blue-100 rounded-full flex-1 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${Math.min(100, (current / Math.max(...detail.completeness.map(c => parseInt(c.row_count || '0')))) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-mono text-gray-800 w-20 text-right">{current.toLocaleString()}</span>
                      </div>
                    </div>
                    {change !== null && (
                      <div className={`text-xs font-medium px-2 py-0.5 rounded ${
                        Math.abs(change) < 5 ? 'bg-green-50 text-green-700' :
                        Math.abs(change) < 15 ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {change >= 0 ? '+' : ''}{change}% vs prior
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DQ Rules tab */}
        {activeTab === 'dq' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">
              Data quality expectations applied via DLT pipeline: <span className="font-medium">{detail.pipeline || 'N/A'}</span>
            </p>
            {detail.dq_rules.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No DQ rules found for this feed's pipeline</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 font-medium">Expectation</th>
                    <th className="pb-2 font-medium">Table</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                    <th className="pb-2 font-medium text-right">Passing</th>
                    <th className="pb-2 font-medium text-right">Failing</th>
                    <th className="pb-2 font-medium text-right">Pass Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.dq_rules.map((rule, i) => {
                    const failing = parseInt(rule.failing_records || '0');
                    return (
                      <tr key={i} className={`border-b border-gray-50 ${failing > 0 ? 'bg-amber-50/50' : ''}`}>
                        <td className="py-2">
                          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{rule.expectation_name}</span>
                        </td>
                        <td className="py-2 text-gray-600 text-xs">{rule.table_name}</td>
                        <td className="py-2 text-right font-mono text-gray-800">{parseInt(rule.total_records || '0').toLocaleString()}</td>
                        <td className="py-2 text-right font-mono text-green-700">{parseInt(rule.passing_records || '0').toLocaleString()}</td>
                        <td className={`py-2 text-right font-mono ${failing > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                          {failing.toLocaleString()}
                        </td>
                        <td className="py-2 text-right">
                          <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                            parseFloat(rule.pass_rate_pct || '100') >= 99.5 ? 'bg-green-100 text-green-700' :
                            parseFloat(rule.pass_rate_pct || '100') >= 95 ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {rule.pass_rate_pct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Ownership tab */}
        {activeTab === 'ownership' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Who to contact if this feed is late or wrong. Vendor-supplied feeds list both the
              external contact and the internal owner; internal feeds list the team responsible.
            </p>
            {!detail.ownership ? (
              <p className="text-sm text-gray-400 py-4 text-center">No ownership recorded for this feed.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Source / vendor</div>
                  <div className="text-sm font-semibold text-gray-900">{detail.ownership.source_party}</div>
                  <div className="text-sm text-gray-800 mt-2">{detail.ownership.owner_contact_name}</div>
                  <div className="text-xs text-gray-600">{detail.ownership.owner_contact_role}</div>
                  <div className="text-xs text-gray-600 font-mono mt-1">{detail.ownership.owner_contact_email}</div>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 bg-amber-50/40">
                  <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold mb-1">Internal owner — chase this person</div>
                  <div className="text-sm font-semibold text-gray-900">{detail.ownership.internal_owner}</div>
                  <div className="text-xs text-gray-600 font-mono mt-1">{detail.ownership.internal_owner_email}</div>
                </div>
                <div className="md:col-span-2 border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Escalation chain</div>
                  <div className="text-sm text-gray-800 leading-relaxed">{detail.ownership.escalation_chain}</div>
                </div>
                <div className="md:col-span-2 border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">SLA</div>
                  <div className="text-sm text-gray-800">{detail.ownership.sla_text}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Data Preview tab */}
        {activeTab === 'data' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500">
                First 20 rows from <span className="font-mono">{detail.table}</span>
                {detail.columns.length > 0 && ` (${detail.columns.length} columns)`}
              </p>
            </div>
            {detail.sample.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No data available</p>
            ) : (
              <div className="overflow-x-auto max-h-96 border border-gray-200 rounded-lg">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {Object.keys(detail.sample[0]).map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 border-b whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sample.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="px-3 py-1.5 border-b border-gray-100 whitespace-nowrap text-gray-700 font-mono">
                            {val === null ? <span className="text-gray-300">null</span> : String(val).substring(0, 50)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReconSection({ checks }: { checks: Row[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-3">Cross-QRT Reconciliation</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {checks.map((check) => (
          <div key={check.check_name}>
            <button
              onClick={() => setExpanded(expanded === check.check_name ? null : check.check_name)}
              className={`w-full text-left rounded-lg border p-4 transition-all hover:shadow-md ${
                check.status === 'MATCH'
                  ? expanded === check.check_name ? 'bg-white border-blue-300' : 'bg-white border-gray-200'
                  : expanded === check.check_name ? 'bg-red-50 border-red-400' : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">{check.source_qrt} vs {check.target_qrt}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge label={check.status} variant={check.status === 'MATCH' ? 'success' : 'error'} />
                  {expanded === check.check_name
                    ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                    : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-2">{check.check_description}</p>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span>Source: {formatEur(check.source_value)}</span>
                <span>Target: {formatEur(check.target_value)}</span>
                <span className={check.status === 'MATCH' ? 'text-green-600' : 'text-red-600'}>
                  Diff: {formatEur(check.difference)}
                </span>
              </div>
            </button>
            {expanded === check.check_name && (
              <ReconDetailPanel check={check} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReconDetailPanel({ check }: { check: Row }) {
  const [investigation, setInvestigation] = useState<ReconInvestigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const isMatch = check.status === 'MATCH';

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [loading]);

  async function handleInvestigate() {
    setLoading(true);
    setError(null);
    setElapsed(0);
    try {
      const r = await investigateRecon(check.check_name);
      setInvestigation(r);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const tolerance = parseFloat(check.tolerance || '0');
  const difference = parseFloat(check.difference || '0');
  const utilizationPct = tolerance > 0 ? Math.min(100, Math.abs(difference) / tolerance * 100) : 0;

  return (
    <div className={`rounded-b-lg border border-t-0 p-4 ${isMatch ? 'border-gray-200 bg-gray-50' : 'border-red-200 bg-red-50/30'}`}>
      {/* Detail metrics */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded p-2.5 border border-gray-100">
          <div className="text-[10px] text-gray-500 uppercase">Source Value</div>
          <div className="text-sm font-mono font-semibold text-gray-900">{formatEur(check.source_value)}</div>
          <div className="text-[10px] text-gray-400">{check.source_qrt}</div>
        </div>
        <div className="bg-white rounded p-2.5 border border-gray-100">
          <div className="text-[10px] text-gray-500 uppercase">Target Value</div>
          <div className="text-sm font-mono font-semibold text-gray-900">{formatEur(check.target_value)}</div>
          <div className="text-[10px] text-gray-400">{check.target_qrt}</div>
        </div>
        <div className="bg-white rounded p-2.5 border border-gray-100">
          <div className="text-[10px] text-gray-500 uppercase">Difference</div>
          <div className={`text-sm font-mono font-semibold ${isMatch ? 'text-green-700' : 'text-red-700'}`}>{formatEur(check.difference)}</div>
        </div>
        <div className="bg-white rounded p-2.5 border border-gray-100">
          <div className="text-[10px] text-gray-500 uppercase">Tolerance Used</div>
          <div className="text-sm font-semibold text-gray-900">{utilizationPct.toFixed(0)}%</div>
          <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${utilizationPct < 50 ? 'bg-green-400' : utilizationPct < 80 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${utilizationPct}%` }} />
          </div>
        </div>
      </div>

      {/* AI Investigation */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{error}</div>
      )}

      {!investigation && !loading && (
        <button
          onClick={handleInvestigate}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isMatch
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-red-600 text-white hover:bg-red-700'
          }`}
        >
          <Bot className="w-4 h-4" />
          {isMatch ? 'Explain this match' : 'Investigate this mismatch with AI'}
        </button>
      )}

      {loading && (
        <div className="text-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600 mx-auto" />
          <p className="text-xs text-gray-500 mt-2">Investigating... ({elapsed}s)</p>
        </div>
      )}

      {investigation && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-violet-600" />
            <span className="text-xs font-semibold text-gray-700">AI Investigation</span>
            <span className="text-[10px] text-gray-400">{investigation.model_used} | {investigation.input_tokens + investigation.output_tokens} tokens</span>
          </div>
          <div className="prose-sm max-w-none bg-white rounded-lg border border-gray-200 p-3"
            dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(investigation.review_text) }}
          />
          <button onClick={handleInvestigate} className="mt-2 text-xs text-violet-600 hover:text-violet-700 font-medium">
            Re-investigate
          </button>
        </div>
      )}
    </div>
  );
}


// Components no longer used directly on Monitor — kept for now to avoid cascading edits.
// Will be deleted in a polish pass.
void KpiCard;


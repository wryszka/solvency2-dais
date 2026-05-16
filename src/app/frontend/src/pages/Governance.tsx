import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Scale, BarChart3, Database, ShieldCheck, FileSearch,
  GitCompare, FlaskConical, Bot, Workflow, History, ScrollText,
  CheckCircle2, XCircle, Clock, TrendingUp, AlertTriangle, UserCheck,
  Cpu, Wrench, ExternalLink, Sparkles, ArrowRight, Layers,
} from 'lucide-react';
import {
  fetchProcessMetrics, fetchOverlays, fetchSubmissions,
  type ProcessMetrics, type Overlay,
} from '../lib/api';
import { Skeleton } from '../components/Skeleton';

type TabId =
  | 'overview' | 'audit-trails' | 'approvals' | 'ai-governance'
  | 'controls' | 'model-history';

interface LandingKpis {
  pending_total: number;
  most_urgent: { label: string; owner?: string; type?: string } | null;
  controls_active: number;
  controls_last_verified: string | null;
  ai_24h_total: number;
  ai_24h_cached_pct: number;
  ai_top_specialist: string | null;
  audit_coverage_pct: number;
}

interface LandingEvent {
  kind: string;
  label: string;
  actor: string | null;
  status: string | null;
  ts: string;
}

interface LandingResponse {
  period: string;
  kpis: LandingKpis;
  recent_events: LandingEvent[];
  pending_overlays: Array<Record<string, unknown>>;
  pending_promotions: Array<Record<string, unknown>>;
}

export default function Governance() {
  const [tab, setTab] = useState<TabId>('overview');
  const [landing, setLanding] = useState<LandingResponse | null>(null);

  useEffect(() => {
    fetch('/api/governance/landing')
      .then((r) => r.json())
      .then((d) => setLanding(d))
      .catch(() => setLanding(null));
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <header>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
            <Scale className="w-5 h-5 text-violet-700" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-violet-700 font-bold">Governance</div>
            <h2 className="text-2xl font-bold text-gray-900">All approvals, audit, AI activity, controls — one place</h2>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-3xl">
          Operational home for the audit trail. Pillar 2 deliverables live here alongside model-change
          history, agent activity, and the internal-controls register. Cross-pillar by design.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        <TabButton active={tab === 'overview'}      onClick={() => setTab('overview')}      icon={BarChart3}    label="Overview" />
        <TabButton active={tab === 'audit-trails'}  onClick={() => setTab('audit-trails')}  icon={FileSearch}   label="Audit Trails" />
        <TabButton active={tab === 'approvals'}     onClick={() => setTab('approvals')}     icon={Workflow}     label="Approvals & Workflow" />
        <TabButton active={tab === 'ai-governance'} onClick={() => setTab('ai-governance')} icon={Bot}          label="AI Governance" />
        <TabButton active={tab === 'controls'}      onClick={() => setTab('controls')}      icon={ShieldCheck}  label="Controls & Validation" />
        <TabButton active={tab === 'model-history'} onClick={() => setTab('model-history')} icon={History}      label="Model Change History" />
      </div>

      {tab === 'overview'      && <OverviewTab landing={landing} />}
      {tab === 'audit-trails'  && <AuditTrailsTab />}
      {tab === 'approvals'     && <ApprovalsTab landing={landing} />}
      {tab === 'ai-governance' && <AiGovernanceTab />}
      {tab === 'controls'      && <ControlsValidationTab />}
      {tab === 'model-history' && <ModelChangeHistoryTab />}
    </div>
  );
}

/* ═══════════════════════ Overview tab ═══════════════════════ */

function OverviewTab({ landing }: { landing: LandingResponse | null }) {
  if (!landing) return <Skeleton className="h-32 w-full" />;
  const k = landing.kpis;
  return (
    <section className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <OverviewKpi
          icon={UserCheck} label="Pending governance actions"
          value={String(k.pending_total)}
          hint={k.most_urgent ? `Most urgent: ${k.most_urgent.label}` : 'Nothing waiting on a human signature.'}
          tone={k.pending_total > 0 ? 'amber' : 'good'}
          link={{ to: '#approvals', label: 'Open queue', onClick: () => undefined }}
        />
        <OverviewKpi
          icon={ShieldCheck} label="Active controls"
          value={String(k.controls_active)}
          hint={k.controls_last_verified ? `Last verified ${relTime(k.controls_last_verified)}` : 'No verification recorded'}
          tone="good"
        />
        <OverviewKpi
          icon={Bot} label="AI activity (24h)"
          value={String(k.ai_24h_total)}
          hint={`${k.ai_24h_cached_pct.toFixed(0)}% cached${k.ai_top_specialist ? ` · top: ${k.ai_top_specialist}` : ''}`}
          tone={k.ai_24h_total > 0 ? 'good' : 'neutral'}
        />
        <OverviewKpi
          icon={FileSearch} label="Audit coverage"
          value={`${k.audit_coverage_pct.toFixed(0)}%`}
          hint={`Submissions archived for ${landing.period}`}
          tone={k.audit_coverage_pct >= 80 ? 'good' : k.audit_coverage_pct >= 50 ? 'amber' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border border-gray-200 rounded-lg p-4">
          <header className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-violet-700" />
            <h3 className="text-sm font-bold text-gray-900">Recent governance events</h3>
            <span className="text-[11px] text-gray-500">last 20</span>
          </header>
          {landing.recent_events.length === 0 ? (
            <p className="text-xs text-gray-500">No events recorded.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {landing.recent_events.map((e, i) => (
                <li key={i} className="py-2 flex items-center gap-2.5">
                  <EventDot kind={e.kind} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">{e.label}</div>
                    <div className="text-[11px] text-gray-500">
                      {e.kind.replace('_', ' ')} · {e.actor ?? '—'}
                      {e.status && ` · ${e.status}`}
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-400 font-mono whitespace-nowrap">{relTime(e.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <header className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-violet-700" />
            <h3 className="text-sm font-bold text-gray-900">Open items</h3>
          </header>
          <ul className="space-y-1.5 text-sm">
            <BreakdownRow label="Overlay approvals"     value={landing.pending_overlays.length} />
            <BreakdownRow label="Model promotions"      value={landing.pending_promotions.length} />
          </ul>
          <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5">
            <h4 className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Jump to</h4>
            <Link to="/agents" className="text-xs text-violet-700 hover:underline inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Agent architecture
            </Link>
            <br />
            <Link to="/internal-controls" className="text-xs text-violet-700 hover:underline inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Internal controls
            </Link>
            <br />
            <Link to="/model-governance" className="text-xs text-violet-700 hover:underline inline-flex items-center gap-1">
              <FlaskConical className="w-3 h-3" /> Model governance
            </Link>
          </div>
        </div>
      </div>

      <details className="bg-white rounded-lg border border-gray-200 p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-gray-800">Process Overview (cycle KPIs)</summary>
        <div className="mt-3">
          <ProcessOverview />
        </div>
      </details>
    </section>
  );
}

function OverviewKpi({ icon: Icon, label, value, hint, tone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint: string;
  tone: 'good' | 'amber' | 'red' | 'neutral';
  link?: { to: string; label: string; onClick?: () => void };
}) {
  const toneCls = {
    good: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    amber: 'text-amber-800 bg-amber-50 border-amber-200',
    red: 'text-rose-800 bg-rose-50 border-rose-200',
    neutral: 'text-gray-700 bg-white border-gray-200',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold opacity-80">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      <div className="text-[11px] opacity-90 mt-0.5">{hint}</div>
    </div>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-gray-700">{label}</span>
      <span className="font-mono font-semibold text-gray-900 tabular-nums">{value}</span>
    </li>
  );
}

function EventDot({ kind }: { kind: string }) {
  const color = kind === 'model_promotion' ? 'bg-blue-500' :
                kind === 'overlay'         ? 'bg-violet-500' :
                kind === 'agent_failure'   ? 'bg-rose-500' :
                                             'bg-gray-400';
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

function relTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    const t = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z')).getTime();
    const ageSec = Math.max(0, (Date.now() - t) / 1000);
    if (ageSec < 90) return 'just now';
    if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
    if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
    return `${Math.round(ageSec / 86400)}d ago`;
  } catch { return String(iso).slice(0, 10); }
}

/* ═══════════════════════ Audit Trails tab ═══════════════════════ */

interface ArchiveRow {
  qrt_id: string; qrt_name?: string; qrt_title?: string;
  reporting_period?: string; period?: string;
  status: string; submitted_at?: string | null; reviewed_at?: string | null;
  submitted_by?: string | null; reviewed_by?: string | null;
}

function AuditTrailsTab() {
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [period, setPeriod] = useState<string>('all');
  const [search, setSearch] = useState('');
  useEffect(() => {
    fetchSubmissions()
      .then((r) => setRows(((r as unknown as { data: ArchiveRow[] }).data) ?? []))
      .catch(() => setRows([]));
  }, []);
  const periods = Array.from(new Set(rows.map((r) => r.period ?? r.reporting_period).filter(Boolean))) as string[];
  const filtered = rows.filter((r) => {
    const p = r.period ?? r.reporting_period ?? '';
    if (period !== 'all' && p !== period) return false;
    if (search && !`${r.qrt_id} ${r.qrt_name ?? ''} ${r.qrt_title ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Filter</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1">
          <option value="all">All periods</option>
          {periods.sort().map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="text" placeholder="Search QRT name or id…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] text-sm border border-gray-300 rounded px-2.5 py-1" />
        <span className="text-xs text-gray-500">{filtered.length} of {rows.length}</span>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">QRT</th>
              <th className="px-3 py-2 text-left">Period</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Submitted</th>
              <th className="px-3 py-2 text-left">Reviewed</th>
              <th className="px-3 py-2 text-left">Audit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No matches.</td></tr>
            )}
            {filtered.map((r, i) => {
              const qrt = r.qrt_id?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-gray-900">{r.qrt_id} <span className="text-gray-500">{r.qrt_title ?? r.qrt_name ?? ''}</span></td>
                  <td className="px-3 py-2 font-mono">{r.period ?? r.reporting_period ?? '—'}</td>
                  <td className="px-3 py-2"><span className="text-[10px] uppercase font-semibold text-gray-700">{r.status}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-700">{r.submitted_by ?? '—'} <span className="text-gray-400 font-mono">{relTime(r.submitted_at ?? null)}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-700">{r.reviewed_by ?? '—'} <span className="text-gray-400 font-mono">{relTime(r.reviewed_at ?? null)}</span></td>
                  <td className="px-3 py-2">
                    <Link to={`/report/${qrt}`} className="text-xs text-violet-700 hover:underline inline-flex items-center gap-1">
                      Open audit panel <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ═══════════════════════ Approvals & Workflow tab ═══════════════════════ */

function ApprovalsTab({ landing }: { landing: LandingResponse | null }) {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  useEffect(() => {
    fetchOverlays({ quarter: '2025-Q4' }).then((r) => setOverlays(r.overlays || [])).catch(() => undefined);
  }, []);
  const pending = overlays.filter((o) => o.status === 'pending_approval');
  const approvedHistory = overlays.filter((o) => o.status === 'approved').slice(0, 20);
  return (
    <section className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <header className="flex items-center gap-2 mb-3">
          <Workflow className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-gray-900">Pending approvals</h3>
          <span className="ml-auto text-xs text-gray-500">{pending.length + (landing?.pending_promotions.length ?? 0)} items</span>
        </header>
        {pending.length === 0 && (landing?.pending_promotions.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-500 italic">Nothing waiting on a human signature.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pending.map((o, i) => (
              <li key={`o${i}`} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900">{o.line_of_business} overlay · EUR {(Math.abs(Number(o.magnitude_eur || 0)) / 1e6).toFixed(1)}M</div>
                  <div className="text-[11px] text-gray-500">submitted by {o.author ?? '—'}</div>
                </div>
                <Link to="/overlays" className="text-xs text-violet-700 hover:underline">Review →</Link>
              </li>
            ))}
            {(landing?.pending_promotions ?? []).map((p, i) => (
              <li key={`p${i}`} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900">{(p as { model_name?: string }).model_name} → {(p as { to_version?: string }).to_version}</div>
                  <div className="text-[11px] text-gray-500">awaiting {(p as { approver?: string }).approver ?? '—'}</div>
                </div>
                <Link to="/model-governance" className="text-xs text-violet-700 hover:underline">Review →</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <header className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-emerald-700" />
          <h3 className="text-sm font-bold text-gray-900">Approval history (recent)</h3>
        </header>
        {approvedHistory.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No approved items in the last window.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {approvedHistory.map((o, i) => (
              <li key={i} className="py-2 flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 truncate">{o.line_of_business} · EUR {(Math.abs(Number(o.magnitude_eur || 0)) / 1e6).toFixed(1)}M</div>
                  <div className="text-[11px] text-gray-500">
                    {o.author ?? '—'} → {o.approver ?? '—'}
                  </div>
                </div>
                <span className="text-[11px] text-gray-400 font-mono">{relTime(o.approved_at ?? o.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ═══════════════════════ AI Governance tab ═══════════════════════ */

interface RoutingRow {
  trace_id: string; question: string;
  specialist_key: string; specialist_name: string;
  data_sources: string[]; model_used: string;
  was_cached: boolean; baked: boolean; period: string;
  created_at: string; created_by: string;
}

interface SpecialistsResponse {
  specialists: Array<{
    key: string; name: string; scope: string; color: string;
    data_sources: string[];
    uc_artefact?: { uc_path: string | null; workspace_url: string | null; kind: string };
    tools?: Array<{ name: string; kind: string; workspace_url: string | null }>;
  }>;
  supervisor: {
    uc_path: string; workspace_url: string;
    serving_endpoint: string | null; serving_endpoint_url: string | null;
  };
}

function AiGovernanceTab() {
  const [recent, setRecent] = useState<RoutingRow[]>([]);
  const [catalogue, setCatalogue] = useState<SpecialistsResponse | null>(null);
  useEffect(() => {
    fetch('/api/supervisor/recent?limit=20').then((r) => r.json()).then((d) => setRecent(d.recent || [])).catch(() => setRecent([]));
    fetch('/api/supervisor/specialists').then((r) => r.json()).then((d) => setCatalogue(d)).catch(() => setCatalogue(null));
  }, []);
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3 bg-violet-50/60 border border-violet-200 rounded-lg p-3 text-xs">
        <Bot className="w-4 h-4 text-violet-700 shrink-0" />
        <span>Phase 8 — supervisor + 6 specialists deployed as Mosaic AI artefacts. Every call traced to MLflow.</span>
        <Link to="/agents" className="ml-auto font-semibold text-violet-700 hover:underline inline-flex items-center gap-1">
          View agent architecture <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <header className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-violet-700" />
          <h3 className="text-sm font-bold text-gray-900">Agent activity log</h3>
          <span className="text-[11px] text-gray-500">last 20 routing decisions</span>
        </header>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No routing decisions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {recent.map((r) => (
              <li key={r.trace_id} className="py-2 flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-violet-500 mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 truncate">{r.question}</div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-violet-800">{r.specialist_name}</span>
                    {r.was_cached && <span className="text-emerald-700">cached{r.baked ? ' · baked' : ''}</span>}
                    <span className="font-mono text-gray-400">{(r.data_sources ?? []).slice(0, 3).join(' · ')}</span>
                    <span className="text-gray-400">·</span>
                    <span className="font-mono text-gray-400 truncate" title={r.trace_id}>trace {r.trace_id.slice(0, 8)}</span>
                  </div>
                </div>
                <span className="text-[11px] text-gray-400 font-mono whitespace-nowrap">{relTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <header className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-violet-700" />
            <h3 className="text-sm font-bold text-gray-900">Agent inventory</h3>
          </header>
          {!catalogue ? <Skeleton className="h-20 w-full" /> : (
            <ul className="space-y-2 text-sm">
              {catalogue.supervisor && (
                <li className="border border-violet-200 bg-violet-50/50 rounded p-2">
                  <a href={catalogue.supervisor.workspace_url} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-violet-800 hover:underline inline-flex items-center gap-1">
                    {catalogue.supervisor.uc_path} <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    Supervisor · {catalogue.supervisor.serving_endpoint
                      ? <a href={catalogue.supervisor.serving_endpoint_url ?? '#'} target="_blank" rel="noopener noreferrer"
                          className="text-violet-700 hover:underline">endpoint: {catalogue.supervisor.serving_endpoint}</a>
                      : <span className="text-amber-700">no serving endpoint configured</span>}
                  </div>
                </li>
              )}
              {catalogue.specialists.map((s) => (
                <li key={s.key} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-gray-900 font-semibold">{s.name}</span>
                    <span className="text-gray-400 font-mono ml-auto">{s.key}</span>
                  </div>
                  {s.uc_artefact?.workspace_url && (
                    <a href={s.uc_artefact.workspace_url} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-[10px] text-violet-700 hover:underline inline-flex items-center gap-1 ml-3">
                      {s.uc_artefact.uc_path} <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <header className="flex items-center gap-2 mb-3">
            <Wrench className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-bold text-gray-900">Tool inventory</h3>
          </header>
          {!catalogue ? <Skeleton className="h-20 w-full" /> : (() => {
            const seen = new Set<string>();
            const tools: Array<{ name: string; workspace_url: string | null; usedBy: string[] }> = [];
            for (const s of catalogue.specialists) {
              for (const t of (s.tools ?? [])) {
                if (!seen.has(t.name)) {
                  seen.add(t.name);
                  tools.push({ name: t.name, workspace_url: t.workspace_url, usedBy: [s.name] });
                } else {
                  tools.find((tt) => tt.name === t.name)!.usedBy.push(s.name);
                }
              }
            }
            return (
              <ul className="space-y-1 text-xs">
                {tools.map((t) => (
                  <li key={t.name} className="flex items-start gap-2">
                    <Wrench className="w-3 h-3 text-blue-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      {t.workspace_url ? (
                        <a href={t.workspace_url} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-blue-700 hover:underline inline-flex items-center gap-1">
                          {t.name} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ) : <span className="font-mono text-gray-700">{t.name}</span>}
                      <div className="text-[10px] text-gray-500 truncate">used by {t.usedBy.join(', ')}</div>
                    </div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════ Controls & Validation tab ═══════════════════════ */

interface ControlRow {
  id?: string;
  control_id?: string;
  control?: string;
  name?: string;
  layer?: string;
  status?: string;
  last_verified_at?: string | null;
  description?: string;
  implementation?: string;
}

function ControlsValidationTab() {
  const [controls, setControls] = useState<ControlRow[]>([]);
  useEffect(() => {
    fetch('/api/internal-controls/matrix').then((r) => r.json())
      .then((d) => {
        // API shape: { layers: [{ layer, controls: [...] }, ...], ... }
        // Flatten nested layers into a single controls array, attaching the
        // layer name to each row for display.
        const flat: ControlRow[] = [];
        const layers = Array.isArray(d?.layers) ? d.layers : [];
        for (const lyr of layers) {
          const items = Array.isArray(lyr?.controls) ? lyr.controls : [];
          for (const c of items) flat.push({ ...c, layer: c.layer ?? lyr.layer });
        }
        setControls(flat);
      })
      .catch(() => setControls([]));
  }, []);
  return (
    <section className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <header className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-700" />
          <h3 className="text-sm font-bold text-gray-900">Internal controls</h3>
          <span className="ml-auto text-xs text-gray-500">{controls.length} controls</span>
        </header>
        {controls.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No controls returned by /api/internal-controls/matrix.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {controls.map((c, i) => {
              const label = c.control ?? c.name ?? c.control_id ?? c.id ?? `(control ${i + 1})`;
              const status = c.status ?? 'active';
              return (
                <li key={c.id ?? c.control_id ?? i} className="py-2.5 flex items-start gap-3 text-sm">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-900 font-medium">{label}</div>
                    {c.description && (
                      <div className="text-[11px] text-gray-600 leading-snug mt-0.5">{c.description}</div>
                    )}
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {c.layer ?? '—'}
                      {c.last_verified_at && <> · last verified {relTime(c.last_verified_at)}</>}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0">{status}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <Link to="/internal-controls" className="text-xs text-violet-700 hover:underline inline-flex items-center gap-1">
            Open the full Internal Controls page <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      <ModelValidationPanel />
    </section>
  );
}

interface ModelValidationRow {
  model_id: string; label: string; engine_tag?: string; engine?: string;
  last_promotion_to?: string | null;
  last_promotion_at?: string | null;
  last_promotion_quarter?: string | null;
  approver?: string | null;
  diagnostics_run: number;
  diagnostics_passed: number;
  last_diagnostic_period?: string | null;
  last_diagnostic_at?: string | null;
  next_independent_validation_due?: string | null;
  status: 'validated' | 'pending revalidation' | 'in service' | 'not validated';
}

function ModelValidationPanel() {
  const [rows, setRows] = useState<ModelValidationRow[]>([]);
  useEffect(() => {
    fetch('/api/governance/model-validation').then((r) => r.json())
      .then((d) => setRows(d.models || []))
      .catch(() => setRows([]));
  }, []);
  const badgeFor = (s: ModelValidationRow['status']): string => {
    if (s === 'validated') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (s === 'pending revalidation') return 'text-amber-700 bg-amber-50 border-amber-200';
    if (s === 'in service') return 'text-blue-700 bg-blue-50 border-blue-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <header className="flex items-center gap-2 mb-3">
        <FlaskConical className="w-4 h-4 text-amber-700" />
        <h3 className="text-sm font-bold text-gray-900">Model validation evidence</h3>
        <span className="ml-auto text-xs text-gray-500">{rows.length} models</span>
      </header>
      <p className="text-xs text-gray-500 mb-2">
        Per-model validation file: most-recent promotion + diagnostic results + sign-off chain +
        next independent validation due. The artefact set internal validators and regulators
        request when reviewing a model.
      </p>
      <details className="bg-gray-50 border border-gray-100 rounded mb-3 text-xs text-gray-700">
        <summary className="cursor-pointer px-3 py-2 font-semibold text-gray-800">
          What is model validation?
        </summary>
        <div className="px-3 pb-3 space-y-2 leading-relaxed">
          <p>
            <strong>Model validation</strong> is the periodic, independent review of a model to confirm
            it remains fit for purpose. Required under Solvency II Article 124 for internal models and
            Article 116 for technical-provision methodologies; EIOPA's Guidelines on system of governance
            cover the framework. Typical cadence is annual for major capital and reserving models, more
            frequent for high-risk lines.
          </p>
          <p>
            An <strong>independent</strong> reviewer (a different team, or an external firm) assesses
            six things: methodology soundness, numerical accuracy, sensitivity to assumptions,
            stability across runs and periods, appropriateness of use, and completeness of documentation.
            Outputs a validation report, a list of findings, and a sign-off chain. Findings either close
            on remediation or remain open against the next review.
          </p>
          <p className="text-gray-600">
            <strong>What this panel shows.</strong> Each row composes the file from real governance
            data on the platform —
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-gray-600">
            <li><strong>Diagnostics</strong> — continuous health checks run on every model output (residuals, calibration tests, stability). From <code className="font-mono bg-white border border-gray-200 px-1 rounded">6_gov_model_diagnostics</code>.</li>
            <li><strong>Last promotion</strong> — most recent version moved to production + the approver who signed off. From <code className="font-mono bg-white border border-gray-200 px-1 rounded">6_gov_promotions</code>.</li>
            <li><strong>Next independent validation due</strong> — derived from the last promotion date (annual cadence) + the regulatory minimum.</li>
            <li><strong>Status</strong> — <em>validated</em> when diagnostics all pass and a sign-off exists; <em>pending revalidation</em> when diagnostics fail; <em>in service</em> when no full validation has been recorded yet; <em>not validated</em> otherwise.</li>
          </ul>
          <p className="text-gray-600">
            Click any row in the Lab to see the model's full diagnostic history, MLflow run trail, and
            methodology change log.
          </p>
        </div>
      </details>
      <ul className="space-y-2 text-sm">
        {rows.map((m) => {
          const diagOk = m.diagnostics_run > 0 && m.diagnostics_passed === m.diagnostics_run;
          return (
            <li key={m.model_id} className="border border-gray-100 rounded p-3 flex items-start gap-3">
              <FlaskConical className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-900 font-medium">{m.label}</span>
                  <code className="text-[10px] font-mono text-gray-500">{m.model_id}</code>
                  {m.engine_tag === 'external' && m.engine && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">external · {m.engine}</span>
                  )}
                </div>
                <div className="text-[11px] text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>
                    <span className="text-gray-400">Diagnostics:</span>{' '}
                    <span className={diagOk ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                      {m.diagnostics_passed}/{m.diagnostics_run} passed
                    </span>
                    {m.last_diagnostic_period && <span className="text-gray-400"> · {m.last_diagnostic_period}</span>}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span>
                    <span className="text-gray-400">Last promotion:</span>{' '}
                    {m.last_promotion_to ?? '—'}
                    {m.last_promotion_at && <span className="text-gray-400"> · {String(m.last_promotion_at).slice(0, 10)}</span>}
                  </span>
                  {m.approver && (
                    <>
                      <span className="text-gray-400">·</span>
                      <span><span className="text-gray-400">Approver:</span> {m.approver}</span>
                    </>
                  )}
                </div>
                {m.next_independent_validation_due && (
                  <div className="text-[10px] text-gray-500 mt-1">
                    Next independent validation due{' '}
                    <span className="font-mono text-gray-700">{m.next_independent_validation_due}</span>
                  </div>
                )}
              </div>
              <span className={`text-[10px] uppercase tracking-wider font-bold border rounded px-1.5 py-0.5 shrink-0 ${badgeFor(m.status)}`}>
                {m.status}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ═══════════════════════ Model Change History tab ═══════════════════════ */

interface PromotionRow {
  promotion_id?: string;
  model_name: string;
  from_version?: string | null;
  to_version: string;
  status: string;
  approver?: string | null;
  approved_at?: string | null;
  promoted_at?: string | null;
  quarter?: string;
  business_reason?: string | null;
}

function ModelChangeHistoryTab() {
  const [rows, setRows] = useState<PromotionRow[]>([]);
  useEffect(() => {
    fetch('/api/governance/promotions?limit=100')
      .then((r) => r.json())
      .then((d) => setRows(d.promotions || []))
      .catch(() => setRows([]));
  }, []);
  return (
    <section className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Version</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Approver</th>
              <th className="px-3 py-2 text-left">Approved</th>
              <th className="px-3 py-2 text-left">Quarter</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 italic">No promotion history available.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-gray-900">{r.model_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.from_version ?? '—'} → {r.to_version}</td>
                <td className="px-3 py-2"><span className="text-[10px] uppercase font-semibold">{r.status}</span></td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.approver ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 font-mono">{relTime(r.approved_at ?? r.promoted_at ?? null)}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.quarter ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Driven from <code className="font-mono bg-gray-100 px-1 rounded">6_gov_promotions</code> + UC MLflow registry.
        Each row resolves which model version produced the QRT output for the given quarter.
      </p>
    </section>
  );
}

function TabButton({
  active, onClick, icon: Icon, label, hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
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

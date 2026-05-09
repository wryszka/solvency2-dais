/**
 * LabModelDetail — 5-tab governance view for any model (native or external).
 *
 * Tabs:
 *  - Versions     — full version history with author, timestamp, comments
 *  - Diagnostics  — variance vs prior, reasonableness checks, threshold pass/fail
 *  - Approvals    — promotion event log
 *  - Lineage      — which QRTs / downstream artefacts consume this model
 *  - Promote      — candidate diff vs production + promote action
 *
 * Same shell for native and external models. The Versions tab content differs
 * only in what it shows: MLflow versions for native, alias rows for external.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Beaker, ArrowLeft, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Code2, Cpu, Sparkles, Activity, Layers as LayersIcon, GitBranch, Send,
} from 'lucide-react';
import {
  fetchLabModel, fetchLabDiagnostics, fetchLabPromotions, promoteModel,
  fetchOverlays,
  type ModelDetail, type ModelDiagnostic, type PromotionRow, type Overlay,
} from '../lib/api';
import SeniorReservingPanel from '../components/SeniorReservingPanel';
import SfChallengerPanel from '../components/SfChallengerPanel';
import CatAgentPanel from '../components/CatAgentPanel';

type Tab = 'versions' | 'diagnostics' | 'approvals' | 'lineage' | 'promote';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'versions',    label: 'Versions',    icon: Code2 },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'approvals',   label: 'Approvals',   icon: CheckCircle2 },
  { id: 'lineage',     label: 'Lineage',     icon: GitBranch },
  { id: 'promote',     label: 'Promote',     icon: Send },
];

export default function LabModelDetail() {
  const { modelId } = useParams<{ modelId: string }>();
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [diagnostics, setDiagnostics] = useState<ModelDiagnostic[]>([]);
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('versions');

  useEffect(() => {
    if (!modelId) return;
    setLoading(true);
    Promise.all([
      fetchLabModel(modelId),
      fetchLabDiagnostics(modelId),
      fetchLabPromotions(modelId),
      fetchOverlays({ model_name: modelId }).catch(() => ({ overlays: [] })),
    ])
      .then(([d, diag, p, o]) => {
        setDetail(d);
        setDiagnostics(diag.diagnostics);
        setPromotions(p.promotions);
        setOverlays(o.overlays);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [modelId]);

  if (loading) return <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading model…</div>;
  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!detail) return null;

  const { state } = detail;
  const prodAlias = state.aliases?.find((a) => a.alias_name.toLowerCase() === 'production');
  const candAlias = state.aliases?.find((a) => a.alias_name.toLowerCase() === 'candidate');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <Link to="/lab" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Lab
      </Link>

      <div className="flex items-start gap-3">
        <Beaker className="w-6 h-6 text-violet-700 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900">{detail.label}</h2>
          <div className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-mono">{detail.model_id}</span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1">
              {detail.engine_tag === 'native' ? <Code2 className="w-3.5 h-3.5" /> : <Cpu className="w-3.5 h-3.5" />}
              {detail.engine}
            </span>
            {state.full_name && state.full_name !== detail.model_id && (
              <>
                <span className="text-gray-300">·</span>
                <code className="text-[11px] bg-gray-100 px-1 rounded">{state.full_name}</code>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="Production">
          <div className="font-mono text-lg">{prodAlias ? (prodAlias.version_num ?? prodAlias.version_label) : '—'}</div>
        </Card>
        <Card label="Candidate">
          <div className="font-mono text-lg">{candAlias ? (candAlias.version_num ?? candAlias.version_label) : '—'}</div>
        </Card>
        <Card label="Approved overlays">
          <div className="font-mono text-lg">{overlays.filter((o) => o.status === 'approved').length}</div>
        </Card>
      </div>

      {state.error && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> {state.error}
        </div>
      )}

      <div className="border-b border-gray-200 flex gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 ${
              tab === id ? 'border-violet-700 text-violet-800' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {(detail.model_id === 'reserving_pnc' || detail.model_id === 'reserving_life') && (
        <SeniorReservingPanel modelId={detail.model_id} />
      )}
      {detail.model_id === 'standard_formula' && <SfChallengerPanel />}
      {detail.model_id === 'igloo_cat' && <CatAgentPanel />}

      {tab === 'versions' && <VersionsTab detail={detail} />}
      {tab === 'diagnostics' && <DiagnosticsTab diagnostics={diagnostics} />}
      {tab === 'approvals' && <ApprovalsTab promotions={promotions} />}
      {tab === 'lineage' && <LineageTab modelId={detail.model_id} overlays={overlays} />}
      {tab === 'promote' && <PromoteTab detail={detail} candidateVersion={candAlias?.version_num ?? candAlias?.version_label} onPromoted={() => window.location.reload()} />}
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function VersionsTab({ detail }: { detail: ModelDetail }) {
  if (detail.engine_tag === 'native') {
    const versions = detail.state.versions ?? [];
    if (versions.length === 0) return <Empty msg="No versions registered yet." />;
    return (
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 w-16">Version</th>
              <th className="text-left px-3 py-2">Comment</th>
              <th className="text-left px-3 py-2">Created at</th>
              <th className="text-left px-3 py-2">Created by</th>
            </tr>
          </thead>
          <tbody>
            {versions.slice().sort((a, b) => Number(b.version) - Number(a.version)).map((v) => (
              <tr key={v.version} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">v{v.version}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{v.comment ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 font-mono">{v.created_at ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[200px]" title={v.created_by}>{v.created_by ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // External: render alias rows
  const rows = detail.state.rows ?? [];
  if (rows.length === 0) return <Empty msg="No alias rows for this engine." />;
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
          <tr>
            <th className="text-left px-3 py-2">Alias</th>
            <th className="text-left px-3 py-2">Version</th>
            <th className="text-left px-3 py-2">Reporting period</th>
            <th className="text-left px-3 py-2">Set at</th>
            <th className="text-left px-3 py-2">Set by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-3 py-2"><code className="text-xs bg-gray-100 px-1 rounded">{r.alias}</code></td>
              <td className="px-3 py-2 font-mono text-xs">{r.version_label}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.reporting_period}</td>
              <td className="px-3 py-2 text-xs text-gray-500 font-mono">{r.set_at}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{r.set_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticsTab({ diagnostics }: { diagnostics: ModelDiagnostic[] }) {
  if (diagnostics.length === 0) return <Empty msg="No diagnostics computed yet." />;
  // Group by reporting_period (latest first)
  const grouped = new Map<string, ModelDiagnostic[]>();
  for (const d of diagnostics) {
    if (!grouped.has(d.reporting_period)) grouped.set(d.reporting_period, []);
    grouped.get(d.reporting_period)!.push(d);
  }
  const periods = Array.from(grouped.keys()).sort().reverse();
  return (
    <div className="space-y-4">
      {periods.map((p) => (
        <div key={p} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <header className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <span className="font-mono text-xs">{p}</span>
            <span className="ml-auto text-[11px] text-gray-500">
              {grouped.get(p)!.filter((d) => String(d.passed) === 'true' || d.passed === true).length}/{grouped.get(p)!.length} passing
            </span>
          </header>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Diagnostic</th>
                <th className="text-right px-3 py-2">Value</th>
                <th className="text-left px-3 py-2">Range</th>
                <th className="text-left px-3 py-2 w-24">Result</th>
              </tr>
            </thead>
            <tbody>
              {grouped.get(p)!.map((d, i) => {
                const passed = String(d.passed) === 'true' || d.passed === true;
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{d.diagnostic_name}</div>
                      <div className="text-[11px] text-gray-500">{d.metric_text}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {Number(d.metric_value).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                      [{Number(d.threshold_low).toFixed(2)}, {Number(d.threshold_high).toFixed(2)}]
                    </td>
                    <td className="px-3 py-2">
                      {passed
                        ? <span className="inline-flex items-center gap-1 text-green-700 text-[11px]"><CheckCircle2 className="w-3.5 h-3.5" /> pass</span>
                        : <span className="inline-flex items-center gap-1 text-red-700 text-[11px]"><XCircle className="w-3.5 h-3.5" /> fail</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ApprovalsTab({ promotions }: { promotions: PromotionRow[] }) {
  if (promotions.length === 0) return <Empty msg="No promotions yet." />;
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
          <tr>
            <th className="text-left px-3 py-2">Quarter</th>
            <th className="text-left px-3 py-2">From → To</th>
            <th className="text-left px-3 py-2">Justification</th>
            <th className="text-left px-3 py-2">Approver</th>
            <th className="text-left px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {promotions.map((p) => (
            <tr key={p.promotion_id} className="border-t border-gray-100 align-top">
              <td className="px-3 py-2 font-mono text-xs">{p.quarter}</td>
              <td className="px-3 py-2 text-xs">
                <code className="text-[11px] bg-gray-100 px-1 rounded">{p.from_version ?? '∅'}</code>
                <span className="mx-1">→</span>
                <code className="text-[11px] bg-violet-50 text-violet-800 border border-violet-200 px-1 rounded">{p.to_version}</code>
                <div className="text-[10px] text-gray-500 mt-0.5">alias: {p.to_alias}</div>
              </td>
              <td className="px-3 py-2 text-xs text-gray-700 max-w-[400px]">{p.justification}</td>
              <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[160px]" title={p.approver ?? ''}>{p.approver ?? '—'}</td>
              <td className="px-3 py-2">
                {p.status === 'approved'
                  ? <span className="inline-flex items-center gap-1 text-green-700 text-[10px] uppercase font-semibold"><CheckCircle2 className="w-3 h-3" /> approved</span>
                  : <span className="inline-flex items-center gap-1 text-amber-700 text-[10px] uppercase font-semibold">{p.status}</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineageTab({ modelId, overlays }: { modelId: string; overlays: Overlay[] }) {
  // Curated lineage hard-coded by model — for demo reliability, not driven from UC API
  const downstreamMap: Record<string, { qrt: string; cells: string[] }[]> = {
    reserving_pnc: [
      { qrt: 'S.05.01', cells: ['R0210 gross_premiums_written', 'R0310 gross_claims_incurred'] },
      { qrt: 'S.25.01', cells: ['R0040 SCR_non_life'] },
      { qrt: 'S.26.06', cells: ['R0010 premium_reserve_risk'] },
    ],
    reserving_life: [
      { qrt: 'S.12.01', cells: ['R0010 best_estimate_life'] },
      { qrt: 'lifeuw', cells: ['R0010 lapse_risk', 'R0020 mortality_risk'] },
    ],
    standard_formula: [
      { qrt: 'S.25.01', cells: ['R0010 SCR_market', 'R0040 SCR_non_life', 'R0050 SCR_health', 'R0060 SCR_life', 'R0220 BSCR', 'R0410 SCR'] },
    ],
    igloo_cat: [
      { qrt: 'S.26.06', cells: ['R0040 catastrophe_risk'] },
      { qrt: 'S.25.01', cells: ['R0040 SCR_non_life (cat component)'] },
    ],
    prophet_life: [
      { qrt: 'S.12.01', cells: ['R0040 risk_margin'] },
      { qrt: 'lifeuw', cells: ['R0010 lapse_risk', 'R0030 cat_life'] },
    ],
  };
  const downstream = downstreamMap[modelId] ?? [];
  const linkedOverlays = overlays.filter((o) => o.status === 'approved');

  return (
    <div className="space-y-4">
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-blue-600" /> Downstream artefacts
        </h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">
          QRT cells whose values are produced — directly or downstream — by this model's output.
        </p>
        {downstream.length === 0 ? <Empty msg="No downstream lineage curated for this model." /> : (
          <div className="space-y-2">
            {downstream.map((d, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="font-mono text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{d.qrt}</span>
                <ul className="flex-1 space-y-0.5">
                  {d.cells.map((c, j) => (
                    <li key={j} className="text-xs text-gray-700 font-mono">· {c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <LayersIcon className="w-4 h-4 text-violet-700" /> Approved overlays affecting this model
        </h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">
          Overlays that adjust this model's output before it flows downstream.
        </p>
        {linkedOverlays.length === 0 ? (
          <p className="text-xs text-gray-500">No overlays linked to this model.</p>
        ) : (
          <ul className="space-y-1.5">
            {linkedOverlays.map((o) => (
              <li key={o.overlay_id} className="text-xs flex items-baseline gap-2">
                <span className="font-mono">{o.quarter}</span>
                <span className="text-gray-700">{o.line_of_business}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-600">{o.category.replace(/_/g, ' ')}</span>
                <span className={`ml-auto font-mono ${parseFloat(String(o.magnitude_eur)) >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {parseFloat(String(o.magnitude_eur)) >= 0 ? '+' : ''}{Number(o.magnitude_eur).toLocaleString()} EUR
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PromoteTab({ detail, candidateVersion, onPromoted }: {
  detail: ModelDetail;
  candidateVersion: number | string | undefined;
  onPromoted: () => void;
}) {
  const [quarter, setQuarter] = useState('2025-Q4');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    if (justification.trim().length < 20) { setErr('Justification must be at least 20 chars'); return; }
    if (!confirm(`Promote candidate v${candidateVersion} of ${detail.model_id} to production for ${quarter}?\n\nThis will flip the production alias and archive the previous production version.`)) return;
    setBusy(true);
    try {
      await promoteModel(detail.model_id, { quarter, justification: justification.trim(), target_alias: 'production' });
      onPromoted();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  if (!candidateVersion) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
        <Sparkles className="w-6 h-6 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-700">No candidate version to promote.</p>
        <p className="text-xs text-gray-500 mt-1">Register a new version and tag it as <code className="bg-gray-100 px-1 rounded text-[11px]">candidate</code> to enable this flow.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-600">Promote</span>
        <code className="text-[11px] bg-violet-50 text-violet-800 border border-violet-200 px-1.5 py-0.5 rounded">candidate v{candidateVersion}</code>
        <span className="text-gray-600">→</span>
        <code className="text-[11px] bg-green-50 text-green-800 border border-green-200 px-1.5 py-0.5 rounded">production</code>
      </div>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-gray-600 font-semibold">Quarter</span>
        <select value={quarter} onChange={(e) => setQuarter(e.target.value)}
          className="mt-1 w-32 border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
          {['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1'].map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-gray-600 font-semibold">Justification (min 20 chars)</span>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)}
          rows={4} placeholder="What changed, why now, what diagnostics back the call."
          className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm leading-relaxed" />
      </label>

      {err && <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{err}</div>}

      <div className="flex items-center gap-2">
        <button onClick={go} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 text-white rounded-md hover:bg-violet-800 disabled:opacity-50 text-xs font-medium">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Promote to production
        </button>
        <span className="text-[11px] text-gray-500 ml-2">
          Diagnostics for this quarter must all pass; failure aborts the promotion.
        </span>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-xs text-gray-500">
      {msg}
    </div>
  );
}

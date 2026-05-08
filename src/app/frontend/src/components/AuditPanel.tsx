/**
 * AuditPanel — every QRT carries its full audit by default.
 *
 * Five sub-tabs: Data / Code / Models / Approvals & Overlays / Lineage.
 * Auto-populated from UC table history, governance tables, and the curated
 * lineage map. Reusable across S.05.01, S.06.02, S.12.01, S.25.01, S.26.06.
 *
 * Time-aware: pass `period` to filter all panes to a historical quarter.
 */
import { useEffect, useState } from 'react';
import {
  Database, Code2, Cpu, Layers, GitBranch,
  Loader2, AlertTriangle, CheckCircle2, ChevronRight, Clock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchAuditPanel, type AuditPanelData } from '../lib/api';

type Tab = 'data' | 'code' | 'models' | 'approvals' | 'lineage';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'data',      label: 'Data',                icon: Database },
  { id: 'code',      label: 'Code',                icon: Code2 },
  { id: 'models',    label: 'Models',              icon: Cpu },
  { id: 'approvals', label: 'Approvals & Overlays', icon: Layers },
  { id: 'lineage',   label: 'Lineage',             icon: GitBranch },
];

export default function AuditPanel({ qrtId, period }: { qrtId: string; period?: string }) {
  const [data, setData] = useState<AuditPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('data');

  useEffect(() => {
    setLoading(true);
    fetchAuditPanel(qrtId, period)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [qrtId, period]);

  if (loading) return <div className="text-sm text-gray-500 flex items-center gap-2 p-4"><Loader2 className="w-4 h-4 animate-spin" /> loading audit panel…</div>;
  if (error) return <div className="text-sm text-red-700 p-4 flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" /> {error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 flex items-start gap-3 text-sm">
        <CheckCircle2 className="w-4 h-4 text-violet-700 mt-0.5 shrink-0" />
        <div className="text-violet-900">
          <strong>Audit travels with the artefact.</strong> Every QRT version carries its full lineage —
          the data versions, the code, the model versions, the overlays, the approvals — all queried
          live from Unity Catalog and the governance tables.
        </div>
      </div>

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

      {tab === 'data'      && <DataTab d={data} />}
      {tab === 'code'      && <CodeTab d={data} />}
      {tab === 'models'    && <ModelsTab d={data} />}
      {tab === 'approvals' && <ApprovalsOverlaysTab d={data} />}
      {tab === 'lineage'   && <LineageTab d={data} />}
    </div>
  );
}

function DataTab({ d }: { d: AuditPanelData }) {
  return (
    <div className="space-y-4">
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900">QRT table</h4>
        <p className="text-xs text-gray-500 mt-0.5">
          The Delta table this QRT is materialised into.
          {d.data.qrt_history.length > 0 && (
            <> Most recent version: <code className="bg-gray-100 px-1 rounded">v{d.data.qrt_history[0].version}</code> at <code className="bg-gray-100 px-1 rounded">{d.data.qrt_history[0].timestamp}</code></>
          )}
        </p>
        <div className="mt-2 text-xs font-mono text-gray-700">{d.data.qrt_table}</div>
        {d.data.qrt_history.length > 0 && (
          <table className="w-full text-xs mt-3">
            <thead className="text-[10px] uppercase tracking-wide text-gray-500">
              <tr><th className="text-left pb-1">Version</th><th className="text-left">Timestamp</th><th className="text-left">Operation</th></tr>
            </thead>
            <tbody>
              {d.data.qrt_history.slice(0, 5).map((h, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1 font-mono">v{h.version}</td>
                  <td className="py-1 font-mono text-gray-500">{h.timestamp}</td>
                  <td className="py-1">{h.operation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900">Source tables</h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">
          The bronze / silver / engine tables this QRT was built from. Hash + version + row count for each.
        </p>
        <ul className="space-y-2.5">
          {d.data.source_tables.map((s, i) => (
            <li key={i} className="border border-gray-100 rounded p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{s.name}</code>
                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold ${
                  s.layer === 'bronze' ? 'bg-orange-100 text-orange-800' :
                  s.layer === 'silver' ? 'bg-slate-100 text-slate-700' :
                  s.layer === 'gold' ? 'bg-amber-100 text-amber-800' :
                  s.layer === 'engine' ? 'bg-purple-100 text-purple-700' :
                  'bg-blue-100 text-blue-800'
                }`}>{s.layer}</span>
                {s.row_count != null && (
                  <span className="text-[11px] text-gray-500 ml-auto font-mono">{Number(s.row_count).toLocaleString()} rows</span>
                )}
              </div>
              <p className="text-xs text-gray-600">{s.described}</p>
              {s.history && s.history.length > 0 && (
                <div className="text-[11px] text-gray-500 mt-1">
                  Latest: v{s.history[0].version} @ <span className="font-mono">{s.history[0].timestamp}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CodeTab({ d }: { d: AuditPanelData }) {
  return (
    <div className="space-y-4">
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900">Notebooks + scripts</h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">
          The code that produces this QRT — git-tracked, versioned, audit-logged on every run.
        </p>
        <ul className="space-y-2">
          {d.code.notebooks.map((n, i) => (
            <li key={i} className="text-xs flex items-start gap-2">
              <Code2 className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <code className="text-[11px] bg-gray-100 px-1 rounded font-mono">{n.path}</code>
                <p className="text-gray-600 mt-0.5">{n.described}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          Recent job runs
          <span className="text-[10px] uppercase font-semibold text-gray-400">workspace-wide</span>
        </h4>
        {d.code.recent_runs.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">No recent job runs available.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {d.code.recent_runs.slice(0, 6).map((r, i) => (
              <li key={i} className="text-xs flex items-center gap-2 font-mono">
                <Clock className="w-3 h-3 text-gray-400" />
                <span className="text-gray-700 truncate flex-1" title={r.run_name}>{r.run_name}</span>
                <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                  r.result === 'SUCCESS' ? 'bg-green-100 text-green-700' :
                  r.result === 'FAILED' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{r.result ?? r.state ?? '?'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ModelsTab({ d }: { d: AuditPanelData }) {
  if (d.models.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-xs text-gray-500">
        No actuarial models contribute to this QRT — it draws directly from raw + silver tables.
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
          <tr>
            <th className="text-left px-3 py-2">Model</th>
            <th className="text-left px-3 py-2">Production version</th>
            <th className="text-left px-3 py-2">Quarter</th>
            <th className="text-left px-3 py-2">Approver</th>
            <th className="text-left px-3 py-2">Approved at</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {d.models.map((m, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-3 py-2.5 font-semibold">{m.model_name}</td>
              <td className="px-3 py-2.5 font-mono text-xs">
                {m.to_version ? <code className="bg-violet-50 text-violet-800 border border-violet-200 px-1 rounded">{m.to_version}</code> : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs">{m.quarter ?? '—'}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700 truncate max-w-[180px]" title={m.approver ?? ''}>{m.approver ?? '—'}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{m.approved_at ?? '—'}</td>
              <td className="px-3 py-2.5 text-right">
                <Link to={`/lab/${m.model_name}`} className="inline-flex items-center gap-0.5 text-xs text-violet-700 hover:text-violet-900">
                  Detail <ChevronRight className="w-3 h-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApprovalsOverlaysTab({ d }: { d: AuditPanelData }) {
  return (
    <div className="space-y-4">
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900">QRT approval chain</h4>
        {d.approvals_overlays.approvals.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">No approvals recorded yet for this QRT version.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-xs">
            {d.approvals_overlays.approvals.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <CheckCircle2 className={`w-3.5 h-3.5 ${a.decision === 'approved' ? 'text-green-700' : 'text-red-700'}`} />
                <span className="text-gray-800 font-medium">{a.decision}</span>
                <span className="text-gray-600 truncate max-w-[200px]" title={a.decided_by}>by {a.decided_by}</span>
                <span className="text-gray-400 font-mono ml-auto">{a.decided_at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          Linked overlays
          <span className="text-[10px] text-gray-400 font-normal">— actuarial judgement applied</span>
        </h4>
        {d.approvals_overlays.overlays.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">No overlays affect this QRT for the selected period.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {d.approvals_overlays.overlays.map((o) => (
              <li key={o.overlay_id} className="border border-gray-100 rounded p-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{o.quarter}</span>
                  <span className="font-semibold text-gray-800">{o.line_of_business}</span>
                  <span className="text-gray-500">·</span>
                  <span className="text-gray-600">{o.category.replace(/_/g, ' ')}</span>
                  <span className={`ml-auto font-mono ${parseFloat(String(o.magnitude_eur)) >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {parseFloat(String(o.magnitude_eur)) >= 0 ? '+' : ''}{Number(o.magnitude_eur).toLocaleString()} EUR
                  </span>
                </div>
                <Link to="/overlays" className="text-[11px] text-violet-700 hover:text-violet-900 mt-1 inline-block">
                  View in Overlays Register →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LineageTab({ d }: { d: AuditPanelData }) {
  // Simple visual chain: bronze/silver source → models → QRT
  const sources = d.lineage.source_tables;
  const layered: Record<string, typeof sources> = {};
  for (const s of sources) (layered[s.layer] ??= []).push(s);

  return (
    <div className="space-y-4">
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900">Dependency graph</h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-4">
          Curated lineage map: where the values in <code className="bg-gray-100 px-1 rounded text-[11px]">{d.lineage.qrt_table}</code> come from.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <LineageColumn title="Sources">
            {Object.entries(layered).map(([layer, items]) => (
              <div key={layer} className="mb-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">{layer}</div>
                {items.map((s, i) => (
                  <div key={i} className={`text-[11px] font-mono px-2 py-1 mb-1 rounded ${
                    s.layer === 'bronze' ? 'bg-orange-50 text-orange-800 border border-orange-200' :
                    s.layer === 'silver' ? 'bg-slate-50 text-slate-700 border border-slate-200' :
                    s.layer === 'engine' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                    'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}>{s.name}</div>
                ))}
              </div>
            ))}
          </LineageColumn>

          <LineageColumn title="Models">
            {d.lineage.produced_by.length === 0 ? (
              <div className="text-[11px] text-gray-500 italic">no models in path</div>
            ) : (
              d.lineage.produced_by.map((m) => (
                <Link key={m} to={`/lab/${m}`}
                  className="block text-[11px] font-mono px-2 py-1 mb-1 rounded bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100">
                  {m}
                </Link>
              ))
            )}
          </LineageColumn>

          <LineageColumn title="QRT output">
            <div className="text-[11px] font-mono px-2 py-1 mb-1 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
              {d.lineage.qrt_table}
            </div>
            <div className="text-[11px] font-mono px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
              {d.lineage.summary_table}
            </div>
          </LineageColumn>
        </div>
      </section>
    </div>
  );
}

function LineageColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-600 font-bold mb-2">{title}</div>
      {children}
    </div>
  );
}

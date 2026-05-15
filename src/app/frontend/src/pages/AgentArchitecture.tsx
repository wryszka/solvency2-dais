/**
 * Agent Architecture — supervisor + specialists + lit-path for recent routings.
 *
 * Static catalogue is fetched from /api/supervisor/specialists once; the recent
 * routing history is fetched from /api/supervisor/recent and polled every 5s
 * so the lit path tracks new questions live.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Brain, Sparkles, RefreshCw, ExternalLink, Cpu } from 'lucide-react';

interface UcArtefact {
  uc_path: string | null;
  workspace_url: string | null;
  kind: string;
}

interface ToolRef {
  name: string;
  kind: 'uc_function' | 'uc_table';
  workspace_url: string | null;
}

interface Specialist {
  key: string;
  name: string;
  scope: string;
  triggers: string;
  color: string;
  data_sources: string[];
  uc_artefact?: UcArtefact;
  tools?: ToolRef[];
}

interface SupervisorMeta {
  uc_path: string;
  workspace_url: string;
  serving_endpoint: string | null;
  serving_endpoint_url: string | null;
  kind: string;
}

interface RoutingRow {
  trace_id: string;
  question: string;
  specialist_key: string;
  specialist_name: string;
  confidence: number;
  data_sources: string[];
  model_used: string;
  was_cached: boolean;
  baked: boolean;
  period: string;
  created_at: string;
  created_by: string;
}

const CX = 500;
const CY = 260;
const R_SPECIALIST = 200;

// Tailwind color class lookup keyed by the registry's `color` field.
const COLOR_MAP: Record<string, { stroke: string; fill: string; text: string; hex: string }> = {
  amber:   { stroke: 'stroke-amber-500',   fill: 'fill-amber-100',   text: 'fill-amber-900',   hex: '#f59e0b' },
  violet:  { stroke: 'stroke-violet-500',  fill: 'fill-violet-100',  text: 'fill-violet-900',  hex: '#8b5cf6' },
  emerald: { stroke: 'stroke-emerald-500', fill: 'fill-emerald-100', text: 'fill-emerald-900', hex: '#10b981' },
  rose:    { stroke: 'stroke-rose-500',    fill: 'fill-rose-100',    text: 'fill-rose-900',    hex: '#f43f5e' },
  blue:    { stroke: 'stroke-blue-500',    fill: 'fill-blue-100',    text: 'fill-blue-900',    hex: '#3b82f6' },
  orange:  { stroke: 'stroke-orange-500',  fill: 'fill-orange-100',  text: 'fill-orange-900',  hex: '#f97316' },
  cyan:    { stroke: 'stroke-cyan-500',    fill: 'fill-cyan-100',    text: 'fill-cyan-900',    hex: '#06b6d4' },
  slate:   { stroke: 'stroke-slate-500',   fill: 'fill-slate-100',   text: 'fill-slate-900',   hex: '#64748b' },
};

function relTime(iso: string): string {
  if (!iso) return '';
  try {
    const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    const ageSec = Math.max(0, (Date.now() - t) / 1000);
    if (ageSec < 90) return 'just now';
    if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
    if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
    return `${Math.round(ageSec / 86400)}d ago`;
  } catch { return ''; }
}

function pos(angle: number, r = R_SPECIALIST) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

export default function AgentArchitecture() {
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [supervisor, setSupervisor] = useState<SupervisorMeta | null>(null);
  const [recent, setRecent] = useState<RoutingRow[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/supervisor/specialists')
      .then((r) => r.json())
      .then((d) => {
        setSpecialists(d.specialists || []);
        setSupervisor(d.supervisor || null);
      })
      .catch(() => setSpecialists([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/supervisor/recent?limit=10');
        const d = await r.json();
        if (!cancelled) setRecent(d.recent || []);
      } catch { /* ignore */ }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const litTrace = recent.find((r) => r.trace_id === selectedTrace) ?? recent[0];
  const litKey = litTrace?.specialist_key;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <Link to="/" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Workbench
      </Link>

      <header className="pb-4 border-b border-gray-200">
        <div className="text-[11px] uppercase tracking-widest text-violet-700 font-bold">Agent Architecture</div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">How Ask Workbench routes a question</h1>
        <p className="text-sm text-gray-600 mt-1.5 leading-relaxed max-w-3xl">
          One supervisor agent. Eight specialists. The supervisor classifies each question via the
          Foundation Model API and invokes the specialist best positioned to answer. Every node
          below is a real Databricks artefact — click any of them to open it in the workspace.
        </p>
      </header>

      {supervisor && (
        <section className="bg-violet-50/60 border border-violet-200 rounded-lg p-4 flex flex-wrap items-center gap-3 text-xs">
          <Cpu className="w-4 h-4 text-violet-700 shrink-0" />
          <span className="font-semibold text-violet-900">Supervisor:</span>
          <a href={supervisor.workspace_url} target="_blank" rel="noopener noreferrer"
            className="font-mono text-violet-800 hover:underline inline-flex items-center gap-1">
            {supervisor.uc_path} <ExternalLink className="w-3 h-3" />
          </a>
          {supervisor.serving_endpoint ? (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">Endpoint:</span>
              <a href={supervisor.serving_endpoint_url ?? '#'} target="_blank" rel="noopener noreferrer"
                className="font-mono text-violet-800 hover:underline inline-flex items-center gap-1">
                {supervisor.serving_endpoint} <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-emerald-700 font-semibold">· live traffic via endpoint</span>
            </>
          ) : (
            <span className="text-amber-700 font-mono">
              · endpoint not configured — set SUPERVISOR_ENDPOINT_NAME after running ai_agents_setup
            </span>
          )}
        </section>
      )}

      {/* Architecture diagram */}
      <section className="bg-gradient-to-br from-slate-50 to-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="text-sm text-gray-500 p-8 text-center">Loading specialists…</div>
        ) : (
          <svg viewBox="0 0 1000 540" className="w-full h-auto">
            <defs>
              <radialGradient id="supGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Lit edges (supervisor → specialist) */}
            {specialists.map((s, i) => {
              const p = pos((i * 360) / specialists.length);
              const lit = s.key === litKey;
              return (
                <line key={`edge-${s.key}`} x1={CX} y1={CY} x2={p.x} y2={p.y}
                  stroke={lit ? COLOR_MAP[s.color]?.hex ?? '#8b5cf6' : '#cbd5e1'}
                  strokeWidth={lit ? 3 : 1}
                  strokeOpacity={lit ? 0.9 : 0.4}
                  strokeDasharray={lit ? '0' : '4 6'} />
              );
            })}

            {/* Supervisor centre */}
            <circle cx={CX} cy={CY} r={120} fill="url(#supGlow)" />
            <circle cx={CX} cy={CY} r={62} fill="#1e293b" stroke="#8b5cf6" strokeWidth={2} />
            <text x={CX} y={CY - 5} textAnchor="middle" fill="white" fontSize={16} fontWeight={700}
              fontFamily="ui-sans-serif, system-ui">Supervisor</text>
            <text x={CX} y={CY + 15} textAnchor="middle" fill="#c4b5fd" fontSize={11}
              fontFamily="ui-monospace, monospace">classify · route</text>

            {/* Specialist nodes */}
            {specialists.map((s, i) => {
              const p = pos((i * 360) / specialists.length);
              const lit = s.key === litKey;
              const c = COLOR_MAP[s.color] ?? COLOR_MAP.slate;
              return (
                <g key={s.key}>
                  <circle cx={p.x} cy={p.y} r={lit ? 60 : 50}
                    className={`${c.fill} ${c.stroke}`}
                    strokeWidth={lit ? 3 : 1.5}
                    style={lit ? { filter: 'drop-shadow(0 0 14px ' + c.hex + ')' } : undefined} />
                  <text x={p.x} y={p.y - 5} textAnchor="middle" className={c.text}
                    fontSize={11} fontWeight={700}>
                    {wrapLabel(s.name, 14)[0]}
                  </text>
                  <text x={p.x} y={p.y + 8} textAnchor="middle" className={c.text}
                    fontSize={10} fontWeight={600}>
                    {wrapLabel(s.name, 14)[1] ?? ''}
                  </text>
                  <text x={p.x} y={p.y + 22} textAnchor="middle" fill="#475569"
                    fontSize={9} fontFamily="ui-monospace, monospace">
                    {s.key}
                  </text>
                </g>
              );
            })}

            {/* Data-source strip at bottom — only those touched by the lit specialist */}
            {litTrace && litTrace.data_sources && (
              <g>
                <text x={CX} y={490} textAnchor="middle" fill="#64748b" fontSize={10}
                  fontFamily="ui-monospace, monospace" letterSpacing={1}>
                  DATA TOUCHED ON THE LAST CALL
                </text>
                {litTrace.data_sources.slice(0, 5).map((ds, i, arr) => {
                  const totalW = Math.min(arr.length, 5) * 180;
                  const startX = CX - totalW / 2 + 90;
                  const x = startX + i * 180;
                  return (
                    <g key={ds}>
                      <rect x={x - 80} y={500} width={160} height={28} rx={6}
                        fill="white" stroke="#cbd5e1" strokeWidth={1} />
                      <text x={x} y={518} textAnchor="middle" fill="#0f172a"
                        fontSize={11} fontFamily="ui-monospace, monospace">
                        {truncate(ds, 18)}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </svg>
        )}
      </section>

      {/* Recent routing history */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-700" />
            <h2 className="text-sm font-bold text-gray-900">Recent routing decisions</h2>
            <span className="text-[11px] text-gray-500">refreshes every 5s</span>
          </div>
          <button onClick={() => window.location.reload()}
            className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Hard refresh
          </button>
        </header>
        {recent.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">
            No routing decisions yet. Open the Ask Workbench overlay (violet button, bottom-right) and try a question.
          </div>
        ) : (
          <ul>
            {recent.map((r) => {
              const c = COLOR_MAP[(specialists.find((s) => s.key === r.specialist_key)?.color) || 'slate'];
              const selected = r.trace_id === (selectedTrace ?? recent[0]?.trace_id);
              return (
                <li key={r.trace_id}
                  onClick={() => setSelectedTrace(r.trace_id)}
                  className={`flex items-start gap-3 px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-violet-50/50 transition-colors ${selected ? 'bg-violet-50/50' : ''}`}>
                  <span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ backgroundColor: c.hex }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900">{r.question}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="font-mono">{relTime(r.created_at)}</span>
                      <span>·</span>
                      <span className="font-semibold" style={{ color: c.hex }}>{r.specialist_name}</span>
                      {r.was_cached && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-700">cached {r.baked ? '· baked' : '· session'}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="font-mono text-gray-400">
                        {(r.data_sources || []).slice(0, 3).join(' · ')}
                        {r.data_sources && r.data_sources.length > 3 && ` +${r.data_sources.length - 3}`}
                      </span>
                    </div>
                  </div>
                  <Brain className="w-3.5 h-3.5 text-gray-300 mt-1.5" />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Specialists catalogue */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <header className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-bold text-gray-900">Specialist catalogue</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Static. The supervisor picks one of these per question; you can't bypass it.
          </p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          {specialists.map((s) => {
            const c = COLOR_MAP[s.color] ?? COLOR_MAP.slate;
            const a = s.uc_artefact;
            return (
              <div key={s.key} className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.hex }} />
                  <h3 className="text-sm font-bold text-gray-900">{s.name}</h3>
                  <span className="ml-auto text-[10px] font-mono text-gray-400">{s.key}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{s.scope}</p>
                {a && a.workspace_url && (
                  <a href={a.workspace_url} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] font-mono text-violet-700 hover:underline inline-flex items-center gap-1 mt-1.5">
                    {a.uc_path} <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <p className="text-[11px] text-gray-500 mt-1.5">
                  <span className="font-semibold uppercase tracking-wide text-[9px] text-gray-400 mr-1">triggers</span>
                  {s.triggers}
                </p>
                {s.tools && s.tools.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span className="font-semibold uppercase tracking-wide text-[9px] text-gray-400">tools</span>
                    {s.tools.map((t) => (
                      t.workspace_url ? (
                        <a key={t.name} href={t.workspace_url} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] font-mono text-blue-700 hover:underline">
                          {t.name}
                        </a>
                      ) : (
                        <span key={t.name} className="text-[10px] font-mono text-gray-500">{t.name}</span>
                      )
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function wrapLabel(label: string, maxLen: number): string[] {
  if (label.length <= maxLen) return [label];
  const words = label.split(' ');
  let line1 = '', line2 = '';
  for (const w of words) {
    if ((line1 + ' ' + w).trim().length <= maxLen) line1 = (line1 + ' ' + w).trim();
    else line2 = (line2 + ' ' + w).trim();
  }
  return [line1, line2];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

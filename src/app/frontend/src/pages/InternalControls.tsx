/**
 * Internal Controls — Pillar 2 page.
 *
 * 12-control × layer matrix, blocked-attempt counters, the architectural
 * "AI cannot approve" assertion, and a live audit trail of agent calls.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Lock, Loader2, AlertTriangle, ShieldCheck, ShieldAlert, ShieldOff, ArrowRight,
} from 'lucide-react';
import PillarChip from '../components/PillarChip';
import {
  fetchControlsMatrix, fetchAgentAudit, fetchBlockedCounter, fetchArchitectureAssertion,
  type ControlsLayer,
} from '../lib/api';

export default function InternalControls() {
  const [matrix, setMatrix] = useState<ControlsLayer[] | null>(null);
  const [audit, setAudit] = useState<unknown[]>([]);
  const [counters, setCounters] = useState<{ forbidden_blocks: number; pii_flags: number; rate_limited: number; errors: number; total_calls: number } | null>(null);
  const [invariants, setInvariants] = useState<{ title: string; detail: string; implementation: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchControlsMatrix(),
      fetchAgentAudit(50),
      fetchBlockedCounter(),
      fetchArchitectureAssertion(),
    ])
      .then(([m, a, c, inv]) => {
        setMatrix(m.layers);
        setAudit(a.calls);
        setCounters(c);
        setInvariants(inv.invariants);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Lock className="w-6 h-6 text-green-700" />
          Internal Controls
          <PillarChip pillar={2} size="md" />
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          The 12 AI guardrails arranged by control layer, the live audit trail of agent calls,
          counts of blocked attempts, and the architectural invariants the platform enforces.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/pillar-2#fit-and-proper"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded border border-emerald-200 bg-emerald-50/50">
            Fit-and-proper register (Art. 42) <ArrowRight className="w-3 h-3" />
          </Link>
          <Link to="/pillar-2#audit-trail"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded border border-emerald-200 bg-emerald-50/50">
            Audit-trail event types <ArrowRight className="w-3 h-3" />
          </Link>
          <Link to="/pillar-3#evr"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 px-2 py-1 rounded border border-amber-200 bg-amber-50/50">
            EIOPA validation rules <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> loading…
        </div>
      ) : (
        <>
          {/* Counters */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CounterCard label="Total agent calls (audit)"  value={String(counters?.total_calls ?? 0)}  Icon={ShieldCheck} tone="neutral" />
            <CounterCard label="Forbidden blocks"           value={String(counters?.forbidden_blocks ?? 0)} Icon={ShieldOff}   tone={counters && counters.forbidden_blocks > 0 ? 'warn' : 'good'} />
            <CounterCard label="PII flags"                  value={String(counters?.pii_flags ?? 0)}     Icon={ShieldAlert} tone={counters && counters.pii_flags > 0 ? 'warn' : 'good'} />
            <CounterCard label="Rate-limited"               value={String(counters?.rate_limited ?? 0)}  Icon={Lock}        tone={counters && counters.rate_limited > 0 ? 'warn' : 'good'} />
          </section>

          {/* Architectural invariants */}
          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-green-50/40">
              <h3 className="text-sm font-bold text-green-900">Architectural invariants</h3>
            </header>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {invariants.map((inv) => (
                <div key={inv.title} className="border border-green-200 bg-green-50/40 rounded-md p-3">
                  <div className="text-sm font-semibold text-green-900">{inv.title}</div>
                  <div className="text-xs text-green-800 mt-1">{inv.detail}</div>
                  <div className="text-[11px] text-gray-500 mt-2 font-mono">{inv.implementation}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 12-control matrix */}
          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-green-50/40">
              <h3 className="text-sm font-bold text-green-900">12-control matrix</h3>
              <p className="text-xs text-gray-600 mt-0.5">
                Grouped by control layer. Each control points at its implementation file/line so
                an auditor can read the source.
              </p>
            </header>
            <div className="p-4 space-y-4">
              {matrix?.map((layer) => (
                <div key={layer.layer}>
                  <h4 className="text-[10px] uppercase font-semibold tracking-wider text-gray-500 mb-2">
                    {layer.layer}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {layer.controls.map((c) => (
                      <div key={c.id} className="border border-gray-200 rounded-md p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{c.id}</span>
                          <span className="text-sm font-semibold text-gray-900">{c.control}</span>
                        </div>
                        <div className="text-xs text-gray-600">{c.description}</div>
                        <div className="text-[10px] text-gray-400 mt-1.5 font-mono">{c.implementation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Agent audit trail */}
          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-green-50/40">
              <h3 className="text-sm font-bold text-green-900">Live agent audit (last 50 calls)</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">When</th>
                    <th className="px-3 py-2 text-left font-semibold">User</th>
                    <th className="px-3 py-2 text-left font-semibold">Method</th>
                    <th className="px-3 py-2 text-left font-semibold">Path</th>
                    <th className="px-3 py-2 text-right font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">Audit table not populated yet.</td></tr>
                  )}
                  {(audit as { called_at?: string; user_email?: string; method?: string; path?: string; status_code?: number; duration_ms?: number }[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-3 py-1.5 font-mono">{row.called_at?.toString().replace('T', ' ').split('.')[0] ?? '—'}</td>
                      <td className="px-3 py-1.5 truncate max-w-[180px]" title={row.user_email}>{row.user_email}</td>
                      <td className="px-3 py-1.5 font-mono">{row.method}</td>
                      <td className="px-3 py-1.5 font-mono truncate max-w-[260px]" title={row.path}>{row.path}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${
                        (row.status_code ?? 200) >= 500 ? 'text-red-700' :
                        (row.status_code ?? 200) >= 400 ? 'text-amber-700' : 'text-green-700'
                      }`}>{row.status_code}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{row.duration_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function CounterCard({ label, value, Icon, tone }: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
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
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-[11px] opacity-80">{label}</div>
    </div>
  );
}

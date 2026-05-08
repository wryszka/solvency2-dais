/**
 * Reserving & TPs (Life) — Pillar 1 page for S.12.01.
 *
 * Lightweight read-only view: latest period summary KPIs, per-LoB BEL+RM
 * table, and a quarterly trend. No editing; that's the responsibility of
 * the underlying DLT pipelines.
 */
import { useEffect, useState } from 'react';
import { BookOpen, AlertTriangle, FileDown } from 'lucide-react';
import PillarChip from '../components/PillarChip';
import { SkeletonTable } from '../components/Skeleton';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${url}: ${r.status}`);
  return r.json();
}

interface ReservesRow {
  reporting_period: string;
  lob_code: number;
  lob_name: string;
  lob_eiopa_name?: string;
  in_force_count: number | string;
  best_estimate_liability_eur: number | string;
  risk_margin_eur: number | string;
  technical_provisions_eur: number | string;
}

export default function LifeReserving() {
  const [latest, setLatest] = useState<ReservesRow[] | null>(null);
  const [trend, setTrend] = useState<Record<string, ReservesRow[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ data: ReservesRow[] }>('/api/life/reserves')
      .then((r) => {
        const byPeriod: Record<string, ReservesRow[]> = {};
        for (const row of r.data) {
          (byPeriod[row.reporting_period] = byPeriod[row.reporting_period] ?? []).push(row);
        }
        setTrend(byPeriod);
        const periods = Object.keys(byPeriod).sort();
        const latestPeriod = periods[periods.length - 1];
        setLatest(byPeriod[latestPeriod] ?? []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const total = latest?.reduce((acc, r) => ({
    bel: acc.bel + Number(r.best_estimate_liability_eur ?? 0),
    rm:  acc.rm + Number(r.risk_margin_eur ?? 0),
    tp:  acc.tp + Number(r.technical_provisions_eur ?? 0),
    pol: acc.pol + Number(r.in_force_count ?? 0),
  }), { bel: 0, rm: 0, tp: 0, pol: 0 });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-blue-700" />
          Reserving & Technical Provisions — Life
          <PillarChip pillar={1} size="md" />
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          S.12.01 — Life and Health (SLT) Technical Provisions. Best-estimate liability + risk margin
          per LoB. Source of truth for SFCR Section D (Valuation) under Pillar 3.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!latest ? <SkeletonTable rows={6} cols={5} /> : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Best estimate liability" value={fmtBn(total?.bel ?? 0)} />
            <Kpi label="Risk margin"             value={fmtBn(total?.rm ?? 0)} />
            <Kpi label="Technical provisions"    value={fmtBn(total?.tp ?? 0)} />
            <Kpi label="In-force policies"       value={fmtNum(total?.pol ?? 0)} />
          </div>

          {/* Per-LoB breakdown */}
          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-blue-50/40">
              <h3 className="text-sm font-bold text-blue-900">Latest period — Life TP by LoB</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
                  <tr>
                    <Th>LoB</Th>
                    <Th>Period</Th>
                    <Th align="right">In-force</Th>
                    <Th align="right">BEL</Th>
                    <Th align="right">Risk margin</Th>
                    <Th align="right">TP total</Th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-800">{r.lob_eiopa_name ?? r.lob_name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.reporting_period}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(Number(r.in_force_count ?? 0))}</td>
                      <td className="px-3 py-2 text-right">{fmtBn(Number(r.best_estimate_liability_eur ?? 0))}</td>
                      <td className="px-3 py-2 text-right">{fmtBn(Number(r.risk_margin_eur ?? 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtBn(Number(r.technical_provisions_eur ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Trend (LoB × period) */}
          {trend && (
            <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <header className="px-4 py-3 border-b border-gray-200 bg-blue-50/40">
                <h3 className="text-sm font-bold text-blue-900">Total TP per period</h3>
              </header>
              <div className="p-4 space-y-2">
                {Object.keys(trend).sort().map((period) => {
                  const tot = trend[period].reduce((s, r) => s + Number(r.technical_provisions_eur ?? 0), 0);
                  const max = Math.max(...Object.values(trend).map((rs) => rs.reduce((s, r) => s + Number(r.technical_provisions_eur ?? 0), 0)));
                  return (
                    <div key={period} className="text-xs">
                      <div className="flex justify-between mb-0.5">
                        <span className="font-mono text-gray-700">{period}</span>
                        <span className="font-medium text-gray-700">{fmtBn(tot)}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(tot/max)*100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-500">
            <FileDown className="w-3.5 h-3.5" />
            EIOPA template export available via the Archive page (per submission).
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-3 py-2 text-${align ?? 'left'} font-semibold whitespace-nowrap`}>{children}</th>;
}

function fmtBn(v: number): string {
  if (v >= 1e9) return `EUR ${(v/1e9).toFixed(2)}B`;
  if (v >= 1e6) return `EUR ${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `EUR ${(v/1e3).toFixed(0)}K`;
  return `EUR ${v.toFixed(0)}`;
}
function fmtNum(v: number): string {
  return v.toLocaleString('en-GB');
}

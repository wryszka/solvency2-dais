/**
 * Life UW Risk — Pillar 1 page (Prophet stochastic engine output).
 *
 * Shows per-period sub-module breakdown (mortality, longevity, lapse,
 * expense, life cat) plus the diversified total. Lapse trend is the
 * key Q4 2025 demo signal (Pain D).
 */
import { useEffect, useState } from 'react';
import { FlaskConical, AlertTriangle } from 'lucide-react';
import PillarChip from '../components/PillarChip';
import { SkeletonTable } from '../components/Skeleton';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${url}: ${r.status}`);
  return r.json();
}

interface SummaryRow {
  reporting_period: string;
  mortality_eur: number; longevity_eur: number;
  lapse_eur: number; expense_eur: number; life_cat_eur: number;
  total_life_uw_scr: number; diversification_benefit_eur: number;
}
interface ByModuleRow {
  reporting_period: string;
  lob_name: string;
  sub_module: string;
  var_eur: number;
  tvar_eur: number;
}
interface LapseRow {
  reporting_period: string;
  lob_name: string;
  duration_band: string;
  in_force_at_quarter_start: number;
  lapsed_in_quarter: number;
  lapse_rate_quarterly: number;
  annualised_lapse_rate: number;
}

const MODULE_LABEL: Record<string, string> = {
  mortality: 'Mortality',
  longevity: 'Longevity',
  lapse: 'Lapse',
  expense: 'Expense',
  life_cat: 'Life cat',
};

export default function LifeUWRisk() {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [lapses, setLapses] = useState<LapseRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<{ summary: SummaryRow[]; by_module: ByModuleRow[] }>('/api/life/uw'),
      getJson<{ data: LapseRow[] }>('/api/life/lapses'),
    ])
      .then(([uw, l]) => {
        setSummary(uw.summary);
        setLapses(l.data);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const latest = summary.length ? summary[summary.length - 1] : null;
  const lapseULTrend = lapses
    .filter((r) => r.lob_name === 'unit_linked')
    .reduce<Record<string, { in_force: number; lapsed: number }>>((acc, r) => {
      const cur = acc[r.reporting_period] ?? { in_force: 0, lapsed: 0 };
      cur.in_force += Number(r.in_force_at_quarter_start ?? 0);
      cur.lapsed   += Number(r.lapsed_in_quarter ?? 0);
      acc[r.reporting_period] = cur;
      return acc;
    }, {});

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FlaskConical className="w-6 h-6 text-blue-700" />
          Life UW Risk
          <PillarChip pillar={1} size="md" />
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Prophet stochastic engine output — mortality, longevity, lapse, expense, life cat.
          Diversified at the EIOPA Annex IV correlation matrix.
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {!latest ? <SkeletonTable rows={6} cols={6} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Tile label="Mortality"    value={fmt(latest.mortality_eur)} />
            <Tile label="Longevity"    value={fmt(latest.longevity_eur)} />
            <Tile label="Lapse"        value={fmt(latest.lapse_eur)} />
            <Tile label="Expense"      value={fmt(latest.expense_eur)} />
            <Tile label="Life cat"     value={fmt(latest.life_cat_eur)} />
            <Tile label="Total (diversified)"    value={fmt(latest.total_life_uw_scr)} highlight />
          </div>

          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-blue-50/40">
              <h3 className="text-sm font-bold text-blue-900">Sub-module trend (period × module)</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
                  <tr>
                    <Th>Period</Th>
                    {['mortality','longevity','lapse','expense','life_cat'].map((m) => (
                      <Th key={m} align="right">{MODULE_LABEL[m]}</Th>
                    ))}
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.reporting_period} className="border-b border-gray-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.reporting_period}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.mortality_eur)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.longevity_eur)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.lapse_eur)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.expense_eur)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.life_cat_eur)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(r.total_life_uw_scr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Lapse trend (Pain D demo signal) */}
          {Object.keys(lapseULTrend).length > 0 && (
            <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <header className="px-4 py-3 border-b border-gray-200 bg-blue-50/40">
                <h3 className="text-sm font-bold text-blue-900">Unit-linked lapse rate — quarterly</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Watch the latest period: a sustained spike in unit-linked lapses tightens the lapse
                  sub-module under Pillar 1 and feeds Section C of the SFCR (Pillar 3).
                </p>
              </header>
              <div className="p-4 space-y-2">
                {Object.keys(lapseULTrend).sort().map((p) => {
                  const v = lapseULTrend[p];
                  const pct = v.in_force > 0 ? (v.lapsed / v.in_force) * 100 : 0;
                  const max = Math.max(...Object.values(lapseULTrend).map((x) => x.in_force > 0 ? x.lapsed/x.in_force*100 : 0));
                  return (
                    <div key={p} className="text-xs">
                      <div className="flex justify-between mb-0.5">
                        <span className="font-mono text-gray-700">{p}</span>
                        <span className="font-medium text-gray-700">{pct.toFixed(2)}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(pct/max)*100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-white'}`}>
      <div className={`text-xl font-bold ${highlight ? 'text-blue-900' : 'text-gray-900'}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-3 py-2 text-${align ?? 'left'} font-semibold whitespace-nowrap`}>{children}</th>;
}

function fmt(v: number): string {
  if (v >= 1e9) return `EUR ${(v/1e9).toFixed(2)}B`;
  if (v >= 1e6) return `EUR ${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `EUR ${(v/1e3).toFixed(0)}K`;
  return `EUR ${v.toFixed(0)}`;
}

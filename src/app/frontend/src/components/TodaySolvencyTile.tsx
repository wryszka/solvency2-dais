/**
 * TodaySolvencyTile — daily solvency ratio with 90-day drill-down.
 *
 * The headline tile on the Today landing. Shows current ratio + delta vs
 * yesterday + delta vs Q-end. Click "View 90 days" → drawer with the chart
 * and hover tooltips on each engineered inflection.
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, X, Info } from 'lucide-react';
import { fetchSolvencyDaily, type DailySolvency } from '../lib/api';

export default function TodaySolvencyTile() {
  const [series, setSeries] = useState<DailySolvency[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    fetchSolvencyDaily(90).then((r) => setSeries(r.series)).catch(() => undefined);
  }, []);

  const stats = useMemo(() => {
    if (series.length < 2) return null;
    const today = series[series.length - 1];
    const yesterday = series[series.length - 2];
    const qStart = series[Math.max(0, series.length - 70)];   // ~q ago
    const ratio = parseFloat(String(today.ratio_pct));
    const dyest = ratio - parseFloat(String(yesterday.ratio_pct));
    const dq = ratio - parseFloat(String(qStart.ratio_pct));
    return { ratio, dyest, dq };
  }, [series]);

  if (!stats) return null;

  const isUp = (v: number) => v >= 0;

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-full text-left bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white rounded-xl p-5 shadow-lg hover:shadow-xl transition-shadow group"
      >
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-blue-300">
          <Activity className="w-3.5 h-3.5" /> Today's Solvency Ratio
          <span className="ml-auto text-[10px] text-blue-300/70 normal-case tracking-normal">refreshed nightly</span>
        </div>
        <div className="flex items-baseline gap-3 mt-1.5">
          <span className="text-5xl font-bold tabular-nums tracking-tight">{stats.ratio.toFixed(1)}%</span>
          <span className={`inline-flex items-center gap-0.5 text-sm font-semibold ${isUp(stats.dyest) ? 'text-emerald-300' : 'text-rose-300'}`}>
            {isUp(stats.dyest) ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isUp(stats.dyest) ? '+' : ''}{stats.dyest.toFixed(1)}pp <span className="text-[10px] opacity-70">vs yesterday</span>
          </span>
        </div>
        <div className="text-xs text-slate-300 mt-2 flex items-center gap-3">
          <span className={isUp(stats.dq) ? 'text-emerald-300' : 'text-rose-300'}>
            {isUp(stats.dq) ? '+' : ''}{stats.dq.toFixed(1)}pp vs Q-start
          </span>
          <span className="text-blue-300 font-semibold ml-auto group-hover:translate-x-1 transition-transform">
            View 90 days →
          </span>
        </div>
      </button>

      {drawerOpen && <DrawerChart series={series} onClose={() => setDrawerOpen(false)} />}
    </>
  );
}

function DrawerChart({ series, onClose }: { series: DailySolvency[]; onClose: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = series.map((s) => ({ ...s, ratio_pct: parseFloat(String(s.ratio_pct)) }));
  const W = 880, H = 360, PAD_L = 50, PAD_R = 24, PAD_T = 28, PAD_B = 38;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const ratios = data.map((d) => d.ratio_pct);
  const yMin = Math.floor(Math.min(...ratios) - 1);
  const yMax = Math.ceil(Math.max(...ratios) + 1);
  const xFor = (i: number) => PAD_L + (i / Math.max(data.length - 1, 1)) * innerW;
  const yFor = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(d.ratio_pct).toFixed(1)}`).join(' ');
  const inflections = data.map((d, i) => ({ ...d, idx: i })).filter((d) => d.driver_class !== 'drift' && d.driver !== '—');

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full bg-white rounded-t-2xl shadow-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <Activity className="w-5 h-5 text-blue-700 mt-1" />
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900">Solvency ratio · last 90 days</h3>
            <p className="text-xs text-gray-500 mt-0.5">Daily refresh. Hover any inflection point for the driver.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </header>

        <div className="p-6">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {/* gridlines */}
            {[0, 1, 2, 3, 4].map((i) => {
              const v = yMin + (yMax - yMin) * (i / 4);
              return (
                <g key={i}>
                  <line x1={PAD_L} y1={yFor(v)} x2={W - PAD_R} y2={yFor(v)} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3 4" />
                  <text x={PAD_L - 6} y={yFor(v) + 4} fontSize={10} fill="#94a3b8" textAnchor="end" fontFamily="ui-monospace, monospace">
                    {v.toFixed(0)}%
                  </text>
                </g>
              );
            })}

            <path d={linePath} fill="none" stroke="#1e40af" strokeWidth={2} />

            {/* dots — most as small markers, inflection points larger */}
            {data.map((d, i) => {
              const isInfl = d.driver_class !== 'drift' && d.driver !== '—';
              return (
                <circle key={i}
                  cx={xFor(i)} cy={yFor(d.ratio_pct)}
                  r={isInfl ? 5 : 1.5}
                  fill={isInfl ? '#f59e0b' : '#1e40af'}
                  stroke="white" strokeWidth={isInfl ? 2 : 0}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}

            {/* hover tooltip */}
            {hover != null && (() => {
              const d = data[hover];
              const x = xFor(hover);
              const y = yFor(d.ratio_pct);
              const label = `${d.observed_date} · ${d.ratio_pct.toFixed(1)}%`;
              const sub = d.driver !== '—' ? d.driver : 'gentle drift';
              return (
                <g>
                  <line x1={x} y1={PAD_T} x2={x} y2={H - PAD_B} stroke="#1e40af" strokeOpacity={0.2} strokeWidth={1} />
                  <rect x={x - 130} y={y - 50} width={260} height={36} rx={4} fill="white" stroke="#1e40af" strokeWidth={1} />
                  <text x={x} y={y - 32} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, monospace" fill="#1e293b" fontWeight={700}>
                    {label}
                  </text>
                  <text x={x} y={y - 18} textAnchor="middle" fontSize={10} fill="#475569">
                    {sub.length > 50 ? sub.slice(0, 49) + '…' : sub}
                  </text>
                </g>
              );
            })()}

            {/* x-axis labels — first, middle, last */}
            {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
              <text key={i} x={xFor(i)} y={H - PAD_B + 18} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="ui-monospace, monospace">
                {data[i]?.observed_date}
              </text>
            ))}
          </svg>

          <section className="mt-4">
            <h4 className="text-xs uppercase tracking-wider font-bold text-gray-600 flex items-center gap-1">
              <Info className="w-3 h-3" /> Engineered inflections in window
            </h4>
            <ul className="mt-2 space-y-1.5">
              {inflections.length === 0 && <li className="text-xs text-gray-500 italic">No inflections in window.</li>}
              {inflections.map((d, i) => (
                <li key={i} className="text-xs flex items-center gap-3">
                  <span className="font-mono text-gray-700">{d.observed_date}</span>
                  <span className={`font-mono ${parseFloat(String(d.delta_vs_prior_pp)) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {parseFloat(String(d.delta_vs_prior_pp)) >= 0 ? '+' : ''}{parseFloat(String(d.delta_vs_prior_pp)).toFixed(2)}pp
                  </span>
                  <span className="text-gray-700">{d.driver}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

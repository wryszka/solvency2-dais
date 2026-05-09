/**
 * OrsaContinuousHeader — Scene 7 reframe.
 *
 * Replaces the stale "ORSA cycle drafted last week" header with "refreshed
 * nightly, last updated 02:14 this morning". Shows 30-day sparklines for the
 * three standing stresses. Below, a button to define an on-the-fly stress
 * (the low-rate stress is the pre-tested live-run case).
 */
import { useEffect, useMemo, useState } from 'react';
import { Workflow, Loader2, Play, Sparkles, X } from 'lucide-react';
import { fetchOrsaHistory, runOrsaStress, type OrsaHistoryScenario } from '../lib/api';
import { useStreamedText } from '../lib/hooks/useStreamedText';

export default function OrsaContinuousHeader() {
  const [scenarios, setScenarios] = useState<OrsaHistoryScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [stressOpen, setStressOpen] = useState(false);

  useEffect(() => {
    fetchOrsaHistory(30).then((r) => setScenarios(r.scenarios)).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  return (
    <section className="bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 border border-emerald-200 rounded-xl p-5 space-y-4">
      <header className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
          <Workflow className="w-4 h-4 text-emerald-700" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-gray-900">Continuous ORSA</h3>
            <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
              refreshed nightly
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5">
            Standing stresses re-projected every night. <span className="font-mono">Last updated 02:14 this morning.</span>
          </p>
        </div>
        <button onClick={() => setStressOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 text-xs font-semibold">
          <Play className="w-3 h-3" /> On-the-fly stress
        </button>
      </header>

      {loading ? (
        <div className="text-xs text-gray-500"><Loader2 className="w-3 h-3 inline animate-spin" /> loading 30-day drift…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {scenarios.map((s) => <ScenarioCard key={s.scenario_id} s={s} />)}
        </div>
      )}

      {stressOpen && <OnTheFlyStress onClose={() => setStressOpen(false)} />}
    </section>
  );
}

function ScenarioCard({ s }: { s: OrsaHistoryScenario }) {
  // We have 30 days × 4 year-offsets. For the sparkline, take the year-3 trough projection.
  const series = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const p of s.points) {
      // pick worst (lowest) year_offset>0 ratio for that observation date
      if (p.year_offset === 0) continue;
      const cur = byDate.get(p.observed_date);
      if (cur == null || p.ratio_pct < cur) byDate.set(p.observed_date, p.ratio_pct);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([date, ratio]) => ({ date, ratio }));
  }, [s.points]);

  const latest = series[series.length - 1]?.ratio ?? 0;
  const earliest = series[0]?.ratio ?? 0;
  const drift = latest - earliest;
  const trough = Math.min(...series.map((p) => p.ratio));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-bold text-gray-900 leading-tight flex-1">{s.scenario_name}</h4>
        <span className={`text-[11px] font-mono font-bold ${drift < -1 ? 'text-rose-700' : drift > 1 ? 'text-emerald-700' : 'text-gray-600'}`}>
          {drift >= 0 ? '+' : ''}{drift.toFixed(1)}pp
          <span className="text-[9px] text-gray-400 font-sans font-normal ml-0.5">30d</span>
        </span>
      </div>
      <Sparkline points={series.map((p) => p.ratio)} />
      <div className="flex items-baseline gap-3 text-[11px] text-gray-500">
        <span>trough <span className="font-mono font-bold text-gray-800">{trough.toFixed(0)}%</span></span>
        <span>now <span className="font-mono font-bold text-gray-800">{latest.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="h-12" />;
  const W = 240, H = 48, PAD = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 0.5);
  const xFor = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const yFor = (v: number) => PAD + (1 - (v - min) / range) * (H - 2 * PAD);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p).toFixed(1)}`).join(' ');
  // Drift colour
  const drift = points[points.length - 1] - points[0];
  const stroke = drift < -1 ? '#dc2626' : drift > 1 ? '#15803d' : '#475569';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12">
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
      <circle cx={xFor(points.length - 1)} cy={yFor(points[points.length - 1])} r={2.5} fill={stroke} />
    </svg>
  );
}

function OnTheFlyStress({ onClose }: { onClose: () => void }) {
  const SUGGESTIONS = [
    'sustained low interest rates for 5 years',
    'inflation +2pp sustained 3 years',
    'mass cyber loss event',
  ];
  const [scenario, setScenario] = useState(SUGGESTIONS[0]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    scenario_label: string;
    ratios_by_year: { year_offset: number; ratio_pct: number }[];
    narrative: string;
    trough_ratio_pct: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { text: streamed, done } = useStreamedText(result?.narrative ?? null, { charsPerTick: 5, tickMs: 18 });

  async function go() {
    setRunning(true); setError(null); setResult(null);
    try {
      setResult(await runOrsaStress(scenario, 5) as {
        scenario_label: string;
        ratios_by_year: { year_offset: number; ratio_pct: number }[];
        narrative: string;
        trough_ratio_pct: number;
      });
    } catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !running && onClose()}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900">On-the-fly ORSA stress</h3>
            <p className="text-xs text-gray-500 mt-0.5">Define a scenario in plain English. Runs live on serverless (~30-40s).</p>
          </div>
          <button onClick={() => !running && onClose()} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </header>

        {!result && (
          <>
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Scenario</span>
              <input value={scenario} onChange={(e) => setScenario(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setScenario(s)}
                  className="text-[11px] px-2 py-0.5 border border-gray-200 rounded-full text-gray-600 hover:bg-emerald-50">
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>
        )}

        {running && (
          <div className="mt-4 space-y-1.5 text-xs">
            {[
              'Reading base SCR + business plan',
              'Applying scenario shocks across sub-modules',
              'Re-aggregating BSCR through correlation matrix',
              'Projecting capital path · 5 years',
              'Persisting + scoring against risk appetite',
            ].map((label, i) => <RunStage key={i} label={label} delay={i * 5500} />)}
          </div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            <RatioPath result={result} />
            <div className="bg-gradient-to-br from-emerald-50/50 to-white border border-emerald-100 rounded-lg p-3.5">
              <div className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-800">
                {streamed}
                {!done && <span className="inline-block w-2 h-4 bg-emerald-700 align-middle ml-0.5 animate-pulse" />}
              </div>
            </div>
          </div>
        )}

        <footer className="mt-4 flex items-center gap-2">
          <button onClick={() => !running && onClose()} disabled={running}
            className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50">
            Close
          </button>
          {!result && (
            <button onClick={go} disabled={running}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50 text-xs font-semibold">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {running ? 'Running…' : 'Run stress'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function RatioPath({ result }: { result: { ratios_by_year: { year_offset: number; ratio_pct: number }[] } }) {
  const W = 460, H = 140, PAD_L = 38, PAD_R = 16, PAD_T = 14, PAD_B = 24;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const ratios = result.ratios_by_year.map((r) => r.ratio_pct);
  const yMin = Math.min(...ratios) - 10;
  const yMax = Math.max(...ratios) + 10;
  const xFor = (i: number) => PAD_L + (i / Math.max(ratios.length - 1, 1)) * innerW;
  const yFor = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const path = ratios.map((r, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(r)}`).join(' ');
  const trough = Math.min(...ratios);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* 175% appetite floor */}
      {175 > yMin && 175 < yMax && (
        <g>
          <line x1={PAD_L} y1={yFor(175)} x2={W - PAD_R} y2={yFor(175)} stroke="#fbbf24" strokeWidth={1} strokeDasharray="4 3" />
          <text x={W - PAD_R - 4} y={yFor(175) - 4} fontSize={9} fill="#92400e" textAnchor="end">175% appetite</text>
        </g>
      )}
      <path d={path} fill="none" stroke="#15803d" strokeWidth={2} />
      {ratios.map((r, i) => (
        <g key={i}>
          <circle cx={xFor(i)} cy={yFor(r)} r={3} fill="#15803d" />
          <text x={xFor(i)} y={H - PAD_B + 14} textAnchor="middle" fontSize={10} fill="#475569" fontFamily="ui-monospace, monospace">
            t+{i}y
          </text>
          <text x={xFor(i)} y={yFor(r) - 8} textAnchor="middle" fontSize={9} fontWeight={r === trough ? 700 : 400}
            fill={r === trough ? '#dc2626' : '#475569'} fontFamily="ui-monospace, monospace">
            {r.toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

function RunStage({ label, delay }: { label: string; delay: number }) {
  const [stage, setStage] = useState<'pending' | 'active' | 'done'>('pending');
  useEffect(() => {
    const a = window.setTimeout(() => setStage('active'), delay);
    const b = window.setTimeout(() => setStage('done'), delay + 5000);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [delay]);
  return (
    <div className="flex items-center gap-2 text-xs">
      {stage === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200" />}
      {stage === 'active' && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />}
      {stage === 'done' && (
        <div className="w-3.5 h-3.5 rounded-full bg-emerald-700 flex items-center justify-center">
          <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <span className={stage === 'pending' ? 'text-gray-400' : stage === 'active' ? 'text-emerald-800 font-semibold' : 'text-gray-700'}>{label}</span>
    </div>
  );
}

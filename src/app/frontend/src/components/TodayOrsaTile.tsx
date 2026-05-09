/**
 * TodayOrsaTile — continuous ORSA reading, paired with the daily solvency tile.
 *
 * Mirrors Scene 7's "refreshed nightly · 02:14" framing. Shows the worst-trough
 * standing stress (the one moving against you) so the audience reads it as the
 * other half of "today's view" — solvency now (Pillar 1) + solvency under
 * stress now (Pillar 2).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Workflow, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { fetchOrsaHistory, type OrsaHistoryScenario } from '../lib/api';

export default function TodayOrsaTile() {
  const [scenarios, setScenarios] = useState<OrsaHistoryScenario[]>([]);

  useEffect(() => {
    fetchOrsaHistory(30).then((r) => setScenarios(r.scenarios)).catch(() => undefined);
  }, []);

  const summary = useMemo(() => {
    if (scenarios.length === 0) return null;
    // For each scenario, take the latest observation's worst (lowest) year-offset>0 ratio.
    // Then pick the scenario with the lowest of those.
    type Row = { sid: string; sname: string; latestTrough: number; thirtyDayDelta: number };
    const rows: Row[] = scenarios.map((s) => {
      const byDate = new Map<string, number>();
      for (const p of s.points) {
        if (p.year_offset === 0) continue;
        const cur = byDate.get(p.observed_date);
        if (cur == null || p.ratio_pct < cur) byDate.set(p.observed_date, p.ratio_pct);
      }
      const dated = Array.from(byDate.entries()).sort(([a], [b]) => a < b ? -1 : 1);
      if (dated.length === 0) return { sid: s.scenario_id, sname: s.scenario_name, latestTrough: 0, thirtyDayDelta: 0 };
      const latestTrough = dated[dated.length - 1][1];
      const earliest = dated[0][1];
      return { sid: s.scenario_id, sname: s.scenario_name, latestTrough, thirtyDayDelta: latestTrough - earliest };
    });
    const worst = rows.reduce((acc, r) => (r.latestTrough < acc.latestTrough ? r : acc), rows[0]);
    return { worst, count: scenarios.length, allRows: rows };
  }, [scenarios]);

  if (!summary) return null;

  const { worst, count } = summary;
  const driftDirection: 'up' | 'down' | 'flat' =
    worst.thirtyDayDelta > 0.5 ? 'up' : worst.thirtyDayDelta < -0.5 ? 'down' : 'flat';
  const DriftIcon = driftDirection === 'down' ? TrendingDown : driftDirection === 'up' ? TrendingUp : Minus;
  const driftCls = driftDirection === 'down'
    ? 'text-rose-300'
    : driftDirection === 'up'
      ? 'text-emerald-300'
      : 'text-slate-300';

  return (
    <Link to="/orsa"
      className="block bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white rounded-xl p-5 shadow-lg hover:shadow-xl transition-shadow group">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-emerald-300">
        <Workflow className="w-3.5 h-3.5" /> Continuous ORSA
        <span className="ml-auto text-[10px] text-emerald-300/70 normal-case tracking-normal">refreshed 02:14</span>
      </div>
      <div className="flex items-baseline gap-3 mt-1.5">
        <span className="text-5xl font-bold tabular-nums tracking-tight">{worst.latestTrough.toFixed(0)}%</span>
        <span className={`inline-flex items-center gap-0.5 text-sm font-semibold ${driftCls}`}>
          <DriftIcon className="w-3.5 h-3.5" />
          {worst.thirtyDayDelta >= 0 ? '+' : ''}{worst.thirtyDayDelta.toFixed(1)}pp
          <span className="text-[10px] opacity-70 ml-1">30d</span>
        </span>
      </div>
      <div className="text-xs text-slate-300 mt-2 flex items-center gap-3">
        <span className="text-slate-200">worst trough · <span className="font-semibold text-white">{worst.sname}</span></span>
        <span className="text-slate-400 ml-auto group-hover:text-emerald-200 transition-colors flex items-center gap-1">
          {count} stresses live
          <span className="text-emerald-300 font-semibold ml-1 group-hover:translate-x-1 transition-transform">→</span>
        </span>
      </div>
    </Link>
  );
}

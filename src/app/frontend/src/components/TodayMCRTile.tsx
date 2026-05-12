/**
 * TodayMCRTile — Minimum Capital Requirement coverage at a glance.
 *
 * Sits alongside the solvency + ORSA tiles on the Control Tower. The
 * supervisor reaction to MCR is materially different from SCR (Article 138
 * trigger; 1-month recovery plan) so it warrants its own headline read.
 *
 * Numbers are consistent with the 210% baseline used across the demo:
 * SCR ≈ EUR 556M · MCR floor = 25%·SCR binds at EUR 139M · MCR-eligible own
 * funds ≈ EUR 1.0B (T1 fully eligible · T2 capped at 20% of MCR · T3 excluded)
 * → coverage ~720%. Click → /pillar-3#mcr for full breakdown.
 */
import { Link } from 'react-router-dom';
import { Anchor, ArrowRight } from 'lucide-react';

const SCR_EUR = 556_000_000;
const LINEAR_MCR_EUR = 105_000_000;
const MCR_FLOOR = SCR_EUR * 0.25;
const MCR_CAP = SCR_EUR * 0.45;
const MCR_EUR = Math.min(MCR_CAP, Math.max(MCR_FLOOR, LINEAR_MCR_EUR));
const ELIGIBLE_OWN_FUNDS_FOR_MCR = 1_000_000_000;
const COVERAGE_RATIO = ELIGIBLE_OWN_FUNDS_FOR_MCR / MCR_EUR;

export default function TodayMCRTile() {
  const coveragePct = Math.round(COVERAGE_RATIO * 100);

  // Bar scale 0% → 800%, with 100% (Art. 138 trigger) marked.
  const maxScale = 8;
  const widthPct = Math.min(Math.max(COVERAGE_RATIO, 0), maxScale) / maxScale * 100;
  const triggerLeftPct = (1 / maxScale) * 100;
  const toneClass =
    COVERAGE_RATIO < 1.0 ? 'bg-rose-500' :
    COVERAGE_RATIO < 1.3 ? 'bg-amber-400' :
    'bg-emerald-400';

  return (
    <Link
      to="/pillar-3#mcr"
      className="block bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white rounded-xl p-5 shadow-lg hover:shadow-xl transition-shadow group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Anchor className="w-4 h-4 text-emerald-300" />
          <span className="text-[11px] uppercase tracking-widest font-bold text-emerald-300">MCR coverage</span>
        </div>
        <span className="text-[10px] text-emerald-200 inline-flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          Article 138 view <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold tracking-tight">{coveragePct}%</span>
        <span className="text-xs text-emerald-200 font-mono">
          EUR {(ELIGIBLE_OWN_FUNDS_FOR_MCR / 1e6).toFixed(0)}M / EUR {(MCR_EUR / 1e6).toFixed(0)}M
        </span>
      </div>

      <div className="mt-3">
        <div className="h-2 bg-white/10 rounded-full overflow-hidden relative">
          <div className={`h-full ${toneClass} transition-all`} style={{ width: `${widthPct}%` }} />
          <div className="absolute top-0 bottom-0 border-l-2 border-amber-400" style={{ left: `${triggerLeftPct}%` }} title="Art. 138 trigger" />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-emerald-200/70 mt-1">
          <span>0%</span>
          <span className="text-amber-300">100% — Art. 138</span>
          <span>800%</span>
        </div>
      </div>

      <p className="text-[11px] text-emerald-200/90 mt-2 leading-snug">
        Floor binding (linear MCR EUR {(LINEAR_MCR_EUR / 1e6).toFixed(0)}M &lt; 25%·SCR). No breach risk — coverage well above the 130% attention threshold.
      </p>
    </Link>
  );
}

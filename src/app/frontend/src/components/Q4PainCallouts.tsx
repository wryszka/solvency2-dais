/**
 * Q4 2025 attention items — fired by /api/monitoring/q4-pains.
 *
 * Displayed prominently on Control Tower Overview so on Monday morning the
 * 6 engineered Q4 pains are immediately visible:
 *   A. Late RI feed
 *   B. Quarantined claims (DQ break)
 *   C. December storm — property reserve spike
 *   D. Life lapse deterioration
 *   E. €2.3M reconciliation gap
 *   F. Challenger model pending decision
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, AlertCircle, Clock, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { fetchQ4Pains, type Q4Pain, type PainSeverity } from '../lib/api';

const SEVERITY_VARIANT: Record<PainSeverity, { Icon: React.ComponentType<{ className?: string }>; cardCls: string; iconCls: string; label: string }> = {
  high: { Icon: AlertCircle,    cardCls: 'border-red-300 bg-red-50',     iconCls: 'text-red-600',   label: 'high' },
  warn: { Icon: AlertTriangle,  cardCls: 'border-amber-300 bg-amber-50', iconCls: 'text-amber-600', label: 'warn' },
  ok:   { Icon: CheckCircle2,   cardCls: 'border-green-200 bg-green-50/60', iconCls: 'text-green-600', label: 'ok' },
};

export default function Q4PainCallouts() {
  const navigate = useNavigate();
  const [pains, setPains] = useState<Q4Pain[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQ4Pains()
      .then((r) => setPains(r.pains))
      .catch(() => setPains([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (pains.length === 0) return null;

  const fired = pains.filter((p) => p.fired);
  const okCount = pains.length - fired.length;

  return (
    <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
        <Clock className="w-4 h-4 text-gray-700" />
        <h3 className="text-sm font-bold text-gray-800">Attention items — current period</h3>
        <span className="ml-auto text-[11px] text-gray-500">
          {fired.length} firing
          {okCount > 0 && <span className="text-green-700"> · {okCount} clean</span>}
        </span>
      </header>
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        {pains.map((pain) => {
          const v = SEVERITY_VARIANT[pain.severity];
          return (
            <button
              key={pain.id}
              onClick={() => navigate(pain.drill_path, { state: {
                crumbs: [
                  { label: 'Today', to: '/today' },
                  { label: 'Control Tower', to: '/monitor' },
                  { label: `Pain ${pain.id} — ${pain.title}` },
                ],
              }})}
              className={`text-left flex items-start gap-3 p-3 rounded-md border transition-shadow hover:shadow-sm ${v.cardCls}`}
            >
              <v.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${v.iconCls}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white/60 rounded border border-current/20 text-gray-700">
                    Pain {pain.id}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 truncate">{pain.title}</span>
                </div>
                <div className="text-xs text-gray-700 mt-1">{pain.headline}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400 mt-1 shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

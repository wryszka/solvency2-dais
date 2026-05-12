/**
 * Today door — operational view.
 *
 * The page someone opens daily. Wraps the existing Control Tower, then adds
 * recent-activity quick-link panels (recent overlays + pending promotions)
 * to make "what's happening right now" visible at a glance.
 *
 * Pillar artefacts (SCR, ORSA, etc.) are NOT in the left nav anymore — when
 * Today surfaces a blocked QRT or a pending overlay, it links into the
 * artefact directly with breadcrumbs that say "Today › Control Tower › …".
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Clock, ChevronRight, Zap, Sparkles, Activity } from 'lucide-react';
import Monitor from './Monitor';
import TodaySolvencyTile from '../components/TodaySolvencyTile';
import TodayOrsaTile from '../components/TodayOrsaTile';
import TodayMCRTile from '../components/TodayMCRTile';
import {
  fetchOverlays, fetchLabModels, formatEur,
  type Overlay, type LabModelRow,
} from '../lib/api';

export default function Today() {
  return (
    <div>
      <header className="max-w-6xl mx-auto px-6 pt-4 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
            <Activity className="w-4 h-4 text-amber-700" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-amber-700 font-bold">Control Tower</div>
            <p className="text-xs text-gray-500">Operational state · quick actions · recent activity</p>
          </div>
        </div>
      </header>

      {/* Headline tiles — three always-on readings: solvency today (SCR) ·
          MCR coverage (Art. 138 floor) · solvency under stress (ORSA) */}
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-4 pb-2">
        <TodaySolvencyTile />
        <TodayMCRTile />
        <TodayOrsaTile />
      </div>

      {/* Monitor (existing Control Tower) is the heart of the page.
          Late feeds are merged into Q4PainCallouts inside the overview tab. */}
      <Monitor />

      {/* Below: quick-link strips that surface what's moving today */}
      <div className="max-w-6xl mx-auto px-6 pb-8 -mt-2">
        <RecentActivityRow />
      </div>
    </div>
  );
}

function RecentActivityRow() {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [models, setModels] = useState<LabModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchOverlays({ quarter: '2025-Q4' }).then((r) => setOverlays(r.overlays.slice(0, 4))).catch(() => undefined),
      fetchLabModels().then((r) => setModels(r.models)).catch(() => undefined),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const pendingPromotions = models.filter((m) => (m.pending_promotions ?? 0) > 0);

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <Panel title="Recent overlays" icon={Layers} accent="violet"
        link={{ label: 'Open Overlays Register', to: '/overlays', crumbs: [{ label: 'Control Tower', to: '/today' }, { label: 'Overlays Register' }] }}
      >
        {overlays.length === 0 ? (
          <Empty msg="No overlays this quarter." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {overlays.map((o) => {
              const mag = parseFloat(String(o.magnitude_eur));
              return (
                <li key={o.overlay_id} className="py-2 flex items-center gap-3 text-xs">
                  <Clock className="w-3 h-3 text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-800">{o.line_of_business}</span>
                  <span className="text-gray-500 truncate">{o.category.replace(/_/g, ' ')}</span>
                  <span className={`ml-auto font-mono font-semibold ${mag >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {mag >= 0 ? '+' : ''}{formatEur(o.magnitude_eur)}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                    o.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    o.status === 'pending_approval' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                  }`}>{o.status === 'pending_approval' ? 'pending' : o.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Pending model promotions" icon={Zap} accent="blue"
        link={{ label: 'Open Actuarial Lab', to: '/lab', crumbs: [{ label: 'Control Tower', to: '/today' }, { label: 'Actuarial Lab' }] }}
      >
        {pendingPromotions.length === 0 ? (
          <Empty msg="No promotions pending." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {pendingPromotions.map((m) => (
              <li key={m.model_id} className="py-2 flex items-center gap-3 text-xs">
                <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
                <span className="font-semibold text-gray-800">{m.label}</span>
                <span className="text-gray-500 font-mono text-[11px]">{m.engine}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  {m.pending_promotions} pending
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function Panel({ title, icon: Icon, accent, link, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>;
  accent: 'violet' | 'blue';
  link?: { label: string; to: string; crumbs: Array<{ label: string; to?: string }> };
  children: React.ReactNode;
}) {
  const cls = accent === 'violet'
    ? { hd: 'bg-violet-50 text-violet-900 border-violet-200', icon: 'text-violet-700' }
    : { hd: 'bg-blue-50 text-blue-900 border-blue-200',     icon: 'text-blue-700' };
  return (
    <article className={`bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col`}>
      <header className={`px-4 py-2.5 border-b ${cls.hd} flex items-center gap-2`}>
        <Icon className={`w-3.5 h-3.5 ${cls.icon}`} />
        <h3 className="text-xs uppercase tracking-wider font-bold">{title}</h3>
        {link && (
          <Link to={link.to}
            state={{ crumbs: link.crumbs }}
            className="ml-auto text-[11px] font-semibold opacity-80 hover:opacity-100 inline-flex items-center gap-0.5">
            {link.label} <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </header>
      <div className="px-4 py-2 flex-1">{children}</div>
    </article>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-xs text-gray-400 italic py-3 text-center">{msg}</div>;
}

/**
 * Attention items — current period.
 *
 * Merges two sources into a single grid:
 *   1. /api/monitoring/q4-pains — the engineered Pain A-G items
 *   2. /api/demo/feeds — any late feeds (Scene 3's ABN AMRO custodian)
 *
 * Both render as identical-shape cards; clicking navigates to the relevant
 * detail page. No drawer — same interaction model as the other pains.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, AlertCircle, Clock, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { fetchQ4Pains, fetchDemoFeeds, type Q4Pain, type PainSeverity, type DemoFeed } from '../lib/api';

const SEVERITY_VARIANT: Record<PainSeverity, { Icon: React.ComponentType<{ className?: string }>; cardCls: string; iconCls: string; label: string }> = {
  high: { Icon: AlertCircle,    cardCls: 'border-red-300 bg-red-50',     iconCls: 'text-red-600',   label: 'high' },
  warn: { Icon: AlertTriangle,  cardCls: 'border-amber-300 bg-amber-50', iconCls: 'text-amber-600', label: 'warn' },
  ok:   { Icon: CheckCircle2,   cardCls: 'border-green-200 bg-green-50/60', iconCls: 'text-green-600', label: 'ok' },
};

interface AttentionItem {
  id: string;
  title: string;
  headline: string;
  severity: PainSeverity;
  drill_path: string;
  fired: boolean;
}

function lateFeedToItem(f: DemoFeed): AttentionItem {
  const expected = new Date(f.expected_at).getTime();
  const received = new Date(f.received_at).getTime();
  const ms = Math.max(received - expected, 0);
  const days = Math.floor(ms / 86_400_000);
  const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
  return {
    id: `feed:${f.feed_name}`,
    title: `${f.source_party} custodian feed late`,
    headline: `${f.feed_name} delivered ${days}d ${hrs}h late · contact ${f.owner_contact_name}`,
    severity: 'high',
    drill_path: `/feeds/${encodeURIComponent(f.feed_name)}`,
    fired: true,
  };
}

export default function Q4PainCallouts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchQ4Pains().then((r) => r.pains as Q4Pain[]).catch(() => [] as Q4Pain[]),
      fetchDemoFeeds().then((r) => r.feeds.filter((f) => f.status === 'received_late')).catch(() => [] as DemoFeed[]),
    ]).then(([pains, lateFeeds]) => {
      const fromPains: AttentionItem[] = pains.map((p) => ({
        id: `pain:${p.id}`,
        title: p.title,
        headline: p.headline,
        severity: p.severity,
        drill_path: p.drill_path,
        fired: p.fired,
      }));
      const fromFeeds = lateFeeds.map(lateFeedToItem);
      setItems([...fromFeeds, ...fromPains]);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  const fired = items.filter((p) => p.fired);
  const okCount = items.length - fired.length;

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
        {items.map((it) => {
          const v = SEVERITY_VARIANT[it.severity];
          return (
            <button
              key={it.id}
              onClick={() => navigate(it.drill_path, { state: {
                crumbs: [
                  { label: 'Today', to: '/today' },
                  { label: 'Control Tower', to: '/monitor' },
                  { label: it.title },
                ],
              }})}
              className={`text-left flex items-start gap-3 p-3 rounded-md border transition-shadow hover:shadow-sm ${v.cardCls}`}
            >
              <v.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${v.iconCls}`} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-900 truncate block">{it.title}</span>
                <div className="text-xs text-gray-700 mt-0.5">{it.headline}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400 mt-1 shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Attention items — grouped by category.
 *
 * A Chief Actuary thinks in categories ("what's firing in ingestion, in
 * models, in reconciliation?"), not in eight specific A-H pains. We group
 * the individual /api/monitoring/q4-pains items into 4 categories and
 * render one card per category showing worst severity + count + the most
 * urgent headline + a drill path to the relevant pane.
 *
 * Late demo feeds (Scene 3's ABN AMRO custodian) merge into the Ingestion
 * category — they're the same kind of operational signal.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, ArrowRight,
  Workflow, GitCompare, Beaker, FlaskConical,
} from 'lucide-react';
import { fetchQ4Pains, fetchDemoFeeds, type Q4Pain, type PainSeverity, type DemoFeed, type PainCategory } from '../lib/api';

const SEVERITY_RANK: Record<PainSeverity, number> = { ok: 0, warn: 1, high: 2 };

const SEVERITY_VARIANT: Record<PainSeverity, { Icon: React.ComponentType<{ className?: string }>; cardCls: string; iconCls: string; label: string }> = {
  high: { Icon: AlertCircle,    cardCls: 'border-red-300 bg-red-50',        iconCls: 'text-red-600',   label: 'red' },
  warn: { Icon: AlertTriangle,  cardCls: 'border-amber-300 bg-amber-50',    iconCls: 'text-amber-600', label: 'amber' },
  ok:   { Icon: CheckCircle2,   cardCls: 'border-green-200 bg-green-50/60', iconCls: 'text-green-600', label: 'clean' },
};

interface CategoryDef {
  key: PainCategory;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  drill_path: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'ingestion',        label: 'Ingestion',         Icon: Workflow,    drill_path: '/ingestion' },
  { key: 'model_governance', label: 'Model governance',  Icon: FlaskConical,drill_path: '/lab' },
  { key: 'reconciliation',   label: 'Reconciliation',    Icon: GitCompare,  drill_path: '/reconciliation' },
  { key: 'reserving',        label: 'Reserving',         Icon: Beaker,      drill_path: '/lab' },
];

interface AttentionItem {
  id: string;
  category: PainCategory;
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
    category: 'ingestion',
    title: `${f.source_party} feed late`,
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
        category: p.category,
        title: p.title,
        headline: p.headline,
        severity: p.severity,
        drill_path: p.drill_path,
        fired: p.fired,
      }));
      // Filter to firing only — the audience sees "what's firing", not "what could fire".
      // Scene-3 demo feeds carry the rich broker story and dedupe against pain A by
      // skipping the demo feed when a 1_raw_reinsurance pain is already firing.
      const haveRiPain = pains.some((p) => p.id === 'A' && p.fired);
      const fromFeeds = lateFeeds
        .filter((f) => !(haveRiPain && f.feed_name === '1_raw_reinsurance'))
        .map(lateFeedToItem);
      setItems([...fromFeeds, ...fromPains].filter((it) => it.fired));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  // Group by category; pick severity = worst within category; pick headline
  // from the highest-severity item (tie-break alphabetically by title).
  type Group = {
    cat: CategoryDef;
    items: AttentionItem[];
    severity: PainSeverity;
    top: AttentionItem;
  };
  const groups: Group[] = CATEGORIES.map((cat) => {
    const inCat = items.filter((it) => it.category === cat.key);
    if (inCat.length === 0) return null;
    const severity: PainSeverity = inCat.reduce<PainSeverity>(
      (acc, it) => (SEVERITY_RANK[it.severity] > SEVERITY_RANK[acc] ? it.severity : acc),
      'ok',
    );
    const top = inCat
      .slice()
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
                  || a.title.localeCompare(b.title))[0];
    return { cat, items: inCat, severity, top };
  }).filter((g): g is Group => !!g);

  const firingCount = groups.length;
  const redCount = groups.filter((g) => g.severity === 'high').length;
  const totalItems = items.length;

  return (
    <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
        <Clock className="w-4 h-4 text-gray-700" />
        <h3 className="text-sm font-bold text-gray-800">Attention items — current period</h3>
        <span className="ml-auto text-[11px] text-gray-500">
          {firingCount} {firingCount === 1 ? 'category' : 'categories'} firing · {totalItems} item{totalItems === 1 ? '' : 's'}
          {redCount > 0 && <span className="text-red-700"> · {redCount} red</span>}
        </span>
      </header>
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        {groups.map((g) => {
          const v = SEVERITY_VARIANT[g.severity];
          const CatIcon = g.cat.Icon;
          return (
            <button
              key={g.cat.key}
              onClick={() => navigate(g.cat.drill_path, { state: {
                crumbs: [
                  { label: 'Control Tower', to: '/today' },
                  { label: g.cat.label },
                ],
              }})}
              className={`text-left flex items-start gap-3 p-3 rounded-md border transition-shadow hover:shadow-sm ${v.cardCls}`}
            >
              <CatIcon className={`w-4 h-4 mt-0.5 shrink-0 ${v.iconCls}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">{g.cat.label}</span>
                  <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-white/70 text-gray-700">
                    {v.label} · {g.items.length}
                  </span>
                </div>
                <div className="text-xs text-gray-700 mt-0.5">
                  <span className="font-semibold">{g.top.title}.</span> {g.top.headline}
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400 mt-1 shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * LateFeedCallout — Scene 3.
 *
 * Amber callout on Today landing showing the ABN AMRO late custodian feed.
 * Click → drawer with full Janusz Kowalski metadata + downstream cascade.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, X, Mail, MessageCircle, Clock, ChevronRight } from 'lucide-react';
import { fetchDemoFeeds, type DemoFeed } from '../lib/api';

export default function LateFeedCallout() {
  const [feeds, setFeeds] = useState<DemoFeed[]>([]);
  const [drawerFeed, setDrawerFeed] = useState<DemoFeed | null>(null);

  useEffect(() => {
    fetchDemoFeeds().then((r) => setFeeds(r.feeds)).catch(() => undefined);
  }, []);

  const lateFeeds = feeds.filter((f) => f.status === 'received_late');
  if (lateFeeds.length === 0) return null;

  return (
    <>
      {lateFeeds.map((f) => (
        <button key={f.feed_name}
          onClick={() => setDrawerFeed(f)}
          className="w-full text-left bg-amber-50 border-2 border-amber-300 rounded-xl p-4 hover:bg-amber-100/50 transition-colors group">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-800" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] uppercase tracking-widest font-bold text-amber-800">Late feed</span>
                <code className="text-[11px] bg-white border border-amber-200 px-1.5 py-0.5 rounded font-mono text-amber-900">{f.feed_name}</code>
              </div>
              <h4 className="text-base font-bold text-gray-900 leading-tight">
                {f.source_party} custodian — received {humanLate(f.expected_at, f.received_at)} late
              </h4>
              <p className="text-xs text-gray-700 mt-1">
                Owner contact: <span className="font-semibold">{f.owner_contact_name}</span> ({f.owner_contact_role}).
                ETA <span className="font-mono">{niceTime(f.eta_at)}</span>.
                Blocks: <span className="font-mono text-amber-900">{(f.blocks_qrts ?? []).join(', ')}</span>.
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-700 mt-1 group-hover:translate-x-1 transition-transform shrink-0" />
          </div>
        </button>
      ))}

      {drawerFeed && <FeedDrawer feed={drawerFeed} onClose={() => setDrawerFeed(null)} />}
    </>
  );
}

function humanLate(expected: string, received: string): string {
  const ms = new Date(received).getTime() - new Date(expected).getTime();
  if (ms < 0) return 'on time';
  const days = Math.floor(ms / 86_400_000);
  const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${days}d ${hrs}h ${mins}m`;
}

function niceTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

function FeedDrawer({ feed, onClose }: { feed: DemoFeed; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="ml-auto w-full max-w-2xl bg-white shadow-2xl h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-gray-200 flex items-start gap-3 sticky top-0 bg-white z-10">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-800" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900">Feed — {feed.feed_name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{feed.source_party} · {feed.source_system}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </header>

        <div className="p-5 space-y-5 text-sm">
          <section className="grid grid-cols-2 gap-4">
            <Field label="Expected"   value={niceTime(feed.expected_at)} mono />
            <Field label="Received"   value={niceTime(feed.received_at)} mono />
            <Field label="Lateness"   value={humanLate(feed.expected_at, feed.received_at)} mono />
            <Field label="ETA — fully validated" value={niceTime(feed.eta_at)} mono />
            <Field label="Status"     value={feed.status.replace(/_/g, ' ')} />
            <Field label="Recon impact" value={feed.recon_phantom_eur ? `EUR ${Number(feed.recon_phantom_eur).toLocaleString()} phantom break` : '—'} />
          </section>

          <section className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="text-xs uppercase tracking-wider font-bold text-amber-900 mb-2">Owner contact</h4>
            <div className="text-sm font-bold text-gray-900">{feed.owner_contact_name}</div>
            <div className="text-xs text-gray-700">{feed.owner_contact_role}</div>
            <div className="text-xs text-gray-600 font-mono mt-1">{feed.owner_contact_email}</div>
            {feed.last_contact_at && (
              <div className="mt-3 text-xs text-gray-700">
                <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
                Last contact <span className="font-mono">{niceTime(feed.last_contact_at)}</span>
                {feed.last_contact_method && <> · {feed.last_contact_method}</>}
              </div>
            )}
            {feed.last_contact_notes && (
              <p className="text-xs text-gray-600 mt-2 italic leading-relaxed">{feed.last_contact_notes}</p>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-lg p-4">
            <h4 className="text-xs uppercase tracking-wider font-bold text-gray-700 mb-2">Downstream cascade</h4>
            <Cascade label="Blocks QRTs"   items={feed.blocks_qrts ?? []} variant="block" />
            <Cascade label="Stale models"  items={feed.stale_models ?? []} variant="stale" />
          </section>

          {feed.notes && (
            <section className="text-xs text-gray-600 italic leading-relaxed border-t border-gray-100 pt-3">
              {feed.notes}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{label}</div>
      <div className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function Cascade({ label, items, variant }: { label: string; items: string[]; variant: 'block' | 'stale' }) {
  if (items.length === 0) return null;
  const cls = variant === 'block'
    ? 'bg-rose-50 text-rose-800 border-rose-200'
    : 'bg-amber-50 text-amber-800 border-amber-200';
  return (
    <div className="mt-2">
      <div className="text-[11px] text-gray-600 mb-1">{label}:</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <code key={it} className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>{it}</code>
        ))}
      </div>
    </div>
  );
}

// Suppress unused-vars for icons we may want in a future polish pass.
void Mail; void MessageCircle;

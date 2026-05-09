/**
 * FeedDetail — full-page view for a data feed (Scene 3).
 *
 * Same content as the previous LateFeedCallout drawer, but mounted at
 * /feeds/:feedName so attention-item callouts navigate to it the same way
 * Q4 pain items navigate to their target pages.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock, Loader2 } from 'lucide-react';
import { fetchDemoFeed, asArray, type DemoFeed } from '../lib/api';

export default function FeedDetail() {
  const { feedName } = useParams<{ feedName: string }>();
  const [feed, setFeed] = useState<DemoFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!feedName) return;
    setLoading(true);
    fetchDemoFeed(feedName)
      .then((r) => setFeed(r.feed))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [feedName]);

  if (loading) return <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading feed…</div>;
  if (error || !feed) return <div className="p-6 text-sm text-red-700">{error ?? 'Feed not found.'}</div>;

  const isLate = feed.status === 'received_late';
  const headerCls = isLate ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-200';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <Link to="/today" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Today
      </Link>

      <header className={`rounded-xl border-2 ${headerCls} p-5 flex items-start gap-4`}>
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${isLate ? 'bg-amber-200' : 'bg-emerald-200'}`}>
          <AlertTriangle className={`w-5 h-5 ${isLate ? 'text-amber-800' : 'text-emerald-800'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] uppercase tracking-widest font-bold ${isLate ? 'text-amber-800' : 'text-emerald-800'}`}>
              {isLate ? 'Late feed' : 'Feed'}
            </span>
            <code className="text-[11px] bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono text-gray-800">{feed.feed_name}</code>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">
            {feed.source_party} custodian
            {isLate && <> — received <span className="text-amber-900">{humanLate(feed.expected_at, feed.received_at)}</span> late</>}
          </h2>
          <p className="text-sm text-gray-600 mt-1">{feed.source_system}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Expected"   value={niceTime(feed.expected_at)} mono />
        <Field label="Received"   value={niceTime(feed.received_at)} mono />
        <Field label="Lateness"   value={humanLate(feed.expected_at, feed.received_at)} mono />
        <Field label="ETA — fully validated" value={niceTime(feed.eta_at)} mono />
        <Field label="Status"     value={feed.status.replace(/_/g, ' ')} />
        <Field label="Recon impact" value={feed.recon_phantom_eur ? `EUR ${Number(feed.recon_phantom_eur).toLocaleString()} phantom break` : '—'} />
      </div>

      <section className={`rounded-xl border ${isLate ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-200'} p-4`}>
        <h4 className={`text-xs uppercase tracking-wider font-bold mb-2 ${isLate ? 'text-amber-900' : 'text-gray-800'}`}>Owner contact</h4>
        <div className="text-base font-bold text-gray-900">{feed.owner_contact_name}</div>
        <div className="text-sm text-gray-700">{feed.owner_contact_role}</div>
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

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h4 className="text-xs uppercase tracking-wider font-bold text-gray-700 mb-2">Downstream cascade</h4>
        <Cascade label="Blocks QRTs"  items={asArray<string>(feed.blocks_qrts)} variant="block" />
        <Cascade label="Stale models" items={asArray<string>(feed.stale_models)} variant="stale" />
      </section>

      {feed.notes && (
        <section className="text-xs text-gray-600 italic leading-relaxed border-t border-gray-100 pt-3">
          {feed.notes}
        </section>
      )}
    </div>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded p-2.5">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{label}</div>
      <div className={`text-sm text-gray-900 mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</div>
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

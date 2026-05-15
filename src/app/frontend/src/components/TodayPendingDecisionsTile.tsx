/**
 * TodayPendingDecisionsTile — what's awaiting a human decision today.
 *
 * Aggregates pending overlays + pending model promotions for the current
 * quarter, names the most urgent item, and clicks through to the Overlays
 * Register filtered to pending_approval. Replaces the MCR coverage tile in
 * the Control Tower header — MCR moves to the Monitor Overview tab where it
 * belongs as quarterly reference material.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, ArrowRight } from 'lucide-react';
import { fetchOverlays, fetchLabModels, type Overlay, type LabModelRow } from '../lib/api';

const QUARTER = '2025-Q4';

export default function TodayPendingDecisionsTile() {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [models, setModels] = useState<LabModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchOverlays({ quarter: QUARTER }).then((r) => setOverlays(r.overlays || [])).catch(() => undefined),
      fetchLabModels().then((r) => setModels(r.models || [])).catch(() => undefined),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950 text-white rounded-xl p-5 shadow-lg min-h-[140px]" />
    );
  }

  const pendingOverlays = overlays.filter((o) => o.status === 'pending_approval');
  const pendingModels = models.filter((m) => (m.pending_promotions ?? 0) > 0);
  const total = pendingOverlays.length + pendingModels.length;

  const mostUrgent = mostUrgentItem(pendingOverlays, pendingModels);

  return (
    <Link
      to="/overlays?status=pending_approval"
      className="block bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950 text-white rounded-xl p-5 shadow-lg hover:shadow-xl transition-shadow group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-amber-300" />
          <span className="text-[11px] uppercase tracking-widest font-bold text-amber-300">Pending decisions</span>
        </div>
        <span className="text-[10px] text-amber-200 inline-flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          Open queue <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-bold tabular-nums tracking-tight">{total}</span>
        <span className="text-xs text-amber-200 font-mono">
          {pendingOverlays.length} overlay{pendingOverlays.length === 1 ? '' : 's'}
          {' · '}
          {pendingModels.length} model{pendingModels.length === 1 ? '' : 's'}
        </span>
      </div>

      {mostUrgent ? (
        <p className="text-[11px] text-amber-200/90 mt-3 leading-snug">
          <span className="font-semibold">Most urgent:</span> {mostUrgent.label}
          {mostUrgent.owner && <span className="text-amber-200/70"> · {mostUrgent.owner}</span>}
        </p>
      ) : (
        <p className="text-[11px] text-amber-200/70 mt-3 leading-snug">
          No items in the queue. Nothing waiting on a human signature.
        </p>
      )}
    </Link>
  );
}

interface UrgentItem {
  label: string;
  owner?: string;
}

function mostUrgentItem(overlays: Overlay[], models: LabModelRow[]): UrgentItem | null {
  // Heuristic: highest-magnitude overlay first; if none, name the model with the
  // most pending promotions. Real production would sort by oldest age + criticality.
  if (overlays.length > 0) {
    const top = [...overlays].sort(
      (a, b) => Math.abs(Number(b.magnitude_eur || 0)) - Math.abs(Number(a.magnitude_eur || 0)),
    )[0];
    const eurM = (Math.abs(Number(top.magnitude_eur || 0)) / 1e6).toFixed(1);
    return {
      label: `${top.line_of_business} overlay (EUR ${eurM}M)`,
      owner: top.author ?? undefined,
    };
  }
  if (models.length > 0) {
    const top = models[0];
    return {
      label: `${top.model_id} promotion`,
      owner: undefined,
    };
  }
  return null;
}

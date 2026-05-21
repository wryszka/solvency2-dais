/**
 * ReadinessPanel — per-QRT readiness grid for the current in-progress period.
 *
 * Five rows × four cells (Data / Models / Recon / Sign-off) with status icons
 * and hover tooltips. Click any row → opens the QRT detail page with current
 * period selected. Reads SLA + governance + recon state and derives status.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, AlertTriangle, AlertCircle, Loader2, ChevronRight,
} from 'lucide-react';
import {
  fetchSlaStatus, fetchReconciliation, fetchLabModels, fetchSfChallenger,
  type Row, type LabModelRow, type DemoSfChallenger,
} from '../lib/api';

type Status = 'ok' | 'warn' | 'error' | 'neutral';

interface CellState { status: Status; label: string; tooltip: string }
interface QrtRow {
  qrt_id: string;
  qrt_name: string;
  data: CellState;
  models: CellState;
  recon: CellState;
  signoff: CellState;
}

const QRTS = [
  { id: 's0501', name: 'S.05.01', title: 'Premiums, Claims & Expenses' },
  { id: 's0602', name: 'S.06.02', title: 'List of Assets' },
  { id: 's1201', name: 'S.12.01', title: 'Life Technical Provisions' },
  { id: 's2501', name: 'S.25.01', title: 'SCR — Standard Formula' },
  { id: 's2606', name: 'S.26.06', title: 'Non-Life Underwriting Risk' },
];

// Which feeds drive which QRTs (curated, mirrors the lineage map).
// Names match the SLA-status table's feed_name column (1_raw_*).
const QRT_FEEDS: Record<string, string[]> = {
  s0501: ['1_raw_premiums', '1_raw_claims', '1_raw_expenses'],
  s0602: ['1_raw_assets'],
  s1201: ['1_raw_life_policies', '1_raw_life_claims'],
  s2501: ['1_raw_assets', '1_raw_claims', '1_raw_risk_factors', '1_raw_reinsurance'],
  s2606: ['1_raw_exposures', '1_raw_claims', '1_raw_reinsurance'],
};

const QRT_MODELS: Record<string, string[]> = {
  s0501: ['reserving_pnc'],
  s0602: [],
  s1201: ['reserving_life', 'prophet_life'],
  s2501: ['standard_formula', 'igloo_cat', 'prophet_life'],
  s2606: ['reserving_pnc', 'igloo_cat'],
};

export default function ReadinessPanel() {
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState<Row[]>([]);
  const [recon, setRecon] = useState<Row[]>([]);
  const [models, setModels] = useState<LabModelRow[]>([]);
  const [challenger, setChallenger] = useState<DemoSfChallenger | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchSlaStatus().then((r) => r.data).catch(() => []),
      fetchReconciliation().then((r) => r.data).catch(() => []),
      fetchLabModels().then((r) => r.models).catch(() => []),
      fetchSfChallenger().then((r) => r.challenger).catch(() => null),
    ]).then(([f, r, m, c]) => {
      setFeeds(f); setRecon(r); setModels(m); setChallenger(c);
    }).finally(() => setLoading(false));
  }, []);

  const rows = useMemo<QrtRow[]>(() => {
    return QRTS.map((q) => {
      // Data status: any required feed late or DQ-flagged?
      const required = QRT_FEEDS[q.id] ?? [];
      const lateFeeds = required.filter((fn) => {
        const f = feeds.find((ff) => ff.feed_name === fn);
        return f && f.status === 'late';
      });
      const dqFeeds = required.filter((fn) => {
        const f = feeds.find((ff) => ff.feed_name === fn);
        return f && parseFloat(String(f.dq_pass_rate ?? '1')) < 0.98;
      });
      const data: CellState = lateFeeds.length > 0
        ? { status: 'error', label: 'Late feed', tooltip: `${lateFeeds.length} feed(s) late: ${lateFeeds.join(', ')}` }
        : dqFeeds.length > 0
          ? { status: 'warn', label: 'DQ issue', tooltip: `DQ pass rate <98%: ${dqFeeds.join(', ')}` }
          : { status: 'ok', label: 'Ready', tooltip: 'All required feeds received on time' };

      // Models status: any model has pending promotions?
      const reqModels = QRT_MODELS[q.id] ?? [];
      let modelStatus: CellState = { status: 'neutral', label: '—', tooltip: 'No models in path' };
      if (reqModels.length > 0) {
        const sfPending = reqModels.includes('standard_formula') && challenger?.current_state === 'pending_approval';
        const stochasticPending = reqModels.some((m) => m === 'igloo_cat' || m === 'prophet_life');
        const pending = models.find((m) => reqModels.includes(m.model_id) && (m.pending_promotions ?? 0) > 0);
        if (sfPending) {
          modelStatus = { status: 'warn', label: 'Challenger pending', tooltip: 'SF Challenger v2.2 awaiting approval' };
        } else if (stochasticPending && q.id === 's2606') {
          modelStatus = { status: 'warn', label: 'Awaiting review', tooltip: 'Igloo cat candidate awaiting actuarial review' };
        } else if (pending) {
          modelStatus = { status: 'warn', label: 'Promotion pending', tooltip: `${pending.model_id} candidate awaiting sign-off` };
        } else {
          modelStatus = { status: 'ok', label: 'Production live', tooltip: 'All required models on production alias' };
        }
      }

      // Recon status: cross-QRT recon for this qrt
      const qrtNameUpper = q.name;
      const reconRows = recon.filter((r) => r.source_qrt === qrtNameUpper || r.target_qrt === qrtNameUpper);
      const reconBad = reconRows.find((r) => r.status === 'MISMATCH');
      const reconCell: CellState = reconBad
        ? { status: 'error', label: 'Mismatch', tooltip: `${reconBad.check_name}: ${reconBad.check_description?.slice(0, 80) ?? ''}` }
        : reconRows.length > 0
          ? { status: 'ok', label: 'Match', tooltip: `${reconRows.length} cross-QRT checks passing` }
          : { status: 'neutral', label: '—', tooltip: 'No cross-QRT recon defined' };

      // Sign-off: derived from data + models + recon (any error → blocked, any warn → pending, all ok → done)
      const states = [data.status, modelStatus.status, reconCell.status];
      let signoff: CellState;
      if (states.includes('error')) {
        signoff = { status: 'error', label: 'Blocked', tooltip: 'Upstream blocker — see flagged cell' };
      } else if (states.includes('warn')) {
        signoff = { status: 'warn', label: 'Pending', tooltip: 'Awaiting upstream approval' };
      } else if (states.every((s) => s === 'ok' || s === 'neutral')) {
        signoff = { status: 'ok', label: 'Done', tooltip: 'Sign-off recorded' };
      } else {
        signoff = { status: 'neutral', label: '—', tooltip: '' };
      }

      return { qrt_id: q.id, qrt_name: q.name, data, models: modelStatus, recon: reconCell, signoff };
    });
  }, [feeds, recon, models, challenger]);

  if (loading) {
    return <div className="text-xs text-gray-500"><Loader2 className="w-3 h-3 inline animate-spin" /> loading readiness…</div>;
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
        <h3 className="text-sm font-bold text-gray-800">Per-QRT readiness — current period</h3>
        <span className="ml-auto text-[11px] text-gray-500">5 QRTs · click any row to open</span>
      </header>
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="text-left px-4 py-2">QRT</th>
            <th className="text-left px-4 py-2 w-44">Data</th>
            <th className="text-left px-4 py-2 w-44">Models</th>
            <th className="text-left px-4 py-2 w-40">Recon</th>
            <th className="text-left px-4 py-2 w-32">Sign-off</th>
            <th className="px-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.qrt_id}
              onClick={() => navigate(`/report/${r.qrt_id}`, { state: { crumbs: [
                { label: 'Control Tower', to: '/today' },
                { label: r.qrt_name },
              ]}})}
              className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-2.5 font-mono text-xs font-bold text-gray-800">{r.qrt_name}</td>
              <Cell cell={r.data} />
              <Cell cell={r.models} />
              <Cell cell={r.recon} />
              <Cell cell={r.signoff} />
              <td className="px-2 py-2.5 text-right"><ChevronRight className="w-3.5 h-3.5 text-gray-300" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Cell({ cell }: { cell: CellState }) {
  const cfg = {
    ok:      { Icon: CheckCircle2,   cls: 'text-emerald-600' },
    warn:    { Icon: AlertTriangle,  cls: 'text-amber-600' },
    error:   { Icon: AlertCircle,    cls: 'text-red-600' },
    neutral: { Icon: () => <span className="text-gray-300">—</span>, cls: 'text-gray-400' },
  }[cell.status];
  const Icon = cfg.Icon;
  return (
    <td className="px-4 py-2.5">
      <span className={`inline-flex items-center gap-1.5 text-xs ${cfg.cls}`} title={cell.tooltip}>
        <Icon className="w-3.5 h-3.5" />
        {cell.label}
      </span>
    </td>
  );
}

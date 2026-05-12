/**
 * Submissions Archive — Q4 2025 Phase 5 narrative.
 *
 * Reads from /api/demo/archive/submissions. Each row is one (period, doc).
 * Three actions per row:
 *   - Download PDF       → /api/demo/archive/pdf/{period}/{qrt} (generated on demand)
 *   - View detail        → opens the QRT page (existing /report/:qrtId pattern)
 *   - View as-of         → same QRT page but with the period's audit snapshot
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Archive as ArchiveIcon, Download, ExternalLink, Search, Filter,
  CheckCircle2, Clock, Eye, ArrowRight,
} from 'lucide-react';
import { fetchArchiveSubmissions, archivePdfUrl, type ArchiveSubmission } from '../lib/api';
import { Skeleton, SkeletonTable } from '../components/Skeleton';

const QRT_TO_REPORT_ID: Record<string, string> = {
  'S.05.01': 's0501',
  'S.06.02': 's0602',
  'S.12.01': 's1201',
  'S.25.01': 's2501',
  'S.26.06': 's2606',
};

export default function Archive() {
  const [rows, setRows] = useState<ArchiveSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [qrtFilter, setQrtFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchArchiveSubmissions()
      .then((r) => setRows(r.submissions))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const periods = useMemo(() => Array.from(new Set(rows.map((r) => r.period))).sort().reverse(), [rows]);
  const qrts = useMemo(() => Array.from(new Set(rows.map((r) => r.qrt))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (periodFilter !== 'all' && r.period !== periodFilter) return false;
      if (qrtFilter !== 'all' && r.qrt !== qrtFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !(
        (r.submitted_by ?? '').toLowerCase().includes(q) ||
        (r.reviewed_by ?? '').toLowerCase().includes(q) ||
        r.qrt.toLowerCase().includes(q) ||
        r.qrt_title.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [rows, periodFilter, qrtFilter, statusFilter, search]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      <header className="flex items-start gap-3">
        <ArchiveIcon className="w-6 h-6 text-amber-700 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Submissions Archive</h2>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            Every QRT, SFCR, RSR and ORSA submission. Click a row to download the PDF, open the
            QRT detail, or open the as-of audit panel for that period.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/pillar-3#restatement"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 px-2 py-1 rounded border border-amber-200 bg-amber-50/50">
              Restatement workflow — when a prior submission needs amending <ArrowRight className="w-3 h-3" />
            </Link>
            <Link to="/pillar-3#evr"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 px-2 py-1 rounded border border-amber-200 bg-amber-50/50">
              EIOPA validation rules — the gate before submission <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-gray-500" />
        <FilterSelect label="Period" value={periodFilter} onChange={setPeriodFilter} options={['all', ...periods]} />
        <FilterSelect label="QRT"    value={qrtFilter}    onChange={setQrtFilter}    options={['all', ...qrts]} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={['all', 'submitted', 'in_progress']} />
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search submitter, reviewer, QRT…"
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <button onClick={() => { setPeriodFilter('all'); setQrtFilter('all'); setStatusFilter('all'); setSearch(''); }}
          className="text-[11px] text-gray-500 hover:text-gray-800">reset</button>
        <span className="ml-auto text-xs text-gray-500 font-mono">{filtered.length} of {rows.length}</span>
      </section>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <SkeletonTable rows={8} cols={6} />
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Document</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Submitted</th>
                <th className="text-left px-3 py-2">Reviewer</th>
                <th className="text-left px-3 py-2">Cycle</th>
                <th className="text-left px-3 py-2">DQ</th>
                <th className="text-left px-3 py-2">Feeds</th>
                <th className="text-left px-3 py-2">Headline</th>
                <th className="text-left px-3 py-2 w-44">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-xs text-gray-400 italic">
                  No submissions match these filters.
                </td></tr>
              )}
              {filtered.map((r) => (
                <Row key={`${r.period}-${r.qrt}`} r={r} navigate={navigate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 italic mt-2 text-center">
        PDFs are generated on demand from the canonical QRT tables — every download reflects what's
        currently in Unity Catalog for the chosen period.
      </p>
    </div>
  );
}

function Row({ r, navigate }: { r: ArchiveSubmission; navigate: ReturnType<typeof useNavigate> }) {
  const isInProgress = r.status === 'in_progress';
  const reportId = QRT_TO_REPORT_ID[r.qrt];

  function viewDetail() {
    if (!reportId) return;
    navigate(`/report/${reportId}`, { state: {
      crumbs: [
        { label: 'Submissions Archive', to: '/archive' },
        { label: r.period },
        { label: r.qrt },
      ],
    }});
  }

  function viewAsOf() {
    if (!reportId) return;
    navigate(`/report/${reportId}?period=${encodeURIComponent(r.period)}&audit=1`, { state: {
      crumbs: [
        { label: 'Submissions Archive', to: '/archive' },
        { label: r.period },
        { label: `${r.qrt} (as-of)` },
      ],
    }});
  }

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 align-top">
      <td className="px-3 py-2.5 font-mono text-xs">{r.period}</td>
      <td className="px-3 py-2.5">
        <div className="text-xs font-bold text-gray-800">{r.qrt}</div>
        <div className="text-[11px] text-gray-500 truncate max-w-[220px]" title={r.qrt_title}>{r.qrt_title}</div>
      </td>
      <td className="px-3 py-2.5">
        {isInProgress
          ? <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              <Clock className="w-3 h-3" /> in progress
            </span>
          : <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
              <CheckCircle2 className="w-3 h-3" /> submitted
            </span>}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-gray-500 font-mono">{niceTime(r.submitted_at)}</td>
      <td className="px-3 py-2.5 text-xs text-gray-700 truncate max-w-[140px]" title={r.reviewed_by ?? ''}>
        {r.reviewed_by ?? <span className="text-gray-400 italic">—</span>}
      </td>
      <td className="px-3 py-2.5 text-xs font-mono">{r.cycle_days != null ? `${r.cycle_days}d` : '—'}</td>
      <td className="px-3 py-2.5 text-xs font-mono">{`${parseFloat(String(r.dq_pass_rate)).toFixed(1)}%`}</td>
      <td className="px-3 py-2.5 text-xs font-mono">{r.feeds_complete}</td>
      <td className="px-3 py-2.5">
        <div className="text-[10px] uppercase text-gray-500 font-bold">{r.headline_metric}</div>
        <div className="text-xs font-bold text-gray-900 font-mono">{r.headline_value}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {!isInProgress && (
            <a href={archivePdfUrl(r.period, r.qrt)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 rounded text-[11px] text-gray-700 hover:bg-blue-50 hover:border-blue-300">
              <Download className="w-3 h-3" /> PDF
            </a>
          )}
          {reportId && (
            <button onClick={viewDetail}
              className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 rounded text-[11px] text-gray-700 hover:bg-blue-50 hover:border-blue-300">
              <ExternalLink className="w-3 h-3" /> Detail
            </button>
          )}
          {reportId && !isInProgress && (
            <button onClick={viewAsOf}
              className="inline-flex items-center gap-1 px-2 py-1 border border-violet-200 rounded text-[11px] text-violet-700 hover:bg-violet-50">
              <Eye className="w-3 h-3" /> As-of
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <label className="text-xs flex items-center gap-1.5">
      <span className="text-gray-600">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-xs bg-white">
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === 'all' ? 'all' : opt.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function niceTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

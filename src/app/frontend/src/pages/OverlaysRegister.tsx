/**
 * Overlays Register — Actuarial Lab page.
 *
 * Each row in `6_gov_overlays` is one judgement applied to a model output for
 * a quarter. The register is the system of record for actuarial overlays:
 * who applied what, why, when, approved by whom, and which QRT cells it
 * affects (lineage).
 *
 * Surfaces three views in a single page:
 *  - List (filterable + summary tiles at top)
 *  - Detail drawer (clicked overlay)
 *  - New overlay form
 *
 * The Senior Reserving Actuary agent can pre-fill this form via deep link
 * from the reserving model detail page; the form is the only path to an
 * `INSERT` against `6_gov_overlays`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, AlertTriangle, Plus, CheckCircle2, Clock, XCircle, ArrowRightLeft, Filter } from 'lucide-react';
import PillarChip from '../components/PillarChip';
import {
  fetchOverlays, fetchOverlaySummary, approveOverlay, retireOverlay, createOverlay,
  formatEur, asArray,
  type Overlay, type OverlaySummary, type OverlayCreate,
} from '../lib/api';
import { useLocation, useNavigate } from 'react-router-dom';

const QUARTERS = ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1'];
const STATUSES = ['draft', 'pending_approval', 'approved', 'retired'];
const CATEGORIES = ['one_off_event', 'methodology_judgement', 'data_correction', 'tail_extension', 'expert_judgement_other'];
const LOBS = ['property', 'motor_liability', 'general_liability', 'credit_suretyship', 'life_unit_linked', 'life_with_profits', 'life_protection'];
const MODELS = ['reserving_pnc', 'reserving_life', 'standard_formula'];

function statusChip(status: string) {
  const cls = status === 'approved' ? 'bg-green-100 text-green-700 border-green-200'
    : status === 'pending_approval' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : status === 'draft' ? 'bg-gray-100 text-gray-700 border-gray-200'
    : 'bg-red-50 text-red-700 border-red-200';
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function lifecycleBadge(action: string) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: 'New', cls: 'bg-blue-50 text-blue-700' },
    renewed_from_prior: { label: 'Renewed', cls: 'bg-violet-50 text-violet-700' },
    modified_from_prior: { label: 'Modified', cls: 'bg-amber-50 text-amber-700' },
    retired: { label: 'Retired', cls: 'bg-gray-100 text-gray-600' },
  };
  const m = map[action] ?? { label: action, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}

export default function OverlaysRegister() {
  const navigate = useNavigate();
  const location = useLocation();
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [summary, setSummary] = useState<OverlaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterQuarter, setFilterQuarter] = useState<string>('2025-Q4');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterLob, setFilterLob] = useState<string>('');
  const [filterModel, setFilterModel] = useState<string>('');
  // Deep-linked cell-prefix filter (?cell=s2501. from artefact connections panel)
  const [filterCellPrefix, setFilterCellPrefix] = useState<string>('');
  const [selected, setSelected] = useState<Overlay | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        fetchOverlays({
          quarter: filterQuarter || undefined,
          status: filterStatus || undefined,
          line_of_business: filterLob || undefined,
          model_name: filterModel || undefined,
        }),
        fetchOverlaySummary(filterQuarter || undefined),
      ]);
      setOverlays(o.overlays);
      setSummary(s);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
            [filterQuarter, filterStatus, filterLob, filterModel]);

  // Deep-link: /overlays?new=1 with optional pre-fill query string opens the new-overlay form
  // Deep-link: /overlays?cell=s2501.  applies a cell-prefix filter so connections panels can
  // land you on an artefact-scoped view.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('new') === '1') setShowNew(true);
    const cell = params.get('cell');
    setFilterCellPrefix(cell ? cell : '');
  }, [location.search]);

  const visibleOverlays = useMemo(() => {
    if (!filterCellPrefix) return overlays;
    return overlays.filter((o) => {
      const cells = asArray<string>(o.linked_qrt_cells as unknown);
      return cells.some((c) => typeof c === 'string' && c.startsWith(filterCellPrefix));
    });
  }, [overlays, filterCellPrefix]);

  const totals = useMemo(() => {
    if (!summary) return { approved: 0, pending: 0, drafts: 0, magnitude: 0 };
    const get = (s: string) => summary.by_status.find((r) => r.status === s)?.n ?? 0;
    const mag = summary.by_status.reduce((acc, r) => acc + Math.abs(parseFloat(String(r.total_magnitude_eur ?? 0))), 0);
    return {
      approved: Number(get('approved') ?? 0),
      pending:  Number(get('pending_approval') ?? 0),
      drafts:   Number(get('draft') ?? 0),
      magnitude: mag,
    };
  }, [summary]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Layers className="w-6 h-6 text-violet-700 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Overlays Register
            <PillarChip pillar="cross" size="md" />
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Actuarial-judgement overlays applied on top of the production model output.
            Every overlay carries its rationale, author, approver, lifecycle, and the
            QRT cells it affects.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 text-white rounded-md hover:bg-violet-800 text-xs font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> New overlay
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryTile label="Approved" value={totals.approved} icon={CheckCircle2} colour="green" />
        <SummaryTile label="Pending approval" value={totals.pending} icon={Clock} colour="amber" />
        <SummaryTile label="Drafts" value={totals.drafts} icon={Plus} colour="gray" />
        <SummaryTile label="Total magnitude" value={formatEur(totals.magnitude)} icon={ArrowRightLeft} colour="violet" textValue />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-gray-500" />
        <FilterSelect label="Quarter"  value={filterQuarter} onChange={setFilterQuarter} options={['', ...QUARTERS]} />
        <FilterSelect label="Status"   value={filterStatus}  onChange={setFilterStatus}  options={['', ...STATUSES]} />
        <FilterSelect label="LoB"      value={filterLob}     onChange={setFilterLob}     options={['', ...LOBS]} />
        <FilterSelect label="Model"    value={filterModel}   onChange={setFilterModel}   options={['', ...MODELS]} />
        {filterCellPrefix && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-800 bg-violet-100 border border-violet-200 px-2 py-1 rounded">
            cell prefix: <code className="font-mono">{filterCellPrefix}</code>
            <button onClick={() => setFilterCellPrefix('')} className="text-violet-700 hover:text-violet-900 ml-1" title="Clear">
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
        <button
          onClick={() => { setFilterQuarter('2025-Q4'); setFilterStatus(''); setFilterLob(''); setFilterModel(''); setFilterCellPrefix(''); }}
          className="text-xs text-gray-500 hover:text-gray-700 ml-auto"
        >
          reset
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> loading overlays…
        </div>
      ) : overlays.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <Layers className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-700 font-medium">No overlays match these filters.</p>
          <button onClick={() => setShowNew(true)} className="mt-3 text-xs text-violet-700 font-semibold hover:underline">
            Create the first one →
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Quarter</th>
                <th className="text-left px-3 py-2">Model</th>
                <th className="text-left px-3 py-2">LoB</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-right px-3 py-2">Magnitude</th>
                <th className="text-left px-3 py-2">Lifecycle</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Author</th>
              </tr>
            </thead>
            <tbody>
              {visibleOverlays.map((o) => (
                <tr
                  key={o.overlay_id}
                  onClick={() => setSelected(o)}
                  className="border-t border-gray-100 hover:bg-violet-50/30 cursor-pointer"
                >
                  <td className="px-3 py-2 font-mono text-[12px]">{o.quarter}</td>
                  <td className="px-3 py-2">{o.model_name}</td>
                  <td className="px-3 py-2">{o.line_of_business}</td>
                  <td className="px-3 py-2 text-gray-600 text-[12px]">{o.category.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <span className={parseFloat(String(o.magnitude_eur)) >= 0 ? 'text-rose-700' : 'text-emerald-700'}>
                      {parseFloat(String(o.magnitude_eur)) >= 0 ? '+' : ''}{formatEur(o.magnitude_eur)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{lifecycleBadge(o.lifecycle_action)}</td>
                  <td className="px-3 py-2">{statusChip(o.status)}</td>
                  <td className="px-3 py-2 text-[12px] text-gray-500 truncate max-w-[180px]" title={o.author}>{o.author}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <OverlayDetailDrawer
          overlay={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); reload(); }}
        />
      )}

      {showNew && (
        <NewOverlayForm
          initial={parseInitialFromUrl(location.search)}
          onClose={() => { setShowNew(false); navigate('/overlays'); }}
          onCreated={() => { setShowNew(false); navigate('/overlays'); reload(); }}
        />
      )}
    </div>
  );
}

function parseInitialFromUrl(search: string): Partial<OverlayCreate> {
  const p = new URLSearchParams(search);
  const num = (k: string) => { const v = p.get(k); return v ? parseFloat(v) : undefined; };
  return {
    model_name: p.get('model_name') ?? undefined,
    quarter: p.get('quarter') ?? undefined,
    line_of_business: p.get('line_of_business') ?? undefined,
    accident_year: num('accident_year') ?? undefined,
    magnitude_eur: num('magnitude_eur') ?? undefined,
    direction: (p.get('direction') as 'increase' | 'decrease' | null) ?? undefined,
    category: p.get('category') ?? undefined,
    rationale: p.get('rationale') ?? undefined,
  };
}

function SummaryTile({ label, value, icon: Icon, colour, textValue = false }: {
  label: string; value: number | string; icon: React.ComponentType<{ className?: string }>;
  colour: 'green' | 'amber' | 'gray' | 'violet'; textValue?: boolean;
}) {
  const cls = {
    green:  'bg-green-50 border-green-200 text-green-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
    gray:   'bg-gray-50 border-gray-200 text-gray-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
  }[colour];
  return (
    <div className={`border rounded-lg p-3 ${cls}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 opacity-70" />
        <span className="text-[11px] uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <div className={`mt-1 ${textValue ? 'text-lg font-bold font-mono' : 'text-2xl font-bold'}`}>{value}</div>
    </div>
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
        {options.map((opt) => <option key={opt} value={opt}>{opt || 'all'}</option>)}
      </select>
    </label>
  );
}

function OverlayDetailDrawer({ overlay, onClose, onChanged }: {
  overlay: Overlay; onClose: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function approve() {
    if (!confirm('Approve this overlay? It will be flagged as included in the next QRT close.')) return;
    setBusy(true); setErr(null);
    try { await approveOverlay(overlay.overlay_id); onChanged(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  async function retire() {
    if (!confirm('Retire this overlay? It will no longer apply to new QRT calculations.')) return;
    setBusy(true); setErr(null);
    try { await retireOverlay(overlay.overlay_id); onChanged(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  const mag = parseFloat(String(overlay.magnitude_eur));
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="ml-auto w-full max-w-2xl bg-white shadow-xl h-full overflow-y-auto relative" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-gray-200 flex items-start gap-3">
          <Layers className="w-5 h-5 text-violet-700 mt-1" />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">
              Overlay — {overlay.quarter} · {overlay.line_of_business}
            </h3>
            <div className="text-xs text-gray-500 font-mono truncate">{overlay.overlay_id}</div>
          </div>
          <div className="flex items-center gap-2">{statusChip(overlay.status)} {lifecycleBadge(overlay.lifecycle_action)}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><XCircle className="w-5 h-5" /></button>
        </header>

        <div className="p-5 space-y-4 text-sm">
          <Field label="Model"            value={overlay.model_name} />
          <Field label="Category"         value={overlay.category.replace(/_/g, ' ')} />
          <Field label="Direction"        value={overlay.direction} />
          <Field label="Magnitude"        value={`${mag >= 0 ? '+' : ''}${formatEur(mag)}`} mono />
          {overlay.accident_year != null && <Field label="Accident year" value={String(overlay.accident_year)} mono />}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Rationale</div>
            <p className="text-sm text-gray-800 leading-relaxed bg-gray-50 border border-gray-200 rounded p-3">
              {overlay.rationale}
            </p>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Linked QRT cells</div>
            <div className="flex flex-wrap gap-1.5">
              {(() => {
                const cells = asArray<string>(overlay.linked_qrt_cells);
                return cells.length === 0
                  ? <span className="text-xs text-gray-500">none</span>
                  : cells.map((c, i) => (
                      <code key={i} className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 rounded px-1.5 py-0.5">
                        {c}
                      </code>
                    ));
              })()}
            </div>
          </div>
          <Field label="Author"      value={overlay.author} mono small />
          <Field label="Created at"  value={overlay.created_at} mono small />
          {overlay.approver && <Field label="Approver"  value={overlay.approver} mono small />}
          {overlay.approved_at && <Field label="Approved at" value={overlay.approved_at} mono small />}
        </div>

        {err && (
          <div className="mx-5 mb-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{err}</div>
        )}

        <footer className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
          {overlay.status !== 'approved' && overlay.status !== 'retired' && (
            <button onClick={approve} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white rounded-md hover:bg-green-800 disabled:opacity-50 text-xs font-medium">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Approve
            </button>
          )}
          {overlay.status === 'approved' && (
            <button onClick={retire} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-100 disabled:opacity-50 text-xs font-medium">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Retire
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Close</button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold w-32 shrink-0">{label}</span>
      <span className={`text-gray-800 ${mono ? 'font-mono' : ''} ${small ? 'text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function NewOverlayForm({ initial, onClose, onCreated }: {
  initial: Partial<OverlayCreate>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [model, setModel] = useState(initial.model_name ?? 'reserving_pnc');
  const [quarter, setQuarter] = useState(initial.quarter ?? '2025-Q4');
  const [lob, setLob] = useState(initial.line_of_business ?? 'property');
  const [accidentYear, setAccidentYear] = useState<string>(initial.accident_year != null ? String(initial.accident_year) : '');
  const [magnitude, setMagnitude] = useState<string>(initial.magnitude_eur != null ? String(initial.magnitude_eur) : '');
  const [direction, setDirection] = useState<'increase' | 'decrease'>(initial.direction ?? 'increase');
  const [category, setCategory] = useState(initial.category ?? 'one_off_event');
  const [rationale, setRationale] = useState(initial.rationale ?? '');
  const [linkedCellsRaw, setLinkedCellsRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    const mag = parseFloat(magnitude);
    if (isNaN(mag) || mag === 0) { setErr('Magnitude must be a non-zero number'); return; }
    if (rationale.trim().length < 20) { setErr('Rationale should be at least 20 characters — the audit trail needs the why'); return; }

    setBusy(true);
    try {
      await createOverlay({
        model_name: model,
        quarter,
        line_of_business: lob,
        accident_year: accidentYear ? parseInt(accidentYear, 10) : undefined,
        magnitude_eur: direction === 'decrease' ? -Math.abs(mag) : Math.abs(mag),
        direction,
        category,
        rationale: rationale.trim(),
        linked_qrt_cells: linkedCellsRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        lifecycle_action: 'new',
        submit_for_approval: true,
      });
      onCreated();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-gray-200 flex items-start gap-3">
          <Plus className="w-5 h-5 text-violet-700 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">New overlay</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              The rationale is the audit. Be specific — what changed, why now, what data backs the call.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><XCircle className="w-5 h-5" /></button>
        </header>

        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Model">
              <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="Quarter">
              <select value={quarter} onChange={(e) => setQuarter(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </FormField>
            <FormField label="Line of business">
              <select value={lob} onChange={(e) => setLob(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                {LOBS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="Accident year (optional)">
              <input value={accidentYear} onChange={(e) => setAccidentYear(e.target.value)}
                placeholder="e.g. 2023"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </FormField>
            <FormField label="Direction">
              <div className="flex gap-2">
                {(['increase', 'decrease'] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setDirection(d)}
                    className={`flex-1 px-3 py-1.5 rounded border text-xs font-semibold ${
                      direction === d ? 'bg-violet-700 text-white border-violet-700' : 'bg-white text-gray-700 border-gray-300'
                    }`}>{d}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Magnitude (EUR, absolute)">
              <input value={magnitude} onChange={(e) => setMagnitude(e.target.value)}
                placeholder="e.g. 18500000"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono" />
            </FormField>
            <FormField label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </FormField>
          </div>

          <FormField label="Rationale (audit trail — at least 20 chars)">
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)}
              rows={5}
              placeholder="What changed, why now, what data backs the call. The rationale is the audit."
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm leading-relaxed" />
          </FormField>

          <FormField label="Linked QRT cells (one per line or comma-separated)">
            <textarea value={linkedCellsRaw} onChange={(e) => setLinkedCellsRaw(e.target.value)}
              rows={2}
              placeholder="e.g. s0501.R0210.gross_premiums_written:property"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono" />
          </FormField>
        </div>

        {err && (
          <div className="mx-5 mb-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{err}</div>
        )}

        <footer className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 text-white rounded-md hover:bg-violet-800 disabled:opacity-50 text-xs font-medium">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Submit for approval
          </button>
        </footer>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-gray-600 font-semibold block mb-1">{label}</span>
      {children}
    </label>
  );
}

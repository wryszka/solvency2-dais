/**
 * DemoControlsPanel — 3-row sidebar block grouping the controls a presenter
 * touches mid-talk. Each row has a clear label + one-line description on
 * the left and the affordance on the right. Replaces the cramped icon-only
 * row that lived in the sidebar footer.
 */
import { useEffect, useState } from 'react';
import { Radio, Database, RefreshCw, RotateCcw, Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getDemoMode, setDemoMode, type DemoMode } from './DemoModeToggle';
import { invalidateCache, resetDemo } from '../lib/api';

export default function DemoControlsPanel() {
  return (
    <div className="border-t border-white/10 px-3 py-3 space-y-2">
      <AiModeRow />
      <ForceRefreshRow />
      <ResetDemoRow />
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {children}
    </div>
  );
}

function RowLabel({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[11px] font-semibold text-white/85 leading-tight">{title}</div>
      {sub && <div className="text-[10px] text-white/45 leading-tight mt-0.5">{sub}</div>}
    </div>
  );
}

/* ── AI mode toggle (cached vs live) ───────────────────────────────────── */

function AiModeRow() {
  const [mode, setMode] = useState<DemoMode>(getDemoMode());
  useEffect(() => {
    const onChange = (e: Event) => setMode((e as CustomEvent<DemoMode>).detail);
    window.addEventListener('demo-mode-change', onChange);
    return () => window.removeEventListener('demo-mode-change', onChange);
  }, []);
  function flip() {
    setDemoMode(mode === 'live' ? 'cached' : 'live');
  }
  const Icon = mode === 'cached' ? Database : Radio;
  return (
    <Row>
      <RowLabel title="AI mode" />
      <button
        onClick={flip}
        title="Switch between cached and live AI"
        className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border transition-colors ${
          mode === 'cached'
            ? 'text-amber-300 border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20'
            : 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20'
        }`}
      >
        <Icon className="w-3 h-3" />
        {mode === 'cached' ? 'Cached' : 'Live'}
      </button>
    </Row>
  );
}

/* ── Force refresh (clear cache + reload) ──────────────────────────────── */

function ForceRefreshRow() {
  function go() {
    invalidateCache();
    window.location.reload();
  }
  return (
    <Row>
      <RowLabel
        title="Force refresh"
        sub="Clear webpage cache."
      />
      <button
        onClick={go}
        title="Clear cached API data and reload the page"
        className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border border-white/20 text-white/80 hover:bg-white/10 transition-colors"
      >
        <RefreshCw className="w-3 h-3" />
        Refresh
      </button>
    </Row>
  );
}

/* ── Reset demo (rewind to baseline) ───────────────────────────────────── */

function ResetDemoRow() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; actions?: string[]; error?: string } | null>(null);

  async function go() {
    setBusy(true); setResult(null);
    try {
      const r = await resetDemo();
      setResult({ ok: true, actions: r.actions });
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Row>
        <RowLabel title="Reset demo" />
        <button
          onClick={() => { setOpen(true); setResult(null); }}
          title="Restore baseline demo state"
          className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border border-amber-400/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </Row>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !busy && setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <RotateCcw className="w-4 h-4 text-amber-800" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-gray-900">Reset demo state?</h3>
                <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                  This reverts approvals, overlays, ORSA narratives, and what-if runs created during
                  the demo, and rebases all timestamps (late feed, SF Challenger, ORSA history,
                  daily solvency series, ingestion SLA history) to today's date.
                </p>
              </div>
              <button onClick={() => !busy && setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </header>

            {result?.ok && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-2.5 text-xs text-emerald-800 mb-3">
                <div className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Reset complete.</div>
                {result.actions && (
                  <ul className="mt-1.5 space-y-0.5 ml-4 list-disc">
                    {result.actions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                )}
              </div>
            )}
            {result?.error && (
              <div className="bg-red-50 border border-red-200 rounded p-2.5 text-xs text-red-700 mb-3 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {result.error}
              </div>
            )}

            <footer className="flex items-center gap-2 justify-end">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50">
                {result ? 'Close' : 'Cancel'}
              </button>
              {!result && (
                <button onClick={go} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 text-white rounded-md hover:bg-amber-800 disabled:opacity-50 text-xs font-semibold">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  {busy ? 'Resetting…' : 'Reset demo'}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

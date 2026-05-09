/**
 * ResetDemoButton — sidebar footer affordance.
 *
 * Reverts the demo to baseline so the talk can be re-run. Confirms first.
 */
import { useState } from 'react';
import { RotateCcw, Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { resetDemo } from '../lib/api';

export default function ResetDemoButton() {
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
      <button
        onClick={() => { setOpen(true); setResult(null); }}
        title="Reset demo to baseline"
        className="p-1 rounded hover:bg-white/10 transition-colors opacity-40 hover:opacity-100"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>

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
                  the demo to the pre-demo baseline. Continuous solvency + ORSA history are
                  unaffected.
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

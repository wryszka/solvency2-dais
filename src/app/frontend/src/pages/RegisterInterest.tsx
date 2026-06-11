/**
 * RegisterInterest — DAIS booth lead-capture (single-app build).
 *
 * Reached when a visitor clicks any tile that isn't the live Solvency II demo.
 * Shows a clear description of the workflow, then a short form. Submissions
 * POST to /api/demo/interest → a Delta table collected before the DAIS
 * workspace is torn down.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, CheckCircle2, Send, Loader2 } from 'lucide-react';
import { TILES } from '../lib/workbench-tiles';
import linkedinQr from '../assets/linkedin-qr.png';
import pricingShot from '../assets/pricing-screenshot.png';
import claimsShot from '../assets/claims-screenshot.png';

const CONTACT_NAME = 'Laurence';
const CONTACT_EMAIL = 'laurence.ryszka@databricks.com';

// Per-tile preview screenshots (shown at the bottom of the page). More added over time.
const SCREENSHOTS: Record<string, string> = {
  pricing: pricingShot,
  'claims-workbench': claimsShot,
};

export default function RegisterInterest() {
  const [params] = useSearchParams();
  const slug = params.get('tile') || '';
  const tile = useMemo(() => TILES.find((t) => t.slug === slug), [slug]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [interest, setInterest] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (tile) setInterest(`I'd like to see: ${tile.label}`); }, [tile]);

  async function submit() {
    setErr(null);
    if (!name.trim() && !interest.trim()) { setErr('Add your name or what you’d like to see.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/demo/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, organisation: org, interest, tile: tile?.label || slug }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setDone(true);
    } catch (e) {
      setErr(`Couldn’t save — please email ${CONTACT_EMAIL} directly. (${String(e)})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 font-[system-ui]">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <Link to="/" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the workbench
        </Link>

        <header>
          <div className="text-[11px] uppercase tracking-widest text-blue-700 font-bold">Coming soon · register interest</div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">{tile?.label ?? 'Tell us what you’d like to see'}</h1>
          {tile && <p className="text-base text-gray-600 leading-relaxed mt-3">{tile.description}</p>}
          <p className="text-sm text-gray-500 mt-3 leading-relaxed">
            This one isn’t running at the booth today — the live demo here is <strong>Solvency II</strong>.
            Leave your details and your Databricks team will be in touch to walk you through it.
          </p>
        </header>

        {done ? (
          <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <h2 className="text-xl font-bold text-emerald-900 mt-3">Thanks — you’re on the list.</h2>
            <p className="text-sm text-emerald-800 mt-1">Your Databricks team will be in touch.</p>
            <Link to="/" className="inline-block mt-4 text-sm font-bold text-emerald-700 hover:underline">← Back to the workbench</Link>
          </section>
        ) : (
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Your name" value={name} onChange={setName} placeholder="Jane Actuary" autoFocus />
              <Field label="Email" value={email} onChange={setEmail} placeholder="jane@insurer.com" type="email" />
            </div>
            <Field label="Organisation (optional)" value={org} onChange={setOrg} placeholder="Acme Insurance" />
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">What would you like to see?</span>
              <textarea value={interest} onChange={(e) => setInterest(e.target.value)} rows={3}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </label>
            {err && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{err}</div>}
            <button onClick={submit} disabled={busy}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-blue-700 text-white text-sm font-bold hover:bg-blue-800 disabled:opacity-50 transition-colors">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {busy ? 'Saving…' : 'Register interest'}
            </button>
          </section>
        )}

        <div className="bg-slate-900 rounded-xl px-5 py-4 flex items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <Mail className="w-5 h-5 text-blue-300 shrink-0" />
            <div className="text-sm text-slate-200">
              Prefer to reach out directly? Contact <strong className="text-white">{CONTACT_NAME}</strong> —{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-300 hover:underline font-semibold">{CONTACT_EMAIL}</a>
            </div>
          </div>
          <div className="text-center shrink-0">
            <img src={linkedinQr} alt="LinkedIn QR code" width={120} height={120}
              className="w-[120px] h-[120px] rounded-md bg-white p-1.5" />
            <div className="text-[11px] text-slate-300 mt-1.5 font-semibold">Find me on LinkedIn</div>
          </div>
        </div>

        {/* Preview screenshot (per tile) */}
        {slug && SCREENSHOTS[slug] && (
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">A look at it</div>
            <img src={SCREENSHOTS[slug]} alt={`${tile?.label ?? ''} preview`}
              className="w-full rounded-xl border border-gray-200 shadow-sm" />
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', autoFocus = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
    </label>
  );
}

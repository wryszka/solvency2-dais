/**
 * SfChallengerPanel — Scene 4.
 *
 * Renders on the SF model Lab detail page. Surfaces the v2.2 Challenger
 * approval state with Laurence Ryszka as submitter + Sarah Chen as blocked
 * approver + Michael Brandt as the deputy escalation path.
 */
import { useEffect, useState } from 'react';
import { Loader2, Send, AlertTriangle, CheckCircle2, Mail, ArrowRight, UserCheck, Clock } from 'lucide-react';
import { fetchSfChallenger, escalateSfChallenger, promoteSfChallenger, type DemoSfChallenger } from '../lib/api';

export default function SfChallengerPanel() {
  const [c, setC] = useState<DemoSfChallenger | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const r = await fetchSfChallenger();
      setC(r.challenger);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function escalate() {
    setBusy(true); setError(null);
    try { await escalateSfChallenger('Sarah Chen out of office until Wednesday — escalating to deputy.'); await reload(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function promote() {
    if (!confirm('Promote SF Challenger v2.2 to production via Michael Brandt (Deputy Head of Risk Function)?\n\nThis flips the MLflow alias and re-runs the Standard Formula model end-to-end.')) return;
    setBusy(true); setError(null);
    try {
      await promoteSfChallenger('michael');
      await reload();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="text-xs text-gray-500"><Loader2 className="w-3 h-3 inline animate-spin" /> loading challenger…</div>;
  if (!c) return null;

  const isPromoted = c.current_state === 'promoted';
  const isEscalated = c.current_state === 'escalated_to_deputy';

  return (
    <section className={`bg-white border-2 rounded-xl p-5 space-y-4 shadow-sm ${
      isPromoted ? 'border-emerald-300' : isEscalated ? 'border-blue-300' : 'border-amber-300'
    }`}>
      <header className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isPromoted ? 'bg-emerald-100' : isEscalated ? 'bg-blue-100' : 'bg-amber-100'
        }`}>
          {isPromoted
            ? <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            : <AlertTriangle className="w-4 h-4 text-amber-800" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900">SF Challenger {c.challenger_version}</h3>
            <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">{c.calibration_label}</code>
            <StateBadge state={c.current_state} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Submitted by <span className="font-bold text-gray-800">{c.submitted_by}</span>, {c.submitted_role} ·
            <span className="ml-1 font-mono">{niceDate(c.submitted_at)}</span>
          </p>
        </div>
      </header>

      {/* Methodology + impact */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Methodology changes</div>
          <ul className="space-y-1">
            {(c.methodology_changes ?? []).map((m, i) => (
              <li key={i} className="text-xs text-gray-700">· {m}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Impact analysis</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-gray-500 w-24">SCR delta</span>
              <span className="font-mono font-bold text-rose-700">+{Number(c.scr_delta_pct).toFixed(1)}%</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-gray-500 w-24">Solvency</span>
              <span className="font-mono">{Number(c.ratio_before_pct).toFixed(0)}%</span>
              <ArrowRight className="w-3 h-3 text-gray-400" />
              <span className="font-mono font-bold text-amber-700">{Number(c.ratio_after_pct).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Approval chain */}
      <section className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 space-y-2.5">
        <ApproverRow
          label="Approver"
          name={c.approver_name}
          role={c.approver_role}
          status={isPromoted ? 'promoted via deputy' : c.approver_status}
          extra={c.approver_status === 'out_of_office' && c.approver_oo_until
            ? <>Out of office until <span className="font-mono">{c.approver_oo_until}</span> · <span className="font-mono">{c.reminders_sent}</span> reminders sent</>
            : null}
          variant={isPromoted ? 'success' : c.approver_status === 'out_of_office' ? 'warn' : 'neutral'}
        />
        <div className="flex items-center text-[10px] text-gray-400 ml-12 gap-1.5">
          <Mail className="w-3 h-3" /> Last reminder <span className="font-mono">{niceDate(c.last_reminder_at)}</span>
        </div>
        <ApproverRow
          label="Deputy"
          name={c.deputy_name}
          role={c.deputy_role}
          status={isPromoted ? 'signed off' : isEscalated ? 'reviewing' : c.deputy_status}
          variant={isPromoted ? 'success' : isEscalated ? 'active' : 'available'}
        />
      </section>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <footer className="flex items-center gap-2 pt-2 border-t border-gray-100">
        {!isPromoted && !isEscalated && (
          <button onClick={escalate} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-800 disabled:opacity-50 text-xs font-semibold">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            Escalate to deputy ({c.deputy_name})
          </button>
        )}
        {!isPromoted && isEscalated && (
          <button onClick={promote} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-700 text-white rounded-md hover:bg-violet-800 disabled:opacity-50 text-xs font-semibold">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Promote to production
          </button>
        )}
        {isPromoted && (
          <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Promoted at <span className="font-mono">{niceDate(c.promoted_at)}</span> by {c.promoted_by}
          </div>
        )}
        <span className="ml-auto text-[10px] text-gray-400 italic">
          Promotion runs the SF model end-to-end on serverless · 60-120s
        </span>
      </footer>
    </section>
  );
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending_approval:      { cls: 'bg-amber-100 text-amber-800',  label: 'pending approval' },
    escalated_to_deputy:   { cls: 'bg-blue-100  text-blue-800',   label: 'escalated' },
    promoted:              { cls: 'bg-emerald-100 text-emerald-800', label: 'promoted' },
  };
  const v = map[state] ?? { cls: 'bg-gray-100 text-gray-700', label: state };
  return <span className={`text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${v.cls}`}>{v.label}</span>;
}

function ApproverRow({ label, name, role, status, extra, variant }: {
  label: string; name: string; role: string; status: string;
  extra?: React.ReactNode; variant: 'warn' | 'available' | 'active' | 'neutral' | 'success';
}) {
  const cls = {
    warn:      { dot: 'bg-amber-400',    text: 'text-amber-700' },
    available: { dot: 'bg-emerald-400',  text: 'text-emerald-700' },
    active:    { dot: 'bg-blue-400',     text: 'text-blue-700' },
    success:   { dot: 'bg-emerald-500',  text: 'text-emerald-700' },
    neutral:   { dot: 'bg-gray-400',     text: 'text-gray-600' },
  }[variant];
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold text-gray-700">{initials(name)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold w-12 shrink-0">{label}</span>
          <span className="text-sm font-bold text-gray-900">{name}</span>
          <span className="text-xs text-gray-500">— {role}</span>
        </div>
        <div className={`text-xs font-medium ml-14 inline-flex items-center gap-1 ${cls.text}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${cls.dot}`} /> {status}
        </div>
        {extra && <div className="text-[11px] text-gray-500 ml-14 mt-0.5">{extra}</div>}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase();
}

function niceDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

void Clock;

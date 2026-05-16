/**
 * CatAgentPanel — Scene 5.
 *
 * Storm Henrik review. Streams the cat agent's analysis (via useStreamedText),
 * shows the underlying event log + storm-claim numbers as evidence cards
 * alongside.
 */
import { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Wind, RefreshCw, CheckCircle2, Send } from 'lucide-react';
import { renderMarkdownSafe } from '../lib/markdown';
import { useStreamedText } from '../lib/hooks/useStreamedText';
import { fetchCatAgentReview, fetchCatAgentState, approveCatAgent } from '../lib/api';

interface ReviewResponse {
  review: string;
  events: Record<string, unknown>[];
  storm_claims: Record<string, unknown>[];
}

interface AgentState {
  state: 'pending_review' | 'promoted';
  promoted_at?: string;
  promoted_by?: string;
}

export default function CatAgentPanel() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AgentState>({ state: 'pending_review' });
  const [busy, setBusy] = useState(false);
  const { text: streamed, done } = useStreamedText(data?.review, { charsPerTick: 5, tickMs: 16 });

  useEffect(() => {
    fetchCatAgentState().then(setState).catch(() => undefined);
  }, []);

  async function load() {
    setLoading(true); setError(null); setData(null);
    try { setData(await fetchCatAgentReview()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function approve() {
    if (!confirm('Approve Q2 Igloo cat output? This flips the MLflow alias for igloo_cat from candidate → production and logs the promotion in 6_gov_promotions.')) return;
    setBusy(true); setError(null);
    try {
      const r = await approveCatAgent();
      setState({ state: 'promoted', promoted_at: r.approved_at, promoted_by: r.approved_by });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white border-2 border-violet-200 rounded-xl p-5 shadow-sm space-y-4">
      <header className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
          <Wind className="w-4 h-4 text-violet-700" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-gray-900 leading-tight">Cat Modelling Agent</h4>
          <p className="text-[11px] text-gray-500">AI review · cross-references the external event log · proposes accept / re-run / escalate</p>
        </div>
        <button onClick={load} disabled={loading}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            data ? 'border border-violet-300 text-violet-700 hover:bg-violet-50' : 'bg-violet-700 text-white hover:bg-violet-800'
          } disabled:opacity-50`}>
          {loading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : data ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
          {loading ? 'Reviewing…' : data ? 'Re-run review' : 'Run cat review'}
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="bg-violet-50 border border-violet-100 rounded-lg p-4 text-sm text-violet-900 leading-relaxed">
          The agent reads Q4 Igloo output, cross-references the external event log, and recommends
          accept / re-run / escalate. It cites storms by name and dates, and computes a
          loss-to-event-severity ratio against historical comparators. Click <em>Run cat review</em>.
        </div>
      )}

      {loading && (
        <div className="space-y-1.5 text-xs">
          <Stage label="Reading Q4 Igloo output anomalies" delay={0} />
          <Stage label="Cross-referencing external event log" delay={400} />
          <Stage label="Computing loss-to-event-severity ratio" delay={900} />
          <Stage label="Drafting recommendation" delay={1500} />
        </div>
      )}

      {data && (
        <>
          <div className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-800
                          bg-gradient-to-br from-violet-50/50 to-white border border-violet-100 rounded-lg p-4 relative">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(streamed) }} />
            {!done && <span className="inline-block w-2 h-4 bg-violet-700 align-middle ml-0.5 animate-pulse" />}
          </div>

          {/* Approve action — appears after the streaming review finishes. The agent
              recommends; the actuary decides. Promote flips the MLflow alias on
              igloo_cat (candidate → production) and logs a 6_gov_promotions row. */}
          {done && (
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3.5">
              {state.state === 'promoted' ? (
                <div className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  Approved
                  {state.promoted_at && (
                    <span className="text-[11px] text-gray-500 font-mono ml-1">
                      {state.promoted_at.slice(0, 16).replace('T', ' ')} · {state.promoted_by ?? '—'}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex-1 text-xs text-gray-700">
                    Agent recommends <span className="font-semibold">accept</span>. Your call.
                  </div>
                  <button onClick={approve} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-700 text-white rounded-md hover:bg-violet-800 disabled:opacity-50 text-xs font-semibold">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Approve & promote Igloo Q2 → production
                  </button>
                </>
              )}
            </div>
          )}

          {done && data.events.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <EvidenceCard title="External event log" rows={data.events.map((e) => ({
                label: String(e.event_name),
                meta: `${e.start_date} — ${e.end_date} · ${e.region}`,
                detail: `peak ${e.peak_intensity} ${e.peak_intensity_unit}`,
              }))} />
              {data.storm_claims.length > 0 && (
                <EvidenceCard title="Storm-tagged claim activity (Q4)" rows={data.storm_claims.map((c) => ({
                  label: 'Q4 storm-tagged claims',
                  meta: `${c.n} claims · EUR ${c.incurred_meur ?? '0'}M incurred`,
                  detail: 'event_id = storm_dec_2025',
                }))} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stage({ label, delay }: { label: string; delay: number }) {
  const [stage, setStage] = useState<'pending' | 'active' | 'done'>('pending');
  useEffect(() => {
    const a = window.setTimeout(() => setStage('active'), delay);
    const b = window.setTimeout(() => setStage('done'),   delay + 800);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [delay]);
  return (
    <div className="flex items-center gap-2">
      {stage === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200" />}
      {stage === 'active' && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-700" />}
      {stage === 'done' && (
        <div className="w-3.5 h-3.5 rounded-full bg-violet-700 flex items-center justify-center">
          <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <span className={stage === 'pending' ? 'text-gray-400' : stage === 'active' ? 'text-violet-700 font-medium' : 'text-gray-700'}>
        {label}
      </span>
    </div>
  );
}

function EvidenceCard({ title, rows }: { title: string; rows: { label: string; meta: string; detail: string }[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <h5 className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">{title}</h5>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="text-xs">
            <div className="font-bold text-gray-800">{r.label}</div>
            <div className="text-gray-600 font-mono text-[11px]">{r.meta}</div>
            <div className="text-gray-500 italic text-[11px]">{r.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

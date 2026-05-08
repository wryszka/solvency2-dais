/**
 * Senior Reserving Actuary panel — shown on reserving model detail pages.
 *
 * The agent surfaces anomalies in Q4 reserving vs Q3 and proposes overlays.
 * It cannot create overlays — clicking "Create overlay from this suggestion"
 * navigates to the Overlays Register new-overlay form pre-filled with the
 * agent's proposed values, leaving the actuary to edit, justify, and submit.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Loader2, AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import { renderMarkdownSafe } from '../lib/markdown';

interface OverlayProposal {
  model_name: string;
  quarter: string;
  line_of_business: string;
  magnitude_eur: number;
  direction: 'increase' | 'decrease';
  category: string;
  rationale: string;
  accident_year?: number;
}

interface ReviewResponse {
  review: string;
  model_used: string;
  proposals: OverlayProposal[];
}

export default function SeniorReservingPanel() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/agents/reserving/review');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  function deepLinkToNewOverlay(p: OverlayProposal) {
    const params = new URLSearchParams({
      new: '1',
      model_name: p.model_name,
      quarter: p.quarter,
      line_of_business: p.line_of_business,
      magnitude_eur: String(Math.abs(p.magnitude_eur)),
      direction: p.direction,
      category: p.category,
      rationale: p.rationale,
    });
    if (p.accident_year != null) params.append('accident_year', String(p.accident_year));
    navigate(`/overlays?${params.toString()}`);
  }

  return (
    <section className="bg-white border border-violet-200 rounded-lg p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-700" />
        <h4 className="text-sm font-semibold text-gray-900">Senior Reserving Actuary</h4>
        <span className="text-[10px] text-violet-700 uppercase tracking-wide font-semibold">AI</span>
        <button onClick={load} disabled={loading}
          className="ml-auto text-xs text-violet-700 hover:text-violet-900 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {data ? 'Refresh review' : 'Run review'}
        </button>
      </header>

      <p className="text-xs text-gray-600 leading-relaxed">
        Compares the production reserving output for the current quarter against the prior quarter,
        flags material movements, and proposes overlays for the human actuary to review.
        The agent <strong>cannot</strong> create overlays — it can only suggest. You decide.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!data && !loading && !error && (
        <p className="text-xs text-gray-500 italic">Click "Run review" to ask the agent for an analysis.</p>
      )}

      {data && (
        <>
          <div className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded p-3"
            dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(data.review) }} />

          {data.proposals.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs uppercase tracking-wide font-semibold text-gray-600">
                Proposed overlays ({data.proposals.length}) — actuary creates, edits, approves
              </h5>
              {data.proposals.map((p, i) => (
                <div key={i} className="border border-violet-200 rounded p-2.5 bg-violet-50 flex items-start gap-3">
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-gray-900 mb-1">
                      {p.line_of_business} · {p.category.replace(/_/g, ' ')}
                      <span className={`ml-2 font-mono ${p.magnitude_eur >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {p.magnitude_eur >= 0 ? '+' : ''}{Number(p.magnitude_eur).toLocaleString()} EUR
                      </span>
                    </div>
                    <div className="text-gray-700 leading-relaxed">{p.rationale}</div>
                  </div>
                  <button onClick={() => deepLinkToNewOverlay(p)}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 bg-violet-700 text-white rounded text-xs font-semibold hover:bg-violet-800">
                    <Plus className="w-3 h-3" /> Create overlay
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="text-[10px] text-gray-400 italic">
            Generated by {data.model_used}. Review carefully before acting on suggestions.
          </div>
        </>
      )}
    </section>
  );
}

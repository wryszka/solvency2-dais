/**
 * Workbench AI — floating chat overlay on every page.
 *
 * The user types a question; the supervisor classifies it and routes to one of
 * eight specialists (cat, ORSA, reserving, second opinion, recon, DQ, Genie,
 * general). The response shows which specialist answered, the data sources used,
 * and a cache-hit indicator when applicable.
 *
 * Read-only by design — no specialist has write paths.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Loader2, MessageSquareCode, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { renderMarkdownSafe } from '../lib/markdown';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  specialist_key?: string;
  specialist_name?: string;
  data_sources?: string[];
  cached?: boolean;
  baked?: boolean;
  cached_at?: string;
  trace_id?: string | null;
  confidence?: number;
}

// Each suggestion carries the specialist hint so the audience sees where the
// supervisor will dispatch the question.
const SUGGESTIONS: { text: string; hint: string }[] = [
  { text: "What's outstanding for Q4 close?",                              hint: "General Workbench" },
  { text: "Why did property reserves move?",                                hint: "Senior Reserving Actuary" },
  { text: "What did the cat agent say about Igloo output?",                 hint: "Cat Modelling Agent" },
  { text: "Explain the cross-QRT recon gap",                                hint: "Recon Investigator" },
  { text: "Show me the worst stress scenario",                              hint: "ORSA Narrative Agent" },
  { text: "What could go wrong if we double our cyber book over 12 months?", hint: "Contrarian Capital Reviewer" },
];

function relTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    const ageSec = Math.max(0, (Date.now() - t) / 1000);
    if (ageSec < 90) return 'just now';
    if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
    if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
    return `${Math.round(ageSec / 86400)}d ago`;
  } catch { return ''; }
}

export default function WorkbenchAssistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setTurns((t) => [...t, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/supervisor/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, period: '2025-Q4' }),
      });
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try { const j = await res.json(); if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      const json = await res.json();
      setTurns((t) => [...t, {
        role: 'assistant',
        text: json.answer,
        specialist_key: json.specialist_key,
        specialist_name: json.specialist_name,
        data_sources: json.data_sources,
        cached: !!json.cached,
        baked: !!json.baked,
        cached_at: json.cached_at,
        trace_id: json.trace_id,
        confidence: json.confidence,
      }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `Sorry — error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-3 bg-violet-700 text-white rounded-full shadow-lg hover:bg-violet-800 transition-colors text-sm font-semibold"
        title="Workbench AI"
      >
        {open ? <X className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
        {!open && <span className="hidden sm:inline">Workbench AI</span>}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-[440px] max-w-[calc(100vw-2.5rem)] h-[600px] max-h-[calc(100vh-7rem)]
                        bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <header className="px-4 py-3 border-b border-gray-200 bg-violet-50 flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-700" />
            <h3 className="text-sm font-semibold text-violet-900">Workbench AI</h3>
            <Link to="/agents" onClick={() => setOpen(false)}
              className="ml-auto text-[10px] text-violet-700 uppercase tracking-wide font-semibold inline-flex items-center gap-1 hover:underline">
              <Compass className="w-3 h-3" /> View routing
            </Link>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {turns.length === 0 && (
              <div className="text-sm text-gray-700 space-y-3">
                <p>The supervisor classifies your question and routes it to one of eight specialists. Try:</p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.text} onClick={() => ask(s.text)}
                      className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-violet-50 hover:border-violet-300 text-gray-700 flex items-start gap-2">
                      <MessageSquareCode className="w-3 h-3 mt-0.5 shrink-0 text-violet-700" />
                      <span className="flex-1 min-w-0">
                        <span className="block">{s.text}</span>
                        <span className="block text-[10px] text-violet-600/80 mt-0.5">→ {s.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  <Link to="/agents" className="text-violet-700 hover:underline" onClick={() => setOpen(false)}>
                    See the routing architecture →
                  </Link>
                </p>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
                {t.role === 'user' ? (
                  <div className="bg-violet-700 text-white text-sm rounded-lg rounded-br-sm px-3 py-2 max-w-[85%]">
                    {t.text}
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg rounded-bl-sm px-3 py-2 text-sm text-gray-800 max-w-[95%]">
                    {t.specialist_name && (
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1 flex items-center gap-1.5 flex-wrap">
                        <span>routed to: {t.specialist_name}</span>
                        {t.cached && (
                          <span className="text-emerald-700 normal-case tracking-normal font-medium">
                            · cached {t.baked ? `· baked ${relTime(t.cached_at)}` : `· this session`}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="prose prose-sm max-w-none text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(t.text) }} />
                    {t.data_sources && t.data_sources.length > 0 && (
                      <div className="text-[10px] text-gray-400 font-mono mt-2 pt-2 border-t border-gray-100">
                        sources: {t.data_sources.join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 inline-flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> classifying + routing…
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(input); }}
            className="p-3 border-t border-gray-200 bg-white flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the supervisor anything…"
              className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()}
              className="px-3 py-1.5 bg-violet-700 text-white rounded text-xs font-semibold disabled:opacity-50 hover:bg-violet-800">
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

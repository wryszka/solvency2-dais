/**
 * Workbench Assistant — floating chat overlay on every page.
 *
 * Single-turn tool-routed agent. The user types a question; the backend
 * picks the right tool (close status, model status, overlays, qrt audit),
 * executes the SQL, and the LLM summarises with citations.
 *
 * Read-only by design — the agent has no write paths.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Loader2, MessageSquareCode } from 'lucide-react';
import { renderMarkdownSafe } from '../lib/markdown';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  intent?: string;
  data?: unknown;
}

const SUGGESTIONS = [
  "What's outstanding for Q4 close?",
  "Which models are pending promotion?",
  "How many overlays are awaiting approval?",
  "What changed in S.05.01 between Q3 and Q4?",
  "What's the reserve-capital divergence about?",
];

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
      const res = await fetch('/api/agents/workbench/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, period: '2025-Q4' }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setTurns((t) => [...t, { role: 'assistant', text: json.answer, intent: json.intent, data: json.data }]);
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
        title="Workbench Assistant"
      >
        {open ? <X className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
        {!open && <span className="hidden sm:inline">Workbench Assistant</span>}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-[420px] max-w-[calc(100vw-2.5rem)] h-[560px] max-h-[calc(100vh-7rem)]
                        bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <header className="px-4 py-3 border-b border-gray-200 bg-violet-50 flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-700" />
            <h3 className="text-sm font-semibold text-violet-900">Workbench Assistant</h3>
            <span className="ml-auto text-[10px] text-violet-700 uppercase tracking-wide font-semibold">read-only</span>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {turns.length === 0 && (
              <div className="text-sm text-gray-700 space-y-3">
                <p>Ask about the operational state of the close. I can answer:</p>
                <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
                  <li>What's outstanding for the current quarter</li>
                  <li>Model promotion / approval status</li>
                  <li>Overlays pending or by line of business</li>
                  <li>Where a QRT cell came from (data, code, models, overlays)</li>
                </ul>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => ask(s)}
                      className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-violet-50 hover:border-violet-300 text-gray-700">
                      <MessageSquareCode className="w-3 h-3 inline mr-1.5 text-violet-700" />
                      {s}
                    </button>
                  ))}
                </div>
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
                    {t.intent && (
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">
                        intent: {t.intent}
                      </div>
                    )}
                    <div className="prose prose-sm max-w-none text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(t.text) }} />
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 inline-flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> querying governance tables…
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(input); }}
            className="p-3 border-t border-gray-200 bg-white flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about Q4 close, models, overlays…"
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

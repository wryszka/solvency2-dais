/**
 * Workbench AI — primary AI destination.
 *
 * Top:    inline chat with the supervisor (replaces the floating button on
 *         this page; the supervisor proxies to the workbench-supervisor
 *         Model Serving endpoint when wired, else in-app routing).
 * Middle: WHAT WORKBENCH AI FRONTS — supervisor badge + grid of specialist
 *         cards in the Pricing-AI-page style (agent + tools + endpoint).
 * Bottom: recent routing decisions + specialists catalogue.
 *
 * Every card carries clickable links to the Databricks workspace artefacts
 * (UC pyfunc, UC function, serving endpoint).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ExternalLink, Bot, Send,
  Loader2, MessageSquareCode, Shield, Scale, Beaker, Workflow,
  Database, FileSearch, GitCompare,
} from 'lucide-react';
import { renderMarkdownSafe } from '../lib/markdown';

interface UcArtefact {
  uc_path: string | null;
  workspace_url: string | null;
  kind: string;
}

interface ToolRef {
  name: string;
  kind: 'uc_function' | 'uc_table';
  workspace_url: string | null;
}

interface Specialist {
  key: string;
  name: string;
  scope: string;
  triggers: string;
  color: string;
  data_sources: string[];
  uc_artefact?: UcArtefact;
  tools?: ToolRef[];
}

interface SupervisorMeta {
  uc_path: string;
  workspace_url: string;
  serving_endpoint: string | null;
  serving_endpoint_url: string | null;
  kind: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  specialist_key?: string;
  specialist_name?: string;
  data_sources?: string[];
  cached?: boolean;
  baked?: boolean;
}

/* ── Card-grid colour tokens ───────────────────────────────────────────────── */
type CardTone = 'amber' | 'violet' | 'emerald' | 'rose' | 'blue' | 'orange' | 'cyan' | 'slate';

const CARD_PALETTE: Record<CardTone, { border: string; bg: string; chipBg: string; chipText: string; head: string; icon: string }> = {
  amber:   { border: 'border-amber-300',   bg: 'bg-amber-50/60',   chipBg: 'bg-amber-100',   chipText: 'text-amber-900',   head: 'text-amber-900',   icon: 'text-amber-700' },
  violet:  { border: 'border-violet-300',  bg: 'bg-violet-50/60',  chipBg: 'bg-violet-100',  chipText: 'text-violet-900',  head: 'text-violet-900',  icon: 'text-violet-700' },
  emerald: { border: 'border-emerald-300', bg: 'bg-emerald-50/60', chipBg: 'bg-emerald-100', chipText: 'text-emerald-900', head: 'text-emerald-900', icon: 'text-emerald-700' },
  rose:    { border: 'border-rose-300',    bg: 'bg-rose-50/60',    chipBg: 'bg-rose-100',    chipText: 'text-rose-900',    head: 'text-rose-900',    icon: 'text-rose-700' },
  blue:    { border: 'border-blue-300',    bg: 'bg-blue-50/60',    chipBg: 'bg-blue-100',    chipText: 'text-blue-900',    head: 'text-blue-900',    icon: 'text-blue-700' },
  orange:  { border: 'border-orange-300',  bg: 'bg-orange-50/60',  chipBg: 'bg-orange-100',  chipText: 'text-orange-900',  head: 'text-orange-900',  icon: 'text-orange-700' },
  cyan:    { border: 'border-cyan-300',    bg: 'bg-cyan-50/60',    chipBg: 'bg-cyan-100',    chipText: 'text-cyan-900',    head: 'text-cyan-900',    icon: 'text-cyan-700' },
  slate:   { border: 'border-slate-300',   bg: 'bg-slate-50/60',   chipBg: 'bg-slate-100',   chipText: 'text-slate-900',   head: 'text-slate-900',   icon: 'text-slate-700' },
};

const SPECIALIST_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cat:             Shield,
  orsa:            GitCompare,
  reserving:       Beaker,
  second_opinion:  Scale,
  recon:           GitCompare,
  dq:              FileSearch,
  genie:           Database,
  general:         Workflow,
};

export default function AgentArchitecture() {
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [supervisor, setSupervisor] = useState<SupervisorMeta | null>(null);

  useEffect(() => {
    fetch('/api/supervisor/specialists')
      .then((r) => r.json())
      .then((d) => {
        setSpecialists(d.specialists || []);
        setSupervisor(d.supervisor || null);
      })
      .catch(() => { setSpecialists([]); setSupervisor(null); });
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <Link to="/" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Workbench
      </Link>

      <header className="pb-2">
        <div className="text-[11px] uppercase tracking-widest text-violet-700 font-bold">Workbench AI</div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">One supervisor. Eight specialists. Every call audited.</h1>
        <p className="text-sm text-gray-600 mt-1.5 leading-relaxed max-w-3xl">
          Type a question — the supervisor classifies it, dispatches to the right specialist, and writes a routing trace.
          Architecture diagram below; every node clicks through to the actual Databricks artefact.
        </p>
      </header>

      {/* Inline chat */}
      <InlineChat />

      {/* Architecture — Pricing AI style card grid */}
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-1">What Workbench AI fronts</h2>
        <p className="text-sm text-gray-600 mb-4 max-w-3xl leading-relaxed">
          Eight specialised brains, one address. Each is a Unity Catalog-registered MLflow pyfunc with
          MLflow tracing — independently deployable, independently auditable. The supervisor classifies the
          question and dispatches.
        </p>

        {supervisor && <SupervisorCard sup={supervisor} />}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
          {specialists
            .filter((s) => s.key !== 'general')
            .map((s) => (
              <SpecialistCard key={s.key} s={s} endpointName={supervisor?.serving_endpoint ?? null} />
            ))}
        </div>

        <p className="text-[11px] text-gray-500 italic mt-4 leading-relaxed">
          Specialists are independently registered Mosaic AI pyfunc agents (UC); the supervisor is a Model Serving
          endpoint. The supervisor's classifier uses a single Foundation Model call — sub-second, low cost. Every
          routing decision lands in <code className="font-mono bg-gray-100 px-1 rounded">6_ai_routing_trace</code> with
          chosen route, classifier confidence, model used, token usage, and the data sources touched.
        </p>
      </section>

      <p className="text-[11px] text-gray-500 italic text-center">
        Live routing activity: <Link to="/governance" className="text-violet-700 hover:underline">Governance → AI Governance</Link>
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Supervisor card — top of architecture                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function SupervisorCard({ sup }: { sup: SupervisorMeta }) {
  return (
    <div className="bg-gradient-to-br from-violet-100 to-white border-2 border-violet-300 rounded-xl p-5 max-w-md mx-auto">
      <div className="text-[10px] uppercase tracking-widest text-violet-700 font-bold text-center">Workbench AI</div>
      <h3 className="text-2xl font-bold text-violet-900 text-center mt-1">Supervisor</h3>
      <p className="text-sm text-violet-900 mt-2 leading-relaxed">
        Reads the question. A single Foundation-Model call classifies it against the
        specialist catalogue, dispatches to the right one, synthesises the response with
        source citations, and writes the routing decision to the audit log. Sub-second
        classification; full MLflow trace per dispatch.
      </p>
      {sup.serving_endpoint && (
        <div className="mt-3 pt-3 border-t border-violet-200 text-[11px] text-violet-700 text-center">
          Endpoint:{' '}
          <a href={sup.serving_endpoint_url ?? '#'} target="_blank" rel="noopener noreferrer"
            className="font-mono text-violet-900 hover:underline">
            {sup.serving_endpoint}
          </a>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Specialist card — Pricing-AI style                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function SpecialistCard({ s, endpointName }: { s: Specialist; endpointName: string | null }) {
  const tone: CardTone = (s.color as CardTone) in CARD_PALETTE ? (s.color as CardTone) : 'slate';
  const p = CARD_PALETTE[tone];
  const Icon = SPECIALIST_ICON[s.key] ?? Bot;
  const isGenie = s.key === 'genie';
  const isFallback = s.key === 'general';
  const badge = isGenie ? 'GENIE' : isFallback ? 'FALLBACK' : 'AGENT';
  return (
    <article className={`${p.bg} border-2 ${p.border} rounded-xl p-4 flex flex-col gap-2`}>
      <header className="flex items-start gap-2">
        <Icon className={`w-5 h-5 ${p.icon} mt-0.5 shrink-0`} />
        <h3 className={`text-base font-bold ${p.head} flex-1 leading-tight`}>{s.name}</h3>
        <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-white/60 ${p.head}`}>
          {badge}
        </span>
      </header>
      <p className={`text-sm ${p.head}/90 leading-relaxed flex-1`}>{s.scope}</p>

      <footer className="text-[10px] text-gray-600 pt-2 border-t border-gray-200/70">
        {s.uc_artefact?.workspace_url ? (
          <>
            <span className="font-semibold">Endpoint:</span>{' '}
            <span className="font-mono">{endpointName ?? 'in-app'}</span>
            {' · '}
            <a href={s.uc_artefact.workspace_url} target="_blank" rel="noopener noreferrer"
              className="font-mono hover:underline inline-flex items-center gap-0.5">
              agent: {s.key} <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </>
        ) : (
          <>
            <span className="font-semibold">Endpoint:</span>{' '}
            <span className="font-mono">{isGenie ? 'ai_bi_genie' : 'in-app fallback'}</span>
          </>
        )}
      </footer>
    </article>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Inline chat — mirrors the floating Ask-Workbench overlay, full panel     */
/* ────────────────────────────────────────────────────────────────────────── */

// Example questions on the supervisor's chat — each one carries a hint
// showing which specialist the classifier should route it to. The hint is
// editorial guidance (LLM classifier may differ) but is reliable for these
// pre-baked variants.
const SUGGESTIONS: { text: string; hint: string }[] = [
  { text: "What's outstanding for Q4 close?",                              hint: "General Workbench" },
  { text: "Why did property reserves move?",                                hint: "Senior Reserving Actuary" },
  { text: "What did the cat agent say about Igloo output?",                 hint: "Cat Modelling Agent" },
  { text: "Explain the cross-QRT recon gap",                                hint: "Recon Investigator" },
  { text: "What could go wrong if we double our cyber book over 12 months?", hint: "Contrarian Capital Reviewer" },
];

function InlineChat() {
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
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setTurns((t) => [...t, {
        role: 'assistant',
        text: json.answer,
        specialist_key: json.specialist_key,
        specialist_name: json.specialist_name,
        data_sources: json.data_sources,
        cached: !!json.cached,
        baked: !!json.baked,
      }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `Error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <header className="px-5 py-3 border-b border-gray-200 bg-violet-50/60 flex items-center gap-2">
        <Bot className="w-4 h-4 text-violet-700" />
        <h3 className="text-sm font-semibold text-violet-900">Ask the supervisor</h3>
        <span className="ml-auto text-[10px] text-violet-700 uppercase tracking-wide font-semibold">read-only</span>
      </header>

      <div ref={scrollRef} className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
        {turns.length === 0 && (
          <div>
            <p className="text-sm text-gray-700 mb-2">
              The supervisor classifies your question and dispatches to the specialist best positioned to answer.
              Try one:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s.text} onClick={() => ask(s.text)}
                  className="text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-violet-50 hover:border-violet-300 text-gray-700 flex items-start gap-2">
                  <MessageSquareCode className="w-3 h-3 mt-0.5 shrink-0 text-violet-700" />
                  <span className="flex-1 min-w-0">
                    <span className="block">{s.text}</span>
                    <span className="block text-[10px] text-violet-600/80 mt-0.5">→ {s.hint}</span>
                  </span>
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
                {t.specialist_name && (
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1 flex items-center gap-1.5 flex-wrap">
                    <span>routed to: {t.specialist_name}</span>
                    {t.cached && (
                      <span className="text-emerald-700 normal-case tracking-normal font-medium">
                        · cached{t.baked ? ' · baked' : ' · session'}
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
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> classifying + dispatching…
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="p-3 border-t border-gray-200 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the supervisor anything…"
          className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
          disabled={busy} />
        <button type="submit" disabled={busy || !input.trim()}
          className="px-3 py-1.5 bg-violet-700 text-white rounded text-xs font-semibold disabled:opacity-50 hover:bg-violet-800 inline-flex items-center gap-1">
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </form>
    </section>
  );
}

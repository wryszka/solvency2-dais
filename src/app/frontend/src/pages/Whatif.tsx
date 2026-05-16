/**
 * Whatif — Scene 6 (continuous solvency + second opinion).
 *
 * The board paper section: type a scenario in plain English, the engine
 * projects, the Contrarian Capital Reviewer agent fires automatically with
 * pushbacks. The pre-tested scenario is "double cyber book over 12 months".
 */
import { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, ShieldAlert, Play, RefreshCw, CircleHelp, ExternalLink } from 'lucide-react';
import { renderMarkdownSafe } from '../lib/markdown';
import { useStreamedText } from '../lib/hooks/useStreamedText';
import { runWhatif, fetchCyberBook, formatEur, type Row } from '../lib/api';

interface WhatifResult {
  run_id: string;
  scenario_label: string;
  result: {
    projected_gwp_eur?: number;
    projected_loss_ratio?: number;
    scr_impact_eur?: number;
    ratio_before_pct: number;
    ratio_after_pct: number;
    ratio_delta_pp: number;
    narrative_seed: string;
  };
  second_opinion: string;
}

const SUGGESTIONS = [
  'double cyber book over 12 months',
  'increase motor portfolio by 20% next year',
  'reduce property cat retention to €2M XOL',
];

export default function Whatif() {
  const [scenario, setScenario] = useState(SUGGESTIONS[0]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WhatifResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cyber, setCyber] = useState<Row | null>(null);

  useEffect(() => {
    fetchCyberBook().then((r) => setCyber(r.cyber as Row | null)).catch(() => undefined);
  }, []);

  // Scene 6 — the contrarian agent should feel snappy and pointed, not
  // contemplative. Cyber-doubling narrative renders quickly; second-opinion
  // pushbacks stream fast (the audience has already seen one slow stream
  // in Scene 5's cat agent — by here they want the answer).
  const { text: narrativeStreamed, done: narrativeDone } = useStreamedText(result?.result.narrative_seed ?? null, { charsPerTick: 20, tickMs: 8 });
  const { text: opinionStreamed, done: opinionDone } = useStreamedText(narrativeDone ? (result?.second_opinion ?? null) : null, { charsPerTick: 25, tickMs: 8 });

  async function go() {
    setRunning(true); setError(null); setResult(null);
    try {
      setResult(await runWhatif(scenario) as WhatifResult);
    } catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <header className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
          <CircleHelp className="w-5 h-5 text-blue-700" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">What-if scenario</h2>
          <p className="text-sm text-gray-500 mt-1">
            Type a scenario in plain English. The engine projects capital impact and the
            Contrarian Capital Reviewer fires automatically — a critical voice that pressure-tests
            the assumptions before this hits a board paper.
          </p>
        </div>
      </header>

      {/* Cyber book reference (so audience knows the starting state) */}
      {cyber && (
        <section className="bg-white border border-gray-200 rounded-lg p-3.5 text-xs grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Cyber GWP today" value={formatEur(cyber.gwp_eur)} />
          <Stat label="Loss ratio"       value={`${(parseFloat(String(cyber.loss_ratio)) * 100).toFixed(0)}%`} />
          <Stat label="Reinsurance"      value={`${(parseFloat(String(cyber.reinsurance_qs_pct)) * 100).toFixed(0)}% QS + €5M XOL`} />
          <Stat label="SCR allocation"   value={formatEur(cyber.scr_allocation_eur)} />
        </section>
      )}

      <section className="bg-white border-2 border-blue-200 rounded-xl p-5 space-y-3">
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Scenario</span>
          <input
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            disabled={running}
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setScenario(s)} disabled={running}
              className={`text-[11px] px-2 py-0.5 border rounded-full ${
                s === scenario
                  ? 'border-blue-400 bg-blue-50 text-blue-800'
                  : 'border-gray-200 text-gray-600 hover:bg-blue-50/50'
              }`}>
              {s}
            </button>
          ))}
        </div>

        <button onClick={go} disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-800 disabled:opacity-50 text-sm font-semibold">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Projecting…' : result ? 'Re-run' : 'Run scenario'}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </section>

      {result && (
        <>
          {/* Result block */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-blue-700" />
              <h3 className="text-sm font-bold text-gray-900">Projected impact</h3>
              <span className="ml-auto text-[10px] uppercase tracking-widest text-gray-400 font-bold">computed live</span>
              <ViewCalculationLink scenarioLabel={result.scenario_label} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {result.result.projected_gwp_eur != null && (
                <Stat label="Projected GWP" value={formatEur(result.result.projected_gwp_eur)} highlight />
              )}
              {result.result.scr_impact_eur != null && (
                <Stat label="SCR impact" value={`+${formatEur(result.result.scr_impact_eur)}`} highlight />
              )}
              <Stat label="Ratio before" value={`${result.result.ratio_before_pct.toFixed(1)}%`} />
              <Stat label="Ratio after"  value={`${result.result.ratio_after_pct.toFixed(1)}%`}
                highlight delta={`${result.result.ratio_delta_pp >= 0 ? '+' : ''}${result.result.ratio_delta_pp.toFixed(1)}pp`} />
            </div>
            <div className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-800
                            bg-gradient-to-br from-blue-50/50 to-white border border-blue-100 rounded-lg p-3.5 mt-3">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(narrativeStreamed) }} />
              {!narrativeDone && <span className="inline-block w-2 h-4 bg-blue-700 align-middle ml-0.5 animate-pulse" />}
            </div>
          </section>

          {/* Second opinion — visually distinct, contrarian */}
          {result.second_opinion && narrativeDone && (
            <section className="bg-rose-50/60 border-2 border-rose-300 rounded-xl p-5 space-y-3 relative">
              <div className="absolute -top-2.5 left-4 px-2 bg-rose-100 border border-rose-300 rounded text-[10px] uppercase tracking-widest font-bold text-rose-800">
                Contrarian Capital Reviewer
              </div>
              <header className="flex items-center gap-2 pt-1">
                <ShieldAlert className="w-4 h-4 text-rose-700" />
                <h3 className="text-sm font-bold text-rose-900">Second opinion · pushbacks before this becomes a board paper</h3>
                {opinionDone && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold text-rose-700">
                    <RefreshCw className="w-3 h-3" /> auto-fired
                  </span>
                )}
              </header>
              <div className="prose prose-sm max-w-none text-sm leading-relaxed text-rose-950">
                <div dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(opinionStreamed) }} />
                {!opinionDone && <span className="inline-block w-2 h-4 bg-rose-700 align-middle ml-0.5 animate-pulse" />}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, delta }: { label: string; value: string; highlight?: boolean; delta?: string }) {
  return (
    <div className={`p-2.5 rounded ${highlight ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{label}</div>
      <div className="text-base font-bold text-gray-900 font-mono">{value}</div>
      {delta && <div className="text-[11px] font-mono text-rose-700 font-semibold">{delta}</div>}
    </div>
  );
}

function ViewCalculationLink({ scenarioLabel }: { scenarioLabel: string }) {
  const label = scenarioLabel.toLowerCase();
  const slug = label.includes('cyber') && (label.includes('double') || label.includes('doubling'))
    ? 'cyber_doubling'
    : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) { setUrl(null); return; }
    fetch(`/api/demo/whatif/notebook-url?scenario=${slug}`)
      .then((r) => r.json())
      .then((d) => setUrl(d.url || null))
      .catch(() => setUrl(null));
  }, [slug]);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 ml-2">
      <ExternalLink className="w-3 h-3" />
      View calculation
    </a>
  );
}

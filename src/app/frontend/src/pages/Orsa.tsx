/**
 * ORSA — Own Risk and Solvency Assessment
 *
 * Pillar 2 page. User picks a stress scenario; the engine takes base SCR
 * sub-module charges, applies the scenario shocks, recomputes BSCR via
 * the EIOPA correlation matrix, and projects 3 years forward using the
 * 0_cfg_business_plan growth assumptions.
 *
 * Output panels:
 *   1. Scenario selector + run button
 *   2. Capital adequacy ratio path (years 0..3, base vs scenario bars)
 *   3. Sub-module attribution (year-0 module deltas)
 *   4. Generated narrative + version history
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Workflow, AlertTriangle, Sparkles, Loader2, Play, RefreshCw, CheckCircle2, FileText, ArrowRight,
} from 'lucide-react';
import PillarChip from '../components/PillarChip';
import { Skeleton } from '../components/Skeleton';
import CapitalPathChart from '../components/CapitalPathChart';
import OrsaContinuousHeader from '../components/OrsaContinuousHeader';
import { useStreamedText } from '../lib/hooks/useStreamedText';
import {
  fetchOrsaScenarios, runOrsaScenario, generateOrsaNarrative, fetchOrsaNarratives,
  type OrsaScenario, type OrsaRun, type OrsaResultRow, type OrsaNarrative,
} from '../lib/api';
import UnderTheHood from '../components/UnderTheHood';

interface ProjectionPoint {
  yearOffset: number;
  projectionYear: number;
  baseRatio: number;
  scenarioRatio: number;
  baseScr: number;
  scenarioScr: number;
}

export default function Orsa() {
  const [scenarios, setScenarios] = useState<OrsaScenario[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<OrsaRun | null>(null);
  const [narratives, setNarratives] = useState<OrsaNarrative[]>([]);
  const [generatingNarrative, setGeneratingNarrative] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOrsaScenarios()
      .then((r) => {
        setScenarios(r.scenarios);
        if (r.scenarios.length > 0 && !selected) setSelected(r.scenarios[0].scenario_id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const projection = useMemo<ProjectionPoint[]>(() => {
    if (!run) return [];
    const points: ProjectionPoint[] = [];
    const byYear = new Map<number, { base?: OrsaResultRow; stress?: OrsaResultRow }>();
    run.rows.forEach((r) => {
      const slot = byYear.get(r.year_offset) ?? {};
      if (r.is_base) slot.base = r; else slot.stress = r;
      byYear.set(r.year_offset, slot);
    });
    Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).forEach(([yo, pair]) => {
      if (pair.base && pair.stress) {
        points.push({
          yearOffset: yo,
          projectionYear: pair.base.projection_year,
          baseRatio: pair.base.solvency_ratio_pct,
          scenarioRatio: pair.stress.solvency_ratio_pct,
          baseScr: pair.base.scr_eur,
          scenarioScr: pair.stress.scr_eur,
        });
      }
    });
    return points;
  }, [run]);

  const moduleBreakdown = useMemo(() => {
    if (!run) return null;
    const y0Base = run.rows.find((r) => r.year_offset === 0 && r.is_base);
    const y0Stress = run.rows.find((r) => r.year_offset === 0 && !r.is_base);
    if (!y0Base || !y0Stress) return null;
    try {
      const base = JSON.parse(y0Base.module_breakdown_json) as Record<string, number>;
      const stress = JSON.parse(y0Stress.module_breakdown_json) as Record<string, number>;
      return Object.keys(base).map((k) => ({
        module: k,
        base: base[k],
        scenario: stress[k] ?? 0,
        delta: (stress[k] ?? 0) - base[k],
        deltaPct: base[k] > 0 ? Math.round(((stress[k] ?? 0) - base[k]) / base[k] * 1000) / 10 : 0,
      }));
    } catch { return null; }
  }, [run]);

  async function handleRun() {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setNarratives([]);
    setRun(null);                          // clear previous chart so the new one animates from scratch
    const startedAt = Date.now();
    try {
      const r = await runOrsaScenario(selected);
      // Hold the live progress panel visible long enough for the audience to read it
      // (~18s minimum: 5 stages × ~3.5s each).
      const elapsed = Date.now() - startedAt;
      const HOLD_MS = 18_000;
      if (elapsed < HOLD_MS) {
        await new Promise((res) => window.setTimeout(res, HOLD_MS - elapsed));
      }
      setRun(r);
      const narr = await fetchOrsaNarratives(r.run_id);
      setNarratives(narr.narratives);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleNarrative() {
    if (!run) return;
    setGeneratingNarrative(true);
    try {
      const n = await generateOrsaNarrative(run.run_id);
      setNarratives([n, ...narratives]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingNarrative(false);
    }
  }

  const selectedScenario = scenarios?.find((s) => s.scenario_id === selected);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Workflow className="w-6 h-6 text-green-700" />
            ORSA — Own Risk and Solvency Assessment
            <PillarChip pillar={2} size="md" />
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Scenario-based capital adequacy projection over 3 years. Pick a stress, run the engine,
            generate the Board-facing narrative.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/orsa/draft"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded border border-emerald-200 bg-emerald-50/50">
              Continuous draft document <ArrowRight className="w-3 h-3" />
            </Link>
            <Link to="/pillar-2#use-test"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded border border-emerald-200 bg-emerald-50/50">
              Use-test evidence — Article 45 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Continuous ORSA — refreshed nightly + 30-day drift sparklines + on-the-fly stress */}
      <OrsaContinuousHeader />

      {/* Scenario picker */}
      <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <header className="px-4 py-3 bg-gradient-to-r from-green-50 to-white border-b border-green-200">
          <h3 className="text-sm font-bold text-green-900">1. Pick a stress scenario</h3>
        </header>
        <div className="p-4">
          {!scenarios ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {scenarios.map((s) => {
                const isSelected = s.scenario_id === selected;
                return (
                  <button
                    key={s.scenario_id}
                    onClick={() => setSelected(s.scenario_id)}
                    className={`text-left p-3 rounded-md border-2 transition-colors ${
                      isSelected
                        ? 'border-green-500 bg-green-50/60'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-600 mt-1">{s.description}</div>
                    {s.shocks.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.shocks.map((sh, i) => (
                          <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 rounded text-gray-700">
                            {sh.module}.{sh.sub_module} ×{sh.multiplier}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={!selected || running}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-md hover:bg-green-800 disabled:opacity-50 text-sm font-medium"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? 'Running…' : 'Run scenario'}
            </button>
            {run && (
              <span className="text-xs text-gray-500">
                last run · {run.scenario_name} · base period {run.base_period}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Live progress while running */}
      {running && (
        <section className="bg-white rounded-lg border border-green-200 overflow-hidden">
          <header className="px-4 py-3 bg-gradient-to-r from-green-50 to-white border-b border-green-200">
            <h3 className="text-sm font-bold text-green-900">Running scenario · live progress</h3>
          </header>
          <div className="p-4 space-y-2">
            <RunStage label="Setting up the model" delay={0} />
            <RunStage label="Applying scenario shocks to sub-modules" delay={3000} />
            <RunStage label="Re-aggregating BSCR via correlation matrix" delay={6500} />
            <RunStage label="Projecting capital path · 3 years forward" delay={11000} />
            <RunStage label="Persisting results to gold_orsa_results" delay={15500} />
          </div>
        </section>
      )}

      {/* Capital path */}
      {projection.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <header className="px-4 py-3 bg-gradient-to-r from-green-50 to-white border-b border-green-200 flex items-center gap-2">
            <h3 className="text-sm font-bold text-green-900">Solvency ratio path · base vs scenario</h3>
            {run && <span className="ml-auto text-[11px] text-gray-500 font-mono">{run.scenario_name}</span>}
          </header>
          <div className="p-4">
            <CapitalPathChart points={projection} scenarioLabel={run?.scenario_name ?? 'Stress'} />
          </div>
        </section>
      )}

      {/* Module attribution */}
      {moduleBreakdown && (
        <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <header className="px-4 py-3 bg-gradient-to-r from-green-50 to-white border-b border-green-200">
            <h3 className="text-sm font-bold text-green-900">3. Sub-module attribution — year 0</h3>
          </header>
          <div className="p-4">
            <ModuleAttribution rows={moduleBreakdown} />
          </div>
        </section>
      )}

      {/* Narrative */}
      {run && (
        <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <header className="px-4 py-3 bg-gradient-to-r from-green-50 to-white border-b border-green-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-green-900">4. ORSA narrative</h3>
            <button
              onClick={handleNarrative}
              disabled={generatingNarrative}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-green-700 text-green-800 rounded-md hover:bg-green-50 disabled:opacity-50 text-xs font-medium"
            >
              {generatingNarrative ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {narratives.length > 0 ? 'Re-generate' : 'Generate narrative'}
            </button>
          </header>
          <div className="p-4 space-y-3">
            {narratives.length === 0 && !generatingNarrative && (
              <div className="text-xs text-gray-500 italic">
                Click "Generate narrative" to draft the Board-facing commentary for this scenario.
              </div>
            )}
            {narratives.map((n, idx) => (
              <NarrativeCard key={n.narrative_id} narrative={n} streamLatest={idx === 0} />
            ))}
          </div>
        </section>
      )}

      {selectedScenario && !run && !running && (
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          Run the scenario to see capital path, module attribution, and narrative.
        </div>
      )}

      <UnderTheHood
        title="What just happened?"
        lines={[
          { component: 'Unity Catalog',     detail: 'Base sub-module charges read from 2_stg_scr_results; scenario shock recipe from 0_cfg_orsa_scenarios.' },
          { component: 'orsa engine',       detail: 'Multiplicative shocks applied to sub-modules → BSCR recomputed via EIOPA correlation matrix → 3-year projection using 0_cfg_business_plan growth.' },
          { component: 'Unity Catalog',     detail: 'Capital path + module attribution persisted to gold_orsa_results (Delta).' },
          { component: 'Foundation Model API', detail: 'ORSA narrative streamed by the ORSA Narrative Agent — drafted from this run\'s numbers, not boilerplate.' },
          { component: 'Mosaic AI',         detail: 'In production the narrative agent runs as a Mosaic AI Serving endpoint with the same trace + audit you see in the AI governance tab.' },
        ]}
      />
    </div>
  );
}

function RunStage({ label, delay }: { label: string; delay: number }) {
  const [stage, setStage] = useState<'pending' | 'active' | 'done'>('pending');
  useEffect(() => {
    const a = window.setTimeout(() => setStage('active'), delay);
    const b = window.setTimeout(() => setStage('done'), delay + 2200);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [delay]);
  return (
    <div className="flex items-center gap-2.5 text-sm">
      {stage === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-200" />}
      {stage === 'active' && <Loader2 className="w-4 h-4 animate-spin text-green-700" />}
      {stage === 'done' && (
        <div className="w-4 h-4 rounded-full bg-green-700 flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <span className={stage === 'pending' ? 'text-gray-400' : stage === 'active' ? 'text-green-800 font-semibold' : 'text-gray-700'}>
        {label}
      </span>
    </div>
  );
}

function NarrativeCard({ narrative: n, streamLatest }: { narrative: OrsaNarrative; streamLatest: boolean }) {
  // Scene 7 — ORSA board paper narrative renders effectively-instant. By this
  // point in the demo the audience has watched the cat agent stream and the
  // second-opinion stream; a third slow stream is tedious. Speaker reads over.
  const { text: streamed, done } = useStreamedText(n.narrative_text, {
    enabled: streamLatest,
    charsPerTick: 60, tickMs: 4,
  });
  return (
    <article className="border border-gray-200 rounded-md p-4 bg-white">
      <header className="flex items-center justify-between text-[11px] text-gray-500 mb-2 gap-2">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          <span className="font-mono">v{n.version}</span>
          <span className="text-gray-300">·</span>
          <span>{n.model_used}</span>
        </span>
        {done && (
          <span className="inline-flex items-center gap-1 text-emerald-700 text-[10px] uppercase tracking-wide font-semibold">
            <CheckCircle2 className="w-3 h-3" /> saved · gold_orsa_narratives
          </span>
        )}
      </header>
      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none">
        {streamed}
        {!done && <span className="inline-block w-2 h-4 bg-green-700 align-middle ml-0.5 animate-pulse" />}
      </div>
    </article>
  );
}

function ModuleAttribution({ rows }: { rows: { module: string; base: number; scenario: number; delta: number; deltaPct: number }[] }) {
  const maxAmount = Math.max(...rows.flatMap((r) => [r.base, r.scenario, 1]));
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const tone = Math.abs(r.deltaPct) < 5
          ? 'bg-gray-200 text-gray-700'
          : r.deltaPct > 0
            ? 'bg-amber-100 text-amber-800'
            : 'bg-emerald-100 text-emerald-800';
        return (
          <div key={r.module} className="text-xs">
            <div className="flex justify-between mb-1">
              <span className="font-mono text-gray-700">{r.module}</span>
              <span>
                <span className="text-gray-500">EUR {(r.base/1e6).toFixed(0)}M</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="font-medium text-gray-800">EUR {(r.scenario/1e6).toFixed(0)}M</span>
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${tone}`}>
                  {r.deltaPct >= 0 ? '+' : ''}{r.deltaPct}%
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                <div className="h-full bg-blue-400" style={{ width: `${(r.base / maxAmount) * 100}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                <div className={`h-full ${r.deltaPct > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${(r.scenario / maxAmount) * 100}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

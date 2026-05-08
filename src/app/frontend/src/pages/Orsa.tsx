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
import {
  Workflow, AlertTriangle, Sparkles, Loader2, Play, RefreshCw,
} from 'lucide-react';
import PillarChip from '../components/PillarChip';
import { Skeleton } from '../components/Skeleton';
import {
  fetchOrsaScenarios, runOrsaScenario, generateOrsaNarrative, fetchOrsaNarratives,
  type OrsaScenario, type OrsaRun, type OrsaResultRow, type OrsaNarrative,
} from '../lib/api';

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
    try {
      const r = await runOrsaScenario(selected);
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
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

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

      {/* Capital path */}
      {projection.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <header className="px-4 py-3 bg-gradient-to-r from-green-50 to-white border-b border-green-200">
            <h3 className="text-sm font-bold text-green-900">2. Solvency ratio path — base vs scenario</h3>
          </header>
          <div className="p-4">
            <CapitalPathBars points={projection} />
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
            {narratives.map((n) => (
              <article key={n.narrative_id} className="border border-gray-200 rounded-md p-3 bg-white">
                <header className="flex items-center justify-between text-[11px] text-gray-500 mb-2">
                  <span>v{n.version} · {n.model_used}</span>
                  <span>{n.input_tokens + n.output_tokens} tokens</span>
                </header>
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {n.narrative_text}
                </div>
              </article>
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
    </div>
  );
}

function CapitalPathBars({ points }: { points: ProjectionPoint[] }) {
  const maxRatio = Math.max(200, ...points.flatMap((p) => [p.baseRatio, p.scenarioRatio]));
  return (
    <div className="space-y-3">
      {points.map((p) => (
        <div key={p.yearOffset} className="text-xs">
          <div className="flex justify-between mb-1">
            <span className="font-mono text-gray-700">
              {p.yearOffset === 0 ? 'year 0 (base)' : `year +${p.yearOffset} (${p.projectionYear})`}
            </span>
            <span className="text-gray-500">
              <span className="text-gray-700 font-medium">{p.baseRatio}%</span>
              {' → '}
              <span className={p.scenarioRatio < 100 ? 'text-red-700 font-semibold' : p.scenarioRatio < 130 ? 'text-amber-700 font-semibold' : 'text-green-700 font-semibold'}>
                {p.scenarioRatio}%
              </span>
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] w-16 text-gray-500">base</span>
              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${(p.baseRatio / maxRatio) * 100}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] w-16 text-gray-500">scenario</span>
              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                <div className={`h-full ${p.scenarioRatio < 100 ? 'bg-red-500' : p.scenarioRatio < 130 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                     style={{ width: `${(p.scenarioRatio / maxRatio) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
      ))}
      <div className="text-[11px] text-gray-400 italic mt-2">
        Solvency ratio = eligible own funds ÷ SCR. Coverage of own funds is held flat in this projection;
        SCR moves with module growth + scenario shock.
      </div>
    </div>
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

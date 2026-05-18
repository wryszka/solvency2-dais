/**
 * OrsaReverseStress — placeholder page for the Article 45(1)(b) reverse
 * stress test. Not yet implemented; this page exists so the question
 * "do you cover RST?" has a credible answer on stage.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, Workflow, Compass, Cpu, Bot, Sparkles, AlertTriangle } from 'lucide-react';
import PillarChip from '../components/PillarChip';

export default function OrsaReverseStress() {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <Link to="/orsa" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to ORSA
      </Link>

      <header className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
          <Compass className="w-5 h-5 text-amber-700" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            Reverse stress test
            <PillarChip pillar={2} size="md" />
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-3xl leading-relaxed">
            Forward stress asks "what's our SCR under scenario X?". Reverse stress asks the
            mirror question: <em>"which scenarios make us breach?"</em>. Required annually
            under Article 45(1)(b) and EIOPA Guideline 11.
          </p>
        </div>
      </header>

      <section className="bg-amber-50/70 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-900 leading-relaxed">
          <strong>Not yet implemented.</strong> The forward-stress engine
          (<code className="bg-white px-1 rounded text-xs">orsa.run_scenario</code>) is the
          building block — RST is a search loop on top of it. This page describes the two
          approaches we'd take.
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <article className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
          <header className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-blue-700" />
            <h3 className="text-base font-bold text-gray-900">Approach 1 — Brute search</h3>
            <span className="ml-auto text-[10px] uppercase tracking-widest font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
              Cheap on Databricks
            </span>
          </header>
          <p className="text-sm text-gray-700 leading-relaxed">
            Generate thousands of scenario combinations across all 6 SCR sub-modules.
            Run each through the engine. Filter to the ones that drop the solvency ratio
            below the firm's risk-appetite floor.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-gray-600 leading-relaxed">
            <li>· Spark job sweeps the sub-module shock grid in parallel.</li>
            <li>· One row per scenario in a Delta table — fully reproducible.</li>
            <li>· Output: the set of breaching scenarios, ranked by plausibility.</li>
          </ul>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed border-t border-gray-100 pt-2">
            Compute is cheap; storage is cheap. The honest, dumb approach often wins.
            Good for the annual ORSA file with thorough coverage.
          </p>
        </article>

        <article className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
          <header className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-violet-700" />
            <h3 className="text-base font-bold text-gray-900">Approach 2 — Agent-driven</h3>
            <span className="ml-auto text-[10px] uppercase tracking-widest font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
              Plausibility-aware
            </span>
          </header>
          <p className="text-sm text-gray-700 leading-relaxed">
            A Mosaic AI agent proposes <em>narratively plausible</em> compound scenarios —
            "war + reinsurance counterparty failure + secondary equity drop" — instead of
            sweeping every cell of the grid. The engine then computes each one.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-gray-600 leading-relaxed">
            <li>· Foundation Model proposes scenarios grounded in news + macro context.</li>
            <li>· orsa engine computes the capital path for each.</li>
            <li>· Output: a short library of plausible "scenarios that break us".</li>
          </ul>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed border-t border-gray-100 pt-2">
            Smaller search space, but each scenario comes with a defensible narrative.
            Better for Board conversations than a Spark grid of synthetic combinations.
          </p>
        </article>
      </div>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <header className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-emerald-700" />
          <h3 className="text-sm font-bold text-gray-900">Where this lands</h3>
        </header>
        <ul className="text-sm text-gray-700 space-y-1.5 leading-relaxed">
          <li>· <strong>ORSA filing</strong> — RST section under Article 45(1)(b).</li>
          <li>· <strong>Risk Appetite Statement</strong> — informs the floor the board sets.</li>
          <li>· <strong>Recovery plan inputs</strong> — early-warning indicators for breaching scenarios.</li>
        </ul>
      </section>

      <section className="border border-slate-200 bg-slate-50/70 rounded-lg p-3 flex items-start gap-2 text-xs text-slate-600">
        <Workflow className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
        <span className="leading-relaxed">
          The forward-stress engine that would power this lives at
          <Link to="/orsa" className="text-emerald-700 font-semibold hover:underline mx-1">/orsa</Link>.
          The Article 45 mapping for the wider ORSA workflow is on the
          <Link to="/pillar-2" className="text-emerald-700 font-semibold hover:underline mx-1">Pillar 2</Link> page.
        </span>
      </section>
    </div>
  );
}

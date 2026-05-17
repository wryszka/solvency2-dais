/**
 * Model Development — Solvency II destination for native models, worked
 * examples, and external engine integration patterns. Phase 9.
 *
 * Three views inside one page. All notebook links resolve to actual workspace
 * paths via /api/model-development/* — no hardcoded user paths.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Beaker, BookOpen, Network, ExternalLink, ArrowRight, Bot,
  AlertTriangle, FlaskConical, Layers,
} from 'lucide-react';

type ViewId = 'native' | 'examples' | 'engines';

interface NativeModel {
  model_id: string;
  name: string;
  domain: string;
  methodology: string;
  status: string;
  illustrative: boolean;
  notebook: string;
  workspace_url: string;
  linked_artefacts: string[];
}

interface WorkedExample {
  title: string;
  description: string;
  methodology: string;
  notebook: string;
  workspace_url: string;
}

interface ExternalEngine {
  engine: string;
  kind: string;
  computes: string;
  integration_flow: string[];
  notebook: string;
  workspace_url: string;
  exchange_volume: string;
}

export default function ModelDevelopment() {
  const [view, setView] = useState<ViewId>('native');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <header>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
            <Beaker className="w-5 h-5 text-blue-700" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-blue-700 font-bold">Model Development</div>
            <h2 className="text-2xl font-bold text-gray-900">Native models, worked examples, engine integrations</h2>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-3xl">
          Source-visible models for Solvency II. Each native model lives as code in this workspace;
          worked-example notebooks show the methodology in detail; external engine integrations
          (Igloo, Prophet) sit alongside as peer artefacts with their own UC Volumes for data exchange.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        <ViewButton active={view === 'native'}   onClick={() => setView('native')}   icon={Layers}   label="Native Models" />
        <ViewButton active={view === 'examples'} onClick={() => setView('examples')} icon={BookOpen} label="Worked Examples" />
        <ViewButton active={view === 'engines'}  onClick={() => setView('engines')}  icon={Network}  label="External Engines" />
      </div>

      {view === 'native'   && <NativeModelsView />}
      {view === 'examples' && <WorkedExamplesView />}
      {view === 'engines'  && <ExternalEnginesView />}

      <section className="bg-violet-50/50 border border-violet-200 rounded-lg p-4 mt-4 flex items-center gap-3">
        <Bot className="w-5 h-5 text-violet-700 shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-violet-900">AI agents are also models.</h3>
          <p className="text-xs text-violet-800 mt-0.5">
            The supervisor + 6 specialist agents are registered in Unity Catalog with versions,
            aliases, MLflow tracing, and serving endpoints — same governance interface as the
            reserving + SF pyfuncs above.
          </p>
        </div>
        <Link to="/governance" className="text-xs font-semibold text-violet-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
          View in Governance → AI <ArrowRight className="w-3 h-3" />
        </Link>
      </section>
    </div>
  );
}

function ViewButton({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-blue-600 text-blue-700 bg-blue-50/50'
               : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
      }`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

/* ═══════════════════════ Native Models view ═══════════════════════ */

// Only the 3 MLflow-versioned models have a Lab detail page. The other native
// notebooks (ORSA engine, cross-QRT recon, risk margin) are surfaced here for
// transparency but have no versioned Lab view to drill into.
const LAB_VISIBLE = new Set(['reserving_pnc', 'reserving_life', 'standard_formula']);

function NativeModelsView() {
  const [models, setModels] = useState<NativeModel[]>([]);
  useEffect(() => {
    fetch('/api/model-development/native-models')
      .then((r) => r.json()).then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
  }, []);
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {models.map((m) => (
        <article key={m.model_id} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
          <header className="flex items-start gap-3 mb-2">
            <FlaskConical className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-gray-900">{m.name}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">{m.domain}</p>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded
              bg-emerald-100 text-emerald-800 border border-emerald-200">{m.status}</span>
          </header>
          <p className="text-sm text-gray-700 leading-relaxed flex-1">{m.methodology}</p>
          {m.illustrative && (
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 self-start">
              <AlertTriangle className="w-3 h-3" />
              Illustrative methodology — replace with your validated method
            </div>
          )}
          {m.linked_artefacts.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-2">
              <span className="font-semibold uppercase tracking-wide text-[9px] text-gray-400 mr-1">consumed by</span>
              {m.linked_artefacts.join(' · ')}
            </p>
          )}
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            {LAB_VISIBLE.has(m.model_id) ? (
              <Link to={`/lab/${m.model_id}`} className="text-blue-700 hover:underline font-semibold inline-flex items-center gap-1">
                View in Lab <ArrowRight className="w-3 h-3" />
              </Link>
            ) : <span />}
            <a href={m.workspace_url} target="_blank" rel="noopener noreferrer"
              className="text-blue-700 hover:underline font-semibold inline-flex items-center gap-1">
              Open notebook <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </article>
      ))}
    </section>
  );
}

/* ═══════════════════════ Worked Examples view ═══════════════════════ */

function WorkedExamplesView() {
  const [examples, setExamples] = useState<WorkedExample[]>([]);
  useEffect(() => {
    fetch('/api/model-development/worked-examples')
      .then((r) => r.json()).then((d) => setExamples(d.examples || []))
      .catch(() => setExamples([]));
  }, []);
  return (
    <section className="space-y-3">
      <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        Each notebook is the same source the production model imports from. The methodology and the implementation are not two artefacts.
      </div>
      <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
        {examples.map((e) => (
          <li key={e.notebook} className="p-4 flex items-start gap-4">
            <BookOpen className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">{e.title}</h3>
              <p className="text-xs text-gray-600 mt-0.5">{e.description}</p>
              <p className="text-[11px] text-gray-500 mt-1">
                <span className="font-semibold uppercase tracking-wide text-[9px] text-gray-400 mr-1">methodology</span>
                {e.methodology}
                <span className="mx-2 text-gray-300">·</span>
                <span className="font-mono text-[10px]">{e.notebook}</span>
              </p>
            </div>
            <a href={e.workspace_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-700 hover:underline font-semibold inline-flex items-center gap-1 whitespace-nowrap">
              Open in workspace <ExternalLink className="w-3 h-3" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ═══════════════════════ External Engines view ═══════════════════════ */

function ExternalEnginesView() {
  const [engines, setEngines] = useState<ExternalEngine[]>([]);
  useEffect(() => {
    fetch('/api/model-development/external-engines')
      .then((r) => r.json()).then((d) => setEngines(d.engines || []))
      .catch(() => setEngines([]));
  }, []);
  return (
    <section className="space-y-4">
      <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        Integration is code, not magic. Notebooks that export to the volume, monitor the run,
        ingest the result, and validate it are all visible. The pattern: any external actuarial
        engine slots in the same way.
      </div>
      {engines.map((e) => (
        <article key={e.engine} className="bg-white border border-gray-200 rounded-xl p-5">
          <header className="flex items-center gap-3 mb-3 pb-3 border-b border-gray-100">
            <Network className="w-5 h-5 text-blue-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-gray-900">{e.engine}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">{e.kind}</p>
            </div>
            <a href={e.workspace_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-700 hover:underline font-semibold inline-flex items-center gap-1">
              Open run notebook <ExternalLink className="w-3 h-3" />
            </a>
          </header>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">{e.computes}</p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {e.integration_flow.map((step, i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded p-2 text-[11px]">
                <div className="text-[9px] uppercase tracking-widest font-bold text-gray-400 mb-0.5">step {i + 1}</div>
                <div className="text-gray-700 leading-snug">{step}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-3 font-mono">{e.exchange_volume}</p>
        </article>
      ))}
    </section>
  );
}

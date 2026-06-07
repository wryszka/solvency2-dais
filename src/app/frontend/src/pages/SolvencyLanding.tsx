/**
 * Solvency II landing — top-level / page.
 *
 * Focused single-app entry (mirrors the claims workbench's dive-straight-in
 * style): a hero header for Bricksurance SE's Solvency II workbench, then
 * four entry cards for the primary surfaces. No cross-app tile hub — the
 * multi-app "Actuarial Workbench" lives in its own app now.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Activity, Layers, Scale, MessageCircleQuestion, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPeriodState } from '../lib/api';

interface Door {
  to: string;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'amber' | 'blue' | 'violet' | 'emerald';
}

const DOORS: Door[] = [
  { to: '/today',           label: 'Control Tower',   blurb: 'Where are we now? Solvency ratio, ORSA posture, pending decisions, and the attention items that need a human today.', icon: Activity,              accent: 'amber' },
  { to: '/reporting-cycle', label: 'Reporting Cycle', blurb: 'The three pillars end-to-end — calculation, governance, disclosure. QRTs, SFCR/RSR/AFR, and the ORSA workflow.',       icon: Layers,                accent: 'blue' },
  { to: '/governance',      label: 'Governance',      blurb: 'Audit trails, model approvals, overlay lifecycle, and every AI decision — one Delta-backed record.',                   icon: Scale,                 accent: 'violet' },
  { to: '/agents',          label: 'Workbench AI',    blurb: 'Ask anything. A supervisor routes your question to one of eight specialists — reserving, cat, ORSA, recon, and more.', icon: MessageCircleQuestion, accent: 'emerald' },
];

const PALETTE = {
  amber:   { border: 'border-amber-300 hover:border-amber-400 hover:shadow-amber-100',     iconBg: 'bg-amber-100 group-hover:bg-amber-200',     iconColor: 'text-amber-700',   title: 'text-amber-900',   arrow: 'text-amber-700' },
  blue:    { border: 'border-blue-300 hover:border-blue-400 hover:shadow-blue-100',         iconBg: 'bg-blue-100 group-hover:bg-blue-200',       iconColor: 'text-blue-700',    title: 'text-blue-900',    arrow: 'text-blue-700' },
  violet:  { border: 'border-violet-300 hover:border-violet-400 hover:shadow-violet-100',   iconBg: 'bg-violet-100 group-hover:bg-violet-200',   iconColor: 'text-violet-700',  title: 'text-violet-900',  arrow: 'text-violet-700' },
  emerald: { border: 'border-emerald-300 hover:border-emerald-400 hover:shadow-emerald-100', iconBg: 'bg-emerald-100 group-hover:bg-emerald-200', iconColor: 'text-emerald-700', title: 'text-emerald-900', arrow: 'text-emerald-700' },
};

export default function SolvencyLanding() {
  const [period, setPeriod] = useState<string | null>(null);
  useEffect(() => {
    fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined);
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-7">
      <header className="pt-2 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-7 h-7 text-blue-700" />
        </div>
        <div className="flex-1">
          <div className="text-[11px] uppercase tracking-widest text-blue-700 font-bold">
            Solvency II Workbench{period ? ` · live cycle ${period}` : ''}
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">Bricksurance SE</h1>
          <p className="text-base text-gray-500 mt-1.5 leading-relaxed max-w-3xl">
            Calculation, governance, and disclosure for a composite insurer — on one lakehouse.
            Pipelines, model governance, overlays, audit, and the AI agent layer all live on the
            same plane. Pick a door to get started.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DOORS.map((d) => {
          const cls = PALETTE[d.accent];
          const Icon = d.icon;
          return (
            <Link key={d.to} to={d.to}
              className={`block bg-white border-2 ${cls.border} rounded-2xl p-5 transition-all hover:shadow-lg group flex flex-col`}>
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl ${cls.iconBg} flex items-center justify-center transition-colors`}>
                  <Icon className={`w-6 h-6 ${cls.iconColor}`} />
                </div>
                <div className="flex-1">
                  <h3 className={`text-xl font-bold ${cls.title} tracking-tight`}>{d.label}</h3>
                </div>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed flex-1">{d.blurb}</p>
              <div className={`mt-3 inline-flex items-center gap-1 text-sm font-bold ${cls.arrow}`}>
                Open <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>

      <details className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-700 mt-2">
        <summary className="font-semibold text-gray-800 cursor-pointer">Platform overview</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            One foundation under every surface — Unity Catalog for governed tables and ML models,
            Delta for storage and time travel, MLflow for model versioning, Mosaic AI for the agent
            layer, Databricks Apps for the surface itself.
          </p>
          <p className="text-[11px] text-gray-500">
            <Link to="/architecture" className="text-blue-600 hover:underline">Architecture diagram</Link>
            {' '}· <Link to="/learn" className="text-blue-600 hover:underline">Regime walk-through</Link>
          </p>
        </div>
      </details>
    </div>
  );
}

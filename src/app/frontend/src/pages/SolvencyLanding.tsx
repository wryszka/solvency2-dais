/**
 * Solvency II landing — top-level / page.
 *
 * Narrative entry modelled on the claims-workbench landing: a centred hero,
 * three CTAs, an "about this demo" honesty box, the regulatory cycle laid out
 * end-to-end as clickable stages, the three platform capabilities, and a
 * START-HERE banner into the Control Tower. No multi-app tile hub — that lives
 * in the separate Actuarial Workbench app now.
 */
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight, Activity, CircleHelp, GraduationCap, RefreshCw,
  Layers, ShieldCheck, Bot,
} from 'lucide-react';
import { fetchPeriodState } from '../lib/api';

interface Stage {
  n: number; title: string; tagline: string; body: string; to: string; accent: string;
}

const STAGES: Stage[] = [
  { n: 1, title: 'Ingestion',     tagline: 'The front door',    body: 'Every source — policies, claims, assets, reinsurance — landed and quality-checked. A late or broken feed blocks everything downstream.', to: '/ingestion',       accent: 'border-t-blue-500' },
  { n: 2, title: 'Reserving',     tagline: 'Set the liabilities', body: 'Best estimate + risk margin per line of business. Chain-ladder and Bornhuetter-Ferguson, with judgemental overlays on top.', to: '/reserving-pnc',  accent: 'border-t-blue-500' },
  { n: 3, title: 'Capital (SCR)', tagline: 'How much to hold',   body: 'Standard Formula: module charges aggregated via the EIOPA correlation matrix, op risk, and LAC. The headline solvency ratio.', to: '/scr',             accent: 'border-t-violet-500' },
  { n: 4, title: 'QRTs',          tagline: 'Fill the templates', body: 'S.05.01, S.06.02, S.12.01, S.25.01, S.26.06 — generated from the gold tables, reconciled across templates before sign-off.', to: '/reporting-cycle', accent: 'border-t-violet-500' },
  { n: 5, title: 'ORSA',          tagline: 'Stress the future',  body: 'Forward projection under stress — sustained low rates, mass lapse, cyber. Continuous, not an annual binder.', to: '/orsa',            accent: 'border-t-emerald-500' },
  { n: 6, title: 'Governance',    tagline: 'Approve & audit',    body: 'Every model promotion, overlay, and AI decision recorded with an approver and a reason. Audit-grade by design.', to: '/governance',      accent: 'border-t-emerald-500' },
  { n: 7, title: 'Disclosure',    tagline: 'File it',            body: 'SFCR, RSR, AFR — the public and supervisory reports, drafted from the same numbers with a Foundation Model writing the narrative.', to: '/pillar-3',        accent: 'border-t-amber-500' },
];

interface Pillar {
  emoji: string; title: string; body: string; to: string; accent: string; link: string;
}

const PILLARS: Pillar[] = [
  { emoji: '🏛️', title: 'One platform — one source of truth', body: 'Ingestion, reserving, capital, QRTs, ORSA and disclosure all read the same governed Delta tables. No copies, no spreadsheet handoffs.', to: '/today',      accent: 'border-t-blue-500',    link: 'text-blue-700' },
  { emoji: '🛡️', title: 'Governance & control',               body: 'See and govern the whole close — model versions, overlays, approvals, and every AI decision audited. The enabler of trust.', to: '/governance', accent: 'border-t-violet-500',  link: 'text-violet-700' },
  { emoji: '🤖', title: 'AI agents that assist',               body: 'A supervisor and a bench of specialists assemble evidence, give a second opinion, and draft the narrative — helping actuaries, never replacing them.', to: '/agents', accent: 'border-t-emerald-500', link: 'text-emerald-700' },
];

export default function SolvencyLanding() {
  const [period, setPeriod] = useState<string | null>(null);
  useEffect(() => {
    fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined);
  }, []);

  return (
    <div className="bg-gray-50 min-h-full">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <header className="text-center max-w-3xl mx-auto">
          <div className="text-[12px] uppercase tracking-[0.18em] text-violet-700 font-bold">
            Bricksurance SE · Solvency II Workbench
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 tracking-tight mt-3 leading-[1.1]">
            Solvency II, end to end — on one platform
          </h1>
          <p className="text-base text-slate-500 mt-4 leading-relaxed">
            From raw feeds to filed returns: every source assembled, every number governed and
            audited, and AI agents helping the actuarial team — built entirely on Databricks.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
            <Link to="/today"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-violet-700 text-white text-sm font-bold hover:bg-violet-800 transition-colors shadow-sm">
              <Activity className="w-4 h-4" /> Open the Control Tower →
            </Link>
            <Link to="/whatif"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-slate-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 transition-colors">
              <CircleHelp className="w-4 h-4" /> See a what-if run live
            </Link>
            <Link to="/learn"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors">
              <GraduationCap className="w-4 h-4" /> Learn Solvency II
            </Link>
          </div>
        </header>

        {/* ── About this demo ──────────────────────────────────── */}
        <div className="max-w-4xl mx-auto bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-[13px] text-amber-900 leading-relaxed">
          <strong>About this demo.</strong> This is <strong>not a Databricks product</strong>. It's an
          example of a real business process — <strong>the Solvency II reporting cycle</strong> — built
          <strong> purely on Databricks</strong>, using standard platform services: Unity Catalog,
          Lakeflow Declarative Pipelines, Auto Loader, Feature Engineering, MLflow, Mosaic AI
          (Model Serving · Agent Framework · Vector Search), AI/BI Genie, the Foundation Model API,
          and Databricks Apps. <strong>Bricksurance SE</strong> is a synthetic composite insurer; all
          data is generated — there is no real customer data.
        </div>

        {/* ── Lifecycle, end to end ────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <h2 className="text-base font-bold text-slate-900">What this is — the reporting cycle, end to end</h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed max-w-4xl mb-5">
            Quarter closes; the platform assembles every source, sets the reserves, computes the
            capital you must hold, fills the regulatory templates, stresses the forward view, and
            files the returns — with a full audit trail. <strong>The numbers decide the capital</strong>,
            so data quality is the centre of gravity. Click any stage to jump to where it lives in the
            workbench{period ? ` (live cycle ${period})` : ''}.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {STAGES.map((s) => (
              <Link key={s.n} to={s.to}
                className={`group flex flex-col rounded-lg border border-slate-200 border-t-4 ${s.accent} bg-white p-3 hover:shadow-md hover:border-slate-300 transition-all`}>
                <div className="text-[11px] font-bold text-slate-400">{s.n}. {s.tagline}</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">{s.title}</div>
                <p className="text-[11px] text-slate-500 leading-snug mt-1 flex-1">{s.body}</p>
                <span className="text-[11px] font-bold text-violet-700 mt-2 inline-flex items-center gap-0.5">
                  open <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Three things ─────────────────────────────────────── */}
        <section>
          <div className="text-[12px] uppercase tracking-[0.16em] text-violet-700 font-bold mb-3">
            The three things this platform makes possible
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PILLARS.map((p) => (
              <Link key={p.title} to={p.to}
                className={`group bg-white border border-slate-200 border-t-4 ${p.accent} rounded-xl p-5 hover:shadow-md transition-all flex flex-col`}>
                <div className="text-2xl">{p.emoji}</div>
                <h3 className="text-base font-bold text-slate-900 mt-3">{p.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mt-1.5 flex-1">{p.body}</p>
                <span className={`text-sm font-bold ${p.link} mt-3 inline-flex items-center gap-1`}>
                  open <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Start here banner ────────────────────────────────── */}
        <Link to="/today"
          className="block bg-slate-900 rounded-2xl px-6 py-5 hover:bg-slate-800 transition-colors group">
          <div className="flex items-center gap-5">
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-violet-300 font-bold">Start here</div>
              <h3 className="text-lg font-bold text-white mt-1">The Control Tower — your solvency book at a glance</h3>
              <p className="text-sm text-slate-300 mt-0.5">
                Today's solvency ratio, the worst-stress posture, what's awaiting sign-off, and the
                attention items that need a human.
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-violet-600 text-white text-sm font-bold group-hover:bg-violet-500 transition-colors shrink-0">
              <Activity className="w-4 h-4" /> Open the Control Tower →
            </span>
          </div>
        </Link>

        <p className="text-center text-[11px] text-slate-400 pt-2 flex items-center justify-center gap-4">
          <Link to="/architecture" className="hover:text-slate-600 inline-flex items-center gap-1"><Layers className="w-3 h-3" /> Architecture</Link>
          <Link to="/governance" className="hover:text-slate-600 inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Governance</Link>
          <Link to="/agents" className="hover:text-slate-600 inline-flex items-center gap-1"><Bot className="w-3 h-3" /> Workbench AI</Link>
        </p>
      </div>
    </div>
  );
}

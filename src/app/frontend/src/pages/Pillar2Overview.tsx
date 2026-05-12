/**
 * Pillar 2 overview hub — Governance.
 *
 * What an actuary cares about when they open the governance pillar:
 *   1. The framework — three lines of defence, articulated
 *   2. The four artefacts (ORSA / Model Gov / AFR / Internal Controls)
 *   3. The model-promotion lifecycle (Champion → Challenger → promote)
 *   4. Continuous vs annual cadence — what runs always, what's once a year
 *   5. The audit trail — where every decision lands
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Scale, ScrollText, Lock, Workflow, ArrowRight, ArrowLeft,
  Users, Eye, Gavel, CheckCircle2, Clock,
  GitMerge, Beaker, Activity, FileSearch, BookOpenCheck,
  Wind, TrendingDown,
} from 'lucide-react';
import { fetchPeriodState, fetchLabModels, type LabModelRow } from '../lib/api';

export default function Pillar2Overview() {
  const [period, setPeriod] = useState<string>('');
  const [models, setModels] = useState<LabModelRow[]>([]);

  useEffect(() => {
    fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined);
    fetchLabModels().then((r) => setModels(r.models)).catch(() => undefined);
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-7">
      <Link to="/reporting-cycle" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Reporting Cycle
      </Link>

      <Hero period={period} />

      <Section
        title="The three lines of defence"
        subtitle="Solvency II's governance system is structured. Each line owns specific decisions and produces specific evidence; the workbench makes that evidence machine-readable instead of email-shaped."
      >
        <ThreeLinesDiagram />
      </Section>

      <Section
        title="The four governance artefacts"
        subtitle="Each card is a live surface. ORSA + AFR are point-in-time narratives that draw on Pillar 1 numbers; Model Governance + Internal Controls are continuous."
      >
        <CapabilityGrid models={models} />
      </Section>

      <Section
        title="Model promotion — end to end"
        subtitle="The most common governance flow. A challenger out-performs the champion in shadow; the workbench captures the diagnostics, runs the approval, and updates every downstream artefact."
      >
        <ModelPromotionDiagram />
      </Section>

      <Section
        title="Model inventory — by criticality tier"
        subtitle="Solvency II governance recognises that not every model matters equally. The platform tiers them — Tier 1 (drives SCR + SFCR) · Tier 2 (feeds a Tier 1) · Tier 3 (advisory). Tier sets the validation cadence, the approval level, and the Board visibility."
      >
        <ModelInventoryByTier models={models} />
      </Section>

      <Section
        title="ORSA — the standing scenario menu"
        subtitle="What's running in the continuous draft right now. Base + four stresses + reverse stress · 3-year horizon · each scenario tied to a recent governance decision (the Article 45 use test)."
      >
        <ORSAScenarioMenu />
      </Section>

      <Section
        id="use-test"
        title="Article 45 use test — the evidence layer"
        subtitle="Solvency II requires evidence that ORSA outputs actually shape decisions, not sit in a PDF. Each row is a real governance action that referenced a specific ORSA scenario · Board minute reference · date · who signed it."
      >
        <UseTestEvidence />
      </Section>

      <Section
        id="article-48"
        title="AFR — Article 48 crosswalk"
        subtitle="The seven obligations of the Actuarial Function under Article 48 of the Solvency II Directive — mapped against what the platform delivers, and what still needs human judgement."
      >
        <Article48Crosswalk />
      </Section>

      <Section
        id="fit-and-proper"
        title="Article 42 — fit-and-proper register"
        subtitle="Every key function holder must be fit (competence + experience) and proper (integrity + financial soundness) on appointment, with periodic re-assessment. The register is what the supervisor reviews on inspection."
      >
        <FitProperRegister />
      </Section>

      <Section
        title="Continuous vs annual"
        subtitle="Some governance runs every quarter (or every model output). Some runs once a year. Both live on the same audit chain."
      >
        <ContinuousAnnualTable />
      </Section>

      <Section
        id="audit-trail"
        title="The audit trail"
        subtitle="Every decision — overlay approved, model promoted, ORSA stress added, AFR section signed — lands as an immutable event in 6_gov_audit_log. Internal Controls reads from there."
      >
        <AuditTrailNote />
      </Section>

      <div className="text-center text-[11px] text-gray-400 italic pt-3">
        Pillar 2 is the judgement framework. The numbers it judges live in <Link to="/pillar-1" className="text-emerald-700 hover:underline">Pillar 1</Link>;
        the disclosures it underpins live in <Link to="/pillar-3" className="text-emerald-700 hover:underline">Pillar 3</Link>.
      </div>
    </div>
  );
}

/* ═══════ Sections ═══════ */

function Hero({ period }: { period: string }) {
  return (
    <header className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 text-white rounded-2xl p-7 shadow-lg">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-emerald-300">
        <Scale className="w-3.5 h-3.5" /> Pillar 2 — governance
      </div>
      <h1 className="text-3xl font-bold tracking-tight mt-1.5">
        The judgement framework around the numbers.
      </h1>
      <p className="text-sm text-emerald-100 mt-2 leading-relaxed max-w-3xl">
        Pillar 1 says what the SCR is. Pillar 2 says why we believe it — what assumptions, what overlays,
        what models, what stresses, who signed it off. Four interlocking artefacts: ORSA, Model Governance,
        Actuarial Function Report, Internal Controls.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs text-emerald-300">
        <span className="font-mono">Current cycle:</span>
        <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-white">{period || '…'}</code>
        <span className="text-emerald-400/70">·</span>
        <span>3 lines of defence · alias-based model promotion · continuous ORSA draft</span>
      </div>
    </header>
  );
}

function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <header>
        <h2 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/* ═══════ Three lines of defence ═══════ */

function ThreeLinesDiagram() {
  const lines = [
    {
      n: 1, name: 'Business owners', icon: Users,
      who: 'Underwriters · pricing · claims · reserving teams',
      what: 'Run the day-to-day actuarial work — pricing, reserving model fits, overlay proposals.',
      surface: '/lab',
      surfaceLabel: 'Actuarial Lab',
      tone: 'sky',
    },
    {
      n: 2, name: 'Risk + Actuarial Function', icon: Eye,
      who: 'CRO office · Actuarial Function holder (Article 48)',
      what: 'Independent review of TPs, UW policy, reinsurance, internal models. Annual AFR. Continuous ORSA.',
      surface: '/afr',
      surfaceLabel: 'Actuarial Function Report',
      tone: 'emerald',
    },
    {
      n: 3, name: 'Internal Audit', icon: Gavel,
      who: 'Internal audit · external auditor liaison',
      what: 'Audit of governance + controls — sample-based, schedule-driven, evidence from the audit log.',
      surface: '/internal-controls',
      surfaceLabel: 'Internal Controls',
      tone: 'amber',
    },
  ];

  const toneCls: Record<string, { border: string; bg: string; iconBg: string; iconText: string; chip: string }> = {
    sky:     { border: 'border-sky-200',     bg: 'bg-sky-50/40',     iconBg: 'bg-sky-100',     iconText: 'text-sky-700',     chip: 'bg-sky-100 text-sky-800 border-sky-200' },
    emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50/40', iconBg: 'bg-emerald-100', iconText: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    amber:   { border: 'border-amber-200',   bg: 'bg-amber-50/40',   iconBg: 'bg-amber-100',   iconText: 'text-amber-700',   chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {lines.map((l) => {
        const c = toneCls[l.tone];
        const Icon = l.icon;
        return (
          <article key={l.n} className={`border-2 ${c.border} ${c.bg} rounded-xl p-4 bg-white`}>
            <header className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg ${c.iconBg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-5 h-5 ${c.iconText}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${c.chip}`}>
                    Line {l.n}
                  </span>
                  <h3 className="text-base font-bold text-gray-900">{l.name}</h3>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 italic">{l.who}</p>
              </div>
            </header>
            <p className="text-sm text-gray-700 mt-3 leading-relaxed">{l.what}</p>
            <Link to={l.surface}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
              Open {l.surfaceLabel} <ArrowRight className="w-3 h-3" />
            </Link>
          </article>
        );
      })}
    </div>
  );
}

/* ═══════ Capability grid ═══════ */

function CapabilityGrid({ models }: { models: LabModelRow[] }) {
  const pending = models.reduce((acc, m) => acc + (m.pending_promotions ?? 0), 0);
  const cards = [
    {
      icon: Workflow, title: 'ORSA',
      to: '/orsa',
      tagline: 'Continuous solvency assessment + capital projection',
      what: '3-year capital projection under base + stress scenarios. Continuous draft updates as overlays approve and models promote; annual board-approved version snapshots from the draft.',
      cadence: 'Continuous draft · annual board approval',
      kpi: 'Draft updated within 24h of any approval',
      open: 'Open ORSA',
    },
    {
      icon: Scale, title: 'Model Governance',
      to: '/model-governance',
      tagline: 'Champion / Challenger · alias-based promotion',
      what: 'Every model has production + candidate aliases in MLflow. Candidates run in shadow; diagnostics decide promotion; the alias flip is the cutover and is logged.',
      cadence: 'Continuous · promotions logged on event',
      kpi: pending > 0 ? `${pending} pending promotion${pending === 1 ? '' : 's'}` : 'No pending promotions',
      open: 'Open Model Governance',
    },
    {
      icon: ScrollText, title: 'Actuarial Function Report',
      to: '/afr',
      tagline: 'Article 48 — annual, supervisor-visible',
      what: 'Five sections: technical provisions adequacy, underwriting policy, reinsurance arrangements, internal model (if applicable), data quality + ICT. Pulls live numbers + commentary from Pillar 1.',
      cadence: 'Annual · once a year, supervisor-visible',
      kpi: 'Draft auto-populated from latest gold + diagnostics',
      open: 'Open AFR',
    },
    {
      icon: Lock, title: 'Internal Controls',
      to: '/internal-controls',
      tagline: 'AI guardrails · architectural assertions · audit',
      what: 'Three layers: AI agent guardrails (every Genie / Workbench Assistant response logged + classified), architectural assertions (no model writes gold directly, every overlay has a rationale), audit log read-back.',
      cadence: 'Always-on',
      kpi: 'Live event count in 6_gov_audit_log',
      open: 'Open Internal Controls',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.title} to={c.to}
            className="block border-2 border-emerald-200 bg-emerald-50/30 rounded-xl p-4 bg-white hover:border-emerald-400 hover:shadow transition-all group">
            <header className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-gray-900">{c.title}</h3>
                <p className="text-[11px] text-emerald-700/80 italic">{c.tagline}</p>
              </div>
            </header>
            <p className="text-sm text-gray-700 mt-3 leading-relaxed">{c.what}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Cadence</div>
                <div className="text-gray-800 mt-0.5">{c.cadence}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Live signal</div>
                <div className="text-gray-800 mt-0.5">{c.kpi}</div>
              </div>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 group-hover:text-emerald-900">
              {c.open} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ═══════ Model promotion lifecycle ═══════ */

function ModelPromotionDiagram() {
  const stages = [
    { label: 'Challenger trained', sub: 'New version registered as candidate alias', icon: Beaker, tone: 'sky' },
    { label: 'Shadow run',         sub: 'Q-end production + candidate both run; diagnostics compare', icon: Activity, tone: 'sky' },
    { label: 'Diagnostics passed', sub: 'Triangle consistency · AvE · bias · drift — all thresholds clear', icon: CheckCircle2, tone: 'emerald' },
    { label: 'Approval recorded',  sub: 'Justification + approver captured in 6_gov_promotions', icon: BookOpenCheck, tone: 'emerald' },
    { label: 'Alias flip',         sub: 'MLflow set_registered_model_alias — atomic, audited', icon: GitMerge, tone: 'emerald' },
    { label: 'Downstream updates', sub: 'ORSA draft refreshes · AFR section flagged for re-review · audit log entry', icon: FileSearch, tone: 'amber' },
  ];
  const cls = (tone: string) => ({
    sky:     'border-sky-200 bg-sky-50/40 text-sky-900',
    emerald: 'border-emerald-200 bg-emerald-50/40 text-emerald-900',
    amber:   'border-amber-200 bg-amber-50/40 text-amber-900',
  }[tone] ?? '');

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {stages.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-1">
              <div className={`border-2 rounded-lg px-3 py-2.5 min-w-[180px] ${cls(s.tone)}`}>
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold">{s.label}</span>
                </div>
                <div className="text-[10px] mt-1 leading-snug opacity-80">{s.sub}</div>
              </div>
              {i < stages.length - 1 && (
                <svg width={22} height={20} viewBox="0 0 22 20" className="text-emerald-400 shrink-0">
                  <path d="M 0 10 L 18 10 M 14 5 L 19 10 L 14 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500 mt-3 italic">
        The alias flip is the moment of cutover — atomic, reversible, and visible. Every downstream artefact
        (ORSA, AFR, the SCR itself) re-reads from the new champion the next time it materialises.
      </p>
    </div>
  );
}

/* ═══════ Continuous vs annual ═══════ */

function ContinuousAnnualTable() {
  const rows = [
    { artefact: 'ORSA',              cadence: 'Continuous draft + annual board approval', what: 'Stress + projection refresh on any approved overlay or promoted model · annual snapshot to board' },
    { artefact: 'Model Governance', cadence: 'Continuous · event-driven',                  what: 'Every promotion / candidate registration / diagnostic failure is an event' },
    { artefact: 'Actuarial Function Report', cadence: 'Annual',                            what: 'Five Article 48 sections compiled from live Pillar 1 + governance state at year-end' },
    { artefact: 'Internal Controls', cadence: 'Always-on',                                 what: 'Guardrails block invalid actions live; assertions run on every gold materialisation; audit log is append-only' },
    { artefact: 'Audit log',         cadence: 'Append-only · queryable',                   what: 'Every decision lands here within seconds; Pillar 3 audit pulls from it' },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-emerald-50 text-[10px] uppercase tracking-widest text-emerald-900">
          <tr>
            <th className="text-left px-4 py-2.5">Artefact</th>
            <th className="text-left px-4 py-2.5">Cadence</th>
            <th className="text-left px-4 py-2.5">What that means in practice</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.artefact} className="border-t border-gray-100">
              <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{r.artefact}</td>
              <td className="px-4 py-2.5 text-xs text-emerald-800 font-mono">{r.cadence}</td>
              <td className="px-4 py-2.5 text-xs text-gray-700 leading-relaxed">{r.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════ Audit trail note ═══════ */

function AuditTrailNote() {
  const eventTypes = [
    { label: 'overlay_approved', desc: 'Reserve / SCR overlay approved by Senior Reserving Actuary' },
    { label: 'model_promoted',   desc: 'Champion alias flipped after diagnostics + justification' },
    { label: 'orsa_stress_run',  desc: 'New stress scenario added to continuous ORSA draft' },
    { label: 'afr_section_signed', desc: 'AFR Article 48 section signed off by Actuarial Function holder' },
    { label: 'control_failed',   desc: 'Internal control assertion failed — manual review required' },
    { label: 'ai_action',        desc: 'Genie / Workbench Assistant action — query, recommendation, escalation' },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <FileSearch className="w-4 h-4 text-emerald-700" />
          Event types
        </h4>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
          The audit log is a Delta table — append-only, partitioned by event date,
          queryable from Genie or directly. Pillar 3 audit answers pull from it.
        </p>
        <code className="block mt-2 text-[10px] font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-200">
          6_gov_audit_log
        </code>
      </div>
      <ul className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {eventTypes.map((e) => (
          <li key={e.label} className="flex items-start gap-2 text-xs">
            <Clock className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <code className="font-mono text-emerald-700 font-semibold">{e.label}</code>
              <p className="text-gray-600 leading-snug mt-0.5">{e.desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══════ Model inventory by criticality tier ═══════ */

interface TierClassification { tier: 1 | 2 | 3; reason: string; }

const MODEL_TIERS: Record<string, TierClassification> = {
  standard_formula:  { tier: 1, reason: 'Drives the SCR — direct input to SFCR + RSR.' },
  reserving_pnc:     { tier: 1, reason: 'Drives technical provisions — direct input to SCR + SFCR.' },
  reserving_life:    { tier: 1, reason: 'Drives life TPs (S.12.01) — direct input to SCR life sub-modules.' },
  igloo_cat:         { tier: 1, reason: 'Drives non-life cat charge — direct input to SCR_non_life.' },
  prophet_life:      { tier: 1, reason: 'Drives life UW sub-modules — direct input to SCR_life.' },
  sf_challenger:     { tier: 2, reason: 'Shadow candidate to standard_formula. Cannot reach gold without alias flip.' },
  cat_agent:         { tier: 3, reason: 'Advisory AI agent — surfaces anomalies; does not write to gold.' },
  reserving_agent:   { tier: 3, reason: 'Advisory AI agent — drafts overlay proposals; human approval required.' },
  regulator_qa_agent:{ tier: 3, reason: 'Drafts answers to supervisor questions; human signs before send.' },
};

const TIER_RULES: Record<1 | 2 | 3, { label: string; cadence: string; approval: string; cls: string; iconCls: string }> = {
  1: {
    label: 'Tier 1 — material to SCR + SFCR',
    cadence: 'Validation: annual independent + quarterly diagnostics',
    approval: 'Board approval for promotion · CRO + Actuarial Function Holder co-sign',
    cls: 'border-rose-300 bg-rose-50/40',
    iconCls: 'bg-rose-100 text-rose-700',
  },
  2: {
    label: 'Tier 2 — feeds a Tier 1',
    cadence: 'Validation: quarterly diagnostics · annual review',
    approval: 'CRO sign-off on promotion · Actuarial Function Holder informed',
    cls: 'border-amber-300 bg-amber-50/40',
    iconCls: 'bg-amber-100 text-amber-700',
  },
  3: {
    label: 'Tier 3 — advisory only',
    cadence: 'Validation: every release · prompt + grounding checks',
    approval: 'Model owner sign-off · Internal Controls audit',
    cls: 'border-slate-300 bg-slate-50/40',
    iconCls: 'bg-slate-100 text-slate-700',
  },
};

function ModelInventoryByTier({ models }: { models: LabModelRow[] }) {
  const byTier: Record<1 | 2 | 3, Array<LabModelRow & { reason: string }>> = { 1: [], 2: [], 3: [] };

  // Include every governance-known model plus any classification-only models
  // (e.g. agents that may not be in the registry yet).
  const knownIds = new Set(models.map((m) => m.model_id));
  for (const m of models) {
    const t = MODEL_TIERS[m.model_id];
    if (!t) continue;
    byTier[t.tier].push({ ...m, reason: t.reason });
  }
  // Add advisory/agent entries that may exist as classification-only
  for (const [id, t] of Object.entries(MODEL_TIERS)) {
    if (!knownIds.has(id) && t.tier === 3) {
      byTier[3].push({
        model_id: id, label: id.replace(/_/g, ' '),
        engine: 'advisory agent', engine_tag: 'native',
        production_version: null, candidate_version: null,
        n_versions: 0, owner: null, reason: t.reason,
      } as LabModelRow & { reason: string });
    }
  }

  return (
    <div className="space-y-3">
      {[1, 2, 3].map((tier) => {
        const t = TIER_RULES[tier as 1 | 2 | 3];
        const rows = byTier[tier as 1 | 2 | 3];
        return (
          <div key={tier} className={`border-2 rounded-xl p-4 bg-white ${t.cls}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-lg ${t.iconCls}`}>
                T{tier}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-gray-900">{t.label}</h3>
                <div className="text-[11px] text-gray-700 mt-1 leading-relaxed space-y-0.5">
                  <div><span className="font-semibold">Cadence:</span> {t.cadence}</div>
                  <div><span className="font-semibold">Promotion:</span> {t.approval}</div>
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mt-1.5">
                {rows.length} model{rows.length === 1 ? '' : 's'}
              </div>
            </div>
            {rows.length > 0 && (
              <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {rows.map((m) => (
                  <li key={m.model_id}>
                    <Link to={`/lab/${m.model_id}`}
                      className="block rounded-md border border-gray-200 bg-white px-3 py-2 hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{m.label}</span>
                        {m.engine_tag === 'external' && (
                          <span className="text-[9px] uppercase tracking-wide font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800">external</span>
                        )}
                        {m.production_version && (
                          <span className="text-[10px] font-mono text-gray-500">prod {m.production_version}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{m.reason}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-gray-500 italic">
        Tiering drives validation cadence and approval routing. The same model registry serves all three; the tier is a governance attribute, not an engine property.
      </p>
    </div>
  );
}

/* ═══════ ORSA standing scenario menu ═══════ */

interface ORSAScenario {
  name: string;
  kind: 'Base' | 'Stress' | 'Reverse' | 'Strategic';
  horizon: string;
  detail: string;
  use_test: string;
  tone: 'sky' | 'amber' | 'rose' | 'violet' | 'emerald';
}

const ORSA_SCENARIOS: ORSAScenario[] = [
  {
    name: 'Base case',
    kind: 'Base',
    horizon: '3-year',
    detail: 'Strategic plan economic assumptions · current asset mix · ratepath as filed with the Board.',
    use_test: 'Quarterly capital projection presented to Board Risk Committee · informs the annual dividend policy.',
    tone: 'sky',
  },
  {
    name: 'Plausible adverse',
    kind: 'Stress',
    horizon: '3-year',
    detail: '−15% equity · +75bps credit spread · +50bps IR · 5% mortality deterioration · UL lapse +20%.',
    use_test: 'Risk-appetite test — solvency ratio must stay above 140%. Informed the 2025-Q3 cyber-cover sub-limit.',
    tone: 'amber',
  },
  {
    name: 'Severe adverse',
    kind: 'Stress',
    horizon: '3-year',
    detail: '−30% equity · +200bps spread · −100bps IR · 1-in-50 European storm + pandemic-shape lapse.',
    use_test: 'Capital adequacy assessment for Article 45. Drove the 2026 reinsurance treaty restructure to lower XOL retention.',
    tone: 'rose',
  },
  {
    name: 'Reverse stress',
    kind: 'Reverse',
    horizon: '3-year',
    detail: 'Search for the scenario that breaches MCR — outcome: 1-in-100 European storm + 50bps quarterly UL lapse spike + 30% spread move on corporate bond book.',
    use_test: 'Required disclosure in ORSA narrative · evidence presented at March 2026 Board.',
    tone: 'rose',
  },
  {
    name: 'Climate transition (NGFS Net Zero 2050)',
    kind: 'Strategic',
    horizon: '5-year',
    detail: 'Stranded-asset impact on corporate-bond book under NGFS "Net Zero by 2050" pathway. Brown-sector credit-spread widening over 5 years.',
    use_test: 'Climate disclosure (SFCR Section C.6 — Other material risks · climate) · informed the ESG-tilted investment mandate review.',
    tone: 'emerald',
  },
  {
    name: 'Pandemic re-run',
    kind: 'Strategic',
    horizon: '3-year',
    detail: 'COVID-shape joint shock: life cat + bond spread widening + unit-linked lapse surge. Calibrated to 2020 experience + 30% severity uplift.',
    use_test: 'Business continuity review · sense-check for life UW SCR sub-modules.',
    tone: 'violet',
  },
];

const ORSA_TONES: Record<ORSAScenario['tone'], { border: string; bg: string; text: string; chip: string; chipBg: string }> = {
  sky:     { border: 'border-sky-200',     bg: 'bg-sky-50/40',     text: 'text-sky-900',     chip: 'text-sky-700',     chipBg: 'bg-sky-100' },
  amber:   { border: 'border-amber-200',   bg: 'bg-amber-50/40',   text: 'text-amber-900',   chip: 'text-amber-700',   chipBg: 'bg-amber-100' },
  rose:    { border: 'border-rose-200',    bg: 'bg-rose-50/40',    text: 'text-rose-900',    chip: 'text-rose-700',    chipBg: 'bg-rose-100' },
  violet:  { border: 'border-violet-200',  bg: 'bg-violet-50/40',  text: 'text-violet-900',  chip: 'text-violet-700',  chipBg: 'bg-violet-100' },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50/40', text: 'text-emerald-900', chip: 'text-emerald-700', chipBg: 'bg-emerald-100' },
};

function ORSAScenarioMenu() {
  const KIND_ICON: Record<ORSAScenario['kind'], React.ComponentType<{ className?: string }>> = {
    Base: Activity, Stress: Wind, Reverse: TrendingDown, Strategic: Beaker,
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {ORSA_SCENARIOS.map((s) => {
          const t = ORSA_TONES[s.tone];
          const Icon = KIND_ICON[s.kind];
          return (
            <article key={s.name} className={`border-2 ${t.border} ${t.bg} rounded-xl p-4 bg-white`}>
              <header className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg ${t.chipBg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-4 h-4 ${t.chip}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h3 className={`text-base font-bold ${t.text}`}>{s.name}</h3>
                    <span className={`text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded ${t.chipBg} ${t.chip}`}>{s.kind}</span>
                    <span className="text-[10px] font-mono text-gray-500">{s.horizon}</span>
                  </div>
                </div>
              </header>
              <p className="text-xs text-gray-700 mt-2 leading-relaxed">{s.detail}</p>
              <div className="mt-2 pt-2 border-t border-gray-100">
                <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-700 flex items-center gap-1">
                  <BookOpenCheck className="w-3 h-3" />
                  Use test — where this fed a decision
                </div>
                <p className="text-[11px] text-gray-600 italic mt-1 leading-snug">{s.use_test}</p>
              </div>
            </article>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500 italic">
        The use-test column is the Article 45 evidence — proof that ORSA outputs actually shape decisions, not sit in a PDF. Every scenario refresh updates the linked Board paper.
      </p>
    </div>
  );
}

/* ═══════ Article 48 crosswalk ═══════ */

interface Article48Obligation {
  ref: string;
  obligation: string;
  platform: string;
  judgement: string;
  link?: { to: string; label: string };
}

const ARTICLE_48: Article48Obligation[] = [
  {
    ref: 'Art. 48(1)(a)',
    obligation: 'Coordinate the calculation of technical provisions',
    platform: 'Reserving (P&C + Life) models in MLflow registry · alias-driven version control · audit log of every assumption change.',
    judgement: 'Methodology selection (CL vs BF vs GLM) and tail-shape calls remain the actuary\'s domain.',
    link: { to: '/lab', label: 'Reserving · Lab' },
  },
  {
    ref: 'Art. 48(1)(b)',
    obligation: 'Ensure the appropriateness of methodologies and underlying models',
    platform: 'Champion / Challenger continuous comparison · Tier 1/2/3 governance · diagnostics on every run.',
    judgement: 'Appropriateness test — has the business changed? Does the model still fit the portfolio?',
    link: { to: '/model-governance', label: 'Model Governance' },
  },
  {
    ref: 'Art. 48(1)(c)',
    obligation: 'Assess the sufficiency and quality of data',
    platform: 'Data quality framework on every bronze feed · pass-rate trends · failing-records audit · linked to AFR opinion.',
    judgement: 'Data sufficiency for new lines of business, M&A integration, or rare events.',
    link: { to: '/today', label: 'DQ trends · Control Tower' },
  },
  {
    ref: 'Art. 48(1)(d)',
    obligation: 'Compare best estimates against experience',
    platform: 'AvE diagnostics per model per quarter · drift detection · variance-to-prior in 6_gov_model_diagnostics.',
    judgement: 'Interpretation of drift — one-off vs trend; portfolio shift vs methodology gap.',
    link: { to: '/lab', label: 'Diagnostics · Lab' },
  },
  {
    ref: 'Art. 48(1)(e)',
    obligation: 'Inform the administrative, management or supervisory body on the reliability and adequacy of TPs',
    platform: 'AFR draft auto-populated from gold + diagnostics · annual + quarterly TP-adequacy statement template.',
    judgement: 'The AFR opinion itself — written, signed, defended.',
    link: { to: '/afr', label: 'AFR drafts' },
  },
  {
    ref: 'Art. 48(1)(f)',
    obligation: 'Express an opinion on the overall underwriting policy',
    platform: 'UW concentration, profitability by LoB, pricing-vs-experience tracking on the gold layer.',
    judgement: 'Whether the UW appetite remains commensurate with the firm\'s risk profile.',
  },
  {
    ref: 'Art. 48(1)(g)',
    obligation: 'Express an opinion on the adequacy of reinsurance arrangements',
    platform: 'Treaty inventory · cat-engine recovery modelling · ROL by layer · counterparty default tracking.',
    judgement: 'Adequacy in the next cycle — broker negotiations and treaty restructuring.',
  },
  {
    ref: 'Art. 48(1)(h)',
    obligation: 'Contribute to the effective implementation of the risk management system, in particular ORSA',
    platform: 'ORSA continuous draft · scenario menu · use-test trail · Internal Controls audit log.',
    judgement: 'Scenario selection and reverse-stress design — the actuary chooses what to test.',
    link: { to: '/orsa', label: 'ORSA' },
  },
];

function Article48Crosswalk() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-emerald-50 text-[10px] uppercase tracking-widest text-emerald-900">
          <tr>
            <th className="text-left px-4 py-2.5 w-[10%]">Ref</th>
            <th className="text-left px-4 py-2.5 w-[26%]">Obligation</th>
            <th className="text-left px-4 py-2.5 w-[34%]">What the platform delivers</th>
            <th className="text-left px-4 py-2.5">What stays with the actuary</th>
          </tr>
        </thead>
        <tbody>
          {ARTICLE_48.map((o) => (
            <tr key={o.ref} className="border-t border-gray-100 align-top">
              <td className="px-4 py-2.5 text-xs font-mono text-emerald-800 whitespace-nowrap">{o.ref}</td>
              <td className="px-4 py-2.5 text-xs text-gray-900 font-semibold leading-snug">{o.obligation}</td>
              <td className="px-4 py-2.5 text-xs text-blue-900 leading-relaxed">
                {o.platform}
                {o.link && (
                  <>
                    {' '}
                    <Link to={o.link.to} className="inline-flex items-center gap-0.5 text-blue-700 font-semibold hover:underline whitespace-nowrap">
                      {o.link.label} <ArrowRight className="w-3 h-3" />
                    </Link>
                  </>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs text-gray-700 leading-relaxed italic">{o.judgement}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
        Two columns: machine and human. The platform doesn't replace the Actuarial Function Holder — it removes the integration tax that today eats two-thirds of their time.
      </p>
    </div>
  );
}


/* ═══════ Use-test evidence (Article 45) ═══════ */

interface UseTestRow {
  date: string;
  decision: string;
  scenario_ref: string;
  forum: string;
  outcome: string;
  artefact_link?: { to: string; label: string };
}

const USE_TEST_ROWS: UseTestRow[] = [
  {
    date: '2026-03-18',
    decision: 'Reduced XOL retention from EUR 50M to EUR 35M for property treaty',
    scenario_ref: 'Severe adverse · 1-in-50 European storm component',
    forum: 'Board Risk Committee · minute BRC-2026-03',
    outcome: 'Approved · new placement effective 2026-04-01 · annualised cost +EUR 4.2M, projected SCR_non_life relief −EUR 28M.',
    artefact_link: { to: '/orsa', label: 'Linked ORSA run' },
  },
  {
    date: '2026-01-22',
    decision: 'Cyber-cover sub-limit reduced from EUR 25M to EUR 15M per insured',
    scenario_ref: 'Plausible adverse · UL lapse +20% combined with cyber-aggregation tail',
    forum: 'Underwriting Committee · minute UC-2026-01-Q1',
    outcome: 'Effective on new business 2026-02-01 · book-wide review of in-force cyber complete by Q2.',
  },
  {
    date: '2025-11-05',
    decision: 'ESG-tilted bond mandate redirected · stranded-asset exposure reduced',
    scenario_ref: 'Climate transition NGFS Net Zero 2050',
    forum: 'Board Investment Committee · minute IC-2025-11',
    outcome: 'EUR 180M re-allocated from brown-sector corporates to investment-grade transition leaders; SFCR Section C.6 narrative updated.',
    artefact_link: { to: '/sfcr', label: 'SFCR Section C.6' },
  },
  {
    date: '2025-09-12',
    decision: 'Annual dividend policy reduced from 55% to 45% of net income',
    scenario_ref: 'Base case + plausible adverse · 3-year capital projection',
    forum: 'Board · minute B-2025-09-Q3',
    outcome: 'Approved · reinforces solvency ratio target band 160–180%; signalled to rating agencies before AGM.',
  },
  {
    date: '2025-07-24',
    decision: 'Mortality experience study triggered for life portfolio',
    scenario_ref: 'Reverse stress · 50bps UL lapse spike + 30% spread move surfaced lapse sensitivity',
    forum: 'Actuarial Function · AFR quarterly review',
    outcome: 'Experience study commissioned · longevity assumption review brought forward 6 months; informed S.12.01 BE for 2025-Q4.',
    artefact_link: { to: '/reserving-life', label: 'Life Reserving' },
  },
];

function UseTestEvidence() {
  return (
    <div className="bg-white border-2 border-emerald-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-emerald-200 bg-emerald-50/60 flex items-center gap-2">
        <BookOpenCheck className="w-4 h-4 text-emerald-700" />
        <h4 className="text-sm font-bold text-emerald-900">Recent decisions referencing an ORSA scenario</h4>
        <span className="ml-auto text-[11px] text-emerald-700 font-mono">{USE_TEST_ROWS.length} entries · last 12 months</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-600">
          <tr>
            <th className="text-left px-3 py-2.5 w-[12%]">Date</th>
            <th className="text-left px-3 py-2.5 w-[24%]">Decision</th>
            <th className="text-left px-3 py-2.5 w-[20%]">Scenario referenced</th>
            <th className="text-left px-3 py-2.5 w-[18%]">Forum</th>
            <th className="text-left px-3 py-2.5">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {USE_TEST_ROWS.map((r) => (
            <tr key={r.date + r.decision} className="border-t border-gray-100 align-top">
              <td className="px-3 py-2.5 text-xs font-mono text-gray-700 whitespace-nowrap">{r.date}</td>
              <td className="px-3 py-2.5 text-xs text-gray-900 font-semibold leading-snug">{r.decision}</td>
              <td className="px-3 py-2.5 text-xs text-violet-800 italic leading-snug">{r.scenario_ref}</td>
              <td className="px-3 py-2.5 text-[11px] text-gray-600 font-mono leading-snug">{r.forum}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700 leading-relaxed">
                {r.outcome}
                {r.artefact_link && (
                  <>
                    {' '}
                    <Link to={r.artefact_link.to} className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold hover:underline whitespace-nowrap">
                      {r.artefact_link.label} <ArrowRight className="w-3 h-3" />
                    </Link>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
        This is the Article 45 evidence layer. When the supervisor or the AFR holder asks "how does ORSA actually influence decisions?", this table — and the Board minutes it links to — is the answer.
      </p>
    </div>
  );
}

/* ═══════ Fit-and-proper register (Article 42) ═══════ */

interface FitProperEntry {
  role: string;
  holder: string;
  appointed: string;
  reassessment_due: string;
  qualifications: string;
  fit: 'pass' | 'review' | 'flag';
  proper: 'pass' | 'review' | 'flag';
}

const FP_ENTRIES: FitProperEntry[] = [
  {
    role: 'CEO',
    holder: 'Dr. Helmut Brandt',
    appointed: '2022-04-01',
    reassessment_due: '2027-04-01',
    qualifications: 'MBA INSEAD · 22yr insurance · prior CEO (Munich subsidiary)',
    fit: 'pass', proper: 'pass',
  },
  {
    role: 'CFO',
    holder: 'Anna Schultz',
    appointed: '2023-09-01',
    reassessment_due: '2026-09-01',
    qualifications: 'CFA · ACA · 17yr insurance finance · prior Group FC',
    fit: 'pass', proper: 'pass',
  },
  {
    role: 'Chief Risk Officer',
    holder: 'Dr. Petra Lindemann',
    appointed: '2021-01-15',
    reassessment_due: '2026-01-15',
    qualifications: 'FIA · PhD Stochastic Modelling · 19yr risk · DAV member',
    fit: 'review', proper: 'pass',
  },
  {
    role: 'Actuarial Function Holder',
    holder: 'Stefan Köhler',
    appointed: '2024-06-01',
    reassessment_due: '2027-06-01',
    qualifications: 'FIA · FSA · 14yr reserving · DAV-certified life + non-life',
    fit: 'pass', proper: 'pass',
  },
  {
    role: 'Head of Internal Audit',
    holder: 'Marco Rossi',
    appointed: '2022-11-01',
    reassessment_due: '2025-11-01',
    qualifications: 'CIA · ACCA · 18yr audit · Big-4 background',
    fit: 'pass', proper: 'review',
  },
  {
    role: 'Head of Compliance',
    holder: 'Julia Vogel',
    appointed: '2023-03-01',
    reassessment_due: '2026-03-01',
    qualifications: 'LLM (Hamburg) · 12yr regulatory compliance · BaFin liaison',
    fit: 'pass', proper: 'pass',
  },
];

const FP_BADGE: Record<FitProperEntry['fit'], { label: string; cls: string }> = {
  pass:    { label: 'pass',           cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  review:  { label: 'review due',     cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  flag:    { label: 'flag',           cls: 'bg-rose-100 text-rose-800 border-rose-200' },
};

function FitProperRegister() {
  const summary = FP_ENTRIES.reduce(
    (acc, e) => {
      if (e.fit === 'flag' || e.proper === 'flag') acc.flag++;
      else if (e.fit === 'review' || e.proper === 'review') acc.review++;
      else acc.pass++;
      return acc;
    },
    { pass: 0, review: 0, flag: 0 },
  );

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="text-2xl font-bold text-emerald-900">{summary.pass}</div>
          <div className="text-xs text-emerald-800 font-medium">Pass — fit + proper</div>
          <div className="text-[10px] text-emerald-700/80">no action required</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <div className="text-2xl font-bold text-amber-900">{summary.review}</div>
          <div className="text-xs text-amber-800 font-medium">Re-assessment due</div>
          <div className="text-[10px] text-amber-700/80">scheduled within 90 days</div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
          <div className="text-2xl font-bold text-rose-900">{summary.flag}</div>
          <div className="text-xs text-rose-800 font-medium">Flagged</div>
          <div className="text-[10px] text-rose-700/80">supervisor notification considered</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-[10px] uppercase tracking-widest text-emerald-900">
            <tr>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Holder</th>
              <th className="text-left px-4 py-2.5">Appointed</th>
              <th className="text-left px-4 py-2.5">Re-assessment due</th>
              <th className="text-left px-4 py-2.5">Qualifications + experience</th>
              <th className="text-center px-4 py-2.5">Fit</th>
              <th className="text-center px-4 py-2.5">Proper</th>
            </tr>
          </thead>
          <tbody>
            {FP_ENTRIES.map((e) => (
              <tr key={e.role + e.holder} className="border-t border-gray-100 align-top">
                <td className="px-4 py-2.5 text-xs font-semibold text-gray-900">{e.role}</td>
                <td className="px-4 py-2.5 text-xs text-gray-800">{e.holder}</td>
                <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{e.appointed}</td>
                <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{e.reassessment_due}</td>
                <td className="px-4 py-2.5 text-[11px] text-gray-700 leading-snug">{e.qualifications}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${FP_BADGE[e.fit].cls}`}>{FP_BADGE[e.fit].label}</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${FP_BADGE[e.proper].cls}`}>{FP_BADGE[e.proper].label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-600 italic flex items-center gap-2">
          <ScrollText className="w-3 h-3 text-emerald-700 shrink-0" />
          <span>
            <strong>Fit</strong> = professional qualifications, technical knowledge, market experience. <strong>Proper</strong> = honesty, integrity, financial soundness, no relevant criminal record.
            Both reassessed at appointment + every 3 years + on material change. Linked to <code className="text-emerald-700 font-mono">6_gov_fitproper_register</code>; assessments + supporting documents in <code className="text-emerald-700 font-mono">6_gov_fitproper_evidence</code>.
          </span>
        </div>
      </div>
    </div>
  );
}

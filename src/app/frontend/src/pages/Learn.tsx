/**
 * Learn — guided walkthrough of Solvency II.
 *
 * Six panels read top-to-bottom or jumped from the sticky TOC. The audience is
 * "Big4 senior consultant sending a new joiner" — calm, factual, no marketing
 * language. Each panel ends with one or two links into the live platform so
 * concepts ground in artefacts, not abstractions.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GraduationCap, Database, Workflow, FileText, ShieldCheck, Compass,
  ChevronRight, ArrowRight, ExternalLink,
} from 'lucide-react';

interface Panel {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  body: React.ReactNode;
  diagram: React.ReactNode;
  links: { label: string; to: string }[];
}

const PANELS: Panel[] = [
  {
    id: 'why',
    number: 1,
    title: 'Why Solvency II exists',
    subtitle: 'The shift from "have we got enough capital?" to "do we understand our risks well enough?"',
    icon: GraduationCap,
    body: (
      <>
        <p>
          Solvency II is the European prudential regime for insurance and reinsurance undertakings.
          It came into force on 1 January 2016, replacing Solvency I. The change wasn't cosmetic —
          Solvency I asked insurers to hold a fixed percentage of premiums and reserves as capital.
          Solvency II asks them to hold capital sized to <em>their actual risks</em>, calculated
          against a one-year 99.5% Value-at-Risk standard.
        </p>
        <p>
          The architecture is three pillars. <strong>Pillar 1</strong> is the calculation:
          technical provisions, the Solvency Capital Requirement (SCR), the Minimum Capital
          Requirement (MCR), and the eligible own funds that cover them. <strong>Pillar 2</strong>
          is the governance wrap: the Own Risk and Solvency Assessment (ORSA), risk-management
          system, the Actuarial Function, internal controls, fit-and-proper. <strong>Pillar 3</strong>
          is the disclosure: the Solvency and Financial Condition Report (SFCR) for the public,
          the Regular Supervisory Report (RSR) for the regulator, and the Quantitative
          Reporting Templates (QRTs) that carry the numbers.
        </p>
        <p>
          The pillars are designed to interlock. The SCR doesn't stand on its own — it requires
          the ORSA to interpret it under stress, the Actuarial Function to attest to its
          calculation, and the SFCR to disclose its level and composition publicly. A Solvency II
          implementation is the pillars working together, not three separate workstreams.
        </p>
      </>
    ),
    diagram: <ThreePillarsDiagram />,
    links: [],
  },

  {
    id: 'data',
    number: 2,
    title: 'The data — what it represents',
    subtitle: 'Everything else is built on top of operational data already in the firm.',
    icon: Database,
    body: (
      <>
        <p>
          Every Solvency II number traces back to operational data the firm already holds.
          Six core feeds carry it: <strong>policies</strong> (the contracts in force),
          <strong> premiums</strong> (what was earned and written), <strong>claims</strong> (what
          was paid and incurred), <strong>expenses</strong> (acquisition + administration),
          <strong> reinsurance</strong> (treaties and recoveries), and <strong>assets</strong>
          (the investment portfolio + counterparty exposure).
        </p>
        <p>
          For a life insurer there's a parallel set: in-force policy book, mortality and lapse
          experience, best-estimate assumptions, and the projected cashflows that feed life
          technical provisions.
        </p>
        <p>
          The data flow is bronze (raw, as-received from source systems) → silver (cleansed,
          aggregated by line of business) → gold (mapped to the EIOPA QRT templates). Solvency II
          adds three additional layers on top of gold: <strong>monitoring</strong> for SLAs and
          data quality, <strong>engine output</strong> from stochastic models like Igloo and
          Prophet, and <strong>governance</strong> tables for overlays, model versions, and
          approvals.
        </p>
      </>
    ),
    diagram: <DataFlowDiagram />,
    links: [
      { label: 'See data quality on the platform', to: '/data-quality' },
      { label: 'See the asset register (S.06.02)',  to: '/assets' },
    ],
  },

  {
    id: 'cycle',
    number: 3,
    title: 'The actuarial cycle',
    subtitle: 'Data lands. Reservers reserve. Capital model runs. SCR comes out the other end.',
    icon: Workflow,
    body: (
      <>
        <p>
          The quarterly cycle has a fixed shape. After the period closes, raw data lands on a
          schedule and gets validated. The reserving function projects ultimate claims by line
          of business and accident year — chain ladder, Bornhuetter-Ferguson, expert judgement
          where the data is sparse. The output is the technical provisions.
        </p>
        <p>
          In parallel, the asset register revalues. The exposure data refreshes the inputs to
          the cat model (a stochastic engine like Igloo or RMS) and the life UW model (something
          like Prophet). The standard formula model takes the sub-module charges — interest rate,
          equity, spread, premium-and-reserve, catastrophe, mortality, longevity, lapse — and
          aggregates them with EIOPA's correlation matrices. That produces the BSCR. Add
          operational risk; subtract loss-absorbing capacity of deferred taxes; you have the SCR.
        </p>
        <p>
          What sounds linear is in practice messy. Reserving moves; the capital model shouldn't
          run on stale parameters. Cat output arrives late; the SCR holds. A claim re-opens; the
          IBNR estimate moves. The actuary's job is to land each step with a defensible audit
          trail. The platform's job is to make that defensibility cheap.
        </p>
      </>
    ),
    diagram: <CycleDiagram />,
    links: [
      { label: 'See reserving — P&C',          to: '/reserving-pnc' },
      { label: 'See SCR & standard formula',   to: '/scr' },
      { label: 'See non-life UW risk',         to: '/nl-uw-risk' },
    ],
  },

  {
    id: 'reporting',
    number: 4,
    title: 'What gets reported',
    subtitle: 'Quarterly and annual deadlines. Regulator-only and public-facing. Calculation feeds disclosure.',
    icon: FileText,
    body: (
      <>
        <p>
          The QRTs are the regulator's quantitative templates — a few dozen of them, covering
          assets, liabilities, premiums, claims, capital, and own funds. Quarterly QRTs are due
          ~5 weeks after quarter-end (the exact deadline depends on the Member State and the
          undertaking type). Annual QRTs are due ~14 weeks after year-end.
        </p>
        <p>
          The <strong>SFCR</strong> is the public report. Every authorised undertaking publishes
          one annually, in a structure laid out in Article 51 of the directive: A. Business and
          performance, B. System of governance, C. Risk profile, D. Valuation for solvency
          purposes, E. Capital management. It's intended to be readable by analysts, rating
          agencies, and policyholders.
        </p>
        <p>
          The <strong>RSR</strong> is the supervisor-only twin — same shape as the SFCR plus
          extra detail the regulator wants to see (forward-looking risk assessment,
          undertaking-specific stress scenarios, supervisor-only disclosures). It's not public;
          its frequency depends on the supervisor.
        </p>
        <p>
          The <strong>ORSA</strong> sits alongside both. Its timing isn't regulator-set — the
          undertaking decides, typically annually, with ad-hoc updates if the risk profile shifts
          materially. Output is a forward-looking capital projection under base + stress
          scenarios, signed off by the board.
        </p>
        <p>
          The relationship between Pillar 1 (calculation) and Pillar 3 (disclosure) is direct:
          every quantitative claim in the SFCR cites a QRT cell. Auditors and supervisors can
          trace any number on any page back to the gold-layer table that produced it.
        </p>
      </>
    ),
    diagram: <ReportingTimelineDiagram />,
    links: [
      { label: 'See the QRT submission pack', to: '/archive' },
      { label: 'See SFCR drafting',           to: '/sfcr' },
      { label: 'See ORSA',                    to: '/orsa' },
    ],
  },

  {
    id: 'governance',
    number: 5,
    title: 'How governance wraps it',
    subtitle: 'Pillar 2 is the difference between a calculation and a defensible calculation.',
    icon: ShieldCheck,
    body: (
      <>
        <p>
          Pillar 1 produces a number. Pillar 2 makes that number defensible. Four mechanisms do
          most of the work.
        </p>
        <p>
          <strong>Model approval workflow.</strong> Every actuarial model — reserving, the
          standard formula, the cat engine, the life UW engine — has a production version active
          in close, a candidate version in review, and an archive of prior versions. Promotion
          from candidate to production requires diagnostics within tolerance and a sign-off from
          a named approver. The diagnostics are recorded; the sign-off is recorded; the decision
          to promote (or not) is recorded.
        </p>
        <p>
          <strong>Overlays as expert judgement made explicit.</strong> The reserving committee
          decides the property line needs an extra €18M to capture a one-off storm event. That's
          not a model change; it's a judgement on top of a model output. Solvency II treats this
          properly only when the judgement is recorded as a first-class object — magnitude,
          category, rationale, author, approver, and the QRT cells it ultimately affects.
          Overlays surface in the audit trail of every artefact downstream.
        </p>
        <p>
          <strong>Audit trail by default.</strong> Every artefact — every QRT, every ORSA run,
          every drafted SFCR section — carries its lineage with it: the source tables and their
          versions, the code that ran, the model versions invoked, the overlays applied, the
          approvals chain. The audit isn't a separate exercise; it's the artefact itself.
        </p>
        <p>
          <strong>Internal controls.</strong> The Pillar 2 governance system also covers fit-
          and-proper requirements, internal audit, the Actuarial Function (Article 48), risk
          management, and outsourcing. In the platform, this surfaces as architectural
          assertions: AI cannot approve; AI is read-only against regulatory tables; every AI
          output is hashed and logged.
        </p>
      </>
    ),
    diagram: <GovernanceWrapDiagram />,
    links: [
      { label: 'See model governance',     to: '/model-governance' },
      { label: 'See the Overlays Register', to: '/overlays' },
      { label: 'See internal controls',    to: '/internal-controls' },
    ],
  },

  {
    id: 'whole',
    number: 6,
    title: 'The whole picture',
    subtitle: 'Data feeds the cycle. The cycle produces the disclosures. Governance wraps it all.',
    icon: Compass,
    body: (
      <>
        <p>
          Put the pieces together. Operational data flows from the firm's source systems through
          a layered Delta lakehouse. Reserving and asset-revaluation runs against it. Stochastic
          engines consume exposure data. The standard formula aggregates the sub-module charges.
          The result is the SCR and the technical provisions — the numbers underneath every
          QRT, every SFCR section, every ORSA scenario.
        </p>
        <p>
          Around the cycle is the governance layer: model versioning, overlay register, audit
          trail, sign-offs, internal-controls assertions. None of it is optional, and on this
          platform none of it is bolt-on — it's how the system behaves by default.
        </p>
        <p>
          A Solvency II function isn't a tool; it's an operating model. The data is the input,
          the cycle is the engine, the disclosures are the output, and the governance is what
          makes the whole thing defensible. This is the regime. The platform you're looking at
          is one way of running it — coherently, with full audit, on infrastructure you already
          have.
        </p>
      </>
    ),
    diagram: <WholePictureDiagram />,
    links: [
      { label: 'Open the Reporting Cycle reference', to: '/reporting-cycle' },
      { label: 'Open the Control Tower',              to: '/today' },
    ],
  },
];

export default function Learn() {
  const [active, setActive] = useState<string>(PANELS[0].id);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  // Update active panel on scroll
  useEffect(() => {
    const handler = () => {
      let current = PANELS[0].id;
      for (const p of PANELS) {
        const el = refs.current[p.id];
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < 200) current = p.id;
      }
      setActive(current);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 grid grid-cols-12 gap-6">
      <aside className="col-span-12 lg:col-span-3 lg:sticky lg:top-4 lg:self-start">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-2">Learn</h3>
          <h2 className="text-base font-bold text-gray-900 leading-tight mb-3">Solvency II — end to end</h2>
          <ol className="space-y-1 text-sm">
            {PANELS.map((p) => {
              const Icon = p.icon;
              const isActive = active === p.id;
              return (
                <li key={p.id}>
                  <a href={`#${p.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      const el = refs.current[p.id];
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded-md ${
                      isActive ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? 'text-blue-700' : 'text-gray-400'}`} />
                    <span className="text-[13px] leading-tight"><span className="text-gray-400 font-mono mr-1">{p.number}.</span>{p.title}</span>
                  </a>
                </li>
              );
            })}
          </ol>
          <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
            Reading time ~ 12 minutes. Each panel links to the live platform — concepts ground in
            artefacts, not abstractions.
          </p>
        </div>
      </aside>

      <main className="col-span-12 lg:col-span-9 space-y-10">
        <header>
          <div className="text-[11px] uppercase tracking-widest text-blue-700 font-bold">Learn</div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">Solvency II — end to end</h1>
          <p className="text-sm text-gray-600 mt-2 max-w-3xl leading-relaxed">
            For someone learning the regime: a calm walk through the architecture, the data, the
            cycle, the disclosures, and the governance that wraps everything. Six panels, ~12
            minutes. Each ends with links into the running platform so the concepts attach to
            real artefacts.
          </p>
        </header>

        {PANELS.map((p) => <PanelSection key={p.id} panel={p} pref={(el) => { refs.current[p.id] = el; }} />)}

        <section className="bg-slate-900 text-white rounded-xl p-6">
          <h3 className="text-lg font-bold tracking-tight">You've read the regime.</h3>
          <p className="text-sm text-slate-300 mt-2 leading-relaxed">
            Now look at it running. Open the <Link to="/today" className="text-violet-300 underline hover:text-white">Control Tower</Link> for
            operational state, the <Link to="/reporting-cycle" className="text-violet-300 underline hover:text-white">Reporting Cycle</Link> for
            every artefact organised by pillar, or the <Link to="/" className="text-violet-300 underline hover:text-white">Actuarial Workbench</Link> for
            the other regimes that share this same platform.
          </p>
        </section>
      </main>
    </div>
  );
}

function PanelSection({ panel: p, pref }: { panel: Panel; pref: (el: HTMLElement | null) => void }) {
  const Icon = p.icon;
  return (
    <section id={p.id} ref={pref} className="scroll-mt-4 space-y-4">
      <header className="flex items-start gap-3 pb-2 border-b border-gray-200">
        <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-blue-700" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">Panel {p.number}</div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight mt-0.5">{p.title}</h2>
          <p className="text-sm text-gray-600 mt-1 italic">{p.subtitle}</p>
        </div>
      </header>

      <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed [&>p]:mb-3">
        {p.body}
      </div>

      <div className="bg-gradient-to-br from-blue-50/50 to-white border border-blue-100 rounded-lg p-4">
        {p.diagram}
      </div>

      {p.links.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {p.links.map((l, i) => (
            <Link key={i} to={l.to}
              state={{ crumbs: [{ label: 'Learn', to: '/learn' }, { label: p.title }, { label: l.label.replace(/^See\s*/, '') }] }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-300 text-blue-700 rounded-md hover:bg-blue-50 text-xs font-semibold">
              <ExternalLink className="w-3 h-3" />
              {l.label}
              <ArrowRight className="w-3 h-3" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Diagrams (inline SVG, no dep) ─────────────────────────────────── */

function ThreePillarsDiagram() {
  const cols = [
    { num: 1, title: 'Calculation',  sub: 'TPs · SCR · MCR · Own funds',           cls: 'bg-blue-50    border-blue-300    text-blue-900' },
    { num: 2, title: 'Governance',   sub: 'ORSA · Risk mgmt · Actuarial Function', cls: 'bg-emerald-50 border-emerald-300 text-emerald-900' },
    { num: 3, title: 'Disclosure',   sub: 'QRTs · SFCR · RSR',                     cls: 'bg-amber-50   border-amber-300   text-amber-900' },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      {cols.map((c) => (
        <div key={c.num} className={`border-2 ${c.cls.split(' ').slice(1, 3).join(' ')} rounded-lg p-4 ${c.cls.split(' ')[0]}`}>
          <div className={`text-[10px] uppercase tracking-widest font-bold ${c.cls.split(' ')[2]}`}>Pillar {c.num}</div>
          <div className={`text-base font-bold mt-1 ${c.cls.split(' ')[2]}`}>{c.title}</div>
          <div className="text-[11px] text-gray-600 mt-1.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function DataFlowDiagram() {
  const layers = [
    { name: 'Bronze',  desc: 'Raw operational feeds',                   cls: 'bg-orange-50 border-orange-300 text-orange-900' },
    { name: 'Silver',  desc: 'Cleansed + LoB-aggregated',                cls: 'bg-slate-50 border-slate-300 text-slate-900' },
    { name: 'Gold',    desc: 'EIOPA QRTs + summary tables',              cls: 'bg-amber-50 border-amber-300 text-amber-900' },
    { name: 'Engine',  desc: 'Stochastic outputs (Igloo / Prophet)',     cls: 'bg-purple-50 border-purple-300 text-purple-900' },
    { name: 'Mon/Gov', desc: 'SLA · DQ · overlays · approvals',          cls: 'bg-blue-50 border-blue-300 text-blue-900' },
  ];
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto">
      {layers.map((l, i) => (
        <div key={l.name} className="flex items-center gap-2 shrink-0">
          <div className={`border-2 rounded-lg px-3 py-2 ${l.cls}`} style={{ minWidth: 130 }}>
            <div className="text-[10px] uppercase tracking-widest font-bold opacity-70">Layer</div>
            <div className="text-sm font-bold">{l.name}</div>
            <div className="text-[11px] mt-1 opacity-80">{l.desc}</div>
          </div>
          {i < layers.length - 1 && <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

function CycleDiagram() {
  const steps = [
    'Data lands',
    'Reserving runs',
    'Cat / life engines run',
    'Standard formula aggregates',
    'BSCR',
    '+ Op risk · − LAC_DT',
    'SCR',
  ];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 shrink-0">
          <div className={`px-3 py-1.5 rounded-md border text-xs font-medium ${
            i === steps.length - 1
              ? 'bg-blue-700 text-white border-blue-800 font-bold shadow'
              : 'bg-white border-gray-300 text-gray-700'
          }`}>
            {s}
          </div>
          {i < steps.length - 1 && <span className="text-gray-400 text-base">→</span>}
        </div>
      ))}
    </div>
  );
}

function ReportingTimelineDiagram() {
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  // Quarterly QRT due ~5 weeks after Q end → markers at week 18, 31, 44 (rounded as months 5/M, 8/A, 11/N)
  // Annual SFCR due ~14 weeks after YE → mid-April
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-px text-[10px] font-mono text-gray-500">
        {months.map((m) => <div key={m} className="text-center bg-slate-50 py-1">{m}</div>)}
      </div>
      <div className="relative h-8">
        {/* Quarterly QRTs */}
        {[2, 5, 8, 11].map((qm, i) => (
          <div key={qm} className="absolute top-1 -translate-x-1/2 text-[10px] text-blue-700 font-semibold whitespace-nowrap"
            style={{ left: `${((qm + 0.65) / 12) * 100}%` }}>
            <div className="w-px h-3 bg-blue-400 mx-auto" />
            QRT Q{i === 0 ? 4 + ' (prior)' : i}
          </div>
        ))}
        {/* SFCR */}
        <div className="absolute top-1 -translate-x-1/2 text-[10px] text-amber-700 font-semibold whitespace-nowrap"
          style={{ left: `${((3 + 0.4) / 12) * 100}%` }}>
          <div className="w-px h-3 bg-amber-500 mx-auto" />
          SFCR (annual)
        </div>
      </div>
      <div className="text-[11px] text-gray-500 italic mt-3">
        Quarterly QRTs ~5 weeks after period end · Annual QRTs + SFCR ~14 weeks after year end · ORSA
        timing set by the undertaking.
      </div>
    </div>
  );
}

function GovernanceWrapDiagram() {
  return (
    <div className="relative p-4 border-2 border-emerald-300 bg-emerald-50/40 rounded-xl">
      <div className="absolute -top-2.5 left-4 px-2 bg-emerald-100 border border-emerald-300 rounded text-[10px] uppercase tracking-widest font-bold text-emerald-800">
        Governance — Pillar 2
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {[
          { t: 'Model approval', s: 'production / candidate / archive aliases' },
          { t: 'Overlays',       s: 'expert judgement made explicit + audit-trailed' },
          { t: 'Internal ctrls', s: 'AI guardrails + architectural assertions' },
        ].map((c) => (
          <div key={c.t} className="bg-white border border-emerald-200 rounded p-2.5">
            <div className="text-xs font-bold text-emerald-900">{c.t}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">{c.s}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 bg-white border border-gray-200 rounded p-3 text-center">
        <div className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Wraps</div>
        <div className="text-sm font-semibold text-gray-800 mt-1">
          The actuarial cycle (Pillar 1) and the disclosures (Pillar 3)
        </div>
      </div>
    </div>
  );
}

function WholePictureDiagram() {
  return (
    <div className="space-y-3">
      {/* Outer governance ring */}
      <div className="relative border-2 border-emerald-300 bg-emerald-50/30 rounded-xl p-4">
        <div className="absolute -top-2.5 left-4 px-2 bg-emerald-100 border border-emerald-300 rounded text-[10px] uppercase tracking-widest font-bold text-emerald-800">
          Pillar 2 — governance, audit, overlays, model versions
        </div>

        <div className="grid grid-cols-12 gap-3 mt-2">
          {/* Data column */}
          <div className="col-span-3 border-2 border-orange-300 bg-orange-50/60 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-orange-800 font-bold">Data</div>
            <div className="text-sm font-semibold text-orange-900 mt-1">Operational feeds</div>
            <div className="text-[11px] text-orange-800 mt-1">Policies · premiums · claims · assets · reinsurance · life book</div>
          </div>

          {/* Cycle column */}
          <div className="col-span-6 border-2 border-blue-300 bg-blue-50/60 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-blue-800 font-bold">Pillar 1 — calculation</div>
            <div className="text-sm font-semibold text-blue-900 mt-1">Reserving · cat · life UW · standard formula → SCR</div>
            <div className="text-[11px] text-blue-800 mt-1">All models registered with versions + aliases.</div>
          </div>

          {/* Disclosure column */}
          <div className="col-span-3 border-2 border-amber-300 bg-amber-50/60 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Pillar 3</div>
            <div className="text-sm font-semibold text-amber-900 mt-1">QRTs · SFCR · RSR</div>
            <div className="text-[11px] text-amber-800 mt-1">Every claim cites the gold-table cell.</div>
          </div>
        </div>
      </div>

      <p className="text-[12px] text-gray-600 italic text-center">
        Data feeds the cycle. The cycle produces the disclosures. Governance wraps it all.
      </p>
    </div>
  );
}

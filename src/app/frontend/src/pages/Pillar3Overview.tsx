/**
 * Pillar 3 overview hub — Disclosure.
 *
 * What an actuary cares about when they open the disclosure pillar:
 *   1. The two audiences — public (SFCR) + supervisor (RSR + QRTs + Q&A)
 *   2. The reporting calendar — what's due when
 *   3. The four disclosure artefacts (QRT pack, SFCR, RSR, Regulator Q&A)
 *   4. The shared engine — SFCR and RSR draw from the same content,
 *      with supervisor-only sections branching off
 *   5. The submission pipeline — numbers → narrative → validate → sign → submit
 *   6. The sign-off chain — who certifies what
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive as ArchiveIcon, Newspaper, FileText, Bot,
  ArrowRight, ArrowLeft, Globe, Building2, CalendarDays,
  PenLine, ShieldCheck, Send, Database,
  Calculator, AlertCircle, Layers, ChevronDown, CheckCircle,
} from 'lucide-react';
import { fetchPeriodState, fetchSubmissions, type SubmissionRow } from '../lib/api';

export default function Pillar3Overview() {
  const [period, setPeriod] = useState<string>('');
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);

  useEffect(() => {
    fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined);
    fetchSubmissions().then((r) => setSubmissions(r.data)).catch(() => undefined);
  }, []);

  const latestStatus = computeLatestStatus(submissions, period);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-7">
      <Link to="/reporting-cycle" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Reporting Cycle
      </Link>

      <Hero period={period} />

      <Section
        title="Two audiences, one source of truth"
        subtitle="Pillar 3 is what leaves the firm. Same numbers, same governance, two distinct surfaces — one for the public, one for the supervisor."
      >
        <TwoAudiencesDiagram />
      </Section>

      <Section
        title="The reporting calendar"
        subtitle="Quarterly QRT pack + Regulator Q&A run on every Q-close. SFCR + RSR run annually on the year-end period. The continuous ORSA draft (Pillar 2) feeds both."
      >
        <ReportingCalendar />
      </Section>

      <Section
        title="The four disclosure artefacts"
        subtitle="Each card opens a live surface. Status reflects the current cycle."
      >
        <DisclosureGrid latestStatus={latestStatus} period={period} />
      </Section>

      <Section
        id="mcr"
        title="MCR — Minimum Capital Requirement"
        subtitle="The regulatory floor that sits beneath the SCR. Quarterly submission (S.28.01 / S.28.02). 25% SCR floor · 45% SCR cap on the linear calculation. A breach below MCR is the Article 138 trigger — a different regime entirely."
      >
        <MCRBreachWatch />
      </Section>

      <Section
        title="The full QRT inventory"
        subtitle="Solvency II requires more than the five demo templates. Here's the full landscape — annual + quarterly + group + IGT — with what's exercised in this demo and what runs on the same pipeline pattern."
      >
        <FullQRTInventory />
      </Section>

      <Section
        id="ltg"
        title="Long-term guarantee measures + transitionals"
        subtitle="Volatility Adjustment, Matching Adjustment, transitionals on TPs and risk-free rate. Material to the solvency ratio — disclosed with-and-without in S.22.01. The Board sign-off that's hardest to defend in a stress."
      >
        <LTGMeasures />
      </Section>

      <Section
        title="How SFCR and RSR share content"
        subtitle="One engine, two audiences. The five sections of SFCR (Article 51) are the public subset; the RSR (Articles 304-311) re-uses every public section and adds supervisor-only material."
      >
        <SharedEngineDiagram />
      </Section>

      <Section
        title="The submission pipeline"
        subtitle="What happens between 'numbers approved' and 'submission archived'. Every stage produces an auditable artefact; nothing leaves the firm without sign-off."
      >
        <SubmissionPipeline />
      </Section>

      <Section
        id="evr"
        title="EIOPA validation rules — the gate before submission"
        subtitle="The full EIOPA 2.8 taxonomy ships ~3,000 validation rules (BV · EV · IV) across ~50 templates. This demo exercises 5 templates with 1,297 rules — the rest run on the same pipeline pattern. Failures route to a triage queue with the rule code, the cell, and the expected value."
      >
        <EVRValidationDrilldown />
      </Section>

      <Section
        title="The sign-off chain"
        subtitle="Six roles, sequential — five internal plus the external auditor. Each role signs a specific scope; refusal sends the artefact back. Every signature lands in the audit log."
      >
        <SignOffChain />
      </Section>

      <Section
        id="national"
        title="National reporting — beyond Solvency II"
        subtitle="EIOPA harmonises the core; every member state adds national supplementary returns. Multi-jurisdiction firms run them off the same gold layer."
      >
        <NationalReporting />
      </Section>

      <Section
        id="peer"
        title="Peer benchmarking — where we sit vs the European book"
        subtitle="EIOPA publishes industry-aggregate solvency statistics twice a year. Comparing the firm's position against the cross-firm distribution is part of the Board pack."
      >
        <PeerBenchmarking />
      </Section>

      <Section
        id="restatement"
        title="Restatement workflow"
        subtitle="When a prior submission is found wrong — Q1 derivative valuations re-priced, a reserving overlay re-stated, classification corrected — the platform handles it as a first-class workflow rather than an off-system patch."
      >
        <RestatementWorkflow />
      </Section>

      <div className="text-center text-[11px] text-gray-400 italic pt-3">
        Pillar 3 is what leaves the firm. The numbers come from <Link to="/pillar-1" className="text-amber-700 hover:underline">Pillar 1</Link>;
        the judgement behind them is in <Link to="/pillar-2" className="text-amber-700 hover:underline">Pillar 2</Link>.
      </div>
    </div>
  );
}

/* ═══════ Sections ═══════ */

function Hero({ period }: { period: string }) {
  return (
    <header className="bg-gradient-to-br from-amber-900 via-orange-900 to-red-950 text-white rounded-2xl p-7 shadow-lg">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-amber-300">
        <Newspaper className="w-3.5 h-3.5" /> Pillar 3 — disclosure
      </div>
      <h1 className="text-3xl font-bold tracking-tight mt-1.5">
        What goes to the regulator and the public.
      </h1>
      <p className="text-sm text-amber-100 mt-2 leading-relaxed max-w-3xl">
        Solvency II's transparency layer. Quarterly QRTs go to the supervisor on day 25. An annual SFCR
        (Article 51) lands publicly, an RSR (Articles 304-311) lands with the supervisor only. Both run
        off the same content engine — same numbers, same governance trail, two audiences.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs text-amber-300">
        <span className="font-mono">Current cycle:</span>
        <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-white">{period || '…'}</code>
        <span className="text-amber-400/70">·</span>
        <span>Quarterly QRT pack · annual SFCR + RSR · always-on Q&amp;A</span>
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

/* ═══════ Two audiences ═══════ */

function TwoAudiencesDiagram() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <article className="border-2 border-sky-200 bg-sky-50/40 rounded-xl p-5 bg-white">
        <header className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-sky-700">Public</div>
            <h3 className="text-lg font-bold text-gray-900">SFCR</h3>
            <p className="text-xs text-sky-700/80 italic">Article 51 · Annual · Plain-language</p>
          </div>
        </header>
        <ul className="mt-3 text-sm text-gray-700 space-y-1.5 leading-relaxed">
          <li>· <strong>5 sections</strong>: Business + Performance · System of Governance · Risk Profile · Valuation · Capital Management</li>
          <li>· <strong>Numbers</strong>: live from Pillar 1 gold</li>
          <li>· <strong>Narrative</strong>: AI-drafted from the same source, reviewed by Pillar 2</li>
          <li>· <strong>Audience</strong>: investors, rating agencies, public</li>
          <li>· <strong>Format</strong>: web disclosure + PDF</li>
        </ul>
        <Link to="/sfcr"
          className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:text-sky-900">
          Open SFCR <ArrowRight className="w-3 h-3" />
        </Link>
      </article>

      <article className="border-2 border-amber-200 bg-amber-50/40 rounded-xl p-5 bg-white">
        <header className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-amber-700">Supervisor</div>
            <h3 className="text-lg font-bold text-gray-900">QRT pack · RSR · Q&amp;A</h3>
            <p className="text-xs text-amber-700/80 italic">Articles 304-311 · Quarterly + annual</p>
          </div>
        </header>
        <ul className="mt-3 text-sm text-gray-700 space-y-1.5 leading-relaxed">
          <li>· <strong>QRT pack</strong>: 5 EIOPA templates quarterly (S.05.01, S.06.02, S.12.01, S.25.01, S.26.06) + annuals</li>
          <li>· <strong>RSR</strong>: re-uses every SFCR section + supervisor-only details on risk + governance</li>
          <li>· <strong>Regulator Q&amp;A</strong>: BaFin-style follow-ups, AI answers grounded in the data + audit log</li>
          <li>· <strong>Audience</strong>: BaFin / EIOPA / local supervisor</li>
          <li>· <strong>Format</strong>: XBRL packages + supervisor portal</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link to="/archive" className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900">
            QRT Archive <ArrowRight className="w-3 h-3" />
          </Link>
          <Link to="/rsr" className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900">
            Open RSR <ArrowRight className="w-3 h-3" />
          </Link>
          <Link to="/regulator-qa" className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900">
            Open Q&amp;A <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </article>
    </div>
  );
}

/* ═══════ Reporting calendar ═══════ */

function ReportingCalendar() {
  const events = [
    { day: 'Day 0',  what: 'Quarter close',                  detail: 'Bronze feeds finalised · DLT pipelines run · gold materialises', tone: 'slate' },
    { day: 'Day 1-10', what: 'Recon + diagnostics',           detail: 'Cross-QRT recon · model diagnostics · overlay approvals · sign-offs', tone: 'sky' },
    { day: 'Day 14', what: 'QRT pack draft locked',          detail: '5 EIOPA templates assembled · cross-template validation · ready for Senior Actuary review', tone: 'sky' },
    { day: 'Day 20', what: 'Sign-off chain complete',         detail: 'Preparer → Senior Actuary → CRO → Board Risk Committee → CFO sign', tone: 'emerald' },
    { day: 'Day 25', what: 'Submit to supervisor',           detail: 'XBRL package validated and uploaded · submission archived', tone: 'emerald' },
    { day: 'Annual', what: 'SFCR + RSR + AFR',               detail: 'Triggered on year-end (Q4) close · same engine, longer narrative · public + supervisor versions', tone: 'amber' },
  ];
  const cls = (tone: string) => ({
    slate:   'border-slate-300 bg-slate-50 text-slate-900',
    sky:     'border-sky-200 bg-sky-50/50 text-sky-900',
    emerald: 'border-emerald-200 bg-emerald-50/50 text-emerald-900',
    amber:   'border-amber-200 bg-amber-50/50 text-amber-900',
  }[tone] ?? '');

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.day} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${cls(e.tone)}`}>
            <div className="font-mono text-xs font-bold w-20 shrink-0 mt-0.5">{e.day}</div>
            <div className="flex-1">
              <div className="text-sm font-semibold">{e.what}</div>
              <div className="text-xs opacity-80 mt-0.5 leading-snug">{e.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-500 italic mt-3 flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5" />
        Operational state for the live cycle lives on the <Link to="/today" className="text-amber-700 hover:underline">Control Tower</Link>.
      </p>
    </div>
  );
}

/* ═══════ Disclosure grid ═══════ */

interface LatestStatus {
  approved: number;
  pending: number;
  total: number;
  period: string;
}

function computeLatestStatus(rows: SubmissionRow[], period: string): LatestStatus {
  const inPeriod = rows.filter((r) => r.reporting_period === period);
  return {
    approved: inPeriod.filter((r) => r.status === 'approved').length,
    pending:  inPeriod.filter((r) => r.status !== 'approved' && r.status !== 'rejected').length,
    total:    inPeriod.length,
    period,
  };
}

function DisclosureGrid({ latestStatus, period }: { latestStatus: LatestStatus; period: string }) {
  const cards = [
    {
      icon: ArchiveIcon, title: 'QRT Submission Pack',
      to: '/archive',
      tagline: 'Quarterly + annual EIOPA templates',
      what: 'Five quarterly QRTs (S.05.01, S.06.02, S.12.01, S.25.01, S.26.06) plus annuals. XBRL package generation, validation, supervisor submission, signed archive.',
      kpi: period && latestStatus.total > 0
        ? `${latestStatus.approved}/${latestStatus.total} approved this cycle`
        : 'No submissions for current cycle',
      open: 'Open Archive',
    },
    {
      icon: Newspaper, title: 'SFCR (Public)',
      to: '/sfcr',
      tagline: 'Article 51 · plain-language',
      what: 'Five sections covering business, governance, risk, valuation, capital. Numbers from gold; narrative AI-drafted and reviewed by the Actuarial Function holder.',
      kpi: 'Continuous draft · refreshes on any gold change',
      open: 'Open SFCR',
    },
    {
      icon: FileText, title: 'RSR (Supervisor)',
      to: '/rsr',
      tagline: 'Articles 304-311 · longer-form',
      what: 'Same engine + sections as SFCR plus supervisor-only material on risk concentrations, ICT, internal model details, future business plan.',
      kpi: 'Re-uses every SFCR section · supervisor-only diff captured',
      open: 'Open RSR',
    },
    {
      icon: Bot, title: 'Regulator Q&A',
      to: '/regulator-qa',
      tagline: 'BaFin-style follow-up answers',
      what: 'Standing queue for supervisor follow-up questions. AI agent reads from gold + audit log, drafts an answer with citations, routes for human approval before sending.',
      kpi: 'Grounded in Pillar 1 + Pillar 2 audit log',
      open: 'Open Q&A',
    },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.title} to={c.to}
            className="block border-2 border-amber-200 bg-amber-50/30 rounded-xl p-4 bg-white hover:border-amber-400 hover:shadow transition-all group">
            <header className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-gray-900">{c.title}</h3>
                <p className="text-[11px] text-amber-700/80 italic">{c.tagline}</p>
              </div>
            </header>
            <p className="text-sm text-gray-700 mt-3 leading-relaxed">{c.what}</p>
            <div className="mt-3 text-[11px] uppercase tracking-widest text-gray-500 font-bold">Live signal</div>
            <div className="text-xs text-gray-800 mt-0.5">{c.kpi}</div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-700 group-hover:text-amber-900">
              {c.open} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ═══════ Shared engine diagram ═══════ */

function SharedEngineDiagram() {
  const W = 1100, H = 360;
  const colour = {
    pillar1: '#0369a1', pillar2: '#047857', shared: '#92400e',
    public: '#0284c7', supervisor: '#b45309',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720, maxHeight: 380 }}>
        {/* Column labels */}
        <ColumnHead x={140}  label="Sources" sub="Pillar 1 + Pillar 2" />
        <ColumnHead x={530}  label="Shared engine" sub="content layer" />
        <ColumnHead x={950}  label="Audience surfaces" sub="public / supervisor" />

        {/* Sources */}
        <SourceBox x={40} y={60}  label="Gold QRTs" sub="Pillar 1" fill="#dbeafe" stroke={colour.pillar1} />
        <SourceBox x={40} y={130} label="Approved overlays" sub="Pillar 2" fill="#d1fae5" stroke={colour.pillar2} />
        <SourceBox x={40} y={200} label="Model promotions" sub="Pillar 2" fill="#d1fae5" stroke={colour.pillar2} />
        <SourceBox x={40} y={270} label="Continuous ORSA" sub="Pillar 2" fill="#d1fae5" stroke={colour.pillar2} />

        {/* Engine middle */}
        <g>
          <rect x={400} y={120} width={260} height={130} rx={12} fill="#fef3c7" stroke={colour.shared} strokeWidth={1.5} />
          <text x={530} y={150} textAnchor="middle" fontWeight={700} fontSize={14} fill={colour.shared}>SFCR engine</text>
          <text x={530} y={170} textAnchor="middle" fontSize={10} fill="#78350f">5 sections compiled</text>
          <text x={530} y={188} textAnchor="middle" fontSize={10} fill="#78350f">numbers + narrative</text>
          <text x={530} y={218} textAnchor="middle" fontSize={10} fill="#78350f" fontStyle="italic">drives both surfaces</text>
        </g>

        {/* Public output */}
        <OutputBox x={820} y={70}  width={230} label="SFCR (public)" sub="5 Article 51 sections" fill="#e0f2fe" stroke={colour.public} />
        <OutputBox x={820} y={170} width={230} label="RSR (supervisor)" sub="SFCR + supervisor-only diff" fill="#fef3c7" stroke={colour.supervisor} />
        <OutputBox x={820} y={270} width={230} label="Regulator Q&A" sub="grounded follow-ups" fill="#fef3c7" stroke={colour.supervisor} />

        {/* Edges */}
        {[60, 130, 200, 270].map((y, i) => (
          <Arrow key={i} x1={210} y1={y + 28} x2={400} y2={185} colour="#94a3b8" />
        ))}
        <Arrow x1={660} y1={150} x2={820} y2={100} colour={colour.public} />
        <Arrow x1={660} y1={185} x2={820} y2={200} colour={colour.supervisor} />
        <Arrow x1={660} y1={220} x2={820} y2={300} colour={colour.supervisor} />

        {/* Supervisor-only branch */}
        <g>
          <rect x={650} y={295} width={180} height={48} rx={6} fill="#fff7ed" stroke="#fdba74" strokeDasharray="4 2" strokeWidth={1.2} />
          <text x={740} y={313} textAnchor="middle" fontSize={10} fontWeight={700} fill="#9a3412">supervisor-only sections</text>
          <text x={740} y={328} textAnchor="middle" fontSize={9} fill="#9a3412">ICT · internal model · concentrations · future plan</text>
        </g>
        <Arrow x1={830} y1={319} x2={868} y2={210} colour="#fb923c" dashed />
      </svg>
      <p className="text-[11px] text-gray-500 italic mt-2">
        One engine, three downstream surfaces. The dotted branch is the supervisor-only diff —
        material that the RSR adds on top of the SFCR. The Q&amp;A agent reads from the same content
        plus the audit log, so its answers stay consistent with whatever's been disclosed.
      </p>
    </div>
  );
}

function ColumnHead({ x, label, sub }: { x: number; label: string; sub: string }) {
  return (
    <g>
      <text x={x} y={28} textAnchor="middle" fontWeight={700} fontSize={11} fill="#475569" letterSpacing={1}>{label.toUpperCase()}</text>
      <text x={x} y={44} textAnchor="middle" fontSize={10} fill="#94a3b8" fontStyle="italic">{sub}</text>
    </g>
  );
}

function SourceBox({ x, y, label, sub, fill, stroke }: { x: number; y: number; label: string; sub: string; fill: string; stroke: string }) {
  return (
    <g>
      <rect x={x} y={y} width={170} height={56} rx={8} fill={fill} stroke={stroke} strokeWidth={1.2} />
      <text x={x + 85} y={y + 25} textAnchor="middle" fontWeight={700} fontSize={12} fill={stroke}>{label}</text>
      <text x={x + 85} y={y + 42} textAnchor="middle" fontSize={9.5} fill={stroke} fontStyle="italic">{sub}</text>
    </g>
  );
}

function OutputBox({ x, y, width, label, sub, fill, stroke }: { x: number; y: number; width: number; label: string; sub: string; fill: string; stroke: string }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={62} rx={10} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x + width / 2} y={y + 26} textAnchor="middle" fontWeight={700} fontSize={13} fill={stroke}>{label}</text>
      <text x={x + width / 2} y={y + 45} textAnchor="middle" fontSize={10} fill={stroke} fontStyle="italic">{sub}</text>
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, colour, dashed }: { x1: number; y1: number; x2: number; y2: number; colour: string; dashed?: boolean }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colour} strokeWidth={1.2} strokeDasharray={dashed ? '4 2' : undefined} markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill={colour} />
        </marker>
      </defs>
    </g>
  );
}

/* ═══════ Submission pipeline ═══════ */

function SubmissionPipeline() {
  const stages = [
    { label: 'Pillar 1 gold ready',  sub: '5 QRT tables materialised',          icon: Database },
    { label: 'Cross-QRT recon',     sub: 'Sum-of-LoB checks · template ↔ gold', icon: ShieldCheck },
    { label: 'Senior Actuary review', sub: 'Per-template sign-off + comments',   icon: PenLine },
    { label: 'Cross-pillar sign-off', sub: 'Senior Actuary · CRO · Board · CFO', icon: ShieldCheck },
    { label: 'XBRL package',         sub: 'EIOPA taxonomy · validated locally',  icon: FileText },
    { label: 'Submit to supervisor',  sub: 'Upload · acknowledgement received',  icon: Send },
    { label: 'Archive + certificate', sub: 'Immutable record · hash-stamped',    icon: ArchiveIcon },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {stages.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-1">
              <div className="border-2 border-amber-200 bg-amber-50/40 rounded-lg px-3 py-2.5 min-w-[170px]">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-amber-700" />
                  <span className="text-xs font-bold text-gray-900">{s.label}</span>
                </div>
                <div className="text-[10px] text-gray-600 mt-1 leading-snug">{s.sub}</div>
              </div>
              {i < stages.length - 1 && (
                <svg width={22} height={20} viewBox="0 0 22 20" className="text-amber-400 shrink-0">
                  <path d="M 0 10 L 18 10 M 14 5 L 19 10 L 14 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500 mt-3 italic">
        Every artefact in this chain carries a hash + author + timestamp. The certificate at the end is what
        an external auditor sees first — and from there, every upstream artefact is one click away.
      </p>
    </div>
  );
}

/* ═══════ Sign-off chain ═══════ */

function SignOffChain() {
  const roles = [
    { role: 'Preparer',                 scope: 'Per-template completeness + tie-out to gold',                       fail: 'Returns to author for fix', external: false },
    { role: 'Senior Reserving Actuary',  scope: 'Reserves + UW templates — methodology + reasonableness',           fail: 'Returns to preparer with comments', external: false },
    { role: 'Chief Risk Officer',       scope: 'Risk profile + own funds — consistency with ORSA + AFR',            fail: 'Returns to Senior Actuary; may trigger overlay or model review', external: false },
    { role: 'Board Risk Committee',     scope: 'Annual cycle (SFCR / RSR / AFR) — strategy-level review',           fail: 'Returns to CRO with formal Board minute', external: false },
    { role: 'CFO',                      scope: 'Final approval for submission to supervisor',                       fail: 'Submission blocked; root cause must clear', external: false },
    { role: 'External auditor',         scope: 'Audit opinion on the SFCR (jurisdictions where required, e.g. DE/UK/NL). Attestation on specific QRTs (S.23.01 Own Funds, S.25.01 SCR) and on solvency ratio.', fail: 'Modified opinion or emphasis-of-matter; firm must respond before publication. Material issues escalated to supervisor.', external: true },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-amber-50 text-[10px] uppercase tracking-widest text-amber-900">
          <tr>
            <th className="text-left px-4 py-2.5">Role</th>
            <th className="text-left px-4 py-2.5">Scope of approval</th>
            <th className="text-left px-4 py-2.5">On reject</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r, i) => (
            <tr key={r.role} className={`border-t border-gray-100 ${r.external ? 'bg-slate-50/60' : ''}`}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${r.external ? 'bg-slate-200 text-slate-800' : 'bg-amber-100 text-amber-800'}`}>{i + 1}</div>
                  <span className="text-sm font-semibold text-gray-900">{r.role}</span>
                  {r.external && (
                    <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">external</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 text-xs text-gray-700 leading-relaxed">{r.scope}</td>
              <td className="px-4 py-2.5 text-xs text-gray-500 italic">{r.fail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
        Every approval lands in <code className="text-amber-700 font-mono">6_gov_approval_history</code> with an immutable hash —
        Pillar 2's <Link to="/internal-controls" className="text-amber-700 hover:underline">Internal Controls</Link> read from the same table.
      </p>
    </div>
  );
}

/* ═══════ MCR + Article 138 breach-watch ═══════ */

function MCRBreachWatch() {
  // Anchored to the 210% solvency baseline (the canonical view across the demo).
  // SCR ≈ EUR 556M · total OF ≈ EUR 1.17B (T1 dominant, T2 ~145M, T3 ~30M).
  // Linear MCR ≈ 19% of SCR — below the 25% floor — so the floor binds.
  // MCR = clamp(linear, 25%·SCR, 45%·SCR).
  const scr_eur = 556_000_000;
  const linear_mcr = 105_000_000;
  const mcr_floor = scr_eur * 0.25;
  const mcr_cap   = scr_eur * 0.45;
  const mcr_eur   = Math.min(mcr_cap, Math.max(mcr_floor, linear_mcr));
  // MCR-eligible OF: T1 fully eligible · T2 capped at 20% of MCR for MCR
  // (much tighter than the SCR rule that allows T2 ≤ 50% of SCR) · T3 not
  // eligible at all. T1 ~ 975M + T2 capped at 27.8M → ~1.0B eligible for MCR.
  const eligible_own_funds_for_mcr = 1_000_000_000;
  const mcr_coverage_ratio = eligible_own_funds_for_mcr / mcr_eur;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Calculation panel */}
        <article className="border-2 border-amber-200 bg-white rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="w-4 h-4 text-amber-700" />
            <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wide">How MCR is computed</h3>
          </div>
          <div className="space-y-2 text-xs">
            <CalcRow label="Linear MCR (per-LoB formula)" value={fmtBn(linear_mcr)} note="From S.28.01 — combination of TPs, written premium, capital-at-risk." />
            <CalcRow label="25% × SCR floor"               value={fmtBn(mcr_floor)} note="If linear MCR < floor, MCR = floor. Currently binding." emphasise />
            <CalcRow label="45% × SCR cap"                 value={fmtBn(mcr_cap)} note="If linear MCR > cap, MCR = cap." />
            <div className="border-t border-gray-200 pt-2 mt-2 flex items-baseline justify-between">
              <span className="text-sm font-bold text-amber-900">Final MCR</span>
              <span className="font-mono font-bold text-amber-900">{fmtBn(mcr_eur)}</span>
            </div>
            <div className="flex items-baseline justify-between text-[11px] text-gray-600">
              <span>MCR / SCR</span>
              <span className="font-mono">{((mcr_eur / scr_eur) * 100).toFixed(0)}% (25% floor binding)</span>
            </div>
          </div>
        </article>

        {/* Coverage panel */}
        <article className="border-2 border-emerald-200 bg-white rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-bold text-emerald-900 uppercase tracking-wide">Current coverage</h3>
          </div>
          <div className="space-y-2 text-xs">
            <CalcRow label="Eligible own funds (MCR tier-restricted)" value={fmtBn(eligible_own_funds_for_mcr)} note="Tier 1 unrestricted + Tier 1 restricted up to 20% of total Tier 1 + Tier 2 up to 20% of MCR." />
            <CalcRow label="MCR" value={fmtBn(mcr_eur)} note="From the calculation on the left." />
            <div className="border-t border-gray-200 pt-2 mt-2 flex items-baseline justify-between">
              <span className="text-sm font-bold text-emerald-900">MCR coverage ratio</span>
              <span className="font-mono font-bold text-emerald-900">{(mcr_coverage_ratio * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-2">
              <CoverageBar pct={mcr_coverage_ratio} />
              <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono">
                <span>0%</span><span className="text-amber-700 font-bold">100% — Art. 138 trigger</span><span>800%</span>
              </div>
            </div>
          </div>
        </article>
      </div>

      {/* Article 138 explainer */}
      <article className="border-2 border-rose-200 bg-rose-50/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-rose-700" />
          <h3 className="text-sm font-bold text-rose-900 uppercase tracking-wide">Article 138 — what a breach actually triggers</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-700 leading-relaxed">
          <div>
            <div className="font-semibold text-rose-900">Below MCR</div>
            <p className="mt-1">Immediate supervisory notification. 1-month recovery plan to restore Tier 1 + 2 cover. Authorisation withdrawal becomes possible if not remediated within 3 months.</p>
          </div>
          <div>
            <div className="font-semibold text-rose-900">Below SCR (above MCR)</div>
            <p className="mt-1">Supervisory notification within 2 months. 6-month realistic recovery plan. Quarterly progress reports to the supervisor.</p>
          </div>
          <div>
            <div className="font-semibold text-rose-900">Continuous monitoring</div>
            <p className="mt-1">MCR is computed quarterly but tracked continuously off the gold layer. Drift below 130% surfaces on the Control Tower as an attention item.</p>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 italic mt-3">
          MCR matters because it has a different consequence regime to SCR. Many head-actuary conversations skip MCR entirely until it's late — the platform keeps it visible.
        </p>
      </article>
    </div>
  );
}

function CalcRow({ label, value, note, emphasise }: { label: string; value: string; note?: string; emphasise?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className={emphasise ? 'font-semibold text-amber-900' : 'text-gray-700'}>{label}</span>
        <span className={`font-mono ${emphasise ? 'font-bold text-amber-900' : 'text-gray-800'}`}>{value}</span>
      </div>
      {note && <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{note}</p>}
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  // Scale runs 0% → 800%. Art. 138 trigger at 100% gets a vertical marker.
  const maxScale = 8;
  const cappedAtRender = Math.min(Math.max(pct, 0), maxScale);
  const widthPct = (cappedAtRender / maxScale) * 100;
  const triggerLeftPct = (1 / maxScale) * 100;
  const tone =
    pct < 1.0 ? 'bg-red-500' :
    pct < 1.3 ? 'bg-amber-500' :
    'bg-emerald-500';
  return (
    <div className="h-3 bg-gray-100 rounded-full overflow-hidden relative">
      <div className={`h-full ${tone} transition-all`} style={{ width: `${widthPct}%` }} />
      <div className="absolute top-0 bottom-0 border-l-2 border-amber-700" style={{ left: `${triggerLeftPct}%` }} />
    </div>
  );
}

function fmtBn(v: number): string {
  if (v >= 1e9) return `EUR ${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `EUR ${(v / 1e6).toFixed(0)}M`;
  return `EUR ${v.toLocaleString('en-GB')}`;
}

/* ═══════ Full QRT inventory ═══════ */

interface QRTRow {
  code: string;
  title: string;
  status: 'live' | 'pattern' | 'group-only';
}
interface QRTGroup { name: string; rows: QRTRow[]; }

const QRT_GROUPS: QRTGroup[] = [
  {
    name: 'Basic information + content',
    rows: [
      { code: 'S.01.01', title: 'Content of the submission',         status: 'pattern' },
      { code: 'S.01.02', title: 'Basic information — general',         status: 'pattern' },
      { code: 'S.01.03', title: 'Basic information — ring-fenced funds', status: 'pattern' },
    ],
  },
  {
    name: 'Balance sheet + own funds',
    rows: [
      { code: 'S.02.01', title: 'Balance sheet',                        status: 'pattern' },
      { code: 'S.02.02', title: 'Liabilities by currency',              status: 'pattern' },
      { code: 'S.03.01', title: 'Off-balance-sheet items — general',     status: 'pattern' },
      { code: 'S.04.01', title: 'Activity by country',                  status: 'pattern' },
      { code: 'S.23.01', title: 'Own funds',                            status: 'pattern' },
    ],
  },
  {
    name: 'Non-life',
    rows: [
      { code: 'S.05.01', title: 'Premiums, claims & expenses by LoB',   status: 'live' },
      { code: 'S.05.02', title: 'Premiums, claims & expenses by country', status: 'pattern' },
      { code: 'S.17.01', title: 'Non-life technical provisions',         status: 'pattern' },
      { code: 'S.19.01', title: 'Non-life claims development triangles', status: 'pattern' },
      { code: 'S.20.01', title: 'Development of distribution of claims', status: 'pattern' },
      { code: 'S.21.01', title: 'Loss distribution risk profile',         status: 'pattern' },
      { code: 'S.21.02', title: 'Underwriting risks',                    status: 'pattern' },
      { code: 'S.21.03', title: 'NL distribution by sum insured',         status: 'pattern' },
    ],
  },
  {
    name: 'Life + health',
    rows: [
      { code: 'S.12.01', title: 'Life + health SLT technical provisions', status: 'live' },
      { code: 'S.13.01', title: 'Projection of future cash-flows',         status: 'pattern' },
      { code: 'S.14.01', title: 'Life obligations analysis',              status: 'pattern' },
      { code: 'S.15.01', title: 'Variable annuities — guarantees',          status: 'pattern' },
      { code: 'S.16.01', title: 'Annuities from non-life',                  status: 'pattern' },
      { code: 'S.22.01', title: 'LTG and transitionals — impact',           status: 'pattern' },
    ],
  },
  {
    name: 'Assets + investments',
    rows: [
      { code: 'S.06.02', title: 'List of assets',                          status: 'live' },
      { code: 'S.06.03', title: 'Collective investments — look-through',    status: 'pattern' },
      { code: 'S.07.01', title: 'Structured products',                      status: 'pattern' },
      { code: 'S.08.01', title: 'Open derivatives',                          status: 'pattern' },
      { code: 'S.08.02', title: 'Derivatives transactions in the period',   status: 'pattern' },
      { code: 'S.09.01', title: 'Income / gains and losses on assets',       status: 'pattern' },
      { code: 'S.10.01', title: 'Securities lending / repos',                status: 'pattern' },
      { code: 'S.11.01', title: 'Assets held as collateral',                 status: 'pattern' },
    ],
  },
  {
    name: 'Capital — SCR + MCR',
    rows: [
      { code: 'S.25.01', title: 'SCR — standard formula',                  status: 'live' },
      { code: 'S.25.02', title: 'SCR — partial internal model',              status: 'pattern' },
      { code: 'S.25.03', title: 'SCR — full internal model',                 status: 'pattern' },
      { code: 'S.26.01', title: 'SCR market risk',                          status: 'pattern' },
      { code: 'S.26.02', title: 'SCR counterparty default risk',             status: 'pattern' },
      { code: 'S.26.03', title: 'SCR life UW risk',                          status: 'pattern' },
      { code: 'S.26.04', title: 'SCR health UW risk',                        status: 'pattern' },
      { code: 'S.26.05', title: 'SCR non-life UW risk',                       status: 'pattern' },
      { code: 'S.26.06', title: 'SCR non-life cat risk',                     status: 'live' },
      { code: 'S.26.07', title: 'SCR operational risk',                     status: 'pattern' },
      { code: 'S.27.01', title: 'SCR health cat risk',                      status: 'pattern' },
      { code: 'S.28.01', title: 'MCR — non-composite',                       status: 'pattern' },
      { code: 'S.28.02', title: 'MCR — composite',                            status: 'pattern' },
      { code: 'S.29.01', title: 'Excess of assets over liabilities — analysis', status: 'pattern' },
    ],
  },
  {
    name: 'Reinsurance + special-purpose vehicles',
    rows: [
      { code: 'S.30.01', title: 'Facultative covers — basic data',           status: 'pattern' },
      { code: 'S.30.02', title: 'Facultative covers — shares data',           status: 'pattern' },
      { code: 'S.30.03', title: 'Outgoing reinsurance programme — basic',     status: 'pattern' },
      { code: 'S.30.04', title: 'Outgoing reinsurance programme — shares',     status: 'pattern' },
      { code: 'S.31.01', title: 'Share of reinsurers',                        status: 'pattern' },
      { code: 'S.31.02', title: 'SPVs',                                       status: 'pattern' },
    ],
  },
  {
    name: 'Group templates (S.32–S.37)',
    rows: [
      { code: 'S.32.01', title: 'Undertakings in the scope of the group',     status: 'group-only' },
      { code: 'S.33.01', title: 'Insurance + reinsurance individual requirements', status: 'group-only' },
      { code: 'S.34.01', title: 'Other regulated + non-regulated financial undertakings', status: 'group-only' },
      { code: 'S.35.01', title: 'Contribution to group TPs',                    status: 'group-only' },
      { code: 'S.36.01', title: 'IGT — equity-type transactions',                status: 'group-only' },
      { code: 'S.37.01', title: 'Risk concentration',                           status: 'group-only' },
    ],
  },
];

const STATUS_META: Record<QRTRow['status'], { label: string; cls: string }> = {
  live:        { label: 'live in demo',        cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  pattern:     { label: 'same pipeline pattern', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  'group-only':{ label: 'group only — N/A solo', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

function FullQRTInventory() {
  const allRows = QRT_GROUPS.flatMap((g) => g.rows);
  const liveCount    = allRows.filter((r) => r.status === 'live').length;
  const patternCount = allRows.filter((r) => r.status === 'pattern').length;
  const groupCount   = allRows.filter((r) => r.status === 'group-only').length;
  return (
    <details className="group bg-white border border-gray-200 rounded-xl overflow-hidden">
      <summary className="px-4 py-3 border-b border-transparent group-open:border-gray-200 bg-amber-50/60 cursor-pointer hover:bg-amber-100/60 transition-colors list-none">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-700 shrink-0" />
          <div className="flex-1 text-sm text-amber-900">
            <span className="font-bold">{allRows.length} EIOPA templates</span>
            <span className="text-amber-700"> · {liveCount} live · {patternCount} pattern · {groupCount} group-only</span>
          </div>
          <span className="text-[11px] text-amber-700 font-semibold uppercase tracking-wider">Click to expand</span>
          <ChevronDown className="w-4 h-4 text-amber-700 transition-transform group-open:rotate-180 shrink-0" />
        </div>
      </summary>
      <div className="p-4 space-y-4">
        {QRT_GROUPS.map((g) => (
          <div key={g.name}>
            <h4 className="text-xs uppercase tracking-widest font-bold text-amber-900 mb-2">{g.name}</h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {g.rows.map((r) => {
                const m = STATUS_META[r.status];
                return (
                  <li key={r.code} className="flex items-baseline gap-2 px-2 py-1 text-xs hover:bg-gray-50 rounded">
                    <code className="font-mono text-gray-800 w-16 shrink-0">{r.code}</code>
                    <span className="flex-1 text-gray-700">{r.title}</span>
                    <span className={`text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded border ${m.cls} whitespace-nowrap`}>{m.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="pt-2 border-t border-gray-100 text-[11px] text-gray-500 italic space-y-1">
          <p>
            <span className="font-semibold not-italic text-gray-700">Same pipeline pattern</span> means: silver staging → gold materialisation → audit snapshot → XBRL packaging — the same workflow that drives the five live templates. Onboarding a new template is a config addition, not a code rewrite.
          </p>
          <p>
            <span className="font-semibold not-italic text-gray-700">Group templates (S.32–S.37)</span> are not exercised because Bricksurance is presented as a solo composite. For a group structure, the same pattern applies: each group entity contributes solo-level submissions; the group templates aggregate them with Method 1 (default accounting consolidation) or Method 2 (deduction + aggregation). Group SCR, IGT (S.36), and risk concentration (S.37) sit on top of solo gold tables — no separate engine.
          </p>
        </div>
      </div>
    </details>
  );
}

/* ═══════ Long-term guarantee measures + transitionals ═══════ */

interface LTGMeasure {
  code: string;
  name: string;
  what: string;
  use: string;
  ratioWithPct: number;
  ratioWithoutPct: number;
}

const LTG_MEASURES: LTGMeasure[] = [
  {
    code: 'Article 77d',
    name: 'Volatility Adjustment (VA)',
    what: 'Adjusts the risk-free curve upward by a country-specific spread, dampening artificial spread-widening impacts on TPs.',
    use: 'Applied across our euro-denominated portfolio. Reduces solvency-ratio volatility under credit-spread stress.',
    ratioWithPct: 210,
    ratioWithoutPct: 196,
  },
  {
    code: 'Article 77b',
    name: 'Matching Adjustment (MA)',
    what: 'Permits a higher discount rate on selected long-dated portfolios with cashflow-matched assets. Requires supervisory approval per portfolio.',
    use: 'Not used by Bricksurance — applies mainly to UK annuity writers and certain Spanish life books.',
    ratioWithPct: 210,
    ratioWithoutPct: 210,
  },
  {
    code: 'Article 308d',
    name: 'Transitional on Technical Provisions',
    what: 'Linear phase-in from Solvency I-style TPs to Solvency II TPs over 16 years (1 Jan 2016 → end-2031). Mechanical convergence; declining buffer each year.',
    use: 'Applied to the life annuity book inherited from the 2019 acquisition. Remaining buffer EUR 18M; unwinds end-2031.',
    ratioWithPct: 210,
    ratioWithoutPct: 205,
  },
  {
    code: 'Article 308c',
    name: 'Transitional on Risk-Free Rate',
    what: 'Linear phase-in from pre-Solvency-II rates to current risk-free curve over 16 years. Mutually exclusive with Article 308d on the same portfolio.',
    use: 'Not used — Article 308d election covered the same book.',
    ratioWithPct: 210,
    ratioWithoutPct: 210,
  },
];

function LTGMeasures() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {LTG_MEASURES.map((m) => {
          const impact = m.ratioWithPct - m.ratioWithoutPct;
          const inUse = impact > 0 || m.use.toLowerCase().includes('applied');
          return (
            <article key={m.code} className={`border-2 rounded-xl p-4 bg-white ${inUse ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-slate-50/30'}`}>
              <header className="flex items-baseline gap-2 flex-wrap mb-2">
                <code className="text-[10px] font-mono text-amber-800 font-bold uppercase tracking-wide">{m.code}</code>
                <h3 className="text-base font-bold text-gray-900">{m.name}</h3>
                {inUse ? (
                  <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">in use</span>
                ) : (
                  <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">not elected</span>
                )}
              </header>
              <p className="text-xs text-gray-700 leading-relaxed">{m.what}</p>
              <p className="text-[11px] text-gray-600 italic leading-snug mt-2 border-t border-gray-100 pt-2">{m.use}</p>

              {/* Impact strip */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="text-center px-2 py-1.5 rounded bg-emerald-50 border border-emerald-200">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold">With</div>
                  <div className="font-mono font-bold text-emerald-900">{m.ratioWithPct}%</div>
                </div>
                <div className="text-center px-2 py-1.5 rounded bg-slate-50 border border-slate-200">
                  <div className="text-[10px] uppercase tracking-wide text-slate-700 font-bold">Without</div>
                  <div className="font-mono font-bold text-slate-900">{m.ratioWithoutPct}%</div>
                </div>
                <div className={`text-center px-2 py-1.5 rounded border ${impact > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase tracking-wide font-bold ${impact > 0 ? 'text-amber-700' : 'text-slate-600'}`}>Impact</div>
                  <div className={`font-mono font-bold ${impact > 0 ? 'text-amber-900' : 'text-slate-700'}`}>
                    {impact > 0 ? `+${impact}pp` : '—'}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Aggregate impact + supervisory note */}
      <article className="border-2 border-rose-200 bg-rose-50/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-rose-700" />
          <h3 className="text-sm font-bold text-rose-900 uppercase tracking-wide">Why this matters for the Board</h3>
        </div>
        <p className="text-xs text-gray-700 leading-relaxed">
          Solvency ratio with all elected measures applied is <span className="font-mono font-bold text-emerald-900">210%</span>;
          without VA + the TP transitional together, the same balance sheet supports <span className="font-mono font-bold text-amber-900">~191%</span>
          {' '}(VA −14pp + transitional −5pp, with a small interaction). That 19-point gap is what the supervisor and rating agencies
          scrutinise. S.22.01 forces the with-and-without disclosure precisely because the measures shift the headline,
          and because they are <em>regulatory mechanisms with declining tails</em> — the TP transitional unwinds linearly
          and expires end-2031.
        </p>
      </article>
    </div>
  );
}



/* ═══════ EIOPA Validation Rules drill-down ═══════ */

interface EVRTemplateStats { template: string; title: string; total: number; passed: number; warnings: number; errors: number; }

// Per-template rule counts based on EIOPA 2.8 taxonomy plausible distribution.
// Real EVR counts (BV+EV+IV combined): S.05.01 ≈ 280, S.06.02 ≈ 410, S.12.01 ≈ 190,
// S.25.01 ≈ 320, S.26.06 ≈ 95. Other templates not exercised in this demo.
const EVR_TEMPLATES: EVRTemplateStats[] = [
  { template: 'S.05.01', title: 'Premiums, claims & expenses',     total: 283, passed: 281, warnings: 2,  errors: 0 },
  { template: 'S.06.02', title: 'List of assets',                  total: 412, passed: 405, warnings: 6,  errors: 1 },
  { template: 'S.12.01', title: 'Life TPs',                        total: 187, passed: 187, warnings: 0,  errors: 0 },
  { template: 'S.25.01', title: 'SCR — Standard Formula',           total: 321, passed: 314, warnings: 4,  errors: 3 },
  { template: 'S.26.06', title: 'Non-life cat',                    total:  94, passed:  93, warnings: 1,  errors: 0 },
];

// Worked examples of rules — these are real EIOPA rule patterns (rule codes are
// representative; exact codes vary by taxonomy version). Used to ground the
// drill-down in something a practitioner recognises.
interface FailedRuleExample {
  code: string;
  category: 'BV' | 'EV' | 'IV';
  template: string;
  rule: string;
  status: 'error' | 'warning' | 'waived';
  resolution: string;
}

const FAILED_RULES: FailedRuleExample[] = [
  {
    code: 'EV148',
    category: 'EV',
    template: 'S.06.02 ↔ S.02.01',
    rule: 'Sum of asset valuations in S.06.02 (C0170) shall equal corresponding asset rows in S.02.01.02 balance sheet within rounding tolerance.',
    status: 'error',
    resolution: 'Custodian ABN AMRO feed landed 4h late · 12 holdings classified after S.02.01 snapshot. Resolved by re-running silver staging in the cycle; assertion now clears.',
  },
  {
    code: 'BV259',
    category: 'BV',
    template: 'S.25.01',
    rule: 'SCR_market sub-module total must equal sum of components (interest rate · equity · property · spread · currency · concentration).',
    status: 'error',
    resolution: 'Concentration risk component had a stale lookup version. Reserve-action item to update mid-cycle; same code re-runs nightly.',
  },
  {
    code: 'IV094',
    category: 'IV',
    template: 'S.25.01',
    rule: 'BSCR_pre_op_risk + Operational_risk – LAC_TP – LAC_DT must equal SCR_total within rounding (5 EUR).',
    status: 'error',
    resolution: 'LAC_DT projection re-ran after the latest assumption update; reconciliation now within EUR 2.',
  },
  {
    code: 'BV031',
    category: 'BV',
    template: 'S.05.01',
    rule: 'Gross premiums written by LoB must reconcile to total gross premiums written (R0200 column).',
    status: 'warning',
    resolution: 'Late motor binder for EUR 1.4M was outside LoB allocation — manual adjustment recorded; full re-allocation runs in next cycle.',
  },
];

function EVRValidationDrilldown() {
  const totals = EVR_TEMPLATES.reduce(
    (a, t) => ({ total: a.total + t.total, passed: a.passed + t.passed, warnings: a.warnings + t.warnings, errors: a.errors + t.errors }),
    { total: 0, passed: 0, warnings: 0, errors: 0 },
  );
  const passPct = ((totals.passed / totals.total) * 100).toFixed(1);

  return (
    <div className="space-y-3">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBox label="Rules run this cycle"  value={totals.total.toLocaleString('en-GB')} sub="EIOPA 2.8 taxonomy" tone="neutral" />
        <KpiBox label="Passing"                value={`${passPct}%`}                          sub={`${totals.passed.toLocaleString('en-GB')} of ${totals.total.toLocaleString('en-GB')}`} tone="good" />
        <KpiBox label="Warnings"               value={String(totals.warnings)}                sub="non-blocking · flagged for review" tone="warn" />
        <KpiBox label="Blocking errors"        value={String(totals.errors)}                   sub="must clear before XBRL package" tone="bad" />
      </div>

      {/* Per-template table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-amber-50/60 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-700" />
          <h4 className="text-sm font-bold text-amber-900">Per-template rule pass rate</h4>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-600">
            <tr>
              <th className="text-left px-4 py-2">Template</th>
              <th className="text-left px-4 py-2">Title</th>
              <th className="text-right px-4 py-2">Rules</th>
              <th className="text-right px-4 py-2">Passed</th>
              <th className="text-right px-4 py-2">Warnings</th>
              <th className="text-right px-4 py-2">Errors</th>
              <th className="text-left px-4 py-2 w-[20%]">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {EVR_TEMPLATES.map((t) => {
              const pct = (t.passed / t.total) * 100;
              const tone = pct === 100 ? 'bg-emerald-500' : pct >= 99 ? 'bg-amber-500' : 'bg-rose-500';
              return (
                <tr key={t.template} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-mono text-xs text-amber-800 font-bold">{t.template}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">{t.title}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono">{t.total}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-emerald-700 font-semibold">{t.passed}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-amber-700">{t.warnings || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-rose-700 font-semibold">{t.errors || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-gray-700 whitespace-nowrap">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
          BV = Business Validation (within template) · EV = External Validation (cross-template) · IV = Internal Validation (within row, e.g. sub-totals).
          Warnings don't block; errors do. The XBRL package can't be generated while any error stands.
        </p>
      </div>

      {/* Failed-rule examples + resolution */}
      <details className="group bg-white border border-gray-200 rounded-xl overflow-hidden">
        <summary className="px-4 py-3 border-b border-transparent group-open:border-gray-200 bg-rose-50/40 cursor-pointer hover:bg-rose-100/40 transition-colors list-none">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
            <div className="flex-1 text-sm">
              <span className="font-bold text-rose-900">Worked examples — recent rule failures + how they cleared</span>
            </div>
            <ChevronDown className="w-4 h-4 text-rose-700 transition-transform group-open:rotate-180" />
          </div>
        </summary>
        <div className="p-4 space-y-3">
          {FAILED_RULES.map((r) => {
            const catCls = r.category === 'EV' ? 'bg-violet-100 text-violet-800 border-violet-200'
                        : r.category === 'IV' ? 'bg-sky-100 text-sky-800 border-sky-200'
                        : 'bg-amber-100 text-amber-800 border-amber-200';
            const sevCls = r.status === 'error' ? 'bg-rose-100 text-rose-800 border-rose-200'
                        : r.status === 'warning' ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200';
            return (
              <article key={r.code} className="border border-gray-200 rounded-lg p-3 bg-white">
                <header className="flex items-baseline gap-2 flex-wrap">
                  <code className="text-[11px] font-mono text-gray-800 font-bold">{r.code}</code>
                  <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${catCls}`}>{r.category}</span>
                  <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${sevCls}`}>{r.status}</span>
                  <span className="text-[11px] font-mono text-gray-500">{r.template}</span>
                </header>
                <p className="text-xs text-gray-800 mt-2 leading-relaxed">{r.rule}</p>
                <p className="text-[11px] text-emerald-800 italic mt-1.5 leading-snug">→ {r.resolution}</p>
              </article>
            );
          })}
          <p className="text-[11px] text-gray-500 italic">
            Every failure becomes a triage queue item with the rule code, the impacted cell(s), the expected value, and the current value.
            Resolution lands as a row in <code className="text-amber-700 font-mono">6_gov_evr_resolutions</code> so the supervisor can see the timeline.
          </p>
        </div>
      </details>
    </div>
  );
}

function KpiBox({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const cls = {
    good:    { border: 'border-emerald-200', bg: 'bg-emerald-50/60', text: 'text-emerald-900' },
    warn:    { border: 'border-amber-200',   bg: 'bg-amber-50/60',   text: 'text-amber-900' },
    bad:     { border: 'border-rose-200',    bg: 'bg-rose-50/60',    text: 'text-rose-900' },
    neutral: { border: 'border-gray-200',    bg: 'bg-white',         text: 'text-gray-900' },
  }[tone];
  return (
    <div className={`rounded-lg border ${cls.border} ${cls.bg} p-3`}>
      <div className={`text-2xl font-bold ${cls.text}`}>{value}</div>
      <div className="text-xs text-gray-700 font-medium mt-0.5">{label}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

/* ═══════ Restatement workflow ═══════ */

function RestatementWorkflow() {
  const stages = [
    { label: 'Detection',          sub: 'Internal control alert · external auditor finding · supervisor query · self-discovered',                                icon: AlertCircle },
    { label: 'Materiality test',   sub: 'Below threshold → record-and-disclose at next cycle. Above → trigger restatement.',                                       icon: Calculator },
    { label: 'Re-run gold',         sub: 'Re-materialise the affected silver + gold tables with the corrected input · audit snapshot updated',                      icon: Database },
    { label: 'Approval (CRO + AFR holder)', sub: 'Restatement justification + scope of impact (which QRTs, which SFCR sections, which periods)',                  icon: ShieldCheck },
    { label: 'Resubmit + flag',     sub: 'New XBRL package with "amended" flag + auditor-friendly amendment letter · prior submission stays in archive (immutable)', icon: Send },
    { label: 'Audit log entry',     sub: 'Single row in 6_gov_restatements capturing detection date · approver · impact · re-submission date · supervisor ack',     icon: FileText },
  ];

  const examples = [
    {
      what: 'S.08.01 — derivatives mis-valued at Q1',
      detail: 'Counterparty mark-to-model used a stale CDS curve. Net impact: EUR 2.1M reduction in own funds (immaterial vs SCR but >0.1% so restated).',
      cycle: '14 calendar days from detection to re-submission',
    },
    {
      what: 'S.05.01 — motor classification correction at Q2',
      detail: 'Hailstorm-driven motor losses originally classified as "natural cat"; reclassified to "weather other than cat" per LoB definition.',
      cycle: '7 calendar days from detection (no SCR impact)',
    },
  ];

  return (
    <div className="space-y-3">
      {/* Six-stage horizontal flow */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {stages.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-center gap-1">
                <div className="border-2 border-rose-200 bg-rose-50/40 rounded-lg px-3 py-2.5 min-w-[180px]">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-rose-700" />
                    <span className="text-xs font-bold text-gray-900">{s.label}</span>
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1 leading-snug">{s.sub}</div>
                </div>
                {i < stages.length - 1 && (
                  <svg width={22} height={20} viewBox="0 0 22 20" className="text-rose-400 shrink-0">
                    <path d="M 0 10 L 18 10 M 14 5 L 19 10 L 14 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 italic mt-3">
          The prior submission stays in the immutable archive — restatements <em>amend</em>, they don't <em>overwrite</em>. The audit trail shows both versions and the link between them.
        </p>
      </div>

      {/* Worked examples */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {examples.map((e) => (
          <article key={e.what} className="border-2 border-rose-200 bg-white rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-widest font-bold text-rose-700">Worked example</div>
            <h4 className="text-sm font-bold text-gray-900 mt-1">{e.what}</h4>
            <p className="text-xs text-gray-700 mt-2 leading-relaxed">{e.detail}</p>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-800 font-semibold">
              <CheckCircle className="w-3 h-3" />
              <span>{e.cycle}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ═══════ National reporting — supplementary returns by jurisdiction ═══════ */

interface NationalReturn {
  jurisdiction: string;
  flag: string;          // emoji-free; just a 2-3 letter code we render in a chip
  authority: string;
  return_name: string;
  frequency: string;
  what: string;
  in_scope: boolean;
}

const NATIONAL_RETURNS: NationalReturn[] = [
  {
    jurisdiction: 'Germany',
    flag: 'DE',
    authority: 'BaFin',
    return_name: 'VAG meldewesen (Versicherungsaufsichtsgesetz)',
    frequency: 'Quarterly + annual',
    what: 'Branch-by-branch business + investment + risk reports under §§ 47-51 VAG. Goes beyond Solvency II QRTs: distribution-channel splits, complaints stats, AML.',
    in_scope: true,
  },
  {
    jurisdiction: 'United Kingdom',
    flag: 'UK',
    authority: 'PRA',
    return_name: 'National Specific Templates (NST)',
    frequency: 'Annual + ad-hoc',
    what: 'NST.01-NST.09 (with-profits, ring-fenced funds, Lloyds, asset look-through extensions). Replaces some EIOPA templates with PRA-specific cuts.',
    in_scope: false,
  },
  {
    jurisdiction: 'United Kingdom',
    flag: 'UK',
    authority: 'FCA',
    return_name: 'RMAR + IRS returns',
    frequency: 'Quarterly + annual',
    what: 'Conduct + capital adequacy returns for FCA-regulated activities (brokerage, distribution).',
    in_scope: false,
  },
  {
    jurisdiction: 'France',
    flag: 'FR',
    authority: 'ACPR',
    return_name: 'États comptables + Tableaux complémentaires',
    frequency: 'Quarterly + annual',
    what: 'Accounting statements + life-specific complementary tables (PER, contracts en déshérence). Goes beyond EIOPA on assignment of profits + bonus.',
    in_scope: false,
  },
  {
    jurisdiction: 'Italy',
    flag: 'IT',
    authority: 'IVASS',
    return_name: 'Modulistica',
    frequency: 'Annual',
    what: 'IVASS-specific risk profile + corporate governance tables, distribution by mediator type.',
    in_scope: false,
  },
  {
    jurisdiction: 'EIOPA stress test',
    flag: 'EU',
    authority: 'EIOPA',
    return_name: 'Insurance stress test',
    frequency: 'Biennial',
    what: 'Cross-firm market + insurance stress applied to harmonised templates. Currently 2026 cycle in scope.',
    in_scope: true,
  },
];

function NationalReporting() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-amber-50 text-[10px] uppercase tracking-widest text-amber-900">
          <tr>
            <th className="text-left px-3 py-2.5 w-[14%]">Jurisdiction</th>
            <th className="text-left px-3 py-2.5">Authority + return</th>
            <th className="text-left px-3 py-2.5 w-[16%]">Frequency</th>
            <th className="text-left px-3 py-2.5">What it adds beyond Solvency II</th>
            <th className="text-center px-3 py-2.5 w-[10%]">In scope</th>
          </tr>
        </thead>
        <tbody>
          {NATIONAL_RETURNS.map((r, i) => (
            <tr key={i} className={`border-t border-gray-100 align-top ${r.in_scope ? '' : 'bg-slate-50/40'}`}>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">{r.flag}</span>
                  <span className="text-xs text-gray-800">{r.jurisdiction}</span>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="text-xs text-gray-900 font-semibold">{r.authority}</div>
                <div className="text-[11px] text-gray-600 italic mt-0.5">{r.return_name}</div>
              </td>
              <td className="px-3 py-2.5 text-xs text-amber-800 font-mono">{r.frequency}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700 leading-relaxed">{r.what}</td>
              <td className="px-3 py-2.5 text-center">
                {r.in_scope ? (
                  <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">in scope</span>
                ) : (
                  <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">N/A</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
        Bricksurance is German-licensed (BaFin primary supervisor); only BaFin VAG meldewesen + the EIOPA biennial stress test are in scope.
        The pipeline pattern is identical for any other jurisdiction — additional national templates land in <code className="text-amber-700 font-mono">3_qrt_national_*</code>
        alongside the EIOPA gold tables, and the same XBRL + sign-off chain applies. No engine rewrite to enter a new market.
      </p>
    </div>
  );
}

/* ═══════ Peer benchmarking ═══════ */

interface PeerBand { label: string; bricksurance_pct: number; eiopa_median_pct: number; eiopa_p25_pct: number; eiopa_p75_pct: number; }

const PEER_BANDS: PeerBand[] = [
  { label: 'Solvency ratio (SCR coverage)', bricksurance_pct: 210, eiopa_median_pct: 215, eiopa_p25_pct: 165, eiopa_p75_pct: 280 },
  { label: 'MCR coverage ratio',             bricksurance_pct: 720, eiopa_median_pct: 480, eiopa_p25_pct: 320, eiopa_p75_pct: 650 },
  { label: 'Tier-1 % of own funds',          bricksurance_pct:  84, eiopa_median_pct:  82, eiopa_p25_pct:  72, eiopa_p75_pct:  90 },
  { label: 'BSCR diversification benefit',   bricksurance_pct:  18, eiopa_median_pct:  22, eiopa_p25_pct:  14, eiopa_p75_pct:  30 },
];

function PeerBenchmarking() {
  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-amber-50 text-[10px] uppercase tracking-widest text-amber-900">
            <tr>
              <th className="text-left px-3 py-2.5 w-[28%]">Metric</th>
              <th className="text-center px-3 py-2.5">Bricksurance</th>
              <th className="text-center px-3 py-2.5">EIOPA P25</th>
              <th className="text-center px-3 py-2.5">EIOPA median</th>
              <th className="text-center px-3 py-2.5">EIOPA P75</th>
              <th className="text-left px-3 py-2.5 w-[28%]">Position</th>
            </tr>
          </thead>
          <tbody>
            {PEER_BANDS.map((b) => {
              const isHigh = b.bricksurance_pct >= b.eiopa_p75_pct;
              const isLow  = b.bricksurance_pct <= b.eiopa_p25_pct;
              const pos = isHigh ? { lbl: 'Above P75 (strong)', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
                       : isLow  ? { lbl: 'Below P25 (review)', cls: 'bg-rose-100 text-rose-800 border-rose-200' }
                       : { lbl: 'Within IQR', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
              return (
                <tr key={b.label} className="border-t border-gray-100">
                  <td className="px-3 py-2.5 text-xs text-gray-900 font-semibold">{b.label}</td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono font-bold text-amber-900">{b.bricksurance_pct}%</td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono text-gray-600">{b.eiopa_p25_pct}%</td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono text-gray-700 font-semibold">{b.eiopa_median_pct}%</td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono text-gray-600">{b.eiopa_p75_pct}%</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${pos.cls}`}>{pos.lbl}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
          EIOPA reference: <em>Insurance Statistics — Year-end Q3</em>, latest published cycle. Comparable peer set = European composite + non-life mid-cap insurers (~140 firms).
          The benchmarks are a snapshot; the platform refreshes them when EIOPA publishes the next semi-annual aggregate.
        </p>
      </div>

      <article className="border-2 border-amber-200 bg-amber-50/40 rounded-xl p-4">
        <h4 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
          <Globe className="w-4 h-4 text-amber-700" />
          How the Board reads this
        </h4>
        <p className="text-xs text-gray-700 mt-2 leading-relaxed">
          The solvency ratio sits roughly at the European median (210% vs 215%) — comfortable but not over-capitalised.
          MCR coverage at 720% is in the top quartile, reflecting the tier-1-heavy capital structure.
          BSCR diversification benefit at 18% is on the lower side of the IQR — a non-life-dominant book without significant life UW offsetting market risk would typically reach 25-30%.
          Worth examining in the next ORSA cycle.
        </p>
      </article>
    </div>
  );
}

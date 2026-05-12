/**
 * Pillar 1 overview hub — what an actuary actually wants to see when they
 * open the reporting cycle.
 *
 * Seven sections:
 *   1. Hero + thesis
 *   2. Architecture diagram (bronze → silver → 4 compute lanes → BSCR → gold)
 *   3. Current-quarter snapshot (6 tiles)
 *   4. Compute-lane deep-dive cards (Reserving / SF / Igloo / Prophet)
 *   5. Why this is fast — the integration-tax argument
 *   6. Orchestration / job dependency
 *   7. Internal controls + cross-QRT checks
 *
 * Inline SVG throughout — no external graph deps.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, BarChart3, BookOpen, Flame, FlaskConical, Landmark,
  CheckCircle2, AlertTriangle, Workflow, Wind, Sparkles, Zap, Gauge,
  ArrowRight, ArrowLeft, GitBranch, Database, Beaker,
} from 'lucide-react';
import { fetchPeriodState, fetchLabModels, fetchReconciliation, type LabModelRow, type Row } from '../lib/api';

export default function Pillar1Overview() {
  const [period, setPeriod] = useState<string>('');
  const [models, setModels] = useState<LabModelRow[]>([]);
  const [recon, setRecon] = useState<Row[]>([]);

  useEffect(() => {
    Promise.all([
      fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined),
      fetchLabModels().then((r) => setModels(r.models)).catch(() => undefined),
      fetchReconciliation().then((r) => setRecon(r.data)).catch(() => undefined),
    ]);
  }, []);

  const modelByName = (name: string) => models.find((m) => m.model_id === name);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-7">
      <Link to="/reporting-cycle" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Reporting Cycle
      </Link>

      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <Hero period={period} />

      {/* ── 2. Architecture diagram ─────────────────────────────────────── */}
      <Section
        title="Architecture"
        subtitle="What runs where. Bronze data lands in Unity Catalog, silver staging happens in Databricks, four compute lanes produce the SCR, gold QRTs are the output. Specialist engines (Igloo, Prophet) run natively; integration is a Volume exchange."
      >
        <ArchitectureDiagram />
      </Section>

      {/* ── 3. Current-quarter snapshot ─────────────────────────────────── */}
      <Section
        title={`Current quarter — ${period || 'in progress'}`}
        subtitle="Headline metrics per Pillar 1 component, with model version + status. Click any tile to open the artefact."
      >
        <MetricsGrid models={models} modelByName={modelByName} />
      </Section>

      {/* ── 4. Four compute lanes — deep dive cards ─────────────────────── */}
      <Section
        title="The four compute lanes"
        subtitle="One card per engine. What it computes, the input tables it consumes, the output it produces, current model version, and the controls running on it."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LaneCard
            kind="native"
            title="Reserving"
            icon={BarChart3}
            what="Chain ladder + BF over claims triangles. Best-estimate ultimate + IBNR by line of business and accident year."
            inputs={["1_raw_claims_triangles", "1_raw_premiums", "1_raw_claims"]}
            outputs={["2_stg_premium_reserve_risk", "3_qrt_s0501_*"]}
            engine="Native UC · MLflow pyfunc"
            modelId="reserving_pnc"
            cadence="On every Q-close (DLT-triggered after claims close)"
            controls={[
              "Variance vs prior reserves (pp tolerance, in 6_gov_model_diagnostics)",
              "Triangle consistency score on Q-1 cohort",
              "IFRS 17 best-estimate consistency check (±3%)",
              "Senior Reserving Actuary AI review — anomalies + proposed overlays",
            ]}
            modelRow={modelByName('reserving_pnc')}
          />
          <LaneCard
            kind="native"
            title="Standard Formula"
            icon={Shield}
            what="Aggregates sub-module charges via the EIOPA correlation matrix into BSCR. Adds operational risk = min(max(Op_premium, Op_provisions) + Op_UL, 30%·BSCR). Subtracts LAC_TP and LAC_DT, each limited by available recoverability."
            inputs={["1_raw_risk_factors", "1_raw_own_funds"]}
            outputs={["2_stg_scr_results", "3_qrt_s2501_*"]}
            engine="Native UC · MLflow pyfunc"
            modelId="standard_formula"
            cadence="On every Q-close (after silver staging completes)"
            controls={[
              "Sub-module total reconciles to BSCR within rounding tolerance",
              "EIOPA correlation matrix unchanged from canonical (hash check)",
              "Op risk = min(max(Op_premium, Op_provisions) + Op_UL, 30%·BSCR)",
              "LAC_DT ≤ available DT recoverability (no fixed % cap)",
              "Solvency ratio = own_funds / SCR — sanity cross-check",
            ]}
            modelRow={modelByName('standard_formula')}
          />
          <LaneCard
            kind="external"
            title="Igloo — non-life catastrophe"
            icon={Flame}
            what="Stochastic cat simulation. 10K+ scenarios across European peril set. Output: VaR/TVaR at 99.5%, AAL by peril and line of business."
            inputs={["1_raw_exposures", "2_stg_cat_risk_by_lob"]}
            outputs={["4_eng_stochastic_results", "3_qrt_s2606_*"]}
            engine="WTW Igloo · UC Volume exchange"
            modelId="igloo_cat"
            cadence="On every Q-close · ~45 min Igloo native runtime"
            controls={[
              "Loss-to-event-severity vs prior comparator (Ylenia 2022 for NL/DK windstorms)",
              "Cat agent review: cross-references event log, recommends accept / re-run / escalate",
              "Reasonableness check: modelled AAL within ±30% of long-run average",
              "Cat charge proportionality vs premium + reserve risk",
            ]}
            modelRow={modelByName('igloo_cat')}
          />
          <LaneCard
            kind="external"
            title="Prophet — life UW"
            icon={FlaskConical}
            what="5K-scenario life UW projection. Mortality, longevity, lapse, expense, life cat. Output: best estimate + risk margin + sub-module charges."
            inputs={["1_raw_life_policies", "1_raw_life_assumptions", "1_raw_life_reserves"]}
            outputs={["4_eng_prophet_results", "3_qrt_s1201_*", "3_qrt_life_uw_risk_*"]}
            engine="FIS Prophet · UC Volume exchange"
            modelId="prophet_life"
            cadence="On every Q-close · Prophet native runtime varies"
            controls={[
              "Best estimate convergence score (≥0.95)",
              "Lapse assumption drift vs prior (bps tolerance)",
              "Mortality/longevity assumption vs experience study",
              "Sub-module aggregation matches sum-of-products",
            ]}
            modelRow={modelByName('prophet_life')}
          />
        </div>
      </Section>

      {/* ── 5. Why this is fast ──────────────────────────────────────────── */}
      <Section
        title="Why this is fast"
        subtitle="The integration tax is what gets removed. Data prep + governance + audit stay in Databricks; specialist engines do heavy stochastic math on their native infrastructure; results re-import in seconds."
      >
        <SpeedNarrative />
      </Section>

      {/* ── 6. Orchestration / job dependency ───────────────────────────── */}
      <Section
        title="Orchestration"
        subtitle="What triggers what. DLT pipelines feed silver staging; staging triggers the compute-lane jobs; QRT gold tables materialise from the lane outputs."
      >
        <OrchestrationDiagram />
      </Section>

      {/* ── 7. Internal controls ─────────────────────────────────────────── */}
      <Section
        title="Internal controls"
        subtitle="Cross-QRT recon + per-cell validation running against the current quarter. Anything failing surfaces on the Today Control Tower as an attention item."
      >
        <ControlsList recon={recon} />
      </Section>

      <div className="text-center text-[11px] text-gray-400 italic pt-3">
        Pillar 1 is the calculation. Governance wraps it — see <Link to="/lab" className="text-blue-700 hover:underline">Actuarial Lab</Link>, <Link to="/overlays" className="text-blue-700 hover:underline">Overlays Register</Link>, <Link to="/learn" className="text-blue-700 hover:underline">Learn</Link>.
      </div>
    </div>
  );
}

/* ═══════ Sections ═══════ */

function Hero({ period }: { period: string }) {
  return (
    <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white rounded-2xl p-7 shadow-lg">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-blue-300">
        <Gauge className="w-3.5 h-3.5" /> Pillar 1 — calculation
      </div>
      <h1 className="text-3xl font-bold tracking-tight mt-1.5">
        The numbers underneath every disclosure.
      </h1>
      <p className="text-sm text-slate-300 mt-2 leading-relaxed max-w-3xl">
        Technical provisions, SCR, MCR, own funds. Four compute lanes — Reserving + Standard
        Formula in Unity Catalog, Igloo + Prophet on their native engines — converge through the
        EIOPA correlation matrix into the BSCR, and onward into five EIOPA QRTs.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs text-blue-300">
        <span className="font-mono">Current cycle:</span>
        <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-white">{period || '…'}</code>
        <span className="text-slate-400">·</span>
        <span>5 QRTs · 4 compute lanes · 4 models in UC + 2 specialist engines</span>
      </div>
    </header>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/* ═══════ Architecture diagram ═══════ */

function ArchitectureDiagram() {
  // Hand-positioned SVG: bronze (col 0) → silver (col 1) → 4 lanes (col 2-3 stacked) → BSCR (col 4) → gold (col 5)
  const W = 1100, H = 480;
  const COL_X = [40, 230, 440, 660, 870];

  const BRONZE = [
    { y: 30,  name: '1_raw_claims_triangles' },
    { y: 70,  name: '1_raw_claims' },
    { y: 110, name: '1_raw_premiums' },
    { y: 150, name: '1_raw_exposures' },
    { y: 190, name: '1_raw_risk_factors' },
    { y: 230, name: '1_raw_own_funds' },
    { y: 270, name: '1_raw_assets' },
    { y: 310, name: '1_raw_life_policies' },
    { y: 350, name: '1_raw_life_assumptions' },
    { y: 390, name: '1_raw_life_reserves' },
  ];
  const SILVER = [
    { y: 70,  name: '2_stg_premiums_by_lob' },
    { y: 110, name: '2_stg_claims_by_lob' },
    { y: 150, name: '2_stg_cat_risk_by_lob' },
    { y: 190, name: '2_stg_premium_reserve_risk' },
    { y: 230, name: '2_stg_assets_enriched' },
    { y: 270, name: '2_stg_scr_results' },
    { y: 310, name: '2_stg_life_tp_components' },
    { y: 350, name: '2_stg_life_uw_risk_by_module' },
  ];
  const LANES = [
    { y: 60,  name: 'Reserving',         tag: 'UC pyfunc',     cls: 'violet', icon: 'B' },
    { y: 150, name: 'Igloo (cat)',       tag: 'External · Volume', cls: 'orange', icon: 'F' },
    { y: 240, name: 'Standard Formula',  tag: 'UC pyfunc',     cls: 'blue', icon: 'S' },
    { y: 330, name: 'Prophet (life)',    tag: 'External · Volume', cls: 'purple', icon: 'P' },
  ];
  const GOLD = [
    { y: 60,  name: '3_qrt_s0501' },
    { y: 105, name: '3_qrt_s0602' },
    { y: 150, name: '3_qrt_s2606' },
    { y: 215, name: '3_qrt_s2501  (SCR)' },
    { y: 285, name: '3_qrt_s1201' },
    { y: 330, name: '3_qrt_life_uw' },
  ];

  // Edge map (silver_idx → lane_idx)
  const SILVER_TO_LANE = [
    [0, 0], [1, 0], [2, 1], [3, 0], [4, 2], [5, 2], [6, 3], [7, 3],
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto min-w-[900px]">
        {/* Column headers */}
        <ColumnHeader x={COL_X[0]} label="BRONZE" sub="Raw feeds (UC)" colour="#9a3412" />
        <ColumnHeader x={COL_X[1]} label="SILVER" sub="Staging (Databricks)" colour="#334155" />
        <ColumnHeader x={COL_X[2]} label="COMPUTE LANES" sub="UC pyfunc + specialist engines" colour="#5b21b6" />
        <ColumnHeader x={COL_X[3]} label="BSCR · EIOPA CORRELATION" sub="Module aggregation" colour="#1e40af" />
        <ColumnHeader x={COL_X[4]} label="GOLD QRTs" sub="EIOPA templates" colour="#92400e" />

        {/* Edges */}
        {BRONZE.map((b, i) => {
          // Bronze → Silver: rough one-to-one mapping for visual clarity
          const target = SILVER[Math.min(i, SILVER.length - 1)];
          return <Edge key={`be-${i}`} x1={COL_X[0] + 168} y1={b.y + 12} x2={COL_X[1]} y2={target.y + 12} colour="#cbd5e1" />;
        })}
        {SILVER_TO_LANE.map(([si, li], i) => (
          <Edge key={`sl-${i}`} x1={COL_X[1] + 168} y1={SILVER[si].y + 12} x2={COL_X[2]} y2={LANES[li].y + 18} colour="#cbd5e1" />
        ))}
        {/* Lanes → BSCR */}
        {LANES.map((l, i) => (
          <Edge key={`lb-${i}`} x1={COL_X[2] + 168} y1={l.y + 18} x2={COL_X[3]} y2={H / 2 - 10} colour="#a78bfa" strokeWidth={1.6} />
        ))}
        {/* BSCR → gold */}
        {GOLD.map((g, i) => (
          <Edge key={`bg-${i}`} x1={COL_X[3] + 168} y1={H / 2 - 10} x2={COL_X[4]} y2={g.y + 12} colour="#fbbf24" strokeWidth={1.4} />
        ))}

        {/* Nodes */}
        {BRONZE.map((b) => <DataNode key={b.name} x={COL_X[0]} y={b.y} label={b.name} fill="#fff7ed" stroke="#fdba74" text="#9a3412" />)}
        {SILVER.map((s) => <DataNode key={s.name} x={COL_X[1]} y={s.y} label={s.name} fill="#f1f5f9" stroke="#94a3b8" text="#334155" />)}
        {LANES.map((l) => <LaneNode key={l.name} x={COL_X[2]} y={l.y} label={l.name} tag={l.tag} cls={l.cls} />)}

        {/* BSCR central node */}
        <g>
          <rect x={COL_X[3]} y={H / 2 - 30} width={168} height={40} rx={6} fill="#dbeafe" stroke="#1e40af" strokeWidth={1.5} />
          <text x={COL_X[3] + 84} y={H / 2 - 14} textAnchor="middle" fill="#1e40af" fontSize={11} fontWeight={700}>BSCR aggregation</text>
          <text x={COL_X[3] + 84} y={H / 2 + 0} textAnchor="middle" fill="#1e40af" fontSize={9}>EIOPA correlation matrix</text>
          <text x={COL_X[3] + 84} y={H / 2 + 27} textAnchor="middle" fill="#475569" fontSize={9} fontFamily="ui-monospace, monospace">+ Op risk · − LAC_DT</text>
        </g>

        {GOLD.map((g) => <DataNode key={g.name} x={COL_X[4]} y={g.y} label={g.name} fill="#fffbeb" stroke="#f59e0b" text="#92400e" />)}
      </svg>
      <p className="text-[11px] text-gray-500 mt-3 italic">
        Solid lines = data flow. Violet = compute-lane aggregation into BSCR. Amber = BSCR fan-out into the gold QRTs.
        Bronze and silver layers stay in Unity Catalog throughout. Igloo and Prophet run on their native engines; the exchange is a UC Volume.
      </p>
    </div>
  );
}

function ColumnHeader({ x, label, sub, colour }: { x: number; label: string; sub: string; colour: string }) {
  return (
    <g>
      <text x={x} y={14} fill={colour} fontSize={10} fontWeight={700} letterSpacing={1.5}>{label}</text>
      <text x={x} y={26} fill="#94a3b8" fontSize={9}>{sub}</text>
    </g>
  );
}

function DataNode({ x, y, label, fill, stroke, text }: { x: number; y: number; label: string; fill: string; stroke: string; text: string }) {
  return (
    <g>
      <rect x={x} y={y} width={168} height={24} rx={4} fill={fill} stroke={stroke} strokeWidth={1} />
      <text x={x + 8} y={y + 16} fontSize={10.5} fontFamily="ui-monospace, monospace" fill={text}>{label}</text>
    </g>
  );
}

function LaneNode({ x, y, label, tag, cls }: { x: number; y: number; label: string; tag: string; cls: string }) {
  const palette: Record<string, { bg: string; border: string; text: string }> = {
    violet: { bg: '#f5f3ff', border: '#7c3aed', text: '#5b21b6' },
    blue:   { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
    orange: { bg: '#fff7ed', border: '#ea580c', text: '#9a3412' },
    purple: { bg: '#fdf4ff', border: '#a855f7', text: '#6b21a8' },
  };
  const p = palette[cls] ?? palette.violet;
  return (
    <g>
      <rect x={x} y={y} width={168} height={42} rx={6} fill={p.bg} stroke={p.border} strokeWidth={1.5} />
      <text x={x + 10} y={y + 18} fontSize={12} fontWeight={700} fill={p.text}>{label}</text>
      <text x={x + 10} y={y + 33} fontSize={9} fill="#475569" fontFamily="ui-monospace, monospace">{tag}</text>
    </g>
  );
}

function Edge({ x1, y1, x2, y2, colour, strokeWidth = 1 }: { x1: number; y1: number; x2: number; y2: number; colour: string; strokeWidth?: number }) {
  const cx = (x1 + x2) / 2;
  return (
    <path d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
      stroke={colour} strokeWidth={strokeWidth} fill="none" />
  );
}

/* ═══════ Metrics grid ═══════ */

function MetricsGrid({ modelByName }: { models: LabModelRow[]; modelByName: (n: string) => LabModelRow | undefined }) {
  const tiles = [
    { label: 'Solvency Capital Requirement', value: 'EUR 556 M', sub: 'Standard Formula · production v1', to: '/report/s2501', icon: Shield, accent: 'blue' as const, model: modelByName('standard_formula') },
    { label: 'BSCR (pre op-risk + LAC_DT)', value: 'EUR 598 M', sub: 'EIOPA correlation across modules', to: '/report/s2501', icon: Gauge, accent: 'slate' as const },
    { label: 'Non-life UW SCR', value: 'EUR 385 M', sub: 'Sub-module input to BSCR · 61% cat-driven', to: '/report/s2606', icon: Flame, accent: 'orange' as const, model: modelByName('igloo_cat') },
    { label: 'Life best estimate', value: 'EUR 1.85 B', sub: 'Prophet 5K-scenario projection', to: '/reserving-life', icon: FlaskConical, accent: 'purple' as const, model: modelByName('prophet_life') },
    { label: 'Asset register total', value: 'EUR 6.4 B', sub: 'S.06.02 · CIC-classified · look-through', to: '/report/s0602', icon: Landmark, accent: 'amber' as const },
    { label: 'P&C reserves (best estimate)', value: 'see S.05.01', sub: 'reserving_pnc · chain ladder + BF', to: '/report/s0501', icon: BookOpen, accent: 'violet' as const, model: modelByName('reserving_pnc') },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {tiles.map((t) => <MetricTile key={t.label} {...t} />)}
    </div>
  );
}

function MetricTile({ label, value, sub, to, icon: Icon, accent, model }: {
  label: string; value: string; sub: string; to: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'blue' | 'slate' | 'orange' | 'purple' | 'amber' | 'violet';
  model?: LabModelRow;
}) {
  const cls = {
    blue:   { border: 'border-blue-200',   icon: 'text-blue-700',   bg: 'bg-blue-50' },
    slate:  { border: 'border-slate-200',  icon: 'text-slate-700',  bg: 'bg-slate-50' },
    orange: { border: 'border-orange-200', icon: 'text-orange-700', bg: 'bg-orange-50' },
    purple: { border: 'border-purple-200', icon: 'text-purple-700', bg: 'bg-purple-50' },
    amber:  { border: 'border-amber-200',  icon: 'text-amber-700',  bg: 'bg-amber-50' },
    violet: { border: 'border-violet-200', icon: 'text-violet-700', bg: 'bg-violet-50' },
  }[accent];

  return (
    <Link to={to} className={`block bg-white border-2 ${cls.border} rounded-lg p-3.5 hover:shadow-sm transition-shadow`}>
      <div className="flex items-start gap-2">
        <div className={`w-8 h-8 rounded ${cls.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${cls.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold leading-tight">{label}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
          <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">{sub}</div>
        </div>
      </div>
      {model && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-[10px] font-mono">
          <span className="text-gray-500">prod:</span>
          <span className="text-gray-800">{model.production_version || '—'}</span>
          {(model.pending_promotions ?? 0) > 0 && (
            <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] uppercase tracking-wide">
              {model.pending_promotions} pending
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

/* ═══════ Lane card ═══════ */

function LaneCard({
  kind, title, icon: Icon, what, inputs, outputs, engine, modelId, cadence, controls, modelRow,
}: {
  kind: 'native' | 'external';
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  what: string;
  inputs: string[];
  outputs: string[];
  engine: string;
  modelId: string;
  cadence: string;
  controls: string[];
  modelRow?: LabModelRow;
}) {
  const accentCls = kind === 'native'
    ? 'border-violet-200 bg-violet-50/40'
    : 'border-orange-200 bg-orange-50/40';
  const iconCls = kind === 'native' ? 'text-violet-700 bg-violet-100' : 'text-orange-700 bg-orange-100';

  return (
    <article className={`border-2 ${accentCls} rounded-xl p-4 space-y-3 bg-white`}>
      <header className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg ${iconCls} flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
            <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${
              kind === 'native' ? 'bg-violet-100 text-violet-800 border-violet-200' : 'bg-orange-100 text-orange-800 border-orange-200'
            }`}>
              {engine}
            </span>
          </div>
          <p className="text-sm text-gray-700 mt-1 leading-relaxed">{what}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Block label="Inputs">
          {inputs.map((i) => <code key={i} className="block bg-orange-50/60 text-orange-900 border border-orange-100 rounded px-1.5 py-0.5 font-mono text-[10.5px] mb-1">{i}</code>)}
        </Block>
        <Block label="Outputs">
          {outputs.map((o) => <code key={o} className="block bg-amber-50/60 text-amber-900 border border-amber-100 rounded px-1.5 py-0.5 font-mono text-[10.5px] mb-1">{o}</code>)}
        </Block>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Block label="Run cadence">{cadence}</Block>
        <Block label="Model version">
          {modelRow
            ? <div className="flex flex-wrap items-baseline gap-1.5 font-mono">
                <span className="text-gray-800">prod {modelRow.production_version || '—'}</span>
                {modelRow.candidate_version && <span className="text-gray-500">· cand {modelRow.candidate_version}</span>}
              </div>
            : <span className="text-gray-500 italic">—</span>}
        </Block>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">Controls running</div>
        <ul className="space-y-1">
          {controls.map((c) => (
            <li key={c} className="text-xs text-gray-700 flex items-start gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link to={`/lab/${modelId}`}
        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900">
        Open in Lab <ArrowRight className="w-3 h-3" />
      </Link>
    </article>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">{label}</div>
      <div className="text-xs text-gray-800 leading-relaxed">{children}</div>
    </div>
  );
}

/* ═══════ Speed narrative ═══════ */

function SpeedNarrative() {
  return (
    <div className="space-y-4">
      <SpeedComparison />
      <div className="bg-white border border-gray-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-600" /> What stays in Databricks
          </h4>
          <ul className="text-sm text-gray-700 space-y-1.5 leading-relaxed">
            <li>· <strong>Data prep + transformations</strong> — bronze → silver via DLT. Parallelised, incremental, auto-tuned.</li>
            <li>· <strong>Governance + audit</strong> — every artefact carries its lineage, model version, sign-off chain.</li>
            <li>· <strong>The aggregation steps</strong> — chain ladder, EIOPA correlation matrix aggregation, BSCR roll-up, op risk + LAC_DT adjustments.</li>
            <li>· <strong>Reasonableness checks + diagnostics</strong> — run on every model output before it propagates downstream.</li>
            <li>· <strong>The AI overlay</strong> — Senior Reserving Actuary, Cat Modelling Agent, Workbench Assistant — all read the same gold layer.</li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
            <Wind className="w-4 h-4 text-purple-700" /> What stays in the specialist engine
          </h4>
          <ul className="text-sm text-gray-700 space-y-1.5 leading-relaxed">
            <li>· <strong>Heavy stochastic compute</strong> — Igloo's event-set simulation; Prophet's per-policy projection.</li>
            <li>· <strong>Vendor IP</strong> — the actuarial science the customer or their consultancy has already validated.</li>
            <li>· <strong>Native runtimes</strong> — engines run on the infrastructure their vendors optimise for. No re-implementation.</li>
          </ul>
          <p className="text-xs text-gray-500 italic mt-3 leading-relaxed">
            The <span className="font-semibold text-gray-700">UC Volume exchange</span> is the integration surface — exposures + assumptions out, scenario output back. One Delta-tracked artefact in, one back. Same governance applies to both.
          </p>
        </div>
      </div>
    </div>
  );
}

function SpeedComparison() {
  const rows = [
    { stage: 'Exposure prep + LoB aggregation',  before: '6h batch ETL',        after: '4 min DLT',           delta: '~90× faster' },
    { stage: 'Cat engine (Igloo) run',             before: '~45 min native',       after: '~45 min native',      delta: 'unchanged · runs where it ran' },
    { stage: 'Result re-import + recon',          before: '90 min manual export', after: '30 sec Volume read',  delta: '~180× faster' },
    { stage: 'Reasonableness checks + sign-off',  before: '2 days email + xlsx',  after: 'live in Lab UI',      delta: 'compressed into the same cycle' },
    { stage: 'Lineage from claim to QRT cell',     before: 'reconstructed from logs', after: 'one click in Audit panel', delta: 'replaces the audit prep step' },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-600">
          <tr>
            <th className="text-left px-4 py-2.5">Stage</th>
            <th className="text-left px-4 py-2.5">Before</th>
            <th className="text-left px-4 py-2.5">With the workbench</th>
            <th className="text-left px-4 py-2.5">Impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stage} className="border-t border-gray-100">
              <td className="px-4 py-2.5 text-sm font-semibold text-gray-800">{r.stage}</td>
              <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{r.before}</td>
              <td className="px-4 py-2.5 text-xs text-blue-700 font-mono font-semibold">{r.after}</td>
              <td className="px-4 py-2.5 text-xs text-emerald-700 italic">{r.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 italic px-4 py-2.5 border-t border-gray-100">
        Timings are illustrative — actual numbers vary by firm size, portfolio complexity, cat-engine
        configuration and reinsurance treaty shape. Use these as orders of magnitude, not benchmarks.
      </p>
    </div>
  );
}

/* ═══════ Orchestration ═══════ */

function OrchestrationDiagram() {
  // Horizontal stages with named jobs.
  const stages = [
    { label: 'Bronze ingest',     trigger: 'Feeds arrive (SLA)',    icon: Database },
    { label: 'DLT — silver staging', trigger: 'Bronze ready',          icon: Workflow },
    { label: 'Reserving + SF run',  trigger: 'Silver complete',       icon: Beaker },
    { label: 'Igloo + Prophet',     trigger: 'Exposures + life book ready · Volume out → engine → Volume in', icon: Wind },
    { label: 'BSCR aggregation',    trigger: 'All sub-modules in',    icon: Gauge },
    { label: 'Gold QRT materialise', trigger: 'BSCR + lane outputs ready', icon: Sparkles },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {stages.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-1">
              <div className="border-2 border-blue-200 bg-blue-50/40 rounded-lg px-3 py-2.5 min-w-[170px]">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-blue-700" />
                  <span className="text-xs font-bold text-gray-900">{s.label}</span>
                </div>
                <div className="text-[10px] text-gray-600 mt-1 leading-snug">{s.trigger}</div>
              </div>
              {i < stages.length - 1 && (
                <svg width={22} height={20} viewBox="0 0 22 20" className="text-blue-400 shrink-0">
                  <path d="M 0 10 L 18 10 M 14 5 L 19 10 L 14 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500 mt-3 italic">
        Each stage is a real Databricks job (DLT pipeline or scheduled task), declared in <code className="bg-gray-100 px-1 rounded">resources/qrt_*.yml</code>.
        Stochastic engine handoffs (Igloo, Prophet) run in parallel with the native compute lanes — the BSCR aggregation waits on all four.
      </p>
    </div>
  );
}

/* ═══════ Controls ═══════ */

function ControlsList({ recon }: { recon: Row[] }) {
  const reconChecks = (recon ?? []).map((r) => ({
    name: r.check_name,
    description: r.check_description,
    source: `${r.source_qrt} ⇄ ${r.target_qrt}`,
    status: r.status,
  }));

  const modelControls = [
    { name: 'SF sub-module reconciliation',     description: 'Sum of sub-module charges ↔ BSCR ± rounding tolerance',         source: 'standard_formula',         status: 'MATCH' },
    { name: 'EIOPA correlation matrix hash',     description: 'Active matrix matches canonical EIOPA reference hash',          source: 'standard_formula',         status: 'MATCH' },
    { name: 'Op risk cap',                        description: 'Op risk capped at 30% of BSCR (Article 204 SF Delegated Regs)',  source: 'standard_formula',         status: 'MATCH' },
    { name: 'LAC_DT recoverability',              description: 'LAC_DT ≤ available DT recoverability (probability-weighted future profits)', source: 'standard_formula',         status: 'MATCH' },
    { name: 'Triangle consistency score',        description: 'Reserving model actual-vs-expected on Q-1 cohort ≥ 0.85',        source: 'reserving_pnc',            status: 'MATCH' },
    { name: 'Cat reasonableness vs AAL',         description: 'Igloo modelled cat charge within ±30% of long-run AAL',         source: 'igloo_cat',                status: 'MATCH' },
    { name: 'Prophet scenario convergence',      description: 'Convergence score across 5K scenarios ≥ 0.95',                   source: 'prophet_life',             status: 'MATCH' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ControlsTable title="Cross-QRT reconciliation" rows={reconChecks} />
      <ControlsTable title="Per-model diagnostics" rows={modelControls} />
    </div>
  );
}

function ControlsTable({ title, rows }: { title: string; rows: { name: string; description: string; source: string; status: string }[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
      <header className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-gray-700" />
          <h4 className="text-xs uppercase tracking-wider font-bold text-gray-800">{title}</h4>
          <span className="ml-auto text-[11px] text-gray-500 font-mono">{rows.length}</span>
        </div>
      </header>
      <ul className="divide-y divide-gray-100 flex-1">
        {rows.length === 0 && <li className="px-4 py-3 text-xs text-gray-500 italic">No controls reported.</li>}
        {rows.map((r) => {
          const ok = r.status === 'MATCH' || r.status === 'ok';
          return (
            <li key={r.name} className="px-4 py-2.5 flex items-start gap-2 text-xs">
              {ok
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-800">{r.name}</div>
                <div className="text-gray-600 mt-0.5 leading-snug">{r.description}</div>
                <div className="text-[10px] text-gray-400 font-mono mt-1">{r.source}</div>
              </div>
              <span className={`text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${
                ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>{r.status}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

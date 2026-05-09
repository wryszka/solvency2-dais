/**
 * Workbench Horizon — the closing visual.
 *
 * Workbench at centre, Solvency II highlighted as today's proof case, the
 * other actuarial workflows orbit outward. Used as the talk's final slide
 * and as a permanent in-app page for the conversation-opener.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface DomainNode {
  id: string;
  label: string;
  sublabel?: string;
  highlighted?: boolean;
  /** Angle in degrees clockwise from 12-o'clock. */
  angle: number;
}

const DOMAINS: DomainNode[] = [
  { id: 'sii',          label: 'Solvency II',                sublabel: 'today',     highlighted: true, angle:   0 },
  { id: 'pricing',      label: 'Pricing',                    sublabel: 'live',      highlighted: true, angle:  51 },
  { id: 'reinsurance',  label: 'Reinsurance optimisation',                                              angle: 103 },
  { id: 'capital',      label: 'Capital allocation',                                                    angle: 154 },
  { id: 'ifrs17',       label: 'IFRS 17',                                                                angle: 206 },
  { id: 'claims',       label: 'Claims analytics & fraud',                                               angle: 257 },
  { id: 'customer',     label: 'Customer & distribution',                                                angle: 309 },
];

const CX = 500;
const CY = 360;
const RADIUS = 280;

function pos(angle: number, r = RADIUS) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

export default function Horizon() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <Link to="/adjacencies" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Adjacencies
      </Link>

      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-8 text-center">
          <div className="text-[11px] uppercase tracking-widest text-violet-400 font-bold mb-2">
            Workbench Horizon
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">
            Solvency II is what we showed today.
          </h2>
          <p className="text-3xl font-bold text-violet-300 tracking-tight mt-1">
            The workbench is what runs the next decade.
          </p>
        </div>

        <svg viewBox="0 0 1000 720" className="w-full h-auto">
          <defs>
            <radialGradient id="centreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#7c3aed" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="centreFill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
            <radialGradient id="orbitGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="0.06" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Concentric soft rings */}
          {[120, 200, 280].map((r) => (
            <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="white" strokeWidth={0.5} strokeDasharray="3 6" opacity={0.18} />
          ))}

          {/* Centre glow */}
          <circle cx={CX} cy={CY} r={220} fill="url(#centreGlow)" />

          {/* Orbital rays (faint) connecting centre to each domain */}
          {DOMAINS.map((d) => {
            const p = pos(d.angle);
            return (
              <line key={`ray-${d.id}`} x1={CX} y1={CY} x2={p.x} y2={p.y}
                stroke={d.highlighted ? '#a78bfa' : 'white'}
                strokeWidth={d.highlighted ? 1.6 : 0.6}
                strokeOpacity={d.highlighted ? 0.6 : 0.18}
                strokeDasharray={d.highlighted ? '0' : '4 6'} />
            );
          })}

          {/* Centre — the workbench */}
          <g>
            <circle cx={CX} cy={CY} r={120} fill="url(#centreFill)" stroke="#c4b5fd" strokeWidth={2} />
            <text x={CX} y={CY - 18} textAnchor="middle" fill="white" fontSize={20} fontWeight={700}
              fontFamily="ui-sans-serif, system-ui">The Actuarial</text>
            <text x={CX} y={CY + 8} textAnchor="middle" fill="white" fontSize={28} fontWeight={800} letterSpacing={1}
              fontFamily="ui-sans-serif, system-ui">WORKBENCH</text>
            <text x={CX} y={CY + 38} textAnchor="middle" fill="#ddd6fe" fontSize={11} fontWeight={500} letterSpacing={2}
              fontFamily="ui-monospace, monospace" textRendering="optimizeLegibility">UC · MLFLOW · MOSAIC AI · DELTA</text>
          </g>

          {/* Domain nodes */}
          {DOMAINS.map((d) => <DomainBubble key={d.id} d={d} />)}
        </svg>

        <div className="px-8 pb-8 grid grid-cols-3 gap-4 text-center">
          <Tag label="Same data" sub="Unity Catalog" />
          <Tag label="Same governance" sub="MLflow + audit" />
          <Tag label="Same AI" sub="Mosaic + agents" />
        </div>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-700 leading-relaxed">
        <p>
          <strong>The conversation we want to have next:</strong> not "do you want a better Solvency II
          tool". Of course you do. The interesting question is — given that you'll have the workbench
          for Solvency II by Q-end anyway, which adjacent workflow is the next pressure point on your
          list. Pricing. IFRS 17. Reinsurance optimisation. Customer analytics. Capital steering.
          One of them is keeping someone on your team up at night right now. That's where this
          conversation continues.
        </p>
      </section>
    </div>
  );
}

function DomainBubble({ d }: { d: DomainNode }) {
  const p = pos(d.angle);
  const r = d.highlighted ? 64 : 50;
  const fill = d.highlighted ? '#7c3aed' : '#1e293b';
  const stroke = d.highlighted ? '#c4b5fd' : '#475569';
  const fontSize = d.highlighted ? 14 : 12;
  const labelLines = splitLabelToLines(d.label);
  const startY = p.y - ((labelLines.length - 1) * (fontSize + 2)) / 2 - (d.sublabel ? 6 : 0);
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={r + 4} fill="url(#orbitGlow)" />
      <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={stroke} strokeWidth={d.highlighted ? 2 : 1.25} />
      <text textAnchor="middle" fill={d.highlighted ? 'white' : '#e2e8f0'}
        fontSize={fontSize} fontWeight={d.highlighted ? 700 : 600}
        fontFamily="ui-sans-serif, system-ui">
        {labelLines.map((line, i) => (
          <tspan key={i} x={p.x} y={startY + i * (fontSize + 2)}>{line}</tspan>
        ))}
      </text>
      {d.sublabel && (
        <text x={p.x} y={p.y + 18} textAnchor="middle" fill={d.highlighted ? '#ddd6fe' : '#94a3b8'}
          fontSize={10} fontFamily="ui-monospace, monospace" letterSpacing={1.5} fontWeight={600}>
          {d.sublabel.toUpperCase()}
        </text>
      )}
    </g>
  );
}

function splitLabelToLines(label: string, maxLineLen = 16): string[] {
  if (label.length <= maxLineLen) return [label];
  const words = label.split(' ');
  // Greedy line wrap
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= maxLineLen) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function Tag({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="border border-white/10 rounded-lg py-2.5 px-3 bg-white/5">
      <div className="text-base font-bold text-white">{label}</div>
      <div className="text-[11px] text-violet-300 font-mono uppercase tracking-wider">{sub}</div>
    </div>
  );
}

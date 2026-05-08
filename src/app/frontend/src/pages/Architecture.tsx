/**
 * /architecture — single-asset page used both in-app and as a forum slide.
 *
 * Tangled stack (left) → Lakehouse (centre) → pillar-coloured outputs (right).
 * Designed to be screenshotted from a 1920×1080 browser for slide use.
 */
import PillarChip from '../components/PillarChip';

const ENGINES = [
  'Prophet', 'Igloo', 'ResQ', 'Radar', 'Tagetik', 'Excel', 'SharePoint', 'FTP', 'Email',
];

export default function Architecture() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1500px] mx-auto px-8 pt-8 pb-12">
        <header className="text-center mb-6">
          <div className="text-xs uppercase tracking-[0.4em] text-slate-500">Architecture</div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mt-2">
            Solvency II at the Speed of Lakehouse
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Same engines. One layer. Pillar-coloured outputs you can hand to a regulator.
          </p>
        </header>

        <svg viewBox="0 0 1500 760" className="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/* Pillar gradients */}
            <linearGradient id="grad-p1" x1="0" x2="1">
              <stop offset="0%" stopColor="#dbeafe" />
              <stop offset="100%" stopColor="#1e40af" />
            </linearGradient>
            <linearGradient id="grad-p2" x1="0" x2="1">
              <stop offset="0%" stopColor="#dcfce7" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
            <linearGradient id="grad-p3" x1="0" x2="1">
              <stop offset="0%" stopColor="#fef3c7" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
            </marker>
          </defs>

          {/* ── Section labels ─────────────────────────────────────── */}
          <text x="170" y="40" className="font-semibold" fontSize="16" fill="#475569">
            BEFORE — fragmented stack
          </text>
          <text x="700" y="40" className="font-semibold" fontSize="16" fill="#475569" textAnchor="middle">
            LAKEHOUSE
          </text>
          <text x="1330" y="40" className="font-semibold" fontSize="16" fill="#475569" textAnchor="end">
            AFTER — pillar-coloured outputs
          </text>

          {/* ── LEFT: tangled stack ─────────────────────────────────── */}
          {ENGINES.map((name, i) => {
            const cx = 60 + (i % 3) * 110;
            const cy = 90 + Math.floor(i / 3) * 90;
            return (
              <g key={`L-${name}`}>
                <rect x={cx} y={cy} width="100" height="38" rx="6"
                      fill="white" stroke="#94a3b8" strokeWidth="1.5" />
                <text x={cx + 50} y={cy + 23} fontSize="12" textAnchor="middle"
                      fill="#1f2937" fontWeight="500">{name}</text>
              </g>
            );
          })}
          {/* Tangled spaghetti connections — each engine to several others */}
          {(() => {
            const lines: Array<[number, number, number, number]> = [];
            const xy = (i: number) => ({
              x: 60 + (i % 3) * 110 + 50,
              y: 90 + Math.floor(i / 3) * 90 + 19,
            });
            const wire = [
              [0, 4], [0, 8], [1, 5], [1, 7], [2, 3], [2, 6],
              [3, 7], [4, 8], [5, 6], [0, 6], [3, 8], [1, 4],
              [4, 7], [2, 5],
            ];
            for (const [a, b] of wire) {
              const A = xy(a); const B = xy(b);
              lines.push([A.x, A.y, B.x, B.y]);
            }
            return lines.map(([x1, y1, x2, y2], i) => (
              <path key={i}
                    d={`M ${x1} ${y1} Q ${(x1 + x2) / 2 + (i % 5 - 2) * 30} ${(y1 + y2) / 2 + (i % 3 - 1) * 30}, ${x2} ${y2}`}
                    fill="none" stroke="#cbd5e1" strokeWidth="1.5" opacity="0.7" />
            ));
          })()}
          {/* "Integration tax" label hanging off the tangle */}
          <text x="200" y="455" fontSize="13" fill="#dc2626" fontStyle="italic" textAnchor="middle">
            ⌁ integration tax
          </text>
          <text x="200" y="475" fontSize="11" fill="#9ca3af" textAnchor="middle">
            CSVs · email · spreadsheets · reconciliations
          </text>

          {/* Big arrow → Lakehouse */}
          <line x1="380" y1="240" x2="490" y2="240" stroke="#475569" strokeWidth="2.5"
                markerEnd="url(#arrow)" />
          <text x="435" y="225" fontSize="11" fill="#64748b" textAnchor="middle">
            on Databricks
          </text>

          {/* ── CENTRE: the Lakehouse layer ────────────────────────── */}
          <rect x="510" y="160" width="380" height="200" rx="14"
                fill="#f8fafc" stroke="#475569" strokeWidth="2" />
          <text x="700" y="190" fontSize="16" fontWeight="bold" fill="#1f2937" textAnchor="middle">
            Lakehouse
          </text>
          {/* Layered rectangles inside */}
          {[
            { y: 205, label: 'Bronze (raw)',         color: '#e2e8f0' },
            { y: 240, label: 'Silver (cleansed)',    color: '#cbd5e1' },
            { y: 275, label: 'Gold (QRTs + life)',   color: '#94a3b8' },
            { y: 310, label: 'AI agents + governance', color: '#64748b' },
          ].map((row) => (
            <g key={row.label}>
              <rect x="525" y={row.y} width="350" height="28" rx="4" fill={row.color} />
              <text x="540" y={row.y + 18} fontSize="12" fill="white" fontWeight="500">
                {row.label}
              </text>
            </g>
          ))}

          {/* Output arrow centre → right */}
          <line x1="900" y1="240" x2="980" y2="240" stroke="#475569" strokeWidth="2.5"
                markerEnd="url(#arrow)" />

          {/* ── RIGHT: pillar-coloured outputs ────────────────────── */}
          {[
            { y: 90,  pillar: 1, label: 'Pillar 1 — Capital',
              detail: 'S.06.02 · S.05.01 · S.12.01 · S.25.01 · S.26.06 + Life UW',
              grad: 'grad-p1' },
            { y: 230, pillar: 2, label: 'Pillar 2 — Governance',
              detail: 'ORSA · Actuarial Function · Model Governance · Internal Controls',
              grad: 'grad-p2' },
            { y: 370, pillar: 3, label: 'Pillar 3 — Disclosure',
              detail: 'QRT pack · SFCR · RSR · Regulator Q&A',
              grad: 'grad-p3' },
          ].map((p) => (
            <g key={p.pillar}>
              <rect x="1000" y={p.y} width="450" height="100" rx="12"
                    fill={`url(#${p.grad})`} opacity="0.85" />
              <rect x="1000" y={p.y} width="450" height="100" rx="12"
                    fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
              <text x="1020" y={p.y + 36} fontSize="18" fontWeight="bold" fill="white">
                {p.label}
              </text>
              <text x="1020" y={p.y + 65} fontSize="13" fill="white" opacity="0.95">
                {p.detail}
              </text>
              <text x="1020" y={p.y + 86} fontSize="10" fill="white" opacity="0.85" fontStyle="italic">
                Auditable · cell-level citations · hash-stamped
              </text>
            </g>
          ))}

          {/* Tagline along the bottom */}
          <text x="750" y="710" fontSize="14" fill="#475569" textAnchor="middle">
            Same Prophet. Same Igloo. New surface area.
          </text>
          <text x="750" y="732" fontSize="12" fill="#94a3b8" textAnchor="middle">
            Pipelines, AI agents, model governance and approval workflows running on
            Declarative Pipelines, Unity Catalog, Foundation Model API, and Databricks Apps.
          </text>
        </svg>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-500">
          <span>Pillar legend:</span>
          <PillarChip pillar={1} size="sm" />
          <PillarChip pillar={2} size="sm" />
          <PillarChip pillar={3} size="sm" />
          <PillarChip pillar="cross" size="sm" />
          <span className="ml-4 text-gray-400">
            Use <kbd className="px-1.5 py-0.5 border border-gray-300 rounded text-[10px]">⌘ Shift 4</kbd> on macOS
            (or browser print → save as PDF) to capture this page as a slide.
          </span>
        </div>
      </div>
    </div>
  );
}

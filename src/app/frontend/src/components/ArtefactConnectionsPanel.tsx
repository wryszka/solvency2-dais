/**
 * ArtefactConnectionsPanel — the "where does this come from / where does it
 * flow" panel shown at the top of every Pillar 1 artefact page.
 *
 * Single source of truth lives in lib/artefact-connections.ts. This component
 * is purely a renderer — looks up the config by qrtId and lays out the
 * sections. Renders nothing if no config is registered for the id.
 *
 * Sections (top-to-bottom):
 *  - Methodology — 2-4 sentences in plain prose
 *  - Models — clickable chips into the Lab with live alias versions
 *  - Specialist engines — Igloo / Prophet cards (when applicable)
 *  - Inputs — bronze + silver table lists
 *  - Approved overlays — live count + magnitude, filtered by overlay_cell_prefix
 *  - Downstream — where the numbers flow (links)
 *  - Examples + Adjacent — links into Lab worked examples and roadmap tiles
 */
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  BookOpenText, Boxes, Cpu, Database, GitBranch, ExternalLink,
  FlaskConical, ChevronRight, Layers, Compass,
} from 'lucide-react';
import { getArtefactConfig } from '../lib/artefact-connections';
import { fetchLabModels, fetchOverlays, asArray, type LabModelRow, type Overlay } from '../lib/api';

interface Props {
  qrtId: string;
}

export default function ArtefactConnectionsPanel({ qrtId }: Props) {
  const cfg = getArtefactConfig(qrtId);
  const [labModels, setLabModels] = useState<LabModelRow[] | null>(null);
  const [overlays, setOverlays] = useState<Overlay[] | null>(null);

  useEffect(() => {
    if (!cfg) return;
    fetchLabModels().then((r) => setLabModels(r.models)).catch(() => setLabModels([]));
    if (cfg.overlay_cell_prefix) {
      fetchOverlays({ status: 'approved' })
        .then((r) => setOverlays(r.overlays))
        .catch(() => setOverlays([]));
    }
  }, [qrtId]);

  if (!cfg) return null;
  // Roadmap tiles moved to the separate Actuarial Workbench app — drop any
  // /roadmap/* adjacency links so they don't dead-end here.
  const adjacent = cfg.adjacent.filter((x) => !x.to.startsWith('/roadmap'));

  const modelById = new Map((labModels ?? []).map((m) => [m.model_id, m]));

  const approvedOverlays = (overlays ?? []).filter((o) => {
    if (!cfg.overlay_cell_prefix) return false;
    const cells = asArray<string>(o.linked_qrt_cells as unknown);
    return cells.some((c) => typeof c === 'string' && c.startsWith(cfg.overlay_cell_prefix!));
  });
  const overlayTotal = approvedOverlays.reduce((acc, o) => {
    const m = Number(o.magnitude_eur ?? 0);
    return acc + (o.direction === 'decrease' ? -m : m);
  }, 0);

  return (
    <section className="bg-gradient-to-br from-blue-50/70 via-white to-white border-2 border-blue-200 rounded-xl overflow-hidden">
      <header className="px-5 py-3 border-b border-blue-200 bg-blue-50/80">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-blue-700" />
          <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide">Methodology &amp; connections</h3>
        </div>
        <p className="text-[11px] text-blue-700/80 mt-0.5">Where this artefact comes from, what feeds it, where it flows.</p>
      </header>

      <div className="p-5 space-y-5">
        {/* Methodology */}
        <div>
          <SectionLabel icon={BookOpenText}>Methodology</SectionLabel>
          <p className="text-sm text-gray-700 leading-relaxed mt-1.5">{cfg.methodology}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Models */}
          {cfg.models.length > 0 && (
            <div>
              <SectionLabel icon={Boxes}>Models in this calculation</SectionLabel>
              <ul className="mt-1.5 space-y-1.5">
                {cfg.models.map((m) => {
                  const live = modelById.get(m.model_id);
                  return (
                    <li key={m.model_id}>
                      <Link
                        to={`/lab/${m.model_id}`}
                        className="group flex items-start gap-2 px-3 py-2 rounded-md bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                      >
                        <FlaskConical className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900">{live?.label ?? m.model_id}</span>
                            {live && (
                              <span className="text-[10px] font-mono text-gray-500">
                                prod {live.production_version ?? '—'}
                                {live.candidate_version ? ` · cand ${live.candidate_version}` : ''}
                              </span>
                            )}
                            {live?.engine_tag === 'external' && (
                              <span className="text-[9px] uppercase tracking-wide font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800">external</span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">{m.role}</div>
                          {m.note && <div className="text-[10px] text-gray-500 mt-0.5 italic">{m.note}</div>}
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-500 shrink-0 mt-1" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {cfg.primary_lab_link && (
                <Link to={`/lab/${cfg.primary_lab_link.model_id}`}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
                  Open {cfg.primary_lab_link.label}
                  <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          )}

          {/* Specialist engines */}
          {cfg.engines && cfg.engines.length > 0 && (
            <div>
              <SectionLabel icon={Cpu}>Specialist engines</SectionLabel>
              <ul className="mt-1.5 space-y-1.5">
                {cfg.engines.map((e) => (
                  <li key={e.vendor + e.kind} className="px-3 py-2 rounded-md bg-white border border-gray-200">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{e.vendor}</span>
                      <span className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{e.kind}</span>
                    </div>
                    <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">{e.role}</div>
                    <div className="text-[10px] text-gray-500 mt-1 font-mono">{e.exchange}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InputColumn label="Bronze inputs"  layer="bronze" tables={cfg.inputs_bronze} />
          <InputColumn label="Silver staging" layer="silver" tables={cfg.inputs_silver} />
        </div>

        {/* Overlays + Downstream side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {cfg.overlay_cell_prefix && (
            <div>
              <SectionLabel icon={Layers}>Approved overlays applied</SectionLabel>
              <div className="mt-1.5 px-3 py-2 rounded-md bg-white border border-gray-200 text-sm">
                {overlays === null ? (
                  <span className="text-gray-400">Loading…</span>
                ) : approvedOverlays.length === 0 ? (
                  <span className="text-gray-500">No approved overlays touch this artefact.</span>
                ) : (
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-gray-900">{approvedOverlays.length}</span>
                    <span className="text-gray-600">{approvedOverlays.length === 1 ? 'overlay' : 'overlays'} · net</span>
                    <span className={`font-mono font-bold ${overlayTotal >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {fmtSignedEur(overlayTotal)}
                    </span>
                    <Link to={`/overlays?cell=${encodeURIComponent(cfg.overlay_cell_prefix)}`}
                      className="ml-auto text-[11px] font-bold text-blue-700 hover:underline inline-flex items-center gap-1">
                      Open register <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Downstream */}
          {cfg.downstream.length > 0 && (
            <div>
              <SectionLabel icon={GitBranch}>Where these numbers flow</SectionLabel>
              <ul className="mt-1.5 space-y-1">
                {cfg.downstream.map((d) => (
                  <li key={d.to}>
                    <Link to={d.to} className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline">
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                      {d.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Examples + Adjacent */}
        {(cfg.examples.length > 0 || adjacent.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-1 border-t border-gray-100">
            {cfg.examples.length > 0 && (
              <div>
                <SectionLabel icon={FlaskConical}>Worked examples</SectionLabel>
                <ul className="mt-1.5 space-y-1">
                  {cfg.examples.map((x) => (
                    <li key={x.label + x.to}>
                      <Link to={x.to} className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline">
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />{x.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {adjacent.length > 0 && (
              <div>
                <SectionLabel icon={ExternalLink}>Adjacent capabilities</SectionLabel>
                <ul className="mt-1.5 space-y-1">
                  {adjacent.map((x) => (
                    <li key={x.label + x.to}>
                      <Link to={x.to} className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline">
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />{x.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-gray-600">
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      {children}
    </div>
  );
}

function InputColumn({ label, layer, tables }: { label: string; layer: 'bronze' | 'silver'; tables: string[] }) {
  if (!tables.length) return null;
  const chipCls = layer === 'bronze'
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-emerald-50 border-emerald-200 text-emerald-900';
  return (
    <div>
      <SectionLabel icon={Database}>{label}</SectionLabel>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tables.map((t) => (
          <span key={t} className={`text-[10px] font-mono px-2 py-0.5 rounded border ${chipCls}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function fmtSignedEur(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}EUR ${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}EUR ${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}EUR ${(a / 1e3).toFixed(0)}K`;
  return `${sign}EUR ${a.toFixed(0)}`;
}

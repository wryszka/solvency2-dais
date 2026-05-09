/**
 * OrsaDraft — continuous ORSA document view.
 *
 * Backed by gold_orsa_draft. Eight sections rendered as a single scrolling
 * document with sticky TOC. Each section header carries its own
 * last_quantitative_refresh + last_narrative_review timestamps and a status
 * chip (live / stable / annual review).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Workflow, Loader2, AlertTriangle, ArrowLeft, Zap, Anchor, Calendar } from 'lucide-react';
import { renderMarkdownSafe } from '../lib/markdown';
import { fetchOrsaDraft, type OrsaDraftSection } from '../lib/api';

const STATUS_VARIANT = {
  live:           { Icon: Zap,      cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: 'live' },
  stable:         { Icon: Anchor,   cls: 'bg-blue-100 text-blue-800 border-blue-200',           label: 'stable' },
  annual_review:  { Icon: Calendar, cls: 'bg-amber-100 text-amber-800 border-amber-200',        label: 'annual review' },
} as const;

export default function OrsaDraft() {
  const [sections, setSections] = useState<OrsaDraftSection[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string>('');
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    fetchOrsaDraft()
      .then((r) => { setSections(r.sections); setVersion(r.version); if (r.sections.length > 0) setActive(r.sections[0].section_id); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (sections.length === 0) return;
    const handler = () => {
      let current = sections[0].section_id;
      for (const s of sections) {
        const el = refs.current[s.section_id];
        if (!el) continue;
        if (el.getBoundingClientRect().top < 220) current = s.section_id;
      }
      setActive(current);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [sections]);

  if (loading) return <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading ORSA draft…</div>;
  if (error)   return <div className="p-6 text-sm text-red-700 flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" /> {error}</div>;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link to="/today" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Today
      </Link>

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 lg:col-span-3 lg:sticky lg:top-4 lg:self-start">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Workflow className="w-4 h-4 text-emerald-700" />
              <h3 className="text-[11px] uppercase tracking-widest text-emerald-700 font-bold">ORSA</h3>
            </div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">Continuous draft</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {version != null ? `version ${version} · ` : ''}backed by <code className="bg-gray-100 px-1 rounded">gold_orsa_draft</code>
            </p>
            <ol className="mt-3 space-y-1 text-sm">
              {sections.map((s) => {
                const isActive = active === s.section_id;
                const v = STATUS_VARIANT[s.status as keyof typeof STATUS_VARIANT] ?? STATUS_VARIANT.stable;
                const StatusIcon = v.Icon;
                return (
                  <li key={s.section_id}>
                    <a href={`#${s.section_id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        refs.current[s.section_id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-[13px] leading-tight ${
                        isActive ? 'bg-emerald-50 text-emerald-900 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                      }`}>
                      <span className="text-gray-400 font-mono w-4 shrink-0">{s.order_index}.</span>
                      <span className="flex-1">{s.section_title}</span>
                      <StatusIcon className={`w-3 h-3 mt-0.5 shrink-0 ${isActive ? 'text-emerald-700' : 'text-gray-400'}`} />
                    </a>
                  </li>
                );
              })}
            </ol>
            <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
              Live sections regenerate nightly. Human-authored sections (conclusions, board statement)
              are preserved verbatim until manually updated.
            </p>
          </div>
        </aside>

        <main className="col-span-12 lg:col-span-9 space-y-6">
          <header>
            <div className="text-[11px] uppercase tracking-widest text-emerald-700 font-bold">ORSA · continuous</div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">Own Risk and Solvency Assessment</h1>
            <p className="text-sm text-gray-600 mt-2 max-w-3xl leading-relaxed">
              The Group's standing ORSA document. Quantitative sections refresh nightly against the
              latest standing-stress projections; narrative sections preserve their human-written
              content until manually updated. Each section carries its own freshness timestamps.
            </p>
          </header>

          {sections.map((s) => <Section key={s.section_id} s={s} pref={(el) => { refs.current[s.section_id] = el; }} />)}
        </main>
      </div>
    </div>
  );
}

function Section({ s, pref }: { s: OrsaDraftSection; pref: (el: HTMLElement | null) => void }) {
  const v = STATUS_VARIANT[s.status as keyof typeof STATUS_VARIANT] ?? STATUS_VARIANT.stable;
  const StatusIcon = v.Icon;
  return (
    <section id={s.section_id} ref={pref} className="scroll-mt-4">
      <header className="border-b border-gray-200 pb-2 mb-3 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">Section {s.order_index}</div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">{s.section_title}</h2>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded border ${v.cls}`}>
          <StatusIcon className="w-3 h-3" /> {v.label}
        </span>
      </header>
      <div className="text-[11px] text-gray-500 font-mono mb-3 flex flex-wrap gap-x-4 gap-y-1">
        <span>quant refresh · {niceTime(s.last_quantitative_refresh)}</span>
        <span>narrative review · {niceTime(s.last_narrative_review)}</span>
      </div>
      <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(s.body_markdown) }} />
    </section>
  );
}

function niceTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

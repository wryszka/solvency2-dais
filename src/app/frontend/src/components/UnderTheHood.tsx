/**
 * UnderTheHood — collapsible "what's this built on?" disclosure.
 *
 * Sits on action-heavy pages so the data-side audience can see the platform
 * components driving the workflow without cluttering the user-facing UI.
 * Default collapsed; the presenter opens it on stage if they want to spend
 * 10 seconds on the platform story.
 */
import { useState } from 'react';
import { ChevronRight, Cpu } from 'lucide-react';

interface Line {
  component: string;
  detail: string;
}

export default function UnderTheHood({ title, lines }: { title?: string; lines: Line[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border border-slate-200 bg-slate-50/70 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100/80 transition-colors"
      >
        <Cpu className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="text-[11px] uppercase tracking-widest font-bold text-slate-600">
          Under the hood
        </span>
        {title && (
          <span className="text-[11px] text-slate-500 truncate">· {title}</span>
        )}
        <ChevronRight
          className={`w-3.5 h-3.5 ml-auto text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <ul className="border-t border-slate-200 divide-y divide-slate-100">
          {lines.map((l, i) => (
            <li key={i} className="px-3 py-2 flex items-start gap-3 text-sm">
              <code className="font-mono text-[11px] bg-white border border-slate-200 text-slate-800 px-1.5 py-0.5 rounded shrink-0">
                {l.component}
              </code>
              <span className="text-slate-700 leading-relaxed">{l.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

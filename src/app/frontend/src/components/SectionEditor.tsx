/**
 * SectionEditor — section-by-section drafting + edit UI.
 *
 * Used by AFR, SFCR, and RSR. Currently a styled <textarea> with a
 * citation-aware preview pane. Designed to be swapped for TipTap
 * (planned upgrade) without changing the page-level callers — the
 * component contract is: receive the current text + citations, emit
 * onChange with new text.
 */
import { useState } from 'react';
import { Loader2, Sparkles, Save, CheckCircle2, FileDown } from 'lucide-react';
import type { Citation } from '../lib/api';

export interface SectionEditorProps {
  sectionTitle: string;
  /** Short prose telling the reader what this section is meant to contain. */
  sectionSummary?: string;
  status?: string;
  version?: number;
  /** When true, the editor is read-only (e.g. approved drafts). */
  readOnly?: boolean;
  /** Plain-text content (markdown-ish). For SFCR/RSR this includes [table cell] tokens. */
  text: string;
  /** Per-paragraph citations (only relevant for SFCR/RSR). */
  citations?: { paragraphIndex: number; cites: Citation[] }[];
  onChange: (text: string) => void;
  onGenerate?: () => Promise<void>;
  onSave?: () => Promise<void>;
  onApprove?: () => Promise<void>;
  onExport?: () => void;
  generating?: boolean;
  saving?: boolean;
  approving?: boolean;
}

export default function SectionEditor(props: SectionEditorProps) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
        <h4 className="text-sm font-bold text-gray-900 flex-1 truncate">{props.sectionTitle}</h4>
        {props.version !== undefined && (
          <span className="text-[10px] font-mono text-gray-500">v{props.version}</span>
        )}
        {props.status && (
          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-semibold ${
            props.status === 'approved' ? 'bg-green-100 text-green-700' :
            props.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
          }`}>{props.status}</span>
        )}
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          {showPreview ? 'Edit' : 'Preview'}
        </button>
      </header>

      <div className="p-4 space-y-3">
        {props.sectionSummary && (
          <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
            <span className="font-semibold text-gray-800">What this section covers — </span>
            {props.sectionSummary}
          </p>
        )}

        {showPreview ? (
          <ContentPreview text={props.text} citations={props.citations} />
        ) : props.text ? (
          <textarea
            value={props.text}
            onChange={(e) => props.onChange(e.target.value)}
            readOnly={props.readOnly}
            placeholder="Generate or paste section content here."
            className="w-full min-h-[280px] text-sm font-mono leading-relaxed border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-y"
          />
        ) : (
          <div className="border-2 border-dashed border-gray-200 rounded-md px-4 py-10 text-center">
            <Sparkles className="w-5 h-5 text-violet-500 mx-auto mb-2" />
            <p className="text-sm text-gray-700">No draft yet for this section.</p>
            <p className="text-xs text-gray-500 mt-1">
              Click <span className="font-semibold text-violet-700">Generate draft</span> below to ask
              the AI to draft this section, grounded in the latest gold-table data.
              {props.citations !== undefined && ' Inline citation chips will anchor every quantitative claim to its source.'}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {props.onGenerate && (
            <button
              onClick={props.onGenerate}
              disabled={props.generating || props.readOnly}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-violet-700 text-violet-800 rounded-md hover:bg-violet-50 disabled:opacity-50 text-xs font-medium"
            >
              {props.generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {props.text ? 'Re-generate' : 'Generate draft'}
            </button>
          )}
          {props.onSave && !props.readOnly && (
            <button
              onClick={props.onSave}
              disabled={props.saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-800 rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs font-medium"
            >
              {props.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          )}
          {props.onApprove && props.status !== 'approved' && (
            <button
              onClick={props.onApprove}
              disabled={props.approving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-green-700 text-green-800 rounded-md hover:bg-green-50 disabled:opacity-50 text-xs font-medium"
            >
              {props.approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Approve
            </button>
          )}
          {props.onExport && (
            <button
              onClick={props.onExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-xs font-medium ml-auto"
            >
              <FileDown className="w-3.5 h-3.5" />
              Export PDF
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContentPreview({ text, citations }: { text: string; citations?: SectionEditorProps['citations'] }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="prose prose-sm max-w-none text-gray-800">
      {paragraphs.map((p, idx) => {
        const cites = citations?.find((c) => c.paragraphIndex === idx)?.cites ?? [];
        // Render inline [table cell] tokens as chips
        const parts = p.split(/(\[[A-Za-z0-9_]+ [A-Za-z0-9._-]+\])/g);
        return (
          <div key={idx} className="mb-3">
            <p className="leading-relaxed">
              {parts.map((part, i) => {
                const m = part.match(/^\[([A-Za-z0-9_]+) ([A-Za-z0-9._-]+)\]$/);
                if (m) {
                  return (
                    <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded text-[11px] font-mono"
                          title={`Source: ${m[1]} · cell ${m[2]}`}>
                      {m[1]} · {m[2]}
                    </span>
                  );
                }
                return <span key={i}>{part}</span>;
              })}
            </p>
            {cites.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {cites.map((c, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[10px] font-mono">
                    {c.table} · {c.cell}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

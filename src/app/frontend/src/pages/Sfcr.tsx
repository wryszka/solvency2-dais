/**
 * SFCR — Solvency and Financial Condition Report. Pillar 3.
 *
 * Each paragraph is auditable: inline [TABLE CELL] tokens render as
 * citation chips when previewed. The same component (with different
 * endpoints) backs the RSR page.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import PillarChip from '../components/PillarChip';
import SectionEditor from '../components/SectionEditor';
import {
  fetchSfcrSections, fetchSfcrDrafts, fetchSfcrDraft, createSfcrDraft, saveSfcrDraft, approveSfcrDraft,
  type DocSection, type DraftListRow, type Paragraph, type Citation,
} from '../lib/api';

interface SectionState {
  draft_id?: string;
  version?: number;
  status?: string;
  text: string;
  paragraphs?: Paragraph[];
  reporting_period?: string;
  generating?: boolean;
  saving?: boolean;
  approving?: boolean;
  error?: string;
}

const CITE_TOKEN_RE = /\[([A-Za-z0-9_]+) ([A-Za-z0-9._-]+)\]/g;

function paragraphsToText(paras: Paragraph[]): string {
  return paras.map((p) => p.text).join('\n\n');
}
function textToParagraphs(text: string): Paragraph[] {
  return text.split(/\n\n+/).map((block) => {
    const cites: Citation[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(CITE_TOKEN_RE);
    while ((m = re.exec(block)) !== null) cites.push({ table: m[1], cell: m[2] });
    return { text: block, citations: cites };
  }).filter((p) => p.text.trim().length > 0);
}

export default function Sfcr() {
  return (
    <SfcrLikePage
      docName="SFCR"
      docTitle="Solvency and Financial Condition Report"
      docSubtitle="Article 51 — public disclosure. Each paragraph cites the underlying gold table and cell so an auditor can trace it."
      icon={Newspaper}
      pillar={3}
      fetchSections={fetchSfcrSections}
      fetchDrafts={fetchSfcrDrafts}
      fetchDraft={fetchSfcrDraft}
      createDraft={createSfcrDraft}
      saveDraft={saveSfcrDraft}
      approveDraft={approveSfcrDraft}
      pdfBase="/api/sfcr/pdf"
    />
  );
}

interface SfcrLikePageProps {
  docName: string;
  docTitle: string;
  docSubtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  pillar: 1 | 2 | 3;
  fetchSections: () => Promise<{ sections: DocSection[] }>;
  fetchDrafts: (period?: string) => Promise<{ drafts: DraftListRow[] }>;
  fetchDraft: (draft_id: string) => Promise<{ draft: any }>;  // eslint-disable-line @typescript-eslint/no-explicit-any
  createDraft: (section_id: string, reporting_period?: string) => Promise<any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
  saveDraft: (draft_id: string, paragraphs: Paragraph[]) => Promise<any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
  approveDraft: (draft_id: string) => Promise<any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
  pdfBase: string;
}

export function SfcrLikePage(props: SfcrLikePageProps) {
  const Icon = props.icon;
  const [sections, setSections] = useState<DocSection[]>([]);
  const [period, setPeriod] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, SectionState>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([props.fetchSections(), props.fetchDrafts()])
      .then(([s, d]) => {
        setSections(s.sections);
        const latest: Record<string, DraftListRow> = {};
        for (const row of d.drafts) {
          if (!latest[row.section_id] || row.version > latest[row.section_id].version) latest[row.section_id] = row;
        }
        const init: Record<string, SectionState> = {};
        s.sections.forEach((sec) => {
          const r = latest[sec.id];
          if (r) {
            init[sec.id] = {
              draft_id: r.draft_id, version: r.version, status: r.status,
              text: '', reporting_period: r.reporting_period,
            };
            if (!period && r.reporting_period) setPeriod(r.reporting_period);
          } else {
            init[sec.id] = { text: '' };
          }
        });
        setState(init);
      })
      .catch((e) => setTopError(String(e)))
      .finally(() => setLoading(false));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing draft contents
  useEffect(() => {
    Object.entries(state).forEach(([sid, s]) => {
      if (s.draft_id && !s.text && !s.generating) {
        props.fetchDraft(s.draft_id).then((d) => {
          try {
            const json = JSON.parse(d.draft?.content_json ?? '{}');
            const paras: Paragraph[] = json.paragraphs ?? [];
            setState((cur) => ({ ...cur, [sid]: { ...cur[sid], text: paragraphsToText(paras), paragraphs: paras } }));
          } catch { /* ignore */ }
        }).catch(() => undefined);
      }
    });
  }, [JSON.stringify(Object.entries(state).map(([k, v]) => [k, v.draft_id]))]);  // eslint-disable-line react-hooks/exhaustive-deps

  function update(sid: string, patch: Partial<SectionState>) {
    setState((s) => ({ ...s, [sid]: { ...s[sid], ...patch } }));
  }

  async function handleGenerate(sid: string) {
    update(sid, { generating: true, error: undefined });
    try {
      const r = await props.createDraft(sid, period ?? undefined);
      const paras = (r.paragraphs as Paragraph[]) ?? [];
      update(sid, {
        generating: false,
        draft_id: r.draft_id, version: r.version, status: r.status ?? 'draft',
        text: paragraphsToText(paras), paragraphs: paras,
        reporting_period: r.reporting_period,
      });
      if (!period) setPeriod(r.reporting_period);
    } catch (e) { update(sid, { generating: false, error: String(e) }); }
  }

  async function handleSave(sid: string) {
    const s = state[sid];
    if (!s.draft_id) return;
    update(sid, { saving: true });
    try {
      const paras = textToParagraphs(s.text);
      await props.saveDraft(s.draft_id, paras);
      update(sid, { paragraphs: paras });
    } catch (e) { update(sid, { error: String(e) }); }
    finally { update(sid, { saving: false }); }
  }

  async function handleApprove(sid: string) {
    const s = state[sid];
    if (!s.draft_id) return;
    update(sid, { approving: true });
    try {
      await props.approveDraft(s.draft_id);
      update(sid, { status: 'approved' });
    } catch (e) { update(sid, { error: String(e) }); }
    finally { update(sid, { approving: false }); }
  }

  function exportPdf() {
    if (!period) return;
    window.location.href = `${props.pdfBase}/${encodeURIComponent(period)}`;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Icon className="w-6 h-6 text-amber-700" />
          {props.docTitle}
          <PillarChip pillar={props.pillar} size="md" />
        </h2>
        <p className="text-sm text-gray-500 mt-1">{props.docSubtitle}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/pillar-3#ltg"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 px-2 py-1 rounded border border-amber-200 bg-amber-50/50">
            LTG measures (S.22.01) — Section D <ArrowRight className="w-3 h-3" />
          </Link>
          <Link to="/pillar-3#mcr"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 px-2 py-1 rounded border border-amber-200 bg-amber-50/50">
            MCR + Article 138 — Section E <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">Drafting workspace.</span> Each card below is one section
          of the {props.docName}. Click <span className="font-semibold">Generate draft</span> on any
          section to ask the AI to write it, grounded in the gold-table data for the chosen period.
          Review, edit in place, then <span className="font-semibold">Approve</span> when satisfied.
        </div>
      </div>

      {topError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {topError}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Reporting period: <span className="font-mono text-gray-800">{period ?? '(latest available)'}</span></span>
        <span className="ml-auto" />
        <button
          onClick={exportPdf}
          disabled={!period}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs font-medium"
        >
          Export {props.docName} PDF
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> loading drafts…
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((sec) => {
            const s = state[sec.id] ?? { text: '' };
            return (
              <SectionEditor
                key={sec.id}
                sectionTitle={sec.title}
                sectionSummary={sec.summary}
                citations={[]}
                status={s.status}
                version={s.version}
                text={s.text}
                onChange={(t) => update(sec.id, { text: t })}
                onGenerate={() => handleGenerate(sec.id)}
                onSave={() => handleSave(sec.id)}
                onApprove={() => handleApprove(sec.id)}
                generating={s.generating}
                saving={s.saving}
                approving={s.approving}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * AFR — Actuarial Function Report (Article 48). Pillar 2.
 *
 * Single page: 4 standard sections (TPs adequacy, UW policy adequacy,
 * RI adequacy, internal model). Each gets an AI-drafted opinion grounded
 * in the SCR / model versions / DQ summary / ORSA outcomes, then a
 * human review/edit/approve workflow.
 */
import { useEffect, useState } from 'react';
import { ScrollText, Loader2, AlertTriangle } from 'lucide-react';
import PillarChip from '../components/PillarChip';
import SectionEditor from '../components/SectionEditor';
import {
  fetchAfrSections, fetchAfrDrafts, createAfrDraft, saveAfrDraft, approveAfrDraft,
  type DocSection, type DraftListRow,
} from '../lib/api';

interface SectionState {
  draft_id?: string;
  version?: number;
  status?: string;
  text: string;
  reporting_period?: string;
  generating?: boolean;
  saving?: boolean;
  approving?: boolean;
  error?: string;
}

export default function Afr() {
  const [sections, setSections] = useState<DocSection[]>([]);
  const [period, setPeriod] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, SectionState>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchAfrSections(), fetchAfrDrafts()])
      .then(([s, d]) => {
        setSections(s.sections);
        // For each section, take the latest version we have (if any)
        const latest: Record<string, DraftListRow> = {};
        for (const row of d.drafts) {
          const key = row.section_id;
          if (!latest[key] || row.version > latest[key].version) latest[key] = row;
        }
        const init: Record<string, SectionState> = {};
        s.sections.forEach((sec) => {
          const r = latest[sec.id];
          if (r) {
            init[sec.id] = {
              draft_id: r.draft_id,
              version: r.version,
              status: r.status,
              text: '', // contents loaded on demand below
              reporting_period: r.reporting_period,
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
  }, []);

  // Load draft text once we know each section's draft_id
  useEffect(() => {
    Object.entries(state).forEach(([sid, s]) => {
      if (s.draft_id && !s.text && !s.generating) {
        fetch(`/api/afr/draft/${s.draft_id}`).then((r) => r.json()).then((d) => {
          setState((cur) => ({ ...cur, [sid]: { ...cur[sid], text: d.draft?.content ?? '' } }));
        }).catch(() => undefined);
      }
    });
  }, [JSON.stringify(Object.entries(state).map(([k, v]) => [k, v.draft_id])), Object.values(state).every((s) => !s.generating)]);  // eslint-disable-line react-hooks/exhaustive-deps

  function update(sid: string, patch: Partial<SectionState>) {
    setState((s) => ({ ...s, [sid]: { ...s[sid], ...patch } }));
  }

  async function handleGenerate(sid: string) {
    update(sid, { generating: true, error: undefined });
    try {
      const r = await createAfrDraft(sid, period ?? undefined);
      update(sid, {
        generating: false,
        draft_id: r.draft_id, version: r.version, status: r.status,
        text: r.content, reporting_period: r.reporting_period,
      });
      if (!period) setPeriod(r.reporting_period);
    } catch (e) {
      update(sid, { generating: false, error: String(e) });
    }
  }

  async function handleSave(sid: string) {
    const s = state[sid];
    if (!s.draft_id) return;
    update(sid, { saving: true });
    try { await saveAfrDraft(s.draft_id, s.text); }
    catch (e) { update(sid, { error: String(e) }); }
    finally { update(sid, { saving: false }); }
  }

  async function handleApprove(sid: string) {
    const s = state[sid];
    if (!s.draft_id) return;
    update(sid, { approving: true });
    try {
      await approveAfrDraft(s.draft_id);
      update(sid, { status: 'approved' });
    } catch (e) { update(sid, { error: String(e) }); }
    finally { update(sid, { approving: false }); }
  }

  function exportPdf() {
    if (!period) return;
    window.location.href = `/api/afr/pdf/${encodeURIComponent(period)}`;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-green-700" />
          Actuarial Function Report
          <PillarChip pillar={2} size="md" />
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Article 48 of Solvency II Directive — four sections, each grounded in current SCR /
          model / DQ / ORSA evidence. AI drafts; appointed actuary reviews + approves.
        </p>
        <div className="mt-3 bg-green-50 border border-green-200 rounded-md px-3 py-2 text-xs text-green-900">
          <span className="font-semibold">Drafting workspace.</span> Four cards below — one per
          Article 48 section. Click <span className="font-semibold">Generate draft</span> on any
          card to have the AI write it from the latest gold-table data, then review, edit in
          place, and <span className="font-semibold">Approve</span>. The PDF export at the top
          stitches the latest version of every approved section into one document with a
          SHA-256 content hash in the footer.
        </div>
      </div>

      {topError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {topError}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Reporting period: <span className="font-mono text-gray-800">{period ?? '(latest available)'}</span></span>
        <button
          onClick={exportPdf}
          disabled={!period || sections.every((s) => state[s.id]?.status !== 'approved')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs font-medium ml-auto"
        >
          Export AFR PDF
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

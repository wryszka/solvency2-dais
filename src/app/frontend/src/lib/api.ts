const BASE = '';

// Routes that participate in the demo cache. When the user's DemoModeToggle
// is set to 'cached', we add ?cached=1 to these URLs so the backend serves
// pre-baked AI output instead of calling the FM API live.
const CACHED_ROUTE_PREFIXES = [
  '/api/orsa/narrative',
  '/api/afr/draft',
  '/api/sfcr/draft',
  '/api/rsr/draft',
];

function shouldUseCache(url: string): boolean {
  if (typeof window === 'undefined') return false;
  const mode = window.localStorage.getItem('demo_mode');
  if (mode !== 'cached') return false;
  return CACHED_ROUTE_PREFIXES.some((p) => url.startsWith(p));
}

function withCacheFlag(url: string): string {
  if (!shouldUseCache(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cached=1`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${withCacheFlag(url)}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${withCacheFlag(url)}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Coerce a possibly-stringified ARRAY field into a real string array.
 *
 * The Databricks SQL Statement Execution API serialises ARRAY<STRING> columns
 * as JSON-encoded strings (e.g. `"[\"S.06.02\"]"`). Calling `.join()` on that
 * string throws TypeError; calling `.map()` iterates characters. This helper
 * unwraps both — pass-through if already an array, JSON.parse if a string,
 * empty array otherwise.
 */
export function asArray<T = string>(v: unknown): T[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function formatEur(value: number | string | null | undefined): string {
  if (value == null || value === '') return '\u2014';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '\u2014';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}EUR ${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}EUR ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}EUR ${(abs / 1_000).toFixed(0)}K`;
  return `${sign}EUR ${abs.toFixed(0)}`;
}

export function formatPct(value: string | number | null | undefined): string {
  if (value == null || value === '') return '\u2014';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '\u2014';
  return `${num.toFixed(1)}%`;
}

export function downloadFile(endpoint: string, filename: string) {
  const a = document.createElement('a');
  a.href = `${BASE}${endpoint}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Types ──────────────────────────────────────────────────────────

export interface ReportSummary {
  id: string;
  name: string;
  title: string;
  period?: string;
  row_count?: string | number;
  metric_label?: string;
  metric_value?: string;
  scr?: string;
  approval_status: string;
  pillar?: 1 | 2 | 3;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface ContentResponse {
  data: Row[];
  total?: number;
  page?: number;
  page_size?: number;
}

export interface QualityCheck {
  check: string;
  constraint: string;
  total: number;
  passing: number;
  failing: number;
  status: string;
  severity: string;
}

export interface LineageExpectation {
  name: string;
  rule: string;
  action: string;
}

export interface LineageStep {
  step: number;
  phase: string;
  source: string;
  target: string;
  layer: string;
  description: string;
  sql_snippet?: string | null;
  expectations?: LineageExpectation[];
  row_count_hint?: string;
}

export interface ApprovalRecord {
  approval_id: string;
  qrt_id: string;
  reporting_period: string;
  status: string;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  comments: string | null;
  export_path: string | null;
}

// ─── API functions ──────────────────────────────────────────────────

export function fetchReports(): Promise<{ data: ReportSummary[] }> {
  return fetchJson('/api/reports');
}

export function fetchContent(qrtId: string, page?: number, period?: string): Promise<ContentResponse> {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (period) params.set('period', period);
  const qs = params.toString();
  return fetchJson(`/api/reports/${qrtId}/content${qs ? '?' + qs : ''}`);
}

export function fetchQuality(qrtId: string): Promise<{ data: QualityCheck[] }> {
  return fetchJson(`/api/reports/${qrtId}/quality`);
}

export function fetchComparison(qrtId: string): Promise<{ data: Row[] }> {
  return fetchJson(`/api/reports/${qrtId}/comparison`);
}

export function fetchLineage(qrtId: string): Promise<{ data: LineageStep[] }> {
  return fetchJson(`/api/reports/${qrtId}/lineage`);
}

export function fetchPeriods(qrtId: string): Promise<{ data: string[] }> {
  return fetchJson(`/api/reports/${qrtId}/periods`);
}

export function fetchApproval(qrtId: string): Promise<{ data: ApprovalRecord | null }> {
  return fetchJson(`/api/approvals/${qrtId}`);
}

export function submitForReview(qrtId: string): Promise<ApprovalRecord> {
  return postJson(`/api/approvals/${qrtId}/submit`);
}

export function reviewApproval(qrtId: string, status: 'approved' | 'rejected', comments: string): Promise<unknown> {
  return postJson(`/api/approvals/${qrtId}/review`, { status, comments });
}

export function fetchTemplate(qrtId: string, period?: string): Promise<Row> {
  const qs = period ? `?period=${period}` : '';
  return fetchJson(`/api/reports/${qrtId}/template${qs}`);
}

export function generateCertificate(qrtId: string): Promise<{ certificate_path: string; approval: Row }> {
  return postJson(`/api/approvals/${qrtId}/certificate`);
}

export interface EmbedUrls {
  dashboard_url: string;
  genie_url: string;
  dashboard_id: string;
  genie_space_id: string;
  pricing_app_url?: string;
}

export function fetchEmbeds(): Promise<EmbedUrls> {
  return fetchJson('/api/embeds');
}

// ─── AI Review API ─────────────────────────────────────────────

export interface GuardrailVerdict {
  passed: boolean;
  checks_run: number;
  checks_passed: number;
  checks_failed: number;
  warnings: string[];
  failures: string[];
  pii_flags: string[];
  output_truncated: boolean;
  rate_limited: boolean;
}

export interface AiReviewResponse {
  review_id: string;
  qrt_id: string;
  reporting_period: string;
  review_text: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  guardrails?: GuardrailVerdict;
}

export interface GovernanceControl {
  layer: string;
  control: string;
  description: string;
  databricks_feature: string;
  icon: string;
}

export function generateAiReview(qrtId: string): Promise<AiReviewResponse> {
  return postJson(`/api/reports/${qrtId}/ai-review`);
}

export function fetchAiReviews(qrtId: string): Promise<{ data: Row[] }> {
  return fetchJson(`/api/reports/${qrtId}/ai-reviews`);
}

export function fetchGovernanceControls(): Promise<{ controls: GovernanceControl[] }> {
  return fetchJson('/api/reports/agent-governance');
}

// ─── Monitoring API ────────────────────────────────────────────

export function fetchSlaStatus(period?: string): Promise<{ data: Row[] }> {
  const qs = period ? `?period=${period}` : '';
  return fetchJson(`/api/monitoring/sla-status${qs}`);
}

export function fetchDqSummary(period?: string): Promise<{ data: Row[]; aggregate: Row | null }> {
  const qs = period ? `?period=${period}` : '';
  return fetchJson(`/api/monitoring/dq-summary${qs}`);
}

export function fetchDqTrends(): Promise<{ data: Row[] }> {
  return fetchJson('/api/monitoring/dq-trends');
}

export function fetchReconciliation(period?: string): Promise<{ data: Row[] }> {
  const qs = period ? `?period=${period}` : '';
  return fetchJson(`/api/monitoring/reconciliation${qs}`);
}

export function fetchModelVersions(period?: string): Promise<{ data: Row[] }> {
  const qs = period ? `?period=${period}` : '';
  return fetchJson(`/api/monitoring/model-versions${qs}`);
}

// ─── Feed Detail API ──────────────────────────────────────────────

export interface FeedDetail {
  feed_name: string;
  table: string;
  pipeline: string;
  freshness: Row[];
  completeness: Row[];
  dq_rules: Row[];
  sample: Row[];
  columns: Row[];
}

export function fetchFeedDetail(feedName: string): Promise<FeedDetail> {
  return fetchJson(`/api/monitoring/feed-detail/${feedName}`);
}

// ─── Reconciliation Investigation API ─────────────────────────────

export interface ReconInvestigation {
  check: Row;
  review_text: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  guardrails?: GuardrailVerdict;
}

export function investigateRecon(checkName: string): Promise<ReconInvestigation> {
  return postJson('/api/monitoring/recon-investigate', { check_name: checkName });
}

// ─── Agent #3: DQ Triage API ──────────────────────────────────────────

export interface DqTriageResponse {
  reporting_period?: string;
  failing_count?: number;
  review_text: string;
  model_used: string;
  input_tokens?: number;
  output_tokens?: number;
  guardrails?: GuardrailVerdict;
}

export function investigateDqFailures(): Promise<DqTriageResponse> {
  return postJson('/api/monitoring/dq-investigate');
}

// ─── Agent #4: Cross-QRT Consistency API ──────────────────────────────

export interface CrossQrtReviewResponse {
  reporting_period: string;
  review_text: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  guardrails?: GuardrailVerdict;
}

export function generateCrossQrtReview(): Promise<CrossQrtReviewResponse> {
  return postJson('/api/reports/cross-qrt-review');
}

// ─── Agent #2: Regulator Q&A API ──────────────────────────────────────

export interface RegulatorExampleCategory {
  category: string;
  questions: string[];
}

export interface RegulatorAnswer {
  question: string;
  answer: string;
  reporting_period: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  guardrails?: GuardrailVerdict;
}

export function fetchRegulatorExamples(): Promise<{ examples: RegulatorExampleCategory[] }> {
  return fetchJson('/api/regulator/examples');
}

export function askRegulatorQuestion(question: string): Promise<RegulatorAnswer> {
  return postJson('/api/regulator/ask', { question });
}

// ─── Agent #5: Stochastic Engine API ──────────────────────────────────

export interface StochasticReviewResponse {
  reporting_period: string;
  exposure_count: number;
  result_count: number;
  review_text: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  guardrails?: GuardrailVerdict;
}

export function generateStochasticReview(): Promise<StochasticReviewResponse> {
  return postJson('/api/reports/stochastic-engine-review');
}

// ─── Genie API ────────────────────────────────────────────────────

export interface GenieResponse {
  answer: string;
  sql: string | null;
  columns: string[];
  rows: (string | null)[][];
  conversation_id: string;
}

export function askGenie(question: string): Promise<GenieResponse> {
  return postJson('/api/genie/ask', { question });
}

// ─── Supervisor API (streaming) ───────────────────────────────────

export type SupervisorEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; tool_call_id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; tool_call_id: string; name: string; result_preview: string; result_size: number }
  | { type: 'answer'; text: string }
  | { type: 'done'; model_used: string; input_tokens: number; output_tokens: number; iterations: number }
  | { type: 'error'; message: string };

export async function askSupervisorStream(
  question: string,
  onEvent: (event: SupervisorEvent) => void,
): Promise<void> {
  const res = await fetch('/api/supervisor/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Supervisor stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Parse SSE: events separated by \n\n, each event has "event: TYPE\ndata: JSON"
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const block of events) {
      const lines = block.split('\n');
      let evType = 'message';
      let evData = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) evType = line.slice(7).trim();
        else if (line.startsWith('data: ')) evData = line.slice(6);
      }
      if (!evData) continue;
      try {
        const parsed = JSON.parse(evData);
        onEvent({ type: evType, ...parsed } as SupervisorEvent);
      } catch (e) {
        console.error('Failed to parse SSE event:', evType, evData, e);
      }
    }
  }
}

// ─── Submissions Archive + Process Metrics ──────────────────────────

export interface SubmissionRow {
  approval_id: string;
  qrt_id: string;
  qrt_name: string;
  qrt_title: string;
  reporting_period: string;
  status: string;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  comments: string | null;
  cycle_hours: number | null;
  dq_pass_rate_pct: number | null;
  feeds_late: number;
  feeds_missing: number;
}

export async function fetchSubmissions(): Promise<{ data: SubmissionRow[] }> {
  return fetchJson('/api/archive/submissions');
}

export interface ProcessMetrics {
  kpis: {
    total_submissions: number;
    approved: number;
    rejected: number;
    pending: number;
    approval_rate_pct: number | null;
    rejection_rate_pct: number | null;
    avg_cycle_hours: number | null;
    median_cycle_hours: number | null;
    periods_covered: number;
    earliest_period: string | null;
    latest_period: string | null;
  };
  dq_trend: { reporting_period: string; pass_rate_pct: number | string; failing_checks: number | string }[];
  sla_trend: { reporting_period: string; feed_count: number | string; late_count: number | string; missing_count: number | string; on_time_count: number | string }[];
  submissions_per_period: { period: string; count: number }[];
  top_reviewers: { name: string; count: number }[];
  top_submitters: { name: string; count: number }[];
}

export async function fetchProcessMetrics(): Promise<ProcessMetrics> {
  return fetchJson('/api/archive/process-metrics');
}

// ─── Landing page live status ───────────────────────────────────────

export type TileStatus = 'ready' | 'pending' | 'attention';

export interface LandingTile {
  status: TileStatus;
  metric: string;
  period?: string | null;
}

export interface LandingStatus {
  tiles: Record<string, LandingTile>;
  control_tower: {
    feeds_late_or_missing: number;
    feeds_total: number;
    recon_mismatches: number;
    recon_total: number;
    latest_period: string | null;
  };
}

export async function fetchLandingStatus(): Promise<LandingStatus> {
  return fetchJson('/api/landing/status');
}

// ─── Q4 pain callouts ────────────────────────────────────────────────

export type PainSeverity = 'ok' | 'warn' | 'high';

export interface Q4Pain {
  id: string;
  title: string;
  fired: boolean;
  severity: PainSeverity;
  headline: string;
  drill_path: string;
  context: Record<string, unknown>;
}

export async function fetchQ4Pains(): Promise<{ pains: Q4Pain[] }> {
  return fetchJson('/api/monitoring/q4-pains');
}

// ─── ORSA ────────────────────────────────────────────────────────────

export interface OrsaShock {
  module: string;
  sub_module: string;
  multiplier: number;
}

export interface OrsaScenario {
  scenario_id: string;
  name: string;
  description: string;
  shocks: OrsaShock[];
}

export interface OrsaResultRow {
  run_id: string;
  scenario_id: string;
  scenario_name: string;
  base_period: string;
  year_offset: number;
  projection_year: number;
  scr_eur: number;
  eligible_own_funds_eur: number;
  solvency_ratio_pct: number;
  module_breakdown_json: string;
  is_base: boolean;
}

export interface OrsaRun {
  run_id: string;
  scenario_id: string;
  scenario_name: string;
  base_period: string;
  rows: OrsaResultRow[];
}

export interface OrsaNarrative {
  narrative_id: string;
  run_id: string;
  version: number;
  narrative_text: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  generated_at?: string;
  generated_by?: string;
}

export async function fetchOrsaScenarios(): Promise<{ scenarios: OrsaScenario[] }> {
  return fetchJson('/api/orsa/scenarios');
}

export async function fetchOrsaPlan(): Promise<{ plan: Row[] }> {
  return fetchJson('/api/orsa/business-plan');
}

export async function runOrsaScenario(scenario_id: string, base_period?: string): Promise<OrsaRun> {
  return postJson('/api/orsa/run', { scenario_id, base_period: base_period ?? null });
}

export async function fetchOrsaRun(run_id: string): Promise<{ run_id: string; rows: OrsaResultRow[] }> {
  return fetchJson(`/api/orsa/run/${run_id}`);
}

export async function generateOrsaNarrative(run_id: string): Promise<OrsaNarrative> {
  return postJson('/api/orsa/narrative', { run_id });
}

export async function fetchOrsaNarratives(run_id: string): Promise<{ narratives: OrsaNarrative[] }> {
  return fetchJson(`/api/orsa/narratives/${run_id}`);
}

// ─── AFR / SFCR / RSR — shared shape ─────────────────────────────────

export interface DraftListRow {
  draft_id: string;
  reporting_period: string;
  section_id: string;
  version: number;
  status: string;
  content_hash: string;
  ai_model: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
}

export interface DocSection { id: string; title: string; summary?: string }

// AFR
export async function fetchAfrSections(): Promise<{ sections: DocSection[] }> { return fetchJson('/api/afr/sections'); }
export async function fetchAfrDrafts(period?: string): Promise<{ drafts: DraftListRow[] }> { return fetchJson(`/api/afr/drafts${period ? `?reporting_period=${period}` : ''}`); }
export async function fetchAfrDraft(draft_id: string): Promise<{ draft: Row }> { return fetchJson(`/api/afr/draft/${draft_id}`); }
export async function createAfrDraft(section_id: string, reporting_period?: string): Promise<Row> { return postJson('/api/afr/draft', { section_id, reporting_period }); }
export async function saveAfrDraft(draft_id: string, content: string): Promise<Row> { return postJson('/api/afr/save', { draft_id, content }); }
export async function approveAfrDraft(draft_id: string): Promise<Row> { return postJson('/api/afr/approve', { draft_id }); }

// SFCR
export interface Citation { table: string; cell: string }
export interface Paragraph { text: string; citations: Citation[] }

export async function fetchSfcrSections(): Promise<{ sections: DocSection[] }> { return fetchJson('/api/sfcr/sections'); }
export async function fetchSfcrDrafts(period?: string): Promise<{ drafts: DraftListRow[] }> { return fetchJson(`/api/sfcr/drafts${period ? `?reporting_period=${period}` : ''}`); }
export async function createSfcrDraft(section_id: string, reporting_period?: string): Promise<Row & { paragraphs: Paragraph[] }> { return postJson('/api/sfcr/draft', { section_id, reporting_period }); }
export async function saveSfcrDraft(draft_id: string, paragraphs: Paragraph[]): Promise<Row> { return postJson('/api/sfcr/save', { draft_id, paragraphs }); }
export async function approveSfcrDraft(draft_id: string): Promise<Row> { return postJson('/api/sfcr/approve', { draft_id }); }
export async function fetchSfcrDraft(draft_id: string): Promise<{ draft: Row }> { return fetchJson(`/api/sfcr/draft/${draft_id}`); }

// RSR
export async function fetchRsrSections(): Promise<{ sections: DocSection[] }> { return fetchJson('/api/rsr/sections'); }
export async function fetchRsrDrafts(period?: string): Promise<{ drafts: DraftListRow[] }> { return fetchJson(`/api/rsr/drafts${period ? `?reporting_period=${period}` : ''}`); }
export async function createRsrDraft(section_id: string, reporting_period?: string): Promise<Row & { paragraphs: Paragraph[] }> { return postJson('/api/rsr/draft', { section_id, reporting_period }); }
export async function saveRsrDraft(draft_id: string, paragraphs: Paragraph[]): Promise<Row> { return postJson('/api/rsr/save', { draft_id, paragraphs }); }
export async function approveRsrDraft(draft_id: string): Promise<Row> { return postJson('/api/rsr/approve', { draft_id }); }

// Model Governance
export interface ModelComparisonRow {
  component: string;
  champion_eur: number;
  challenger_eur: number;
  delta_eur: number;
  delta_pct: number;
}
export async function fetchModelRegistry(): Promise<{ models: Row[] }> { return fetchJson('/api/model-governance/registry'); }
export async function fetchModelComparison(): Promise<{ model_name: string; comparison: ModelComparisonRow[]; champion_error?: string; challenger_error?: string }> { return fetchJson('/api/model-governance/comparison'); }
export async function fetchModelRuns(): Promise<{ runs: Row[] }> { return fetchJson('/api/model-governance/runs'); }
export async function fetchModelApprovals(): Promise<{ approvals: Row[] }> { return fetchJson('/api/model-governance/approvals'); }
export async function recordModelApproval(model_name: string, model_version: string, decision: 'approved' | 'rejected', comments?: string): Promise<Row> { return postJson('/api/model-governance/approvals', { model_name, model_version, decision, comments }); }

// Internal Controls
export interface ControlRow { id: string; layer: string; control: string; description: string; implementation: string }
export interface ControlsLayer { layer: string; controls: ControlRow[] }
export async function fetchControlsMatrix(): Promise<{ layers: ControlsLayer[]; total_controls: number; layer_count: number; forbidden_patterns: string[] }> { return fetchJson('/api/internal-controls/matrix'); }
export async function fetchAgentAudit(limit = 50): Promise<{ calls: Row[] }> { return fetchJson(`/api/internal-controls/audit?limit=${limit}`); }
export async function fetchBlockedCounter(): Promise<{ forbidden_blocks: number; pii_flags: number; rate_limited: number; errors: number; total_calls: number }> { return fetchJson('/api/internal-controls/blocked-counter'); }
export async function fetchArchitectureAssertion(): Promise<{ invariants: { title: string; detail: string; implementation: string }[] }> { return fetchJson('/api/internal-controls/architecture-assertion'); }

// ─── Overlays Register ───────────────────────────────────────────────

export interface Overlay {
  overlay_id: string;
  model_name: string;
  quarter: string;
  line_of_business: string;
  accident_year: number | null;
  magnitude_eur: number | string;
  direction: 'increase' | 'decrease';
  category: string;
  rationale: string;
  author: string;
  created_at: string;
  approver: string | null;
  approved_at: string | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'retired';
  linked_qrt_cells: string[];
  lifecycle_action: 'new' | 'renewed_from_prior' | 'modified_from_prior' | 'retired';
  prior_overlay_id: string | null;
}

export interface OverlaySummary {
  by_status: { status: string; n: number; total_magnitude_eur: number | string }[];
  by_category: { category: string; n: number; total_magnitude_eur: number | string }[];
  by_line_of_business: { line_of_business: string; n: number; total_magnitude_eur: number | string }[];
}

export interface OverlayCreate {
  model_name: string;
  quarter: string;
  line_of_business: string;
  accident_year?: number | null;
  magnitude_eur: number;
  direction: 'increase' | 'decrease';
  category: string;
  rationale: string;
  linked_qrt_cells?: string[];
  lifecycle_action?: 'new' | 'renewed_from_prior' | 'modified_from_prior';
  prior_overlay_id?: string | null;
  submit_for_approval?: boolean;
}

export async function fetchOverlays(filters?: {
  quarter?: string; line_of_business?: string; status?: string; model_name?: string;
}): Promise<{ overlays: Overlay[] }> {
  const qs = new URLSearchParams();
  if (filters?.quarter) qs.append('quarter', filters.quarter);
  if (filters?.line_of_business) qs.append('line_of_business', filters.line_of_business);
  if (filters?.status) qs.append('status', filters.status);
  if (filters?.model_name) qs.append('model_name', filters.model_name);
  const q = qs.toString();
  return fetchJson(`/api/overlays${q ? `?${q}` : ''}`);
}

export async function fetchOverlay(overlay_id: string): Promise<{ overlay: Overlay }> {
  return fetchJson(`/api/overlays/${overlay_id}`);
}

export async function fetchOverlayLineage(overlay_id: string): Promise<{ overlay: Overlay; lifecycle_chain: Overlay[] }> {
  return fetchJson(`/api/overlays/lineage/${overlay_id}`);
}

export async function fetchOverlaySummary(quarter?: string): Promise<OverlaySummary> {
  return fetchJson(`/api/overlays/summary${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''}`);
}

export async function createOverlay(payload: OverlayCreate): Promise<{ overlay_id: string; status: string; required_approval_role: string }> {
  return postJson('/api/overlays', payload);
}

export async function approveOverlay(overlay_id: string, comments?: string): Promise<Row> {
  return postJson(`/api/overlays/${overlay_id}/approve`, { comments });
}

export async function retireOverlay(overlay_id: string): Promise<Row> {
  return postJson(`/api/overlays/${overlay_id}/retire`);
}

// ─── Actuarial Lab — unified governance ───────────────────────────────

export interface LabModelRow {
  model_id: string;
  label: string;
  engine: string;
  engine_tag: 'native' | 'external';
  production_version: string | null;
  candidate_version: string | null;
  n_versions: number;
  owner?: string | null;
  artefact_table?: string | null;
  last_promotion_status?: string | null;
  last_promotion_quarter?: string | null;
  last_promotion_at?: string | null;
  last_promotion_approver?: string | null;
  pending_promotions?: number;
  error?: string | null;
}

export interface ModelVersion {
  version: string;
  comment?: string;
  created_at?: string;
  created_by?: string;
  status?: string;
}

export interface ModelAlias { alias_name: string; version_num?: number; version_label?: string }

export interface ModelDetail {
  model_id: string;
  label: string;
  engine: string;
  engine_tag: 'native' | 'external';
  state: {
    full_name: string;
    aliases: ModelAlias[];
    versions?: ModelVersion[];
    rows?: Row[];
    artefact_table?: string;
    error?: string;
  };
}

export interface ModelDiagnostic {
  model_name: string;
  version_label: string;
  reporting_period: string;
  diagnostic_name: string;
  metric_value: number | string;
  metric_text: string;
  threshold_low: number | string;
  threshold_high: number | string;
  passed: boolean | string;
  computed_at: string;
}

export interface PromotionRow {
  promotion_id: string;
  model_name: string;
  model_type: string;
  from_alias: string | null;
  to_alias: string;
  from_version: string | null;
  to_version: string;
  quarter: string;
  diagnostics_passed: boolean | string;
  justification: string;
  approver: string | null;
  approved_at: string | null;
  promoted_by: string | null;
  promoted_at: string | null;
  status: string;
}

export async function fetchLabModels(): Promise<{ models: LabModelRow[] }> {
  return fetchJson('/api/governance/models');
}

export async function fetchLabModel(model_id: string): Promise<ModelDetail> {
  return fetchJson(`/api/governance/models/${model_id}`);
}

export async function fetchLabDiagnostics(model_id: string, period?: string): Promise<{ diagnostics: ModelDiagnostic[] }> {
  return fetchJson(`/api/governance/models/${model_id}/diagnostics${period ? `?period=${encodeURIComponent(period)}` : ''}`);
}

export async function fetchLabPromotions(model_id: string): Promise<{ promotions: PromotionRow[] }> {
  return fetchJson(`/api/governance/models/${model_id}/promotions`);
}

export async function promoteModel(model_id: string, payload: {
  target_alias?: 'production' | 'candidate' | 'archive';
  candidate_version?: string;
  quarter: string;
  justification: string;
  approver?: string;
}): Promise<Row> {
  return postJson(`/api/governance/models/${model_id}/promote`, payload);
}

export async function fetchGovernanceSummary(period?: string): Promise<{
  pending_promotions: number;
  approved_promotions: number;
  models_with_failed_diagnostics: { model_name: string; n: number }[];
}> {
  return fetchJson(`/api/governance/summary${period ? `?period=${encodeURIComponent(period)}` : ''}`);
}

// ─── Audit panel ─────────────────────────────────────────────────────

export interface AuditPanelData {
  qrt_id: string;
  period: string | null;
  data: {
    qrt_table: string;
    qrt_history: Row[];
    source_tables: {
      name: string;
      layer: string;
      columns_used: string[];
      described: string;
      row_count: number | null;
      history: Row[];
    }[];
  };
  code: {
    notebooks: { path: string; described: string }[];
    recent_runs: Row[];
  };
  models: {
    model_name: string;
    model_type?: string;
    to_version: string | null;
    quarter: string | null;
    approver: string | null;
    approved_at: string | null;
  }[];
  approvals_overlays: {
    approvals: Row[];
    overlays: Overlay[];
  };
  lineage: {
    produced_by: string[];
    source_tables: { name: string; layer: string; described: string }[];
    qrt_table: string;
    summary_table: string;
  };
}

export async function fetchAuditPanel(qrt_id: string, period?: string): Promise<AuditPanelData> {
  return fetchJson(`/api/qrt/${qrt_id}/audit${period ? `?period=${encodeURIComponent(period)}` : ''}`);
}

export async function fetchQrtVersions(qrt_id: string): Promise<{ qrt_table: string; history: Row[] }> {
  return fetchJson(`/api/qrt/${qrt_id}/versions`);
}

// ─── Phase 5 demo narrative ──────────────────────────────────────────

export interface DemoFeed {
  feed_name: string;
  source_system: string;
  source_party: string;
  owner_contact_name: string;
  owner_contact_role: string;
  owner_contact_email: string;
  expected_at: string;
  received_at: string;
  status: 'received_late' | 'received_on_time' | 'pending';
  last_contact_at: string | null;
  last_contact_method: string | null;
  last_contact_notes: string | null;
  eta_at: string | null;
  blocks_qrts: string[];
  stale_models: string[];
  recon_phantom_eur: number | string;
  notes: string;
  reporting_period: string;
}

export interface DemoSfChallenger {
  challenger_version: string;
  calibration_label: string;
  submitted_by: string;
  submitted_role: string;
  submitted_at: string;
  approver_name: string;
  approver_role: string;
  approver_status: string;
  approver_oo_until: string | null;
  deputy_name: string;
  deputy_role: string;
  deputy_status: string;
  reminders_sent: number;
  last_reminder_at: string;
  scr_delta_pct: number | string;
  ratio_before_pct: number | string;
  ratio_after_pct: number | string;
  methodology_changes: string[];
  current_state: string;
  promoted_at: string | null;
  promoted_by: string | null;
}

export interface DailySolvency {
  observed_date: string;
  ratio_pct: number | string;
  delta_vs_prior_pp: number | string;
  driver: string;
  driver_class: string;
}

export interface OrsaHistoryScenario {
  scenario_id: string;
  scenario_name: string;
  points: { observed_date: string; year_offset: number; ratio_pct: number }[];
}

export async function fetchDemoFeeds(period = '2025-Q4'): Promise<{ feeds: DemoFeed[] }> {
  return fetchJson(`/api/demo/feeds?period=${encodeURIComponent(period)}`);
}
export async function fetchDemoFeed(feedName: string): Promise<{ feed: DemoFeed }> {
  return fetchJson(`/api/demo/feeds/${encodeURIComponent(feedName)}`);
}
export async function fetchSfChallenger(): Promise<{ challenger: DemoSfChallenger | null }> {
  return fetchJson('/api/demo/sf-challenger');
}
export async function escalateSfChallenger(note?: string): Promise<Row> {
  return postJson('/api/demo/sf-challenger/escalate', { note });
}
export async function promoteSfChallenger(approver_signoff: string): Promise<Row> {
  return postJson('/api/demo/sf-challenger/promote', { approver_signoff });
}
export async function fetchCatAgentReview(): Promise<{ review: string; events: Row[]; storm_claims: Row[] }> {
  return fetchJson('/api/demo/cat-agent/review');
}
export async function fetchCatAgentState(): Promise<{ state: 'pending_review' | 'promoted'; promoted_at?: string; promoted_by?: string }> {
  return fetchJson('/api/demo/cat-agent/state');
}
export async function approveCatAgent(): Promise<{ status: string; promotion_id: string; approved_at: string; approved_by: string }> {
  return postJson('/api/demo/cat-agent/approve', {});
}
export async function fetchSolvencyDaily(days = 90): Promise<{ series: DailySolvency[] }> {
  return fetchJson(`/api/demo/solvency-daily?days=${days}`);
}
export async function fetchCyberBook(): Promise<{ cyber: Row | null }> {
  return fetchJson('/api/demo/cyber-book');
}
export async function runWhatif(scenario_label: string, payload: Record<string, unknown> = {}): Promise<Row> {
  return postJson('/api/demo/whatif/run', { scenario_label, payload });
}
export async function fetchOrsaHistory(days = 30): Promise<{ scenarios: OrsaHistoryScenario[] }> {
  return fetchJson(`/api/demo/orsa/history?days=${days}`);
}

export interface OrsaDraftSection {
  version: number;
  section_id: string;
  section_title: string;
  body_markdown: string;
  status: 'live' | 'stable' | 'annual_review';
  last_quantitative_refresh: string;
  last_narrative_review: string;
  order_index: number;
  generated_by: string;
}
export async function fetchOrsaDraft(): Promise<{ version: number | null; sections: OrsaDraftSection[] }> {
  return fetchJson('/api/demo/orsa/draft');
}

export interface ArchiveSubmission {
  period: string;
  qrt: string;
  qrt_title: string;
  doc_type: 'qrt' | 'sfcr' | 'rsr' | 'orsa';
  status: 'submitted' | 'in_progress';
  submitted_at: string | null;
  submitted_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  cycle_days: number | string | null;
  dq_pass_rate: number | string;
  feeds_complete: string;
  headline_metric: string;
  headline_value: string;
  narrative: string;
  audit_snapshot_id: string;
}
export async function fetchArchiveSubmissions(): Promise<{ submissions: ArchiveSubmission[] }> {
  return fetchJson('/api/demo/archive/submissions');
}
export function archivePdfUrl(period: string, qrt: string): string {
  return `/api/demo/archive/pdf/${encodeURIComponent(period)}/${encodeURIComponent(qrt)}`;
}

export interface PeriodState {
  today: string;
  current_period: string;
  current_period_end: string;
  deadline: string;
  business_days_to_deadline: number;
  status: 'in_progress';
}
export async function fetchPeriodState(): Promise<PeriodState> {
  return fetchJson('/api/demo/period-state');
}
export async function runOrsaStress(scenario_label: string, duration_years = 5): Promise<Row> {
  return postJson('/api/demo/orsa/run-stress', { scenario_label, duration_years });
}
export async function resetDemo(): Promise<{ status: string; elapsed_seconds: number; actions: string[] }> {
  return postJson('/api/demo/reset');
}

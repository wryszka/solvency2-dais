/**
 * BricksterInstructions — compact internal guide for Databricks staff running
 * the DAIS booth demo. Linked from the sidebar (above Learn). Booth-only.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, Info, Mail } from 'lucide-react';

const EMAIL = 'laurence.ryszka@databricks.com';
const MARCELA_EMAIL = 'marcela.granados@databricks.com';

export default function BricksterInstructions() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <Link to="/today" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Control Tower
      </Link>

      <header className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
          <Info className="w-5 h-5 text-amber-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Instructions for Bricksters</h1>
          <p className="text-sm text-gray-500 mt-0.5">A 60-second guide to running this booth demo.</p>
        </div>
      </header>

      {/* What it is */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-2 text-sm text-gray-700 leading-relaxed">
        <h2 className="text-sm font-bold text-gray-900">What this is</h2>
        <p>
          A <strong>real business process — insurance regulatory reporting — fully implemented on
          Databricks</strong>. The example is <strong>Solvency II</strong> (EU/UK insurer capital &amp;
          reporting; the US analogue is the NAIC’s Risk-Based Capital regime, statutory filings, and
          US ORSA). It shows the whole reporting system running on one lakehouse.
        </p>
      </section>

      {/* What we're showing — the story */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 text-sm text-gray-700 leading-relaxed">
        <h2 className="text-sm font-bold text-gray-900">What you’re showing</h2>
        <p>
          The one-liner: <strong>an insurer runs its entire regulatory reporting machine — data,
          capital models, governance and disclosure — on a single Databricks platform, with AI agents
          working alongside the actuaries.</strong> No stitched-together stack of spreadsheets,
          vendor engines and document tools.
        </p>
        <div>
          <p className="font-semibold text-gray-900 mb-1.5">The story, in five beats:</p>
          <ol className="space-y-1.5 list-decimal pl-5">
            <li><strong>One source of truth.</strong> All the data — policies, claims, assets, market data — lands and is governed in the lakehouse, with quality checks and reconciliation before anything is calculated.</li>
            <li><strong>The capital is computed live.</strong> Technical provisions and the SCR Standard Formula run as real code on that data, not a black box — you can open the modules and see the numbers move.</li>
            <li><strong>Everything is governed and audited.</strong> Every model is versioned and validated; every expert-judgement overlay and approval is logged. The numbers are defensible to a regulator.</li>
            <li><strong>The disclosures fall out of it.</strong> The QRTs, SFCR and RSR are generated straight from the governed data — not re-typed into Word and Excel.</li>
            <li><strong>AI throughout.</strong> Agents draft narratives, flag data anomalies, answer questions in plain English, and a contrarian reviewer pressure-tests scenarios — always grounded in the actual figures.</li>
          </ol>
        </div>
        <div>
          <p className="font-semibold text-gray-900 mb-1.5">What’s actually implemented:</p>
          <ul className="space-y-1.5 list-disc pl-5">
            <li><strong>All three Solvency II pillars</strong> — Pillar 1 (capital), Pillar 2 (governance &amp; ORSA), Pillar 3 (disclosure) — end to end.</li>
            <li><strong>The data foundation</strong> — ingestion, data quality and reconciliation on the lakehouse.</li>
            <li><strong>Governance spine</strong> — Unity Catalog: versioning, permissions and lineage on every table, model and function.</li>
            <li><strong>The AI layer</strong> — a supervisor routing to specialist agents, Genie over the data, and Foundation-Model narratives.</li>
          </ul>
        </div>
      </section>

      {/* How it behaves */}
      <section className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-2 text-sm text-blue-950/85 leading-relaxed">
        <h2 className="text-sm font-bold text-blue-900">Good to know before you click</h2>
        <ul className="space-y-1.5 list-disc pl-5">
          <li><strong>Every screen has a one-line description at the top.</strong> It says what that view shows — read it, or let the visitor read it, before you dive in. You don’t need to memorise the demo.</li>
          <li><strong>Treat the whole thing as a worked example of a business process</strong> — how insurance regulatory reporting can run on Databricks — not a finished product. That framing keeps the conversation about the platform, not the insurance detail.</li>
          <li><strong>For short demos, don’t change anything and don’t approve</strong> — just walk the current state as it is. Nothing to set up.</li>
          <li><strong>If you do change something, reset it.</strong> Use <em>Reset demo</em> in the bottom-left of the sidebar — it puts everything back (takes a few minutes).</li>
          <li><strong>AI is cached for speed.</strong> Common questions answer instantly from a pre-baked cache. You can switch to live AI any time via <em>AI mode</em> in the sidebar (bottom).</li>
          <li><strong>Scale-to-zero.</strong> The first live/uncached AI question may take ~30–40s while the model wakes — ask one to warm it before a busy spell.</li>
        </ul>
      </section>

      {/* Where to go */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 text-sm text-gray-700 leading-relaxed">
        <h2 className="text-sm font-bold text-gray-900">Where to go (suggested flow)</h2>
        <ol className="space-y-2 list-decimal pl-5">
          <li><strong><Link to="/today" className="text-blue-700 hover:underline">Control Tower</Link></strong> — start here. The current state: where we are, what the issues are. Drill into ingestion &amp; data quality, reconciliation, and model versions.</li>
          <li><strong><Link to="/reporting-cycle" className="text-blue-700 hover:underline">Reporting Cycle</Link></strong> — the end-to-end framework across the three pillars.</li>
          <li><strong><Link to="/governance" className="text-blue-700 hover:underline">Governance</Link></strong> — all the evidence gathered during the process: approvals, overlays, audit, AI activity.</li>
          <li><strong><Link to="/agents" className="text-blue-700 hover:underline">Workbench AI</Link></strong> — one central view of the agents that appear throughout the demo.</li>
          <li><strong><Link to="/whatif" className="text-blue-700 hover:underline">What-if scenarios</Link></strong> — answer ad-hoc questions live.</li>
        </ol>
      </section>

      {/* Honesty */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-700 leading-relaxed">
        <h2 className="text-sm font-bold text-gray-900">Honest caveat</h2>
        <p className="mt-1">
          Most of the process genuinely runs on Databricks, but there are a few exceptions and
          deliberately “cut corners” to keep the demo fast and reliable on the booth. Happy to walk
          anyone through what’s real vs. illustrative.
        </p>
      </section>

      {/* Deep-dive escalation */}
      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-950/90 leading-relaxed">
        <h2 className="text-sm font-bold text-amber-900">If they want to go deeper on insurance or Solvency II</h2>
        <p className="mt-1">
          This booth shows the <strong>platform</strong> through an insurance example — it’s not the place
          for a deep actuarial or Solvency II discussion. If a visitor wants that level of detail,
          <strong> take their name</strong> (and email/company if they’ll give it) and let{' '}
          <a href={`mailto:${MARCELA_EMAIL}`} className="text-amber-800 underline hover:text-amber-900 font-semibold">Marcela</a> or{' '}
          <a href={`mailto:${EMAIL}`} className="text-amber-800 underline hover:text-amber-900 font-semibold">Laurence</a>{' '}
          know — they’ll follow up properly. The{' '}
          <Link to="/register-interest" className="text-amber-800 underline hover:text-amber-900">register-interest</Link>{' '}
          form is the easy way to capture it.
        </p>
      </section>

      {/* Contact */}
      <div className="bg-slate-900 rounded-xl px-5 py-4 flex items-center gap-3">
        <Mail className="w-5 h-5 text-blue-300 shrink-0" />
        <div className="text-sm text-slate-200">
          Issues, questions, requirements or suggestions? Talk to{' '}
          <strong className="text-white">Laurence Ryszka</strong> —{' '}
          <a href={`mailto:${EMAIL}`} className="text-blue-300 hover:underline font-semibold">{EMAIL}</a>{' '}
          or <strong className="text-white">Marcela Granados</strong> —{' '}
          <a href={`mailto:${MARCELA_EMAIL}`} className="text-blue-300 hover:underline font-semibold">{MARCELA_EMAIL}</a>
        </div>
      </div>
    </div>
  );
}

/**
 * Hub — DAIS booth front page (single-app build).
 *
 * Standalone landing (no Solvency sidebar). Tiles for every workflow that
 * shares the lakehouse. Only Solvency II is live — it opens the app's own
 * landing (/home). Every other tile opens a register-interest page.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { TILES, type Tile } from '../lib/workbench-tiles';

export default function Hub() {
  return (
    <div className="min-h-screen bg-gray-100 font-[system-ui]">
      <header className="sticky top-0 z-10 bg-[#1e293b] text-white border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-2.5">
          <LayoutGrid className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="text-base font-bold tracking-tight">Actuarial Workbench</span>
          <span className="ml-auto text-xs text-gray-400">Bricksurance SE · Databricks Field Engineering</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-7">
        <section className="pt-2">
          <div className="text-[11px] uppercase tracking-widest text-blue-700 font-bold">Actuarial Workbench</div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">Bricksurance SE — Composite Insurer</h1>
          <p className="text-base text-gray-500 mt-1.5 leading-relaxed max-w-3xl">
            One front door for the actuarial work — each workflow an app on the shared lakehouse.
            The live demo at this booth is <strong>Solvency II</strong>; the rest are what we’re
            building — open any tile to see what it is and register interest.
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TILES.map((t) => <TileCard key={t.slug} tile={t} />)}
        </div>

        <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 pt-3">
          <span className="font-semibold text-gray-500">About this demo.</span>{' '}
          A Databricks Field Engineering demonstration. Bricksurance SE is a fictional composite
          insurer and all data is synthetic — nothing here is real regulatory output. Only the
          Solvency II workflow is running at this booth.
        </p>
      </main>
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  live:        { label: 'live',        cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  in_progress: { label: 'in progress', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  roadmap:     { label: 'coming soon', cls: 'bg-slate-200 text-slate-600 border-slate-300' },
};

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;

  // ── The one live demo at the booth — bold filled card, opens the app. ──
  if (tile.slug === 'solvency-2') {
    return (
      <Link to={tile.to}
        className="md:col-span-2 lg:col-span-1 block rounded-2xl p-5 flex flex-col text-white
                   bg-gradient-to-br from-blue-600 to-indigo-700 ring-2 ring-blue-300
                   shadow-lg hover:shadow-xl hover:from-blue-500 hover:to-indigo-600 transition-all group">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center">
            <Icon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold tracking-tight">{tile.label}</h3>
              <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-white/20 text-white inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" /> live demo
              </span>
            </div>
            <p className="text-[11px] text-blue-100 mt-0.5 font-semibold">Start here — running at this booth</p>
          </div>
        </div>
        <p className="text-sm text-blue-50/95 leading-relaxed flex-1">{tile.description}</p>
        <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold bg-white text-blue-700 rounded-lg px-3 py-2 self-start group-hover:gap-2.5 transition-all">
          ▶ Open the live demo — click here <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </Link>
    );
  }

  // ── Everything else — true status badge, but register interest (not at this booth). ──
  const badge = STATUS_BADGE[tile.status] ?? STATUS_BADGE.roadmap;
  return (
    <Link to={`/register-interest?tile=${tile.slug}`}
      className="block bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-slate-300 transition-all flex flex-col group">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
          <Icon className="w-6 h-6 text-slate-500" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-slate-800 tracking-tight">{tile.label}</h3>
            <span className={`text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">{tile.subtitle ? `${tile.subtitle} · ` : ''}not available at this booth</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed flex-1">{tile.description}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
        Register interest <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

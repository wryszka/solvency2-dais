/**
 * Actuarial Workbench landing.
 *
 * Top-level / page. Tiles for each workflow that shares the lakehouse:
 *   - 2 live (Solvency II + Pricing)
 *   - 4 roadmap (IFRS 17 / Reinsurance / Claims analytics / Reserving deep-dive)
 *   - 2 in-progress (SAS migration + Excel migration — worked examples being built)
 * Live tiles open the running app; roadmap + in-progress tiles open a stub at
 * /roadmap/{slug} that describes the workflow + how it would extend the workbench.
 *
 * Tile metadata lives in workbench-tiles.ts so adding a new tile is one file.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TILES, type Tile } from '../lib/workbench-tiles';
import { fetchPeriodState, fetchEmbeds } from '../lib/api';
import { useEffect, useState } from 'react';

export default function Workbench() {
  const [period, setPeriod] = useState<string | null>(null);
  // Pricing tile target URL is per-workspace; source from PRICING_APP_URL env
  // via /api/embeds rather than the static tile registry. Falls back to the
  // hardcoded value in TILES if the API is unavailable.
  const [pricingUrl, setPricingUrl] = useState<string | null>(null);
  useEffect(() => {
    fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined);
    fetchEmbeds().then((e) => { if (e.pricing_app_url) setPricingUrl(e.pricing_app_url); }).catch(() => undefined);
  }, []);

  const tiles: Tile[] = TILES.map((t) =>
    t.slug === 'pricing' && pricingUrl ? { ...t, to: pricingUrl } : t,
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-7">
      <header className="pt-2">
        <div className="text-[11px] uppercase tracking-widest text-blue-700 font-bold">Actuarial Workbench</div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight mt-1">Bricksurance SE — Composite Insurer</h1>
        <p className="text-base text-gray-500 mt-1.5 leading-relaxed max-w-3xl">
          One platform for the actuarial work — calculation, governance, disclosure, and the
          adjacent workflows that share its data. Solvency II is what's running today; the
          others are next.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => <TileCard key={t.slug} tile={t} period={period} />)}
      </div>

      <details className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-700 mt-2">
        <summary className="font-semibold text-gray-800 cursor-pointer">Platform overview</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Every workflow on this surface shares one foundation — Unity Catalog for governed
            tables and ML models, Delta for storage and time travel, MLflow for model versioning,
            Mosaic AI for the agent layer, Databricks Apps for the surface itself. Pipelines, AI
            agents, model governance, overlays, audit, and disclosure all live on the same plane.
          </p>
          <p className="text-[11px] text-gray-500">
            <Link to="/architecture" className="text-blue-600 hover:underline">Architecture diagram</Link>
            {' '}· <Link to="/learn" className="text-blue-600 hover:underline">Regime walk-through</Link>
          </p>
        </div>
      </details>
    </div>
  );
}

function TileCard({ tile, period }: { tile: Tile; period: string | null }) {
  const isLive = tile.status === 'live';
  const isInProgress = tile.status === 'in_progress';
  const Icon = tile.icon;
  const isExternal = isLive && /^https?:\/\//.test(tile.to);

  if (isLive) {
    const cls = LIVE_TILE_PALETTE[tile.accent ?? 'blue'];
    const periodNote = tile.slug === 'solvency-2' && period
      ? `Live cycle: ${period}`
      : isExternal ? 'External app · opens in new tab' : 'Live';
    const containerCls = `block bg-white border-2 ${cls.border} rounded-2xl p-5 transition-all hover:shadow-lg ${cls.hover} group flex flex-col`;
    const inner = (
      <>
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-12 h-12 rounded-xl ${cls.iconBg} flex items-center justify-center transition-colors`}>
            <Icon className={`w-6 h-6 ${cls.iconColor}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className={`text-xl font-bold ${cls.title} tracking-tight`}>{tile.label}</h3>
              <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                live
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5 font-mono">{periodNote}</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed flex-1">{tile.description}</p>
        <div className={`mt-3 inline-flex items-center gap-1 text-sm font-bold ${cls.arrow}`}>
          Open <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </>
    );
    return isExternal
      ? <a href={tile.to} target="_blank" rel="noopener noreferrer" className={containerCls}>{inner}</a>
      : <Link to={tile.to} className={containerCls}>{inner}</Link>;
  }

  if (isInProgress) {
    // In-progress tile — warmer than roadmap, signals active build
    return (
      <Link to={tile.to}
        className="block bg-white border-2 border-amber-300 rounded-2xl p-5 hover:shadow-lg hover:border-amber-400 hover:shadow-amber-100 transition-all flex flex-col group">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-amber-100 group-hover:bg-amber-200 flex items-center justify-center transition-colors">
            <Icon className="w-6 h-6 text-amber-700" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold text-amber-900 tracking-tight">{tile.label}</h3>
              <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                in progress
              </span>
            </div>
            <p className="text-[11px] text-amber-700/80 mt-0.5">Worked example · being built</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed flex-1">{tile.description}</p>
        <div className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-amber-700">
          Read more <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </Link>
    );
  }

  // Roadmap tile — visually de-emphasised
  return (
    <Link to={tile.to}
      className="block bg-slate-50 border border-slate-200 rounded-2xl p-5 hover:bg-white hover:shadow-md transition-all flex flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-slate-200 flex items-center justify-center">
          <Icon className="w-6 h-6 text-slate-500" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-slate-700 tracking-tight">{tile.label}</h3>
            <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
              coming soon
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Roadmap</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed flex-1">{tile.description}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500">
        Read more <ArrowRight className="w-3 h-3" />
      </div>
    </Link>
  );
}

const LIVE_TILE_PALETTE = {
  blue: {
    border: 'border-blue-300', hover: 'hover:border-blue-400 hover:shadow-blue-100',
    iconBg: 'bg-blue-100 group-hover:bg-blue-200', iconColor: 'text-blue-700',
    title: 'text-blue-900', arrow: 'text-blue-700',
  },
};

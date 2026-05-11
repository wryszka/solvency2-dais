/**
 * Actuarial Workbench landing.
 *
 * Top-level / page. Six tiles — one live (Solvency II), five roadmap.
 * Clicking the live tile takes the user into the existing Solvency II
 * surface (Three Doors at /solvency-2). Roadmap tiles open a stub at
 * /roadmap/{slug} that describes the workflow + how it would extend the
 * workbench.
 *
 * Tile metadata lives in workbench-tiles.ts so adding a new tile is one file.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TILES, type Tile } from '../lib/workbench-tiles';
import { fetchPeriodState } from '../lib/api';
import { useEffect, useState } from 'react';

export default function Workbench() {
  const [period, setPeriod] = useState<string | null>(null);
  useEffect(() => {
    fetchPeriodState().then((p) => setPeriod(p.current_period)).catch(() => undefined);
  }, []);

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
        {TILES.map((t) => <TileCard key={t.slug} tile={t} period={period} />)}
      </div>

      <details className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-700 mt-2">
        <summary className="font-semibold text-gray-800 cursor-pointer">About this workbench</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Working demonstration of an actuarial workbench on Databricks — Unity Catalog +
            Delta + MLflow + Mosaic AI + Databricks Apps. Pipelines, AI agents, model
            governance, overlays, audit, and disclosure all run on one platform.
          </p>
          <p className="italic text-gray-600">
            Data is synthetic; reserving, SF, Igloo and Prophet are illustrative — vehicle, not
            cargo. Source code on GitHub. Deployable to any Databricks workspace with serverless
            and Foundation Model API access.
          </p>
        </div>
      </details>
    </div>
  );
}

function TileCard({ tile, period }: { tile: Tile; period: string | null }) {
  const isLive = tile.status === 'live';
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

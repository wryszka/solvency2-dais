/**
 * Placeholder for Pillar pages still under construction.
 *
 * Used by Phase 2.2 — pages are stubbed so the new nav works end-to-end,
 * then replaced with real implementations in subsequent sub-phases.
 */
import { Construction, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PillarChip, { type Pillar } from './PillarChip';

interface Props {
  title: string;
  subtitle?: string;
  pillar: Pillar;
  comingIn: string;
  fallbackHint?: string;
  fallbackPath?: string;
}

export default function PillarPagePlaceholder({
  title, subtitle, pillar, comingIn, fallbackHint, fallbackPath,
}: Props) {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        <PillarChip pillar={pillar} size="md" />
      </div>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex items-start gap-3">
        <Construction className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-amber-900">Under construction</div>
          <div className="text-sm text-amber-800 mt-1">
            This page lands as part of <code className="font-mono px-1 py-0.5 bg-amber-100 rounded">{comingIn}</code>.
            The nav entry exists so the pillar architecture is wired end-to-end while the screen is being built.
          </div>
        </div>
      </div>

      {fallbackHint && fallbackPath && (
        <button
          onClick={() => navigate(fallbackPath)}
          className="w-full flex items-center justify-between gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all text-left"
        >
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">In the meantime</div>
            <div className="font-semibold text-gray-900 mt-0.5">{fallbackHint}</div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400" />
        </button>
      )}
    </div>
  );
}

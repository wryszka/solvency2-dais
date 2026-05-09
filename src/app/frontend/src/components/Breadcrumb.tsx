/**
 * Breadcrumb — small trail at the top of artefact pages.
 *
 * Renders only when location.state.crumbs is set (i.e. the user arrived via
 * a Today / Reporting Cycle / Learn door link). The artefact pages themselves
 * are unchanged otherwise; this is opt-in via the linking side.
 *
 * Set crumbs from a Link like:
 *   <Link to="/orsa" state={{ crumbs: [
 *     { label: 'Reporting Cycle', to: '/reporting-cycle' },
 *     { label: 'Pillar 2 — Governance' },
 *     { label: 'ORSA' },
 *   ]}}>ORSA</Link>
 */
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;       // omit on the final segment
}

export default function Breadcrumb() {
  const location = useLocation();
  const crumbs = (location.state as { crumbs?: Crumb[] } | null)?.crumbs;
  if (!crumbs || crumbs.length === 0) return null;

  return (
    <nav aria-label="breadcrumb"
      className="text-[11px] text-gray-500 flex items-center gap-1 mb-3 -mt-2">
      <Link to="/" className="hover:text-gray-800 inline-flex items-center gap-1">
        <Home className="w-3 h-3" /> Home
      </Link>
      {crumbs.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <ChevronRight className="w-3 h-3 text-gray-300" />
          {c.to
            ? <Link to={c.to} className="hover:text-gray-800">{c.label}</Link>
            : <span className="text-gray-700 font-medium">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

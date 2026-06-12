/**
 * PageIntro — the orientation strip shown at the top of every page.
 *
 * Mounted once in the AppShell layout (below the breadcrumb). Looks up the
 * current route in the page-intro registry and renders a short "what am I
 * looking at" line. No entry → renders nothing, so pages without an intro
 * are simply unaffected.
 */
import { useLocation } from 'react-router-dom';
import { Info } from 'lucide-react';
import { getPageIntro } from '../lib/page-intros';

export default function PageIntro() {
  const { pathname } = useLocation();
  const intro = getPageIntro(pathname);
  if (!intro) return null;
  return (
    <div className="px-6 pt-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-2.5">
        <Info className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
        <p className="text-[13px] leading-relaxed text-blue-950">
          <span className="font-semibold">{intro.title}.</span>{' '}
          {intro.body}
        </p>
      </div>
    </div>
  );
}

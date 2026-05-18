/**
 * ForceRefreshButton — sidebar footer affordance.
 *
 * Clears the in-memory API cache and reloads the page so every component
 * refetches against the warehouse. Sits next to ResetDemoButton.
 */
import { RefreshCw } from 'lucide-react';
import { invalidateCache } from '../lib/api';

export default function ForceRefreshButton() {
  function go() {
    invalidateCache();
    window.location.reload();
  }
  return (
    <button
      onClick={go}
      title="Force refresh — clear cache and reload"
      className="p-1 rounded hover:bg-white/10 transition-colors opacity-40 hover:opacity-100"
    >
      <RefreshCw className="w-3.5 h-3.5" />
    </button>
  );
}

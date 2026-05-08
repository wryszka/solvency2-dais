/**
 * DemoModeToggle — sidebar switch for live vs cached AI on stage.
 *
 * Stores the choice in localStorage and dispatches a CustomEvent so the
 * api.ts fetch wrapper picks it up without prop drilling. Designed to be
 * flipped mid-talk if the FM API misbehaves.
 */
import { useEffect, useState } from 'react';
import { Radio, Database } from 'lucide-react';

const STORAGE_KEY = 'demo_mode';
export type DemoMode = 'live' | 'cached';

export function getDemoMode(): DemoMode {
  if (typeof window === 'undefined') return 'live';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'cached' ? 'cached' : 'live';
}

export function setDemoMode(mode: DemoMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent('demo-mode-change', { detail: mode }));
}

export default function DemoModeToggle() {
  const [mode, setMode] = useState<DemoMode>(getDemoMode());

  useEffect(() => {
    const onChange = (e: Event) => setMode((e as CustomEvent<DemoMode>).detail);
    window.addEventListener('demo-mode-change', onChange);
    return () => window.removeEventListener('demo-mode-change', onChange);
  }, []);

  function flip() {
    const next: DemoMode = mode === 'live' ? 'cached' : 'live';
    setDemoMode(next);
  }

  const Icon = mode === 'cached' ? Database : Radio;
  return (
    <button
      onClick={flip}
      title={`AI mode: ${mode}. Click to switch.`}
      className={`flex items-center gap-1.5 text-[10px] font-medium px-1.5 py-1 rounded border transition-colors ${
        mode === 'cached'
          ? 'text-amber-300 border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20'
          : 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20'
      }`}
    >
      <Icon className="w-3 h-3" />
      <span className="uppercase tracking-wide">{mode === 'cached' ? 'Cached' : 'Live'}</span>
    </button>
  );
}

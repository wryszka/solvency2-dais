/**
 * PillarChip — visual tag for Solvency II pillar metadata.
 *
 * Use semantically (pillar={1|2|3|'cross'}), not by colour name. Reused on
 * every nav item, deliverable header, dashboard tab, and AI agent output
 * card so reviewers can immediately tell which pillar an output supports.
 */
import type { ReactNode } from 'react';

export type Pillar = 1 | 2 | 3 | 'cross';

const META: Record<Pillar, { label: string; color: string; soft: string; border: string; full: string }> = {
  1: {
    label: 'P1',
    color: 'var(--color-pillar-1)',
    soft: 'var(--color-pillar-1-soft)',
    border: 'var(--color-pillar-1-border)',
    full: 'Pillar 1 — Capital',
  },
  2: {
    label: 'P2',
    color: 'var(--color-pillar-2)',
    soft: 'var(--color-pillar-2-soft)',
    border: 'var(--color-pillar-2-border)',
    full: 'Pillar 2 — Governance',
  },
  3: {
    label: 'P3',
    color: 'var(--color-pillar-3)',
    soft: 'var(--color-pillar-3-soft)',
    border: 'var(--color-pillar-3-border)',
    full: 'Pillar 3 — Disclosure',
  },
  cross: {
    label: 'Cross',
    color: 'var(--color-cross)',
    soft: 'var(--color-cross-soft)',
    border: 'var(--color-cross-border)',
    full: 'Cross-pillar',
  },
};

interface Props {
  pillar: Pillar;
  size?: 'sm' | 'md';
  /** Custom label override (defaults to "P1" / "P2" / "P3" / "Cross"). */
  label?: string;
  /** Optional tooltip. Defaults to the full pillar name. */
  tooltip?: string;
  className?: string;
  children?: ReactNode;
}

export default function PillarChip({ pillar, size = 'sm', label, tooltip, className = '', children }: Props) {
  const meta = META[pillar];
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]';
  return (
    <span
      title={tooltip ?? meta.full}
      className={`inline-flex items-center gap-1 rounded font-semibold border ${sizeClass} ${className}`}
      style={{
        color: meta.color,
        backgroundColor: meta.soft,
        borderColor: meta.border,
      }}
    >
      {children ?? label ?? meta.label}
    </span>
  );
}

export const PILLAR_META = META;

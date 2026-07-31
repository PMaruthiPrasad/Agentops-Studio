import {
  BookOpen,
  ClipboardCheck,
  Code2,
  Database,
  FlaskConical,
  Gavel,
  ListTree,
  Scale,
  Sparkles,
  Telescope,
  type LucideIcon,
} from 'lucide-react';
import { AGENT_META } from '@/lib/agents/definitions';
import type { AgentType } from '@/types/agent';
import type { ExecutionStatus, StepStatus } from '@/types/execution';

/**
 * Presentation layer for the agent taxonomy.
 *
 * `AGENT_META` names an icon and an accent as *data* (it lives in the
 * UI-agnostic lib layer); this module is where those names become React
 * components and Tailwind classes. Class strings are written out in full
 * because Tailwind's scanner cannot see through interpolation — a
 * `bg-${accent}-500` would silently never be generated.
 */

const ICONS: Record<string, LucideIcon> = {
  ListTree,
  Telescope,
  Database,
  BookOpen,
  Code2,
  ClipboardCheck,
  Scale,
  FlaskConical,
  Gavel,
  Sparkles,
};

export function getAgentIcon(type: AgentType): LucideIcon {
  return ICONS[AGENT_META[type].icon] ?? Sparkles;
}

export interface AccentClasses {
  /** Tinted chip background + matching text. */
  chip: string;
  /** Text-only accent, for titles and counts. */
  text: string;
  /** Left border / rail used on canvas nodes. */
  rail: string;
  /** Solid fill, for chart series and legends. */
  dot: string;
  /** Raw hex, for Recharts and the React Flow minimap, which need a colour value. */
  hex: string;
}

const ACCENTS: Record<string, AccentClasses> = {
  violet: {
    chip: 'bg-violet-500/15 text-violet-400',
    text: 'text-violet-400',
    rail: 'bg-violet-500',
    dot: 'bg-violet-500',
    hex: '#a78bfa',
  },
  sky: {
    chip: 'bg-sky-500/15 text-sky-400',
    text: 'text-sky-400',
    rail: 'bg-sky-500',
    dot: 'bg-sky-500',
    hex: '#38bdf8',
  },
  cyan: {
    chip: 'bg-cyan-500/15 text-cyan-400',
    text: 'text-cyan-400',
    rail: 'bg-cyan-500',
    dot: 'bg-cyan-500',
    hex: '#22d3ee',
  },
  teal: {
    chip: 'bg-teal-500/15 text-teal-400',
    text: 'text-teal-400',
    rail: 'bg-teal-500',
    dot: 'bg-teal-500',
    hex: '#2dd4bf',
  },
  emerald: {
    chip: 'bg-emerald-500/15 text-emerald-400',
    text: 'text-emerald-400',
    rail: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    hex: '#34d399',
  },
  amber: {
    chip: 'bg-amber-500/15 text-amber-400',
    text: 'text-amber-400',
    rail: 'bg-amber-500',
    dot: 'bg-amber-500',
    hex: '#fbbf24',
  },
  orange: {
    chip: 'bg-orange-500/15 text-orange-400',
    text: 'text-orange-400',
    rail: 'bg-orange-500',
    dot: 'bg-orange-500',
    hex: '#fb923c',
  },
  lime: {
    chip: 'bg-lime-500/15 text-lime-400',
    text: 'text-lime-400',
    rail: 'bg-lime-500',
    dot: 'bg-lime-500',
    hex: '#a3e635',
  },
  rose: {
    chip: 'bg-rose-500/15 text-rose-400',
    text: 'text-rose-400',
    rail: 'bg-rose-500',
    dot: 'bg-rose-500',
    hex: '#fb7185',
  },
  slate: {
    chip: 'bg-slate-500/15 text-slate-400',
    text: 'text-slate-400',
    rail: 'bg-slate-500',
    dot: 'bg-slate-500',
    hex: '#94a3b8',
  },
};

const FALLBACK_ACCENT: AccentClasses = ACCENTS.slate as AccentClasses;

export function getAgentAccent(type: AgentType): AccentClasses {
  return ACCENTS[AGENT_META[type].accent] ?? FALLBACK_ACCENT;
}

export function getAgentColorHex(type: AgentType): string {
  return getAgentAccent(type).hex;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export type StatusTone = 'success' | 'warning' | 'info' | 'destructive' | 'muted';

export const EXECUTION_STATUS_TONE: Record<ExecutionStatus, StatusTone> = {
  pending: 'muted',
  running: 'info',
  success: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'muted',
};

export const STEP_STATUS_TONE: Record<StepStatus, StatusTone> = {
  pending: 'muted',
  running: 'info',
  success: 'success',
  failed: 'destructive',
  skipped: 'muted',
  cancelled: 'muted',
};

/** Hex per tone, for charts that cannot read CSS variables. */
export const TONE_HEX: Record<StatusTone, string> = {
  success: '#34d399',
  warning: '#fbbf24',
  info: '#38bdf8',
  destructive: '#f87171',
  muted: '#94a3b8',
};

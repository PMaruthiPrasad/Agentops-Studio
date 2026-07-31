'use client';

import { useMemo } from 'react';
import { Hint } from '@/components/ui/tooltip';
import { getAgentAccent } from '@/lib/agent-ui';
import { cn, formatCost, formatDuration } from '@/lib/utils';
import type { ExecutionStep } from '@/types/execution';

/**
 * Gantt view of a run.
 *
 * Bars are positioned on the real wall clock, so steps that ran concurrently
 * visibly overlap. That overlap *is* the parallelisation story — a bar chart of
 * durations would hide exactly the thing worth seeing.
 */
export function ExecutionTimeline({
  steps,
  startedAt,
  totalDurationMs,
}: {
  steps: ExecutionStep[];
  startedAt: string;
  totalDurationMs: number;
}) {
  const rows = useMemo(() => {
    const origin = new Date(startedAt).getTime();
    // Guard against a zero-width scale on an instant run.
    const span = Math.max(totalDurationMs, 1);

    return steps.map((step) => {
      const start = step.startedAt ? new Date(step.startedAt).getTime() - origin : 0;
      const offsetPct = Math.max(0, Math.min(100, (start / span) * 100));
      // Floor the width so a very fast step is still visible as a sliver.
      const widthPct = Math.max(1.5, Math.min(100 - offsetPct, (step.durationMs / span) * 100));

      return { step, offsetPct, widthPct };
    });
  }, [steps, startedAt, totalDurationMs]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {rows.map(({ step, offsetPct, widthPct }) => {
        const accent = getAgentAccent(step.agentType);

        return (
          <div key={step.id} className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate text-xs" title={step.label}>
              <span className="text-muted-foreground">L{step.layer}</span>{' '}
              <span>{step.label}</span>
            </div>

            <div className="relative h-6 flex-1 overflow-hidden rounded bg-muted/50">
              <Hint
                label={
                  <div className="space-y-0.5">
                    <p className="font-medium">{step.label}</p>
                    <p className="tabular text-muted-foreground">
                      {formatDuration(step.durationMs)} · {formatCost(step.costUsd)} ·{' '}
                      {step.status}
                    </p>
                    <p className="text-muted-foreground">
                      starts at +{formatDuration((offsetPct / 100) * totalDurationMs)}
                    </p>
                  </div>
                }
              >
                <div
                  style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                  className={cn(
                    'absolute inset-y-0 rounded transition-opacity hover:opacity-90',
                    step.status === 'failed'
                      ? 'bg-destructive'
                      : step.status === 'skipped'
                        ? 'bg-muted-foreground/40'
                        : accent.dot,
                  )}
                />
              </Hint>
            </div>

            <span className="tabular w-16 shrink-0 text-right text-xs text-muted-foreground">
              {formatDuration(step.durationMs)}
            </span>
          </div>
        );
      })}

      <div className="flex items-center gap-3 pt-1">
        <div className="w-40 shrink-0" />
        <div className="tabular flex flex-1 justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span>{formatDuration(totalDurationMs / 2)}</span>
          <span>{formatDuration(totalDurationMs)}</span>
        </div>
        <div className="w-16 shrink-0" />
      </div>
    </div>
  );
}

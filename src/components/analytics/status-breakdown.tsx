'use client';

import { StatusBadge } from '@/components/shared/status-badge';
import { ChartShell } from './chart-shell';
import { useChartTheme } from '@/lib/chart-theme';
import { formatNumber, formatPercent } from '@/lib/utils';
import type { ExecutionStatus } from '@/types/execution';

interface StatusBreakdownProps {
  breakdown: Array<{ status: ExecutionStatus; count: number }>;
  refreshing?: boolean;
}

/**
 * Run outcomes.
 *
 * A labelled bar list rather than a pie: these values are usually close
 * together and dominated by one slice, which is exactly where a pie stops being
 * readable. Status colour is reinforced by the badge's icon and text, so the
 * meaning never rests on hue alone.
 */
export function StatusBreakdown({ breakdown, refreshing }: StatusBreakdownProps) {
  const theme = useChartTheme();
  const total = breakdown.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <ChartShell
      title="Run outcomes"
      description="Every execution recorded in this window, by final status."
      refreshing={refreshing}
    >
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No runs recorded yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {breakdown.map((entry) => {
            const share = entry.count / total;

            return (
              <li key={entry.status} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={entry.status} />
                  <span className="tabular text-xs text-muted-foreground">
                    {formatNumber(entry.count)} · {formatPercent(share, 1)}
                  </span>
                </div>

                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${entry.status}: ${entry.count} of ${total} runs`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%`,
                      backgroundColor: theme.status[entry.status],
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChartShell>
  );
}

'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cn,
  formatCost,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  truncate,
} from '@/lib/utils';
import type { ExecutionSummary } from '@/types/execution';

interface ExecutionTableProps {
  executions: ExecutionSummary[];
  loading?: boolean;
  /** Hide the workflow column when the table already sits under one workflow. */
  hideWorkflow?: boolean;
  className?: string;
}

/**
 * Run history.
 *
 * A real table rather than a card grid: these rows exist to be compared
 * column-by-column, and every number is tabular-aligned so scanning down a
 * column actually works.
 */
export function ExecutionTable({
  executions,
  loading = false,
  hideWorkflow = false,
  className,
}: ExecutionTableProps) {
  if (loading) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-12" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border', className)}>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
              Status
            </th>
            {hideWorkflow ? null : (
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                Workflow
              </th>
            )}
            <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
              Task
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">
              Duration
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">
              Tokens
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">
              Cost
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">
              Confidence
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">
              Started
            </th>
            <th scope="col" className="w-8 px-3 py-2">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {executions.map((execution) => (
            <tr
              key={execution.id}
              className="group relative border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40"
            >
              <td className="px-3 py-2.5">
                <StatusBadge status={execution.status} />
              </td>

              {hideWorkflow ? null : (
                <td className="relative z-10 max-w-[180px] px-3 py-2.5">
                  {/* Raised above the row overlay: this is the one place in the
                      row that deliberately goes somewhere other than the run. */}
                  <Link
                    href={`/workflows/${execution.workflowId}`}
                    className="inline-block max-w-full truncate font-medium hover:text-primary"
                  >
                    {execution.workflowName}
                  </Link>
                </td>
              )}

              <td className="max-w-[280px] px-3 py-2.5 text-muted-foreground">
                {/* The row's primary target. `after:` stretches its hit area over
                    the whole row so cost, duration and empty space all open the
                    report — clicking a run should never be a game of pixel golf. */}
                <Link
                  href={`/executions/${execution.id}`}
                  className="block truncate after:absolute after:inset-0 after:content-['']"
                >
                  {truncate(execution.task, 90)}
                </Link>
              </td>

              <td className="tabular px-3 py-2.5 text-right">
                {formatDuration(execution.durationMs)}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-muted-foreground">
                {formatTokens(execution.totalTokens)}
              </td>
              <td className="tabular px-3 py-2.5 text-right">
                {formatCost(execution.totalCostUsd)}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-muted-foreground">
                {formatPercent(execution.averageConfidence)}
              </td>
              <td className="px-3 py-2.5 text-right text-muted-foreground">
                {formatRelativeTime(execution.startedAt)}
              </td>

              <td className="px-3 py-2.5">
                {/* Purely an affordance now — the row itself is the link, so a
                    second anchor here would only add a duplicate tab stop. */}
                <ChevronRight
                  className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

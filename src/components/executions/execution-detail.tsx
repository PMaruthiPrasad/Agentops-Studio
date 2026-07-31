'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  CircleDollarSign,
  GitFork,
  Layers,
  Timer,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatCard } from '@/components/shared/stat-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useExecution } from '@/hooks/use-resources';
import { deleteExecution } from '@/lib/workflow-actions';
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
  toErrorMessage,
} from '@/lib/utils';
import { ExecutionTimeline } from './execution-timeline';
import { StepCard } from './step-card';

/**
 * The full report for one run.
 *
 * Everything shown here was recorded at execution time rather than recomputed —
 * a run's cost is what it cost then, even if the agent's pricing has since
 * changed.
 */
export function ExecutionDetail({ executionId }: { executionId: string }) {
  const router = useRouter();
  const { data: execution, loading, error } = useExecution(executionId);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    if (!window.confirm('Delete this execution and all of its steps?')) return;

    setDeleting(true);
    try {
      await deleteExecution(executionId);
      toast.success('Execution deleted.');
      router.push('/executions');
    } catch (cause) {
      toast.error(toErrorMessage(cause));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load this execution.</p>
          <p className="mt-1 text-muted-foreground">{error ?? 'It may have been deleted.'}</p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link href="/executions">Back to executions</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { metrics } = execution;
  // Failures first: on a broken run that is the only step anyone wants.
  const failedSteps = execution.steps.filter((step) => step.status === 'failed');

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" asChild aria-label="Back to executions">
              <Link href="/executions">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <StatusBadge status={execution.status} />
            <Link
              href={`/workflows/${execution.workflowId}`}
              className="text-sm font-medium hover:text-primary"
            >
              {execution.workflowName}
            </Link>
          </div>

          <p className="max-w-3xl text-sm text-muted-foreground">{execution.task}</p>
          <p className="tabular font-mono text-[11px] text-muted-foreground">{execution.id}</p>
        </div>

        <Button variant="outline" size="sm" onClick={() => void onDelete()} loading={deleting}>
          <Trash2 />
          Delete
        </Button>
      </div>

      {execution.error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Run error</p>
          <p className="mt-1 text-sm text-muted-foreground">{execution.error}</p>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Wall clock"
          value={formatDuration(metrics.totalDurationMs)}
          hint={`${formatDuration(metrics.totalAgentTimeMs)} of agent time`}
          icon={Timer}
        />
        <StatCard
          label="Cost"
          value={formatCost(metrics.totalCostUsd)}
          hint={`${formatTokens(metrics.totalTokens)} tokens`}
          icon={CircleDollarSign}
          accentClassName="text-success"
        />
        <StatCard
          label="Success rate"
          value={formatPercent(metrics.successRate)}
          hint={`${metrics.executedCount} ran · ${metrics.failedCount} failed · ${metrics.skippedCount} skipped`}
          icon={TrendingUp}
          accentClassName="text-info"
        />
        <StatCard
          label="Parallelization"
          value={formatPercent(metrics.parallelizationScore)}
          hint={`${metrics.layerCount} layers · ${metrics.retryCount} retries`}
          icon={GitFork}
          accentClassName="text-warning"
        />
      </div>

      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="steps">
            <Layers />
            Steps ({execution.steps.length})
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <Timer />
            Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="space-y-2">
          {execution.steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              // Auto-expand a failure — that is what the reader came for.
              defaultOpen={step.status === 'failed' && failedSteps.length <= 2}
            />
          ))}
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Execution timeline</CardTitle>
              <p className="text-xs text-muted-foreground">
                Bars sit on the real clock — overlapping bars ran in parallel.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <div className="min-w-[600px]">
                <ExecutionTimeline
                  steps={execution.steps}
                  startedAt={execution.startedAt}
                  totalDurationMs={metrics.totalDurationMs}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

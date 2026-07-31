'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Boxes,
  CircleDollarSign,
  Clock,
  Plus,
  Timer,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useState } from 'react';
import { StatCard } from '@/components/shared/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ExecutionTable } from '@/components/executions/execution-table';
import { CreateWorkflowDialog } from '@/components/workflows/create-workflow-dialog';
import { WorkflowCard } from '@/components/workflows/workflow-card';
import { useAnalytics, useWorkflows } from '@/hooks/use-resources';
import { formatCost, formatDuration, formatNumber, formatPercent } from '@/lib/utils';

/**
 * Landing view: the four numbers worth knowing, the workflows you touched most
 * recently, and the last runs. Everything here links somewhere — the dashboard
 * is a jumping-off point, not a destination.
 */
export function DashboardView() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: analytics, loading: analyticsLoading } = useAnalytics(30);
  const { data: workflows, loading: workflowsLoading, refresh } = useWorkflows();

  const overview = analytics?.overview;
  const recent = workflows?.slice(0, 3) ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Agent workflow activity across the last 30 days.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          New workflow
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Workflows"
          value={formatNumber(overview?.workflowCount ?? 0)}
          hint={`${formatNumber(overview?.averageAgentCount ?? 0)} agents on average`}
          icon={WorkflowIcon}
          loading={analyticsLoading}
        />
        <StatCard
          label="Executions"
          value={formatNumber(overview?.executionCount ?? 0)}
          hint={`${formatPercent(overview?.successRate ?? 0)} success rate`}
          icon={Boxes}
          accentClassName="text-info"
          loading={analyticsLoading}
        />
        <StatCard
          label="Avg latency"
          value={formatDuration(overview?.averageLatencyMs ?? 0)}
          hint={`${formatPercent(overview?.averageParallelization ?? 0)} parallelized`}
          icon={Timer}
          accentClassName="text-warning"
          loading={analyticsLoading}
        />
        <StatCard
          label="Total cost"
          value={formatCost(overview?.totalCostUsd ?? 0)}
          hint={`${formatCost(overview?.averageCostUsd ?? 0)} per run`}
          icon={CircleDollarSign}
          accentClassName="text-success"
          loading={analyticsLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              Recent runs
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/executions">
                View all
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <ExecutionTable executions={[]} loading />
            ) : analytics && analytics.recentExecutions.length > 0 ? (
              <ExecutionTable executions={analytics.recentExecutions.slice(0, 6)} />
            ) : (
              <EmptyState
                icon={Activity}
                title="No runs yet"
                description="Open a workflow and execute it — every step is recorded here."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <WorkflowIcon className="size-4 text-muted-foreground" />
              Recent workflows
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/workflows">
                View all
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {workflowsLoading ? (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-32" />)
            ) : recent.length > 0 ? (
              recent.map((workflow) => (
                <WorkflowCard key={workflow.id} workflow={workflow} onChanged={refresh} />
              ))
            ) : (
              <EmptyState
                icon={WorkflowIcon}
                title="No workflows"
                description="Run `npm run db:seed` for three worked examples."
                className="py-10"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <CreateWorkflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

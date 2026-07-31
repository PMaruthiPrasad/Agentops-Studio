'use client';

import { useState } from 'react';
import {
  BarChart3,
  Brain,
  CircleDollarSign,
  GitFork,
  Table2,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { StatCard } from '@/components/shared/stat-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ExecutionTable } from '@/components/executions/execution-table';
import { AgentPerformanceChart } from './agent-performance-chart';
import { StatusBreakdown } from './status-breakdown';
import { TimelineChart } from './timeline-chart';
import { useAnalytics } from '@/hooks/use-resources';
import {
  formatCost,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTokens,
} from '@/lib/utils';

const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
];

/**
 * Analytics.
 *
 * One filter row scopes every chart below it — no per-chart controls — and a
 * single view toggle swaps all charts for their table equivalents, so every
 * number is reachable without relying on colour or hover.
 */
export function AnalyticsView() {
  const [days, setDays] = useState('30');
  const [asTable, setAsTable] = useState(false);

  const { data, loading, error, refreshing } = useAnalytics(Number(days));

  const overview = data?.overview;

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load analytics.</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Cost, latency, and reliability across every recorded run.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[150px]" aria-label="Time window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((window) => (
                <SelectItem key={window.value} value={window.value}>
                  {window.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setAsTable((value) => !value)}
            aria-pressed={asTable}
          >
            {asTable ? <BarChart3 /> : <Table2 />}
            {asTable ? 'Charts' : 'Tables'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Avg latency"
          value={formatDuration(overview?.averageLatencyMs ?? 0)}
          hint={`${formatNumber(overview?.executionCount ?? 0)} runs`}
          icon={Timer}
          loading={loading}
        />
        <StatCard
          label="Total cost"
          value={formatCost(overview?.totalCostUsd ?? 0)}
          hint={`${formatTokens(overview?.totalTokens ?? 0)} tokens`}
          icon={CircleDollarSign}
          accentClassName="text-success"
          loading={loading}
        />
        <StatCard
          label="Success rate"
          value={formatPercent(overview?.successRate ?? 0)}
          hint={`${formatPercent(overview?.averageConfidence ?? 0)} mean confidence`}
          icon={TrendingUp}
          accentClassName="text-info"
          loading={loading}
        />
        <StatCard
          label="Parallelization"
          value={formatPercent(overview?.averageParallelization ?? 0)}
          hint={`complexity ${formatPercent(overview?.averageComplexity ?? 0)}`}
          icon={GitFork}
          accentClassName="text-warning"
          loading={loading}
        />
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      ) : data ? (
        <>
          <TimelineChart timeline={data.timeline} refreshing={refreshing} asTable={asTable} />

          <div className="grid gap-4 lg:grid-cols-2">
            <AgentPerformanceChart
              agents={data.agents}
              metric="latency"
              refreshing={refreshing}
              asTable={asTable}
            />
            <AgentPerformanceChart
              agents={data.agents}
              metric="cost"
              refreshing={refreshing}
              asTable={asTable}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <StatusBreakdown breakdown={data.statusBreakdown} refreshing={refreshing} />

            <Card className="lg:col-span-2">
              <div className="flex items-center gap-2 p-5 pb-3">
                <Brain className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Recent runs</h2>
              </div>
              <div className="px-5 pb-5">
                <ExecutionTable executions={data.recentExecutions.slice(0, 8)} />
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

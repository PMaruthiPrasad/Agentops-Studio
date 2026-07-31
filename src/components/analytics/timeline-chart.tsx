'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartShell } from './chart-shell';
import { TooltipCard } from './chart-tooltip';
import { useChartTheme } from '@/lib/chart-theme';
import { cn, formatCost, formatDuration, formatNumber, formatPercent, formatTokens } from '@/lib/utils';
import type { TimelinePoint } from '@/types/execution';

type MetricKey = 'executions' | 'averageLatencyMs' | 'totalCostUsd' | 'totalTokens';

interface MetricConfig {
  key: MetricKey;
  label: string;
  /** Categorical slot — fixed per metric, so switching never repaints a hue onto different data. */
  slot: number;
  format: (value: number) => string;
}

const METRICS: MetricConfig[] = [
  { key: 'executions', label: 'Executions', slot: 0, format: formatNumber },
  { key: 'averageLatencyMs', label: 'Latency', slot: 1, format: formatDuration },
  { key: 'totalCostUsd', label: 'Cost', slot: 2, format: formatCost },
  { key: 'totalTokens', label: 'Tokens', slot: 3, format: formatTokens },
];

/**
 * Activity over time.
 *
 * One metric at a time on one axis. Runs, latency, cost, and tokens differ by
 * orders of magnitude, and overlaying them on two y-scales would invent a
 * correlation that isn't in the data — so this is a toggle, not a dual axis.
 */
export function TimelineChart({
  timeline,
  refreshing,
  asTable = false,
}: {
  timeline: TimelinePoint[];
  refreshing?: boolean;
  asTable?: boolean;
}) {
  const theme = useChartTheme();
  const [metricKey, setMetricKey] = useState<MetricKey>('executions');

  const metric = METRICS.find((entry) => entry.key === metricKey) ?? METRICS[0]!;
  const color = theme.series[metric.slot] ?? theme.series[0] ?? '#3987e5';

  const toggle = (
    <div role="tablist" aria-label="Metric" className="flex flex-wrap gap-1">
      {METRICS.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="tab"
          aria-selected={entry.key === metricKey}
          onClick={() => setMetricKey(entry.key)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium transition-colors',
            entry.key === metricKey
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  if (timeline.length === 0) {
    return (
      <ChartShell
        title="Activity over time"
        description="Daily totals across the selected window."
        action={toggle}
        refreshing={refreshing}
      >
        <p className="py-10 text-center text-sm text-muted-foreground">
          No runs in this window yet.
        </p>
      </ChartShell>
    );
  }

  if (asTable) {
    return (
      <ChartShell
        title="Activity over time"
        description="Daily totals across the selected window."
        refreshing={refreshing}
      >
        <div className="scrollbar-thin max-h-80 overflow-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 pr-3 font-medium text-muted-foreground">
                  Date
                </th>
                {METRICS.map((entry) => (
                  <th
                    key={entry.key}
                    scope="col"
                    className="py-1.5 pr-3 text-right font-medium text-muted-foreground"
                  >
                    {entry.label}
                  </th>
                ))}
                <th scope="col" className="py-1.5 text-right font-medium text-muted-foreground">
                  Success
                </th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((point) => (
                <tr key={point.date} className="border-b border-border/60 last:border-0">
                  <td className="tabular py-1.5 pr-3">{point.date}</td>
                  {METRICS.map((entry) => (
                    <td key={entry.key} className="tabular py-1.5 pr-3 text-right">
                      {entry.format(point[entry.key])}
                    </td>
                  ))}
                  <td className="tabular py-1.5 text-right">{formatPercent(point.successRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell
      title="Activity over time"
      description="Daily totals across the selected window."
      action={toggle}
      refreshing={refreshing}
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={timeline} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id={`fill-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke={theme.grid} strokeDasharray="0" strokeWidth={1} />

          <XAxis
            dataKey="date"
            tick={{ fill: theme.label, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
            minTickGap={24}
            tickFormatter={(value: string) => value.slice(5)}
          />
          <YAxis
            tick={{ fill: theme.label, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={metric.format}
          />

          <Tooltip
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as TimelinePoint | undefined;
              if (!point) return null;

              return (
                <TooltipCard
                  title={point.date}
                  rows={[
                    { label: 'Executions', value: formatNumber(point.executions), color },
                    { label: 'Avg latency', value: formatDuration(point.averageLatencyMs) },
                    { label: 'Cost', value: formatCost(point.totalCostUsd) },
                    { label: 'Tokens', value: formatTokens(point.totalTokens) },
                    { label: 'Success', value: formatPercent(point.successRate) },
                  ]}
                />
              );
            }}
          />

          <Area
            type="monotone"
            dataKey={metric.key}
            stroke={color}
            strokeWidth={2}
            fill={`url(#fill-${metric.key})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

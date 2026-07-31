'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartShell } from './chart-shell';
import { makeTooltip } from './chart-tooltip';
import { useChartTheme } from '@/lib/chart-theme';
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
  truncate,
} from '@/lib/utils';
import type { AgentPerformance } from '@/types/execution';

type Metric = 'latency' | 'cost';

interface AgentPerformanceChartProps {
  agents: AgentPerformance[];
  metric: Metric;
  refreshing?: boolean;
  /** Render the numbers as a table instead of a plot. */
  asTable?: boolean;
}

const CONFIG = {
  latency: {
    title: 'Latency by agent',
    description: 'Mean wall-clock time per invocation, slowest first.',
    // Single measure across nominal categories: one series, one colour. Shading
    // each bar by its own value would double-encode length as hue.
    slot: 0,
    format: (agent: AgentPerformance) => formatDuration(agent.averageLatencyMs),
    value: (agent: AgentPerformance) => agent.averageLatencyMs,
  },
  cost: {
    title: 'Cost by agent',
    description: 'Total spend attributed to each agent across all runs.',
    slot: 1,
    format: (agent: AgentPerformance) => formatCost(agent.totalCostUsd),
    value: (agent: AgentPerformance) => agent.totalCostUsd,
  },
} as const;

export function AgentPerformanceChart({
  agents,
  metric,
  refreshing,
  asTable = false,
}: AgentPerformanceChartProps) {
  const theme = useChartTheme();
  const config = CONFIG[metric];
  const color = theme.series[config.slot] ?? theme.series[0] ?? '#3987e5';

  const data = [...agents]
    .map((agent) => ({ ...agent, metricValue: config.value(agent) }))
    .sort((a, b) => b.metricValue - a.metricValue);

  const ChartTooltip = makeTooltip<(typeof data)[number]>(
    (datum) => datum.label,
    (datum) => [
      { label: 'Runs', value: String(datum.runs) },
      { label: 'Avg latency', value: formatDuration(datum.averageLatencyMs) },
      { label: 'Total cost', value: formatCost(datum.totalCostUsd) },
      { label: 'Tokens', value: formatTokens(datum.totalTokens) },
      { label: 'Success', value: formatPercent(datum.successRate) },
      { label: 'Confidence', value: formatPercent(datum.averageConfidence) },
    ],
  );

  if (data.length === 0) {
    return (
      <ChartShell title={config.title} description={config.description} refreshing={refreshing}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          No agent runs recorded yet.
        </p>
      </ChartShell>
    );
  }

  if (asTable) {
    return (
      <ChartShell title={config.title} description={config.description} refreshing={refreshing}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 pr-3 font-medium text-muted-foreground">
                  Agent
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium text-muted-foreground">
                  Runs
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium text-muted-foreground">
                  Avg latency
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium text-muted-foreground">
                  Total cost
                </th>
                <th scope="col" className="py-1.5 text-right font-medium text-muted-foreground">
                  Success
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((agent) => (
                <tr key={agent.agentType} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">{agent.label}</td>
                  <td className="tabular py-1.5 pr-3 text-right">{agent.runs}</td>
                  <td className="tabular py-1.5 pr-3 text-right">
                    {formatDuration(agent.averageLatencyMs)}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right">
                    {formatCost(agent.totalCostUsd)}
                  </td>
                  <td className="tabular py-1.5 text-right">{formatPercent(agent.successRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell title={config.title} description={config.description} refreshing={refreshing}>
      {/* Height scales with the row count so labels never crowd. */}
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34 + 28)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
          <CartesianGrid
            horizontal={false}
            stroke={theme.grid}
            strokeDasharray="0"
            strokeWidth={1}
          />
          <XAxis
            type="number"
            tick={{ fill: theme.label, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
            tickFormatter={(value: number) =>
              metric === 'latency' ? formatDuration(value) : formatCost(value)
            }
          />
          <YAxis
            type="category"
            dataKey="label"
            width={104}
            tick={{ fill: theme.label, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) => truncate(value, 16)}
          />
          <Tooltip
            content={ChartTooltip}
            cursor={{ fill: theme.grid, fillOpacity: 0.35 }}
          />
          <Bar
            dataKey="metricValue"
            fill={color}
            radius={[0, 4, 4, 0]}
            barSize={14}
            isAnimationActive={false}
            // Direct labels on every bar: the light-mode palette has slots below
            // 3:1 on white, and the relief rule requires visible values.
            label={{
              position: 'right',
              fill: theme.label,
              fontSize: 10,
              formatter: (value: number) =>
                metric === 'latency' ? formatDuration(value) : formatCost(value),
            }}
          >
            {data.map((agent) => (
              <Cell key={agent.agentType} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

'use client';

import type { TooltipProps } from 'recharts';

interface Row {
  label: string;
  value: string;
  color?: string;
}

/**
 * Shared tooltip body.
 *
 * Tooltips enhance and never gate: every value here is also reachable from the
 * axis, a direct label, or the table view.
 */
export function TooltipCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            {row.color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.color }}
              />
            ) : null}
            <span className="text-muted-foreground">{row.label}</span>
            <span className="tabular ml-auto font-medium">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Adapts Recharts' payload into `TooltipCard`.
 *
 * `formatValue` receives the raw datum so a tooltip can show units the axis
 * doesn't repeat.
 */
export function makeTooltip<T extends Record<string, unknown>>(
  titleOf: (datum: T) => string,
  rowsOf: (datum: T) => Row[],
) {
  return function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload || payload.length === 0) return null;

    const datum = payload[0]?.payload as T | undefined;
    if (!datum) return null;

    return <TooltipCard title={titleOf(datum)} rows={rowsOf(datum)} />;
  };
}

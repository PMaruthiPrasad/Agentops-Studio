'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ChartShellProps {
  title: string;
  description?: string;
  /** Rendered on the title row — a metric toggle, a legend, a unit note. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Dims rather than unmounting during a refetch, so nothing jumps. */
  refreshing?: boolean;
  className?: string;
}

/**
 * Consistent frame for every chart.
 *
 * The container grows with its content rather than fixing a height, so an
 * x-axis band can never be clipped into a nested scrollbar.
 */
export function ChartShell({
  title,
  description,
  action,
  children,
  refreshing = false,
  className,
}: ChartShellProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </CardHeader>

      <CardContent
        className={cn('transition-opacity', refreshing && 'opacity-60')}
        aria-busy={refreshing}
      >
        {children}
      </CardContent>
    </Card>
  );
}

/** Legend row. Present whenever a chart draws two or more series. */
export function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

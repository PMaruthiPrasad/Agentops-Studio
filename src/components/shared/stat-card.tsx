import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Short qualifier under the number — units, sample size, or a trend. */
  hint?: string;
  accentClassName?: string;
  loading?: boolean;
}

/**
 * A single metric tile. The number is the loudest thing on the card; the label
 * and hint stay quiet so a row of these scans as data rather than as chrome.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  accentClassName = 'text-primary',
  loading = false,
}: StatCardProps) {
  return (
    <Card className="p-4 transition-colors hover:border-border/80 hover:bg-accent/30">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className={cn('size-4 shrink-0', accentClassName)} aria-hidden />
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      )}

      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

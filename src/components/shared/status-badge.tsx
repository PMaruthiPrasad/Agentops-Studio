import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MinusCircle,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EXECUTION_STATUS_TONE, STEP_STATUS_TONE } from '@/lib/agent-ui';
import { cn, titleCase } from '@/lib/utils';
import type { ExecutionStatus, StepStatus } from '@/types/execution';

const ICONS: Record<string, LucideIcon> = {
  pending: CircleDashed,
  running: Loader2,
  success: CheckCircle2,
  partial: TriangleAlert,
  failed: XCircle,
  skipped: MinusCircle,
  cancelled: Ban,
};

const VARIANT = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  destructive: 'destructive',
  muted: 'muted',
} as const;

interface StatusBadgeProps {
  status: ExecutionStatus | StepStatus;
  className?: string;
  /** Hide the label and show only the icon — used in dense table rows. */
  iconOnly?: boolean;
}

/**
 * One component for both run status and step status. The two enums overlap but
 * are not identical, so the tone lookup falls through from one map to the other.
 */
export function StatusBadge({ status, className, iconOnly = false }: StatusBadgeProps) {
  const tone =
    EXECUTION_STATUS_TONE[status as ExecutionStatus] ??
    STEP_STATUS_TONE[status as StepStatus] ??
    'muted';

  const Icon = ICONS[status] ?? CircleDashed;

  return (
    <Badge variant={VARIANT[tone]} className={cn('capitalize', className)}>
      <Icon className={cn('size-3', status === 'running' && 'animate-spin')} aria-hidden />
      {iconOnly ? <span className="sr-only">{titleCase(status)}</span> : titleCase(status)}
    </Badge>
  );
}

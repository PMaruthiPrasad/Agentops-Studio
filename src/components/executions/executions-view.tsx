'use client';

import { useState } from 'react';
import { Boxes, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExecutionTable } from './execution-table';
import { useExecutions } from '@/hooks/use-resources';
import { EXECUTION_STATUSES, type ExecutionStatus } from '@/types/execution';
import { titleCase } from '@/lib/utils';

const ALL = 'all';

export function ExecutionsView() {
  const [status, setStatus] = useState<ExecutionStatus | typeof ALL>(ALL);

  const { data, loading, error, refresh, refreshing } = useExecutions({
    status: status === ALL ? undefined : status,
    limit: 100,
  });

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Executions</h1>
          <p className="text-sm text-muted-foreground">
            Every run, with the metrics recorded at the time it happened.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as ExecutionStatus | typeof ALL)}
          >
            <SelectTrigger className="w-[150px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {EXECUTION_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {titleCase(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={refresh} loading={refreshing}>
            <RotateCw />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load executions.</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </Card>
      ) : loading || (data && data.length > 0) ? (
        <ExecutionTable executions={data ?? []} loading={loading} />
      ) : (
        <EmptyState
          icon={Boxes}
          title={status === ALL ? 'No executions yet' : `No ${status} executions`}
          description="Open a workflow, describe a task, and hit Run — the results land here."
        />
      )}
    </div>
  );
}

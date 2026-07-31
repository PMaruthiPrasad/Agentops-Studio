'use client';

import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkflowVersions } from '@/hooks/use-resources';
import { restoreVersion } from '@/lib/workflow-actions';
import { useBuilderStore } from '@/stores/builder-store';
import { formatRelativeTime, toErrorMessage } from '@/lib/utils';

interface VersionHistoryProps {
  workflowId: string;
  onRestored: () => void;
}

/**
 * Snapshot history.
 *
 * Restoring appends a new version rather than rewinding — the API is
 * append-only — so a restore is itself undoable and no history is ever
 * destroyed by clicking the wrong row.
 */
export function VersionHistory({ workflowId, onRestored }: VersionHistoryProps) {
  const { data, loading, refresh } = useWorkflowVersions(workflowId);
  const currentVersion = useBuilderStore((state) => state.version);
  const dirty = useBuilderStore((state) => state.dirty);
  const load = useBuilderStore((state) => state.load);

  const [restoring, setRestoring] = useState<number | null>(null);

  async function onRestore(version: number) {
    if (
      dirty &&
      !window.confirm('Restoring will discard the unsaved edits on the canvas. Continue?')
    ) {
      return;
    }

    setRestoring(version);
    try {
      const workflow = await restoreVersion(workflowId, version);
      load(workflow);
      toast.success(`Restored v${version}.`, {
        description: `Saved as v${workflow.version} — history is append-only.`,
      });
      refresh();
      onRestored();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setRestoring(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No versions yet"
        description="A snapshot is cut every time the graph structure changes."
        className="m-3"
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <ol className="space-y-1.5 p-3">
        {data.map((version) => {
          const isCurrent = version.version === currentVersion;

          return (
            <li
              key={version.id}
              className="group rounded-md border border-border p-2.5 transition-colors hover:bg-accent/30"
            >
              <div className="flex items-center gap-2">
                <Badge variant={isCurrent ? 'default' : 'outline'} className="shrink-0">
                  v{version.version}
                </Badge>
                <p className="min-w-0 flex-1 truncate text-xs">{version.message}</p>
                {isCurrent ? null : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    loading={restoring === version.version}
                    onClick={() => void onRestore(version.version)}
                    aria-label={`Restore version ${version.version}`}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                )}
              </div>

              <p className="tabular mt-1 text-[10px] text-muted-foreground">
                {version.nodeCount} nodes · {version.edgeCount} edges ·{' '}
                {formatRelativeTime(version.createdAt)}
              </p>
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}

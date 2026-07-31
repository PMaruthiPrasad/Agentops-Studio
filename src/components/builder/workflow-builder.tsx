'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Boxes, History, PanelRight, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBoundary } from '@/components/shared/error-boundary';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useExecutionStream } from '@/hooks/use-execution-stream';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useWorkflow } from '@/hooks/use-resources';
import { saveWorkflow, startExecution } from '@/lib/workflow-actions';
import { toErrorMessage } from '@/lib/utils';
import { useBuilderStore } from '@/stores/builder-store';
import { AgentPalette } from './agent-palette';
import { BuilderToolbar } from './builder-toolbar';
import { Canvas } from './canvas';
import { Inspector } from './inspector';
import { OptimizerPanel } from './optimizer-panel';
import { RunPanel } from './run-panel';
import { VersionHistory } from './version-history';

/**
 * The builder page.
 *
 * Owns the pieces that several panels share — the loaded workflow, the live
 * execution stream, and the keyboard map — and hands them down. The canvas, the
 * optimizer, and the run panel all read the graph from the store rather than
 * from each other.
 */
export function WorkflowBuilder({ workflowId }: { workflowId: string }) {
  const { data: workflow, loading, error, refresh } = useWorkflow(workflowId);

  const load = useBuilderStore((state) => state.load);
  const markSaved = useBuilderStore((state) => state.markSaved);
  const reset = useBuilderStore((state) => state.reset);
  const dirty = useBuilderStore((state) => state.dirty);
  const undo = useBuilderStore((state) => state.undo);
  const redo = useBuilderStore((state) => state.redo);
  const duplicateNode = useBuilderStore((state) => state.duplicateNode);
  const removeNodes = useBuilderStore((state) => state.removeNodes);
  const removeEdges = useBuilderStore((state) => state.removeEdges);
  const addNode = useBuilderStore((state) => state.addNode);

  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [tab, setTab] = useState('inspector');

  const stream = useExecutionStream(executionId, {
    onFinish: (status) => {
      if (status === 'success') toast.success('Run completed.');
      else if (status === 'failed') toast.error('Run failed. Open the report for the failing step.');
      else toast.warning(`Run finished with status: ${status}.`);
    },
  });

  useEffect(() => {
    if (workflow) load(workflow);
  }, [workflow, load]);

  // Leaving the builder with another workflow's graph still in the store would
  // flash the wrong canvas on the next open.
  useEffect(() => () => reset(), [reset]);

  // Browsers only show their own generic message here, but the prompt itself is
  // what matters: unsaved graph edits are expensive to recreate.
  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const onSave = useCallback(async () => {
    const state = useBuilderStore.getState();
    if (!state.dirty) return;

    setSaving(true);
    try {
      const saved = await saveWorkflow(workflowId, {
        name: state.name,
        description: state.description,
        tags: state.tags,
        graph: state.graph,
      });
      markSaved(saved);
      toast.success(`Saved as v${saved.version}.`);
    } catch (cause) {
      toast.error(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }, [workflowId, markSaved]);

  const onRun = useCallback(
    async (task: string) => {
      const state = useBuilderStore.getState();

      setStarting(true);
      setExecutionId(null);
      setTab('run');

      try {
        const result = await startExecution({
          workflowId,
          task,
          // Run exactly what's on screen — running the *saved* graph while the
          // canvas shows something else would be a genuinely confusing lie.
          graphOverride: state.graph,
        });
        setExecutionId(result.executionId);
      } catch (cause) {
        toast.error(toErrorMessage(cause));
      } finally {
        setStarting(false);
      }
    },
    [workflowId],
  );

  useHotkeys([
    { key: 's', mod: true, allowInInput: true, handler: () => void onSave() },
    { key: 'z', mod: true, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    { key: 'y', mod: true, handler: redo },
    {
      key: 'd',
      mod: true,
      handler: () => {
        const first = useBuilderStore.getState().selectedNodeIds[0];
        if (first) duplicateNode(first);
      },
    },
    {
      key: 'Delete',
      handler: () => {
        const state = useBuilderStore.getState();
        if (state.selectedNodeIds.length > 0) removeNodes(state.selectedNodeIds);
        else if (state.selectedEdgeId) removeEdges([state.selectedEdgeId]);
      },
    },
    {
      key: 'Backspace',
      handler: () => {
        const state = useBuilderStore.getState();
        if (state.selectedNodeIds.length > 0) removeNodes(state.selectedNodeIds);
        else if (state.selectedEdgeId) removeEdges([state.selectedEdgeId]);
      },
    },
  ]);

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-10" />
        <Skeleton className="flex-1" />
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/40 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load this workflow.</p>
          <p className="mt-1 text-muted-foreground">{error ?? 'It may have been deleted.'}</p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <BuilderToolbar workflowId={workflowId} saving={saving} onSave={() => void onSave()} />

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={16} minSize={12} maxSize={26}>
            <AgentPalette
              onAdd={(type) => {
                // Click-to-add drops into a loose grid so repeated clicks don't
                // stack every node on the same pixel.
                const count = useBuilderStore.getState().graph.nodes.length;
                addNode(type, { x: 80 + (count % 4) * 260, y: 80 + Math.floor(count / 4) * 150 });
              }}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={56} minSize={30}>
            <div className="size-full bg-[hsl(var(--canvas))]">
              <Canvas liveNodes={stream.nodes} highlightedNodeIds={highlighted} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={28} minSize={20} maxSize={42}>
            <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
              <div className="border-b border-border p-2">
                <TabsList className="w-full">
                  <TabsTrigger value="inspector" className="flex-1">
                    <PanelRight />
                    <span className="sr-only sm:not-sr-only">Inspect</span>
                  </TabsTrigger>
                  <TabsTrigger value="run" className="flex-1">
                    <Boxes />
                    <span className="sr-only sm:not-sr-only">Run</span>
                  </TabsTrigger>
                  <TabsTrigger value="optimize" className="flex-1">
                    <Sparkles />
                    <span className="sr-only sm:not-sr-only">Optimize</span>
                  </TabsTrigger>
                  <TabsTrigger value="history" className="flex-1">
                    <History />
                    <span className="sr-only sm:not-sr-only">History</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="inspector" className="mt-0 min-h-0 flex-1">
                <Inspector />
              </TabsContent>

              <TabsContent value="run" className="mt-0 min-h-0 flex-1">
                <ErrorBoundary label="The run panel">
                  <RunPanel
                    executionId={executionId}
                    stream={stream}
                    starting={starting}
                    disabled={workflow.graph.nodes.length === 0 && !dirty}
                    dirty={dirty}
                    onRun={(task) => void onRun(task)}
                    onClear={() => setExecutionId(null)}
                  />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="optimize" className="mt-0 min-h-0 flex-1">
                <ErrorBoundary label="The optimizer">
                  <OptimizerPanel workflowId={workflowId} onHighlight={setHighlighted} />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="history" className="mt-0 min-h-0 flex-1">
                <ErrorBoundary label="Version history">
                  <VersionHistory workflowId={workflowId} onRestored={refresh} />
                </ErrorBoundary>
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </ReactFlowProvider>
  );
}

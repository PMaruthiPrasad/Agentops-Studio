import { analyzeWorkflow, applySelectedSuggestions, runRules } from '@/lib/optimizer';
import type { OptimizationReport } from '@/types/optimizer';
import type { WorkflowGraph } from '@/types/workflow';
import type { ApplySuggestionsInput, OptimizeWorkflowInput } from '@/types/api';
import { getWorkflow } from './workflow.service';

/**
 * Optimizer orchestration — resolves the graph to analyse, then delegates to
 * the pure rule engine in `lib/optimizer`.
 */

export async function optimizeWorkflow(
  workflowId: string,
  input: OptimizeWorkflowInput,
): Promise<OptimizationReport> {
  const workflow = await getWorkflow(workflowId);
  const graph = input.graphOverride ?? workflow.graph;

  return analyzeWorkflow(
    {
      graph,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      tags: workflow.tags,
    },
    { includeNarrative: input.includeNarrative },
  );
}

export interface ApplySuggestionsResult {
  graph: WorkflowGraph;
  applied: string[];
  skipped: string[];
}

/**
 * Apply chosen suggestions to a graph.
 *
 * Deliberately does NOT persist: the builder applies the patch to the canvas
 * and the user saves if they like the result. An optimizer that silently
 * rewrites saved workflows would be an alarming thing to ship.
 */
export async function applyOptimizations(
  workflowId: string,
  input: ApplySuggestionsInput,
): Promise<ApplySuggestionsResult> {
  const workflow = await getWorkflow(workflowId);

  // Re-derive suggestions against the graph the client actually holds, so ids
  // line up even if the canvas has moved on since the report was generated.
  const suggestions = runRules({
    graph: input.graph,
    workflowName: workflow.name,
    workflowDescription: workflow.description,
    tags: workflow.tags,
  });

  return applySelectedSuggestions(input.graph, suggestions, input.suggestionIds);
}

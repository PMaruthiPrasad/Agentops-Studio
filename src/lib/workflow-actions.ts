'use client';

import { api } from '@/lib/api-client';
import { workflowExportSchema, type Workflow, type WorkflowGraph } from '@/types/workflow';
import type { OptimizationReport } from '@/types/optimizer';
import type { ApplySuggestionsResult } from '@/services/optimizer.service';

/**
 * Client-side workflow mutations.
 *
 * Components call these instead of assembling fetches inline, so the request
 * shapes stay in one place and every caller gets the same error semantics from
 * `api`.
 */

export interface CreateWorkflowArgs {
  name: string;
  description?: string;
  tags?: string[];
  graph?: WorkflowGraph;
}

export function createWorkflow(args: CreateWorkflowArgs): Promise<Workflow> {
  return api.post<Workflow>('/api/workflows', args);
}

export interface SaveWorkflowArgs {
  name?: string;
  description?: string;
  tags?: string[];
  isFavorite?: boolean;
  graph?: WorkflowGraph;
  versionMessage?: string;
}

export function saveWorkflow(id: string, args: SaveWorkflowArgs): Promise<Workflow> {
  return api.patch<Workflow>(`/api/workflows/${id}`, args);
}

export function deleteWorkflow(id: string): Promise<void> {
  return api.delete(`/api/workflows/${id}`);
}

export function duplicateWorkflow(id: string, name?: string): Promise<Workflow> {
  return api.post<Workflow>(`/api/workflows/${id}/duplicate`, name ? { name } : {});
}

export function toggleFavorite(id: string): Promise<Workflow> {
  return api.post<Workflow>(`/api/workflows/${id}/favorite`);
}

export function restoreVersion(id: string, version: number): Promise<Workflow> {
  return api.post<Workflow>(`/api/workflows/${id}/versions`, { version });
}

export function optimizeWorkflow(
  id: string,
  args: { graphOverride?: WorkflowGraph; includeNarrative?: boolean } = {},
): Promise<OptimizationReport> {
  return api.post<OptimizationReport>(`/api/workflows/${id}/optimize`, args);
}

export function applySuggestions(
  id: string,
  graph: WorkflowGraph,
  suggestionIds: string[],
): Promise<ApplySuggestionsResult> {
  return api.post<ApplySuggestionsResult>(`/api/workflows/${id}/optimize/apply`, {
    graph,
    suggestionIds,
  });
}

export interface StartExecutionResult {
  executionId: string;
  streamUrl: string;
}

export function startExecution(args: {
  workflowId: string;
  task: string;
  graphOverride?: WorkflowGraph;
}): Promise<StartExecutionResult> {
  return api.post<StartExecutionResult>('/api/executions', args);
}

export function deleteExecution(id: string): Promise<void> {
  return api.delete(`/api/executions/${id}`);
}

/** Triggers the browser download for the portable export document. */
export function downloadWorkflow(id: string): void {
  // A plain navigation is enough — the route sets Content-Disposition, so this
  // saves a file rather than replacing the page.
  window.location.href = `/api/workflows/${id}/export`;
}

/**
 * Read an exported `.agentops.json` file and create a workflow from it.
 *
 * The file is validated against the same schema that produced it, so a
 * hand-edited or truncated document fails here with a readable message instead
 * of half-importing.
 */
export async function importWorkflowFile(file: File): Promise<Workflow> {
  const text = await file.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }

  const parsed = workflowExportSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      first ? `${file.name}: ${first.path.join('.') || 'document'} — ${first.message}` : `${file.name} is not a valid workflow export.`,
    );
  }

  return createWorkflow({
    name: `${parsed.data.name} (imported)`,
    description: parsed.data.description,
    tags: parsed.data.tags,
    graph: parsed.data.graph,
  });
}

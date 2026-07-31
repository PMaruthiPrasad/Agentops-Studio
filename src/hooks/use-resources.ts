'use client';

import { api, toQuery } from '@/lib/api-client';
import { useAsync } from './use-async';
import type { AgentCatalogEntry } from '@/services/agent.service';
import type { ProviderStatus } from '@/lib/providers/registry';
import type {
  AnalyticsPayload,
  ExecutionResult,
  ExecutionStatus,
  ExecutionSummary,
} from '@/types/execution';
import type { Workflow, WorkflowSummary, WorkflowVersionSummary } from '@/types/workflow';

/**
 * Typed readers for every API resource.
 *
 * Components import these rather than URLs, so a route change is a one-line
 * edit here instead of a grep across the app.
 */

export interface WorkflowListFilters {
  search?: string;
  tag?: string;
  favorite?: boolean;
}

export function useWorkflows(filters: WorkflowListFilters = {}) {
  const query = toQuery({
    search: filters.search,
    tag: filters.tag,
    favorite: filters.favorite === undefined ? undefined : String(filters.favorite),
  });

  return useAsync<WorkflowSummary[]>(
    (signal) => api.get<WorkflowSummary[]>(`/api/workflows${query}`, { signal }),
    [query],
  );
}

export function useWorkflow(id: string | null) {
  return useAsync<Workflow | null>(
    (signal) => (id ? api.get<Workflow>(`/api/workflows/${id}`, { signal }) : Promise.resolve(null)),
    [id],
  );
}

export function useWorkflowVersions(id: string | null) {
  return useAsync<WorkflowVersionSummary[]>(
    (signal) =>
      id
        ? api.get<WorkflowVersionSummary[]>(`/api/workflows/${id}/versions`, { signal })
        : Promise.resolve([]),
    [id],
  );
}

export function useTags() {
  return useAsync<Array<{ tag: string; count: number }>>(
    (signal) => api.get('/api/workflows/tags', { signal }),
    [],
  );
}

export interface ExecutionListFilters {
  workflowId?: string;
  status?: ExecutionStatus;
  limit?: number;
}

export function useExecutions(filters: ExecutionListFilters = {}) {
  const query = toQuery({
    workflowId: filters.workflowId,
    status: filters.status,
    limit: filters.limit,
  });

  return useAsync<ExecutionSummary[]>(
    (signal) => api.get<ExecutionSummary[]>(`/api/executions${query}`, { signal }),
    [query],
  );
}

export function useExecution(id: string | null) {
  return useAsync<ExecutionResult | null>(
    (signal) =>
      id ? api.get<ExecutionResult>(`/api/executions/${id}`, { signal }) : Promise.resolve(null),
    [id],
  );
}

export function useAnalytics(days = 30, workflowId?: string) {
  const query = toQuery({ days, workflowId });

  return useAsync<AnalyticsPayload>(
    (signal) => api.get<AnalyticsPayload>(`/api/analytics${query}`, { signal }),
    [query],
  );
}

export interface AgentCatalog {
  agents: AgentCatalogEntry[];
  providers: ProviderStatus[];
}

export function useAgents() {
  return useAsync<AgentCatalog>((signal) => api.get<AgentCatalog>('/api/agents', { signal }), []);
}

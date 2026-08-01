import { z } from 'zod';
import { runDocumentSchema } from './agent';
import { workflowGraphSchema } from './workflow';
import { executionStatusSchema } from './execution';

/**
 * Wire contracts. Every route parses its input with one of these schemas, so a
 * malformed request never reaches a service.
 */

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'ENGINE_ERROR',
  'PROVIDER_ERROR',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
}

export type ApiResponseBody<T> = ApiSuccessBody<T> | ApiErrorBody;

/* -------------------------------------------------------------------------- */
/* Workflows                                                                  */
/* -------------------------------------------------------------------------- */

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  description: z.string().max(1_000).default(''),
  tags: z.array(z.string().min(1).max(32)).max(12).default([]),
  graph: workflowGraphSchema.optional(),
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

export const updateWorkflowSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1_000).optional(),
    tags: z.array(z.string().min(1).max(32)).max(12).optional(),
    isFavorite: z.boolean().optional(),
    graph: workflowGraphSchema.optional(),
    /** Recorded on the version snapshot when the graph changes. */
    versionMessage: z.string().max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

export const listWorkflowsQuerySchema = z.object({
  search: z.string().max(120).optional(),
  tag: z.string().max(32).optional(),
  favorite: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;

export const duplicateWorkflowSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});
export type DuplicateWorkflowInput = z.infer<typeof duplicateWorkflowSchema>;

export const importWorkflowSchema = z.object({
  formatVersion: z.literal(1),
  name: z.string().min(1).max(120),
  description: z.string().max(1_000).default(''),
  tags: z.array(z.string()).default([]),
  graph: workflowGraphSchema,
});
export type ImportWorkflowInput = z.infer<typeof importWorkflowSchema>;

/* -------------------------------------------------------------------------- */
/* Executions                                                                 */
/* -------------------------------------------------------------------------- */

export const startExecutionSchema = z.object({
  workflowId: z.string().min(1),
  task: z.string().min(4, 'Describe the task in at least 4 characters').max(4_000),
  /**
   * Source material every node receives, already extracted to text by
   * `POST /api/documents/extract`. The task stays a short instruction — this is
   * the thing the instruction is *about*.
   */
  document: runDocumentSchema.optional(),
  /**
   * Runs the supplied graph instead of the saved one. Lets the builder execute
   * unsaved edits without forcing a save first.
   */
  graphOverride: workflowGraphSchema.optional(),
  maxConcurrency: z.number().int().min(1).max(16).optional(),
});
export type StartExecutionInput = z.infer<typeof startExecutionSchema>;

export const listExecutionsQuerySchema = z.object({
  workflowId: z.string().optional(),
  status: executionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Optimizer                                                                  */
/* -------------------------------------------------------------------------- */

export const optimizeWorkflowSchema = z.object({
  /** Analyse an unsaved canvas state rather than the persisted graph. */
  graphOverride: workflowGraphSchema.optional(),
  /** Set false to skip the LLM narrative and return instantly. */
  includeNarrative: z.boolean().default(true),
});
export type OptimizeWorkflowInput = z.infer<typeof optimizeWorkflowSchema>;

export const applySuggestionsSchema = z.object({
  graph: workflowGraphSchema,
  suggestionIds: z.array(z.string().min(1)).min(1),
});
export type ApplySuggestionsInput = z.infer<typeof applySuggestionsSchema>;

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

export const analyticsQuerySchema = z.object({
  workflowId: z.string().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

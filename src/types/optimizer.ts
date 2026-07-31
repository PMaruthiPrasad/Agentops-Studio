import { z } from 'zod';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './workflow';

export const SUGGESTION_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const suggestionSeveritySchema = z.enum(SUGGESTION_SEVERITIES);
export type SuggestionSeverity = z.infer<typeof suggestionSeveritySchema>;

export const SUGGESTION_CATEGORIES = [
  'parallelism',
  'redundancy',
  'ordering',
  'relevance',
  'cost',
  'reliability',
  'structure',
] as const;
export const suggestionCategorySchema = z.enum(SUGGESTION_CATEGORIES);
export type SuggestionCategory = z.infer<typeof suggestionCategorySchema>;

/**
 * A declarative graph edit. Rules return patches instead of mutating, so the
 * UI can preview a fix, apply it atomically, or discard it.
 */
export interface GraphPatch {
  removeNodeIds?: string[];
  removeEdgeIds?: string[];
  addEdges?: WorkflowEdge[];
  updateNodes?: Array<{ id: string } & Partial<Pick<WorkflowNode, 'label' | 'config'>>>;
}

export interface OptimizationSuggestion {
  id: string;
  ruleId: string;
  title: string;
  /** What to change. */
  description: string;
  /** Why it matters — surfaced verbatim in the UI. */
  reasoning: string;
  severity: SuggestionSeverity;
  category: SuggestionCategory;
  affectedNodeIds: string[];
  estimatedLatencyReductionMs: number;
  estimatedCostReductionUsd: number;
  /** True when `patch` fully expresses the fix and can be applied in one click. */
  autoFixable: boolean;
  patch?: GraphPatch;
}

export interface WorkflowProjection {
  /** Critical-path latency, i.e. what a run should actually take. */
  estimatedLatencyMs: number;
  estimatedCostUsd: number;
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  parallelizationScore: number;
  complexityScore: number;
}

export type OptimizationGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface OptimizationReport {
  /** 0..100. 100 means no rule fired. */
  score: number;
  grade: OptimizationGrade;
  /** Deterministic one-line headline. */
  summary: string;
  /** LLM-authored prose. Empty string when narrative generation is skipped. */
  narrative: string;
  suggestions: OptimizationSuggestion[];
  baseline: WorkflowProjection;
  /** Projection assuming every auto-fixable suggestion is applied. */
  projected: WorkflowProjection;
  estimatedLatencyReductionMs: number;
  estimatedCostReductionUsd: number;
  latencyReductionPct: number;
  costReductionPct: number;
  generatedAt: string;
}

/** Context a rule needs beyond the graph itself. */
export interface OptimizerContext {
  graph: WorkflowGraph;
  workflowName: string;
  workflowDescription: string;
  tags: string[];
}

export type OptimizerRuleFn = (context: OptimizerContext) => OptimizationSuggestion[];

export interface OptimizerRule {
  id: string;
  title: string;
  category: SuggestionCategory;
  /** Weight subtracted from the 100-point score, scaled by severity. */
  weight: number;
  evaluate: OptimizerRuleFn;
}

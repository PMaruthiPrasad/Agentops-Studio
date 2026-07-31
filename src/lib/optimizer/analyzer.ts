import type {
  OptimizationGrade,
  OptimizationReport,
  OptimizationSuggestion,
  OptimizerContext,
  SuggestionSeverity,
  WorkflowProjection,
} from '@/types/optimizer';
import type { WorkflowGraph } from '@/types/workflow';
import { applyPatch } from '@/lib/workflow/graph-utils';
import { findCycle } from '@/lib/workflow/validate';
import { generateNarrative, buildFallbackNarrative } from './narrative';
import { projectWorkflow } from './projection';
import { getRule, runRules } from './rules';

/**
 * Turns rule findings into a scored, quantified report.
 *
 * The score is a penalty model rather than a reward model: a workflow starts
 * perfect and loses points for each defect, weighted by severity and by how
 * much the rule matters. That keeps a small clean graph and a large clean graph
 * both at 100, which is the behaviour you want — complexity is not a sin.
 */

const SEVERITY_PENALTY: Record<SuggestionSeverity, number> = {
  critical: 22,
  high: 13,
  medium: 7,
  low: 3,
  info: 1,
};

export function computeScore(suggestions: OptimizationSuggestion[]): number {
  let penalty = 0;

  for (const suggestion of suggestions) {
    const weight = getRule(suggestion.ruleId)?.weight ?? 1;
    penalty += SEVERITY_PENALTY[suggestion.severity] * weight;
  }

  return Math.round(Math.max(0, Math.min(100, 100 - penalty)));
}

export function gradeFor(score: number): OptimizationGrade {
  if (score >= 90) return 'A';
  if (score >= 78) return 'B';
  if (score >= 64) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/**
 * Apply every auto-fixable suggestion, in severity order, skipping any patch
 * that would break the graph once earlier patches have landed.
 *
 * Returns both the resulting graph and the suggestions that actually applied,
 * so the projected numbers never over-promise.
 */
export function applyAutoFixes(
  graph: WorkflowGraph,
  suggestions: OptimizationSuggestion[],
): { graph: WorkflowGraph; applied: OptimizationSuggestion[] } {
  const ordered = [...suggestions]
    .filter((suggestion) => suggestion.autoFixable && suggestion.patch)
    .sort((a, b) => SEVERITY_PENALTY[b.severity] - SEVERITY_PENALTY[a.severity]);

  let current = graph;
  const applied: OptimizationSuggestion[] = [];

  for (const suggestion of ordered) {
    if (!suggestion.patch) continue;

    // Patches were validated against the *original* graph. Re-check against the
    // graph as it stands now, because an earlier fix may have invalidated this one.
    try {
      const next = applyPatch(current, suggestion.patch);
      if (next.nodes.length === 0 || findCycle(next)) continue;
      current = next;
      applied.push(suggestion);
    } catch {
      continue;
    }
  }

  return { graph: current, applied };
}

/** Apply a specific subset of suggestions, by id. Used by the "Apply" button. */
export function applySelectedSuggestions(
  graph: WorkflowGraph,
  suggestions: OptimizationSuggestion[],
  suggestionIds: string[],
): { graph: WorkflowGraph; applied: string[]; skipped: string[] } {
  const wanted = new Set(suggestionIds);
  const selected = suggestions.filter((suggestion) => wanted.has(suggestion.id));

  let current = graph;
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const suggestion of selected) {
    if (!suggestion.patch) {
      skipped.push(suggestion.id);
      continue;
    }
    try {
      const next = applyPatch(current, suggestion.patch);
      if (next.nodes.length === 0 || findCycle(next)) {
        skipped.push(suggestion.id);
        continue;
      }
      current = next;
      applied.push(suggestion.id);
    } catch {
      skipped.push(suggestion.id);
    }
  }

  // Anything requested but not found is reported as skipped, not silently lost.
  for (const id of suggestionIds) {
    if (!applied.includes(id) && !skipped.includes(id)) skipped.push(id);
  }

  return { graph: current, applied, skipped };
}

export interface AnalyzeOptions {
  includeNarrative?: boolean;
}

/** Full analysis without the LLM narrative. Synchronous and pure. */
export function analyzeWorkflowSync(
  context: OptimizerContext,
): Omit<OptimizationReport, 'narrative'> {
  const suggestions = sortSuggestions(runRules(context));
  const score = computeScore(suggestions);

  const baseline = projectWorkflow(context.graph);
  const { graph: optimizedGraph } = applyAutoFixes(context.graph, suggestions);
  const projected = projectWorkflow(optimizedGraph);

  const latencyReduction = Math.max(0, baseline.estimatedLatencyMs - projected.estimatedLatencyMs);
  const costReduction = Math.max(0, baseline.estimatedCostUsd - projected.estimatedCostUsd);

  return {
    score,
    grade: gradeFor(score),
    summary: buildSummary(context, suggestions, score),
    suggestions,
    baseline,
    projected,
    estimatedLatencyReductionMs: Math.round(latencyReduction),
    estimatedCostReductionUsd: Number(costReduction.toFixed(6)),
    latencyReductionPct: percentOf(latencyReduction, baseline.estimatedLatencyMs),
    costReductionPct: percentOf(costReduction, baseline.estimatedCostUsd),
    generatedAt: new Date().toISOString(),
  };
}

/** Full analysis including the LLM-authored executive summary. */
export async function analyzeWorkflow(
  context: OptimizerContext,
  options: AnalyzeOptions = {},
): Promise<OptimizationReport> {
  const report = analyzeWorkflowSync(context);
  const narrativeInput = {
    workflowName: context.workflowName,
    suggestions: report.suggestions,
    baseline: report.baseline,
    projected: report.projected,
    score: report.score,
  };

  const narrative =
    options.includeNarrative === false
      ? buildFallbackNarrative(narrativeInput)
      : await generateNarrative(narrativeInput);

  return { ...report, narrative };
}

/* -------------------------------------------------------------------------- */

const SEVERITY_ORDER: Record<SuggestionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function sortSuggestions(suggestions: OptimizationSuggestion[]): OptimizationSuggestion[] {
  return [...suggestions].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;

    // Within a severity, put the changes with real savings first.
    const byImpact =
      b.estimatedLatencyReductionMs +
      b.estimatedCostReductionUsd * 100_000 -
      (a.estimatedLatencyReductionMs + a.estimatedCostReductionUsd * 100_000);
    if (byImpact !== 0) return byImpact;

    return a.id.localeCompare(b.id);
  });
}

function buildSummary(
  context: OptimizerContext,
  suggestions: OptimizationSuggestion[],
  score: number,
): string {
  if (suggestions.length === 0) {
    return `No issues found across ${context.graph.nodes.length} nodes.`;
  }

  const autoFixable = suggestions.filter((s) => s.autoFixable).length;
  const bySeverity = suggestions.reduce<Record<string, number>>((counts, suggestion) => {
    counts[suggestion.severity] = (counts[suggestion.severity] ?? 0) + 1;
    return counts;
  }, {});

  const parts = (['critical', 'high', 'medium', 'low', 'info'] as const)
    .filter((severity) => bySeverity[severity])
    .map((severity) => `${bySeverity[severity]} ${severity}`);

  return `${suggestions.length} finding(s) — ${parts.join(', ')}. ${autoFixable} can be applied automatically. Score ${score}/100.`;
}

function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

export function projectionFor(graph: WorkflowGraph): WorkflowProjection {
  return projectWorkflow(graph);
}

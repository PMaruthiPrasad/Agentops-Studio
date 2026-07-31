import type { OptimizationSuggestion, WorkflowProjection } from '@/types/optimizer';
import { resolveProvider } from '@/lib/providers/registry';
import { toErrorMessage } from '@/lib/utils';

/**
 * The "AI" half of the AI Workflow Optimizer.
 *
 * The rules decide *what* is wrong — deterministically, so two runs never
 * disagree. This module asks a model to write the executive summary an engineer
 * would put at the top of a review: what to do first, and what the trade-off is.
 *
 * It is strictly additive. If the model call fails, the report still renders
 * with a deterministic fallback summary, because an optimizer that breaks when
 * the network does would be worse than no optimizer.
 */

const SYSTEM_PROMPT = [
  'You are a workflow optimisation analyst for an AI agent orchestration platform.',
  'You are given the findings of a static analyser. The findings are correct — do not re-derive or dispute them.',
  'Write a short executive summary for the engineer who owns this workflow.',
  'Lead with the single highest-leverage change. Be specific about the trade-off it involves.',
  'Never invent findings that are not in the input. If there are no findings, say the workflow is well structured and stop.',
  'Maximum 180 words. No preamble, no bullet-point padding.',
].join(' ');

export interface NarrativeInput {
  workflowName: string;
  suggestions: OptimizationSuggestion[];
  baseline: WorkflowProjection;
  projected: WorkflowProjection;
  score: number;
}

export async function generateNarrative(input: NarrativeInput): Promise<string> {
  if (input.suggestions.length === 0) {
    return (
      `No structural issues found in "${input.workflowName}". The graph runs in ` +
      `${input.baseline.layerCount} layer(s) across ${input.baseline.nodeCount} nodes with a ` +
      `parallelisation score of ${input.baseline.parallelizationScore.toFixed(2)}. ` +
      `Nothing here is worth changing for its own sake.`
    );
  }

  const { provider } = resolveProvider();

  const findings = input.suggestions
    .map(
      (suggestion, index) =>
        `${index + 1}. [${suggestion.severity}/${suggestion.category}] ${suggestion.title} — ` +
        `${suggestion.description} Saves ~${suggestion.estimatedLatencyReductionMs}ms and ` +
        `$${suggestion.estimatedCostReductionUsd.toFixed(4)} per run.`,
    )
    .join('\n');

  const userPrompt = [
    `# Workflow\n${input.workflowName}`,
    `# Optimization score\n${input.score}/100`,
    `# Current projection\nlatency ${input.baseline.estimatedLatencyMs}ms, cost $${input.baseline.estimatedCostUsd.toFixed(4)}, ` +
      `${input.baseline.nodeCount} nodes in ${input.baseline.layerCount} layers ` +
      `(parallelisation ${input.baseline.parallelizationScore.toFixed(2)})`,
    `# Projection if every auto-fixable suggestion is applied\nlatency ${input.projected.estimatedLatencyMs}ms, ` +
      `cost $${input.projected.estimatedCostUsd.toFixed(4)}, ${input.projected.nodeCount} nodes in ` +
      `${input.projected.layerCount} layers (parallelisation ${input.projected.parallelizationScore.toFixed(2)})`,
    `# Findings\n${findings}`,
    '# Your instruction\nWrite the executive summary.',
  ].join('\n\n');

  try {
    const response = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.35,
      maxTokens: 600,
      context: {
        agentType: 'critic',
        agentName: 'Workflow Optimizer',
        nodeId: 'optimizer',
        nodeLabel: 'Workflow Optimizer',
        task: `Optimise the agent workflow "${input.workflowName}"`,
        upstream: [],
        attempt: 1,
      },
    });

    return response.content.trim();
  } catch (error) {
    return buildFallbackNarrative(input, toErrorMessage(error));
  }
}

/** Deterministic summary used when no model is reachable. */
export function buildFallbackNarrative(input: NarrativeInput, reason?: string): string {
  const top = input.suggestions[0];
  const latencySaving = input.baseline.estimatedLatencyMs - input.projected.estimatedLatencyMs;
  const costSaving = input.baseline.estimatedCostUsd - input.projected.estimatedCostUsd;

  const lines = [
    `"${input.workflowName}" scores ${input.score}/100 with ${input.suggestions.length} finding(s).`,
    top
      ? `Highest leverage: ${top.title}. ${top.description}`
      : 'No individual finding dominates.',
    latencySaving > 0 || costSaving > 0
      ? `Applying every auto-fixable suggestion projects ${Math.max(0, Math.round(latencySaving))}ms ` +
        `and $${Math.max(0, costSaving).toFixed(4)} saved per run.`
      : 'The remaining findings are structural rather than performance-related.',
  ];

  if (reason) {
    lines.push(`(Narrative generation unavailable: ${reason})`);
  }

  return lines.join(' ');
}

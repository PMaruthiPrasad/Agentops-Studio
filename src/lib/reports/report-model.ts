import { titleCase } from '@/lib/utils';
import type { AgentType, RunDocument } from '@/types/agent';
import type { ExecutionResult, StepStatus } from '@/types/execution';

/**
 * The reader-facing view of a run.
 *
 * Everything the execution detail page exists to show — cost, tokens, latency,
 * confidence, prompts, retries, layers — is deliberately absent. That page
 * answers "how did this run behave"; this one answers "what did it say". They
 * are different documents for different readers, and merging them produces one
 * that serves neither.
 *
 * Derived from `ExecutionResult` rather than queried separately so the report
 * can never disagree with the run it claims to describe.
 */

export interface ReportSection {
  label: string;
  agentType: AgentType;
  status: StepStatus;
  /** The agent's answer. Empty when it produced none. */
  response: string;
  /** Plain-language reason there is no response, when there isn't one. */
  note: string | null;
}

export interface RunReport {
  executionId: string;
  workflowName: string;
  /** What the user typed. */
  task: string;
  document: RunDocument | null;
  sections: ReportSection[];
  completedAt: string | null;
}

export function buildRunReport(execution: ExecutionResult): RunReport {
  return {
    executionId: execution.id,
    workflowName: execution.workflowName,
    task: execution.task,
    document: execution.document,
    // Steps arrive ordered by layer then sequence, which is the order they ran
    // and therefore the order the narrative should be read in.
    sections: execution.steps.map(toSection),
    completedAt: execution.completedAt,
  };
}

function toSection(step: ExecutionResult['steps'][number]): ReportSection {
  const response = step.response?.trim() ?? '';

  return {
    label: step.label,
    agentType: step.agentType,
    status: step.status,
    response,
    // An agent that ran but is simply missing from the report reads as an
    // omission. Saying why it is empty is not analytics, it is honesty.
    note: response ? null : describeMissingOutput(step.status, step.skipReason),
  };
}

function describeMissingOutput(status: StepStatus, skipReason: string | null): string {
  switch (status) {
    case 'skipped':
      return skipReason
        ? `This step was skipped — ${skipReason}.`
        : 'This step was skipped and produced no output.';
    case 'failed':
      return 'This step failed and produced no output.';
    case 'cancelled':
      return 'This step was cancelled before it produced output.';
    default:
      return 'This step produced no output.';
  }
}

/**
 * The agent type in prose, or null when it merely repeats the node's label.
 *
 * Nodes keep their agent's name unless renamed, so the default case would read
 * "Planner (Planner)" on every heading.
 */
export function sectionSubtitle(section: ReportSection): string | null {
  const readable = titleCase(section.agentType.replace(/_/g, ' '));
  return readable.toLowerCase() === section.label.trim().toLowerCase() ? null : readable;
}

/** Heading for the flat formats, which have no room for a separate subtitle. */
export function sectionHeading(section: ReportSection): string {
  const subtitle = sectionSubtitle(section);
  return subtitle ? `${section.label} (${subtitle})` : section.label;
}

/** `Contract risk review` → `contract-risk-review`, for a download filename. */
export function reportFileSlug(report: RunReport): string {
  const base =
    report.workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'run';

  return `${base}-${report.executionId.slice(-8)}`;
}

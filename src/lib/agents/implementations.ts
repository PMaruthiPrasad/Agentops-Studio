import type { AgentExecutionInput } from '@/types/agent';
import { BaseAgent } from './base-agent';

/**
 * Concrete agents.
 *
 * Each one is small on purpose: the shared machinery lives in `BaseAgent`, so
 * an agent is defined by *what it asks for* and *what it extracts*, which is
 * the part that actually differs between them.
 */

export class PlannerAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Decompose this task into subtasks. For each: an id, the owning agent type, its ' +
      'dependencies, and a concrete completion condition. Then state which subtasks are ' +
      'independent and can be dispatched in the same parallel layer, and list the risks.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    // Subtasks are emitted as "**T1 — …**"; count them for the run summary.
    const subtaskIds = [...output.matchAll(/\*\*(T\d+)\s*[—-]/g)]
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id));

    return {
      subtaskCount: subtaskIds.length,
      subtaskIds,
      parallelizable: /parallel/i.test(output),
      risks: BaseAgent.extractBullets(output).length,
    };
  }
}

export class ResearcherAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Research this question. Produce numbered findings, each with a confidence score and a ' +
      'corroborating-source count. Then give a short synthesis, and finish with the evidence gaps.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const confidences = [...output.matchAll(/confidence:\s*([\d.]+)/gi)]
      .map((m) => Number.parseFloat(m[1] ?? ''))
      .filter((n) => Number.isFinite(n));

    return {
      findingCount: BaseAgent.countMatches(output, /\*\*F\d+\.\*\*/g),
      averageFindingConfidence:
        confidences.length > 0
          ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
          : null,
      hasEvidenceGaps: /evidence gaps/i.test(output),
    };
  }
}

export class RetrieverAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Retrieve the most relevant documents for this task. Return a ranked table with relevance ' +
      'scores and index statistics. Do not interpret the documents — flag which results are ' +
      'high confidence and which are recall-only.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const scores = [...output.matchAll(/\|\s*(0\.\d{3})\s*\|/g)]
      .map((m) => Number.parseFloat(m[1] ?? ''))
      .filter((n) => Number.isFinite(n));

    return {
      documentCount: scores.length,
      topScore: scores.length > 0 ? Math.max(...scores) : null,
      medianScore:
        scores.length > 0 ? [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)] : null,
    };
  }

  /**
   * Retrieval confidence should track the quality of what came back, not the
   * model's tone. A weak top hit is a weak result no matter how fluently it's
   * reported.
   */
  protected override adjustConfidence(
    raw: number,
    output: string,
    input: AgentExecutionInput,
  ): number {
    const base = super.adjustConfidence(raw, output, input);
    const parsed = this.parseOutput(output);
    const topScore = typeof parsed.topScore === 'number' ? parsed.topScore : null;
    if (topScore === null) return base;
    return Number(Math.max(0.05, Math.min(0.99, base * 0.5 + topScore * 0.5)).toFixed(3));
  }
}

export class KnowledgeAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Normalise the upstream material into a structured knowledge extract: an entity table, the ' +
      'relationships between entities, canonical definitions, and any conflicts between sources.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    return {
      entityCount: BaseAgent.countMatches(output, /\|\s*`E\d+`\s*\|/g),
      relationshipCount: BaseAgent.countMatches(output, /→\s*`\w+`\s*→/g),
      conflictsDetected: !/### Conflicts detected\s*\nNone/i.test(output),
    };
  }
}

export class CoderAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Implement this. State the approach, provide the complete typed implementation in a code ' +
      'block, list every file touched, and close with what you deliberately left out and why.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const blocks = BaseAgent.extractCodeBlocks(output);
    const code = blocks.join('\n');
    return {
      codeBlockCount: blocks.length,
      linesOfCode: code ? code.split('\n').length : 0,
      exportedSymbols: BaseAgent.countMatches(code, /^export\s+(async\s+)?(function|const|class|interface|type)\s/gm),
      filesTouched: BaseAgent.countMatches(output, /`src\/[^`]+`/g),
    };
  }
}

export class ReviewerAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Review the upstream deliverable. Separate blocking issues from non-blocking ones, work ' +
      'through the review checklist, and end with an explicit verdict.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const blockingMatch = output.match(/### Blocking \((\d+)\)/);
    const nonBlockingMatch = output.match(/### Non-blocking \((\d+)\)/);
    const approved = /Verdict:\s*Approve/i.test(output);

    return {
      blockingCount: blockingMatch?.[1] ? Number.parseInt(blockingMatch[1], 10) : 0,
      nonBlockingCount: nonBlockingMatch?.[1] ? Number.parseInt(nonBlockingMatch[1], 10) : 0,
      approved,
      checklistPassed: BaseAgent.countMatches(output, /- \[x\]/g),
      checklistFailed: BaseAgent.countMatches(output, /- \[ \]/g),
    };
  }

  /** A review that found blocking issues is a *confident* review, not a weak one. */
  protected override adjustConfidence(
    raw: number,
    output: string,
    input: AgentExecutionInput,
  ): number {
    const base = super.adjustConfidence(raw, output, input);
    const parsed = this.parseOutput(output);
    const failed = typeof parsed.checklistFailed === 'number' ? parsed.checklistFailed : 0;
    // Unchecked checklist items mean the reviewer couldn't verify something.
    return Number(Math.max(0.05, base - failed * 0.04).toFixed(3));
  }
}

export class CriticAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Critique the upstream reasoning adversarially. Name what holds up, what does not, and the ' +
      'specific logical gaps. Score it out of 10 and recommend proceed or revise.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const score = BaseAgent.extractScore(output);
    return {
      score,
      recommendsProceed: /Recommendation\s*\n\s*Proceed/i.test(output),
      weaknessCount: BaseAgent.countMatches(output, /^-\s+/gm),
    };
  }

  /**
   * The Critic's own score is a better confidence signal than the provider's
   * heuristic — it is literally an assessment of the work's quality.
   */
  protected override adjustConfidence(
    raw: number,
    output: string,
    input: AgentExecutionInput,
  ): number {
    const base = super.adjustConfidence(raw, output, input);
    const score = BaseAgent.extractScore(output);
    if (score === null) return base;
    return Number(Math.max(0.05, Math.min(0.99, base * 0.45 + (score / 10) * 0.55)).toFixed(3));
  }
}

export class TesterAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Build a coverage matrix for the upstream implementation, write runnable tests, and report ' +
      'the pass/fail result with coverage figures. Describe any failure precisely enough to fix it.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const resultMatch = output.match(/\*\*(\d+)\/(\d+) passing\*\*/);
    const coverageMatch = output.match(/line coverage:\s*\*\*([\d.]+)%\*\*/);
    const passed = resultMatch?.[1] ? Number.parseInt(resultMatch[1], 10) : 0;
    const total = resultMatch?.[2] ? Number.parseInt(resultMatch[2], 10) : 0;

    return {
      testsPassed: passed,
      testsTotal: total,
      testsFailed: Math.max(0, total - passed),
      lineCoverage: coverageMatch?.[1] ? Number.parseFloat(coverageMatch[1]) : null,
      allGreen: total > 0 && passed === total,
    };
  }

  /** Failing tests are a real signal; propagate them into confidence. */
  protected override adjustConfidence(
    raw: number,
    output: string,
    input: AgentExecutionInput,
  ): number {
    const base = super.adjustConfidence(raw, output, input);
    const parsed = this.parseOutput(output);
    const total = typeof parsed.testsTotal === 'number' ? parsed.testsTotal : 0;
    const passed = typeof parsed.testsPassed === 'number' ? parsed.testsPassed : 0;
    if (total === 0) return base;
    const passRate = passed / total;
    return Number(Math.max(0.05, Math.min(0.99, base * 0.6 + passRate * 0.4)).toFixed(3));
  }
}

export class LegalValidatorAgent extends BaseAgent {
  protected instruction(): string {
    return (
      'Perform a clause-level legal and compliance review. Produce a risk register with a rating ' +
      'per clause, an overall exposure assessment, concrete redlines for Medium+ items, and ' +
      'regulatory notes. Include the not-legal-advice disclaimer.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    const high = BaseAgent.countMatches(output, /\*\*High\*\*/g);
    const medium = BaseAgent.countMatches(output, /\*\*Medium\*\*/g);
    const low = BaseAgent.countMatches(output, /\*\*Low\*\*/g);
    const exposureMatch = output.match(/Overall exposure:\s*\*\*(\w+)\*\*/);

    return {
      clausesReviewed: high + medium + low,
      highRiskCount: high,
      mediumRiskCount: medium,
      lowRiskCount: low,
      overallExposure: exposureMatch?.[1] ?? null,
      hasDisclaimer: /not legal advice/i.test(output),
    };
  }
}

export class CustomAgent extends BaseAgent {
  protected instruction(input: AgentExecutionInput): string {
    return (
      `Act as "${input.nodeLabel}" and carry out your configured role against the task and the ` +
      'upstream context. State your assumptions explicitly.'
    );
  }

  protected override parseOutput(output: string): Record<string, unknown> {
    return {
      sectionCount: BaseAgent.countMatches(output, /^###?\s+/gm),
      bulletCount: BaseAgent.extractBullets(output).length,
    };
  }
}

import type {
  AgentConfig,
  AgentExecutionInput,
  AgentExecutionResult,
  AgentType,
  UpstreamOutput,
} from '@/types/agent';
import type { CompletionContext, LLMProvider } from '@/types/provider';
import { resolveProvider } from '@/lib/providers/registry';
import { truncate } from '@/lib/utils';

/**
 * How much upstream text a single node is allowed to inherit. Without a cap,
 * a long chain quadratically inflates prompt size and cost — the exact failure
 * mode this tool is meant to surface, so we guard against it by default.
 */
const MAX_UPSTREAM_CHARS_PER_NODE = 1_800;

/**
 * Base class for every agent.
 *
 * Subclasses customise three things and nothing else:
 *   - `buildUserPrompt`  — how task + upstream context become a prompt
 *   - `parseOutput`      — pulling structured data out of the response
 *   - `adjustConfidence` — agent-specific confidence calibration
 *
 * `execute()` itself is deliberately final-ish: provider resolution, usage
 * accounting, and cost are handled identically for all agents so metrics stay
 * comparable across the graph.
 */
export abstract class BaseAgent {
  constructor(readonly config: AgentConfig) {}

  get id(): string {
    return this.config.id;
  }

  get type(): AgentType {
    return this.config.type;
  }

  get name(): string {
    return this.config.name;
  }

  get description(): string {
    return this.config.description;
  }

  get systemPrompt(): string {
    return this.config.systemPrompt;
  }

  get temperature(): number {
    return this.config.temperature;
  }

  get maxTokens(): number {
    return this.config.maxTokens;
  }

  get estimatedCost(): number {
    return this.config.estimatedCostUsd;
  }

  get estimatedLatency(): number {
    return this.config.estimatedLatencyMs;
  }

  /**
   * The agent's execution function. Returns a fully-populated result — the
   * engine adds only orchestration metadata (layer, retries, timestamps).
   */
  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const { provider } = resolveProvider(this.config.provider);
    const systemPrompt = this.buildSystemPrompt(input);
    const userPrompt = this.buildUserPrompt(input);

    const context: CompletionContext = {
      agentType: this.type,
      agentName: this.name,
      nodeId: input.nodeId,
      nodeLabel: input.nodeLabel,
      task: input.task,
      upstream: input.upstream.map((u) => ({
        nodeId: u.nodeId,
        agentType: u.agentType,
        label: u.label,
        output: u.output,
      })),
      attempt: input.attempt,
    };

    const response = await provider.complete({
      systemPrompt,
      userPrompt,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      ...(this.config.model ? { model: this.config.model } : {}),
      context,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return {
      output: response.content,
      structured: this.parseOutput(response.content),
      systemPrompt,
      userPrompt,
      usage: response.usage,
      costUsd: response.costUsd,
      confidence: this.adjustConfidence(response.confidence, response.content, input),
      latencyMs: response.latencyMs,
      provider: response.provider,
      model: response.model,
    };
  }

  /** Provider actually selected for this agent right now (may be a fallback). */
  resolveProvider(): LLMProvider {
    return resolveProvider(this.config.provider).provider;
  }

  /* ------------------------------------------------------------------ */
  /* Extension points                                                    */
  /* ------------------------------------------------------------------ */

  protected buildSystemPrompt(_input: AgentExecutionInput): string {
    return this.config.systemPrompt;
  }

  /**
   * Default prompt assembly: state the task, replay upstream context, then
   * issue the agent-specific instruction. Subclasses override `instruction()`
   * rather than reimplementing this.
   */
  protected buildUserPrompt(input: AgentExecutionInput): string {
    const sections: string[] = [`# Task\n${input.task}`];

    if (input.upstream.length > 0) {
      sections.push(`# Upstream context\n${this.renderUpstream(input.upstream)}`);
    }

    sections.push(`# Your instruction\n${this.instruction(input)}`);

    if (input.attempt > 1) {
      sections.push(
        `# Retry notice\nThis is attempt ${input.attempt}. A previous attempt failed; ` +
          `be concise and make sure the response is complete.`,
      );
    }

    return sections.join('\n\n');
  }

  /** Agent-specific directive appended to every prompt. */
  protected abstract instruction(input: AgentExecutionInput): string;

  protected renderUpstream(upstream: UpstreamOutput[]): string {
    return upstream
      .map(
        (item) =>
          `## ${item.label} (${item.agentType}, confidence ${item.confidence.toFixed(2)})\n` +
          truncate(item.output, MAX_UPSTREAM_CHARS_PER_NODE),
      )
      .join('\n\n');
  }

  /** Extract structured data. Default: none. */
  protected parseOutput(_output: string): Record<string, unknown> {
    return {};
  }

  /**
   * Calibrate the provider's confidence. Default behaviour is to never let a
   * node claim more confidence than its weakest input — errors compound
   * downstream and pretending otherwise is how agent systems mislead people.
   */
  protected adjustConfidence(
    raw: number,
    _output: string,
    input: AgentExecutionInput,
  ): number {
    if (input.upstream.length === 0) return raw;
    const weakest = Math.min(...input.upstream.map((u) => u.confidence));
    // Blend rather than hard-clamp: this node's own reasoning still counts.
    const blended = raw * 0.7 + Math.min(raw, weakest) * 0.3;
    return Number(Math.max(0.05, Math.min(0.99, blended)).toFixed(3));
  }

  /* ------------------------------------------------------------------ */
  /* Shared parsing helpers                                              */
  /* ------------------------------------------------------------------ */

  protected static countMatches(text: string, pattern: RegExp): number {
    return (text.match(pattern) ?? []).length;
  }

  protected static extractCodeBlocks(text: string): string[] {
    const blocks: string[] = [];
    const regex = /```[a-zA-Z]*\n([\s\S]*?)```/g;
    let match = regex.exec(text);
    while (match !== null) {
      if (match[1]) blocks.push(match[1].trim());
      match = regex.exec(text);
    }
    return blocks;
  }

  protected static extractBullets(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, ''));
  }

  /** Finds the first `n.n/10`-style score, or `null`. */
  protected static extractScore(text: string): number | null {
    const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*10\b/);
    if (!match?.[1]) return null;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
  }
}

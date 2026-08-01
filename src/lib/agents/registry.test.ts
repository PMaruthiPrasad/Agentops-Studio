import { describe, expect, it } from 'vitest';
import {
  createAgent,
  createAgentForNode,
  createDefaultAgent,
  resolveNodeAgentConfig,
} from './registry';
import { AGENT_DEFINITIONS, ALL_AGENT_DEFINITIONS, getAgentDefinition } from './definitions';
import { AGENT_TYPES, type AgentType } from '@/types/agent';
import { node } from '@/test/fixtures';

describe('agent definitions', () => {
  it('defines every agent type in the taxonomy', () => {
    for (const type of AGENT_TYPES) {
      expect(AGENT_DEFINITIONS[type], type).toBeDefined();
    }
    expect(ALL_AGENT_DEFINITIONS).toHaveLength(AGENT_TYPES.length);
  });

  it('gives every agent a real system prompt and sane sampling defaults', () => {
    for (const definition of ALL_AGENT_DEFINITIONS) {
      expect(definition.systemPrompt.length, definition.type).toBeGreaterThan(80);
      expect(definition.temperature).toBeGreaterThanOrEqual(0);
      expect(definition.temperature).toBeLessThanOrEqual(2);
      expect(definition.maxTokens).toBeGreaterThan(0);
      expect(definition.estimatedCostUsd).toBeGreaterThan(0);
      expect(definition.estimatedLatencyMs).toBeGreaterThan(0);
    }
  });

  it('pins no agent to a provider, so DEFAULT_LLM_PROVIDER governs', () => {
    // A definition that hardcoded a provider would shadow the env setting
    // entirely — the node would resolve its own value and never consult it.
    for (const definition of ALL_AGENT_DEFINITIONS) {
      expect(definition.provider, definition.type).toBeUndefined();
    }
  });

  it('still resolves to the mock by default, so nothing bills by accident', () => {
    // The safety property is unchanged; it now comes from the env default
    // (`DEFAULT_LLM_PROVIDER` defaults to `mock`) rather than from the
    // definitions, which is what makes the setting switchable.
    for (const definition of ALL_AGENT_DEFINITIONS) {
      expect(createDefaultAgent(definition.type).resolveProvider().id, definition.type).toBe(
        'mock',
      );
    }
  });

  it('gives deterministic agents a lower temperature than creative ones', () => {
    // A retriever that paraphrases is a bug; a critic that never varies is dull.
    expect(AGENT_DEFINITIONS.retriever.temperature).toBeLessThan(
      AGENT_DEFINITIONS.critic.temperature,
    );
  });

  it('looks up a definition by type', () => {
    expect(getAgentDefinition('coder').name).toBe('Coder');
  });
});

describe('createAgent', () => {
  it.each(AGENT_TYPES)('constructs a %s agent', (type) => {
    const agent = createDefaultAgent(type);

    expect(agent.type).toBe(type);
    expect(agent.systemPrompt.length).toBeGreaterThan(0);
  });

  it('falls back to the custom agent for an unrecognised type', () => {
    const agent = createAgent({ ...AGENT_DEFINITIONS.custom, type: 'unknown' as AgentType });

    expect(agent).toBeDefined();
    expect(agent.systemPrompt.length).toBeGreaterThan(0);
  });

  it('exposes the config through convenience getters', () => {
    const agent = createDefaultAgent('planner');

    expect(agent.name).toBe('Planner');
    expect(agent.maxTokens).toBe(AGENT_DEFINITIONS.planner.maxTokens);
    expect(agent.estimatedCost).toBe(AGENT_DEFINITIONS.planner.estimatedCostUsd);
    expect(agent.estimatedLatency).toBe(AGENT_DEFINITIONS.planner.estimatedLatencyMs);
  });
});

describe('resolveNodeAgentConfig', () => {
  it('inherits the agent defaults when nothing is overridden', () => {
    const config = resolveNodeAgentConfig('planner', 'My Planner', {});

    expect(config.systemPrompt).toBe(AGENT_DEFINITIONS.planner.systemPrompt);
    expect(config.temperature).toBe(AGENT_DEFINITIONS.planner.temperature);
    expect(config.maxTokens).toBe(AGENT_DEFINITIONS.planner.maxTokens);
  });

  it('takes its name from the node label', () => {
    expect(resolveNodeAgentConfig('planner', 'Review Planner', {}).name).toBe('Review Planner');
  });

  it('falls back to the definition name for a blank label', () => {
    expect(resolveNodeAgentConfig('planner', '', {}).name).toBe('Planner');
  });

  it('applies each override independently', () => {
    const config = resolveNodeAgentConfig('planner', 'P', {
      temperature: 0.95,
      maxTokens: 4_000,
      provider: 'anthropic',
    });

    expect(config.temperature).toBe(0.95);
    expect(config.maxTokens).toBe(4_000);
    expect(config.provider).toBe('anthropic');
    // Untouched fields still come from the definition.
    expect(config.systemPrompt).toBe(AGENT_DEFINITIONS.planner.systemPrompt);
  });

  it('accepts a temperature of 0 rather than treating it as unset', () => {
    expect(resolveNodeAgentConfig('planner', 'P', { temperature: 0 }).temperature).toBe(0);
  });

  it('leaves the provider unset when the node does not pin one', () => {
    // The regression this guards: definitions used to carry `provider: 'mock'`,
    // which meant every node resolved an explicit provider and
    // DEFAULT_LLM_PROVIDER was silently ignored for actual execution.
    expect(resolveNodeAgentConfig('planner', 'P', {}).provider).toBeUndefined();
  });

  it('ignores a whitespace-only system prompt override', () => {
    const config = resolveNodeAgentConfig('planner', 'P', { systemPrompt: '   ' });

    expect(config.systemPrompt).toBe(AGENT_DEFINITIONS.planner.systemPrompt);
  });

  it('uses a real system prompt override', () => {
    const config = resolveNodeAgentConfig('planner', 'P', { systemPrompt: 'Be terse.' });

    expect(config.systemPrompt).toBe('Be terse.');
  });

  it('honours a caller-supplied defaults table', () => {
    // This is how persisted AgentConfiguration rows reach the engine.
    const custom = {
      ...AGENT_DEFINITIONS,
      planner: { ...AGENT_DEFINITIONS.planner, systemPrompt: 'Custom org prompt.' },
    };

    expect(resolveNodeAgentConfig('planner', 'P', {}, custom).systemPrompt).toBe(
      'Custom org prompt.',
    );
  });
});

describe('createAgentForNode', () => {
  it('builds the agent described by the node', () => {
    const agent = createAgentForNode(node('n1', 'reviewer', { label: 'Contract reviewer' }));

    expect(agent.type).toBe('reviewer');
    expect(agent.name).toBe('Contract reviewer');
  });

  it('carries node overrides into the executable agent', () => {
    const agent = createAgentForNode(
      node('n1', 'coder', { config: { temperature: 0.05, maxTokens: 900 } }),
    );

    expect(agent.temperature).toBe(0.05);
    expect(agent.maxTokens).toBe(900);
  });
});

describe('agent execution', () => {
  it('produces prompts, output, usage and cost through the mock provider', async () => {
    const agent = createDefaultAgent('planner');

    const result = await agent.execute({
      task: 'Ship a rate limiter',
      upstream: [],
      nodeId: 'n1',
      nodeLabel: 'Planner',
      attempt: 1,
    });

    expect(result.output.length).toBeGreaterThan(0);
    expect(result.systemPrompt).toBe(AGENT_DEFINITIONS.planner.systemPrompt);
    expect(result.userPrompt).toContain('Ship a rate limiter');
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.provider).toBe('mock');
  });

  it('puts an attached document in the prompt, ahead of upstream commentary', async () => {
    // Ordering is the point: a reviewer that reads a summary of a contract
    // instead of the contract will confidently review the summary.
    const agent = createDefaultAgent('reviewer');

    const result = await agent.execute({
      task: 'Find the risks that block signature',
      document: {
        name: 'licence.pdf',
        text: 'Clause 7.2 — the indemnity is uncapped.',
        pages: 12,
        truncated: false,
      },
      upstream: [
        {
          nodeId: 'n0',
          agentType: 'planner',
          label: 'Plan',
          output: 'first read the agreement',
          confidence: 0.9,
        },
      ],
      nodeId: 'n1',
      nodeLabel: 'Reviewer',
      attempt: 1,
    });

    expect(result.userPrompt).toContain('licence.pdf');
    expect(result.userPrompt).toContain('the indemnity is uncapped');
    expect(result.userPrompt.indexOf('Attached document')).toBeLessThan(
      result.userPrompt.indexOf('Upstream context'),
    );
  });

  it('says so in the prompt when the document was truncated', async () => {
    // A model that assumes it has the whole agreement will report on clauses
    // that are simply missing.
    const agent = createDefaultAgent('legal_validator');

    const result = await agent.execute({
      task: 'Check it',
      document: { name: 'long.pdf', text: 'Clause 1.', pages: 400, truncated: true },
      upstream: [],
      nodeId: 'n1',
      nodeLabel: 'Legal Validator',
      attempt: 1,
    });

    expect(result.userPrompt).toContain('truncated');
  });

  it('leaves the prompt untouched when no document is attached', async () => {
    const agent = createDefaultAgent('reviewer');

    const result = await agent.execute({
      task: 'Review it',
      upstream: [],
      nodeId: 'n1',
      nodeLabel: 'Reviewer',
      attempt: 1,
    });

    expect(result.userPrompt).not.toContain('Attached document');
  });

  it('replays upstream context into the prompt', async () => {
    const agent = createDefaultAgent('reviewer');

    const result = await agent.execute({
      task: 'Review it',
      upstream: [
        {
          nodeId: 'n0',
          agentType: 'coder',
          label: 'Implementation',
          output: 'the code that was written',
          confidence: 0.9,
        },
      ],
      nodeId: 'n1',
      nodeLabel: 'Reviewer',
      attempt: 1,
    });

    expect(result.userPrompt).toContain('Upstream context');
    expect(result.userPrompt).toContain('the code that was written');
  });

  it('never lets a node claim more confidence than its weakest input', async () => {
    // Errors compound downstream; pretending otherwise is how agent systems mislead.
    const agent = createDefaultAgent('reviewer');
    const input = {
      task: 'Review it',
      nodeId: 'n1',
      nodeLabel: 'Reviewer',
      attempt: 1,
    };

    const alone = await agent.execute({ ...input, upstream: [] });
    const afterShakyInput = await agent.execute({
      ...input,
      upstream: [
        {
          nodeId: 'n0',
          agentType: 'researcher',
          label: 'Shaky research',
          output: 'we are not sure about any of this',
          confidence: 0.2,
        },
      ],
    });

    expect(afterShakyInput.confidence).toBeLessThan(alone.confidence);
  });

  it('flags a retry in the prompt so the model knows to be careful', async () => {
    const agent = createDefaultAgent('coder');

    const result = await agent.execute({
      task: 'Write it',
      upstream: [],
      nodeId: 'n1',
      nodeLabel: 'Coder',
      attempt: 3,
    });

    expect(result.userPrompt).toContain('attempt 3');
  });

  it('resolves to the mock provider when no credentials are configured', () => {
    expect(createDefaultAgent('planner').resolveProvider().id).toBe('mock');
  });
});

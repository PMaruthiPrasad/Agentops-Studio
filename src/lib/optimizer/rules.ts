import type {
  GraphPatch,
  OptimizationSuggestion,
  OptimizerContext,
  OptimizerRule,
} from '@/types/optimizer';
import type { AgentType } from '@/types/agent';
import { ALWAYS, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from '@/types/workflow';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { applyPatch } from '@/lib/workflow/graph-utils';
import { findCycle } from '@/lib/workflow/validate';
import { buildAdjacency, computeTopology, findTerminalNodes } from '@/lib/workflow/topology';
import { nodeCostUsd, nodeLatencyMs } from './projection';

/**
 * The optimizer rule set.
 *
 * Each rule is a pure function of the graph. That is a deliberate choice: an
 * LLM asked to "review this workflow" gives different answers on every call,
 * which is useless for a tool an engineer is supposed to trust. Findings here
 * are deterministic and reproducible; the LLM's job (see `narrative.ts`) is to
 * *explain* them, not to discover them.
 *
 * Every rule returns a `GraphPatch` when — and only when — the fix can be
 * expressed exactly and provably keeps the graph acyclic.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const KNOWLEDGE_GATHERING: ReadonlySet<AgentType> = new Set<AgentType>([
  'researcher',
  'retriever',
  'knowledge',
]);

/** Agent types where a second copy is nearly always redundant. */
const SINGLETON_AGENTS: ReadonlySet<AgentType> = new Set<AgentType>([
  'planner',
  'reviewer',
  'critic',
  'legal_validator',
]);

const LEGAL_SIGNALS = [
  'legal', 'contract', 'licen', 'complian', 'gdpr', 'agreement', 'clause',
  'liabilit', 'regulat', 'terms', 'nda', 'msa', 'dpa', 'counsel', 'statut',
  'indemn', 'jurisdiction', 'policy', 'privacy', 'audit',
];

function edgesFrom(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

function edgesTo(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

function makeEdge(source: string, target: string, condition = ALWAYS): WorkflowEdge {
  return { id: `opt_${source}__${target}`, source, target, condition };
}

/** A patch is only offered as an auto-fix if the result still validates. */
function isSafePatch(graph: WorkflowGraph, patch: GraphPatch): boolean {
  try {
    const next = applyPatch(graph, patch);
    if (next.nodes.length === 0) return false;
    if (findCycle(next)) return false;
    // Every node must remain reachable from some entry point.
    const hasIncoming = new Set(next.edges.map((e) => e.target));
    const roots = next.nodes.filter((n) => !hasIncoming.has(n.id));
    return roots.length > 0;
  } catch {
    return false;
  }
}

function severityFrom(count: number): OptimizationSuggestion['severity'] {
  if (count >= 3) return 'high';
  if (count === 2) return 'medium';
  return 'low';
}

/* -------------------------------------------------------------------------- */
/* Rule 1 — run independent knowledge-gathering nodes in parallel             */
/* -------------------------------------------------------------------------- */

const parallelizeIndependentResearch: OptimizerRule = {
  id: 'parallelize-independent-research',
  title: 'Run research and retrieval in parallel',
  category: 'parallelism',
  weight: 1.4,
  evaluate: ({ graph }) => {
    const suggestions: OptimizationSuggestion[] = [];
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;

      // Both ends must be knowledge-gathering: those agents read from the world,
      // not from each other, so chaining them is almost always accidental.
      if (!KNOWLEDGE_GATHERING.has(source.type) || !KNOWLEDGE_GATHERING.has(target.type)) continue;

      // Only safe when the target has no *other* dependency it genuinely needs.
      const targetIncoming = edgesTo(graph, target.id);
      if (targetIncoming.length !== 1) continue;
      if (edge.condition.kind !== 'always') continue;

      // Re-point the target at the source's own predecessors so it starts at
      // the same time rather than after.
      const sourceIncoming = edgesTo(graph, source.id);
      const patch: GraphPatch = {
        removeEdgeIds: [edge.id],
        addEdges: sourceIncoming.map((incoming) => makeEdge(incoming.source, target.id)),
      };

      const savingMs = Math.min(nodeLatencyMs(source), nodeLatencyMs(target));

      suggestions.push({
        id: `${parallelizeIndependentResearch.id}:${edge.id}`,
        ruleId: parallelizeIndependentResearch.id,
        title: `Run ${source.label} and ${target.label} in parallel`,
        description: `Remove the dependency ${source.label} → ${target.label} so both dispatch in the same layer.`,
        reasoning:
          `${target.label} is a ${target.type} agent whose only input is ${source.label}, another ` +
          `knowledge-gathering agent. Neither consumes the other's output in a meaningful way — ` +
          `they both read from external sources. Chaining them serialises ` +
          `${Math.round(savingMs)}ms of wall-clock time for no benefit. Running them in the same ` +
          `layer removes the shorter of the two from the critical path entirely.`,
        severity: 'high',
        category: 'parallelism',
        affectedNodeIds: [source.id, target.id],
        estimatedLatencyReductionMs: Math.round(savingMs),
        estimatedCostReductionUsd: 0,
        autoFixable: isSafePatch(graph, patch),
        patch,
      });
    }

    return suggestions;
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 2 — duplicate agents                                                  */
/* -------------------------------------------------------------------------- */

const removeDuplicateAgents: OptimizerRule = {
  id: 'duplicate-agent',
  title: 'Remove duplicate agents',
  category: 'redundancy',
  weight: 1.3,
  evaluate: ({ graph }) => {
    const suggestions: OptimizationSuggestion[] = [];
    const byType = new Map<AgentType, WorkflowNode[]>();

    for (const node of graph.nodes) {
      const bucket = byType.get(node.type);
      if (bucket) bucket.push(node);
      else byType.set(node.type, [node]);
    }

    for (const [type, nodes] of byType) {
      if (nodes.length < 2 || !SINGLETON_AGENTS.has(type)) continue;

      const [keep, ...duplicates] = nodes;
      if (!keep) continue;

      for (const duplicate of duplicates) {
        // Rewire the duplicate's connections onto the node we keep, so removing
        // it cannot strand any part of the graph.
        const incoming = edgesTo(graph, duplicate.id);
        const outgoing = edgesFrom(graph, duplicate.id);

        const rewired: WorkflowEdge[] = [
          ...incoming
            .filter((edge) => edge.source !== keep.id)
            .map((edge) => makeEdge(edge.source, keep.id, edge.condition)),
          ...outgoing
            .filter((edge) => edge.target !== keep.id)
            .map((edge) => makeEdge(keep.id, edge.target, edge.condition)),
        ];

        const patch: GraphPatch = {
          removeNodeIds: [duplicate.id],
          addEdges: rewired,
        };

        suggestions.push({
          id: `${removeDuplicateAgents.id}:${duplicate.id}`,
          ruleId: removeDuplicateAgents.id,
          title: `Remove duplicate ${AGENT_DEFINITIONS[type].name}`,
          description: `"${duplicate.label}" duplicates "${keep.label}". Merge its connections into the one you keep.`,
          reasoning:
            `A ${type} agent is a judgement step, not a transform — running two of them over the ` +
            `same material produces two opinions with no mechanism to reconcile them, and the ` +
            `downstream node silently picks whichever arrives. You pay ` +
            `$${nodeCostUsd(duplicate).toFixed(4)} and ${nodeLatencyMs(duplicate)}ms for ambiguity. ` +
            `If the two are meant to review *different* things, give them distinct labels and ` +
            `system prompts so the intent is legible.`,
          severity: 'medium',
          category: 'redundancy',
          affectedNodeIds: [keep.id, duplicate.id],
          estimatedLatencyReductionMs: nodeLatencyMs(duplicate),
          estimatedCostReductionUsd: Number(nodeCostUsd(duplicate).toFixed(6)),
          autoFixable: isSafePatch(graph, patch),
          patch,
        });
      }
    }

    return suggestions;
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 3 — Reviewer must run after Tester                                    */
/* -------------------------------------------------------------------------- */

const reviewerAfterTester: OptimizerRule = {
  id: 'reviewer-after-tester',
  title: 'Reviewer should execute after Tester',
  category: 'ordering',
  weight: 1.2,
  evaluate: ({ graph }) => {
    const suggestions: OptimizationSuggestion[] = [];
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (source?.type !== 'reviewer' || target?.type !== 'tester') continue;

      // Swap the pair: predecessors → tester → reviewer → successors.
      const reviewerIncoming = edgesTo(graph, source.id).filter((e) => e.source !== target.id);
      const testerOutgoing = edgesFrom(graph, target.id).filter((e) => e.target !== source.id);

      const patch: GraphPatch = {
        removeEdgeIds: [edge.id, ...reviewerIncoming.map((e) => e.id), ...testerOutgoing.map((e) => e.id)],
        addEdges: [
          ...reviewerIncoming.map((e) => makeEdge(e.source, target.id, e.condition)),
          makeEdge(target.id, source.id),
          ...testerOutgoing.map((e) => makeEdge(source.id, e.target, e.condition)),
        ],
      };

      suggestions.push({
        id: `${reviewerAfterTester.id}:${edge.id}`,
        ruleId: reviewerAfterTester.id,
        title: `Move ${source.label} after ${target.label}`,
        description: `Swap the order so tests run first and the reviewer sees the results.`,
        reasoning:
          `${source.label} currently reviews code that has not been tested yet, so it spends its ` +
          `budget predicting failures the test suite is about to report as facts. Reviewing after ` +
          `${target.label} means the reviewer reads real pass/fail output and can focus on the ` +
          `things tests cannot catch — design, naming, and missing cases. Same cost, strictly ` +
          `more information.`,
        severity: 'medium',
        category: 'ordering',
        affectedNodeIds: [source.id, target.id],
        estimatedLatencyReductionMs: 0,
        estimatedCostReductionUsd: 0,
        autoFixable: isSafePatch(graph, patch),
        patch,
      });
    }

    return suggestions;
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 4 — Legal Validator only in legal workflows                           */
/* -------------------------------------------------------------------------- */

const legalValidatorRelevance: OptimizerRule = {
  id: 'legal-validator-relevance',
  title: 'Legal Validator only required for legal workflows',
  category: 'relevance',
  weight: 1.2,
  evaluate: ({ graph, workflowName, workflowDescription, tags }) => {
    const legalNodes = graph.nodes.filter((node) => node.type === 'legal_validator');
    if (legalNodes.length === 0) return [];

    // Look for legal signals anywhere the user expressed intent.
    const haystack = [
      workflowName,
      workflowDescription,
      ...tags,
      ...graph.nodes.filter((n) => n.type !== 'legal_validator').flatMap((n) => [n.label, n.description]),
      ...graph.nodes.map((n) => n.config.systemPrompt ?? ''),
    ]
      .join(' ')
      .toLowerCase();

    const matched = LEGAL_SIGNALS.filter((signal) => haystack.includes(signal));
    if (matched.length > 0) return [];

    return legalNodes.map((node) => {
      // Bridge around the node so removing it doesn't break the chain.
      const incoming = edgesTo(graph, node.id);
      const outgoing = edgesFrom(graph, node.id);
      const bridges: WorkflowEdge[] = [];
      for (const inbound of incoming) {
        for (const outbound of outgoing) {
          if (inbound.source !== outbound.target) {
            bridges.push(makeEdge(inbound.source, outbound.target));
          }
        }
      }

      const patch: GraphPatch = { removeNodeIds: [node.id], addEdges: bridges };

      return {
        id: `${legalValidatorRelevance.id}:${node.id}`,
        ruleId: legalValidatorRelevance.id,
        title: `Drop ${node.label} — this is not a legal workflow`,
        description: `No legal, contractual, or compliance signal appears anywhere in this workflow.`,
        reasoning:
          `Legal Validator is one of the most expensive agents in the catalogue ` +
          `($${nodeCostUsd(node).toFixed(4)}, ~${nodeLatencyMs(node)}ms) because it reads clause by ` +
          `clause. Nothing in the workflow name, description, tags, or any other node's prompt ` +
          `mentions a contract, licence, regulation, or policy. Running it here produces a ` +
          `compliance review of material that has no compliance surface — cost with no signal. ` +
          `If this workflow *is* legal in nature, add a tag such as "legal" or "compliance" and ` +
          `this suggestion will stop firing.`,
        severity: 'medium',
        category: 'relevance',
        affectedNodeIds: [node.id],
        estimatedLatencyReductionMs: nodeLatencyMs(node),
        estimatedCostReductionUsd: Number(nodeCostUsd(node).toFixed(6)),
        autoFixable: isSafePatch(graph, patch),
        patch,
      } satisfies OptimizationSuggestion;
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 5 — Critic belongs before the final synthesis                         */
/* -------------------------------------------------------------------------- */

const criticBeforeSynthesis: OptimizerRule = {
  id: 'critic-before-synthesis',
  title: 'Move Critic before final synthesis',
  category: 'ordering',
  weight: 1.1,
  evaluate: ({ graph }) => {
    const critics = graph.nodes.filter((node) => node.type === 'critic');
    if (critics.length === 0) return [];

    const terminals = findTerminalNodes(graph);
    const terminalIds = new Set(terminals.map((node) => node.id));
    const suggestions: OptimizationSuggestion[] = [];

    for (const critic of critics) {
      if (!terminalIds.has(critic.id)) continue;

      const otherTerminals = terminals.filter((node) => node.id !== critic.id);

      if (otherTerminals.length === 0) {
        // The critic IS the output. Nothing can act on the critique.
        suggestions.push({
          id: `${criticBeforeSynthesis.id}:terminal:${critic.id}`,
          ruleId: criticBeforeSynthesis.id,
          title: `${critic.label} is the final node — its critique changes nothing`,
          description: `Add a synthesis step after the Critic so its findings are actually applied.`,
          reasoning:
            `A critique that no downstream agent consumes is a report nobody reads. ` +
            `${critic.label} currently terminates the graph, so every weakness it identifies is ` +
            `recorded and then discarded. Either place it before the node that produces the final ` +
            `answer, or accept that the run's output is a critique rather than a deliverable.`,
          severity: 'medium',
          category: 'ordering',
          affectedNodeIds: [critic.id],
          estimatedLatencyReductionMs: 0,
          estimatedCostReductionUsd: 0,
          autoFixable: false,
        });
        continue;
      }

      // Wire the critic into the real terminal so its output is consumed.
      const target = otherTerminals[0];
      if (!target) continue;

      const patch: GraphPatch = { addEdges: [makeEdge(critic.id, target.id)] };

      suggestions.push({
        id: `${criticBeforeSynthesis.id}:${critic.id}`,
        ruleId: criticBeforeSynthesis.id,
        title: `Feed ${critic.label} into ${target.label}`,
        description: `The Critic runs in parallel with the final step instead of informing it.`,
        reasoning:
          `${critic.label} and ${target.label} are both terminal, so the critique is produced at ` +
          `the same time as the deliverable it was meant to improve — too late to change anything. ` +
          `Connecting ${critic.label} → ${target.label} puts the critique upstream of the final ` +
          `synthesis, which is the only position where it can affect the result. This costs one ` +
          `extra serial hop and is almost always worth it.`,
        severity: 'medium',
        category: 'ordering',
        affectedNodeIds: [critic.id, target.id],
        estimatedLatencyReductionMs: 0,
        estimatedCostReductionUsd: 0,
        autoFixable: isSafePatch(graph, patch),
        patch,
      });
    }

    return suggestions;
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 6 — long serial chain                                                 */
/* -------------------------------------------------------------------------- */

const longSerialChain: OptimizerRule = {
  id: 'long-serial-chain',
  title: 'Workflow is heavily serialised',
  category: 'parallelism',
  weight: 1,
  evaluate: ({ graph }) => {
    if (graph.nodes.length < 4) return [];

    let layerCount: number;
    try {
      layerCount = computeTopology(graph).layers.length;
    } catch {
      return [];
    }

    const serialRatio = layerCount / graph.nodes.length;
    if (serialRatio < 0.85) return [];

    const totalLatency = graph.nodes.reduce((total, node) => total + nodeLatencyMs(node), 0);

    return [
      {
        id: `${longSerialChain.id}:graph`,
        ruleId: longSerialChain.id,
        title: `${layerCount} sequential layers for ${graph.nodes.length} nodes`,
        description: `Almost nothing in this workflow runs concurrently.`,
        reasoning:
          `Wall-clock time here is the sum of every node: roughly ${(totalLatency / 1000).toFixed(1)}s. ` +
          `A ${graph.nodes.length}-node graph laid out in ${layerCount} layers means each agent waits ` +
          `for the previous one even where there is no real data dependency. Look for nodes that ` +
          `read from the task rather than from their predecessor — those can move into an earlier ` +
          `layer at zero cost.`,
        severity: 'low',
        category: 'parallelism',
        affectedNodeIds: graph.nodes.map((node) => node.id),
        estimatedLatencyReductionMs: 0,
        estimatedCostReductionUsd: 0,
        autoFixable: false,
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 7 — missing planner on a large graph                                  */
/* -------------------------------------------------------------------------- */

const missingPlanner: OptimizerRule = {
  id: 'missing-planner',
  title: 'Large workflow has no Planner',
  category: 'structure',
  weight: 0.8,
  evaluate: ({ graph }) => {
    if (graph.nodes.length < 5) return [];
    if (graph.nodes.some((node) => node.type === 'planner')) return [];

    const hasIncoming = new Set(graph.edges.map((edge) => edge.target));
    const roots = graph.nodes.filter((node) => !hasIncoming.has(node.id));

    return [
      {
        id: `${missingPlanner.id}:graph`,
        ruleId: missingPlanner.id,
        title: 'Add a Planner at the entry point',
        description: `${graph.nodes.length} agents start work with no shared decomposition of the task.`,
        reasoning:
          `With ${roots.length} entry node(s) and no Planner, every downstream agent interprets the ` +
          `raw task independently. That is where multi-agent systems drift: two agents solve ` +
          `slightly different problems and the synthesis step has to reconcile them. A Planner ` +
          `costs ~$${AGENT_DEFINITIONS.planner.estimatedCostUsd.toFixed(4)} and gives every other ` +
          `node the same scope statement to work against.`,
        severity: 'low',
        category: 'structure',
        affectedNodeIds: roots.map((node) => node.id),
        estimatedLatencyReductionMs: 0,
        estimatedCostReductionUsd: 0,
        autoFixable: false,
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 8 — inflated token budgets                                            */
/* -------------------------------------------------------------------------- */

const excessiveTokenBudget: OptimizerRule = {
  id: 'excessive-token-budget',
  title: 'Token budget far above the agent default',
  category: 'cost',
  weight: 1,
  evaluate: ({ graph }) => {
    const suggestions: OptimizationSuggestion[] = [];

    for (const node of graph.nodes) {
      const definition = AGENT_DEFINITIONS[node.type] ?? AGENT_DEFINITIONS.custom;
      const configured = node.config.maxTokens;
      if (configured === undefined) continue;

      const ratio = configured / definition.maxTokens;
      if (ratio < 2) continue;

      const patch: GraphPatch = {
        updateNodes: [{ id: node.id, config: { ...node.config, maxTokens: definition.maxTokens } }],
      };

      const currentCost = nodeCostUsd(node);
      const defaultCost = definition.estimatedCostUsd;

      suggestions.push({
        id: `${excessiveTokenBudget.id}:${node.id}`,
        ruleId: excessiveTokenBudget.id,
        title: `${node.label} allows ${configured.toLocaleString()} output tokens`,
        description: `That is ${ratio.toFixed(1)}× the ${definition.name} default of ${definition.maxTokens.toLocaleString()}.`,
        reasoning:
          `maxTokens is a ceiling, not a target — but generation time and cost both scale with what ` +
          `the model actually emits, and a generous ceiling reliably produces a more verbose answer. ` +
          `Downstream agents then pay to read it. Dropping back to ${definition.maxTokens.toLocaleString()} ` +
          `saves roughly $${Math.max(0, currentCost - defaultCost).toFixed(4)} per run on this node ` +
          `alone, plus the inherited prompt cost at every consumer.`,
        severity: ratio >= 4 ? 'medium' : 'low',
        category: 'cost',
        affectedNodeIds: [node.id],
        estimatedLatencyReductionMs: Math.max(0, nodeLatencyMs(node) - definition.estimatedLatencyMs),
        estimatedCostReductionUsd: Number(Math.max(0, currentCost - defaultCost).toFixed(6)),
        autoFixable: true,
        patch,
      });
    }

    return suggestions;
  },
};

/* -------------------------------------------------------------------------- */
/* Rule 9 — orphaned and dead-end nodes                                       */
/* -------------------------------------------------------------------------- */

const orphanedNodes: OptimizerRule = {
  id: 'orphaned-node',
  title: 'Node is disconnected from the graph',
  category: 'structure',
  weight: 1.5,
  evaluate: ({ graph }) => {
    if (graph.nodes.length < 2) return [];

    const { incoming, outgoing } = buildAdjacency(graph);
    const isolated = graph.nodes.filter(
      (node) => (incoming.get(node.id)?.length ?? 0) === 0 && (outgoing.get(node.id)?.length ?? 0) === 0,
    );

    if (isolated.length === 0) return [];

    const patch: GraphPatch = { removeNodeIds: isolated.map((node) => node.id) };
    const wastedCost = isolated.reduce((total, node) => total + nodeCostUsd(node), 0);

    return [
      {
        id: `${orphanedNodes.id}:graph`,
        ruleId: orphanedNodes.id,
        title: `${isolated.length} disconnected node${isolated.length > 1 ? 's' : ''}`,
        description: `${isolated.map((n) => n.label).join(', ')} — no inputs and no consumers.`,
        reasoning:
          `A node with no edges still executes: the engine treats it as an entry point, it calls ` +
          `the model, and its output goes nowhere. That is $${wastedCost.toFixed(4)} per run for ` +
          `output no one reads. Either connect ${isolated.length > 1 ? 'them' : 'it'} into the ` +
          `graph or delete ${isolated.length > 1 ? 'them' : 'it'}.`,
        severity: severityFrom(isolated.length),
        category: 'structure',
        affectedNodeIds: isolated.map((node) => node.id),
        estimatedLatencyReductionMs: 0, // Isolated nodes run in layer 0, off the critical path.
        estimatedCostReductionUsd: Number(wastedCost.toFixed(6)),
        autoFixable: isSafePatch(graph, patch),
        patch,
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

export const OPTIMIZER_RULES: OptimizerRule[] = [
  parallelizeIndependentResearch,
  removeDuplicateAgents,
  reviewerAfterTester,
  legalValidatorRelevance,
  criticBeforeSynthesis,
  longSerialChain,
  missingPlanner,
  excessiveTokenBudget,
  orphanedNodes,
];

export function runRules(context: OptimizerContext): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  for (const rule of OPTIMIZER_RULES) {
    try {
      suggestions.push(...rule.evaluate(context));
    } catch {
      // A malformed graph must not take the whole report down; the validator
      // reports structural problems separately.
      continue;
    }
  }

  return suggestions;
}

export function getRule(ruleId: string): OptimizerRule | undefined {
  return OPTIMIZER_RULES.find((rule) => rule.id === ruleId);
}

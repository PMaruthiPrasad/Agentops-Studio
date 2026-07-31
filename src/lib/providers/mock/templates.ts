import type { CompletionContext } from '@/types/provider';
import type { SeededRandom } from './random';

/**
 * Agent-shaped response synthesis for the mock provider.
 *
 * The point of this file is that a keyless demo run still *looks* like a real
 * multi-agent system: a Planner emits a dependency-ordered task list, a
 * Retriever emits scored document hits, a Tester emits actual test code, and
 * every agent references both the user's task and its upstream inputs. Without
 * this, the whole product reads as a stub.
 *
 * All variation comes from a seeded PRNG, so output is reproducible.
 */

/** Pulls a short human-readable subject out of the user's task sentence. */
export function extractSubject(task: string): string {
  const cleaned = task
    .replace(/^\s*(please\s+)?(can you\s+)?/i, '')
    .replace(/[.?!]+\s*$/, '')
    .trim();
  if (!cleaned) return 'the requested task';
  const words = cleaned.split(/\s+/);
  return words.length <= 12 ? cleaned : `${words.slice(0, 12).join(' ')}…`;
}

/** Content words from the task, used to make output feel task-specific. */
export function extractKeywords(task: string, rng: SeededRandom, count = 4): string[] {
  const stopWords = new Set([
    'the','a','an','and','or','but','for','with','from','into','that','this','these','those',
    'is','are','was','were','be','been','being','to','of','in','on','at','by','it','its','as',
    'you','your','we','our','identify','review','create','build','write','generate','analyze',
    'please','can','should','would','need','make','using','use','about','then','than','also',
  ]);

  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const unique = [...new Set(words)];
  if (unique.length === 0) return ['scope', 'requirements', 'constraints', 'acceptance criteria'];
  return rng.sample(unique, Math.min(count, unique.length));
}

function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

/** Compact reference to what flowed in from upstream nodes. */
function upstreamDigest(context: CompletionContext): string {
  if (context.upstream.length === 0) {
    return '_No upstream context — operating directly on the task statement._';
  }
  const lines = context.upstream.map((item) => {
    const firstLine =
      item.output
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find((l) => l.length > 0) ?? '(empty)';
    return `- **${item.label}** (${item.agentType}): ${firstLine.slice(0, 120)}`;
  });
  return `Inherited context from ${context.upstream.length} upstream node(s):\n${lines.join('\n')}`;
}

/* -------------------------------------------------------------------------- */
/* Per-agent generators                                                       */
/* -------------------------------------------------------------------------- */

function planner(context: CompletionContext, rng: SeededRandom): string {
  const subject = extractSubject(context.task);
  const keywords = extractKeywords(context.task, rng, 4);
  const agents = ['Researcher', 'Retriever', 'Knowledge', 'Coder', 'Reviewer', 'Critic', 'Tester'];
  const stepCount = rng.int(4, 6);

  const verbs = [
    'Establish scope and success criteria for',
    'Gather authoritative source material on',
    'Extract and normalise the key entities in',
    'Draft the primary deliverable covering',
    'Cross-check internal consistency of',
    'Produce the final synthesis for',
  ];

  const steps: string[] = [];
  for (let i = 0; i < stepCount; i += 1) {
    const owner = agents[i % agents.length] ?? 'Researcher';
    const verb = verbs[i % verbs.length] ?? 'Advance';
    const focus = keywords[i % keywords.length] ?? 'the objective';
    const dependsOn = i === 0 ? 'none' : `T${i}`;
    steps.push(
      `**T${i + 1} — ${verb} ${focus}**\n` +
        `   - owner: \`${owner}\`\n` +
        `   - depends on: ${dependsOn}\n` +
        `   - done when: a reviewable artifact for "${focus}" exists with stated assumptions`,
    );
  }

  const risks = rng.sample(
    [
      'Source material may be incomplete; budget one retrieval retry.',
      'Downstream synthesis is the critical path — keep its context window small.',
      'Two research branches can run concurrently without conflicting.',
      'Ambiguity in the task statement may require an assumption to be recorded.',
      'Validation depends on the draft; do not start it early.',
    ],
    3,
  );

  return `## Execution Plan

**Objective:** ${subject}

${upstreamDigest(context)}

### Decomposition (${stepCount} subtasks)

${steps.join('\n\n')}

### Parallelisation
T2 and T3 are independent and should be dispatched in the same layer. Everything
downstream of T3 is strictly sequential because it consumes merged context.

### Risks
${bullets(risks)}

### Handoff
Downstream agents should treat T1's scope statement as authoritative and flag any
contradiction rather than silently resolving it.`;
}

function researcher(context: CompletionContext, rng: SeededRandom): string {
  const subject = extractSubject(context.task);
  const keywords = extractKeywords(context.task, rng, 3);
  const findingCount = rng.int(3, 4);

  const shapes = [
    (k: string) =>
      `Current practice around **${k}** consolidated in the last 18 months; the older approach is now considered legacy.`,
    (k: string) =>
      `Three independent sources agree on the definition of **${k}**, but disagree on how strictly it is enforced.`,
    (k: string) =>
      `**${k}** is the most common failure point reported in post-mortems of comparable efforts.`,
    (k: string) =>
      `Tooling for **${k}** matured significantly; the manual workaround previously required is no longer necessary.`,
    (k: string) =>
      `Cost of getting **${k}** wrong is asymmetric — cheap to prevent, expensive to remediate.`,
  ];

  const findings: string[] = [];
  for (let i = 0; i < findingCount; i += 1) {
    const keyword = keywords[i % keywords.length] ?? 'the topic';
    const shape = shapes[rng.int(0, shapes.length - 1)] ?? shapes[0]!;
    const confidence = rng.float(0.68, 0.95).toFixed(2);
    findings.push(
      `**F${i + 1}.** ${shape(keyword)}\n   - confidence: ${confidence}\n   - corroborating sources: ${rng.int(2, 5)}`,
    );
  }

  const gaps = rng.sample(
    [
      'No primary source found for the quantitative claims; treat figures as indicative.',
      'Regional variation was not investigated and may matter.',
      'One source is over three years old and may be superseded.',
      'Vendor-published material dominates; independent verification is thin.',
    ],
    2,
  );

  return `## Research Summary

**Question:** ${subject}

${upstreamDigest(context)}

### Findings

${findings.join('\n\n')}

### Synthesis
The evidence converges on a single recommendation: address ${keywords[0] ?? 'the core concern'}
first, because every other finding is downstream of it. The remaining items are
refinements rather than blockers.

### Evidence gaps
${bullets(gaps)}`;
}

function retriever(context: CompletionContext, rng: SeededRandom): string {
  const keywords = extractKeywords(context.task, rng, 3);
  const docCount = rng.int(4, 6);

  const collections = ['internal-wiki', 'policy-archive', 'eng-handbook', 'contracts-v3', 'rfc-index'];
  const kinds = ['spec', 'policy', 'post-mortem', 'contract', 'runbook', 'design-doc'];

  const rows: string[] = [];
  let score = rng.float(0.88, 0.96);
  for (let i = 0; i < docCount; i += 1) {
    const collection = rng.pick(collections);
    const kind = rng.pick(kinds);
    const keyword = keywords[i % keywords.length] ?? 'general';
    rows.push(
      `| ${i + 1} | \`${collection}/${kind}-${String(rng.int(100, 999))}.md\` | ${score.toFixed(3)} | ${kind} covering ${keyword} |`,
    );
    // Relevance decays down the ranked list, as it would with a real index.
    score = Math.max(0.31, score - rng.float(0.06, 0.14));
  }

  const chunks = rng.int(docCount * 3, docCount * 8);

  return `## Retrieved Context

**Query expansion:** ${keywords.map((k) => `\`${k}\``).join(', ')}

${upstreamDigest(context)}

### Ranked results

| # | document | score | summary |
|---|----------|-------|---------|
${rows.join('\n')}

### Index statistics
- chunks scanned: **${chunks}**
- chunks returned: **${docCount}**
- embedding model: \`text-embedding-sim-3-small\`
- median chunk relevance: **${rng.float(0.52, 0.74).toFixed(3)}**

### Note for downstream agents
Results 1–${Math.min(3, docCount)} are high confidence. Anything below score 0.45 is
included for recall only and should not be quoted as authoritative.`;
}

function knowledge(context: CompletionContext, rng: SeededRandom): string {
  const keywords = extractKeywords(context.task, rng, 4);
  const entities = keywords.map(
    (k, i) =>
      `| \`E${i + 1}\` | **${k}** | ${rng.pick(['concept', 'obligation', 'artifact', 'actor', 'metric'])} | ${rng.int(2, 9)} references |`,
  );

  const relations = keywords
    .slice(0, Math.max(1, keywords.length - 1))
    .map((k, i) => `- **${k}** → \`${rng.pick(['depends_on', 'constrains', 'produces', 'validates'])}\` → **${keywords[i + 1] ?? 'outcome'}**`);

  return `## Knowledge Base Extract

${upstreamDigest(context)}

### Entities

| id | entity | kind | support |
|----|--------|------|---------|
${entities.join('\n')}

### Relationships
${relations.join('\n')}

### Canonical definitions
${bullets(
  keywords.slice(0, 3).map((k) => `**${k}** — the operative definition in this domain scopes it narrowly; broader colloquial usage does not apply here.`),
)}

### Conflicts detected
${rng.bool(0.4)
    ? `One conflict: **${keywords[0] ?? 'the primary entity'}** is defined differently in \`policy-archive\` than in \`eng-handbook\`. The policy definition takes precedence.`
    : 'None. All sources agree on the entity definitions above.'}`;
}

function coder(context: CompletionContext, rng: SeededRandom): string {
  const subject = extractSubject(context.task);
  const keyword = extractKeywords(context.task, rng, 1)[0] ?? 'feature';
  const identifier = keyword.replace(/[^a-z0-9]/gi, '');
  const symbol = identifier.charAt(0).toUpperCase() + identifier.slice(1);

  return `## Implementation

**Target:** ${subject}

${upstreamDigest(context)}

### Approach
Isolate the logic behind a narrow interface so it can be tested without I/O, then
wire it at the call site. No behaviour change outside the new module.

\`\`\`typescript
export interface ${symbol}Options {
  /** Hard ceiling on work performed per invocation. */
  limit: number;
  /** Abort cooperatively when the caller cancels. */
  signal?: AbortSignal;
}

export interface ${symbol}Result {
  processed: number;
  skipped: number;
  errors: string[];
}

export async function process${symbol}(
  items: readonly string[],
  options: ${symbol}Options,
): Promise<${symbol}Result> {
  const result: ${symbol}Result = { processed: 0, skipped: 0, errors: [] };

  for (const item of items.slice(0, options.limit)) {
    if (options.signal?.aborted) break;

    if (!item.trim()) {
      result.skipped += 1;
      continue;
    }

    try {
      await handle(item);
      result.processed += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}
\`\`\`

### Files touched
- \`src/lib/${identifier || 'feature'}/index.ts\` — new module (${rng.int(48, 120)} lines)
- \`src/app/api/${identifier || 'feature'}/route.ts\` — wiring (${rng.int(8, 24)} lines changed)

### Deliberate omissions
${bullets([
  'No caching layer — premature until we have real traffic numbers.',
  'Errors are collected rather than thrown so one bad item cannot abort the batch.',
  `Concurrency is sequential; parallelising is a follow-up once ${keyword} throughput is measured.`,
])}`;
}

function reviewer(context: CompletionContext, rng: SeededRandom): string {
  const blocking = rng.int(0, 2);
  const nonBlocking = rng.int(2, 4);
  const verdict = blocking === 0 ? 'Approve with comments' : 'Request changes';

  const blockingIssues = [
    'Unbounded loop over caller-supplied input — needs an explicit limit.',
    'Error path swallows the original cause, making production triage impossible.',
    'Race between the read and the write; two concurrent callers can clobber state.',
  ];
  const minorIssues = [
    'Prefer a discriminated union over the boolean flag pair — the invalid combination is currently representable.',
    'The magic number should be a named constant with a comment explaining its origin.',
    'Duplicate normalisation logic; extract it now while there are only two call sites.',
    'Public function lacks a doc comment describing the abort semantics.',
    'Test asserts on the message string rather than the error type; brittle under rewording.',
  ];

  return `## Code Review

**Verdict: ${verdict}**

${upstreamDigest(context)}

### Blocking (${blocking})
${blocking === 0 ? '_None._' : bullets(rng.sample(blockingIssues, blocking))}

### Non-blocking (${nonBlocking})
${bullets(rng.sample(minorIssues, nonBlocking))}

### Checklist
- [x] Behaviour matches the stated requirement
- [x] Error handling present on every I/O boundary
- [${rng.bool(0.75) ? 'x' : ' '}] Test coverage for the new branch logic
- [${rng.bool(0.6) ? 'x' : ' '}] Naming consistent with the surrounding module
- [x] No secrets, credentials, or PII in logs

### Summary
The change is structurally sound. ${
    blocking === 0
      ? 'Nothing here needs to block the merge; the comments are quality nits.'
      : `Fix the ${blocking} blocking item${blocking > 1 ? 's' : ''} and this is ready.`
  }`;
}

function critic(context: CompletionContext, rng: SeededRandom): string {
  const score = rng.float(6.1, 8.9);
  const subject = extractSubject(context.task);

  const strengths = rng.sample(
    [
      'The reasoning chain is explicit and each step is independently checkable.',
      'Assumptions are stated rather than buried, which makes them falsifiable.',
      'Scope is held tight; no speculative additions crept in.',
      'Trade-offs are named with their costs, not just their benefits.',
    ],
    2,
  );

  const weaknesses = rng.sample(
    [
      'The confident tone outruns the evidence in at least one place — hedging would be more honest.',
      'One conclusion does not follow from its stated premises; the gap is filled by an unstated assumption.',
      'No consideration of the failure case where the upstream input is empty or malformed.',
      'Quantitative claims are presented without their source or margin of error.',
      'The alternative approach is dismissed in a clause rather than actually evaluated.',
    ],
    rng.int(2, 3),
  );

  return `## Critique

**Subject:** ${subject}
**Score: ${score.toFixed(1)}/10**

${upstreamDigest(context)}

### What holds up
${bullets(strengths)}

### What does not
${bullets(weaknesses)}

### Logical gaps
${numbered([
  'The transition from evidence to recommendation skips the step where alternatives are ruled out.',
  'Edge-case behaviour is asserted, not demonstrated.',
])}

### Recommendation
${
  score > 7.5
    ? 'Proceed. The weaknesses above are worth a revision pass but none of them invalidate the conclusion.'
    : 'Revise before proceeding. Address the logical gaps first — they change what the conclusion should be, not just how it reads.'
}`;
}

function tester(context: CompletionContext, rng: SeededRandom): string {
  const total = rng.int(6, 10);
  const failing = rng.int(0, 2);
  const passing = total - failing;
  const coverage = rng.float(78, 96);
  const keyword = extractKeywords(context.task, rng, 1)[0] ?? 'feature';
  const identifier = keyword.replace(/[^a-z0-9]/gi, '') || 'feature';
  const symbol = identifier.charAt(0).toUpperCase() + identifier.slice(1);

  return `## Test Plan

${upstreamDigest(context)}

### Coverage matrix

| # | case | type | status |
|---|------|------|--------|
| 1 | happy path with a well-formed input | unit | ✅ pass |
| 2 | empty input collection | unit | ✅ pass |
| 3 | input exceeding the configured limit | unit | ✅ pass |
| 4 | abort signal fired mid-iteration | unit | ${failing > 0 ? '❌ fail' : '✅ pass'} |
| 5 | one element throws, batch continues | unit | ✅ pass |
| 6 | whitespace-only element is skipped | unit | ${failing > 1 ? '❌ fail' : '✅ pass'} |

\`\`\`typescript
import { describe, expect, it } from 'vitest';
import { process${symbol} } from './${identifier}';

describe('process${symbol}', () => {
  it('processes every item under the limit', async () => {
    const result = await process${symbol}(['a', 'b'], { limit: 10 });
    expect(result.processed).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('honours the limit', async () => {
    const result = await process${symbol}(['a', 'b', 'c'], { limit: 2 });
    expect(result.processed).toBe(2);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await process${symbol}(['a'], { limit: 5, signal: controller.signal });
    expect(result.processed).toBe(0);
  });
});
\`\`\`

### Results
- **${passing}/${total} passing**${failing > 0 ? `, ${failing} failing` : ''}
- line coverage: **${coverage.toFixed(1)}%**
- branch coverage: **${(coverage - rng.float(4, 11)).toFixed(1)}%**

${
  failing > 0
    ? `### Failures\nThe abort-signal case does not stop cleanly: cancellation is only checked at the top of the loop, so an in-flight \`handle()\` call still completes. Either await with the signal or document the at-most-one-extra-item behaviour.`
    : '### Failures\n_None._ Uncovered lines are the defensive branches in the error path.'
}`;
}

function legalValidator(context: CompletionContext, rng: SeededRandom): string {
  const subject = extractSubject(context.task);

  const clauses = [
    {
      name: 'Limitation of Liability',
      risk: 'High',
      note: 'Cap is set at fees paid in the preceding 3 months, well below industry norm of 12 months. Carve-outs for IP indemnity are absent.',
    },
    {
      name: 'Indemnification',
      risk: 'High',
      note: 'Indemnity runs one way only. No reciprocal obligation for third-party IP claims arising from licensor-supplied components.',
    },
    {
      name: 'Termination for Convenience',
      risk: 'Medium',
      note: '30-day unilateral termination by licensor with no transition assistance or data-export obligation.',
    },
    {
      name: 'Governing Law & Venue',
      risk: 'Medium',
      note: 'Exclusive venue in a jurisdiction where we have no presence; increases cost of any dispute materially.',
    },
    {
      name: 'Auto-renewal',
      risk: 'Medium',
      note: 'Renews for successive 12-month terms with a 90-day notice window — longer than our standard calendar review cycle.',
    },
    {
      name: 'Data Processing',
      risk: 'Low',
      note: 'DPA is incorporated by reference but the sub-processor list is not versioned. Request a pinned list.',
    },
    {
      name: 'Assignment',
      risk: 'Low',
      note: 'Change-of-control assignment permitted without consent. Acceptable but worth noting.',
    },
  ];

  const selected = rng.sample(clauses, rng.int(4, 6));
  const highCount = selected.filter((c) => c.risk === 'High').length;

  const rows = selected.map(
    (c, i) => `| ${i + 1} | ${c.name} | **${c.risk}** | ${c.note} |`,
  );

  return `## Compliance & Legal Risk Review

**Instrument under review:** ${subject}

${upstreamDigest(context)}

### Clause-by-clause risk register

| # | clause | risk | finding |
|---|--------|------|---------|
${rows.join('\n')}

### Overall exposure: ${highCount >= 2 ? '**ELEVATED**' : highCount === 1 ? '**MODERATE**' : '**ACCEPTABLE**'}
${highCount} high-risk clause${highCount === 1 ? '' : 's'} identified across ${selected.length} reviewed.

### Recommended redlines
${numbered(
  selected
    .filter((c) => c.risk !== 'Low')
    .slice(0, 3)
    .map((c) => `**${c.name}** — negotiate to a mutual formulation; current draft allocates the entire risk to us.`),
)}

### Regulatory notes
${bullets([
  'No export-control clause present; confirm whether the deliverable is subject to EAR/ITAR.',
  'GDPR Art. 28 processor obligations appear satisfied via the incorporated DPA.',
  'No open-source compliance representation — request an SBOM covenant.',
])}

> ⚠️ Automated review. Not legal advice; escalate the high-risk clauses to counsel before signature.`;
}

function custom(context: CompletionContext, rng: SeededRandom): string {
  const subject = extractSubject(context.task);
  const keywords = extractKeywords(context.task, rng, 3);

  return `## ${context.nodeLabel}

**Task:** ${subject}

${upstreamDigest(context)}

### Analysis
${bullets(
  keywords.map(
    (k) => `**${k}** — assessed against the task statement; no contradiction with upstream context found.`,
  ),
)}

### Output
Applied the configured system prompt to the inherited context and produced a
consolidated result. Confidence is bounded by the weakest upstream input rather
than by this step's own reasoning.

### Assumptions
${bullets([
  'The task statement is complete as written.',
  'Upstream outputs are accepted at face value; this node performs no re-verification.',
])}`;
}

/* -------------------------------------------------------------------------- */

type Generator = (context: CompletionContext, rng: SeededRandom) => string;

const GENERATORS: Record<string, Generator> = {
  planner,
  researcher,
  retriever,
  knowledge,
  coder,
  reviewer,
  critic,
  tester,
  legal_validator: legalValidator,
  custom,
};

/** Synthesises a response for the given agent type. Never throws. */
export function generateMockContent(context: CompletionContext, rng: SeededRandom): string {
  const generator = GENERATORS[context.agentType] ?? custom;
  return generator(context, rng);
}

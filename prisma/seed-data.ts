import type { WorkflowGraph } from '../src/types/workflow';

/**
 * Example workflows shipped with the app.
 *
 * These are not decoration — each one exercises a different engine capability
 * so a reviewer can see the system working within a minute of `npm run dev`:
 *
 *  1. Legal Contract Risk Review — parallel fan-out and fan-in.
 *  2. Feature Implementation Pipeline — conditional branching on confidence.
 *  3. Research Synthesis Brief — deliberately unoptimised, so the Optimizer
 *     has genuine findings on first load rather than an empty state.
 */

export interface SeedWorkflow {
  name: string;
  description: string;
  tags: string[];
  isFavorite: boolean;
  graph: WorkflowGraph;
  /** Sample task pre-filled in the run bar. */
  sampleTask: string;
}

const always = { kind: 'always' } as const;

export const SEED_WORKFLOWS: SeedWorkflow[] = [
  /* ------------------------------------------------------------------ */
  {
    name: 'Legal Contract Risk Review',
    description:
      'Reviews a commercial agreement end to end: plans the review, gathers precedent and the ' +
      'contract text in parallel, runs a clause-level compliance pass, critiques the analysis, ' +
      'then produces the final memo.',
    tags: ['legal', 'compliance', 'review'],
    isFavorite: true,
    sampleTask: 'Review a software licensing agreement and identify legal risks.',
    graph: {
      nodes: [
        {
          id: 'plan',
          type: 'planner',
          label: 'Review Planner',
          description: 'Scopes the review and decides which clauses matter.',
          position: { x: 0, y: 160 },
          config: {
            notes: 'Entry point. Everything downstream works against this scope statement.',
          },
        },
        {
          id: 'retrieve',
          type: 'retriever',
          label: 'Contract Retriever',
          description: 'Pulls the agreement text and related exhibits from the document index.',
          position: { x: 280, y: 40 },
          config: {},
        },
        {
          id: 'research',
          type: 'researcher',
          label: 'Precedent Researcher',
          description: 'Finds market-standard positions for the clauses under review.',
          position: { x: 280, y: 280 },
          config: {},
        },
        {
          id: 'validate',
          type: 'legal_validator',
          label: 'Legal Validator',
          description: 'Clause-by-clause risk register with recommended redlines.',
          position: { x: 580, y: 160 },
          config: { maxTokens: 2400 },
        },
        {
          id: 'critique',
          type: 'critic',
          label: 'Risk Critic',
          description: 'Challenges the risk ratings before they reach the final memo.',
          position: { x: 860, y: 160 },
          config: {},
        },
        {
          id: 'memo',
          type: 'reviewer',
          label: 'Counsel Memo',
          description: 'Final reviewer memo with an explicit sign-off recommendation.',
          position: { x: 1140, y: 160 },
          config: {},
        },
      ],
      edges: [
        { id: 'e1', source: 'plan', target: 'retrieve', condition: always },
        { id: 'e2', source: 'plan', target: 'research', condition: always },
        { id: 'e3', source: 'retrieve', target: 'validate', condition: always },
        { id: 'e4', source: 'research', target: 'validate', condition: always },
        { id: 'e5', source: 'validate', target: 'critique', condition: always },
        { id: 'e6', source: 'critique', target: 'memo', condition: always },
      ],
    },
  },

  /* ------------------------------------------------------------------ */
  {
    name: 'Feature Implementation Pipeline',
    description:
      'Plans a feature, implements it, tests it, and reviews it. Demonstrates conditional ' +
      'branching: a low-confidence test result routes into an extra critique pass instead of ' +
      'going straight to review.',
    tags: ['engineering', 'code', 'ci'],
    isFavorite: true,
    sampleTask:
      'Implement a rate limiter for our public API with per-key quotas and a sliding window.',
    graph: {
      nodes: [
        {
          id: 'plan',
          type: 'planner',
          label: 'Tech Planner',
          description: 'Breaks the feature into implementable units with acceptance criteria.',
          position: { x: 0, y: 180 },
          config: {},
        },
        {
          id: 'context',
          type: 'knowledge',
          label: 'Codebase Knowledge',
          description: 'Existing conventions, interfaces, and constraints the change must respect.',
          position: { x: 280, y: 180 },
          config: {},
        },
        {
          id: 'code',
          type: 'coder',
          label: 'Implementer',
          description: 'Writes the typed implementation.',
          position: { x: 560, y: 180 },
          config: { temperature: 0.2 },
        },
        {
          id: 'test',
          type: 'tester',
          label: 'Test Author',
          description: 'Builds the coverage matrix and runs it.',
          position: { x: 840, y: 180 },
          config: {},
        },
        {
          id: 'critique',
          type: 'critic',
          label: 'Failure Analyst',
          description: 'Only runs when the test pass leaves meaningful doubt.',
          position: { x: 1120, y: 320 },
          config: {},
        },
        {
          id: 'review',
          type: 'reviewer',
          label: 'Code Reviewer',
          description: 'Final review against the test results.',
          position: { x: 1400, y: 180 },
          config: {},
        },
      ],
      edges: [
        { id: 'e1', source: 'plan', target: 'context', condition: always },
        { id: 'e2', source: 'context', target: 'code', condition: always },
        { id: 'e3', source: 'code', target: 'test', condition: always },
        {
          id: 'e4',
          source: 'test',
          target: 'critique',
          label: 'low confidence',
          // Branch: only dig into failures when the tester is not convincing.
          condition: { kind: 'expression', field: 'confidence', operator: 'lt', value: 0.8 },
        },
        {
          id: 'e5',
          source: 'test',
          target: 'review',
          label: 'confident',
          condition: { kind: 'expression', field: 'confidence', operator: 'gte', value: 0.8 },
        },
        { id: 'e6', source: 'critique', target: 'review', condition: always },
      ],
    },
  },

  /* ------------------------------------------------------------------ */
  {
    name: 'Research Synthesis Brief',
    description:
      'Produces a research brief on any topic. NOTE: this workflow is intentionally ' +
      'unoptimised — it chains two independent research agents, duplicates the Reviewer, and ' +
      'reviews before testing. Open the Optimizer tab to see what it finds.',
    tags: ['research', 'demo', 'unoptimized'],
    isFavorite: false,
    sampleTask:
      'Summarise the current state of vector database selection for production RAG systems.',
    graph: {
      nodes: [
        {
          id: 'plan',
          type: 'planner',
          label: 'Brief Planner',
          description: 'Frames the research question.',
          position: { x: 0, y: 200 },
          config: {},
        },
        {
          id: 'retrieve',
          type: 'retriever',
          label: 'Corpus Retriever',
          description: 'Pulls candidate source material.',
          position: { x: 260, y: 200 },
          config: {},
        },
        {
          // Chained behind the retriever even though it reads from the world,
          // not from the retriever. Rule: parallelize-independent-research.
          id: 'research',
          type: 'researcher',
          label: 'Deep Researcher',
          description: 'Independent research pass — does not actually need the retriever output.',
          position: { x: 520, y: 200 },
          config: {},
        },
        {
          id: 'synthesize',
          type: 'knowledge',
          label: 'Synthesizer',
          description: 'Merges findings into a structured extract.',
          position: { x: 780, y: 200 },
          config: {
            // Rule: excessive-token-budget (default for `knowledge` is 1400).
            maxTokens: 6000,
          },
        },
        {
          id: 'review1',
          type: 'reviewer',
          label: 'Reviewer',
          description: 'Reviews the synthesis.',
          position: { x: 1040, y: 80 },
          config: {},
        },
        {
          // Rule: duplicate-agent.
          id: 'review2',
          type: 'reviewer',
          label: 'Second Reviewer',
          description: 'Duplicate reviewer with no distinct remit.',
          position: { x: 1040, y: 320 },
          config: {},
        },
        {
          // Terminal critic — its critique feeds nothing. Rule: critic-before-synthesis.
          id: 'critique',
          type: 'critic',
          label: 'Final Critic',
          description: 'Critiques at the very end, where nothing can act on it.',
          position: { x: 1300, y: 200 },
          config: {},
        },
      ],
      edges: [
        { id: 'e1', source: 'plan', target: 'retrieve', condition: always },
        { id: 'e2', source: 'retrieve', target: 'research', condition: always },
        { id: 'e3', source: 'research', target: 'synthesize', condition: always },
        { id: 'e4', source: 'synthesize', target: 'review1', condition: always },
        { id: 'e5', source: 'synthesize', target: 'review2', condition: always },
        { id: 'e6', source: 'review1', target: 'critique', condition: always },
      ],
    },
  },
];

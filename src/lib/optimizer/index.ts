export {
  analyzeWorkflow,
  analyzeWorkflowSync,
  applyAutoFixes,
  applySelectedSuggestions,
  computeScore,
  gradeFor,
  projectionFor,
  type AnalyzeOptions,
} from './analyzer';
export { OPTIMIZER_RULES, runRules, getRule } from './rules';
export { projectWorkflow, projectSerialLatencyMs, nodeCostUsd, nodeLatencyMs } from './projection';
export { generateNarrative, buildFallbackNarrative, type NarrativeInput } from './narrative';

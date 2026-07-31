import type { TokenUsage } from '@/types/provider';

/**
 * Heuristic tokenizer.
 *
 * We deliberately avoid shipping a real BPE tokenizer: it costs ~2MB, differs
 * per vendor, and this app only needs usage figures accurate enough to compare
 * agents against each other. Real providers report exact usage and we always
 * prefer those numbers; this is the estimator for the mock path and for
 * pre-run projections.
 *
 * ~3.7 chars/token is a good average for English prose with light markdown.
 */
const CHARS_PER_TOKEN = 3.7;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Whitespace-heavy text (code, tables) tokenizes denser than the raw ratio.
  const whitespace = (text.match(/\s/g) ?? []).length;
  const effective = text.length - whitespace * 0.35;
  return Math.max(1, Math.round(effective / CHARS_PER_TOKEN));
}

export function buildUsage(promptText: string, completionText: string): TokenUsage {
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(completionText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

import { GoogleAuth } from 'google-auth-library';
import {
  ProviderError,
  type LLMCompletionRequest,
  type LLMCompletionResponse,
  type LLMProvider,
  type ProviderId,
  type TokenUsage,
} from '@/types/provider';
import { getEnv } from '@/lib/env';
import { isAbortError } from '@/lib/utils';
import { calculateCost, DEFAULT_MODELS, usesThinkingBudget } from './pricing';
import { buildUsage } from './tokens';

/**
 * Real Google Vertex AI integration.
 *
 * The interesting difference from the other two providers is authentication:
 * there is no API key. Vertex uses Application Default Credentials — a local
 * `gcloud auth application-default login`, a service-account key file pointed at
 * by `GOOGLE_APPLICATION_CREDENTIALS`, or the metadata server when running on
 * GCP. So the thing that marks this provider "configured" is a project id.
 *
 * We call the REST endpoint directly rather than through an SDK: the only piece
 * that genuinely needs a library is minting the access token, and a plain
 * `fetch` gives us guaranteed `AbortSignal` support plus no hidden retry layer
 * competing with the engine's own retry policy.
 */

const AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Headroom so thinking tokens can't crowd out a short agent response. */
const THINKING_TOKEN_FLOOR = 8_000;

/** Vertex finish reasons that mean "the model was stopped", not "it finished". */
const FILTERED_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
]);

interface VertexResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

export interface GoogleProviderOptions {
  project?: string;
  location?: string;
  model?: string;
  /** Overrides the API host. Exists for testing and private endpoints. */
  baseURL?: string;
  /** Injectable so the token source can be stubbed. */
  auth?: Pick<GoogleAuth, 'getAccessToken'>;
}

export class GoogleProvider implements LLMProvider {
  readonly id: ProviderId = 'google';
  readonly name = 'Google (Vertex AI)';
  readonly defaultModel: string;

  private readonly project: string | undefined;
  private readonly location: string;
  private readonly baseURL: string | undefined;
  private auth: Pick<GoogleAuth, 'getAccessToken'> | null;

  constructor(options: GoogleProviderOptions = {}) {
    const env = getEnv();
    this.project = options.project ?? env.GOOGLE_CLOUD_PROJECT;
    this.location = options.location ?? env.GOOGLE_CLOUD_LOCATION;
    this.defaultModel = options.model ?? env.GOOGLE_DEFAULT_MODEL ?? DEFAULT_MODELS.google;
    this.baseURL = options.baseURL ?? env.GOOGLE_VERTEX_BASE_URL;
    this.auth = options.auth ?? null;
  }

  /**
   * Reports whether the provider is *configured*, not whether the credentials
   * are valid — validating ADC requires a network round-trip and this seam is
   * synchronous. A configured-but-uncredentialed provider fails on its first
   * call with a non-retryable error that names the fix.
   */
  isAvailable(): boolean {
    return Boolean(this.project);
  }

  estimateCost(usage: TokenUsage, model?: string): number {
    return calculateCost(usage, model ?? this.defaultModel);
  }

  /** The `global` location is not region-prefixed; every other one is. */
  private endpoint(model: string): string {
    const host =
      this.baseURL ??
      (this.location === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${this.location}-aiplatform.googleapis.com`);

    return (
      `${host}/v1/projects/${this.project}/locations/${this.location}` +
      `/publishers/google/models/${model}:generateContent`
    );
  }

  private async getAccessToken(): Promise<string> {
    if (!this.project) {
      throw new ProviderError('GOOGLE_CLOUD_PROJECT is not configured', this.id, false);
    }

    // `GoogleAuth` caches and refreshes the token internally, so this is built
    // once and then reused — no hand-rolled expiry tracking.
    this.auth ??= new GoogleAuth({ scopes: [AUTH_SCOPE] });

    let token: string | null | undefined;
    try {
      token = await this.auth.getAccessToken();
    } catch (error) {
      throw credentialsError(this.id, error);
    }

    if (!token) throw credentialsError(this.id);
    return token;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();

    // Gemini thinks out of the same budget as the reply, so a node's token
    // ceiling is floored rather than passed through — otherwise the visible
    // answer gets truncated by the model's own reasoning.
    const maxOutputTokens = usesThinkingBudget(model)
      ? Math.max(request.maxTokens, THINKING_TOKEN_FLOOR)
      : request.maxTokens;

    try {
      const token = await this.getAccessToken();

      const response = await fetch(this.endpoint(model), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens,
          },
        }),
        signal: request.signal,
      });

      if (!response.ok) {
        throw new ProviderError(
          `Vertex AI returned ${response.status}: ${await readErrorMessage(response)}`,
          this.id,
          isRetryableStatus(response.status),
        );
      }

      const payload = (await response.json()) as VertexResponse;
      const candidate = payload.candidates?.[0];

      const content = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('\n')
        .trim();

      const finishReason = candidate?.finishReason;

      if (!content) {
        // A safety block legitimately returns no text — say so, and don't retry
        // it, because the same prompt will be blocked again.
        const filtered = finishReason && FILTERED_FINISH_REASONS.has(finishReason);
        throw new ProviderError(
          filtered
            ? `Vertex AI blocked the response (${finishReason})`
            : 'Vertex AI returned an empty completion',
          this.id,
          !filtered,
        );
      }

      // Prefer the API's own accounting; estimate only when it's absent.
      const usageMetadata = payload.usageMetadata;
      const usage: TokenUsage = usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount ?? 0,
            completionTokens: usageMetadata.candidatesTokenCount ?? 0,
            totalTokens:
              usageMetadata.totalTokenCount ??
              (usageMetadata.promptTokenCount ?? 0) + (usageMetadata.candidatesTokenCount ?? 0),
          }
        : buildUsage(`${request.systemPrompt}\n${request.userPrompt}`, content);

      const resolvedModel = payload.modelVersion || model;

      return {
        content,
        usage,
        model: resolvedModel,
        provider: this.id,
        finishReason: toFinishReason(finishReason),
        confidence: deriveConfidence(finishReason, content),
        latencyMs: Date.now() - startedAt,
        costUsd: this.estimateCost(usage, resolvedModel),
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // A cancelled node must never be retried — the engine already decided.
      if (isAbortError(error)) {
        throw new ProviderError('Vertex AI request aborted', this.id, false, error);
      }
      throw new ProviderError(
        `Vertex AI request failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        true,
        error,
      );
    }
  }
}

/**
 * Missing credentials are a configuration mistake, not a transient fault — the
 * engine would otherwise spend every retry attempt on something that cannot
 * fix itself. The message carries the actual remedy.
 */
function credentialsError(provider: ProviderId, cause?: unknown): ProviderError {
  return new ProviderError(
    'Vertex AI credentials not found. Run `gcloud auth application-default login`, ' +
      'or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file.',
    provider,
    false,
    cause,
  );
}

/** Vertex errors are `{ error: { code, message, status } }`; fall back to raw text. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === 'string' && message) return message;
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return response.statusText || 'unknown error';
  }
}

function toFinishReason(reason: string | undefined): LLMCompletionResponse['finishReason'] {
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason && FILTERED_FINISH_REASONS.has(reason)) return 'content_filter';
  return 'stop';
}

/** Same heuristic as the OpenAI provider — see the note there. */
function deriveConfidence(finishReason: string | undefined, content: string): number {
  let confidence = finishReason === 'STOP' ? 0.9 : 0.62;
  if (content.length < 200) confidence -= 0.12;
  if (content.length > 1_200) confidence += 0.04;
  if (/\b(unclear|unsure|cannot determine|insufficient information)\b/i.test(content)) {
    confidence -= 0.2;
  }
  return Number(Math.min(0.99, Math.max(0.2, confidence)).toFixed(3));
}

/** 4xx other than 408/429 are caller errors — retrying just burns budget. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

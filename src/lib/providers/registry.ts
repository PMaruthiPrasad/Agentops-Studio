import type { LLMProvider, ProviderId } from '@/types/provider';
import { getEnv } from '@/lib/env';
import { MockProvider } from './mock-provider';
import { OpenAIProvider } from './openai-provider';
import { AnthropicProvider } from './anthropic-provider';
import { GoogleProvider } from './google-provider';

/**
 * Provider resolution.
 *
 * The rule that makes this project runnable with zero configuration:
 * **a provider is only used if it says it's available.** Ask for `openai`
 * without a key and you transparently get the mock. Add the key and the exact
 * same workflow starts hitting the real API — no code or config change.
 */

let registry: Map<ProviderId, LLMProvider> | null = null;

function buildRegistry(): Map<ProviderId, LLMProvider> {
  const providers = new Map<ProviderId, LLMProvider>();
  providers.set('mock', new MockProvider());
  providers.set('openai', new OpenAIProvider());
  providers.set('anthropic', new AnthropicProvider());
  providers.set('google', new GoogleProvider());
  return providers;
}

/**
 * The configured default, as a provider id.
 *
 * `DEFAULT_LLM_PROVIDER` accepts `none` as an explicit opt-out, which is not a
 * provider — it resolves to the mock. Mapping it here keeps that wider union
 * from leaking into `ProviderId` at every call site.
 */
function getDefaultProviderId(): ProviderId {
  const configured = getEnv().DEFAULT_LLM_PROVIDER;
  return configured === 'none' ? 'mock' : configured;
}

function getRegistry(): Map<ProviderId, LLMProvider> {
  registry ??= buildRegistry();
  return registry;
}

/** Test-only: rebuild providers so env changes take effect. */
export function resetProviderRegistry(): void {
  registry = null;
}

export function getProvider(id: ProviderId): LLMProvider {
  const provider = getRegistry().get(id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

export interface ProviderResolution {
  provider: LLMProvider;
  /** What the caller asked for. */
  requested: ProviderId;
  /** True when we substituted the mock because credentials were missing. */
  fellBack: boolean;
}

/**
 * Resolve the provider a node should actually use.
 *
 * @param requested Provider the node config asks for. Defaults to `DEFAULT_LLM_PROVIDER`.
 */
export function resolveProvider(requested?: ProviderId): ProviderResolution {
  const target = requested ?? getDefaultProviderId();
  const provider = getProvider(target);

  if (provider.isAvailable()) {
    return { provider, requested: target, fellBack: false };
  }

  return { provider: getProvider('mock'), requested: target, fellBack: true };
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  available: boolean;
  defaultModel: string;
  isDefault: boolean;
}

/** Powers the "which providers are live?" indicator in the UI. */
export function getProviderStatuses(): ProviderStatus[] {
  const defaultId = getDefaultProviderId();
  return [...getRegistry().values()].map((provider) => ({
    id: provider.id,
    name: provider.name,
    available: provider.isAvailable(),
    defaultModel: provider.defaultModel,
    isDefault: provider.id === defaultId,
  }));
}

/** The provider that will actually serve requests right now. */
export function getActiveProviderId(): ProviderId {
  return resolveProvider().provider.id;
}

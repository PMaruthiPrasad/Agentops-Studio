import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveProviderId,
  getProvider,
  getProviderStatuses,
  resetProviderRegistry,
  resolveProvider,
} from './registry';
import { resetEnvCache } from '@/lib/env';
import { PROVIDER_IDS } from '@/types/provider';

/**
 * Provider resolution.
 *
 * The rule under test is the one that makes the whole project runnable with an
 * empty `.env`: ask for a provider with no credentials and you transparently
 * get the mock instead of an error.
 */

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'DEFAULT_LLM_PROVIDER',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
  resetProviderRegistry();
});

function reload() {
  resetEnvCache();
  resetProviderRegistry();
}

describe('getProvider', () => {
  it('returns each registered provider by id', () => {
    expect(getProvider('mock').id).toBe('mock');
    expect(getProvider('openai').id).toBe('openai');
    expect(getProvider('anthropic').id).toBe('anthropic');
    expect(getProvider('google').id).toBe('google');
  });

  it('throws on an unknown id', () => {
    expect(() => getProvider('gemini' as never)).toThrow(/Unknown provider/);
  });
});

describe('resolveProvider', () => {
  it('falls back to the mock when the requested provider has no key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    reload();

    const resolution = resolveProvider('anthropic');

    expect(resolution.provider.id).toBe('mock');
    expect(resolution.requested).toBe('anthropic');
    expect(resolution.fellBack).toBe(true);
  });

  it('uses the real provider once a key is present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    reload();

    const resolution = resolveProvider('anthropic');

    expect(resolution.provider.id).toBe('anthropic');
    expect(resolution.fellBack).toBe(false);
  });

  it('never falls back for the mock itself', () => {
    const resolution = resolveProvider('mock');

    expect(resolution.provider.id).toBe('mock');
    expect(resolution.fellBack).toBe(false);
  });

  it('uses the configured default when no provider is requested', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'mock';
    reload();

    expect(resolveProvider().provider.id).toBe('mock');
  });

  it('resolves each provider independently', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    delete process.env.ANTHROPIC_API_KEY;
    reload();

    expect(resolveProvider('openai').provider.id).toBe('openai');
    expect(resolveProvider('anthropic').provider.id).toBe('mock');
  });

  it('falls back to the mock when Vertex has no project configured', () => {
    // Vertex authenticates by ambient credentials, so the project id is what
    // stands in for "configured" — there is no key to check.
    delete process.env.GOOGLE_CLOUD_PROJECT;
    reload();

    const resolution = resolveProvider('google');

    expect(resolution.provider.id).toBe('mock');
    expect(resolution.requested).toBe('google');
    expect(resolution.fellBack).toBe(true);
  });

  it('uses Vertex once a project is configured', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    reload();

    const resolution = resolveProvider('google');

    expect(resolution.provider.id).toBe('google');
    expect(resolution.fellBack).toBe(false);
  });

  it('routes an unpinned request to the configured default', () => {
    // The end-to-end shape of the env switch: an agent that pins nothing must
    // land on whatever DEFAULT_LLM_PROVIDER names, not on a hardcoded mock.
    process.env.DEFAULT_LLM_PROVIDER = 'google';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    reload();

    expect(resolveProvider(undefined).provider.id).toBe('google');
  });

  it('treats the "none" default as an opt-out to the mock', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'none';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    reload();

    // Even with a live key present, `none` must not spend money.
    const resolution = resolveProvider();

    expect(resolution.provider.id).toBe('mock');
    expect(resolution.fellBack).toBe(false);
  });
});

describe('getProviderStatuses', () => {
  it('reports availability for every provider', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    reload();

    const statuses = getProviderStatuses();

    expect(statuses).toHaveLength(PROVIDER_IDS.length);
    expect(statuses.find((s) => s.id === 'mock')?.available).toBe(true);
    expect(statuses.find((s) => s.id === 'openai')?.available).toBe(false);
    expect(statuses.find((s) => s.id === 'anthropic')?.available).toBe(false);
    expect(statuses.find((s) => s.id === 'google')?.available).toBe(false);
  });

  it('flips Vertex to available once a project is set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    reload();

    expect(getProviderStatuses().find((s) => s.id === 'google')?.available).toBe(true);
  });

  it('flips a provider to available once its key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    reload();

    expect(getProviderStatuses().find((s) => s.id === 'openai')?.available).toBe(true);
  });

  it('marks exactly one provider as the configured default', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'mock';
    reload();

    expect(getProviderStatuses().filter((s) => s.isDefault)).toHaveLength(1);
  });

  it('still marks exactly one default when the value is "none"', () => {
    // `none` is not a provider, so it has to resolve to one — otherwise the
    // sidebar indicator has nothing to point at.
    process.env.DEFAULT_LLM_PROVIDER = 'none';
    reload();

    const defaults = getProviderStatuses().filter((s) => s.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe('mock');
  });

  it('reports a default model for every provider', () => {
    for (const status of getProviderStatuses()) {
      expect(status.defaultModel, status.id).toBeTruthy();
    }
  });
});

describe('getActiveProviderId', () => {
  it('reports mock when nothing is configured', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.DEFAULT_LLM_PROVIDER;
    reload();

    expect(getActiveProviderId()).toBe('mock');
  });

  it('reports google when Vertex is both the default and configured', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'google';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    reload();

    expect(getActiveProviderId()).toBe('google');
  });

  it('reports mock when the default is "none"', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'none';
    reload();

    expect(getActiveProviderId()).toBe('mock');
  });

  it('reports the real provider once it is both requested and available', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    reload();

    expect(getActiveProviderId()).toBe('openai');
  });

  it('reports mock when the default is requested but unavailable', () => {
    // This is what the sidebar indicator relies on: it must never claim a
    // billable provider is live when requests are actually hitting the mock.
    process.env.DEFAULT_LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    reload();

    expect(getActiveProviderId()).toBe('mock');
  });
});

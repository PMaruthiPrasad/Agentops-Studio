import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveProviderId,
  getProvider,
  getProviderStatuses,
  resetProviderRegistry,
  resolveProvider,
} from './registry';
import { resetEnvCache } from '@/lib/env';

/**
 * Provider resolution.
 *
 * The rule under test is the one that makes the whole project runnable with an
 * empty `.env`: ask for a provider with no credentials and you transparently
 * get the mock instead of an error.
 */

const ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEFAULT_LLM_PROVIDER'] as const;
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
});

describe('getProviderStatuses', () => {
  it('reports availability for every provider', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    reload();

    const statuses = getProviderStatuses();

    expect(statuses).toHaveLength(3);
    expect(statuses.find((s) => s.id === 'mock')?.available).toBe(true);
    expect(statuses.find((s) => s.id === 'openai')?.available).toBe(false);
    expect(statuses.find((s) => s.id === 'anthropic')?.available).toBe(false);
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
    delete process.env.DEFAULT_LLM_PROVIDER;
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

import { z } from 'zod';

/**
 * Environment parsing, once, at module load.
 *
 * Every field is optional with a working default — an empty `.env` yields a
 * fully functional app running on the mock provider. Failing loudly here beats
 * `process.env.FOO!` scattered through the codebase.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_DEFAULT_MODEL: z.string().min(1).default('gpt-4o-mini'),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  ANTHROPIC_DEFAULT_MODEL: z.string().min(1).default('claude-opus-5'),

  DEFAULT_LLM_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),

  ENGINE_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  ENGINE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  ENGINE_NODE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),

  MOCK_LATENCY_FACTOR: z.coerce.number().min(0).max(10).default(1),
  MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.04),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Empty strings are treated as "unset" so a commented-out-then-blanked key in
 * `.env` doesn't accidentally mark a provider as available.
 */
function readRawEnv(): Record<string, string | undefined> {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = process.env[key];
    raw[key] = value === '' ? undefined : value;
  }
  return raw;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(readRawEnv());

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

let cached: Env | null = null;

/**
 * Read the parsed environment. Values are read lazily and cached so tests can
 * mutate `process.env` before the first access.
 */
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test-only: drop the cache so the next `getEnv()` re-reads `process.env`. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Deterministic pseudo-randomness for the mock provider.
 *
 * Seeding from the prompt means the same request always produces the same
 * "response", latency, and confidence. That gives us realistic-looking
 * variation in the UI while keeping the test suite fully deterministic — no
 * `vi.spyOn(Math, 'random')` anywhere.
 */

/** FNV-1a. Fast, stable across runs, good enough for seeding. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface SeededRandom {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Picks one element; throws only if the list is empty. */
  pick<T>(items: readonly T[]): T;
  /** Picks `count` distinct elements (or all of them, if fewer exist). */
  sample<T>(items: readonly T[], count: number): T[];
  bool(probability?: number): boolean;
}

/** Mulberry32 — 32-bit state, excellent distribution for its size. */
export function createSeededRandom(seed: number | string): SeededRandom {
  let state = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);
  const int = (min: number, max: number): number => Math.floor(float(min, max + 1));

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('createSeededRandom().pick called with an empty list');
    }
    const item = items[int(0, items.length - 1)];
    // `noUncheckedIndexedAccess` — the bounds above guarantee this is defined.
    return item as T;
  }

  function sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const taken: T[] = [];
    const target = Math.min(count, pool.length);
    for (let i = 0; i < target; i += 1) {
      const index = int(0, pool.length - 1);
      const [item] = pool.splice(index, 1);
      if (item !== undefined) taken.push(item);
    }
    return taken;
  }

  return {
    next,
    float,
    int,
    pick,
    sample,
    bool: (probability = 0.5) => next() < probability,
  };
}

import { z } from 'zod';

/**
 * Typed (de)serialisation for the JSON-as-TEXT columns.
 *
 * Every read goes through a Zod schema, so a hand-edited or legacy row can
 * never inject an unexpected shape into the domain layer — it falls back to a
 * known-good default instead of crashing a page render.
 */

export function parseJsonColumn<T>(raw: string | null | undefined, schema: z.ZodType<T>, fallback: T): T {
  if (!raw) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

export function stringifyJsonColumn(value: unknown): string {
  return JSON.stringify(value);
}

const tagsSchema = z.array(z.string());

export function parseTags(raw: string | null | undefined): string[] {
  return parseJsonColumn(raw, tagsSchema, []);
}

export function serializeTags(tags: string[]): string {
  // Normalise on write: trimmed, lowercase, de-duplicated, order-stable.
  const normalized = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  return JSON.stringify(normalized);
}

export function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function requireIsoString(value: Date): string {
  return value.toISOString();
}

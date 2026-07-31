import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseJsonColumn,
  parseTags,
  requireIsoString,
  serializeTags,
  stringifyJsonColumn,
  toIsoString,
} from './serialization';

const schema = z.object({ temperature: z.number() });

describe('parseJsonColumn', () => {
  it('parses a valid column', () => {
    expect(parseJsonColumn('{"temperature":0.5}', schema, { temperature: 0 })).toEqual({
      temperature: 0.5,
    });
  });

  it('falls back on malformed JSON instead of crashing a page render', () => {
    expect(parseJsonColumn('{not json', schema, { temperature: 0 })).toEqual({ temperature: 0 });
  });

  it('falls back when the JSON is valid but the wrong shape', () => {
    // A hand-edited or legacy row must not inject an unexpected shape downstream.
    expect(parseJsonColumn('{"temperature":"hot"}', schema, { temperature: 0 })).toEqual({
      temperature: 0,
    });
  });

  it.each([null, undefined, ''])('falls back for %p', (raw) => {
    expect(parseJsonColumn(raw, schema, { temperature: 0 })).toEqual({ temperature: 0 });
  });
});

describe('stringifyJsonColumn', () => {
  it('round-trips through parseJsonColumn', () => {
    const value = { temperature: 0.42 };
    const raw = stringifyJsonColumn(value);

    expect(parseJsonColumn(raw, schema, { temperature: 0 })).toEqual(value);
  });
});

describe('tags', () => {
  it('normalises to lowercase and trims on write', () => {
    expect(serializeTags([' Legal ', 'REVIEW'])).toBe('["legal","review"]');
  });

  it('de-duplicates case-insensitively', () => {
    expect(parseTags(serializeTags(['legal', 'Legal', 'LEGAL']))).toEqual(['legal']);
  });

  it('drops empty tags', () => {
    expect(parseTags(serializeTags(['legal', '', '   ']))).toEqual(['legal']);
  });

  it('preserves order of first appearance', () => {
    expect(parseTags(serializeTags(['zebra', 'apple', 'zebra']))).toEqual(['zebra', 'apple']);
  });

  it('reads an empty array back for an unset column', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });

  it('falls back to an empty array for a corrupt column', () => {
    expect(parseTags('{"not":"an array"}')).toEqual([]);
  });

  it('round-trips an empty list', () => {
    expect(parseTags(serializeTags([]))).toEqual([]);
  });
});

describe('date helpers', () => {
  it('converts a date to ISO', () => {
    const date = new Date('2026-07-30T10:00:00.000Z');

    expect(toIsoString(date)).toBe('2026-07-30T10:00:00.000Z');
    expect(requireIsoString(date)).toBe('2026-07-30T10:00:00.000Z');
  });

  it.each([null, undefined])('returns null for %p', (value) => {
    expect(toIsoString(value)).toBeNull();
  });
});

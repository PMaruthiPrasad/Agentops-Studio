import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Deterministic, instant mock LLM calls across the whole suite.
process.env.MOCK_LATENCY_FACTOR = '0';
process.env.MOCK_FAILURE_RATE = '0';
process.env.DATABASE_URL ??= 'file:./test.db';

afterEach(() => {
  cleanup();
});

// jsdom lacks these; React Flow and Radix both reach for them.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Element.prototype.scrollIntoView ??= vi.fn();
}

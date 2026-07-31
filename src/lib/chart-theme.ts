'use client';

import { useTheme } from 'next-themes';
import { useMemo } from 'react';
import type { ExecutionStatus } from '@/types/execution';

/**
 * Chart colours.
 *
 * Recharts renders to SVG attributes and cannot read CSS custom properties, so
 * the palette has to exist as literal hex here rather than as design tokens.
 *
 * These values are a validated categorical palette: both mode columns clear the
 * lightness band, chroma floor, adjacent-pair CVD separation (worst ΔE 8.4
 * dark / 9.1 light, target ≥ 8), the normal-vision floor (≥ 19.3), and 3:1
 * contrast against this app's own surfaces. The dark column is the same hues
 * re-stepped for the dark surface, not an automatic lightening of the light one.
 *
 * Three light-mode slots sit under 3:1 on white, so every chart using them also
 * ships visible labels and a table view — which they do.
 */

export interface ChartTheme {
  /** Categorical slots, in fixed order. Never cycle past the end. */
  series: readonly string[];
  grid: string;
  axis: string;
  label: string;
  surface: string;
  status: Record<ExecutionStatus, string>;
}

const LIGHT: ChartTheme = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  label: '#52514e',
  surface: '#ffffff',
  status: {
    success: '#0ca30c',
    partial: '#fab219',
    failed: '#d03b3b',
    cancelled: '#898781',
    pending: '#898781',
    running: '#2a78d6',
  },
};

const DARK: ChartTheme = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  grid: '#2c2c2a',
  axis: '#383835',
  label: '#898781',
  surface: '#0c0c0e',
  status: {
    success: '#0ca30c',
    partial: '#fab219',
    failed: '#d03b3b',
    cancelled: '#898781',
    pending: '#898781',
    running: '#3987e5',
  },
};

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  // Default to dark: it is the app's default theme, and guessing light would
  // flash the wrong palette on first paint.
  return useMemo(() => (resolvedTheme === 'light' ? LIGHT : DARK), [resolvedTheme]);
}

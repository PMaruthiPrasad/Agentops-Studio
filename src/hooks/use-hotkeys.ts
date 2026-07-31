'use client';

import { useEffect, useRef } from 'react';

export interface Hotkey {
  /** Single character or `KeyboardEvent.key` value, e.g. 'k', 'z', 'Delete'. */
  key: string;
  /** Ctrl on Windows/Linux, Cmd on macOS — matched against either. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (event: KeyboardEvent) => void;
  /** Fire even when focus is in an input. Off by default. */
  allowInInput?: boolean;
  enabled?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[role="textbox"]') !== null
  );
}

/**
 * Global keyboard shortcuts.
 *
 * Bindings are held in a ref and read at dispatch time, so a re-render with new
 * closures never leaves a stale handler attached, and the listener is registered
 * exactly once.
 */
export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);

      for (const hotkey of ref.current) {
        if (hotkey.enabled === false) continue;
        if (typing && !hotkey.allowInInput) continue;

        const modPressed = event.metaKey || event.ctrlKey;
        if (Boolean(hotkey.mod) !== modPressed) continue;
        if (Boolean(hotkey.shift) !== event.shiftKey) continue;
        if (Boolean(hotkey.alt) !== event.altKey) continue;
        if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) continue;

        event.preventDefault();
        hotkey.handler(event);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Renders ⌘ on Apple platforms and Ctrl everywhere else. */
export function modifierSymbol(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

/** Tooltip text with the platform's modifier key, e.g. "Save (⌘S)". */
export function modifierAwareLabel(action: string, key: string): string {
  return `${action} (${modifierSymbol()}${key})`;
}

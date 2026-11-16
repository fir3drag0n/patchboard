// E-ink: a screen that flashes on every redraw and shows no color. When a
// device is set to it, from Settings for a household device or under Look
// for any browser, the page goes black on white with no motion, status
// shows by shape, and live updates are gathered and drawn once a minute.

import { useSyncExternalStore } from 'react';

/** How often an e-ink screen is redrawn with what changed. */
export const EINK_MS = 60_000;

let on = false;
let color = false;
const listeners = new Set<() => void>();

export function einkOn(): boolean {
  return on;
}

/** A color e-ink panel: the e-ink page, with status, warnings and the accent in its few inks. */
export function setEink(next: boolean, inColor = false): void {
  const c = next && inColor;
  if (next === on && c === color) return;
  on = next;
  color = c;
  document.documentElement.toggleAttribute('data-eink', on);
  document.documentElement.toggleAttribute('data-eink-color', color);
  for (const fn of listeners) fn();
}

/** Called whenever e-ink turns on or off, from anywhere. */
export function onEink(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useEink(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => on,
  );
}

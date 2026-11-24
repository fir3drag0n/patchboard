// Tabs move with the arrow keys, Home and End, as tabs do everywhere else.
// Put it on the role="tablist" element; each tab is a button with role="tab".

import type { KeyboardEvent } from 'react';

export function tabKeys(e: KeyboardEvent<HTMLElement>) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  tabs[to].focus();
  tabs[to].click();
}

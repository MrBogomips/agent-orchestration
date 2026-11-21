// Keyboard navigation of the /model-router usage view: which tab and which window a key lands on.
// Pure, so node tests cover it; model-router.tsx wires it to the engine's ui.focus and ui.scroll events.
// See docs/design/model-router.md, "Keys of the usage view".
//
// What the engine routes to a focused pane (Claude Code 2.1.330): Tab and Shift+Tab walk the focus ring over its
// Buttons; Up and Down scroll the body while it has rows to scroll, at its edges too, and walk the ring
// otherwise. Left and Right are not bound in a pane, so they never reach it. The view therefore keeps its body
// one row taller than the window (padRows), so that Up and Down always arrive as a one-row scroll, which it reads
// as the second level (the window); Tab and Shift+Tab move the ring along the tab row.
import { TABS, WINDOW_KEYS } from './usage-view.mjs';

/** The windows in the order the second row draws them. */
export const WINDOWS = Object.freeze(Object.values(WINDOW_KEYS));

/** The element keys the pane gives its tab and window Buttons. */
export const tabKey = (tab) => `tab-${tab}`;
export const windowKey = (window) => `window-${window}`;

/** The tab a Button key names, or null. */
export function tabOfKey(key) {
  if (typeof key !== 'string' || !key.startsWith('tab-')) return null;
  const tab = key.slice(4);
  return TABS.includes(tab) ? tab : null;
}

/** The window a Button key names, or null. */
export function windowOfKey(key) {
  if (typeof key !== 'string' || !key.startsWith('window-')) return null;
  const window = key.slice(7);
  return WINDOWS.includes(window) ? window : null;
}

/** The window `steps` places after `window` (before, when negative), cycling; an unknown window starts at 7d. */
export function stepWindow(window, steps) {
  const at = WINDOWS.indexOf(window);
  const from = at < 0 ? WINDOWS.indexOf('7d') : at;
  const n = WINDOWS.length;
  return WINDOWS[(((from + Math.sign(steps)) % n) + n) % n];
}

/**
 * Where a ring move the person made should land so that Tab and Shift+Tab cycle the tab row: the element the
 * engine chose, except a step off either end of the row, which wraps to the other end. `from` is the element the
 * ring is on, `to` the one the engine moves it to. A move onto one of the engine's own stops (`to` undefined, the
 * close mark) cannot be rewritten and lands there: the pane draws its title as a Button before the tabs, so
 * Shift+Tab off the first tab meets the title, not the close mark. A click off the row from an end tab wraps too;
 * the pane undoes that at the press that follows.
 */
export function ringTarget(from, to) {
  if (to === undefined || tabOfKey(to)) return to;
  const first = tabKey(TABS[0]);
  const last = tabKey(TABS[TABS.length - 1]);
  if (from === last) return first;
  if (from === first) return last;
  return to;
}

/**
 * Whether a ui.scroll input is an arrow key the person pressed in the pane: one row, no pointer (a wheel tick
 * carries one), from the person. Page keys, Home and End move a whole window and keep scrolling.
 */
export function isArrowScroll(e) {
  return Boolean(e) && e.origin?.kind === 'person' && !e.pointer && Math.abs(Number(e.by)) === 1;
}

/** Blank rows to add after `drawn` rows so the body is one row taller than a window of `bodyRows`. */
export function padRows(drawn, bodyRows) {
  if (!Number.isInteger(bodyRows) || bodyRows < 1) return 0;
  return Math.max(0, bodyRows + 1 - Math.max(0, Math.floor(Number(drawn) || 0)));
}

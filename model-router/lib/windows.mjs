// The windows and weeks over outcome records that the usage data (lib/usage-data.mjs) and the savings
// (lib/savings.mjs) both cut by, so the two count the same tasks in the same span.
// Plain ES module with no Node or engine imports, so the mod, the scripts and node tests load it.

/** The windows of the usage view, in days; `all` has no bound. */
export const WINDOWS = Object.freeze({ '24h': 1, '7d': 7, '30d': 30, all: null });
export const WINDOW_NAMES = Object.freeze(Object.keys(WINDOWS));
export const DAY_MS = 86400000;
/** The outcomes that close a task; `cancelled` is none of them. */
export const CLOSED = Object.freeze(['success', 'rework', 'failure']);

/** The last outcome record of each task: a task decided twice keeps its latest. */
export function latestOutcomes(events) {
  return [...new Map(events.filter((e) => e?.type === 'outcome' && e.task).map((o) => [o.task, o])).values()];
}

/** When an outcome counts in a window: its subagent's report, else the time it was decided. */
export const outcomeTime = (o) => Date.parse(o.reportTs ?? o.ts);

/** The outcomes inside `window` (a key of WINDOWS) ending at `now`. */
export function inWindow(outcomes, window, now) {
  const days = WINDOWS[window];
  if (days === null || days === undefined) return outcomes;
  const from = now - days * DAY_MS;
  return outcomes.filter((o) => {
    const t = outcomeTime(o);
    return Number.isFinite(t) && t > from && t <= now;
  });
}

/** The records whose `ts` falls in (from, to]. */
export const decisionsIn = (decisions, from, to) => decisions.filter((d) => {
  const t = Date.parse(d.ts);
  return Number.isFinite(t) && t > from && t <= to;
});

/** The decisions inside `window` ending at `now`; all of them for `all`. */
export function decisionsInWindow(decisions, window, now) {
  const days = WINDOWS[window];
  return days ? decisionsIn(decisions, now - days * DAY_MS, now) : decisions;
}

/** The Monday (UTC) of the week a time falls in, as `2026-11-16`. */
export function weekOf(time) {
  const d = new Date(time);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

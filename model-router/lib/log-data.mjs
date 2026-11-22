// The data of the log dashboard: what one pass over the event log keeps for a window, a record type and a page.
// Pure, and bounded: the collector counts every record and holds only the newest matching ones, cut to the fields
// the dashboard shows, so a log of any length costs the same memory. scripts/log.mjs feeds it; lib/log-cards.mjs
// turns its result into what the pane draws. See docs/design/model-router.md, "The log dashboard".
// Plain ES module with no Node or engine imports, so the scripts, the mod and node tests load it.

/** The windows of the dashboard, in days; `all` has no bound. */
export const LOG_WINDOWS = Object.freeze({ '24h': 1, '7d': 7, '30d': 30, all: null });
export const DEFAULT_QUERY = Object.freeze({ window: '7d', type: 'all', page: 0 });
export const PAGE_SIZE = 20;
/** The newest matching records that can be paged through; older ones are counted, not held. */
export const MAX_KEPT = 1000;
/** The days of the by-day chart: the window's, and for `all` the last thirty. */
export const DAYS_SHOWN = 30;
const TEXT_CHARS = 160;
const DAY_MS = 86400000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (table, key) => Object.hasOwn(table, key);
const short = (v) => (typeof v === 'string' && v ? v.slice(0, TEXT_CHARS) : null);
const numberOr = (v) => (isNum(v) ? v : null);

/** A query with its defaults: an unknown window or a page that is no whole number takes the default. */
export function queryOf(query) {
  const q = query && typeof query === 'object' ? query : {};
  return {
    window: has(LOG_WINDOWS, q.window ?? '') ? q.window : DEFAULT_QUERY.window,
    type: typeof q.type === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(q.type) ? q.type : DEFAULT_QUERY.type,
    page: Number.isInteger(q.page) && q.page >= 0 ? q.page : DEFAULT_QUERY.page,
  };
}

// The fields of each record type the dashboard shows. Anything else (prompt text, task descriptions) is not kept.
const FIELDS = Object.freeze({
  decision: (r) => ({ action: short(r.action), before: short(r.before), after: short(r.after), effort: short(r.effort), subagentType: short(r.subagentType), reason: short(r.reason) }),
  spawn: (r) => ({ subagentType: short(r.subagentType), class: short(r.class), model: short(r.model), effort: short(r.effort), route: short(r.route) }),
  outcome: (r) => ({ class: short(r.class), tier: short(r.tier), effort: short(r.effort), outcome: short(r.outcome), why: short(r.why), costUsd: numberOr(r.costUsd) }),
  report: (r) => ({ status: short(r.status), model: short(r.model), effort: short(r.effort), tokens: numberOr(r.tokens), costUsd: numberOr(r.costUsd) }),
  signal: (r) => ({ kind: short(r.kind), file: short(r.file), tool: short(r.tool), target: short(r.target) }),
  'session-end': (r) => ({ reason: short(r.reason) }),
});

/** A record cut to what the dashboard shows: its time, type and session, and its type's own fields. */
export function slimRecord(record) {
  const type = typeof record?.type === 'string' && record.type ? record.type.slice(0, 40) : 'unknown';
  const fields = has(FIELDS, type) ? FIELDS[type](record) : {};
  return { ts: short(record?.ts), type, session: short(record?.session), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) };
}

const dayOf = (time) => new Date(time).toISOString().slice(0, 10);

/** The days the chart shows, oldest first, ending on the day of `now`, each with its count. */
function daysOf(counts, window, now) {
  const days = Math.min(DAYS_SHOWN, LOG_WINDOWS[window] ?? DAYS_SHOWN);
  const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - (days - 1) * DAY_MS;
  return Array.from({ length: days }, (_, i) => {
    const day = dayOf(start + i * DAY_MS);
    return { day, n: counts.get(day) ?? 0 };
  });
}

/**
 * Collects one pass over the log for a query: `add(record)` for every record, then `result()`. It counts the
 * records of the window by type, the matching ones (the type asked for, or all) by day, and keeps the newest
 * MAX_KEPT matching records, slimmed, of which `result` returns one page, newest first.
 */
export function logCollector({ query, now, pageSize = PAGE_SIZE }) {
  const q = queryOf(query);
  const days = LOG_WINDOWS[q.window];
  const from = days === null ? -Infinity : now - days * DAY_MS;
  const byType = new Map();
  const byDay = new Map();
  let kept = [];
  let total = 0;
  let matched = 0;
  const trim = () => {
    kept = kept.sort((a, b) => a.time - b.time).slice(-MAX_KEPT);
  };
  return {
    add(record) {
      const time = Date.parse(record?.ts);
      const known = Number.isFinite(time);
      if (days !== null && !(known && time > from && time <= now)) return;
      const slim = slimRecord(record);
      total += 1;
      byType.set(slim.type, (byType.get(slim.type) ?? 0) + 1);
      if (q.type !== 'all' && slim.type !== q.type) return;
      matched += 1;
      if (known) byDay.set(dayOf(time), (byDay.get(dayOf(time)) ?? 0) + 1);
      kept.push({ time: known ? time : -Infinity, slim });
      if (kept.length > 2 * MAX_KEPT) trim();
    },
    result() {
      trim();
      const pages = Math.max(1, Math.ceil(kept.length / pageSize));
      const page = Math.min(q.page, pages - 1);
      const newest = kept.slice().reverse();
      return {
        query: { ...q, page }, pageSize, pages, total, matched, isCut: matched > kept.length,
        byType: [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, n]) => ({ type, n })),
        byDay: daysOf(byDay, q.window, now),
        records: newest.slice(page * pageSize, (page + 1) * pageSize).map((k) => k.slim),
      };
    },
  };
}

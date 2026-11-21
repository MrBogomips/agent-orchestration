// The aggregation the report page and the terminal's usage view share, so the two cannot disagree.
// Pure: it takes records and aggregate levels already read, and returns plain data. The scripts read the files.
// See docs/design/model-router.md, "Command", and docs/design/model-router-quality-loop.md, "Report".
import { ageCell, metrics, recommend } from './aggregate.mjs';
import { EFFORT_LEVELS, PRICE_ORDER } from './tiers.mjs';

export const READ_ONLY_CLASSES = Object.freeze(['read-search', 'read-analyze']);
export const WEAK_N = 5;
/** The windows of the usage view, in days; `all` has no bound. */
export const WINDOWS = Object.freeze({ '24h': 1, '7d': 7, '30d': 30, all: null });
export const WINDOW_NAMES = Object.freeze(Object.keys(WINDOWS));
/** Routing actions in the order the view lists them. */
export const ACTIONS = Object.freeze(['downgrade', 'upgrade', 'keep', 'explicit', 'forced-risk', 'error']);
export const DECISIONS_KEPT = 50;

const DAY_MS = 86400000;
const CLOSED = ['success', 'rework', 'failure'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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

/** The cells of a level, each aged to `now`. */
export function agedCells(level, now, halfLifeDays) {
  return Object.fromEntries(Object.entries(level?.cells ?? {}).map(([k, c]) => [k, ageCell(c, now, halfLifeDays)]));
}

/**
 * Cells folded from outcomes without aging, keyed by `keyOf(outcome)`: counts, sums, means and the model ids
 * seen. A cell has the shape `metrics` and `recommend` read.
 */
export function tally(outcomes, keyOf) {
  const cells = {};
  for (const o of outcomes) {
    const key = keyOf(o);
    const c = cells[key] ?? {
      class: o.class ?? null, tier: o.tier ?? 'other', effort: o.effort ?? null, model: null, models: [],
      n: 0, success: 0, rework: 0, failure: 0, costSum: 0, costN: 0, tokensSum: 0, tokensN: 0,
    };
    c.n += 1;
    if (CLOSED.includes(o.outcome)) c[o.outcome] += 1;
    if (isNum(o.costUsd)) {
      c.costSum += o.costUsd;
      c.costN += 1;
    }
    if (isNum(o.tokens)) {
      c.tokensSum += o.tokens;
      c.tokensN += 1;
    }
    if (o.model && !c.models.includes(o.model)) c.models.push(o.model);
    c.model = o.model ?? c.model;
    c.costMean = c.costN ? c.costSum / c.costN : null;
    c.tokensMean = c.tokensN ? c.tokensSum / c.tokensN : null;
    cells[key] = c;
  }
  return cells;
}

/** The cells taken together: summed counts and the mean cost and tokens weighted by n. */
function combined(cells) {
  const sum = { n: 0, success: 0, rework: 0, failure: 0 };
  let cost = 0;
  let costW = 0;
  let tokens = 0;
  let tokensW = 0;
  for (const c of cells) {
    for (const k of Object.keys(sum)) sum[k] += c[k] ?? 0;
    if (isNum(c.costMean)) {
      cost += c.costMean * (c.n ?? 0);
      costW += c.n ?? 0;
    }
    if (isNum(c.tokensMean)) {
      tokens += c.tokensMean * (c.n ?? 0);
      tokensW += c.n ?? 0;
    }
  }
  return { ...sum, costMean: costW ? cost / costW : null, tokensMean: tokensW ? tokens / tokensW : null };
}

function exploreShare(outcomes, cell, projectId) {
  const mine = outcomes.filter((o) => o.learn && o.class === cell.class && o.tier === cell.tier && o.effort === cell.effort &&
    (!projectId || o.project?.id === projectId));
  return mine.length ? mine.filter((o) => o.explore).length / mine.length : 0;
}

function flagsOf(cls, n) {
  const flags = [];
  if (READ_ONLY_CLASSES.includes(cls)) flags.push('read-only: weak signal');
  if (n < WEAK_N) flags.push(`n < ${WEAK_N}`);
  return flags;
}

/**
 * The classes of one level that have cells, in the grid's order: each with its cells (metrics, flags, whether
 * it is the recommended one), its recommendation, whether that differs from the grid, and a summary over its
 * cells. `cells` are already aged (or folded from a window).
 */
export function classesOf(cells, grid, { outcomes = [], projectId = null } = {}) {
  const all = Object.values(cells);
  return grid.classes
    .filter((spec) => all.some((c) => c.class === spec.name))
    .map((spec) => {
      const recommendation = recommend(cells, spec.name, grid);
      const mine = all.filter((c) => c.class === spec.name).sort((a, b) => b.n - a.n);
      const rows = mine.map((c) => ({
        tier: c.tier, effort: c.effort, model: c.model, ...metrics(c), exploreShare: exploreShare(outcomes, c, projectId),
        flags: flagsOf(c.class, c.n),
        recommended: recommendation?.source === 'data' && recommendation.tier === c.tier && recommendation.effort === c.effort,
      }));
      const differs = recommendation?.source === 'data' &&
        (recommendation.tier !== spec.default.tier || recommendation.effort !== spec.default.effort);
      const summary = metrics(combined(mine));
      return {
        cls: spec.name, covers: spec.covers, default: spec.default, recommendation, differs, cells: rows,
        summary: { ...summary, flags: flagsOf(spec.name, summary.n) },
      };
    });
}

function weekOf(time) {
  const d = new Date(time);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** First-pass yield and cost per successful task per week (Monday, UTC); an outcome with no readable time is skipped. */
export function trendOf(outcomes) {
  const weeks = new Map();
  for (const o of outcomes) {
    if (!CLOSED.includes(o.outcome)) continue;
    const t = outcomeTime(o);
    if (!Number.isFinite(t)) continue;
    const week = weekOf(t);
    const w = weeks.get(week) ?? { week, n: 0, success: 0, cost: 0, costN: 0 };
    w.n += 1;
    if (o.outcome === 'success') w.success += 1;
    if (isNum(o.costUsd)) {
      w.cost += o.costUsd;
      w.costN += 1;
    }
    weeks.set(week, w);
  }
  return [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => {
      const fpy = w.success / w.n;
      const costPerTask = w.costN ? w.cost / w.costN : null;
      return { week: w.week, n: w.n, fpy, costPerSuccess: fpy && costPerTask !== null ? costPerTask / fpy : null };
    });
}

/**
 * The headline numbers of a set of outcomes and of the routing decisions in the same span: closed tasks, first-pass
 * yield, rework rate, cost per successful task, and the starts routed, by downgrade, upgrade and keep.
 */
export function kpisOf(outcomes, decisions) {
  const cell = tally(outcomes.filter((o) => CLOSED.includes(o.outcome)), () => 'all').all;
  const m = cell ? metrics(cell) : { n: 0, fpy: null, reworkRate: null, costPerSuccess: null };
  const routed = { total: 0, downgrade: 0, upgrade: 0, keep: 0 };
  for (const d of decisions) {
    routed.total += 1;
    if (d.action in routed) routed[d.action] += 1;
  }
  return { closed: m.n, fpy: m.fpy, reworkRate: m.reworkRate, costPerSuccess: m.costPerSuccess, routed };
}

/** How each window is cut for its sparklines: bucket count and size. `all` goes by week. */
export const SERIES = Object.freeze({
  '24h': { buckets: 8, ms: 3 * 3600000, unit: '3h' },
  '7d': { buckets: 7, ms: DAY_MS, unit: 'day' },
  '30d': { buckets: 10, ms: 3 * DAY_MS, unit: '3 days' },
  all: { buckets: 12, ms: 7 * DAY_MS, unit: 'week' },
});

/**
 * First-pass yield and cost per successful task in equal buckets across the window, oldest first, each null when
 * no task closed in it. `all` is cut into the last 12 weeks.
 */
export function seriesOf(outcomes, window, now) {
  const spec = SERIES[window] ?? SERIES['7d'];
  const start = now - spec.buckets * spec.ms;
  const groups = Array.from({ length: spec.buckets }, () => []);
  for (const o of outcomes) {
    const t = outcomeTime(o);
    if (!Number.isFinite(t) || t <= start || t > now || !CLOSED.includes(o.outcome)) continue;
    groups[Math.min(spec.buckets - 1, Math.floor((t - start - 1) / spec.ms))].push(o);
  }
  const points = groups.map((g) => {
    if (!g.length) return null;
    const m = metrics(tally(g, () => 'all').all);
    return { n: m.n, fpy: m.fpy, costPerSuccess: m.costPerSuccess };
  });
  return { unit: spec.unit, points };
}

/** The decisions whose time falls in (from, to]. */
const decisionsIn = (decisions, from, to) => decisions.filter((d) => {
  const t = Date.parse(d.ts);
  return Number.isFinite(t) && t > from && t <= to;
});

/**
 * The headline numbers of a window and of the window of the same length before it (null for `all`), with the
 * sparkline series. `outcomes` and `decisions` are already limited to the level.
 */
export function headlineOf(outcomes, decisions, window, now) {
  const days = WINDOWS[window];
  const current = days ? kpisOf(inWindow(outcomes, window, now), decisionsIn(decisions, now - days * DAY_MS, now)) : kpisOf(outcomes, decisions);
  const previous = days
    ? kpisOf(inWindow(outcomes, window, now - days * DAY_MS), decisionsIn(decisions, now - 2 * days * DAY_MS, now - days * DAY_MS))
    : null;
  return { current, previous, series: seriesOf(outcomes, window, now) };
}

/** Decision records counted by action; `session` limits them to one session. */
export function decisionsOf(events, session = null) {
  const byAction = {};
  let total = 0;
  for (const e of events) {
    if (e?.type !== 'decision' || (session && e.session !== session)) continue;
    total += 1;
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  }
  return { total, byAction };
}

const rank = (list, v) => {
  const i = list.indexOf(v);
  return i < 0 ? list.length : i;
};

/** Closed tasks per tier and effort, cheapest tier first: counts, token and cost sums, metrics, model ids. */
export function modelRows(outcomes) {
  return Object.values(tally(outcomes, (o) => `${o.tier ?? 'other'}|${o.effort ?? ''}`))
    .sort((a, b) => rank(PRICE_ORDER, a.tier) - rank(PRICE_ORDER, b.tier) || rank(EFFORT_LEVELS, a.effort) - rank(EFFORT_LEVELS, b.effort))
    .map((c) => ({ tier: c.tier, effort: c.effort, models: c.models, costSum: c.costSum, tokensSum: c.tokensSum, ...metrics(c) }));
}

function usageOf(row) {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const u of Array.isArray(row?.usage) ? row.usage : []) {
    out.input += isNum(u?.input_tokens) ? u.input_tokens : 0;
    out.output += isNum(u?.output_tokens) ? u.output_tokens : 0;
    out.cacheRead += isNum(u?.cache_read_input_tokens) ? u.cache_read_input_tokens : 0;
    out.cacheWrite += isNum(u?.cache_creation_input_tokens) ? u.cache_creation_input_tokens : 0;
  }
  return out;
}

/**
 * This session's subagents by model. `live` are `$.agent.list()` rows (id, model, usage, cost); the session's
 * `report` records stand in for agents the engine has dropped, with their total tokens only (`isPartial`).
 */
export function sessionAgents(live, events, session) {
  const byModel = new Map();
  const add = (model, part) => {
    const key = model || 'unknown';
    const m = byModel.get(key) ?? { model: key, agents: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, cost: 0, isPartial: false };
    m.agents += 1;
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'tokens', 'cost']) m[k] += part[k] ?? 0;
    if (part.isPartial) m.isPartial = true;
    byModel.set(key, m);
  };
  const seen = new Set();
  for (const row of Array.isArray(live) ? live : []) {
    if (!row || typeof row.id !== 'string') continue;
    seen.add(row.id);
    const u = usageOf(row);
    const model = row.model ?? row.usage?.[0]?.model;
    add(model, { ...u, tokens: u.input + u.output + u.cacheRead + u.cacheWrite, cost: isNum(row.cost?.usd) ? row.cost.usd : 0 });
  }
  const reports = new Map();
  for (const e of events) {
    if (e?.type === 'report' && e.session === session && e.agentId && !seen.has(e.agentId)) reports.set(e.agentId, e);
  }
  for (const r of reports.values()) {
    add(r.model, { tokens: isNum(r.tokens) ? r.tokens : 0, cost: isNum(r.costUsd) ? r.costUsd : 0, isPartial: true });
  }
  const models = [...byModel.values()].sort((a, b) => b.cost - a.cost || b.agents - a.agents);
  return {
    models,
    agents: models.reduce((n, m) => n + m.agents, 0),
    cost: models.reduce((n, m) => n + m.cost, 0),
  };
}

function slimDecision(d, session) {
  return {
    ts: d.ts, action: d.action, before: d.before ?? null, after: d.after ?? null, effort: d.effort ?? null,
    subagentType: d.subagentType ?? null, cls: d.class ?? null, reason: String(d.reason ?? '').slice(0, 200),
    isThisSession: Boolean(session) && d.session === session,
  };
}

/**
 * Everything the usage view shows, for every window and both levels, so a change of window or level redraws
 * without reading again.
 *
 * `user` and `project` are aggregate levels as compaction writes them (the project's may be null); `project` is
 * `{ id, root }` of the session's project, or null.
 */
export function buildUsageData({ events, user, projectLevel = null, project = null, grid, now, halfLifeDays, session = null, live = [], note = null }) {
  const outcomes = latestOutcomes(events);
  const projectId = project?.id ?? null;
  const decisions = events
    .filter((e) => e?.type === 'decision' && typeof e.ts === 'string' && typeof e.action === 'string')
    .slice(-DECISIONS_KEPT)
    .map((d) => slimDecision(d, session));
  const allDecisions = events.filter((e) => e?.type === 'decision' && typeof e.ts === 'string');
  // A decision carries no project: the project level counts the decisions of this session's project's spawns.
  const projectAgents = new Set(events.filter((e) => e?.type === 'spawn' && projectId && e.project?.id === projectId).map((e) => e.agentId));
  const windows = {};
  for (const window of WINDOW_NAMES) {
    const recent = inWindow(outcomes, window, now);
    const own = projectId ? recent.filter((o) => o.project?.id === projectId) : [];
    const levelClasses = (list, level, id) => (window === 'all'
      ? classesOf(agedCells(level, now, halfLifeDays), grid, { outcomes: list, projectId: id })
      : classesOf(tally(list.filter((o) => o.learn), (o) => `${o.class}|${o.tier}|${o.effort}`), grid, { outcomes: list, projectId: id }));
    windows[window] = {
      tasks: recent.length,
      headline: {
        user: headlineOf(outcomes, allDecisions, window, now),
        project: projectId
          ? headlineOf(outcomes.filter((o) => o.project?.id === projectId), allDecisions.filter((d) => projectAgents.has(d.agentId)), window, now)
          : null,
      },
      models: modelRows(recent),
      classes: {
        user: levelClasses(recent, user, null),
        project: projectId ? levelClasses(own, projectLevel, projectId) : null,
      },
    };
  }
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    note,
    project: project ? { id: project.id, root: project.root ?? null } : null,
    session: { id: session, ...sessionAgents(live, events, session) },
    routing: decisionsOf(events, session ?? '\u0000'),
    decisions: { total: decisionsOf(events).total, latest: decisions },
    windows,
  };
}

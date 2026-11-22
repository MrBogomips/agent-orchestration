// The Model routing card of the desktop app as a plain value: what hooks/card-kit.tsx lays out for the view, the
// scope and the window picked. One card holds every view: Overview, Models, Task classes, Projects, Decisions,
// Trend (the quality report) and Log (the event log). Pure: it takes the data scripts/usage.mjs, scripts/report.mjs
// and scripts/log.mjs print, and returns texts already formatted and drawings as SVG markup.
// See docs/design/model-router.md, "The card on the desktop app", and docs/design/ui-design.md, "The card".
// Plain ES module with no Node or engine imports, so the mod and node tests load it.
import { ACCENT, KIND_COLORS, SHADES, SHADE_ORDER, TONE_COLORS, barSvg, chartSvg, heatmapSvg, scaleOf, segmentsSvg } from './card-parts.mjs';
import { fmtBytes, recordLine } from './log-cards.mjs';
import { EFFORT_LEVELS, familyOf } from './tiers.mjs';
import { fmtNum, fmtPct, fmtUsd } from './usage-view.mjs';

export const CARD_TITLE = 'Model routing';
export const VIEWS = Object.freeze([
  { value: 'overview', label: 'Overview' }, { value: 'models', label: 'Models' }, { value: 'classes', label: 'Task classes' },
  { value: 'projects', label: 'Projects' }, { value: 'decisions', label: 'Decisions' }, { value: 'trend', label: 'Trend' }, { value: 'log', label: 'Log' },
]);
export const SCOPES = Object.freeze([{ value: 'user', label: 'All projects' }, { value: 'project', label: 'This project' }]);
export const WINDOWS = Object.freeze([
  { value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' },
]);
/** What a card opens on. `group` is the open group of Decisions and Log, null for the first. */
export const DEFAULT_CARD = Object.freeze({ view: 'overview', window: '7d', level: 'user', group: null, isCollapsed: false });
/** The views whose figures come from the report's data, read when one of them is picked. */
export const REPORT_VIEWS = Object.freeze(['projects', 'trend']);
/** The rows a view draws at most: the tree stays the same size whatever the data holds. */
export const ROWS_SHOWN = 8;
export const DECISIONS_SHOWN = 6;
export const RECORDS_SHOWN = 5;
export const WEEKS_SHOWN = 8;
const HEAT_WEEKS = 22;
const WEAK_N = 5;
const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NEUTRAL = KIND_COLORS[4];
const BEFORE = Object.freeze({ '24h': '24 hours', '7d': '7 days', '30d': '30 days' });
/** The routing decisions as the card names them, in the order it lists them, each with its colour in the bar. */
export const ACTIONS = Object.freeze([
  { action: 'downgrade', name: 'Moved to a cheaper model', color: ACCENT },
  { action: 'upgrade', name: 'Moved to a stronger model', color: KIND_COLORS[1] },
  { action: 'forced-risk', name: 'Raised for risky work', color: KIND_COLORS[3] },
  { action: 'keep', name: 'Kept as asked', color: KIND_COLORS[5] },
  { action: 'explicit', name: 'Model named in the call', color: NEUTRAL },
  { action: 'error', name: 'Left unchanged after an error', color: TONE_COLORS.bad },
]);
const RECORD_NAMES = Object.freeze({ outcome: 'Outcomes', 'session-end': 'Session ends', signal: 'Signals', decision: 'Decisions', report: 'Reports', spawn: 'Starts' });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (table, key) => Object.hasOwn(table, key);
const cap = (text) => (text ? `${String(text)[0].toUpperCase()}${String(text).slice(1)}` : '');
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const share = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '–');
const labelOf = (options, value) => options.find((o) => o.value === value)?.label ?? String(value);
const windowText = (window) => labelOf(WINDOWS, window).toLowerCase();
const note = (text, tone = null) => ({ kind: 'note', text, tone });
/** A model and effort as the card writes them: `Opus · high`. */
export const cellName = (tier, effort) => `${cap(tier ?? 'other')} · ${effort ?? 'default'}`;
const modelName = (model) => (model ? cap(familyOf(model) === 'other' ? String(model) : familyOf(model)) : '?');
/** `2026-11-20` or an ISO time as `Nov 20`; with `time`, `Nov 20, 18:02`. */
function dayText(iso, time = false) {
  const t = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t.getTime())) return String(iso ?? '');
  const day = `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
  return time ? `${day}, ${t.toISOString().slice(11, 16)}` : day;
}

/** The view, window, level, open group and collapsed flag of a card, each a known value. */
export function cardStateOf(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    view: VIEWS.some((v) => v.value === s.view) ? s.view : DEFAULT_CARD.view,
    window: WINDOWS.some((w) => w.value === s.window) ? s.window : DEFAULT_CARD.window,
    level: s.level === 'project' ? 'project' : 'user',
    group: typeof s.group === 'string' && s.group ? s.group : null,
    isCollapsed: s.isCollapsed === true,
  };
}

const windowOf = (data, state) => data?.windows?.[state.window] ?? null;
const headlineOf = (data, state) => windowOf(data, state)?.headline?.[state.level] ?? null;
const modelRowsOf = (data, state) => (state.level === 'project' ? windowOf(data, state)?.projectModels : windowOf(data, state)?.models) ?? [];
const dailyOf = (data, state) => data?.daily?.[state.level] ?? [];

/** The closed tasks of a window by model family, the dearest first: `{ tier, n, success, cost, efforts }`. */
export function familiesOf(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const tier = r.tier ?? 'other';
    const f = by.get(tier) ?? { tier, n: 0, success: 0, cost: 0, efforts: [] };
    const n = isNum(r.n) ? r.n : 0;
    f.n += n;
    f.success += isNum(r.fpy) ? r.fpy * n : 0;
    f.cost += isNum(r.costSum) ? r.costSum : 0;
    f.efforts.push({ effort: r.effort ?? null, n, fpy: r.fpy });
    by.set(tier, f);
  }
  const rank = (tier) => (SHADE_ORDER.includes(tier) ? SHADE_ORDER.indexOf(tier) : SHADE_ORDER.length);
  const effortRank = (e) => (EFFORT_LEVELS.includes(e) ? EFFORT_LEVELS.indexOf(e) : EFFORT_LEVELS.length);
  return [...by.values()].sort((a, b) => rank(a.tier) - rank(b.tier)).map((f) => ({ ...f, efforts: f.efforts.sort((a, b) => effortRank(a.effort) - effortRank(b.effort)) }));
}

const shadeOf = (tier) => SHADES[tier] ?? NEUTRAL;

/** The bar of the collapsed card: the window's tasks by model family. Null with no task. */
function modelSegments(data, state) {
  const families = familiesOf(modelRowsOf(data, state));
  const total = families.reduce((n, f) => n + f.n, 0);
  if (!total) return null;
  return {
    source: segmentsSvg(families.map((f) => ({ share: f.n / total, color: shadeOf(f.tier) }))),
    alt: `Tasks by model: ${families.map((f) => `${cap(f.tier)} ${share(f.n, total)}`).join(', ')}`,
  };
}

function summaryOf(data, state) {
  const c = headlineOf(data, state)?.current;
  if (!c || !c.closed) return `no task scored, ${windowText(state.window)}`;
  return `${fmtPct(c.fpy)} right first time · ${fmtUsd(c.costPerSuccess)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Overview

/** The heatmap of tasks per day: the last 22 weeks ending at the day of `generatedAt`, Monday first. */
export function heatOf(daily, generatedAt) {
  const end = Date.parse(`${String(generatedAt).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(end)) return null;
  const counts = new Map((Array.isArray(daily) ? daily : []).map((d) => [d.day, d.n]));
  const start = end - ((HEAT_WEEKS - 1) * 7 + ((new Date(end).getUTCDay() + 6) % 7)) * DAY_MS;
  const dayAt = (week, day) => start + (week * 7 + day) * DAY_MS;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const inRange = Array.from({ length: HEAT_WEEKS * 7 }, (_, i) => start + i * DAY_MS).filter((ms) => ms <= end);
  const max = Math.max(0, ...inRange.map((ms) => counts.get(iso(ms)) ?? 0));
  const weeks = Array.from({ length: HEAT_WEEKS }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const ms = dayAt(week, day);
    if (ms > end) return null;
    const n = counts.get(iso(ms)) ?? 0;
    return n > 0 ? Math.max(1, Math.ceil((4 * n) / max)) : 0;
  }));
  const months = [];
  for (let week = 0; week < HEAT_WEEKS; week += 1) {
    const month = new Date(dayAt(week, 6)).getUTCMonth();
    if (week > 0 && month !== new Date(dayAt(week - 1, 6)).getUTCMonth()) months.push({ week, label: MONTHS[month] });
  }
  if (!months.length || months[0].week >= 3) months.unshift({ week: 0, label: MONTHS[new Date(dayAt(0, 6)).getUTCMonth()] });
  const total = inRange.reduce((n, ms) => n + (counts.get(iso(ms)) ?? 0), 0);
  const busiest = inRange.reduce((best, ms) => ((counts.get(iso(ms)) ?? 0) > (counts.get(iso(best)) ?? 0) ? ms : best), inRange[0]);
  return {
    source: heatmapSvg({ weeks, months, less: 'Fewer', more: 'More tasks' }),
    alt: total ? `${plural(total, 'task')} in ${HEAT_WEEKS} weeks; the busiest day was ${dayText(iso(busiest))}` : `No task closed in the last ${HEAT_WEEKS} weeks`,
    busiest: total ? dayText(iso(busiest)) : '–',
  };
}

/** One sentence on the change from the window before, or null when there is nothing to compare. */
export function changeText(headline, window) {
  const [c, p] = [headline?.current, headline?.previous];
  if (!c || !p || !has(BEFORE, window)) return null;
  const parts = [];
  if (isNum(c.fpy) && isNum(p.fpy)) {
    const points = Math.round((c.fpy - p.fpy) * 100);
    parts.push(points === 0 ? 'right first time is unchanged' : `right first time is ${points > 0 ? 'up' : 'down'} ${plural(Math.abs(points), 'point')}`);
  }
  if (isNum(c.costPerSuccess) && isNum(p.costPerSuccess) && p.costPerSuccess > 0) {
    const percent = Math.round(((c.costPerSuccess - p.costPerSuccess) / p.costPerSuccess) * 100);
    parts.push(percent === 0 ? 'a success costs the same' : `a success is ${Math.abs(percent)}% ${percent < 0 ? 'cheaper' : 'dearer'}`);
  }
  return parts.length ? `${cap(parts.join(' and '))}, against the ${BEFORE[window]} before.` : null;
}

const statusText = (status) => `Routing ${status?.routing ? 'on' : 'off'} · measuring ${status?.measuring ? 'on' : 'off'} · adapting ${status?.adapt ? 'on' : 'off'}`;

function actionRows(headline) {
  const counts = headline?.current?.actions ?? {};
  const known = ACTIONS.filter((a) => counts[a.action] > 0).map((a) => ({ ...a, n: counts[a.action] }));
  const other = Object.keys(counts).filter((k) => counts[k] > 0 && !ACTIONS.some((a) => a.action === k)).map((k) => ({ action: k, name: cap(k), color: NEUTRAL, n: counts[k] }));
  return [...known, ...other];
}

function overview(data, state, status) {
  const h = headlineOf(data, state);
  const c = h?.current ?? {};
  const heat = heatOf(dailyOf(data, state), data.generatedAt);
  const top = [...modelRowsOf(data, state)].sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0];
  const actions = actionRows(h);
  const closed = isNum(c.closed) ? c.closed : 0;
  const change = changeText(h, state.window);
  return [
    ...(heat ? [{ kind: 'heat', source: heat.source, alt: heat.alt }] : []),
    { kind: 'grid', pairs: [
      { label: 'Right first time', value: fmtPct(c.fpy) }, { label: 'Per success', value: fmtUsd(c.costPerSuccess) },
      { label: 'Redone', value: fmtPct(c.reworkRate) }, { label: 'Tasks scored', value: fmtNum(closed) },
      { label: 'Most used', value: top ? cellName(top.tier, top.effort) : '–' }, { label: 'Busiest day', value: heat?.busiest ?? '–' },
    ] },
    { kind: 'table', title: 'Routing', aside: labelOf(WINDOWS, state.window), rows: [
      ...actions.map((a) => ({ label: a.name, value: fmtNum(a.n) })),
      { label: 'Total', value: fmtNum(actions.reduce((n, a) => n + a.n, 0)) },
    ] },
    ...(closed > 0 && closed < WEAK_N ? [note(`${plural(closed, 'task')} scored: the figures are indicative under ${WEAK_N}.`)] : []),
    ...(closed === 0 ? [note('No task scored in this window yet. The figures fill in as subagent work closes.')] : []),
    ...(change ? [note(change)] : []),
    note(statusText(status)),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Models, Task classes, Projects

const countScale = (max) => (max <= 4 ? { top: Math.max(1, max), ticks: Array.from({ length: Math.max(1, max) + 1 }, (_, i) => ({ value: i, label: String(i) })) } : scaleOf(max));

/** Tasks per day by model family for the window (the last 30 days for all time); null for the last 24 hours. */
export function perDayChart(daily, window, generatedAt) {
  const end = Date.parse(`${String(generatedAt).slice(0, 10)}T00:00:00Z`);
  const days = window === '7d' ? 7 : window === '24h' ? 0 : 30;
  if (!days || !Number.isFinite(end)) return null;
  const by = new Map((Array.isArray(daily) ? daily : []).map((d) => [d.day, d]));
  const every = days > 7 ? 5 : 1;
  const bars = Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    const tiers = by.get(day)?.tiers ?? {};
    const rest = Object.keys(tiers).filter((t) => !SHADE_ORDER.includes(t)).reduce((n, t) => n + tiers[t], 0);
    return {
      label: (days - 1 - i) % every === 0 ? dayText(day) : '', n: by.get(day)?.n ?? 0,
      parts: [...SHADE_ORDER.map((t) => ({ value: tiers[t] ?? 0, color: SHADES[t] })), { value: rest, color: NEUTRAL }],
    };
  });
  const max = Math.max(0, ...bars.map((b) => b.n));
  if (!max) return null;
  const scale = countScale(max);
  return {
    kind: 'chart', title: 'Tasks per day', source: chartSvg({ bars, ticks: scale.ticks, max: scale.top }),
    alt: `${plural(bars.reduce((n, b) => n + b.n, 0), 'task')} over ${days} days, at most ${max} in a day`,
  };
}

function models(data, state) {
  const rows = modelRowsOf(data, state);
  const families = familiesOf(rows);
  const total = families.reduce((n, f) => n + f.n, 0);
  if (!total) return [note('No closed task in this window. Models appear here once a subagent task is scored.')];
  const top = [...rows].sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0];
  const chart = perDayChart(dailyOf(data, state), state.window, data.generatedAt);
  return [
    { kind: 'shares', label: `Share of tasks · ${labelOf(WINDOWS, state.window)}`, rows: families.map((f) => ({
      color: shadeOf(f.tier), name: cap(f.tier), amount: plural(f.n, 'task'), share: share(f.n, total), bar: barSvg(f.n / total),
      detail: [
        `${fmtPct(f.n ? f.success / f.n : null)} right first time`, `${fmtUsd(f.success ? f.cost / f.success : null)} per success`,
        f.efforts.map((e) => `${e.effort ?? 'default'} ${fmtNum(e.n)} (${fmtPct(e.fpy)})`).join(', '),
      ].join(' · '),
    })) },
    ...(chart ? [chart] : []),
    { kind: 'grid', pairs: [{ label: 'Most used', value: cellName(top.tier, top.effort) }, { label: 'Tasks scored', value: fmtNum(total) }] },
  ];
}

const shareBlock = (label, rows, more) => [
  { kind: 'shares', label, rows: rows.slice(0, ROWS_SHOWN) },
  ...(rows.length > ROWS_SHOWN ? [note(`${rows.length - ROWS_SHOWN} more ${more}`)] : []),
];

function classes(data, state) {
  if (state.level === 'project' && !data.project) return [note('This session has no project id yet.')];
  const list = windowOf(data, state)?.classes?.[state.level] ?? [];
  const count = (c) => (isNum(c.summary?.tasks) && c.summary.tasks > 0 ? c.summary.tasks : isNum(c.summary?.n) ? c.summary.n : 0);
  const total = list.reduce((n, c) => n + count(c), 0);
  if (!total) return [note('No learned task here yet. Classes appear once a scored task carries one.')];
  const rows = [...list].sort((a, b) => count(b) - count(a)).map((c) => ({
    color: null, name: c.cls, amount: plural(count(c), 'task'), share: share(count(c), total), bar: barSvg(count(c) / total),
    detail: [
      `${fmtPct(c.summary.fpy)} right first time`, `${fmtUsd(c.summary.costPerSuccess)} per success`, `grid ${cellName(c.default?.tier, c.default?.effort)}`,
      ...(c.differs ? [`the data favours ${cellName(c.recommendation?.tier, c.recommendation?.effort)}`] : []),
    ].join(' · '),
  }));
  return shareBlock(`Share of tasks · ${labelOf(WINDOWS, state.window)}`, rows, 'classes are on the report page.');
}

const baseName = (path) => String(path ?? '').replace(/\/+$/, '').split('/').pop() || String(path ?? '');
const waiting = (cache, what) => (cache?.error ? note(`Could not read ${what}: ${cache.error}`, 'warn') : note(`Reading ${what}…`));

function projects(report) {
  if (!report?.data) return [waiting(report, 'the report')];
  const levels = (report.data.levels ?? []).filter((l) => l.kind === 'project');
  const rowsOf = levels.map((l) => {
    const cells = (l.classes ?? []).flatMap((c) => c.cells ?? []);
    const weight = (x) => (isNum(x.tasks) && x.tasks > 0 ? x.tasks : isNum(x.n) ? x.n : 0);
    const n = cells.reduce((sum, x) => sum + weight(x), 0);
    const success = cells.reduce((sum, x) => sum + (isNum(x.fpy) ? x.fpy * weight(x) : 0), 0);
    const cost = cells.reduce((sum, x) => sum + (isNum(x.costPerTask) ? x.costPerTask * weight(x) : 0), 0);
    return { name: baseName(l.title), n, success, cost };
  }).filter((p) => p.n > 0).sort((a, b) => b.n - a.n);
  const total = rowsOf.reduce((n, p) => n + p.n, 0);
  if (!total) return [note('No project has a learned task yet. A project appears here once a scored task carries one.')];
  const rows = rowsOf.map((p) => ({
    color: null, name: p.name, amount: plural(p.n, 'task'), share: share(p.n, total), bar: barSvg(p.n / total),
    detail: `${fmtPct(p.success / p.n)} right first time · ${fmtUsd(p.success ? p.cost / p.success : null)} per success`,
  }));
  return shareBlock('Share of learned tasks · All time', rows, 'projects are on the report page.');
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions, Trend, Log

function decisionText(d) {
  const [before, after] = [modelName(d.before), modelName(d.after)];
  const got = `${after}${d.effort ? ` · ${d.effort}` : ''}`;
  return `${dayText(d.ts, true)} · ${before === after ? got : `${before} to ${got}`}`;
}

function decisions(data, state) {
  const actions = actionRows(headlineOf(data, state));
  const total = actions.reduce((n, a) => n + a.n, 0);
  if (!total) return [note('No routing decision in this window. Decisions appear here when the first subagent starts.')];
  // No group picked opens the first; `none` is the person closing the open one.
  const open = state.group === 'none' ? null : actions.some((a) => a.action === state.group) ? state.group : actions[0].action;
  const latest = [...(data.decisions?.latest ?? [])].reverse();
  return [
    { kind: 'legend', source: segmentsSvg(actions.map((a) => ({ share: a.n / total, color: a.color }))),
      alt: `Decisions: ${actions.map((a) => `${a.name} ${share(a.n, total)}`).join(', ')}`,
      rows: actions.map((a) => ({ color: a.color, name: a.name, count: fmtNum(a.n), share: share(a.n, total) })) },
    { kind: 'groups', groups: actions.map((a) => {
      const rows = a.action === open ? latest.filter((d) => d.action === a.action).slice(0, DECISIONS_SHOWN) : [];
      return {
        key: a.action, name: a.name, count: fmtNum(a.n), isOpen: a.action === open, aside: rows.length ? `latest ${rows.length}` : null,
        rows: rows.map((d) => ({ text: decisionText(d), value: d.cls ?? d.subagentType ?? null })),
      };
    }) },
    note(`Counts are for the ${windowText(state.window)}; the rows are the latest of every session, in UTC.`),
  ];
}

function trend(report) {
  if (!report?.data) return [waiting(report, 'the report')];
  const weeks = (report.data.trend ?? []).slice(-WEEKS_SHOWN);
  if (!weeks.length) return [note('No scored task yet. The trend appears here week by week.')];
  const bars = (value) => weeks.map((w) => ({ label: dayText(w.week), parts: [{ value: value(w), color: ACCENT }] }));
  const costs = weeks.filter((w) => isNum(w.costPerSuccess));
  const scale = scaleOf(Math.max(0, ...costs.map((w) => w.costPerSuccess)), fmtUsd);
  const best = [...weeks].sort((a, b) => b.fpy - a.fpy)[0];
  const cheapest = [...costs].sort((a, b) => a.costPerSuccess - b.costPerSuccess)[0];
  const page = report.page ? [{ kind: 'markdown', text: `The same figures, with every class and project, as a page: [report.html](file://${encodeURI(report.page)}).` }] : [];
  return [
    { kind: 'chart', title: 'Right first time per week', alt: `From ${fmtPct(weeks[0].fpy)} to ${fmtPct(weeks.at(-1).fpy)} over ${plural(weeks.length, 'week')}`,
      source: chartSvg({ bars: bars((w) => (isNum(w.fpy) ? w.fpy * 100 : 0)), max: 100, ticks: [0, 25, 50, 75, 100].map((v) => ({ value: v, label: v ? `${v}%` : '0' })) }) },
    ...(costs.length ? [{ kind: 'chart', title: 'Cost per success per week', alt: `From ${fmtUsd(costs[0].costPerSuccess)} to ${fmtUsd(costs.at(-1).costPerSuccess)}`,
      source: chartSvg({ bars: bars((w) => (isNum(w.costPerSuccess) ? w.costPerSuccess : 0)), max: scale.top, ticks: scale.ticks }) }] : []),
    { kind: 'grid', pairs: [
      { label: 'Best week', value: `${dayText(best.week)} · ${fmtPct(best.fpy)}` },
      { label: 'Cheapest week', value: cheapest ? `${dayText(cheapest.week)} · ${fmtUsd(cheapest.costPerSuccess)}` : '–' },
    ] },
    ...page,
  ];
}

const TONES = ['good', 'fair', 'bad'];

function recordRow(record) {
  const line = recordLine(record);
  const when = /^\d\d-\d\d \d\d:\d\d$/.test(line.when) ? `${MONTHS[Number(line.when.slice(0, 2)) - 1] ?? ''} ${Number(line.when.slice(3, 5))}, ${line.when.slice(6)}` : line.when;
  return {
    tone: TONES.includes(line.lead?.tone) ? line.lead.tone : null,
    text: [when, line.lead?.text].filter(Boolean).join(' · '),
    value: line.detail.replace(/ → /g, ' to ').replace(/(\w)·(\w)/g, '$1 · $2').slice(0, 64) || null,
  };
}

function logBlocks(log, state) {
  if (!log?.data) return [waiting(log, 'the event log')];
  const data = log.data;
  const types = data.byType ?? [];
  const total = data.total ?? 0;
  if (!total) return [note(`No record, ${windowText(state.window)}. Records appear here as subagents start and report.`)];
  const colorOf = (i) => KIND_COLORS[Math.min(i, KIND_COLORS.length - 1)];
  const nameOf = (type) => RECORD_NAMES[type] ?? cap(type);
  const points = data.series?.points ?? [];
  const byHour = data.series?.unit === 'hour';
  const every = Math.max(1, Math.ceil(points.length / 6));
  const scale = countScale(Math.max(0, ...points.map((p) => p.n)));
  // The log was read for one kind once a group was picked; before that for all kinds, and the first group is open.
  const picked = data.query?.type && data.query.type !== 'all' ? data.query.type : null;
  const open = state.group === 'none' ? null : (picked ?? types[0]?.type ?? null);
  const rowsOf = (type) => (picked ? data.records ?? [] : (data.records ?? []).filter((r) => r?.type === type));
  const bytes = data.files?.log?.bytes;
  const archive = data.files?.archive?.count ?? 0;
  return [
    { kind: 'legend', source: segmentsSvg(types.map((t, i) => ({ share: t.n / total, color: colorOf(i) }))),
      alt: `Records by kind: ${types.map((t) => `${nameOf(t.type)} ${fmtNum(t.n)}`).join(', ')}`,
      rows: types.slice(0, ROWS_SHOWN).map((t, i) => ({ color: colorOf(i), name: nameOf(t.type), count: fmtNum(t.n), share: share(t.n, total) })) },
    ...(points.some((p) => p.n > 0) ? [{
      kind: 'chart', title: byHour ? 'Records per hour' : 'Records per day', alt: `${plural(data.matched ?? total, 'record')}, UTC`,
      source: chartSvg({ max: scale.top, ticks: scale.ticks, bars: points.map((p, i) => ({
        label: (points.length - 1 - i) % every === 0 ? (byHour ? `${String(p.key).slice(11, 13)}:00` : dayText(String(p.key).slice(0, 10))) : '',
        parts: [{ value: p.n, color: ACCENT }],
      })) }),
    }] : []),
    { kind: 'groups', groups: types.slice(0, ROWS_SHOWN).map((t) => {
      const rows = t.type === open ? rowsOf(t.type).slice(0, RECORDS_SHOWN).map(recordRow) : [];
      return { key: t.type, name: nameOf(t.type), count: fmtNum(t.n), isOpen: t.type === open, aside: rows.length ? `latest ${rows.length}` : null, rows };
    }) },
    { kind: 'markdown', text: `The whole log is ${log.file ? `[events.jsonl](file://${encodeURI(log.file)})` : 'events.jsonl'}${isNum(bytes) ? `, ${fmtBytes(bytes)}` : ''}${archive ? `, with ${plural(archive, 'archive file')}` : ''}.` },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The card

/** Which dropdowns a view has: the scope where the figures are per level, the window where they are per window. */
function navOf(data, state) {
  const scoped = ['overview', 'models', 'classes', 'decisions'].includes(state.view) && Boolean(data?.project);
  const windowed = !REPORT_VIEWS.includes(state.view);
  return {
    view: { value: state.view, options: VIEWS },
    ...(scoped ? { scope: { value: state.level, options: SCOPES } } : {}),
    ...(windowed ? { window: { value: state.window, options: WINDOWS } } : { aside: 'All time' }),
  };
}

function blocksOf({ state, usage, report, log, status }) {
  if (state.view === 'log') return logBlocks(log, state);
  if (REPORT_VIEWS.includes(state.view)) return state.view === 'trend' ? trend(report) : projects(report);
  if (!usage?.data) return [waiting(usage, 'the usage data')];
  const body = { overview: () => overview(usage.data, state, status), models: () => models(usage.data, state), classes: () => classes(usage.data, state), decisions: () => decisions(usage.data, state) };
  return [...body[state.view](), ...(usage.error ? [note(`Last read failed: ${usage.error}`, 'warn')] : [])];
}

/**
 * The card for a state and what was read: `usage`, `report` and `log` are `{ data, error, isLoading }` (the report
 * also the `page` it was written to, the log its `file`), `status` the router's switches. A view whose data is not
 * read yet says so in one line; a view that cannot be built says why, and the card is still drawn.
 */
export function cardOf(input) {
  const data = input.usage?.data ?? null;
  // This project's figures need a project: a session without one shows all projects, as the dropdown is not drawn.
  const asked = cardStateOf(input.state);
  const state = asked.level === 'project' && data && !data.project ? { ...asked, level: 'user' } : asked;
  const logData = input.log?.data;
  const summary = state.view === 'log' && logData ? `${plural(logData.total ?? 0, 'record')} · ${windowText(state.window)}` : data ? summaryOf(data, state) : 'reading…';
  let blocks;
  try {
    blocks = blocksOf({ ...input, state });
  } catch (err) {
    blocks = [note(`Could not draw this view: ${String(err?.message ?? err).slice(0, 200)}`, 'warn')];
  }
  return {
    title: CARD_TITLE, icon: 'route', summary, isCollapsed: state.isCollapsed,
    segments: data ? modelSegments(data, state) : null, nav: navOf(data, state), blocks,
  };
}

/** `/model-router help` on the desktop app: what each argument opens the card on. */
export function helpCard() {
  return {
    title: '/model-router', icon: 'route', summary: '', isCollapsed: false, isStatic: true, segments: null, nav: null,
    blocks: [
      { kind: 'list', rows: [
        { term: '(nothing)', text: 'The card on Overview, last 7 days, all projects' },
        { term: 'models  classes  decisions', text: 'The card on that view' },
        { term: '24h  7d  30d  all', text: 'The card for that window' },
        { term: 'project', text: 'This project only' },
        { term: 'report', text: 'The card on Trend; its last line links the report page' },
        { term: 'log', text: 'The card on Log, last 24 hours' },
        { term: 'on  off', text: 'Routing for this session' },
      ] },
      note('For you only: the model does not read this card.'),
    ],
  };
}

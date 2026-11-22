// The usage view for graphical surfaces (Claude Desktop, the editor, the phones): the same data as the terminal's
// rows (lib/usage-view.mjs), shaped as cards, table rows, chips and SVG charts instead of monospace text art.
// Pure: it takes the data lib/usage-data.mjs builds and returns plain values the pane lays out with native
// elements. Formatting and statuses come from usage-view and usage-tiles, so the two renderings cannot disagree.
// See docs/design/model-router.md, "Graphical surfaces".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.
import { SERIES } from './usage-data.mjs';
import { COLORS, barSvg, sparklineSvg, toneColor } from './usage-svg.mjs';
import { WEAK_N, costStatus, deltaOf, fpyStatus, reworkStatus } from './usage-tiles.mjs';
import {
  ACTION_ORDER, DECISIONS_SHOWN, DEFAULT_VIEW, LEVELS, RECOMMENDATIONS_SHOWN, TABS, WINDOW_TITLES,
  cellName, fmtNum, fmtPct, fmtTokens, fmtUsd, headlineFor, levelName, noteRows, shortModel,
} from './usage-view.mjs';

const NOTE_COLUMNS = 140;
const SPARK_SIZE = Object.freeze({ width: 168, height: 40 });
const BAR_SIZE = Object.freeze({ width: 120, height: 8 });
const BEFORE = Object.freeze({ '24h': 'vs the 24 hours before', '7d': 'vs the 7 days before', '30d': 'vs the 30 days before' });
/** How an action reads as a chip: cheaper is good, a forced upgrade a caution, an error bad; the rest neutral. */
export const ACTION_TONES = Object.freeze({ downgrade: 'good', upgrade: 'accent', keep: 'dim', explicit: 'dim', 'forced-risk': 'fair', error: 'bad' });
const EMPTY = Object.freeze({
  window: 'No task scored in this window yet — the figures fill in as subagent work closes',
  project: 'This session has no project id yet.',
  session: 'Subagents of this session appear here with their tokens and cost, as soon as the first one runs.',
  routing: 'Routing decisions of this session appear here, by action, when the first subagent starts.',
  models: 'No closed task in this window. Models appear here once a subagent task is scored.',
  classes: 'No learned task here yet. Classes appear once a scored task carries one.',
  decisions: 'Routing decisions appear here, newest last, when the first subagent starts.',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;
const has = (table, key) => Object.hasOwn(table, key);

/** The three status pills: routing, measuring, adapt, each on or off. Empty when the status is unknown. */
export function pillsOf(status) {
  if (!status) return [];
  const routing = status.routing ? 'on' : `off${status.routeSubagents === false ? ' (routeSubagents is false)' : ''}`;
  return [
    { key: 'routing', text: `routing ${routing}`, on: Boolean(status.routing) },
    { key: 'measuring', text: `measuring ${status.measuring ? 'on' : 'off'}`, on: Boolean(status.measuring) },
    { key: 'adapt', text: `adapt ${status.adapt ? 'on (not used before 0.4)' : 'off'}`, on: Boolean(status.adapt) },
  ];
}

/** The one line that stands for the sample size: under WEAK_N closed tasks the figures are indicative. Else null. */
export function bannerOf(headline) {
  const closed = headline?.current?.closed;
  const n = isNum(closed) ? closed : 0;
  if (n >= WEAK_N) return null;
  if (n <= 0) return EMPTY.window;
  return `${plural(n, 'task')} scored — figures are indicative under ${WEAK_N}`;
}

/** A status as a chip, or null where it only says the sample is small (the banner says that once). */
const chipOf = (status) => (status.tone === 'dim' ? null : { text: status.word, tone: status.tone });

/** The change against the window before as the card writes it: `▼ 25 pts`, `▲ 12%`, `no change`; null when unknown. */
function deltaChip(now, before, { points, higherIsBetter }) {
  const d = deltaOf(now, before, { points, higherIsBetter });
  if (!d.text) return null;
  if (d.text === '=') return { text: 'no change', tone: 'dim' };
  return { text: `${d.text[0]} ${d.text.slice(1)}${points ? ' pts' : ''}`, tone: d.tone };
}

const stamp = (ms) => new Date(ms).toISOString();

/** What each bucket of a window's series is called in a tooltip: its day, its hour, or the days it spans. */
function bucketNames(window, generatedAt, count) {
  const spec = SERIES[has(SERIES, window) ? window : '7d'];
  const now = Date.parse(generatedAt);
  if (!Number.isFinite(now)) return Array.from({ length: count }, (_, i) => `${spec.unit} ${i + 1}`);
  const start = now - count * spec.ms;
  return Array.from({ length: count }, (_, i) => {
    const from = stamp(start + i * spec.ms);
    const to = stamp(start + (i + 1) * spec.ms);
    if (window === '24h') return `${to.slice(5, 10)} ${to.slice(11, 16)}`;
    return spec.ms > 86400000 ? `${from.slice(5, 10)} to ${to.slice(5, 10)}` : to.slice(5, 10);
  });
}

/** The sparkline of one measure of a series: `{ source, alt, width, height, isInteractive }`, or null with no value. */
function sparkOf(series, field, { label, fmt, domain, window, generatedAt }) {
  try {
    const points = Array.isArray(series?.points) ? series.points : [];
    const values = points.map((p) => (isNum(p?.[field]) ? p[field] : null));
    const known = values.filter(isNum);
    if (!known.length) return null;
    const names = bucketNames(window, generatedAt, points.length);
    const labels = points.map((p, i) => (isNum(p?.[field]) ? `${names[i]}: ${fmt(p[field])} · ${plural(p.n ?? 0, 'task')}` : `${names[i]}: no task closed`));
    return {
      source: sparklineSvg(values, { ...SPARK_SIZE, color: COLORS.line, domain, labels }),
      alt: `${label} by ${series?.unit ?? 'day'}, latest ${fmt(known.at(-1))}`,
      ...SPARK_SIZE,
      isInteractive: true,
    };
  } catch {
    return null;
  }
}

/**
 * The four KPI cards of a headline (`{ current, previous, series }`): FPY, cost per success, rework, routed starts.
 * Each is `{ key, label, value, unit, chip, delta, detail, spark }`; what is unknown is null. `context` carries the
 * `window` and the data's `generatedAt`, for the sparklines' tooltips.
 */
export function kpiCards(headline, context = {}) {
  const c = headline?.current ?? {};
  const p = headline?.previous ?? null;
  const closed = isNum(c.closed) ? c.closed : 0;
  const r = { total: 0, downgrade: 0, upgrade: 0, keep: 0, ...(c.routed ?? {}) };
  const spark = (field, label, fmt, domain) => sparkOf(headline?.series, field, { ...context, label, fmt, domain });
  const card = (key, label, value, rest) => ({ key, label, value, unit: null, chip: null, delta: null, detail: null, spark: null, ...rest });
  return [
    card('fpy', 'FPY', fmtPct(c.fpy), {
      chip: chipOf(fpyStatus(c.fpy, closed)),
      delta: deltaChip(c.fpy, p?.fpy, { points: true, higherIsBetter: true }),
      spark: spark('fpy', 'FPY', fmtPct, [0, 1]),
    }),
    card('cost', '$/success', fmtUsd(c.costPerSuccess), {
      chip: chipOf(costStatus(c.costPerSuccess, p?.costPerSuccess, closed)),
      delta: deltaChip(c.costPerSuccess, p?.costPerSuccess, { points: false, higherIsBetter: false }),
      spark: spark('costPerSuccess', '$/success', fmtUsd, undefined),
    }),
    card('rework', 'Rework', fmtPct(c.reworkRate), {
      chip: chipOf(reworkStatus(c.reworkRate, closed)),
      delta: deltaChip(c.reworkRate, p?.reworkRate, { points: true, higherIsBetter: false }),
      spark: spark('reworkRate', 'Rework', fmtPct, [0, 1]),
    }),
    card('routed', 'Routed', fmtNum(r.total), { unit: r.total === 1 ? 'start' : 'starts', detail: `${r.downgrade} down · ${r.upgrade} up · ${r.keep} kept` }),
  ];
}

const barOf = (share, tone, alt) => ({ source: barSvg(share, { ...BAR_SIZE, color: toneColor(tone) }), alt, ...BAR_SIZE });
const fpyBar = (m) => barOf(m.fpy, fpyStatus(m.fpy, m.n).tone, `FPY ${fmtPct(m.fpy)}`);

function modelsSection(data, view, { detailed }) {
  const w = data.windows?.[view.window];
  const list = w?.models ?? [];
  const cost = list.reduce((n, m) => n + (m.costSum ?? 0), 0);
  const tokens = list.reduce((n, m) => n + (m.tokensSum ?? 0), 0);
  const ids = [...new Set(list.flatMap((m) => m.models ?? []))];
  return {
    title: detailed ? `Models · ${WINDOW_TITLES[view.window]} · ${w?.tasks ?? 0} closed tasks · ${fmtTokens(tokens)} tokens · ${fmtUsd(cost)}` : 'Models',
    empty: list.length ? null : EMPTY.models,
    rows: list.map((m) => ({
      name: cellName(m.tier, m.effort), fpy: fmtPct(m.fpy), bar: fpyBar(m), costPerSuccess: fmtUsd(m.costPerSuccess),
      tasks: plural(m.n, 'task'), n: fmtNum(m.n), tokens: fmtTokens(m.tokensSum), cost: fmtUsd(m.costSum),
    })),
    ids: detailed && ids.length ? `Model ids: ${ids.join(', ')}` : null,
  };
}

function sessionSection(data) {
  const s = data.session ?? { models: [], agents: 0, cost: 0 };
  if (!s.agents) return { title: 'Session', summary: null, empty: EMPTY.session, rows: [], note: null };
  const rows = (s.models ?? []).map((m) => {
    const parts = m.isPartial && !m.input && !m.output
      ? [`${fmtTokens(m.tokens)} tokens`]
      : [`${fmtTokens(m.input)} input`, `${fmtTokens(m.output)} output`, `${fmtTokens(m.cacheRead)} cache read`, `${fmtTokens(m.cacheWrite)} cache write`];
    return { model: String(m.model), detail: `${m.agents} × ${parts.join(' · ')}`, cost: fmtUsd(m.cost) };
  });
  return {
    title: 'Session', summary: `${plural(s.agents, 'subagent')} · ${fmtUsd(s.cost)}`, empty: null, rows,
    note: (s.models ?? []).some((m) => m.isPartial) ? 'Dropped agents show total tokens only (from the log).' : null,
  };
}

function routingSection(data) {
  const r = data.routing ?? { total: 0, byAction: {} };
  const title = `Routing · ${plural(r.total, 'decision')} this session`;
  if (!r.total) return { title, empty: EMPTY.routing, rows: [] };
  const actions = [...ACTION_ORDER, ...Object.keys(r.byAction ?? {}).filter((a) => !ACTION_ORDER.includes(a))];
  const rows = actions.filter((a) => r.byAction?.[a]).map((action) => {
    const n = r.byAction[action];
    const tone = ACTION_TONES[action] ?? 'dim';
    return { action, tone, count: fmtNum(n), bar: barOf(n / r.total, 'accent', `${fmtPct(n / r.total)} of the decisions`) };
  });
  return { title, empty: null, rows };
}

const metricsOf = (m) => ({ n: fmtNum(m.n), fpy: fmtPct(m.fpy), rework: fmtPct(m.reworkRate), costPerSuccess: fmtUsd(m.costPerSuccess) });

function classesSection(data, view) {
  const level = view.level === 'project' ? 'project' : 'user';
  const title = `Classes · ${levelName(data, view)} · ${WINDOW_TITLES[view.window]}${view.window === 'all' ? ', aged as on the report page' : ''}`;
  const none = { title, rows: [], recommendations: [], callout: null };
  if (level === 'project' && !data.project) return { ...none, empty: EMPTY.project };
  const classes = data.windows?.[view.window]?.classes?.[level] ?? [];
  if (!classes.length) return { ...none, empty: EMPTY.classes };
  const rows = classes.map((c) => {
    const rec = c.recommendation;
    const best = rec?.source === 'data'
      ? `best ${cellName(rec.tier, rec.effort)} ${fmtUsd(c.cells.find((x) => x.recommended)?.costPerSuccess)}`
      : 'best: not enough data';
    return {
      name: c.cls, ...metricsOf(c.summary), bar: fpyBar(c.summary), grid: `grid ${cellName(c.default.tier, c.default.effort)}`,
      best, differs: Boolean(c.differs), flags: c.summary.flags?.length ? c.summary.flags.join(', ') : null,
      cells: c.cells.map((x) => ({ name: cellName(x.tier, x.effort), recommended: Boolean(x.recommended), ...metricsOf(x), bar: fpyBar(x) })),
    };
  });
  const recommendations = classes.filter((c) => c.differs).slice(0, RECOMMENDATIONS_SHOWN).map((c) => {
    const x = c.cells.find((y) => y.recommended);
    return `${c.cls}: ${cellName(c.recommendation.tier, c.recommendation.effort)} over grid ${cellName(c.default.tier, c.default.effort)} · ${fmtPct(x?.fpy)} FPY · ${fmtUsd(x?.costPerSuccess)}/success`;
  });
  return { title, empty: null, rows, recommendations, callout: recommendations.length ? recommendations.join('\n') : 'None differs from the grid.' };
}

function decisionsSection(data) {
  const shown = (data.decisions?.latest ?? []).slice(-DECISIONS_SHOWN);
  const title = `Decisions · latest ${shown.length} of ${data.decisions?.total ?? 0} · all sessions · UTC`;
  const rows = shown.map((d) => ({
    when: `${String(d.ts).slice(5, 10)} ${String(d.ts).slice(11, 16)}`, action: String(d.action), tone: ACTION_TONES[d.action] ?? 'dim',
    models: `${shortModel(d.before)} → ${shortModel(d.after)}${d.effort ? `·${d.effort}` : ''}`,
    who: d.subagentType ?? '', reason: d.reason ?? '', isThisSession: Boolean(d.isThisSession),
  }));
  return { title, empty: rows.length ? null : EMPTY.decisions, rows, legend: rows.some((d) => d.isThisSession) ? '• this session' : null };
}

function notesOf(data, { error, isLoading }) {
  return [
    ...noteRows(data, NOTE_COLUMNS).map((r) => ({ text: r.text, tone: r.tone ?? null })),
    ...(isLoading ? [{ text: 'Refreshing…', tone: 'dim' }] : []),
    ...(error ? [{ text: `Last refresh failed: ${error}`, tone: 'warn' }] : []),
  ];
}

/** The view with its defaults: an unknown tab, window or level takes the default one. */
function viewOf(view) {
  const v = { ...DEFAULT_VIEW, ...Object.fromEntries(Object.entries(view ?? {}).filter(([, x]) => x !== null && x !== undefined)) };
  if (!TABS.includes(v.tab)) v.tab = DEFAULT_VIEW.tab;
  if (!has(WINDOW_TITLES, v.window)) v.window = DEFAULT_VIEW.window;
  if (!LEVELS.includes(v.level)) v.level = DEFAULT_VIEW.level;
  return v;
}

/**
 * Everything a graphical surface draws for one tab: `view` is `{ tab, window, level, status }`, `state` the read's
 * `{ error, isLoading }`. Always `{ tab, window, level, pills, subtitle, banner, kpis, message, notes }`; with data,
 * the tab's sections too: `models`, `session` and `routing` on Overview, `models` on Models, `classes` on Classes,
 * `decisions` on Decisions. `message` stands in for the content while there is no data.
 */
export function cardsView(data, view, state = {}) {
  const v = viewOf(view);
  const base = { tab: v.tab, window: v.window, level: v.level, pills: pillsOf(v.status), subtitle: null, banner: null, kpis: [], message: null, notes: [] };
  if (!data) {
    return { ...base, message: state.error ? { text: `Could not read the usage data: ${state.error}`, tone: 'warn' } : { text: 'Reading the usage data…', tone: 'dim' } };
  }
  const out = { ...base, notes: notesOf(data, state) };
  if (v.tab === 'decisions') return { ...out, decisions: decisionsSection(data) };
  const h = headlineFor(data, v);
  const when = capital(WINDOW_TITLES[v.window]);
  out.subtitle = [when, levelName(data, v), `${plural(h?.current?.closed ?? 0, 'task')} scored`, BEFORE[v.window]].filter(Boolean).join(' · ');
  if (v.level === 'project' && !data.project) {
    out.banner = EMPTY.project;
  } else {
    out.banner = bannerOf(h);
    out.kpis = kpiCards(h, { window: v.window, generatedAt: data.generatedAt });
  }
  if (v.tab === 'models') return { ...out, models: modelsSection(data, v, { detailed: true }) };
  if (v.tab === 'classes') return { ...out, classes: classesSection(data, v) };
  return { ...out, models: modelsSection(data, v, { detailed: false }), session: sessionSection(data), routing: routingSection(data) };
}

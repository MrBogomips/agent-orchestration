// The usage view of /model-router: arguments, and the rows of each tab for a width. Pure: it takes the data
// lib/usage-data.mjs builds and returns rows ({ text, tone }), which the pane and the text fallback both draw.
// See docs/design/model-router.md, "Command".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.
import { familyOf } from './tiers.mjs';
import { ROUTE_ICON } from './route-line.mjs';
import { TILES_ONE_ROW, fpyStatus, sparkRows, tileRows } from './usage-tiles.mjs';
import { cutToWidth, displayWidth, padEndTo, padStartTo } from './width.mjs';

export const TABS = Object.freeze(['overview', 'models', 'classes', 'decisions']);
export const TAB_TITLES = Object.freeze({ overview: 'Overview', models: 'Models', classes: 'Classes', decisions: 'Decisions' });
export const WINDOW_KEYS = Object.freeze({ d: '24h', w: '7d', m: '30d', a: 'all' });
export const WINDOW_TITLES = Object.freeze({ '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days', all: 'all time' });
export const LEVELS = Object.freeze(['user', 'project']);
export const DEFAULT_VIEW = Object.freeze({ tab: 'overview', window: '7d', level: 'user' });
export const MIN_COLUMNS = 60;
export const HEADLESS_COLUMNS = 80;
const MAX_COLUMNS = 140;
const BAR_MIN = 6;
const BAR_MAX = 20;
const DECISIONS_SHOWN = 12;
const RECOMMENDATIONS_SHOWN = 3;
const ACTION_ORDER = ['downgrade', 'upgrade', 'keep', 'explicit', 'forced-risk', 'error'];
const has = (table, key) => Object.hasOwn(table, key);
const TAB_ALIASES = { overview: 'overview', models: 'models', model: 'models', classes: 'classes', class: 'classes', stats: 'classes', decisions: 'decisions' };

// ---------------------------------------------------------------------------------------------------------------
// Arguments

/**
 * What `/model-router <args>` asks for: `{ kind: 'toggle', on }`, `{ kind: 'help' }`, `{ kind: 'report' }`,
 * `{ kind: 'log' }` (open the event log),
 * `{ kind: 'view', tab, window, level }` (each null when not given), or `{ kind: 'unknown', word }`.
 */
export function parseArgs(text) {
  const words = String(text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 1 && (words[0] === 'on' || words[0] === 'off')) return { kind: 'toggle', on: words[0] === 'on' };
  if (words.length === 1 && ['help', '-h', '--help', '?'].includes(words[0])) return { kind: 'help' };
  if (words.length === 1 && words[0] === 'report') return { kind: 'report' };
  if (words.length === 1 && words[0] === 'log') return { kind: 'log' };
  const view = { kind: 'view', tab: null, window: null, level: null };
  for (const word of words) {
    const bare = word.replace(/^--/, '');
    if (has(TAB_ALIASES, word) && !view.tab) view.tab = TAB_ALIASES[word];
    else if (has(WINDOW_TITLES, word) && !view.window) view.window = word;
    else if (LEVELS.includes(bare) && !view.level) view.level = bare;
    else return { kind: 'unknown', word };
  }
  return view;
}

/** The arguments and the keys of the view, one line each. */
export function helpText() {
  return [
    `${ROUTE_ICON} Usage: /model-router [tab] [window] [level] | on | off | report | log | help`,
    '',
    '  (none)          the usage view on Overview, last 7 days, user level',
    '  overview|models|classes|decisions',
    '                  open on that tab',
    '  24h|7d|30d|all  the window (all: Classes as on the report page)',
    '  user|project    the level: all your projects, or this one',
    '  on|off          routing on or off for this session',
    '  report          write and open the HTML report; prints its path',
    '  log             open the event log (events.jsonl); prints its path',
    '  help            this list',
    '',
    'Keys: Tab/Shift+Tab switch tab · Up/Down or d/w/m/a window 24h/7d/30d/all ·',
    'p user/project · o report · r refresh (runs compaction) · l open the event log ·',
    'Esc close.',
    'Where no pane fits (headless, -p, under 60 columns) the view prints as text.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Tokens as 940, 1.2k, 3.4M. */
export function fmtTokens(n) {
  if (!isNum(n)) return '–';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** Dollars as the report page writes them: four decimals under a cent, three above. */
export function fmtUsd(v) {
  if (!isNum(v)) return '–';
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}`;
}

export const fmtPct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '–');
/** A count: whole numbers as they are, aged (fractional) counts with one decimal. */
export const fmtNum = (v) => (isNum(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '–');

/** A text bar of `width` cells filled to `share` (0 to 1); an unknown share is all empty. */
export function bar(share, width) {
  const w = Math.max(0, Math.floor(width));
  const filled = isNum(share) ? Math.max(0, Math.min(w, Math.round(share * w))) : 0;
  return '█'.repeat(filled) + '░'.repeat(w - filled);
}

/** The text cut to `width` terminal columns, with `…` where it was cut; wide characters count two. */
export function fit(text, width) {
  const s = String(text);
  if (displayWidth(s) <= width) return s;
  return width <= 1 ? cutToWidth(s, width) : `${cutToWidth(s, width - 1)}…`;
}

const left = (text, width) => padEndTo(fit(text, width), width);
const right = (text, width) => padStartTo(fit(text, width), width);
const cell = (tier, effort) => `${tier ?? 'other'}·${effort ?? '–'}`;
/** The width the rows are laid out at: at least 60 columns, 80 when none is known. */
export const layoutWidth = (columns) => Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, isNum(columns) && columns > 0 ? Math.floor(columns) : HEADLESS_COLUMNS));
const barWidth = (width, fixed) => Math.max(BAR_MIN, Math.min(BAR_MAX, width - fixed));

const row = (text, tone) => (tone ? { text, tone } : { text });
const title = (text) => row(text, 'title');
const dim = (text) => row(text, 'dim');
const blank = () => row('');

/** `prefix` then the parts joined by `, `, wrapped onto lines indented by `indent` to stay within `width`. */
function wrapParts(prefix, parts, width, indent) {
  const lines = [];
  let line = prefix;
  for (const [i, part] of parts.entries()) {
    const piece = `${part}${i < parts.length - 1 ? ',' : ''}`;
    const sep = line.trim() === '' || line === prefix ? '' : ' ';
    if (displayWidth(line) + sep.length + displayWidth(piece) > width && line.trim() !== '' && line !== prefix) {
      lines.push(line);
      line = ' '.repeat(indent) + piece;
    } else {
      line += sep + piece;
    }
  }
  lines.push(line);
  return lines.map((l) => fit(l, width));
}

// ---------------------------------------------------------------------------------------------------------------
// Tabs

const LABEL = 22;
const labelled = (label, value, width) => fit(`${padEndTo(label, LABEL)}${value}`, width);

/** The status as its three parts, each `{ key, text, on }`: routing, measuring, adapt. Empty when it is unknown. */
export function statusParts(status) {
  if (!status) return [];
  const routing = status.routing ? 'on' : `off${status.routeSubagents === false ? ' (routeSubagents is false)' : ''}`;
  const adapt = status.adapt ? 'on (not used before 0.4)' : 'off';
  return [
    { key: 'routing', text: `routing ${routing}`, on: Boolean(status.routing) },
    { key: 'measuring', text: `measuring ${status.measuring ? 'on' : 'off'}`, on: Boolean(status.measuring) },
    { key: 'adapt', text: `adapt ${adapt}`, on: Boolean(status.adapt) },
  ];
}

const statusText = (status) => statusParts(status).map((p) => p.text).join(' · ') || 'unknown';

/** The view with its defaults: a missing or unknown tab, window or level takes the default one. */
export function viewOf(view) {
  const v = { ...DEFAULT_VIEW, ...Object.fromEntries(Object.entries(view ?? {}).filter(([, x]) => x !== null && x !== undefined)) };
  if (!TABS.includes(v.tab)) v.tab = DEFAULT_VIEW.tab;
  if (!has(WINDOW_TITLES, v.window)) v.window = DEFAULT_VIEW.window;
  if (!LEVELS.includes(v.level)) v.level = DEFAULT_VIEW.level;
  return v;
}

/** The token counts of one model of the session: its four kinds, or the total alone for agents read from the log. */
export function sessionParts(m) {
  return m.isPartial && !m.input && !m.output
    ? [`${fmtTokens(m.tokens)} tokens`]
    : [`${fmtTokens(m.input)} input`, `${fmtTokens(m.output)} output`, `${fmtTokens(m.cacheRead)} cache read`, `${fmtTokens(m.cacheWrite)} cache write`];
}

/** The best measured cell of a class with its cost per success, or that the data is not enough to name one. */
export function bestText(c) {
  const rec = c.recommendation;
  return rec?.source === 'data'
    ? `best ${cell(rec.tier, rec.effort)} ${fmtUsd(c.cells.find((x) => x.recommended)?.costPerSuccess)}`
    : 'best: not enough data';
}

/** The headline of the window at the view's level: `{ current, previous, series }`, or null. */
function headlineOf(data, view) {
  const h = data.windows?.[view.window]?.headline;
  return (view.level === 'project' ? h?.project : h?.user) ?? null;
}

const levelName = (data, view) => (view.level === 'project' ? `project ${data.project?.root ?? data.project?.id ?? ''}`.trim() : 'user level');

/** The KPI tiles of the window, with the window of the same length before it as the comparison. */
function headlineRows(data, view, width) {
  const h = headlineOf(data, view);
  const versus = view.window === 'all' ? '' : ' · vs the one before';
  const when = WINDOW_TITLES[view.window];
  const rows = [title(fit(`${when[0].toUpperCase()}${when.slice(1)} · ${levelName(data, view)} · ${h?.current?.closed ?? 0} tasks scored${versus}`, width))];
  if (view.level === 'project' && !data.project) return [...rows, dim('This session has no project id yet.')];
  return [...rows, ...tileRows(h, width)];
}

/** One tier·effort with its FPY bar, coloured as the FPY reads: 🟢, 🟡, 🔴, or dim under five tasks. */
function modelBarRow(m, width) {
  const L = 15;
  const b = barWidth(width, L + 5 + 9 + 12);
  const head = `${left(cell(m.tier, m.effort), L)}`;
  const tail = `${right(fmtPct(m.fpy), 5)} ${right(fmtUsd(m.costPerSuccess), 9)} ${right(`${fmtNum(m.n)} task${m.n === 1 ? '' : 's'}`, 10)}`;
  const text = fit(`${head}${bar(m.fpy, b)}${tail}`, width);
  return { text, segments: [{ text: head }, { text: bar(m.fpy, b), tone: fpyStatus(m.fpy, m.n).tone }, { text: text.slice(head.length + b) }] };
}

function overviewRows(data, view, width) {
  const rows = [row(labelled('Status:', statusText(view.status), width)), blank(), ...headlineRows(data, view, width)];
  const h = headlineOf(data, view);
  if (h) rows.push(blank(), ...sparkRows(h.series).map((r) => row(fit(r.text, width))));
  const models = data.windows?.[view.window]?.models ?? [];
  if (models.length) rows.push(blank(), ...models.map((m) => modelBarRow(m, width)));
  const s = data.session ?? { models: [], agents: 0, cost: 0 };
  rows.push(blank(), title('Session'));
  if (!s.agents) {
    rows.push(dim('No subagent has run in this session yet.'));
  } else {
    rows.push(row(labelled('Subagents:', `${s.agents} · ${fmtUsd(s.cost)}`, width)), row('Usage by model:'));
    for (const m of s.models) {
      const parts = sessionParts(m);
      const head = `${padEndTo(`   ${m.model}:`, LABEL)}${m.agents} × `;
      const lines = wrapParts(head, [...parts.slice(0, -1), `${parts.at(-1)} (${fmtUsd(m.cost)})`], width, LABEL);
      rows.push(...lines.map((l) => row(l)));
    }
    if (s.models.some((m) => m.isPartial)) rows.push(dim(fit('Dropped agents show total tokens only (from the log).', width)));
  }
  const r = data.routing ?? { total: 0, byAction: {} };
  rows.push(blank(), title(fit(`Routing · ${r.total} decision${r.total === 1 ? '' : 's'} this session`, width)));
  if (!r.total) {
    rows.push(dim('No routing decision in this session yet.'));
  } else {
    const actions = [...ACTION_ORDER, ...Object.keys(r.byAction).filter((a) => !ACTION_ORDER.includes(a))];
    const b = barWidth(width, LABEL + 8);
    for (const action of actions) {
      const n = r.byAction[action] ?? 0;
      if (n) rows.push(row(fit(`  ${action.padEnd(LABEL - 2)}${bar(n / r.total, b)} ${n}`, width)));
    }
  }
  return rows;
}

function modelsRows(data, view, width) {
  const w = data.windows?.[view.window];
  const list = w?.models ?? [];
  const cost = list.reduce((n, m) => n + (m.costSum ?? 0), 0);
  const tokens = list.reduce((n, m) => n + (m.tokensSum ?? 0), 0);
  const rows = [title(fit(`Models · ${WINDOW_TITLES[view.window]} · ${w?.tasks ?? 0} closed tasks · ${fmtTokens(tokens)} tokens · ${fmtUsd(cost)}`, width))];
  if (list.length === 0) return [...rows, dim('No closed task in this window.')];
  const L = 15;
  const fixed = L + 1 + 5 + 1 + 7 + 1 + 7 + 2 + 5 + 1 + 9;
  const b = barWidth(width, fixed);
  rows.push(dim(fit(`${''.padEnd(L)} ${right('tasks', 5)} ${right('tokens', 7)} ${right('cost', 7)}  ${left('FPY', b + 5)} ${right('$/success', 9)}`, width)));
  for (const m of list) {
    const head = `${left(cell(m.tier, m.effort), L)} ${right(fmtNum(m.n), 5)} ${right(fmtTokens(m.tokensSum), 7)} ${right(fmtUsd(m.costSum), 7)}  `;
    const text = fit(`${head}${bar(m.fpy, b)}${right(fmtPct(m.fpy), 5)} ${right(fmtUsd(m.costPerSuccess), 9)}`, width);
    rows.push({ text, segments: [{ text: head }, { text: bar(m.fpy, b), tone: fpyStatus(m.fpy, m.n).tone }, { text: text.slice(head.length + b) }] });
  }
  const ids = new Map();
  for (const m of list) for (const id of m.models ?? []) ids.set(id, m.tier);
  if (ids.size) rows.push(...wrapParts('Model ids: ', [...ids.keys()], width, 11).map((l) => dim(l)));
  return rows;
}

function classRows(data, view, width) {
  const w = data.windows?.[view.window];
  const level = view.level === 'project' ? 'project' : 'user';
  const where = level === 'project' ? `project ${data.project?.root ?? data.project?.id ?? ''}`.trim() : 'user level';
  const rows = [title(fit(`Classes · ${where} · ${WINDOW_TITLES[view.window]}${view.window === 'all' ? ', aged as on the report page' : ''}`, width))];
  if (level === 'project' && !data.project) return [...rows, dim('This session has no project id yet.')];
  const classes = w?.classes?.[level] ?? [];
  if (classes.length === 0) return [...rows, dim('No learned task here yet.')];
  const L = 18;
  const fixed = L + 1 + 5 + 2 + 5 + 1 + 7 + 1 + 9;
  const b = barWidth(width, fixed);
  rows.push(dim(fit(`${''.padEnd(L)} ${right('n', 5)}  ${left('FPY', b + 5)} ${right('rework', 7)} ${right('$/success', 9)}`, width)));
  const line = (label, m) => `${left(label, L)} ${right(fmtNum(m.n), 5)}  ${bar(m.fpy, b)}${right(fmtPct(m.fpy), 5)} ${right(fmtPct(m.reworkRate), 7)} ${right(fmtUsd(m.costPerSuccess), 9)}`;
  for (const c of classes) {
    rows.push(row(fit(line(c.cls, c.summary), width)));
    const flags = c.summary.flags?.length ? ` · ${c.summary.flags.join(', ')}` : '';
    rows.push(row(fit(`  grid ${cell(c.default.tier, c.default.effort)} · ${bestText(c)}${c.differs ? ' (differs)' : ''}${flags}`, width), c.differs ? 'warn' : 'dim'));
    for (const x of c.cells) rows.push(dim(fit(line(`  ${x.recommended ? '*' : ' '} ${cell(x.tier, x.effort)}`, x), width)));
  }
  const differing = classes.filter((c) => c.differs).slice(0, RECOMMENDATIONS_SHOWN);
  rows.push(blank(), title('Recommendations'));
  if (differing.length === 0) {
    rows.push(dim('  None differs from the grid.'));
  } else {
    for (const c of differing) {
      const x = c.cells.find((y) => y.recommended);
      rows.push(row(fit(`  ${right(fmtPct(x?.fpy), 4)}  ${c.cls}: ${cell(c.recommendation.tier, c.recommendation.effort)} over grid ${cell(c.default.tier, c.default.effort)} · ${fmtUsd(x?.costPerSuccess)}/success`, width)));
    }
  }
  return rows;
}

const shortModel = (m) => (m ? (familyOf(m) === 'other' ? String(m) : familyOf(m)) : '?');

function decisionRows(data, view, width) {
  const all = data.decisions?.latest ?? [];
  const shown = all.slice(-DECISIONS_SHOWN);
  const rows = [title(fit(`Decisions · latest ${shown.length} of ${data.decisions?.total ?? 0} · all sessions · UTC`, width))];
  if (shown.length === 0) return [...rows, dim('No routing decision logged yet.')];
  for (const d of shown) {
    const when = `${d.ts.slice(5, 10)} ${d.ts.slice(11, 16)}`;
    const models = `${shortModel(d.before)} → ${shortModel(d.after)}${d.effort ? `·${d.effort}` : ''}`;
    const mark = d.isThisSession ? '•' : ' ';
    rows.push(row(fit(`${when}${mark} ${left(d.action, 11)} ${left(models, 21)} ${d.subagentType ?? ''}: ${d.reason ?? ''}`, width)));
  }
  if (shown.some((d) => d.isThisSession)) rows.push(dim('• this session'));
  return rows;
}

/** Models and Classes open with the tiles where the four fit on one row. */
const withTiles = (build) => (data, view, width) =>
  (width >= TILES_ONE_ROW ? [...headlineRows(data, view, width), blank(), ...build(data, view, width)] : build(data, view, width));

const BUILDERS = { overview: overviewRows, models: withTiles(modelsRows), classes: withTiles(classRows), decisions: decisionRows };

/**
 * The rows of one tab: `view` is `{ tab, window, level, status }`, `columns` the room. A missing tab, window or
 * level takes the default; missing data gives one row saying so.
 */
export function tabRows(data, view, columns) {
  const width = layoutWidth(columns);
  const v = viewOf(view);
  if (!data) return [dim('Reading the usage data…')];
  return BUILDERS[v.tab](data, v, width);
}

/** The note under the rows: how fresh the data is. */
export function noteRows(data, columns) {
  const width = layoutWidth(columns);
  if (!data) return [];
  const rows = [dim(fit(`Data read ${String(data.generatedAt ?? '').slice(0, 16).replace('T', ' ')} UTC.`, width))];
  if (data.note) rows.push(row(fit(data.note, width), 'warn'));
  return rows;
}

/**
 * The whole view as text, for where no pane can be placed: the tabs asked for (all four when `tab` is null),
 * each under its title, then the note and a pointer to the help.
 */
export function textView(data, view, columns) {
  const width = layoutWidth(columns);
  const v = viewOf(view);
  const tabs = TABS.includes(view?.tab) ? [view.tab] : TABS;
  const out = [`${ROUTE_ICON} Usage · ${WINDOW_TITLES[v.window] ?? v.window} · ${v.level === 'project' ? 'project' : 'user'} level`];
  for (const tab of tabs) {
    out.push('', `── ${TAB_TITLES[tab]} ${'─'.repeat(Math.max(0, width - TAB_TITLES[tab].length - 4))}`);
    out.push(...tabRows(data, { ...v, tab }, width).map((r) => r.text));
  }
  out.push('', ...noteRows(data, width).map((r) => r.text), '/model-router help: tabs, windows, levels and keys.');
  return out.map((l) => l.replace(/\s+$/, '')).join('\n');
}

// What the graphical rendering (lib/usage-cards.mjs) shares with the rows above, so the two cannot disagree.
export { ACTION_ORDER, DECISIONS_SHOWN, RECOMMENDATIONS_SHOWN, cell as cellName, headlineOf as headlineFor, levelName, shortModel };

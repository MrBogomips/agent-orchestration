// The log dashboard as a view model: what the pane of a graphical surface draws from the data scripts/log.mjs
// prints (lib/log-data.mjs). Pure: texts already formatted, charts as SVG strings.
// See docs/design/model-router.md, "The log dashboard".
// Plain ES module with no Node or engine imports, so the mod and node tests load it.
import { LOG_WINDOWS, MAX_KEPT } from './log-data.mjs';
import { ACTION_TONES } from './usage-cards.mjs';
import { BAR_SIZE, COLORS, COLUMNS_SIZE, barSvg, columnsSvg } from './usage-svg.mjs';
import { familyOf } from './tiers.mjs';
import { WINDOW_TITLES, fmtNum, fmtTokens, fmtUsd } from './usage-view.mjs';

/** The log pane, and the keys and labels of its controls. */
export const LOG_PANE = 'model-router-log';
export const LOG_PANE_TITLE = 'model-router log';
export const FILE_KEY = 'file';
export const FILE_LABEL = 'Open file';
export const ALL_TYPES = 'all';
const ARCHIVE_SHOWN = 6;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OUTCOME_TONES = Object.freeze({ success: 'good', rework: 'fair', failure: 'bad' });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const model = (m) => (m ? (familyOf(m) === 'other' ? String(m) : familyOf(m)) : '?');
const join = (parts) => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ');

/** A size in bytes as `940 B`, `1.2 kB`, `3.4 MB`. */
export function fmtBytes(n) {
  if (!isNum(n) || n < 0) return '–';
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

const dayLabel = (day) => {
  const t = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? String(day) : `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
};

// What a record says beyond its type, by type: the fields the log keeps for it, in reading order.
const DETAILS = Object.freeze({
  decision: (r) => join([`${model(r.before)} → ${model(r.after)}${r.effort ? `·${r.effort}` : ''}`, r.subagentType, r.reason]),
  spawn: (r) => join([r.subagentType, r.class, `${model(r.model)}${r.effort ? `·${r.effort}` : ''}`, r.route]),
  outcome: (r) => join([r.class, `${r.tier ?? '?'}${r.effort ? `·${r.effort}` : ''}`, isNum(r.costUsd) ? fmtUsd(r.costUsd) : null, r.why]),
  report: (r) => join([r.status, model(r.model), isNum(r.tokens) ? `${fmtTokens(r.tokens)} tokens` : null, isNum(r.costUsd) ? fmtUsd(r.costUsd) : null]),
  signal: (r) => join([r.file ?? r.tool ?? r.target]),
  'session-end': (r) => join([r.reason]),
});
// The word that leads a record's line, as a chip, with its tone: the action of a decision, the result of an outcome.
const LEADS = Object.freeze({
  decision: (r) => (r.action ? { text: String(r.action), tone: ACTION_TONES[r.action] ?? 'dim' } : null),
  outcome: (r) => (r.outcome ? { text: String(r.outcome), tone: OUTCOME_TONES[r.outcome] ?? 'dim' } : null),
  signal: (r) => (r.kind ? { text: String(r.kind), tone: 'dim' } : null),
});

/** One record as a line: when (UTC), its type, its session's first eight characters, a leading chip and the detail. */
export function recordLine(r) {
  const ts = typeof r?.ts === 'string' ? r.ts : '';
  const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ts) ? `${ts.slice(5, 10)} ${ts.slice(11, 16)}` : ts.slice(0, 16) || '–';
  const type = String(r?.type ?? 'unknown');
  return {
    when, type, session: typeof r?.session === 'string' ? r.session.slice(0, 8) : '',
    lead: Object.hasOwn(LEADS, type) ? LEADS[type](r) : null,
    detail: Object.hasOwn(DETAILS, type) ? DETAILS[type](r) : '',
  };
}

function filesLine(files) {
  const log = files?.log;
  const archive = files?.archive;
  const names = (archive?.files ?? []).slice(0, ARCHIVE_SHOWN).map((f) => `${f.name} (${fmtBytes(f.bytes)})`);
  const more = (archive?.count ?? 0) - names.length;
  return {
    log: isNum(log?.bytes) ? `${log.path} · ${fmtBytes(log.bytes)}` : `${log?.path ?? 'events.jsonl'} · not written yet`,
    archive: archive?.count
      ? `Archive: ${plural(archive.count, 'file')} · ${fmtBytes(archive.bytes)} · ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
      : 'Archive: none yet (the log is rotated into it from 32 MB).',
  };
}

function typeRows(data) {
  const total = data.total ?? 0;
  const row = (type, n) => ({
    type, count: fmtNum(n), isActive: data.query.type === type,
    bar: { source: barSvg(total ? n / total : 0, { ...BAR_SIZE, color: COLORS.accent }), alt: `${fmtNum(n)} of ${fmtNum(total)} records`, ...BAR_SIZE },
  });
  return [row(ALL_TYPES, total), ...(data.byType ?? []).map((t) => row(t.type, t.n))];
}

function dayChart(data) {
  const days = data.byDay ?? [];
  if (!days.some((d) => d.n > 0)) return null;
  const what = data.query.type === ALL_TYPES ? 'record' : `${data.query.type} record`;
  return {
    title: 'By day (UTC)', first: dayLabel(days[0].day), last: dayLabel(days.at(-1).day),
    picture: {
      source: columnsSvg(days.map((d) => d.n), { ...COLUMNS_SIZE, color: COLORS.line, labels: days.map((d) => `${dayLabel(d.day)}: ${plural(d.n, what)}`) }),
      alt: `${plural(data.matched ?? 0, what)} by day, ${dayLabel(days[0].day)} to ${dayLabel(days.at(-1).day)}`, ...COLUMNS_SIZE, isInteractive: true,
    },
  };
}

/**
 * Everything the log pane draws: `data` is what scripts/log.mjs printed. `{ subtitle, files, windows, types, chart,
 * rows, paging, empty, read }`; `chart` is null with nothing to chart, `empty` says why there is no row.
 */
export function logView(data) {
  const q = data.query;
  const windowTitle = WINDOW_TITLES[q.window] ?? q.window;
  const of = q.type === ALL_TYPES ? plural(data.total, 'record') : `${plural(data.matched, `${q.type} record`)} of ${fmtNum(data.total)}`;
  const rows = (data.records ?? []).map(recordLine);
  return {
    subtitle: `${of} · ${windowTitle} · archive included`,
    files: filesLine(data.files),
    windows: Object.keys(LOG_WINDOWS).map((w) => ({ window: w, isActive: w === q.window })),
    types: typeRows(data),
    chart: dayChart(data),
    rows,
    paging: {
      label: `Page ${q.page + 1} of ${data.pages} · newest first${data.isCut ? ` · the latest ${fmtNum(MAX_KEPT)} can be paged` : ''}`,
      hasNewer: q.page > 0, hasOlder: q.page < data.pages - 1,
    },
    empty: rows.length ? null : data.total ? `No ${q.type} record (${windowTitle}).` : `No record (${windowTitle}). Records appear here as subagents start and report.`,
    read: `Log read ${String(data.generatedAt ?? '').slice(0, 16).replace('T', ' ')} UTC.`,
  };
}

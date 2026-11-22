// The quality report as a view model: what the HTML page (lib/report-html.mjs) draws. Pure: it takes the data
// scripts/report.mjs builds and returns plain values, texts already formatted.
// The headline (KPI cards, chips, sparklines, the sample-size notice) and the models are the usage view's own model
// (lib/usage-cards.mjs) for one window. See docs/design/model-router-quality-loop.md, "Report".
// Plain ES module with no Node or engine imports, so the mod, the scripts and node tests load it.
import { ACTION_TONES, cardsView } from './usage-cards.mjs';
import { BAR_SIZE, COLORS, barSvg, sparklineSvg, toneColor } from './usage-svg.mjs';
import { WEAK_N, fpyStatus } from './usage-tiles.mjs';
import { ACTION_ORDER, cellName, fmtNum, fmtPct, fmtUsd } from './usage-view.mjs';

/** The window the headline and the models are shown for: the usage view shows the same figures on it. */
export const REPORT_WINDOW = '30d';
/** The marks of a cell's row: the recommended cell, and a row with fewer than WEAK_N tasks. */
export const MARKS = Object.freeze({ recommended: '★', few: '○' });
export const TREND_SIZE = Object.freeze({ width: 320, height: 72 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMPTY = Object.freeze({
  trend: 'No task scored yet. The weekly trend appears here once subagent work closes.',
  decisions: 'Routing decisions appear here, by action, when the first subagent starts.',
  classes: 'No learned task here yet. Classes appear once a scored task carries one.',
  cells: 'No learned task yet.',
});

const two = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;

/** An ISO time as `22 Nov 2026, 15:50 UTC`; a value that is no time is returned as text. */
export function readableTime(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return String(iso ?? '');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${two(t.getUTCHours())}:${two(t.getUTCMinutes())} UTC`;
}

/** A week's Monday (`2026-11-16`) as `16 Nov`. */
const weekLabel = (week) => {
  const t = new Date(`${week}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? String(week) : `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
};

/** The whole number of tasks behind a cell: the outcomes counted, or the aged count rounded up when none is listed. */
export const taskCount = (c) => (c.tasks > 0 ? c.tasks : Math.ceil(typeof c.n === 'number' ? c.n : 0));

/** One measure of the weekly trend as a chart: a line, or one bar per week up to three weeks, its ends named. */
function trendChart(trend, title, field, fmt, domain) {
  const labels = trend.map((t) => `Week of ${weekLabel(t.week)}: ${fmt(t[field])} · ${plural(t.n, 'task')}`);
  const latest = fmt(trend.at(-1)[field]);
  return {
    title, latest,
    picture: {
      source: sparklineSvg(trend.map((t) => t[field]), { ...TREND_SIZE, color: COLORS.line, domain, labels }),
      alt: `${title}, ${trend.length} week${trend.length === 1 ? '' : 's'}, latest ${latest}`, ...TREND_SIZE, isInteractive: true,
    },
    first: trend.length > 1 ? weekLabel(trend[0].week) : '', last: weekLabel(trend.at(-1).week),
  };
}

function trendSection(trend) {
  const list = Array.isArray(trend) ? trend : [];
  if (!list.length) return { title: 'Trend by week', empty: EMPTY.trend, charts: [], rows: [] };
  return {
    title: 'Trend by week', empty: null,
    charts: [trendChart(list, 'FPY by week', 'fpy', fmtPct, [0, 1]), trendChart(list, '$/success by week', 'costPerSuccess', fmtUsd, undefined)],
    rows: list.map((t) => ({ week: weekLabel(t.week), tasks: fmtNum(t.n), fpy: fmtPct(t.fpy), costPerSuccess: fmtUsd(t.costPerSuccess) })),
  };
}

function decisionsSection(decisions) {
  const byAction = decisions?.byAction ?? {};
  const actions = [...ACTION_ORDER, ...Object.keys(byAction).filter((a) => !ACTION_ORDER.includes(a))].filter((a) => byAction[a]);
  const total = decisions?.total ?? 0;
  return {
    title: 'Routing decisions', summary: `${plural(total, 'decision')} logged, all time.`, empty: total ? null : EMPTY.decisions,
    chips: actions.map((a) => ({ text: `${a} ${fmtNum(byAction[a])}`, tone: ACTION_TONES[a] ?? 'dim' })),
    note: 'Up to release 0.3 the router only measures: no correction from the quality data is applied before 0.4.',
  };
}

function cellRow(c) {
  const count = taskCount(c);
  const isFew = count < WEAK_N;
  return {
    mark: c.recommended ? 'recommended' : isFew ? 'few' : null, isFew, name: cellName(c.tier, c.effort),
    tasks: String(count), weighted: fmtNum(c.n),
    bar: { source: barSvg(c.fpy, { ...BAR_SIZE, color: toneColor(fpyStatus(c.fpy, count).tone) }), alt: `FPY ${fmtPct(c.fpy)}`, ...BAR_SIZE },
    fpy: fmtPct(c.fpy), rework: fmtPct(c.reworkRate), costPerTask: fmtUsd(c.costPerTask), costPerSuccess: fmtUsd(c.costPerSuccess),
    explored: fmtPct(c.exploreShare),
  };
}

function classCard(cls) {
  const rec = cls.recommendation;
  const recommended = rec ? `recommended ${cellName(rec.tier, rec.effort)} (${rec.source === 'data' ? 'measured' : 'from the grid'})` : 'no recommendation';
  const cells = Array.isArray(cls.cells) ? cls.cells : [];
  return {
    name: String(cls.cls), covers: String(cls.covers ?? ''),
    caption: `grid ${cellName(cls.default?.tier, cls.default?.effort)} · ${recommended}`,
    differs: Boolean(cls.differs), notes: (cls.summary?.flags ?? []).filter((f) => !f.startsWith('n <')),
    empty: cells.length ? null : EMPTY.cells, rows: cells.map(cellRow),
  };
}

const classCards = (level) => (level?.classes ?? []).map(classCard);
const levelSection = (level) => {
  const cards = classCards(level);
  return { empty: cards.length ? null : EMPTY.classes, cards };
};

/** What a level shows, as text: two levels with the same signature would draw the same tables. */
const signature = (level) => JSON.stringify(classCards(level).map((c) => [c.name, c.rows.map((r) =>
  [r.name, r.tasks, r.fpy, r.rework, r.costPerTask, r.costPerSuccess])]));

/** The project levels: one section each, or one line when the only project repeats the user level. Null with none. */
function projectsSection(user, projects) {
  if (!projects.length) return null;
  if (user && projects.length === 1 && signature(projects[0]) === signature(user)) {
    return { title: 'Projects', note: `One project so far, ${projects[0].title}: its figures are the ones above.`, sections: [] };
  }
  return { title: 'Projects', note: null, sections: projects.map((p) => ({ title: String(p.title), ...levelSection(p) })) };
}

function footnotes(data) {
  const halfLife = typeof data.halfLifeDays === 'number' ? ` (half-life ${fmtNum(data.halfLifeDays)} days)` : '';
  return [
    'FPY (first-pass yield): share of tasks done right the first time. Rework: share redone inside the rework window. ' +
      '$/success: cost per task divided by FPY. Explored: share of starts that tried a cell other than the recommended one.',
    `Tasks are whole counts. In the class tables FPY, rework and cost weigh a recent task more than an old one${halfLife}. ` +
      `${MARKS.few} marks a row with fewer than ${WEAK_N} tasks, to be read as indicative; ` +
      `${MARKS.recommended} the recommended cell.`,
  ];
}

/**
 * Everything the report shows, top to bottom: `generated`, `headline` (the usage view's Overview model for
 * REPORT_WINDOW, or null without usage data), `trend`, `decisions`, `classes` (the user level), `projects` (or
 * null), `footnotes`, `source` (where the data was read) and `privacy`.
 */
export function reportView(data) {
  const levels = Array.isArray(data?.levels) ? data.levels : [];
  const user = levels.find((l) => l.kind === 'user');
  return {
    generated: `Generated ${readableTime(data.generatedAt)} · ${plural(data.outcomes, 'closed task')}, all time`,
    headline: data.usage ? cardsView(data.usage, { tab: 'overview', window: REPORT_WINDOW, level: 'user' }) : null,
    trend: trendSection(data.trend),
    decisions: decisionsSection(data.decisions),
    classes: { title: 'Classes · all projects', caption: 'All time, recent tasks weighing more.', ...levelSection(user) },
    projects: projectsSection(user, levels.filter((l) => l.kind !== 'user')),
    footnotes: footnotes(data),
    source: `Read from ${data.configDir}/model-router · ${fmtNum(data.events)} events · ${plural(data.outcomes, 'closed task')}.`,
    privacy: 'Nothing on this page left the machine.',
  };
}

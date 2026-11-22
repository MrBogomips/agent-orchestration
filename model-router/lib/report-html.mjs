// Renders the quality report as one self-contained HTML page: inline styles and SVG, no script, no external
// resource. Pure: takes the data scripts/report.mjs builds and returns the page's text.
// The headline (KPI cards, chips, sparklines, the sample-size notice) and the models are the usage view's own model
// (lib/usage-cards.mjs) for one window, and every figure is written by the usage view's formatters, so the page and
// the pane cannot disagree. See docs/design/ui-design.md, "Graphical surfaces: HTML pages".
import { STYLE } from './report-style.mjs';
import { ACTION_TONES, cardsView } from './usage-cards.mjs';
import { BAR_SIZE, COLORS, barSvg, escapeXml as esc, sparklineSvg, toneColor } from './usage-svg.mjs';
import { WEAK_N, fpyStatus } from './usage-tiles.mjs';
import { ACTION_ORDER, cellName, fmtNum, fmtPct, fmtUsd } from './usage-view.mjs';

/** The window the headline and the models are shown for: the pane shows the same figures on it. */
export const REPORT_WINDOW = '30d';
const TREND_SIZE = Object.freeze({ width: 320, height: 72 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TONE_CLASSES = Object.freeze({ good: 'success', fair: 'warning', bad: 'error', warn: 'warning', accent: 'accent' });
const MARKS = Object.freeze({ recommended: '★', few: '○' });

const toneClass = (tone) => (Object.hasOwn(TONE_CLASSES, tone ?? '') ? ` ${TONE_CLASSES[tone]}` : '');
const chip = (c) => `<span class="chip${toneClass(c.tone)}">${esc(c.text)}</span>`;
const picture = (p, extra = '') => `<span class="chart${extra}" role="img" aria-label="${esc(p.alt)}">${p.source}</span>`;
const two = (n) => String(n).padStart(2, '0');

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

function kpiCard(k) {
  const marks = [k.chip ? chip(k.chip) : '', k.delta ? `<span class="num${toneClass(k.delta.tone)}">${esc(k.delta.text)}</span>` : '',
    k.detail ? `<span class="num muted">${esc(k.detail)}</span>` : ''].join('');
  return `<div class="card"><span class="caption">${esc(k.label)}</span>
<div class="figure">${esc(k.value)}${k.unit ? ` <small>${esc(k.unit)}</small>` : ''}</div>
<div class="row">${marks}</div>${k.spark ? picture(k.spark) : ''}</div>`;
}

function modelsCard(models) {
  if (!models) return '';
  if (models.empty) return `<div class="card"><h3>Models</h3><p class="muted">${esc(models.empty)}</p></div>`;
  const rows = models.rows.map((m) => `<tr><td>${esc(m.name)}</td><td class="bar">${picture(m.bar)}</td><td>${esc(m.fpy)}</td>
<td>${esc(m.costPerSuccess)}</td><td>${esc(m.n)}</td></tr>`).join('');
  return `<div class="card"><h3>Models</h3><div class="scroll"><table>
<thead><tr><th>Tier · effort</th><th class="bar"></th><th>FPY</th><th>$/success</th><th>Tasks</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** The headline of the report's window: the pane's own subtitle, notice, KPI cards and models. */
function headline(usage) {
  if (!usage) return '';
  const view = cardsView(usage, { tab: 'overview', window: REPORT_WINDOW, level: 'user' });
  return `<section><div><h2>Headline</h2><p class="caption">${esc(view.subtitle ?? '')}</p></div>
${view.banner ? `<p class="banner">${esc(view.banner)}</p>` : ''}
<div class="grid">${view.kpis.map(kpiCard).join('\n')}</div>
${modelsCard(view.models)}</section>`;
}

/** One measure of the weekly trend as a chart: a line, or one bar per week up to three weeks, the weeks named under it. */
function trendChart(trend, title, field, fmt, domain) {
  const labels = trend.map((t) => `Week of ${weekLabel(t.week)}: ${fmt(t[field])} · ${fmtNum(t.n)} task${t.n === 1 ? '' : 's'}`);
  const source = sparklineSvg(trend.map((t) => t[field]), { ...TREND_SIZE, color: COLORS.line, domain, labels });
  const ends = trend.length > 1 ? [weekLabel(trend[0].week), weekLabel(trend.at(-1).week)] : ['', weekLabel(trend[0].week)];
  const latest = fmt(trend.at(-1)[field]);
  return `<div class="card"><div class="row between"><h3>${esc(title)}</h3><span class="num">${esc(latest)}</span></div>
${picture({ source, alt: `${title}, ${trend.length} week${trend.length === 1 ? '' : 's'}, latest ${latest}` }, ' wide')}
<div class="row between caption"><span>${esc(ends[0])}</span><span>${esc(ends[1])}</span></div></div>`;
}

function trendSection(trend) {
  if (!trend?.length) {
    return '<section><h2>Trend by week</h2><p class="card muted">No task scored yet. The weekly trend appears here once subagent work closes.</p></section>';
  }
  const rows = trend.map((t) => `<tr><td>${esc(weekLabel(t.week))}</td><td>${fmtNum(t.n)}</td><td>${fmtPct(t.fpy)}</td><td>${fmtUsd(t.costPerSuccess)}</td></tr>`).join('');
  return `<section><h2>Trend by week</h2>
<div class="two">${trendChart(trend, 'FPY by week', 'fpy', fmtPct, [0, 1])}${trendChart(trend, '$/success by week', 'costPerSuccess', fmtUsd, undefined)}</div>
<div class="card scroll"><table><thead><tr><th>Week of</th><th>Tasks</th><th>FPY</th><th>$/success</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function decisionsSection(decisions) {
  const byAction = decisions?.byAction ?? {};
  const actions = [...ACTION_ORDER, ...Object.keys(byAction).filter((a) => !ACTION_ORDER.includes(a))].filter((a) => byAction[a]);
  const chips = actions.map((a) => chip({ text: `${a} ${fmtNum(byAction[a])}`, tone: ACTION_TONES[a] ?? 'dim' })).join('');
  const total = decisions?.total ?? 0;
  const body = total ? `<div class="row">${chips}</div>` : '<p class="muted">Routing decisions appear here, by action, when the first subagent starts.</p>';
  return `<section><h2>Routing decisions</h2><div class="card"><p>${fmtNum(total)} decision${total === 1 ? '' : 's'} logged, all time.</p>${body}
<p class="caption">Up to release 0.3 the router only measures: no correction from the quality data is applied before 0.4.</p></div></section>`;
}

function cellRow(c) {
  const count = taskCount(c);
  const isFew = count < WEAK_N;
  const mark = c.recommended ? `<span class="star" title="Recommended">${MARKS.recommended}</span> ` : isFew ? `<span class="mark" title="Fewer than ${WEAK_N} tasks">${MARKS.few}</span> ` : '';
  const bar = { source: barSvg(c.fpy, { ...BAR_SIZE, color: toneColor(fpyStatus(c.fpy, count).tone) }), alt: `FPY ${fmtPct(c.fpy)}` };
  return `<tr${isFew ? ' class="few"' : ''}><td>${mark}${esc(cellName(c.tier, c.effort))}</td>
<td title="Weighted by age: ${fmtNum(c.n)}">${count}</td><td class="bar">${picture(bar)}</td><td>${fmtPct(c.fpy)}</td><td>${fmtPct(c.reworkRate)}</td>
<td class="opt">${fmtUsd(c.costPerTask)}</td><td>${fmtUsd(c.costPerSuccess)}</td><td class="opt">${fmtPct(c.exploreShare)}</td></tr>`;
}

function classCard(cls) {
  const rec = cls.recommendation;
  const recommended = rec ? `recommended ${cellName(rec.tier, rec.effort)} (${rec.source === 'data' ? 'measured' : 'from the grid'})` : 'no recommendation';
  const notes = (cls.summary?.flags ?? []).filter((f) => !f.startsWith('n <'));
  const rows = cls.cells.length ? cls.cells.map(cellRow).join('\n') : '<tr><td colspan="8" class="muted">No learned task yet.</td></tr>';
  return `<div class="card"><h3>${esc(cls.cls)} <span class="muted">· ${esc(cls.covers)}</span></h3>
<div class="row caption"><span>grid ${esc(cellName(cls.default?.tier, cls.default?.effort))} · ${esc(recommended)}</span>
${cls.differs ? chip({ text: 'differs from the grid', tone: 'fair' }) : ''}${notes.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
<div class="scroll"><table><thead><tr><th>Tier · effort</th><th>Tasks</th><th class="bar"></th><th>FPY</th><th>Rework</th>
<th class="opt">$/task</th><th>$/success</th><th class="opt">Explored</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

const classCards = (level) => (level?.classes?.length
  ? level.classes.map(classCard).join('\n')
  : '<p class="card muted">No learned task here yet. Classes appear once a scored task carries one.</p>');

/** What a level shows, as text: two levels with the same signature would draw the same tables. */
const signature = (level) => JSON.stringify((level?.classes ?? []).map((c) => [c.cls, c.cells.map((x) =>
  [x.tier, x.effort, taskCount(x), fmtPct(x.fpy), fmtPct(x.reworkRate), fmtUsd(x.costPerTask), fmtUsd(x.costPerSuccess)])]));

/** The project levels: each folded under its path, or one line when the only project repeats the user level. */
function projectsSection(user, projects) {
  if (!projects.length) return '';
  if (user && projects.length === 1 && signature(projects[0]) === signature(user)) {
    return `<section><h2>Projects</h2><p class="caption">One project so far, ${esc(projects[0].title)}: its figures are the ones above.</p></section>`;
  }
  const blocks = projects.map((p) => `<details${projects.length === 1 ? ' open' : ''}><summary>${esc(p.title)}</summary><div>${classCards(p)}</div></details>`);
  return `<section><h2>Projects</h2>${blocks.join('\n')}</section>`;
}

function footer(data) {
  const halfLife = typeof data.halfLifeDays === 'number' ? ` (half-life ${fmtNum(data.halfLifeDays)} days)` : '';
  return `<footer><p>FPY (first-pass yield): share of tasks done right the first time. Rework: share redone inside the rework window.
$/success: cost per task divided by FPY. Explored: share of starts that tried a cell other than the recommended one.</p>
<p>Tasks are whole counts. In the class tables FPY, rework and cost weigh a recent task more than an old one${halfLife}; the weighted count is in each count's tooltip.
${MARKS.few} marks a row with fewer than ${WEAK_N} tasks, to be read as indicative; ${MARKS.recommended} the recommended cell.</p>
<p>Read from ${esc(data.configDir)}/model-router · ${fmtNum(data.events)} events · ${fmtNum(data.outcomes)} closed tasks. Nothing on this page left the machine.</p></footer>`;
}

/** The whole page for the report data. */
export function renderReport(data) {
  const user = data.levels.find((l) => l.kind === 'user');
  const projects = data.levels.filter((l) => l.kind !== 'user');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>model-router quality report</title><style>${STYLE}</style></head>
<body><main>
<header><h1><span class="id">🔀 model-router</span> quality report</h1>
<p class="caption">Generated ${esc(readableTime(data.generatedAt))} · ${fmtNum(data.outcomes)} closed task${data.outcomes === 1 ? '' : 's'}, all time</p></header>
${headline(data.usage)}
${trendSection(data.trend)}
${decisionsSection(data.decisions)}
<section><div><h2>Classes · all projects</h2><p class="caption">All time, recent tasks weighing more.</p></div>${classCards(user)}</section>
${projectsSection(user, projects)}
${footer(data)}
</main></body></html>
`;
}

// Renders the quality report as one self-contained HTML page: inline styles and SVG, no script, no external
// resource. Pure: takes the data scripts/report.mjs builds and returns the page's text.
// What the page shows is the report's view model (lib/report-cards.mjs), which the native pane of a graphical
// surface draws too: this file only writes its markup, escaping every text.
// See docs/design/ui-design.md, "Graphical surfaces: HTML pages".
import { MARKS, reportView } from './report-cards.mjs';
import { STYLE } from './report-style.mjs';
import { escapeXml as esc } from './usage-svg.mjs';
import { WEAK_N } from './usage-tiles.mjs';

export { REPORT_WINDOW, readableTime, taskCount } from './report-cards.mjs';

const TONE_CLASSES = Object.freeze({ good: 'success', fair: 'warning', bad: 'error', warn: 'warning', accent: 'accent' });

const toneClass = (tone) => (Object.hasOwn(TONE_CLASSES, tone ?? '') ? ` ${TONE_CLASSES[tone]}` : '');
const chip = (c) => `<span class="chip${toneClass(c.tone)}">${esc(c.text)}</span>`;
const picture = (p, extra = '') => `<span class="chart${extra}" role="img" aria-label="${esc(p.alt)}">${p.source}</span>`;

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

/** The headline of the report's window: the usage view's own subtitle, notice, KPI cards and models. */
function headline(view) {
  if (!view) return '';
  return `<section><div><h2>Headline</h2><p class="caption">${esc(view.subtitle ?? '')}</p></div>
${view.banner ? `<p class="banner">${esc(view.banner)}</p>` : ''}
<div class="grid">${view.kpis.map(kpiCard).join('\n')}</div>
${modelsCard(view.models)}</section>`;
}

const trendChart = (c) => `<div class="card"><div class="row between"><h3>${esc(c.title)}</h3><span class="num">${esc(c.latest)}</span></div>
${picture(c.picture, ' wide')}
<div class="row between caption"><span>${esc(c.first)}</span><span>${esc(c.last)}</span></div></div>`;

function trendSection(trend) {
  if (trend.empty) return `<section><h2>${esc(trend.title)}</h2><p class="card muted">${esc(trend.empty)}</p></section>`;
  const rows = trend.rows.map((r) => `<tr><td>${esc(r.week)}</td><td>${esc(r.tasks)}</td><td>${esc(r.fpy)}</td><td>${esc(r.costPerSuccess)}</td></tr>`).join('');
  return `<section><h2>${esc(trend.title)}</h2>
<div class="two">${trend.charts.map(trendChart).join('')}</div>
<div class="card scroll"><table><thead><tr><th>Week of</th><th>Tasks</th><th>FPY</th><th>$/success</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function decisionsSection(d) {
  const body = d.empty ? `<p class="muted">${esc(d.empty)}</p>` : `<div class="row">${d.chips.map(chip).join('')}</div>`;
  return `<section><h2>${esc(d.title)}</h2><div class="card"><p>${esc(d.summary)}</p>${body}
<p class="caption">${esc(d.note)}</p></div></section>`;
}

function cellRow(r) {
  const mark = r.mark === 'recommended'
    ? `<span class="star" title="Recommended">${MARKS.recommended}</span> `
    : r.mark === 'few' ? `<span class="mark" title="Fewer than ${WEAK_N} tasks">${MARKS.few}</span> ` : '';
  return `<tr${r.isFew ? ' class="few"' : ''}><td>${mark}${esc(r.name)}</td>
<td title="Weighted by age: ${esc(r.weighted)}">${esc(r.tasks)}</td><td class="bar">${picture(r.bar)}</td><td>${esc(r.fpy)}</td><td>${esc(r.rework)}</td>
<td class="opt">${esc(r.costPerTask)}</td><td>${esc(r.costPerSuccess)}</td><td class="opt">${esc(r.explored)}</td></tr>`;
}

function classCard(c) {
  const rows = c.empty ? `<tr><td colspan="8" class="muted">${esc(c.empty)}</td></tr>` : c.rows.map(cellRow).join('\n');
  return `<div class="card"><h3>${esc(c.name)} <span class="muted">· ${esc(c.covers)}</span></h3>
<div class="row caption"><span>${esc(c.caption)}</span>
${c.differs ? chip({ text: 'differs from the grid', tone: 'fair' }) : ''}${c.notes.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
<div class="scroll"><table><thead><tr><th>Tier · effort</th><th>Tasks</th><th class="bar"></th><th>FPY</th><th>Rework</th>
<th class="opt">$/task</th><th>$/success</th><th class="opt">Explored</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

const classCards = (level) => (level.empty ? `<p class="card muted">${esc(level.empty)}</p>` : level.cards.map(classCard).join('\n'));

/** The project levels: each folded under its path, or one line when the only project repeats the user level. */
function projectsSection(projects) {
  if (!projects) return '';
  if (projects.note) return `<section><h2>${esc(projects.title)}</h2><p class="caption">${esc(projects.note)}</p></section>`;
  const isOnly = projects.sections.length === 1;
  const blocks = projects.sections.map((p) => `<details${isOnly ? ' open' : ''}><summary>${esc(p.title)}</summary><div>${classCards(p)}</div></details>`);
  return `<section><h2>${esc(projects.title)}</h2>${blocks.join('\n')}</section>`;
}

/** The whole page for the report data. */
export function renderReport(data) {
  const view = reportView(data);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>model-router quality report</title><style>${STYLE}</style></head>
<body><main>
<header><h1><span class="id">🔀 model-router</span> quality report</h1>
<p class="caption">${esc(view.generated)}</p></header>
${headline(view.headline)}
${trendSection(view.trend)}
${decisionsSection(view.decisions)}
<section><div><h2>${esc(view.classes.title)}</h2><p class="caption">${esc(view.classes.caption)}</p></div>${classCards(view.classes)}</section>
${projectsSection(view.projects)}
<footer>${view.footnotes.map((n) => `<p>${esc(n)}</p>`).join('\n')}
<p>Hover a task count to see the weighted count behind it.</p>
<p>${esc(view.source)} ${esc(view.privacy)}</p></footer>
</main></body></html>
`;
}

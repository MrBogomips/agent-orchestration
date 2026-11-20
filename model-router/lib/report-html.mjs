// Renders the quality report as one self-contained HTML page: inline styles and SVG, no script, no external
// resource. Pure: takes the data scripts/report.mjs builds and returns the page's text.

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '–');
const usd = (v) => (typeof v === 'number' ? `$${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}` : '–');
const num = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '–');

const STYLE = `
:root { --bg: #fbfbfa; --fg: #1d1d1b; --muted: #6b6b66; --line: #e2e1dc; --card: #ffffff; --accent: #2f6db5; --warn: #9a5b00; --good: #2e7d4f; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --fg: #ececea; --muted: #a3a29c; --line: #34332f; --card: #1f1f1d; --accent: #7fb0ea; --warn: #e2a64a; --good: #6cc58f; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 32px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
h3 { font-size: 15px; margin: 18px 0 6px; }
p.meta, .muted { color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 10px 0; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
th { color: var(--muted); font-weight: 600; }
.flag { color: var(--warn); font-size: 12px; text-align: left; white-space: normal; }
.rec { color: var(--good); }
.pill { display: inline-block; border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; margin: 0 6px 6px 0; }
svg text { fill: var(--muted); font-size: 11px; }
`;

function cellRows(cells) {
  if (cells.length === 0) return '<tr><td colspan="10" class="muted">No learned task yet.</td></tr>';
  return cells.map((c) => `<tr>
<td>${esc(c.tier)}</td><td>${esc(c.effort)}</td><td>${num(c.n)}</td><td>${pct(c.fpy)}</td><td>${pct(c.reworkRate)}</td>
<td>${usd(c.costPerTask)}</td><td>${usd(c.costPerSuccess)}</td><td>${pct(c.exploreShare)}</td>
<td>${c.recommended ? '<span class="rec">recommended</span>' : ''}</td><td class="flag">${esc(c.flags.join(', '))}</td></tr>`).join('\n');
}

function classBlock(cls) {
  const rec = cls.recommendation;
  const recText = rec ? `${esc(rec.tier)} · ${esc(rec.effort)} <span class="muted">(${rec.source === 'data' ? 'measured' : 'grid'})</span>` : '–';
  return `<div class="card"><h3>${esc(cls.cls)} <span class="muted">— ${esc(cls.covers)}</span></h3>
<p>Recommendation: ${recText}${cls.differs ? ' <span class="flag">differs from the grid</span>' : ''}</p>
<table><thead><tr><th>Tier</th><th>Effort</th><th>n</th><th>FPY</th><th>Rework</th><th>Cost / task</th><th>Cost / success</th><th>Explored</th><th></th><th>Flags</th></tr></thead>
<tbody>${cellRows(cls.cells)}</tbody></table></div>`;
}

function levelBlock(level) {
  const heading = level.kind === 'user' ? 'All projects (user level)' : `Project ${esc(level.title)}`;
  const body = level.classes.length ? level.classes.map(classBlock).join('\n') : '<p class="muted">No data yet.</p>';
  return `<section><h2>${heading}</h2>${body}</section>`;
}

function trendChart(trend) {
  if (trend.length === 0) return '<p class="muted">No closed task yet.</p>';
  const w = 640;
  const h = 140;
  const pad = 28;
  const step = trend.length > 1 ? (w - 2 * pad) / (trend.length - 1) : 0;
  const x = (i) => pad + i * step;
  const y = (v) => h - pad - (v ?? 0) * (h - 2 * pad);
  const points = trend.map((t, i) => `${x(i).toFixed(1)},${y(t.fpy).toFixed(1)}`).join(' ');
  const labels = trend.map((t, i) => `<text x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(t.week)}</text>`).join('');
  const dots = trend.map((t, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(t.fpy).toFixed(1)}" r="3" fill="var(--accent)"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="First-pass yield per week">
<line x1="${pad}" y1="${y(1)}" x2="${w - pad}" y2="${y(1)}" stroke="var(--line)"/><line x1="${pad}" y1="${y(0)}" x2="${w - pad}" y2="${y(0)}" stroke="var(--line)"/>
<text x="2" y="${y(1) + 4}">100%</text><text x="2" y="${y(0) + 4}">0%</text>
<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}${labels}</svg>`;
}

function trendTable(trend) {
  const rows = trend.map((t) => `<tr><td>${esc(t.week)}</td><td></td><td>${num(t.n)}</td><td>${pct(t.fpy)}</td><td>${usd(t.costPerSuccess)}</td></tr>`).join('');
  return `<table><thead><tr><th>Week of</th><th></th><th>Tasks</th><th>FPY</th><th>Cost / success</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function decisionsBlock(decisions) {
  const pills = Object.entries(decisions.byAction).map(([k, v]) => `<span class="pill">${esc(k)}: ${num(v)}</span>`).join('');
  return `<div class="card"><p>${num(decisions.total)} routing decisions logged.</p>${pills}
<p class="muted">Release 0.2 measures only: no correction from the quality data is applied yet.</p></div>`;
}

/** The whole page for the report data. */
export function renderReport(data) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>model-router quality report</title><style>${STYLE}</style></head>
<body><main>
<h1>model-router quality report</h1>
<p class="meta">Generated ${esc(data.generatedAt)} from ${esc(data.configDir)} · ${num(data.events)} events · ${num(data.outcomes)} closed tasks. Nothing on this page left the machine.</p>
<h2>Trend</h2><div class="card">${trendChart(data.trend)}${trendTable(data.trend)}</div>
<h2>Router decisions</h2>${decisionsBlock(data.decisions)}
${data.levels.map(levelBlock).join('\n')}
<p class="muted">FPY: share of tasks done right first time. Rework: share redone inside the rework window. Cost per success: cost per task divided by FPY.
Weak-signal cells (read-only classes, or fewer than 5 tasks) are flagged.</p>
</main></body></html>
`;
}

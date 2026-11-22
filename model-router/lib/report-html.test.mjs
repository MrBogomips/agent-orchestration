import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_WINDOW, readableTime, renderReport, taskCount } from './report-html.mjs';
import { TOKENS } from './report-style.mjs';
import { cardsView } from './usage-cards.mjs';
import { reportData as fixtureData } from './usage-fixture.mjs';

const cell = (over = {}) => ({
  tier: 'opus', effort: 'medium', n: 2.9, tasks: 3, fpy: 1, reworkRate: 0, costPerTask: 1.798, costPerSuccess: 1.798, exploreShare: 0,
  flags: ['n < 5'], recommended: false, ...over,
});
const cls = (cells) => ({
  cls: 'review-debug', covers: 'review', default: { tier: 'opus', effort: 'medium' }, recommendation: { tier: 'opus', effort: 'medium', source: 'grid' },
  differs: false, cells, summary: { n: 3.9, tasks: 4, flags: ['n < 5'] },
});
const bare = (over = {}) => ({
  generatedAt: '2026-11-22T15:50:54.989Z', configDir: '/home/u/.claude', events: 431, outcomes: 15, trend: [], decisions: { total: 0, byAction: {} },
  levels: [{ kind: 'user', title: 'user', classes: [] }], ...over,
});

test('the page carries the tokens of both schemes and switches on the system setting', () => {
  const html = renderReport(fixtureData());
  assert.match(html, /color-scheme: light dark/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  for (const scheme of ['light', 'dark']) {
    for (const [name, value] of Object.entries(TOKENS[scheme])) assert.ok(html.includes(`--${name}: ${value};`), `${scheme} ${name}`);
  }
  assert.deepEqual(Object.keys(TOKENS.light), Object.keys(TOKENS.dark));
  for (const name of ['success', 'warning', 'error', 'accent']) assert.ok(name in TOKENS.light);
});

test('the headline shows the usage view\'s own cards for the same window', () => {
  const data = fixtureData();
  const html = renderReport(data);
  const view = cardsView(data.usage, { tab: 'overview', window: REPORT_WINDOW, level: 'user' });
  assert.equal(view.kpis.length, 4);
  for (const k of view.kpis) {
    const card = html.slice(html.indexOf(`<span class="caption">${k.label}</span>`)).split('</div></div>')[0];
    assert.ok(card.includes(`<div class="figure">${k.value}`), `${k.label} ${k.value}`);
    if (k.chip) assert.ok(card.includes(`>${k.chip.text}</span>`), `${k.label} chip`);
    if (k.delta) assert.ok(card.includes(`>${k.delta.text}</span>`), `${k.label} delta`);
    if (k.spark) assert.ok(html.includes(k.spark.source), `${k.label} sparkline`);
  }
  assert.ok(html.includes(view.subtitle));
  for (const m of view.models.rows) assert.ok(html.includes(`<td>${m.name}</td>`) && html.includes(m.bar.source));
});

test('under five scored tasks one notice says so, and no row carries an n flag', () => {
  const data = fixtureData();
  const few = { ...data, usage: { ...data.usage, windows: { ...data.usage.windows, [REPORT_WINDOW]: data.usage.windows['24h'] } } };
  const view = cardsView(few.usage, { tab: 'overview', window: REPORT_WINDOW, level: 'user' });
  assert.match(view.banner, /figures are indicative under 5/);
  const html = renderReport(few);
  assert.equal(html.split(`<p class="banner">${view.banner}</p>`).length, 2);
  assert.ok(!/n (&lt;|<) 5/.test(html));
});

test('a single week is drawn as a bar, and no label is SVG text that could be clipped', () => {
  const html = renderReport(bare({ trend: [{ week: '2026-11-16', n: 14, fpy: 0.93, costPerSuccess: 2.058 }] }));
  const chart = html.slice(html.indexOf('FPY by week'), html.indexOf('$/success by week'));
  assert.match(chart, /<rect class="bar"/);
  assert.ok(!chart.includes('<polyline') && !chart.includes('<circle'));
  assert.ok(!html.includes('<text'));
  assert.match(chart, /<span><\/span><span>16 Nov<\/span>/);
  assert.match(html, /<td>16 Nov<\/td><td>14<\/td><td>93%<\/td><td>\$2\.058<\/td>/);
});

test('four weeks and more are a line, named by the first and the last week', () => {
  const trend = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].map((week, i) => ({ week, n: 3, fpy: 0.5 + i / 10, costPerSuccess: 0.1 }));
  const html = renderReport(bare({ trend }));
  const chart = html.slice(html.indexOf('FPY by week'), html.indexOf('$/success by week'));
  assert.match(chart, /<polyline/);
  assert.match(chart, /<span>26 Oct<\/span><span>16 Nov<\/span>/);
});

test('counts are whole tasks, the weighted count in a tooltip; a small row gets a quiet mark', () => {
  const html = renderReport(bare({ levels: [{ kind: 'user', title: 'user', classes: [cls([cell(), cell({ effort: 'high', n: 6.4, tasks: 7, recommended: true })])] }] }));
  assert.match(html, /<tr class="few"><td><span class="mark" title="Fewer than 5 tasks">○<\/span> opus·medium<\/td>\s*<td title="Weighted by age: 2\.9">3<\/td>/);
  assert.match(html, /<tr><td><span class="star" title="Recommended">★<\/span> opus·high<\/td>\s*<td title="Weighted by age: 6\.4">7<\/td>/);
  assert.ok(!html.includes('>2.9<'));
  assert.equal(taskCount({ n: 2.2, tasks: 0 }), 3);
  assert.equal(taskCount({ n: 2.2, tasks: 2 }), 2);
});

test('a single project that repeats the user level is one line; one that differs is folded under its path', () => {
  const classes = [cls([cell()])];
  const same = renderReport(bare({ levels: [{ kind: 'user', title: 'user', classes }, { kind: 'project', title: '/work/shop', classes }] }));
  assert.match(same, /One project so far, \/work\/shop: its figures are the ones above\./);
  assert.ok(!same.includes('<details'));
  assert.equal(same.split('<h3>review-debug').length, 2);
  const other = [cls([cell({ tasks: 1, n: 1 })])];
  const differs = renderReport(bare({ levels: [{ kind: 'user', title: 'user', classes }, { kind: 'project', title: '/work/shop', classes: other }] }));
  assert.match(differs, /<details open><summary>\/work\/shop<\/summary>/);
  const twoProjects = renderReport(bare({ levels: [{ kind: 'user', title: 'user', classes }, { kind: 'project', title: '/a', classes }, { kind: 'project', title: '/b', classes: other }] }));
  assert.equal(twoProjects.split('<details>').length, 3);
});

test('the time is readable and the path is only in the footnote', () => {
  const html = renderReport(bare());
  assert.match(html, /Generated 22 Nov 2026, 15:50 UTC · 15 closed tasks, all time/);
  assert.ok(!html.includes('2026-11-22T15:50'));
  assert.equal(html.split('/home/u/.claude').length, 2);
  assert.ok(html.indexOf('/home/u/.claude') > html.indexOf('<footer>'));
  assert.match(html, /Nothing on this page left the machine\./);
  assert.equal(readableTime('2026-01-05T03:04:00Z'), '5 Jan 2026, 03:04 UTC');
  assert.equal(readableTime('not a time'), 'not a time');
});

test('the page is self-contained: no script, no external resource', () => {
  const html = renderReport(fixtureData());
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/(src|href)\s*=/i.test(html));
  assert.ok(!/url\(|@import/i.test(html));
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /@media \(max-width: 560px\)/);
});

test('every text from the data is escaped', () => {
  const evil = '<script>alert(1)</script>';
  const classes = [{ ...cls([cell({ tier: evil, effort: evil })]), cls: evil, covers: evil }];
  const html = renderReport(bare({
    configDir: evil, generatedAt: evil, trend: [{ week: evil, n: 1, fpy: 1, costPerSuccess: 1 }], decisions: { total: 1, byAction: { [evil]: 1 } },
    levels: [{ kind: 'user', title: 'user', classes }, { kind: 'project', title: evil, classes: [] }],
  }));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a page with no data says what will appear', () => {
  const html = renderReport(bare());
  assert.match(html, /No task scored yet\. The weekly trend appears here/);
  assert.match(html, /Routing decisions appear here/);
  assert.match(html, /No learned task here yet/);
});

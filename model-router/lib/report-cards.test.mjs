import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETAILS, MARKS, MAX_ROWS, REPORT_WINDOW, readableTime, reportView, rowsAt, taskCount } from './report-cards.mjs';
import { renderReport } from './report-html.mjs';
import { cardsView } from './usage-cards.mjs';
import { bigReportData, reportData } from './usage-fixture.mjs';

const cell = (over = {}) => ({
  tier: 'opus', effort: 'medium', n: 2.9, tasks: 3, fpy: 1, reworkRate: 0, costPerTask: 1.798, costPerSuccess: 1.798, exploreShare: 0,
  flags: ['n < 5'], recommended: false, ...over,
});
const cls = (cells) => ({
  cls: 'review-debug', covers: 'review', default: { tier: 'opus', effort: 'medium' }, recommendation: { tier: 'opus', effort: 'medium', source: 'grid' },
  differs: false, cells, summary: { n: 3.9, tasks: 4, flags: ['n < 5', 'read-only: weak signal'] },
});
const bare = (over = {}) => ({
  generatedAt: '2026-11-22T15:50:54.989Z', configDir: '/home/u/.claude', events: 431, outcomes: 15, trend: [], decisions: { total: 0, byAction: {} },
  levels: [{ kind: 'user', title: 'user', classes: [] }], ...over,
});

test('the headline is the usage view\'s Overview model for the report\'s window', () => {
  const data = reportData();
  const view = reportView(data);
  assert.deepEqual(view.headline, cardsView(data.usage, { tab: 'overview', window: REPORT_WINDOW, level: 'user' }));
  assert.equal(view.headline.kpis.length, 4);
  assert.equal(reportView(bare()).headline, null);
});

test('the view names when it was generated and where the data was read', () => {
  const view = reportView(bare());
  assert.equal(view.generated, 'Generated 22 Nov 2026, 15:50 UTC · 15 closed tasks, all time');
  assert.equal(view.source, 'Read from /home/u/.claude/model-router · 431 events · 15 closed tasks.');
  assert.equal(reportView(bare({ outcomes: 1 })).generated, 'Generated 22 Nov 2026, 15:50 UTC · 1 closed task, all time');
  assert.equal(readableTime('not a time'), 'not a time');
});

test('the trend is two charts with their ends named and one row per week; up to three weeks are bars', () => {
  const one = reportView(bare({ trend: [{ week: '2026-11-16', n: 14, fpy: 0.93, costPerSuccess: 2.058 }] })).trend;
  assert.deepEqual(one.charts.map((c) => [c.title, c.latest, c.first, c.last]), [['FPY by week', '93%', '', '16 Nov'], ['$/success by week', '$2.058', '', '16 Nov']]);
  assert.match(one.charts[0].picture.source, /<rect class="bar"/);
  assert.equal(one.charts[0].picture.alt, 'FPY by week, 1 week, latest 93%');
  assert.deepEqual(one.rows, [{ week: '16 Nov', tasks: '14', fpy: '93%', costPerSuccess: '$2.058' }]);
  const four = reportView(bare({ trend: ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].map((week) => ({ week, n: 3, fpy: 0.5, costPerSuccess: 0.1 })) })).trend;
  assert.match(four.charts[0].picture.source, /<polyline/);
  assert.deepEqual([four.charts[0].first, four.charts[0].last], ['26 Oct', '16 Nov']);
  assert.match(reportView(bare()).trend.empty, /^No task scored yet/);
});

test('the decisions are one chip per action, in the usage view\'s order and tones', () => {
  const d = reportView(bare({ decisions: { total: 9, byAction: { keep: 5, downgrade: 3, odd: 1 } } })).decisions;
  assert.equal(d.summary, '9 decisions logged, all time.');
  assert.deepEqual(d.chips, [{ text: 'downgrade 3', tone: 'good' }, { text: 'keep 5', tone: 'dim' }, { text: 'odd 1', tone: 'dim' }]);
  assert.equal(d.empty, null);
  assert.match(reportView(bare()).decisions.empty, /^Routing decisions appear here/);
  assert.equal(reportView(bare({ decisions: { total: 1, byAction: { keep: 1 } } })).decisions.summary, '1 decision logged, all time.');
});

test('a cell row carries the whole count, the weighted one, its mark and its formatted figures', () => {
  const classes = [cls([cell(), cell({ effort: 'high', n: 6.4, tasks: 7, recommended: true, fpy: 0.5, exploreShare: 0.25 })])];
  const [card] = reportView(bare({ levels: [{ kind: 'user', title: 'user', classes }] })).classes.cards;
  assert.equal(card.caption, 'grid opus·medium · recommended opus·medium (from the grid)');
  assert.deepEqual(card.notes, ['read-only: weak signal']);
  const [few, rec] = card.rows;
  assert.deepEqual({ ...few, bar: null }, {
    mark: 'few', isFew: true, name: 'opus·medium', tasks: '3', weighted: '2.9', bar: null, fpy: '100%', rework: '0%',
    costPerTask: '$1.798', costPerSuccess: '$1.798', explored: '0%',
  });
  assert.deepEqual([rec.mark, rec.isFew, rec.tasks, rec.weighted, rec.fpy, rec.explored], ['recommended', false, '7', '6.4', '50%', '25%']);
  assert.match(few.bar.source, /^<svg /);
  assert.equal(taskCount({ n: 2.2, tasks: 0 }), 3);
  assert.deepEqual(MARKS, { recommended: '★', few: '○' });
});

test('a single project that repeats the user level is one line; projects that differ are a section each', () => {
  const classes = [cls([cell()])];
  const other = [cls([cell({ tasks: 1, n: 1 })])];
  const user = { kind: 'user', title: 'user', classes };
  assert.equal(reportView(bare({ levels: [user] })).projects, null);
  const same = reportView(bare({ levels: [user, { kind: 'project', title: '/work/shop', classes }] })).projects;
  assert.deepEqual(same, { title: 'Projects', note: 'One project so far, /work/shop: its figures are the ones above.', sections: [] });
  const two = reportView(bare({ levels: [user, { kind: 'project', title: '/a', classes }, { kind: 'project', title: '/b', classes: other }] })).projects;
  assert.equal(two.note, null);
  assert.deepEqual(two.sections.map((s) => [s.title, s.cards.length, s.empty]), [['/a', 1, null], ['/b', 1, null]]);
  const empty = reportView(bare({ levels: [user, { kind: 'project', title: '/c', classes: [] }] })).projects.sections[0];
  assert.match(empty.empty, /^No learned task here yet/);
});

test('each level of detail holds fewer rows: every cell, then a line per project, then a line per class', () => {
  const view = reportView(bigReportData({ classes: 6, cells: 3, projects: 2 }));
  assert.deepEqual(DETAILS, ['full', 'projects', 'classes']);
  assert.deepEqual(DETAILS.map((d) => rowsAt(view, d)), [54, 20, 8]);
  const none = reportView({ ...reportData(), levels: [{ kind: 'user', title: 'user', classes: [] }] });
  assert.deepEqual(DETAILS.map((d) => rowsAt(none, d)), [0, 0, 0]);
  const same = reportView(reportData());
  assert.equal(rowsAt(same, 'projects') - rowsAt(same, 'full') < 0, true);
  assert.ok(rowsAt(reportView(bigReportData({ classes: 400, cells: 2, projects: 40 })), 'classes') > MAX_ROWS);
});

test('the footnotes explain the measures, the weighting and the marks once', () => {
  const notes = reportView(bare({ halfLifeDays: 30 })).footnotes;
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^FPY \(first-pass yield\)/);
  assert.match(notes[1], /half-life 30 days\)\. ○ marks a row with fewer than 5 tasks, to be read as indicative; ★ the recommended cell\.$/);
});

test('the page writes what the view holds: every figure of the fixture\'s view is on it', () => {
  const data = reportData();
  const view = reportView(data);
  const html = renderReport(data);
  for (const card of [...view.classes.cards, ...(view.projects?.sections ?? []).flatMap((s) => s.cards)]) {
    for (const row of card.rows) for (const text of [row.name, row.fpy, row.costPerSuccess]) assert.ok(html.includes(`${text}</td>`), text);
  }
  for (const chart of view.trend.charts) assert.ok(html.includes(chart.picture.source));
  for (const c of view.decisions.chips) assert.ok(html.includes(`${c.text}</span>`));
});

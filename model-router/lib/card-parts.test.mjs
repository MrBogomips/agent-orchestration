import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_WIDTH, SHADES, SHADE_ORDER, barSvg, cardIdOf, chartSvg, chevronSvg, dotSvg, escapeXml, heatmapSvg, iconSvg, ruleSvg, scaleOf,
  segmentsSvg, squareSvg, stampOf, textOf,
} from './card-parts.mjs';

const T = Date.parse('2026-11-20T12:00:05Z');
const hexOf = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const lightness = (c) => hexOf(c).reduce((n, v) => n + v, 0);

test('a drawing that fills the card states a viewBox and no width; a small mark states both', () => {
  assert.match(barSvg(0.5), new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} 8" color="#808080">`));
  assert.equal(/ width="\d+" height="\d+" color/.test(barSvg(0.5)), false);
  for (const mark of [squareSvg(SHADES.opus), dotSvg('good'), chevronSvg(true), iconSvg('route')]) assert.match(mark, /^<svg [^>]* width="\d+" height="\d+"/);
});

test('tracks, hairlines, labels and marks are the drawing\'s own colour at part strength, never a fixed grey', () => {
  for (const svg of [barSvg(0.3), segmentsSvg([{ share: 0.5, color: '#5586e3' }]), ruleSvg(), chevronSvg(false), iconSvg('hub')]) {
    assert.match(svg, /currentColor/);
  }
  const chart = chartSvg({ bars: [{ label: 'Nov 20', parts: [{ value: 2 }] }], ticks: [{ value: 0, label: '0' }], max: 2 });
  assert.match(chart, /<text [^>]*fill="currentColor"[^>]*>Nov 20<\/text>/);
  assert.equal(/#3a4257|#8f8d88/.test(chart + barSvg(0.3)), false);
});

test('the four model blues go from Opus darkest to Haiku lightest, each clearly apart', () => {
  const values = SHADE_ORDER.map((tier) => lightness(SHADES[tier]));
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] - values[i - 1] > 60, `${SHADE_ORDER[i]} is too close to ${SHADE_ORDER[i - 1]}`);
});

test('a bar is filled to its share, a share too small still shows, an unknown one is the track alone', () => {
  assert.match(barSvg(0.5), /<rect width="420" height="8" rx="4" fill="#5586e3"\/>/);
  assert.match(barSvg(0.001), /<rect width="8" height="8"/);
  assert.equal((barSvg(Number.NaN).match(/<rect/g) ?? []).length, 1);
  assert.equal((barSvg(2).match(/width="840"/g) ?? []).length, 2);
});

test('a segmented bar draws its parts in order and drops the empty ones', () => {
  const svg = segmentsSvg([{ share: 0.5, color: '#111111' }, { share: 0 }, { share: 0.25, color: '#222222' }]);
  assert.deepEqual([...svg.matchAll(/fill="(#\w+)"\/>/g)].map((m) => m[1]), ['#111111', '#222222']);
  assert.match(segmentsSvg([]), /clip-path/);
});

test('the text a drawing carries is escaped', () => {
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.match(chartSvg({ bars: [{ label: '<x>', parts: [] }], max: 1 }), /&lt;x&gt;/);
  assert.match(squareSvg('"/><script>'), /&quot;\/&gt;&lt;script&gt;/);
});

test('a heatmap draws one square per day in range and a legend from fewer to more', () => {
  const weeks = [[0, 1, 2, 3, 4, null, null]];
  const svg = heatmapSvg({ weeks, months: [{ week: 0, label: 'Nov' }], less: 'Fewer', more: 'More tasks' });
  // Five days in range and the five squares of the legend.
  assert.equal(svg.match(/<rect /g).length, 10);
  for (const text of ['Nov', 'Mon', 'Wed', 'Fri', 'Fewer', 'More tasks']) assert.match(svg, new RegExp(`>${text}<`));
});

test('a scale rounds its top up and names at most five marks', () => {
  assert.deepEqual(scaleOf(7).ticks.map((t) => t.value), [0, 2.5, 5, 7.5]);
  assert.equal(scaleOf(7).top, 7.5);
  assert.deepEqual(scaleOf(0.12, (v) => `$${v}`).ticks.map((t) => t.label), ['$0', '$0.05', '$0.1', '$0.15']);
  assert.ok(scaleOf(0).ticks.length >= 2);
});

test('the stamp names a card by its number and the time it was read, and reads back from the end of a text', () => {
  assert.equal(stampOf(3, T), 'Read 2026-11-20 12:00:05 UTC · card 3.');
  assert.deepEqual(cardIdOf(`**Model routing**\n\n${stampOf(12, T)}`), { seq: 12, read: '2026-11-20 12:00:05' });
  assert.equal(cardIdOf(`${stampOf(3, T)} and more`), null);
  assert.equal(cardIdOf('Routing turned off for this session.'), null);
  assert.equal(cardIdOf(undefined), null);
});

test('a card as text: the title and summary, the picks, then each block as markdown', () => {
  const card = {
    title: 'Model routing', summary: '75% right first time', nav: { view: { value: 'models', options: [{ value: 'models', label: 'Models' }] }, window: { value: '7d', options: [{ value: '7d', label: 'Last 7 days' }] } },
    blocks: [
      { kind: 'grid', pairs: [{ label: 'Redone', value: '13%' }] },
      { kind: 'table', title: 'Routing', aside: 'Last 7 days', rows: [{ label: 'Total', value: '5' }] },
      { kind: 'groups', groups: [{ name: 'Kept | as asked', count: '1', rows: [{ text: 'Nov 20', value: 'Opus · high' }] }] },
      { kind: 'markdown', text: 'The log is [events.jsonl](file:///x/events.jsonl).' },
      { kind: 'mystery' },
    ],
  };
  assert.equal(textOf(card), [
    '**Model routing** · 75% right first time', 'Models · Last 7 days',
    '|  |  |\n| --- | --- |\n| Redone | 13% |',
    '| Routing | Last 7 days |\n| --- | --- |\n| Total | 5 |',
    '**Kept | as asked** 1\n- Nov 20 · Opus · high',
    'The log is [events.jsonl](file:///x/events.jsonl).',
  ].join('\n\n'));
});

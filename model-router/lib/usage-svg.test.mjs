import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BAR_SIZE, COLORS, SPARK_SIZE, SVG_MAX, barSvg, escapeXml, sparklineSvg, toneColor } from './usage-svg.mjs';

const count = (text, piece) => text.split(piece).length - 1;

test('text is escaped for markup and attributes', () => {
  assert.equal(escapeXml(`a<b>&"c"'d'`), 'a&lt;b&gt;&amp;&quot;c&quot;&#39;d&#39;');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(12), '12');
});

test('a tone names a fixed colour; an unknown tone is the muted one', () => {
  assert.equal(toneColor('good'), COLORS.good);
  assert.equal(toneColor('bad'), COLORS.bad);
  assert.equal(toneColor('nope'), COLORS.dim);
  assert.equal(toneColor(null), COLORS.dim);
  for (const hex of Object.values(COLORS)) assert.match(hex, /^#[0-9a-f]{6}$/);
});

test('a sparkline is one svg document of the size asked for, with an area, a line and the last point dotted', () => {
  const svg = sparklineSvg([0.2, 0.5, 1, 0.75], { width: 160, height: 40 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="160" height="40" viewBox="0 0 160 40"/);
  assert.match(svg, /<\/svg>$/);
  assert.equal(count(svg, '<polyline'), 1);
  assert.equal(count(svg, 'class="area"'), 1);
  assert.equal(count(svg, '<circle'), 1);
  assert.ok(svg.includes(`stroke="${COLORS.line}"`));
});

test('the highest value sits at the top and zero on the baseline', () => {
  const svg = sparklineSvg([0, 1, 0.5, 0.25], { width: 100, height: 40 });
  const points = svg.match(/<polyline[^>]* points="([^"]+)"/)[1].split(' ').map((p) => p.split(',').map(Number));
  assert.deepEqual(points, [[4, 36], [34.7, 4], [65.3, 20], [96, 28]]);
});

test('a fixed domain keeps a rate on its own scale', () => {
  const svg = sparklineSvg([0.5, 0.5, 0.5, 0.5], { width: 100, height: 40, domain: [0, 1] });
  const ys = svg.match(/<polyline[^>]* points="([^"]+)"/)[1].split(' ').map((p) => Number(p.split(',')[1]));
  assert.deepEqual(ys, [20, 20, 20, 20]);
});

test('a gap breaks the line, and a point with no neighbour is a dot', () => {
  const svg = sparklineSvg([0.2, 0.4, 0.6, null, 0.9], { width: 160, height: 40 });
  assert.equal(count(svg, '<polyline'), 1);
  // The lone point is also the last one: one dot stands for both.
  assert.equal(count(svg, '<circle'), 1);
  const lone = sparklineSvg([0.4, null, 0.6, 0.9, 0.5], { width: 160, height: 40 });
  assert.equal(count(lone, '<polyline'), 1);
  assert.equal(count(lone, '<circle'), 2);
});

test('up to three values are one bar each, so a thin series still reads as a chart', () => {
  const one = sparklineSvg([null, null, 1], { width: 160, height: 40 });
  assert.equal(count(one, '<polyline'), 0);
  assert.equal(count(one, '<circle'), 0);
  assert.equal(count(one, 'class="bar"'), 1);
  assert.equal(count(one, 'class="base"'), 1);
  assert.equal(count(sparklineSvg([0.5, null, 1, null, 0.2], { width: 160, height: 40 }), 'class="bar"'), 3);
  const four = sparklineSvg([0.5, 0.6, 1, 0.2], { width: 160, height: 40 });
  assert.equal(count(four, 'class="bar"'), 0);
  assert.equal(count(four, '<polyline'), 1);
});

test('a bar of a sparkline stands on the baseline, as tall as its value, and a zero still shows', () => {
  const svg = sparklineSvg([1, 0], { width: 100, height: 40 });
  const bars = [...svg.matchAll(/<rect class="bar" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(bars.length, 2);
  assert.deepEqual([bars[0][1], bars[0][3]], [4, 32]);
  assert.deepEqual([bars[1][1], bars[1][3]], [34, 2]);
  assert.ok(bars[0][0] >= 0 && bars[1][0] + bars[1][2] <= 100);
});

test('no value at all leaves the baseline only', () => {
  for (const values of [[], [null, null], [Number.NaN, 'x'], undefined]) {
    const svg = sparklineSvg(values, { width: 160, height: 40 });
    assert.match(svg, /^<svg /);
    assert.equal(count(svg, '<circle'), 0);
    assert.equal(count(svg, 'class="base"'), 1);
  }
});

test('labels become one tooltip per bucket, escaped', () => {
  const svg = sparklineSvg([0.5, null, 1], { labels: ['11-18: 50% <1 task>', '11-19: no task', '11-20: 100%'] });
  assert.equal(count(svg, '<title>'), 3);
  assert.ok(svg.includes('<title>11-18: 50% &lt;1 task&gt;</title>'));
  assert.equal(count(sparklineSvg([0.5, 1]), '<title>'), 0);
});

test('a drawing over the size cap drops its tooltips, then its marks', () => {
  const long = 'x'.repeat(2000);
  const values = Array.from({ length: 100 }, (_, i) => i / 100);
  const svg = sparklineSvg(values, { labels: values.map(() => long) });
  assert.ok(svg.length <= SVG_MAX);
  assert.equal(count(svg, '<title>'), 0);
  assert.equal(count(svg, '<polyline'), 1);
  const huge = sparklineSvg(Array.from({ length: 40000 }, (_, i) => (i % 2 ? i : null)));
  assert.ok(huge.length <= SVG_MAX);
  assert.equal(count(huge, 'class="base"'), 1);
});

test('odd sizes and colours fall back to the defaults', () => {
  const svg = sparklineSvg([1, 2], { width: -5, height: 'tall', color: 'red" onload="x' });
  assert.match(svg, /width="168" height="40"/);
  assert.ok(!svg.includes('onload'));
  assert.ok(svg.includes(COLORS.line));
});

test('a bar is a track filled to the share, clamped', () => {
  const svg = barSvg(0.75, { width: 120, height: 8, color: COLORS.good });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="8" viewBox="0 0 120 8"/);
  assert.equal(count(svg, '<rect'), 2);
  assert.ok(svg.includes(`width="90" height="8" rx="4" fill="${COLORS.good}"`));
  assert.ok(barSvg(7, { width: 120 }).includes('width="120" height="8" rx="4" fill='));
  assert.ok(barSvg(-1, { width: 120 }).includes('class="track"'));
});

test('a share above zero always shows, at least one pixel wide', () => {
  assert.ok(barSvg(0.001, { width: 120 }).includes('<rect width="1" height="8" rx="0.5"'));
  assert.ok(barSvg(0.02, { width: 120 }).includes('<rect width="2" height="8" rx="1"'));
});

test('the default sizes are exported for the layout', () => {
  assert.deepEqual(SPARK_SIZE, { width: 168, height: 40 });
  assert.deepEqual(BAR_SIZE, { width: 120, height: 8 });
  assert.match(sparklineSvg([1]), /width="168" height="40"/);
  assert.match(barSvg(1), /width="120" height="8"/);
});

test('an unknown share draws the track alone', () => {
  for (const share of [null, undefined, Number.NaN, 0]) assert.equal(count(barSvg(share), '<rect'), 1);
});

test('a column chart draws one column per count above zero, the tallest at full height', async () => {
  const { COLUMNS_SIZE, columnsSvg } = await import('./usage-svg.mjs');
  const svg = columnsSvg([0, 2, 4, null, 1], { width: 108, height: 48, labels: ['a', 'b <i>', 'c'] });
  assert.equal(svg.match(/<rect class="col"/g).length, 3);
  assert.match(svg, /height="40"/);
  assert.match(svg, /<title>b &lt;i&gt;<\/title>/);
  assert.equal(svg.match(/<title>/g).length, 3);
  assert.ok(!svg.includes('<i>'));
  for (const empty of [[], [0, 0], [null], 'x', undefined]) assert.ok(!columnsSvg(empty).includes('class="col"'));
  assert.match(columnsSvg([1]), new RegExp(`width="${COLUMNS_SIZE.width}" height="${COLUMNS_SIZE.height}"`));
  assert.match(columnsSvg([1000, 1]), /height="2"/, 'a small count is still visible');
  const many = columnsSvg(Array.from({ length: 4000 }, () => 1), { labels: Array.from({ length: 4000 }, () => 'x'.repeat(40)) });
  assert.ok(many.length <= SVG_MAX);
});

test('a parts bar is one track filled by its parts in order, each in its colour; odd parts are skipped', async () => {
  const { partsBarSvg } = await import('./usage-svg.mjs');
  const svg = partsBarSvg([{ share: 0.7, color: '#111111' }, { share: 0.2, color: '#222222' }, { share: 0.1, color: 'red' }, { share: -1 }, null], { width: 100, height: 8 });
  assert.match(svg, /^<svg [^>]*width="100" height="8"/);
  assert.equal(count(svg, 'class="track"'), 1);
  assert.match(svg, /<rect x="0" width="70" height="8" fill="#111111"\/>/);
  assert.match(svg, /<rect x="70" width="20" height="8" fill="#222222"\/>/);
  assert.ok(svg.includes(`x="90" width="10" height="8" fill="${COLORS.dim}"`), 'a colour that is no hex is the muted one');
  assert.equal(count(partsBarSvg([], {}), '<rect'), 1);
});

test('paired bars: two bars per period, the second in front, each with its tooltip, on one scale', async () => {
  const { PAIRS_SIZE, pairedBarsSvg } = await import('./usage-svg.mjs');
  const svg = pairedBarsSvg([[2, 1], [4, 3]], { labels: [['a <b>', 'c'], ['d', 'e']] });
  assert.match(svg, new RegExp(`width="${PAIRS_SIZE.width}" height="${PAIRS_SIZE.height}"`));
  assert.equal(count(svg, 'class="first"'), 2);
  assert.equal(count(svg, 'class="second"'), 2);
  assert.ok(svg.includes('<title>a &lt;b&gt;</title>'));
  assert.equal(count(pairedBarsSvg([], {}), '<rect'), 0);
  assert.equal(count(pairedBarsSvg([[0, 0]], {}), 'class="first"'), 0);
  const many = pairedBarsSvg(Array.from({ length: 2000 }, () => [1, 2]), { labels: Array.from({ length: 2000 }, () => ['x'.repeat(40), 'y'.repeat(40)]) });
  assert.ok(many.length <= SVG_MAX);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLORS, SVG_MAX, barSvg, escapeXml, sparklineSvg, toneColor } from './usage-svg.mjs';

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
  const svg = sparklineSvg([0, 1], { width: 100, height: 40 });
  const points = svg.match(/<polyline[^>]* points="([^"]+)"/)[1].split(' ').map((p) => p.split(',').map(Number));
  assert.deepEqual(points, [[4, 36], [96, 4]]);
});

test('a fixed domain keeps a rate on its own scale', () => {
  const svg = sparklineSvg([0.5, 0.5], { width: 100, height: 40, domain: [0, 1] });
  const ys = svg.match(/<polyline[^>]* points="([^"]+)"/)[1].split(' ').map((p) => Number(p.split(',')[1]));
  assert.deepEqual(ys, [20, 20]);
});

test('a gap breaks the line, and a point with no neighbour is a dot', () => {
  const svg = sparklineSvg([0.4, 0.6, null, 0.9], { width: 160, height: 40 });
  assert.equal(count(svg, '<polyline'), 1);
  // The lone point is also the last one: one dot stands for both.
  assert.equal(count(svg, '<circle'), 1);
  const lone = sparklineSvg([0.4, null, 0.6, 0.9], { width: 160, height: 40 });
  assert.equal(count(lone, '<polyline'), 1);
  assert.equal(count(lone, '<circle'), 2);
});

test('one value alone is a dot on the baseline, never an empty picture', () => {
  const svg = sparklineSvg([null, null, 1], { width: 160, height: 40 });
  assert.equal(count(svg, '<polyline'), 0);
  assert.equal(count(svg, '<circle'), 1);
  assert.equal(count(svg, 'class="base"'), 1);
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

test('an unknown share draws the track alone', () => {
  for (const share of [null, undefined, Number.NaN, 0]) assert.equal(count(barSvg(share), '<rect'), 1);
});

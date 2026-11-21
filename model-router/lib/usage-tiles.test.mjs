import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cols, costStatus, deltaOf, fpyStatus, reworkStatus, sparkline, sparkRows, tileRows, tilesOf } from './usage-tiles.mjs';

const HEADLINE = {
  current: { closed: 42, fpy: 0.87, reworkRate: 0.09, costPerSuccess: 0.031, routed: { total: 42, downgrade: 31, upgrade: 6, keep: 5 } },
  previous: { closed: 30, fpy: 0.83, reworkRate: 0.11, costPerSuccess: 0.0352, routed: { total: 20, downgrade: 10, upgrade: 5, keep: 5 } },
};

// The tiles of HEADLINE as the text fallback prints them, one row of four and two by two.
const ONE_ROW = [
  '╭─ FPY ───────╮ ╭─ $/success ─╮ ╭─ Rework ────╮ ╭─ Routed ────╮',
  '│   87% ▲4    │ │ $0.031 ▼12% │ │    9% ▼2    │ │  42 starts  │',
  '│   🟢 good   │ │ 🟢 cheaper  │ │   🟢 low    │ │  ↓31 ↑6 =5  │',
  '╰─────────────╯ ╰─────────────╯ ╰─────────────╯ ╰─────────────╯',
];

test('golden: the four tiles on one row from 70 columns', () => {
  assert.deepEqual(tileRows(HEADLINE, 80).map((r) => r.text), ONE_ROW);
});

test('golden: the tiles stand two by two under 70 columns', () => {
  assert.deepEqual(tileRows(HEADLINE, 64).map((r) => r.text), [
    '╭─ FPY ───────╮ ╭─ $/success ─╮',
    '│   87% ▲4    │ │ $0.031 ▼12% │',
    '│   🟢 good   │ │ 🟢 cheaper  │',
    '╰─────────────╯ ╰─────────────╯',
    '╭─ Rework ────╮ ╭─ Routed ────╮',
    '│    9% ▼2    │ │  42 starts  │',
    '│   🟢 low    │ │  ↓31 ↑6 =5  │',
    '╰─────────────╯ ╰─────────────╯',
  ]);
});

test('every tile line is as wide as its border, emoji counted two columns', () => {
  for (const r of tileRows(HEADLINE, 80)) assert.equal(cols(r.text), 63);
  const weak = { current: { closed: 2, fpy: 0.5, reworkRate: 0.5, costPerSuccess: 0.2, routed: { total: 0, downgrade: 0, upgrade: 0, keep: 0 } }, previous: null };
  for (const r of tileRows(weak, 80)) assert.equal(cols(r.text), 63);
  for (const r of tileRows(null, 80)) assert.equal(cols(r.text), 63);
});

test('the borders and titles are accent; a delta is good or bad by whether it helps', () => {
  const [first, second] = tilesOf(HEADLINE)[0];
  assert.equal(first[0].tone, 'accent');
  assert.equal(second.find((s) => s.text === '▲4').tone, 'good');
  const cost = tilesOf(HEADLINE)[1][1];
  assert.equal(cost.find((s) => s.text === '▼12%').tone, 'good');
  const worse = tilesOf({ current: { ...HEADLINE.current, costPerSuccess: 0.05 }, previous: HEADLINE.previous })[1][1];
  assert.equal(worse.find((s) => s.text.startsWith('▲')).tone, 'bad');
});

test('status dots follow the thresholds, and a weak signal is white', () => {
  assert.equal(fpyStatus(0.85, 10).dot, '🟢');
  assert.equal(fpyStatus(0.7, 10).dot, '🟡');
  assert.equal(fpyStatus(0.69, 10).dot, '🔴');
  assert.equal(fpyStatus(0.99, 4).dot, '⚪');
  assert.equal(reworkStatus(0.1, 10).dot, '🟢');
  assert.equal(reworkStatus(0.25, 10).dot, '🟡');
  assert.equal(reworkStatus(0.26, 10).dot, '🔴');
  assert.equal(reworkStatus(0, 3).dot, '⚪');
  assert.equal(costStatus(0.02, 0.03, 10).dot, '🟢');
  assert.equal(costStatus(0.04, 0.03, 10).dot, '🔴');
  assert.equal(costStatus(0.04, null, 10).word, 'no prior');
  assert.equal(costStatus(0.04, 0.03, 2).dot, '⚪');
});

test('deltas: points for rates, percent for cost, capped, empty without a comparison', () => {
  assert.deepEqual(deltaOf(0.9, 0.8, { points: true, higherIsBetter: true }), { text: '▲10', tone: 'good' });
  assert.deepEqual(deltaOf(0.2, 0.1, { points: true, higherIsBetter: false }), { text: '▲10', tone: 'bad' });
  assert.deepEqual(deltaOf(0.5, 1, { higherIsBetter: false }), { text: '▼50%', tone: 'good' });
  assert.deepEqual(deltaOf(100, 1, { higherIsBetter: false }), { text: '▲999%', tone: 'bad' });
  assert.deepEqual(deltaOf(0.5, 0.5, { points: true, higherIsBetter: true }), { text: '=', tone: 'dim' });
  assert.deepEqual(deltaOf(0.5, null, { points: true, higherIsBetter: true }), { text: '', tone: null });
});

test('a sparkline scales from the lowest to the highest value, with gaps as spaces', () => {
  assert.equal(sparkline([0, 1, 2, 3, 4, 5, 6, 7]), '▁▂▃▄▅▆▇█');
  assert.equal(sparkline([1, null, 1]), '▄ ▄');
  assert.equal(sparkline([null, null]), '');
});

test('golden: the sparkline rows carry their unit and the latest value', () => {
  const series = { unit: 'day', points: [0.5, 0.6, null, 0.7, 0.8, 0.9, 1].map((fpy, i) => (fpy === null ? null : { n: 5, fpy, costPerSuccess: 0.01 * (7 - i) })) };
  assert.deepEqual(sparkRows(series).map((r) => r.text), [
    'FPY by day            ▁▂ ▄▅▇█  100%',
    '$/success by day      █▇ ▄▃▂▁  $0.010',
  ]);
  assert.deepEqual(sparkRows({ unit: 'week', points: [null, null] }).map((r) => r.text), [
    'FPY by week           no data  –',
    '$/success by week     no data  –',
  ]);
});

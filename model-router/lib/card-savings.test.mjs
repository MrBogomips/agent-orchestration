import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_COLORS, SHADES } from './card-parts.mjs';
import { SPEND_COLORS, savingsBlocks, weekBars } from './card-savings.mjs';

const label = (week) => `w${week.slice(5)}`;

test('a week that saved stacks spent and what the session\'s model would have added; one that cost more, its baseline and the excess', () => {
  assert.deepEqual(SPEND_COLORS, { spent: SHADES.opus, added: SHADES.haiku, above: KIND_COLORS[1] });
  const bars = weekBars([
    { week: '2026-11-09', spent: 1, baseline: 3, saving: 2 },
    { week: '2026-11-16', spent: 5, baseline: 4, saving: -1 },
  ], label);
  assert.deepEqual(bars, [
    { label: 'w11-09', parts: [{ value: 1, color: SHADES.opus }, { value: 2, color: SHADES.haiku }] },
    { label: 'w11-16', parts: [{ value: 4, color: SHADES.opus }, { value: 1, color: KIND_COLORS[1] }] },
  ]);
});

const model = (weeks) => ({
  isEmpty: false, tasks: 3, leftOut: 0, verdict: 'not proven', reason: 'too-few', savedShare: 0.1, quality: null, qualityGap: null,
  perSuccess: 1, baselinePerSuccess: 1.1, saved: 0.3, spent: 3, baselineSpent: 3.3, baselineFpyFrom: 'kept', movesTotal: 0.3,
  judge: { calls: 0, totalMs: 0, medianMs: null }, moves: [],
  groups: { cheaper: { tasks: 1, share: 1 / 3, fpy: 1, reworkRate: 0, saving: 0.3 }, kept: { tasks: 2, share: 2 / 3, fpy: 1, reworkRate: 0, saving: 0 }, stronger: { tasks: 0, share: 0, fpy: null, reworkRate: null, saving: 0 } },
  weeks,
});

test('the legend names the excess only when a week cost more than on the session\'s model', () => {
  const legendOf = (weeks) => savingsBlocks(model(weeks), { windowLabel: 'Last 30 days', weekLabel: label }).find((b) => b.kind === 'legend');
  const saved = legendOf([{ week: '2026-11-16', spent: 3, baseline: 3.3, saving: 0.3 }]);
  assert.deepEqual(saved.rows.map((r) => r.name), ['Spent', 'What the session\'s model would have added']);
  const dear = legendOf([{ week: '2026-11-09', spent: 1, baseline: 1.5, saving: 0.5 }, { week: '2026-11-16', spent: 2, baseline: 1.8, saving: -0.2 }]);
  assert.deepEqual(dear.rows.map((r) => [r.name, r.color]), [
    ['Spent', SHADES.opus], ['What the session\'s model would have added', SHADES.haiku], ['Cost above the session\'s model', KIND_COLORS[1]],
  ]);
  assert.match(dear.source, /^<svg /);
  assert.equal(legendOf([]), undefined);
});

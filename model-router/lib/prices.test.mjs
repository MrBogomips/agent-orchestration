import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRICE_ERROR, MIN_PRICE_TASKS, PRICE_DAYS, USAGE_KINDS, checkedUsage, costAt, pricesOf } from './prices.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86400000;
const M = 1e6;
/** Opus-like prices per million tokens. */
const TRUE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

/** A usage that differs from task to task, so the four kinds can be told apart. */
const usageAt = (i) => ({ input: 2000 + 700 * i, output: 900 + 450 * ((i * 7) % 5), cacheRead: 80000 + 23000 * ((i * 3) % 7), cacheWrite: 3000 + 1100 * ((i * 5) % 4) });
const exact = (usage, rates = TRUE) => USAGE_KINDS.reduce((s, k) => s + (rates[k] * usage[k]) / M, 0);
function o(i, { tier = 'opus', ago = 1, usage = usageAt(i), cost = exact(usage), outcome = 'success' } = {}) {
  const ts = new Date(NOW - ago * DAY).toISOString();
  return { type: 'outcome', ts, reportTs: ts, tier, model: `claude-${tier}-5-5`, outcome, costUsd: cost, tokens: 1, usage };
}
const series = (n, extra = {}) => Array.from({ length: n }, (_, i) => o(i, extra));
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

test('the constants of the fit', () => {
  assert.equal(PRICE_DAYS, 90);
  assert.equal(MIN_PRICE_TASKS, 8);
  assert.equal(MAX_PRICE_ERROR, 0.1);
  assert.deepEqual(USAGE_KINDS, ['input', 'output', 'cacheRead', 'cacheWrite']);
});

test('a usage is well formed with four counts of zero or more; anything else is null', () => {
  assert.deepEqual(checkedUsage({ input: 1, output: 0, cacheRead: 3, cacheWrite: 4, extra: 'x' }), { input: 1, output: 0, cacheRead: 3, cacheWrite: 4 });
  for (const bad of [null, 'lots', 7, [], { input: 1, output: 2, cacheRead: 3 }, { input: -1, output: 2, cacheRead: 3, cacheWrite: 4 },
    { input: Number.NaN, output: 2, cacheRead: 3, cacheWrite: 4 }, { input: '1', output: 2, cacheRead: 3, cacheWrite: 4 }, { input: Infinity, output: 2, cacheRead: 3, cacheWrite: 4 }]) {
    assert.equal(checkedUsage(bad), null, JSON.stringify(bad));
  }
});

test('four known prices are recovered exactly from the costs of a tier', () => {
  const prices = pricesOf([...series(12), ...series(10, { tier: 'haiku', cost: undefined }).map((x) => ({ ...x, costUsd: exact(x.usage, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }) }))], NOW);
  for (const k of USAGE_KINDS) near(prices.opus[k], TRUE[k]);
  near(prices.haiku.output, 5);
  near(prices.haiku.cacheRead, 0.1);
  assert.equal(prices.sonnet, undefined);
  near(costAt(prices.opus, usageAt(3)), exact(usageAt(3)), 1e-12);
});

test('a tier with fewer than eight outcomes in the fit has no prices; cancelled ones count', () => {
  assert.equal(pricesOf(series(7), NOW).opus, undefined);
  assert.ok(pricesOf([...series(7), o(7, { outcome: 'cancelled' })], NOW).opus);
});

test('a kind never used is left out of the fit, at 0', () => {
  const list = series(10).map((x) => {
    const usage = { ...x.usage, cacheWrite: 0 };
    return { ...x, usage, costUsd: exact(usage) };
  });
  const prices = pricesOf(list, NOW).opus;
  assert.equal(prices.cacheWrite, 0);
  near(prices.input, TRUE.input);
  near(prices.output, TRUE.output);
});

test('a kind fitted below zero is set to 0 and the others fitted again', () => {
  // Costs made with a negative cache-write price, on small cache writes: the free fit finds it, the refit drops it.
  const list = series(12).map((x) => {
    const usage = { ...x.usage, cacheWrite: 200 + 50 * (x.usage.input % 3) };
    return { ...x, usage, costUsd: exact(usage, { ...TRUE, cacheWrite: -6 }) };
  });
  const prices = pricesOf(list, NOW).opus;
  assert.equal(prices.cacheWrite, 0);
  for (const k of USAGE_KINDS) assert.ok(prices[k] >= 0, k);
  assert.ok(Math.abs(prices.output - TRUE.output) / TRUE.output < 0.1);
});

test('costs the four kinds do not explain within 10% give no prices', () => {
  const noisy = series(12).map((x, i) => ({ ...x, costUsd: x.costUsd * (i % 2 ? 1.6 : 0.5) }));
  assert.equal(pricesOf(noisy, NOW).opus, undefined);
});

test('only the last 90 days count, and only outcomes with a cost above zero and a well-formed usage', () => {
  const old = series(6, { ago: 120 }).map((x) => ({ ...x, costUsd: x.costUsd * 9 }));
  const bad = [
    { ...o(1), usage: { input: 1, output: 2, cacheRead: 3 }, costUsd: 50 },
    { ...o(2), usage: { ...usageAt(2), output: -5 }, costUsd: 50 },
    { ...o(3), usage: { ...usageAt(3), input: Number.NaN }, costUsd: 50 },
    { ...o(4), usage: 'many', costUsd: 50 },
    { ...o(5), costUsd: 0 },
    { ...o(6), costUsd: null },
    { ...o(7), ago: -2 },
  ];
  const prices = pricesOf([...series(9), ...old, ...bad], NOW).opus;
  for (const k of USAGE_KINDS) near(prices[k], TRUE[k]);
  assert.equal(pricesOf([...series(7), ...series(5, { ago: 120 })], NOW).opus, undefined);
});

test('kinds that cannot be told apart give no prices rather than a guess', () => {
  const twin = series(10).map((x) => {
    const usage = { ...x.usage, cacheWrite: x.usage.input };
    return { ...x, usage, costUsd: exact(usage) };
  });
  assert.equal(pricesOf(twin, NOW).opus, undefined);
});

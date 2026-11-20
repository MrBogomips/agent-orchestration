import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ageFactor, ageCell, priorFor, applyOutcome, emptyLevel, cellKey, posterior, combine, metrics, recommend } from './aggregate.mjs';

const grid = JSON.parse(readFileSync(new URL('../grid.json', import.meta.url), 'utf8'));
const DAY = 86400000;
const NOW = Date.parse('2026-11-20T10:00:00Z');
const OPTS = { now: NOW, halfLifeDays: 30, grid };
const outcome = (extra = {}) => ({
  class: 'edit-specified', tier: 'sonnet', effort: 'medium', model: 'claude-sonnet-5-5', outcome: 'success',
  learn: true, costUsd: 0.04, tokens: 20000, ...extra,
});

test('ageFactor halves the weight every half-life', () => {
  assert.equal(ageFactor(new Date(NOW).toISOString(), NOW, 30), 1);
  assert.ok(Math.abs(ageFactor(new Date(NOW - 30 * DAY).toISOString(), NOW, 30) - 0.5) < 1e-9);
  assert.ok(Math.abs(ageFactor(new Date(NOW - 60 * DAY).toISOString(), NOW, 30) - 0.25) < 1e-9);
});

test('ageCell scales the counts and leaves the means', () => {
  const cell = { n: 4, success: 2, rework: 1, failure: 1, costMean: 0.1, tokensMean: 10, updated: new Date(NOW - 30 * DAY).toISOString() };
  const aged = ageCell(cell, NOW, 30);
  assert.equal(aged.n, 2);
  assert.equal(aged.success, 1);
  assert.equal(aged.costMean, 0.1);
  assert.equal(cell.n, 4, 'the input is not changed');
});

test('the grid prior favours the class default and starts the rest even', () => {
  assert.deepEqual(priorFor(grid, 'edit-specified', 'sonnet', 'medium'), { alpha: 2, beta: 1 });
  assert.deepEqual(priorFor(grid, 'edit-specified', 'haiku', 'medium'), { alpha: 1, beta: 1 });
});

test('applyOutcome adds to the cell of class x tier x effort and returns a new level', () => {
  const level = emptyLevel('user');
  const next = applyOutcome(level, outcome(), OPTS);
  assert.deepEqual(level.cells, {}, 'the input is not changed');
  const cell = next.cells[cellKey('edit-specified', 'sonnet', 'medium')];
  assert.equal(cell.n, 1);
  assert.equal(cell.success, 1);
  assert.equal(cell.alpha, 3);
  assert.equal(cell.beta, 1);
  assert.equal(cell.costMean, 0.04);
  assert.equal(cell.model, 'claude-sonnet-5-5');
  const again = applyOutcome(next, outcome({ outcome: 'rework', costUsd: 0.08, tokens: 40000 }), OPTS);
  const c2 = again.cells[cellKey('edit-specified', 'sonnet', 'medium')];
  assert.equal(c2.n, 2);
  assert.equal(c2.beta, 2);
  assert.ok(Math.abs(c2.costMean - 0.06) < 1e-12);
  assert.equal(c2.tokensMean, 30000);
});

test('applyOutcome ignores outcomes that are not learned', () => {
  const level = emptyLevel('user');
  assert.equal(applyOutcome(level, outcome({ learn: false }), OPTS), level);
});

test('applyOutcome ages the cell before the update', () => {
  const old = applyOutcome(emptyLevel('user'), outcome(), { ...OPTS, now: NOW - 30 * DAY });
  const cell = applyOutcome(old, outcome(), OPTS).cells[cellKey('edit-specified', 'sonnet', 'medium')];
  assert.ok(Math.abs(cell.n - 1.5) < 1e-9);
});

test('a new model behind the alias halves the counts of the old cell', () => {
  const first = applyOutcome(applyOutcome(emptyLevel('user'), outcome(), OPTS), outcome(), OPTS);
  const cell = applyOutcome(first, outcome({ model: 'claude-sonnet-6-0' }), OPTS).cells[cellKey('edit-specified', 'sonnet', 'medium')];
  assert.equal(cell.n, 2);
  assert.equal(cell.model, 'claude-sonnet-6-0');
});

test('posterior ages at read time', () => {
  const level = applyOutcome(emptyLevel('user'), outcome(), { ...OPTS, now: NOW - 30 * DAY });
  const p = posterior(level.cells[cellKey('edit-specified', 'sonnet', 'medium')], NOW, 30, grid);
  assert.equal(p.alpha, 2.5);
  assert.equal(p.beta, 1);
});

test('combine: little project data leans on the user level, more on the project', () => {
  const user = { alpha: 9, beta: 1 };
  const fresh = combine(undefined, user, 5);
  assert.ok(Math.abs(fresh.alpha - 4.5) < 1e-9 && Math.abs(fresh.beta - 0.5) < 1e-9);
  const p = combine({ alpha: 1 + 0, beta: 1 + 20 }, user, 5);
  assert.ok(p.alpha / (p.alpha + p.beta) < 0.3);
});

test('metrics: FPY, rework rate, cost per task and per successful task', () => {
  const m = metrics({ n: 4, success: 2, rework: 1, failure: 1, costMean: 0.1, tokensMean: 5 });
  assert.equal(m.fpy, 0.5);
  assert.equal(m.reworkRate, 0.25);
  assert.equal(m.costPerTask, 0.1);
  assert.equal(m.costPerSuccess, 0.2);
  assert.equal(metrics({ n: 1, success: 0, rework: 0, failure: 1, costMean: 0.1 }).costPerSuccess, null);
});

test('recommend picks the lowest cost per successful task among cells with enough data', () => {
  const cells = {
    a: { class: 'edit-specified', tier: 'haiku', effort: 'low', n: 5, success: 5, rework: 0, failure: 0, costMean: 0.01 },
    b: { class: 'edit-specified', tier: 'sonnet', effort: 'medium', n: 5, success: 5, rework: 0, failure: 0, costMean: 0.05 },
    c: { class: 'edit-specified', tier: 'haiku', effort: 'medium', n: 1, success: 1, rework: 0, failure: 0, costMean: 0.001 },
  };
  assert.deepEqual(recommend(cells, 'edit-specified', grid), { tier: 'haiku', effort: 'low', source: 'data' });
});

test('recommend never goes below the grid for protected classes, and falls back to the grid', () => {
  const cells = {
    a: { class: 'review-debug', tier: 'haiku', effort: 'low', n: 9, success: 9, rework: 0, failure: 0, costMean: 0.01 },
  };
  assert.deepEqual(recommend(cells, 'review-debug', grid), { tier: 'opus', effort: 'medium', source: 'grid' });
  assert.deepEqual(recommend({}, 'read-search', grid), { tier: 'haiku', effort: 'low', source: 'grid' });
});

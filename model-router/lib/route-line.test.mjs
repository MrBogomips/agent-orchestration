import test from 'node:test';
import assert from 'node:assert/strict';

import { EFFORT_COLORS, MODEL_COLORS, effortBar, lineParts, modelName, plainLine, quietLine, routeReason } from './route-line.mjs';

test('the effort bar fills one cell per level, low to xhigh; max reads as xhigh; unknown is empty', () => {
  assert.equal(effortBar('low'), '▰▱▱▱');
  assert.equal(effortBar('medium'), '▰▰▱▱');
  assert.equal(effortBar('high'), '▰▰▰▱');
  assert.equal(effortBar('xhigh'), '▰▰▰▰');
  assert.equal(effortBar('max'), '▰▰▰▰');
  assert.equal(effortBar(undefined), '▱▱▱▱');
});

test('the plain line has no dot, a four-cell bar and a plain arrow', () => {
  assert.equal(plainLine({ model: 'opus', effort: 'high', reason: 'complex, constrained form' }), '🔀 opus ▰▰▰▱ high -> complex, constrained form');
  assert.equal(plainLine({ model: 'claude-haiku-5-5', effort: 'low', reason: 'rename' }), '🔀 haiku ▰▱▱▱ low -> rename');
  assert.doesNotMatch(plainLine({ model: 'sonnet', effort: 'medium', reason: 'x' }), /·/);
});

test('padded, the model and effort columns align across tiers', () => {
  const lines = ['haiku', 'sonnet', 'opus', 'fable'].map((m) => plainLine({ model: m, effort: 'low', reason: 'r' }, { pad: true }));
  assert.equal(new Set(lines.map((l) => l.indexOf('▰'))).size, 1);
  const arrows = ['low', 'medium', 'high', 'xhigh'].map((e) => plainLine({ model: 'opus', effort: e, reason: 'r' }, { pad: true }).indexOf('->'));
  assert.equal(new Set(arrows).size, 1);
});

test('the parts carry the colours of the tier and the level', () => {
  const p = lineParts({ model: 'claude-sonnet-5', effort: 'medium', reason: 'r' });
  assert.equal(p.model, 'sonnet');
  assert.equal(p.modelColor, MODEL_COLORS.sonnet);
  assert.equal(p.effortColor, EFFORT_COLORS.medium);
  assert.equal(p.filled, '▰▰');
  assert.equal(p.empty, '▱▱');
  const unknown = lineParts({ model: 'my-model', effort: null, reason: 'r' });
  assert.equal(unknown.model, 'my-model');
  assert.equal(unknown.modelColor, null);
  assert.equal(unknown.effort, 'default');
  assert.equal(unknown.effortColor, null);
  assert.equal(modelName(undefined), '?');
});

test('the reason says which case applied and what the router changed', () => {
  assert.equal(routeReason({ route: 'explicit', reason: 'the call carries a model' }), 'explicit: the call names the model');
  assert.equal(routeReason({ route: 'fixed', reason: 'the definition fixes a model' }), 'fixed: the definition fixes a model');
  assert.equal(routeReason({ route: 'off', reason: 'router off' }), 'keep: router off');
  assert.equal(routeReason({ route: 'fork', reason: 'a fork inherits its parent' }), 'keep: a fork inherits its parent');
  const judged = { route: 'judge', cls: 'edit-specified', judgeTier: 'balanced', before: 'claude-opus-5', after: 'sonnet' };
  assert.equal(routeReason({ ...judged, action: 'downgrade' }), 'judge: edit-specified; lowered from opus');
  assert.equal(routeReason({ ...judged, action: 'upgrade', before: 'haiku', after: 'opus' }), 'judge: edit-specified; raised from haiku');
  assert.equal(routeReason({ ...judged, action: 'forced-risk', before: 'sonnet', after: 'opus' }), 'judge: risky work; raised from sonnet');
  assert.equal(routeReason({ ...judged, action: 'keep', after: 'claude-opus-5', effortSet: true }), 'judge: edit-specified; kept opus, effort set');
  assert.equal(routeReason({ ...judged, cls: null, action: 'keep', after: 'opus' }), 'judge: balanced; kept opus');
  assert.equal(routeReason({ route: 'judge', action: 'error', reason: 'judge: timeout' }), 'keep: judge: timeout');
});

test('the desktop line is quiet and in words: the model and effort, then the reason without its keyword', () => {
  assert.deepEqual(quietLine({ model: 'claude-haiku-5-5', effort: 'low', reason: 'judge: read-search; lowered from opus' }), { model: 'Haiku · low', reason: 'read-search; lowered from opus' });
  assert.deepEqual(quietLine({ model: 'opus', effort: null, reason: 'explicit: the call names the model' }), { model: 'Opus · default', reason: 'the call names the model' });
  assert.equal(quietLine({ model: 'sonnet', effort: 'high', reason: 'keep: routing off' }).reason, 'kept: routing off');
});

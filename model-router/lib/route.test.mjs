import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeCase, definitionCase, isRisky, decideEffort, decideModel } from './route.mjs';

const OPTS = { minDowngradeConfidence: 0.6, minUpgradeConfidence: 0.3, minFrontierConfidence: 0.7, riskThreshold: 0.7 };
const MODELS = { fast: 'haiku', balanced: 'sonnet', frontier: 'fable', deep: 'opus' };
const base = { subagentType: 'general-purpose', enabled: true, routeSubagents: true, definition: 'inherit' };

test('routeCase: the call that carries a model keeps it', () => {
  assert.equal(routeCase({ ...base, model: 'opus' }).route, 'explicit');
});

test('routeCase: a fork, the router off, a forced model and a fixed definition are kept', () => {
  assert.equal(routeCase({ ...base, subagentType: 'fork' }).route, 'fork');
  assert.equal(routeCase({ ...base, enabled: false }).route, 'off');
  assert.equal(routeCase({ ...base, routeSubagents: false }).route, 'off');
  assert.equal(routeCase({ ...base, forcedModel: 'sonnet' }).route, 'forced');
  assert.equal(routeCase({ ...base, definition: 'fixed' }).route, 'fixed');
  assert.equal(routeCase({ ...base, definition: 'unknown' }).route, 'fixed');
});

test('routeCase: no model given goes to the judge', () => {
  assert.equal(routeCase(base).route, 'judge');
});

test('definitionCase: inheriting built-ins and model-less definitions are routable', () => {
  assert.equal(definitionCase('general-purpose'), 'inherit');
  assert.equal(definitionCase('Explore'), 'inherit');
  assert.equal(definitionCase('Plan'), 'unknown', 'not verified to inherit: kept');
  assert.equal(definitionCase('reviewer', '---\nname: reviewer\ndescription: x\n---\nbody'), 'inherit');
  assert.equal(definitionCase('reviewer', '---\nname: reviewer\nmodel: inherit\n---\nbody'), 'inherit');
});

test('definitionCase: a file that declares another name is not the definition of the type', () => {
  // Claude Code names an agent type after the frontmatter name, not the file name (checked on 2.1.330).
  assert.equal(definitionCase('bar', '---\nname: baz\ndescription: x\n---\nbody'), 'unknown');
  assert.equal(definitionCase('bar', '---\nname: "baz"\nmodel: haiku\n---\n'), 'unknown');
  assert.equal(definitionCase('bar', '---\nname: bar\nmodel: inherit\n---\n'), 'inherit');
  assert.equal(definitionCase('bar', "---\nname: 'bar'\n---\n"), 'inherit');
  assert.equal(definitionCase('bar', '---\ndescription: no name\n---\n'), 'inherit', 'no name: the file name stands');
});

test('definitionCase: a model in the frontmatter, a plugin agent or an unread file count as fixed or unknown', () => {
  assert.equal(definitionCase('reviewer', '---\nname: reviewer\nmodel: "haiku"\n---\n'), 'fixed');
  assert.equal(definitionCase('plug:agent'), 'unknown');
  assert.equal(definitionCase('reviewer'), 'unknown');
  assert.equal(definitionCase('reviewer', 'no frontmatter at all\nmodel: haiku'), 'inherit');
});

test('isRisky: the tag marker or the judge above the threshold', () => {
  assert.equal(isRisky({ risky: 0.71 }, false, 0.7), true);
  assert.equal(isRisky({ risky: 0.7 }, false, 0.7), false);
  assert.equal(isRisky(null, true, 0.7), true);
  assert.equal(isRisky({ risky: null }, false, 0.7), false);
});

test('decideEffort: an explicit effort wins; risky work gets at least high', () => {
  assert.equal(decideEffort({ judge: { effort: 0, effortConfidence: 1 }, explicitEffort: 'medium', risky: false, options: OPTS }), 'medium');
  assert.equal(decideEffort({ judge: { effort: 0, effortConfidence: 1 }, risky: true, options: OPTS }), 'high');
  assert.equal(decideEffort({ judge: { effort: 3, effortConfidence: 1 }, risky: true, options: OPTS }), 'xhigh');
});

test('decideEffort: low needs the downgrade bar, higher levels the upgrade bar, missing confidence sets nothing', () => {
  assert.equal(decideEffort({ judge: { effort: 0, effortConfidence: 0.5 }, risky: false, options: OPTS }), undefined);
  assert.equal(decideEffort({ judge: { effort: 0, effortConfidence: 0.6 }, risky: false, options: OPTS }), 'low');
  assert.equal(decideEffort({ judge: { effort: 2, effortConfidence: 0.3 }, risky: false, options: OPTS }), 'high');
  assert.equal(decideEffort({ judge: { effort: 2, effortConfidence: null }, risky: false, options: OPTS }), undefined);
  assert.equal(decideEffort({ judge: null, risky: false, options: OPTS }), undefined);
});

test('decideModel: downgrade needs 0.6, upgrade 0.3', () => {
  assert.deepEqual(
    decideModel({ judge: { tier: 'fast', confidence: 0.86 }, current: 'claude-opus-5-5', risky: false, options: OPTS, models: MODELS }),
    { action: 'downgrade', model: 'haiku', reason: 'judge: fast at 0.86' },
  );
  assert.equal(decideModel({ judge: { tier: 'fast', confidence: 0.5 }, current: 'opus', risky: false, options: OPTS, models: MODELS }).action, 'keep');
  assert.equal(decideModel({ judge: { tier: 'deep', confidence: 0.3 }, current: 'haiku', risky: false, options: OPTS, models: MODELS }).action, 'upgrade');
  assert.equal(decideModel({ judge: { tier: 'deep', confidence: 0.2 }, current: 'haiku', risky: false, options: OPTS, models: MODELS }).action, 'keep');
});

test('decideModel: missing confidence never lowers; an unknown current model counts as an upgrade', () => {
  assert.equal(decideModel({ judge: { tier: 'fast', confidence: null }, current: 'opus', risky: false, options: OPTS, models: MODELS }).action, 'keep');
  assert.equal(decideModel({ judge: { tier: 'fast', confidence: 0.4 }, current: 'mystery-1', risky: false, options: OPTS, models: MODELS }).action, 'upgrade');
  assert.equal(decideModel({ judge: { tier: 'fast', confidence: 0.2 }, current: undefined, risky: false, options: OPTS, models: MODELS }).action, 'keep');
});

test('decideModel: the same tier keeps; risky forces the deep tier past both bars', () => {
  assert.equal(decideModel({ judge: { tier: 'balanced', confidence: 0.9 }, current: 'sonnet', risky: false, options: OPTS, models: MODELS }).action, 'keep');
  assert.deepEqual(
    decideModel({ judge: { tier: 'fast', confidence: 0.1 }, current: 'haiku', risky: true, options: OPTS, models: MODELS }),
    { action: 'forced-risk', model: 'opus', reason: 'risky work: deep tier' },
  );
});

const frontier = (confidence, cls, current) =>
  decideModel({ judge: { tier: 'frontier', confidence }, cls, current, risky: false, options: OPTS, models: MODELS });

test('decideModel: the frontier tier needs the design-open class and its own bar', () => {
  assert.deepEqual(frontier(0.7, 'design-open', 'claude-opus-5-5'), { action: 'upgrade', model: 'fable', reason: 'judge: frontier at 0.7' });
  assert.equal(frontier(0.9, 'design-open', 'claude-fable-5-2').action, 'keep');
});

test('decideModel: a frontier answer below its bar or for another class counts as deep', () => {
  assert.deepEqual(frontier(0.6, 'design-open', 'sonnet'), { action: 'upgrade', model: 'opus', reason: 'judge: frontier at 0.6, held to deep' });
  assert.deepEqual(frontier(0.9, 'review-debug', 'opus'), { action: 'keep', reason: 'judge: frontier at 0.9, held to deep' });
  assert.deepEqual(frontier(0.9, null, 'haiku'), { action: 'upgrade', model: 'opus', reason: 'judge: frontier at 0.9, held to deep' });
  assert.equal(frontier(null, 'design-open', 'opus').action, 'keep');
});

test('decideModel: a frontier answer never lowers a start that is above the deep tier', () => {
  assert.deepEqual(frontier(0.9, 'review-debug', 'claude-fable-5-2'), { action: 'keep', reason: 'judge: frontier at 0.9, held to deep' });
  assert.equal(frontier(0.65, 'design-open', 'claude-fable-5-2').action, 'keep');
  const deep = decideModel({ judge: { tier: 'deep', confidence: 0.65 }, cls: 'design-open', current: 'claude-fable-5-2', risky: false, options: OPTS, models: MODELS });
  assert.equal(deep.action, 'downgrade');
});

test('decideModel: without a frontier model a frontier answer counts as deep', () => {
  const d = decideModel({ judge: { tier: 'frontier', confidence: 0.9 }, cls: 'design-open', current: 'sonnet', risky: false, options: OPTS, models: { ...MODELS, frontier: '' } });
  assert.deepEqual(d, { action: 'upgrade', model: 'opus', reason: 'judge: frontier at 0.9, held to deep' });
});

test('decideModel: a fable parent is never lowered below the deep tier by a forced risk', () => {
  const d = decideModel({ judge: null, current: 'claude-fable-5-5', risky: true, options: OPTS, models: MODELS });
  assert.equal(d.action, 'keep');
});

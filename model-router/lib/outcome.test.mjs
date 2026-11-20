import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOutcomes } from './outcome.mjs';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const OPTS = { windowMin: 30, similarityThreshold: 0.5 };
const PROJECT = { id: 'abcd', root: '/repo' };

const spawn = (agentId, min, extra = {}) => ({
  type: 'spawn', ts: at(min), session: 's1', agentId, subagentType: 'general-purpose',
  description: 'Fix the login bug in auth', class: 'edit-specified', risky: false, model: 'claude-sonnet-5-5',
  effort: 'medium', route: 'judge', project: PROJECT, ...extra,
});
const report = (agentId, min, extra = {}) => ({
  type: 'report', ts: at(min), session: 's1', agentId, status: 'completed', model: 'claude-sonnet-5-5',
  effort: 'medium', costUsd: 0.05, tokens: 30000, ...extra,
});
const write = (agentId, min, file) => ({ type: 'signal', kind: 'write', ts: at(min), session: 's1', agentId, file });
const prompt = (min, text) => ({ type: 'signal', kind: 'prompt', ts: at(min), session: 's1', text });
const now = (min) => T0 + min * 60000;

test('a completed task with no rework signal is a success once the window closes', () => {
  const events = [spawn('a1', 0), write('a1', 1, '/repo/src/auth.ts'), report('a1', 2)];
  const open = computeOutcomes(events, { ...OPTS, now: now(10) });
  assert.equal(open.outcomes.length, 0);
  assert.deepEqual([...open.openTasks], ['s1/a1']);
  const { outcomes } = computeOutcomes(events, { ...OPTS, now: now(40) });
  assert.equal(outcomes.length, 1);
  const o = outcomes[0];
  assert.equal(o.type, 'outcome');
  assert.equal(o.task, 's1/a1');
  assert.equal(o.outcome, 'success');
  assert.equal(o.tier, 'sonnet');
  assert.equal(o.effort, 'medium');
  assert.equal(o.class, 'edit-specified');
  assert.equal(o.learn, true);
  assert.equal(o.weak, false);
  assert.equal(o.costUsd, 0.05);
  assert.deepEqual(o.project, PROJECT);
});

test('the end of the session closes the window early', () => {
  const events = [spawn('a1', 0), report('a1', 2), { type: 'session-end', ts: at(3), session: 's1' }];
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(4) }).outcomes[0].outcome, 'success');
});

test('another loop writing one of the same files inside the window is rework', () => {
  const events = [spawn('a1', 0), write('a1', 1, '/repo/src/auth.ts'), report('a1', 2), write(undefined, 10, '/repo/src/auth.ts')];
  const o = computeOutcomes(events, { ...OPTS, now: now(40) }).outcomes[0];
  assert.equal(o.outcome, 'rework');
  assert.match(o.why, /write/);
});

test('a write after the window is not rework', () => {
  const events = [spawn('a1', 0), write('a1', 1, '/repo/src/auth.ts'), report('a1', 2), write(undefined, 40, '/repo/src/auth.ts')];
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(50) }).outcomes[0].outcome, 'success');
});

test('a similar spawn of the same class inside the window is rework (redo or escalation)', () => {
  const events = [spawn('a1', 0), report('a1', 2), spawn('a2', 5, { description: 'Fix login bug in auth again', model: 'claude-opus-5-5' }), report('a2', 8)];
  const out = computeOutcomes(events, { ...OPTS, now: now(60) }).outcomes;
  const a1 = out.find((o) => o.agentId === 'a1');
  assert.equal(a1.outcome, 'rework');
  assert.equal(a1.weak, true, 'a task that wrote nothing is a weak signal');
});

test('a spawn of another class or a different description is not rework', () => {
  const events = [spawn('a1', 0), report('a1', 2), spawn('a2', 5, { class: 'review-debug', description: 'Fix the login bug in auth' }), spawn('a3', 6, { description: 'write release notes' })];
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(60) }).outcomes.find((o) => o.agentId === 'a1').outcome, 'success');
});

test('only the next two prompts count, and only when they are about the task', () => {
  const base = [spawn('a1', 0), write('a1', 1, '/repo/src/auth.ts'), report('a1', 2)];
  const about = computeOutcomes([...base, prompt(3, 'auth.ts still fails')], { ...OPTS, now: now(60) }).outcomes[0];
  assert.equal(about.outcome, 'rework');
  const similar = computeOutcomes([...base, prompt(3, 'the login bug in auth is not fixed')], { ...OPTS, now: now(60) }).outcomes[0];
  assert.equal(similar.outcome, 'rework');
  const other = computeOutcomes([...base, prompt(3, 'thanks'), prompt(4, 'now the docs'), prompt(5, 'auth.ts again')], { ...OPTS, now: now(60) }).outcomes[0];
  assert.equal(other.outcome, 'success');
});

test('failed is failure; a stop not attributed to the parent is cancelled and not learned', () => {
  const failed = computeOutcomes([spawn('a1', 0), report('a1', 2, { status: 'failed' })], { ...OPTS, now: now(60) }).outcomes[0];
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.learn, true);
  const stopped = computeOutcomes([spawn('a1', 0), report('a1', 2, { status: 'stopped' })], { ...OPTS, now: now(60) }).outcomes[0];
  assert.equal(stopped.outcome, 'cancelled');
  assert.equal(stopped.learn, false);
});

test('a stop by the parent followed by rework is failure', () => {
  const events = [
    spawn('a1', 0, { name: 'scout' }), write('a1', 1, '/repo/src/auth.ts'),
    { type: 'signal', kind: 'stop', ts: at(2), session: 's1', target: 'scout' },
    report('a1', 2, { status: 'stopped' }), write(undefined, 5, '/repo/src/auth.ts'),
  ];
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(60) }).outcomes[0].outcome, 'failure');
});

test('risky, unknown class, other models and unknown effort are measured but not learned', () => {
  const run = (s, r = {}) => computeOutcomes([spawn('a1', 0, s), report('a1', 2, r)], { ...OPTS, now: now(60) }).outcomes[0];
  assert.equal(run({ risky: true }).learn, false);
  assert.equal(run({ class: null }).learn, false);
  assert.equal(run({}, { model: 'gpt-x' }).learn, false);
  assert.equal(run({ effort: null }, { effort: null }).learn, false);
});

test('the latest report of a continued agent gives the cost and starts the window', () => {
  const events = [spawn('a1', 0), report('a1', 2, { costUsd: 0.05 }), { type: 'signal', kind: 'resume', ts: at(3), session: 's1', agentId: 'a1' }, report('a1', 4, { costUsd: 0.06 })];
  const out = computeOutcomes(events, { ...OPTS, now: now(33) });
  assert.equal(out.outcomes.length, 0, 'the window counts from the last report');
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(35) }).outcomes[0].costUsd, 0.06);
});

test('a task with no report is closed as cancelled when its session ended or a day passed', () => {
  const ended = computeOutcomes([spawn('a1', 0), { type: 'session-end', ts: at(5), session: 's1' }], { ...OPTS, now: now(6) }).outcomes[0];
  assert.equal(ended.outcome, 'cancelled');
  assert.equal(computeOutcomes([spawn('a1', 0)], { ...OPTS, now: now(60) }).outcomes.length, 0);
  assert.equal(computeOutcomes([spawn('a1', 0)], { ...OPTS, now: now(60 * 25) }).outcomes[0].outcome, 'cancelled');
});

test('tasks already closed are skipped', () => {
  const events = [spawn('a1', 0), report('a1', 2)];
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(60), done: new Set(['s1/a1']) }).outcomes.length, 0);
});

test('signals from another session do not count', () => {
  const events = [spawn('a1', 0), write('a1', 1, '/repo/x.ts'), report('a1', 2), { ...write(undefined, 5, '/repo/x.ts'), session: 's2' }];
  assert.equal(computeOutcomes(events, { ...OPTS, now: now(60) }).outcomes[0].outcome, 'success');
});

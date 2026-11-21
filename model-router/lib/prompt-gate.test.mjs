import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptGate } from './prompt-gate.mjs';

const MIN = 60000;

test('no prompt is kept before a subagent of the session has reported', () => {
  const gate = promptGate(30);
  assert.equal(gate.shouldRecord(0), false);
});

test('after a report, the next two prompts inside the window are kept and the third is not', () => {
  const gate = promptGate(30);
  gate.reported(0);
  assert.deepEqual([gate.shouldRecord(1 * MIN), gate.shouldRecord(2 * MIN), gate.shouldRecord(3 * MIN)], [true, true, false]);
});

test('a prompt after the rework window is not kept', () => {
  const gate = promptGate(30);
  gate.reported(0);
  assert.equal(gate.shouldRecord(30 * MIN), true, 'the window includes its end');
  assert.equal(gate.shouldRecord(31 * MIN), false);
});

test('each report opens the window again with two prompts', () => {
  const gate = promptGate(30);
  gate.reported(0);
  gate.shouldRecord(1 * MIN);
  gate.shouldRecord(2 * MIN);
  gate.reported(5 * MIN);
  assert.deepEqual([gate.shouldRecord(6 * MIN), gate.shouldRecord(7 * MIN), gate.shouldRecord(8 * MIN)], [true, true, false]);
});

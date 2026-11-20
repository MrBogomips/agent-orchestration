import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';
import { ORIGIN_LINE, isFromAnotherSession, markContext, markText } from './origin.mjs';

const child = readRole({ role: 'child', master: 'hub' });

test('the person and the session itself are not another session', () => {
  for (const kind of ['composer', 'bridge', 'sdk', 'auto-continuation', 'plugin', 'task-notification', 'scheduled-trigger']) {
    assert.equal(isFromAnotherSession(kind), false, kind);
  }
});

test('peers, coordinators, relays, channels and unknown kinds are another session', () => {
  for (const kind of ['peer', 'peer-send-message', 'coordinator', 'projects-relay', 'channel', 'unclassified', 'new-kind', undefined]) {
    assert.equal(isFromAnotherSession(kind), true, String(kind));
  }
});

test('the line says information, not authorization', () => {
  assert.match(ORIGIN_LINE, /^\[session-hub\]/);
  assert.match(ORIGIN_LINE, /information, not authorization/);
});

test('markText prefixes a delivery to a child once', () => {
  const marked = markText({ role: child, kind: 'peer', text: 'do X' });
  assert.equal(marked, `${ORIGIN_LINE}\n\ndo X`);
  assert.equal(markText({ role: child, kind: 'peer', text: marked }), marked);
});

test('markText leaves the person and non-children alone', () => {
  assert.equal(markText({ role: child, kind: 'composer', text: 'do X' }), 'do X');
  assert.equal(markText({ role: readRole({}), kind: 'peer', text: 'do X' }), 'do X');
});

test('marking does not depend on the guards switch: it is information for the model', () => {
  const role = readRole({ role: 'child', master: 'hub', guards: 'off' });
  assert.notEqual(markText({ role, kind: 'peer', text: 'x' }), 'x');
});

test('markContext adds the line once to a prompt from another session', () => {
  assert.deepEqual(markContext({ role: child, kind: 'peer', text: 'do X' }), [ORIGIN_LINE]);
  assert.deepEqual(markContext({ role: child, kind: 'peer', text: 'do X', context: ['a'] }), ['a', ORIGIN_LINE]);
});

test('markContext adds nothing when the text or the context already carries the line', () => {
  assert.equal(markContext({ role: child, kind: 'peer', text: `${ORIGIN_LINE}\n\ndo X` }), undefined);
  assert.equal(markContext({ role: child, kind: 'peer', text: 'x', context: [ORIGIN_LINE] }), undefined);
});

test('markContext adds nothing for the person, outside a child', () => {
  assert.equal(markContext({ role: child, kind: 'composer', text: 'x' }), undefined);
  assert.equal(markContext({ role: readRole({}), kind: 'peer', text: 'x' }), undefined);
});

test('a coordinator delivery with no teammate is the child\'s own main conversation and is not marked', () => {
  assert.equal(markText({ role: child, kind: 'coordinator', text: 'do X' }), 'do X');
  assert.notEqual(markText({ role: child, kind: 'coordinator', teammate: 'team-lead', text: 'do X' }), 'do X');
});

test('at prompt.submit a coordinator is another session\'s hand-off and is marked', () => {
  assert.deepEqual(markContext({ role: child, kind: 'coordinator', text: 'do X' }), [ORIGIN_LINE]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TEXT, OUTBOX_FILE, outboxDir, outboxEntry, readOutboxMessage, undeliveredText } from './outbox.mjs';

const RECORD = '/Users/u/.claude/session-hub/children-0123456789abcdef.json';
const DIR = '/Users/u/.claude/session-hub/children-0123456789abcdef.outbox';

test('the outbox sits next to the children record', () => {
  assert.equal(outboxDir(RECORD), DIR);
  assert.equal(outboxDir(` ${RECORD} `), DIR);
  assert.equal(outboxDir('C:/Users/u/.claude/session-hub/children-1.json'), 'C:/Users/u/.claude/session-hub/children-1.outbox');
});

test('no outbox for a missing, relative or non-JSON record path', () => {
  for (const path of [undefined, '', 'children.json', './c.json', '/a/children.txt', '/.json']) {
    assert.equal(outboxDir(path), undefined, String(path));
  }
});

test('an entry is one file named by time, sender and a random tail, holding the message', () => {
  const { file, content } = outboxEntry({
    dir: DIR,
    at: '2026-11-25T10:15:00.123Z',
    sessionId: 'eaf079d2-bf83-49c3-aec8-8ab8e8562d76',
    nonce: 'K3X9',
    master: 'hub-a8',
    reason: 'No agent named hub-a8 is reachable.',
    text: '[T-42 product] done: PR #12',
  });
  assert.equal(file, `${DIR}/20261125T101500Z-eaf079d2-k3x9.json`);
  assert.match(file.slice(DIR.length + 1), OUTBOX_FILE);
  assert.deepEqual(JSON.parse(content), {
    version: 1,
    at: '2026-11-25T10:15:00.123Z',
    from: { sessionId: 'eaf079d2-bf83-49c3-aec8-8ab8e8562d76' },
    to: 'hub-a8',
    reason: 'No agent named hub-a8 is reachable.',
    text: '[T-42 product] done: PR #12',
  });
});

test('a sender id or tail with odd characters cannot leave the folder', () => {
  const { file } = outboxEntry({ dir: DIR, at: '2026-11-25T10:15:00Z', sessionId: '../../x', nonce: '/..', master: 'm', text: 't' });
  assert.equal(file, `${DIR}/20261125T101500Z-x-0.json`);
});

test('a very long message is cut, and the cut is said', () => {
  const { content } = outboxEntry({ dir: DIR, at: '2026-11-25T10:15:00Z', nonce: 'a', master: 'm', text: 'x'.repeat(MAX_TEXT + 5) });
  const message = JSON.parse(content);
  assert.equal(message.text.length, MAX_TEXT);
  assert.equal(message.cut, MAX_TEXT + 5);
  assert.deepEqual(message.from, { sessionId: null });
});

test('the master reads a message back, and a broken file is reported, not thrown', () => {
  const { content } = outboxEntry({ dir: DIR, at: '2026-11-25T10:15:00Z', sessionId: 's1', nonce: 'a', master: 'm', text: 'hello' });
  assert.deepEqual(readOutboxMessage('f.json', content), {
    file: 'f.json',
    at: '2026-11-25T10:15:00Z',
    from: 's1',
    to: 'm',
    reason: null,
    text: 'hello',
  });
  assert.match(readOutboxMessage('g.json', '{').error, /not valid JSON/);
  assert.equal(readOutboxMessage('h.json', '{"a":1}').error, 'not an outbox message');
});

test('the answer to the child says where the message went, or to keep it when it could not be saved', () => {
  const saved = undeliveredText({ master: 'hub-a8', reason: 'Not sent: no agent named hub-a8', saved: `${DIR}/f.json` });
  assert.match(saved, /^\[session-hub\] The master "hub-a8" could not be reached \(no agent named hub-a8\)\./);
  assert.match(saved, /saved in the master's outbox/);
  assert.match(saved, /do not send it again in a loop/);
  const lost = undeliveredText({ master: 'hub-a8', error: 'EACCES' });
  assert.match(lost, /could not be saved in the outbox either \(EACCES\)/);
  assert.match(lost, /keep the whole message in your reply/);
});

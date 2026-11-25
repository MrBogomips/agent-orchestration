import { test } from 'node:test';
import assert from 'node:assert/strict';

import { outboxNote, recordedMaster, renameNotice, selfFromListing } from './master-rename.mjs';

const LISTING =
  'This session is CTX-PROJ-Reviewing-PRClusters [0d9bc5] — the name other sessions use to message it.\n\nPeer sessions (1):\n  t42-product [aaaaaa]';
const SESSION = '0d9bc5aa-1111-2222-3333-444455556666';
const record = (master, statuses = ['running']) => ({
  master,
  children: statuses.map((status, i) => ({ name: `c${i}`, status })),
});

test('selfFromListing reads this session name and ref from the ListAgents header', () => {
  assert.deepEqual(selfFromListing({ result: { listing: LISTING } }), { name: 'CTX-PROJ-Reviewing-PRClusters', ref: '0d9bc5' });
  assert.deepEqual(selfFromListing({ listing: 'This session is my hub [ab12] — x' }), { name: 'my hub', ref: 'ab12' });
  assert.equal(selfFromListing({ listing: 'Peer sessions (0)' }), undefined);
  assert.equal(selfFromListing(undefined), undefined);
});

test('recordedMaster reads the master identity of a record', () => {
  assert.deepEqual(recordedMaster({ master: { name: 'hub-a8', ref: '0d9bc5', sessionId: SESSION } }), {
    name: 'hub-a8',
    ref: '0d9bc5',
    sessionId: SESSION,
  });
  assert.equal(recordedMaster({ master: { ref: 'x' } }), undefined);
  assert.equal(recordedMaster({}), undefined);
});

test('no notice when the name is unchanged, unknown, or no child is live', () => {
  const master = { name: 'hub-a8', sessionId: SESSION };
  assert.equal(renameNotice({ record: record(master), current: { name: 'hub-a8' }, sessionId: SESSION }), undefined);
  assert.equal(renameNotice({ record: record(master), current: undefined, sessionId: SESSION }), undefined);
  assert.equal(renameNotice({ record: record(undefined), current: { name: 'x' }, sessionId: SESSION }), undefined);
  assert.equal(renameNotice({ record: record(master, ['done', 'lost']), current: { name: 'x' }, sessionId: SESSION }), undefined);
});

test('renamed, with children pinned to this session id: they still reach it', () => {
  const notice = renameNotice({
    record: record({ name: 'hub-a8', sessionId: SESSION }, ['running', 'waiting-user', 'done']),
    current: { name: 'CTX-PROJ' },
    sessionId: SESSION,
  });
  assert.equal(notice.name, 'CTX-PROJ');
  assert.match(notice.text, /renamed from "hub-a8" to "CTX-PROJ" while 2 children run/);
  assert.match(notice.text, /still reach it/);
});

test('renamed, with children not pinned to this session: they cannot reach it, and the way back is given', () => {
  for (const sessionId of [undefined, 'another-session']) {
    const notice = renameNotice({ record: record({ name: 'hub-a8', sessionId }), current: { name: 'CTX-PROJ' }, sessionId: SESSION });
    assert.match(notice.text, /while 1 child run/);
    assert.match(notice.text, /can no longer reach it/);
    assert.match(notice.text, /\/rename hub-a8/);
    assert.match(notice.text, /outbox/);
  }
});

test('outboxNote counts the waiting messages', () => {
  assert.equal(outboxNote(0), undefined);
  assert.equal(outboxNote(undefined), undefined);
  assert.equal(outboxNote(1), '1 message from a child waits in the outbox: read it with session-hub:dispatch.');
  assert.match(outboxNote(3), /^3 messages from children wait in the outbox: read them/);
});

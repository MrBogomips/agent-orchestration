import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';
import { judgeSend, liveMaster, recipientName, recipientRef } from './send-guard.mjs';

const child = readRole({ role: 'child', master: 'hub' });

test('recipientName drops a trailing ref', () => {
  assert.equal(recipientName('hub [8f2c1a]'), 'hub');
  assert.equal(recipientName('  hub  '), 'hub');
  assert.equal(recipientName('my session [ab12]'), 'my session');
  assert.equal(recipientName('uds:/tmp/cc-socks/1.sock'), 'uds:/tmp/cc-socks/1.sock');
});

test('outside a child, every send is delivered', () => {
  assert.deepEqual(judgeSend({ role: readRole({}), to: 'anyone' }), { deliver: true });
});

test('with guards off, a child may send anywhere', () => {
  const role = readRole({ role: 'child', master: 'hub', guards: 'off' });
  assert.deepEqual(judgeSend({ role, to: 'sibling' }), { deliver: true });
});

const toMaster = (to, sessionId) => (sessionId ? { deliver: true, toMaster: true, to, sessionId } : { deliver: true, toMaster: true, to });

test('a child may message its master, by name or name and ref', () => {
  assert.deepEqual(judgeSend({ role: child, to: 'hub' }), toMaster('hub'));
  assert.deepEqual(judgeSend({ role: child, to: 'hub [8f2c1a]' }), toMaster('hub'));
});

test('a child may not message a sibling; the reason points to the master', () => {
  const verdict = judgeSend({ role: child, to: 't43-docs' });
  assert.equal(verdict.deliver, false);
  assert.match(verdict.reason, /^\[session-hub\]/);
  assert.match(verdict.reason, /"hub"/);
  assert.match(verdict.reason, /out-of-scope/);
});

test('a socket or bridge address is refused, even if it may be the master: use the name', () => {
  for (const to of ['uds:/tmp/cc-socks/70368.sock', 'bridge:session_123']) {
    const verdict = judgeSend({ role: child, to });
    assert.equal(verdict.deliver, false, to);
    assert.match(verdict.reason, /by its name/);
  }
});

test('a name that only contains the master name is refused', () => {
  assert.equal(judgeSend({ role: child, to: 'hub2' }).deliver, false);
  assert.equal(judgeSend({ role: child, to: 'HUB' }).deliver, false);
});

test('the session may message its own subagents and teammates, by id or name', () => {
  const agents = [{ id: 'a1b2', name: 'worker' }, { id: 'c3d4' }];
  assert.deepEqual(judgeSend({ role: child, to: 'a1b2', agents }), { deliver: true });
  assert.deepEqual(judgeSend({ role: child, to: 'worker', agents }), { deliver: true });
  assert.equal(judgeSend({ role: child, to: 'other', agents }).deliver, false);
});

test('a subagent may message its own main loop', () => {
  assert.deepEqual(judgeSend({ role: child, to: 'main', agentId: 'a1b2' }), { deliver: true });
  assert.equal(judgeSend({ role: child, to: 'main' }).deliver, false);
});

test('a child with no master refuses every session and says why', () => {
  const verdict = judgeSend({ role: readRole({ role: 'child' }), to: 'hub' });
  assert.equal(verdict.deliver, false);
  assert.match(verdict.reason, /SESSION_HUB_MASTER/);
});

test('an invalid role refuses every send (fails closed)', () => {
  const verdict = judgeSend({ role: readRole({ role: 'chlid' }), to: 'hub' });
  assert.equal(verdict.deliver, false);
  assert.match(verdict.reason, /SESSION_HUB_ROLE/);
});

test('an empty or missing recipient is refused', () => {
  assert.equal(judgeSend({ role: child, to: '' }).deliver, false);
  assert.equal(judgeSend({ role: child, to: undefined }).deliver, false);
});

test('a name with a ref is delivered to the bare name, so a foreign ref cannot pick another session', () => {
  assert.deepEqual(judgeSend({ role: child, to: 'hub [ffffff]' }), toMaster('hub'));
  assert.deepEqual(judgeSend({ role: child, to: 'hub' }), toMaster('hub'));
});

// The master pinned by ref and session id (#97): `hub-a8` [0d9bc5] renamed to `CTX-Reviewing` after the spawn.
const SESSION = '0d9bc5aa-1111-2222-3333-444455556666';
const pinned = readRole({ role: 'child', master: 'hub-a8', masterRef: '0d9bc5', masterSessionId: SESSION });
const refOnly = readRole({ role: 'child', master: 'hub-a8', masterRef: '0d9bc5' });
const renamed = [{ name: 'other', ref: 'aaaaaa' }, { name: 'CTX-Reviewing', ref: '0d9bc5' }];

test('recipientRef reads a trailing ref', () => {
  assert.equal(recipientRef('hub [8f2c1a]'), '8f2c1a');
  assert.equal(recipientRef('hub'), undefined);
});

test('liveMaster is the live session that holds the master ref', () => {
  assert.deepEqual(liveMaster(pinned, renamed), { name: 'CTX-Reviewing', ref: '0d9bc5' });
  assert.equal(liveMaster(pinned, [{ name: 'other', ref: 'aaaaaa' }]), undefined);
  assert.equal(liveMaster(pinned, undefined), undefined);
  assert.equal(liveMaster(child, renamed), undefined);
});

test('after a rename, the stale name still reaches the master, by session id and its current name', () => {
  assert.deepEqual(judgeSend({ role: pinned, to: 'hub-a8', live: renamed }), toMaster('CTX-Reviewing', SESSION));
  assert.deepEqual(judgeSend({ role: refOnly, to: 'hub-a8', live: renamed }), toMaster('CTX-Reviewing'));
});

test('the new name, with or without the ref, reaches the master', () => {
  assert.deepEqual(judgeSend({ role: pinned, to: 'CTX-Reviewing [0d9bc5]', live: renamed }), toMaster('CTX-Reviewing', SESSION));
  assert.deepEqual(judgeSend({ role: refOnly, to: 'CTX-Reviewing', live: renamed }), toMaster('CTX-Reviewing'));
});

test('a bare ref of the master reaches the master', () => {
  assert.deepEqual(judgeSend({ role: pinned, to: '0d9bc5', live: renamed }), toMaster('CTX-Reviewing', SESSION));
  assert.deepEqual(judgeSend({ role: pinned, to: '0d9bc5' }), toMaster('hub-a8', SESSION));
});

test('any name with the master ref reaches the master', () => {
  assert.deepEqual(judgeSend({ role: refOnly, to: 'whatever [0d9bc5]', live: renamed }), toMaster('CTX-Reviewing'));
});

test('a foreign ref, bare or with a name, stays refused', () => {
  for (const to of ['aaaaaa', 'other [aaaaaa]', 'other']) {
    const verdict = judgeSend({ role: pinned, to, live: renamed });
    assert.equal(verdict.deliver, false, to);
  }
});

test('with the master not live (restarted or ended), the message goes by session id, else its first name', () => {
  assert.deepEqual(judgeSend({ role: pinned, to: 'hub-a8', live: [] }), toMaster('hub-a8', SESSION));
  assert.deepEqual(judgeSend({ role: refOnly, to: 'hub-a8', live: [] }), toMaster('hub-a8'));
});

test('a refusal after a rename names the master both ways and says the first name still works', () => {
  const verdict = judgeSend({ role: pinned, to: 'sibling', live: renamed });
  assert.equal(verdict.deliver, false);
  assert.match(verdict.reason, /"hub-a8" \(now named "CTX-Reviewing"\)/);
  assert.match(verdict.reason, /Send what you need to "hub-a8"/);
  assert.match(verdict.reason, /even if the master was renamed/);
});

test('without the ref, the current name of the master is not known and is refused', () => {
  assert.equal(judgeSend({ role: child, to: 'CTX-Reviewing', live: renamed }).deliver, false);
});

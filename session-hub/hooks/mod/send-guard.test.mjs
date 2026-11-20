import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';
import { judgeSend, recipientName } from './send-guard.mjs';

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

test('a child may message its master, by name or name and ref', () => {
  assert.deepEqual(judgeSend({ role: child, to: 'hub' }), { deliver: true });
  assert.deepEqual(judgeSend({ role: child, to: 'hub [8f2c1a]' }), { deliver: true, to: 'hub' });
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
  assert.deepEqual(judgeSend({ role: child, to: 'hub [ffffff]' }), { deliver: true, to: 'hub' });
  assert.deepEqual(judgeSend({ role: child, to: 'hub' }), { deliver: true });
});

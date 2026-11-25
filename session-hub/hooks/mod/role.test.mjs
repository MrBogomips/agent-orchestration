import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';

test('no role variable: the session has no role and the guards stay out of the way', () => {
  const role = readRole({});
  assert.equal(role.kind, 'none');
  assert.equal(role.guarding, false);
});

test('none and master values are not a child', () => {
  for (const value of ['none', ' Master ', '']) assert.equal(readRole({ role: value }).kind, 'none', value);
});

test('a child reads its master, root, handoff and record; guards are on by default', () => {
  const role = readRole({
    role: ' Child ',
    master: ' hub ',
    masterRef: ' 8f2c1a ',
    masterSessionId: ' 0d9bc5aa-1111-2222-3333-444455556666 ',
    scopeRoot: '/r/product',
    handoff: '/h/t42.md',
    registry: '/c/children.json',
  });
  assert.deepEqual(role, {
    kind: 'child',
    guarding: true,
    guardsOff: false,
    master: 'hub',
    masterRef: '8f2c1a',
    masterSessionId: '0d9bc5aa-1111-2222-3333-444455556666',
    scopeRoot: '/r/product',
    handoff: '/h/t42.md',
    registry: '/c/children.json',
    raw: ' Child ',
  });
});

test('guards off turns guarding off, in any case', () => {
  const role = readRole({ role: 'child', master: 'hub', guards: ' OFF ' });
  assert.equal(role.kind, 'child');
  assert.equal(role.guardsOff, true);
  assert.equal(role.guarding, false);
});

test('an unknown role value is invalid and guarding (fails closed)', () => {
  const role = readRole({ role: 'chlid' });
  assert.equal(role.kind, 'invalid');
  assert.equal(role.guarding, true);
});

test('an unknown role value with guards off is not guarding', () => {
  assert.equal(readRole({ role: 'chlid', guards: 'off' }).guarding, false);
});

test('a child without a master is still a child: the guard refuses with a reason', () => {
  const role = readRole({ role: 'child' });
  assert.equal(role.kind, 'child');
  assert.equal(role.master, undefined);
});

test('a child started before the master pin has neither its ref nor its session id', () => {
  const role = readRole({ role: 'child', master: 'hub', masterRef: ' ', masterSessionId: '' });
  assert.equal(role.masterRef, undefined);
  assert.equal(role.masterSessionId, undefined);
});

test('the result is frozen', () => {
  assert.ok(Object.isFrozen(readRole({ role: 'child' })));
});

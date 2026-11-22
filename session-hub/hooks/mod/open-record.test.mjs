import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_HOTKEY, LOG_KEY, LOG_LABEL, failText, openerArgv, recordPlan, recordSource } from './open-record.mjs';

const RECORD = '/home/u/.claude/session-hub/children-0123456789abcdef.json';

test('the opener is the platform\'s own, with the path as one argument', () => {
  assert.deepEqual(openerArgv('macos', RECORD), ['open', '-t', RECORD]);
  assert.deepEqual(openerArgv('linux', RECORD), ['xdg-open', RECORD]);
  assert.deepEqual(openerArgv('macos', '/a b/$(x);y.json'), ['open', '-t', '/a b/$(x);y.json']);
});

test('no opener for another platform, or for a path that is not absolute', () => {
  for (const platform of ['windows', 'wsl', 'unknown', undefined, 'toString']) assert.equal(openerArgv(platform, RECORD), null);
  assert.equal(openerArgv('macos', '-R'), null);
  assert.equal(openerArgv('macos', 'children.json'), null);
  assert.equal(openerArgv('linux', undefined), null);
});

test('where the record is: a child has its master\'s, a master its own or the default of its hub', () => {
  assert.deepEqual(recordSource({ role: { kind: 'child', registry: RECORD }, master: { isMaster: false }, cwd: '/w' }), { file: RECORD });
  assert.deepEqual(recordSource({ role: { kind: 'child' }, master: { isMaster: false }, cwd: '/w' }), {
    none: 'This child was started without SESSION_HUB_REGISTRY: open the children record from its master.',
  });
  assert.deepEqual(recordSource({ role: { kind: 'invalid' }, master: { isMaster: false }, cwd: '/w' }), {
    none: 'This session has an unknown session-hub role: there is no children record to open.',
  });
  assert.deepEqual(recordSource({ role: { kind: 'none' }, master: { isMaster: true, record: RECORD, hub: '/hub' }, cwd: '/w' }), { file: RECORD });
  assert.deepEqual(recordSource({ role: { kind: 'none' }, master: { isMaster: true, hub: '/hub' }, cwd: '/w' }), { hub: '/hub' });
  assert.deepEqual(recordSource({ role: { kind: 'none' }, master: { isMaster: false }, cwd: '/w' }), { hub: '/w' });
});

test('an existing record is opened, and the line names it', () => {
  assert.deepEqual(recordPlan({ file: RECORD, exists: true, platform: 'macos' }), {
    target: RECORD,
    argv: ['open', '-t', RECORD],
    text: `Children record opened: ${RECORD}`,
  });
  assert.deepEqual(recordPlan({ file: RECORD, exists: true, platform: 'linux' }).argv, ['xdg-open', RECORD]);
});

test('with no record yet nothing is opened and the line says so', () => {
  assert.deepEqual(recordPlan({ file: RECORD, exists: false, platform: 'macos' }), {
    target: RECORD,
    argv: null,
    text: `No children record yet: ${RECORD} is written when the first child starts.`,
  });
});

test('where nothing can be opened the line gives the path and why', () => {
  const hosted = recordPlan({ file: RECORD, exists: true, platform: 'linux', isHosted: true });
  assert.equal(hosted.argv, null);
  assert.equal(hosted.text, `The children record is at ${RECORD} (not opened: this session runs on a hosted machine)`);
  assert.equal(recordPlan({ file: RECORD, exists: true, platform: 'windows' }).text, `The children record is at ${RECORD} (not opened: no opener known for windows)`);
  assert.match(recordPlan({ file: RECORD, exists: true }).text, /no opener known for this system\)$/);
});

test('a failed open is one line with the path and the reason', () => {
  const plan = recordPlan({ file: RECORD, exists: true, platform: 'macos' });
  assert.equal(failText(plan, 'The file does not exist.\nmore'), `Could not open ${RECORD}: The file does not exist.`);
  assert.equal(failText(plan, ''), `Could not open ${RECORD}: the opener failed`);
  assert.equal(failText(plan, 'x'.repeat(500)).length, `Could not open ${RECORD}: `.length + 200);
});

test('the control is named once for both renderings', () => {
  assert.deepEqual([LOG_KEY, LOG_HOTKEY, LOG_LABEL], ['log', 'l', 'Log']);
});

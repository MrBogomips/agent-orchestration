import { test } from 'node:test';
import assert from 'node:assert/strict';

import { identityMismatch, masterConfigDir, mismatchText, ownConfigDir } from './identity.mjs';

const RECORD = '/profiles/work/.claude/session-hub/children-0123456789abcdef.json';
const child = (registry = RECORD) => ({ kind: 'child', registry });

test('the default record path gives the master configuration folder', () => {
  assert.equal(masterConfigDir(RECORD), '/profiles/work/.claude');
  assert.equal(masterConfigDir(` ${RECORD} `), '/profiles/work/.claude');
});

test('a record at a path of the hub own choice says nothing about the master', () => {
  for (const path of ['/data/records/hub.json', '/x/session-hub/children.json', 'session-hub/children-0123456789abcdef.json', '', undefined]) {
    assert.equal(masterConfigDir(path), undefined);
  }
});

test('the own folder is CLAUDE_CONFIG_DIR, a leading ~ expanded, else ~/.claude', () => {
  assert.equal(ownConfigDir({ configDir: '/profiles/work/.claude/', home: '/Users/me' }), '/profiles/work/.claude');
  assert.equal(ownConfigDir({ configDir: '~/alt', home: '/Users/me' }), '/Users/me/alt');
  assert.equal(ownConfigDir({ home: '/Users/me' }), '/Users/me/.claude');
  assert.equal(ownConfigDir({ configDir: 'relative', home: '/Users/me' }), undefined);
  assert.equal(ownConfigDir({}), undefined);
});

test('a child in the folder of its master has no mismatch', async () => {
  assert.equal(await identityMismatch({ role: child(), configDir: '/profiles/work/.claude', home: '/profiles/work' }), undefined);
  assert.equal(await identityMismatch({ role: child(), home: '/profiles/work' }), undefined);
});

test('a child started without the identity of its master is told apart', async () => {
  const mismatch = await identityMismatch({ role: child(), home: '/Users/me' });
  assert.deepEqual(mismatch, { own: '/Users/me/.claude', master: '/profiles/work/.claude' });
  assert.match(mismatchText(mismatch), /^\[session-hub\] /);
  assert.match(mismatchText(mismatch), /\/Users\/me\/\.claude/);
  assert.match(mismatchText(mismatch), /\/profiles\/work\/\.claude/);
});

test('two paths to the same folder are no mismatch', async () => {
  const realpath = (path) => path.replace('/link', '/profiles/work');
  assert.equal(await identityMismatch({ role: child(), configDir: '/link/.claude', home: '/Users/me', realpath }), undefined);
});

test('it says nothing when it cannot tell: no role, a custom record, a folder that does not resolve', async () => {
  assert.equal(await identityMismatch({ role: { kind: 'none' }, home: '/Users/me' }), undefined);
  assert.equal(await identityMismatch({ role: child('/data/hub.json'), home: '/Users/me' }), undefined);
  assert.equal(await identityMismatch({ role: child(), home: undefined }), undefined);
  const realpath = () => {
    throw new Error('EACCES');
  };
  assert.equal(await identityMismatch({ role: child(), home: '/Users/me', realpath }), undefined);
});

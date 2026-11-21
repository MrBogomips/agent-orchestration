import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRootFolder, checkRootSetting } from './write-root.mjs';

test('the setting must be an absolute path', () => {
  assert.equal(checkRootSetting('/w/repo'), '/w/repo');
  assert.throws(() => checkRootSetting(undefined), /SESSION_HUB_SCOPE_ROOT is not set/);
  assert.throws(() => checkRootSetting(''), /SESSION_HUB_SCOPE_ROOT is not set/);
  assert.throws(() => checkRootSetting('repo'), /SESSION_HUB_SCOPE_ROOT is not an absolute path \(repo\)/);
});

test('the folder must exist, be a folder, and be neither / nor the home folder', () => {
  const ok = { raw: '/w/repo', real: '/w/repo', kind: 'dir', home: '/Users/me' };
  assert.equal(checkRootFolder(ok), '/w/repo');
  assert.equal(checkRootFolder({ ...ok, home: undefined }), '/w/repo');
  assert.throws(() => checkRootFolder({ ...ok, kind: 'missing' }), /does not exist \(\/w\/repo\)/);
  assert.throws(() => checkRootFolder({ ...ok, kind: 'other' }), /is not a directory \(\/w\/repo\)/);
  assert.throws(() => checkRootFolder({ ...ok, real: '/' }), /too wide \(\/w\/repo\): a write root may not be \/ or the home folder/);
  assert.throws(() => checkRootFolder({ ...ok, real: '/Users/me' }), /too wide/);
});

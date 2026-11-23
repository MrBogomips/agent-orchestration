import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRootFolder, checkRootSetting, isRootSettings } from './write-root.mjs';

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

// Issue #89: a Windows write root was refused because it does not start with /.
test('a Windows path is an absolute setting', () => {
  for (const root of ['C:\\Users\\me\\repo', 'C:/Users/me/repo', 'd:\\work', '\\\\server\\share\\repo']) {
    assert.equal(checkRootSetting(root), root);
  }
  for (const root of ['C:repo', 'repo\\sub', '.\\repo']) {
    assert.throws(() => checkRootSetting(root), /is not an absolute path/, root);
  }
});

test('a drive root is too wide', () => {
  const ok = { raw: 'C:\\', real: 'C:\\', kind: 'dir' };
  assert.throws(() => checkRootFolder(ok), /too wide/);
  assert.throws(() => checkRootFolder({ ...ok, real: 'C:/' }), /too wide/);
  assert.equal(checkRootFolder({ ...ok, raw: 'C:\\w', real: 'C:\\w' }), 'C:\\w');
});

test('the repository settings are found with Windows separators', () => {
  assert.equal(isRootSettings('C:\\w\\repo\\.claude\\settings.json', 'C:\\w\\repo'), true);
  assert.equal(isRootSettings('C:\\w\\repo\\.claude\\settings.local.json', 'C:/w/repo/'), true);
  assert.equal(isRootSettings('C:\\w\\repo\\src\\settings.json', 'C:\\w\\repo'), false);
  assert.equal(isRootSettings('/w/repo/.claude/settings.json', '/w/repo/'), true);
  assert.equal(isRootSettings('/.claude/settings.json', '/'), true);
});

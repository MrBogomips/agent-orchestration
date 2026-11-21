import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingBumps, attributionIn, compareSemver } from './pr-checks.mjs';

const PLUGINS = ['alpha', 'beta'];

test('a plugin whose files changed needs a higher version', () => {
  const changed = ['alpha/lib/x.mjs', 'README.md', 'site/build.mjs'];
  assert.deepEqual(missingBumps({ plugins: PLUGINS, changed, before: { alpha: '1.0.0', beta: '2.0.0' }, after: { alpha: '1.0.0', beta: '2.0.0' } }),
    ['alpha: files changed but version 1.0.0 was not bumped']);
  assert.deepEqual(missingBumps({ plugins: PLUGINS, changed, before: { alpha: '1.0.0' }, after: { alpha: '1.0.1' } }), []);
});

test('a lower version is not a bump, and a new plugin needs none', () => {
  assert.deepEqual(missingBumps({ plugins: PLUGINS, changed: ['beta/a'], before: { beta: '2.1.0' }, after: { beta: '2.0.9' } }),
    ['beta: files changed but version 2.0.9 is not above 2.1.0']);
  assert.deepEqual(missingBumps({ plugins: PLUGINS, changed: ['beta/a'], before: {}, after: { beta: '0.1.0' } }), []);
});

test('files outside the plugin folders need no bump', () => {
  assert.deepEqual(missingBumps({ plugins: PLUGINS, changed: ['alphabet/a', 'docs/alpha/b'], before: { alpha: '1.0.0' }, after: { alpha: '1.0.0' } }), []);
});

test('semver comparison', () => {
  assert.ok(compareSemver('1.0.10', '1.0.9') > 0);
  assert.ok(compareSemver('0.4.0', '0.3.99') > 0);
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
});

// The samples are put together at run time, so this file holds no attribution line itself.
const TRAILER = ['Co', 'Authored', 'By'].join('-');
const SERVICE_LINK = ['https://claude', 'ai/code/session_1'].join('.');
const ROBOT = String.fromCodePoint(0x1f916);

test('attribution in commit messages and the pull request text is found', () => {
  const found = attributionIn([
    { where: 'commit abc', text: `fix: x\n\n${TRAILER}: Someone <a@b>` },
    { where: 'commit def', text: `docs: y\n\nSee ${SERVICE_LINK}` },
    { where: 'pull request body', text: `Summary.\n\n${ROBOT} made with a tool` },
    { where: 'commit ok', text: 'fix(model-router): a risky tag counts\n\nPlain text about Claude Code hooks.' },
  ]);
  assert.deepEqual(found.map((f) => f.where), ['commit abc', 'commit def', 'pull request body']);
});

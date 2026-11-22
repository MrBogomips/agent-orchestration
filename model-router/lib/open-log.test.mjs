import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_HOTKEY, LOG_KEY, LOG_LABEL, failText, logPaths, openPlan, openerArgv } from './open-log.mjs';

const DIR = '/home/u/.claude';
const LOG = '/home/u/.claude/model-router/events.jsonl';
const ARCHIVE = '/home/u/.claude/model-router/archive';

test('the log and its archive folder are under the config folder', () => {
  assert.deepEqual(logPaths(DIR), { log: LOG, archive: ARCHIVE });
  assert.deepEqual(logPaths('/home/u/.claude/'), { log: LOG, archive: ARCHIVE });
});

test('the opener is the platform\'s own, with the path as one argument', () => {
  assert.deepEqual(openerArgv('macos', LOG), ['open', LOG]);
  assert.deepEqual(openerArgv('macos', ARCHIVE), ['open', ARCHIVE]);
  assert.deepEqual(openerArgv('linux', LOG), ['xdg-open', LOG]);
  assert.deepEqual(openerArgv('linux', ARCHIVE), ['xdg-open', ARCHIVE]);
  assert.deepEqual(openerArgv('macos', '/a b/$(x);y.jsonl'), ['open', '/a b/$(x);y.jsonl']);
});

test('no opener for another platform, or for a path that is not absolute', () => {
  for (const platform of ['windows', 'wsl', 'unknown', undefined, 'constructor']) assert.equal(openerArgv(platform, LOG), null);
  assert.equal(openerArgv('macos', '-R'), null);
  assert.equal(openerArgv('macos', '~/.claude/x'), null);
  assert.equal(openerArgv('macos', undefined), null);
});

test('the log is opened, and the line names it', () => {
  const plan = openPlan({ configDir: DIR, platform: 'macos', hasLog: true, hasArchive: false });
  assert.deepEqual(plan, { target: LOG, argv: ['open', LOG], text: `Event log opened: ${LOG}` });
});

test('with an archive the line names its folder too', () => {
  const plan = openPlan({ configDir: DIR, platform: 'linux', hasLog: true, hasArchive: true });
  assert.deepEqual(plan.argv, ['xdg-open', LOG]);
  assert.equal(plan.text, `Event log opened: ${LOG} · rotated logs: ${ARCHIVE}`);
});

test('a log that was just rotated opens the archive folder', () => {
  const plan = openPlan({ configDir: DIR, platform: 'macos', hasLog: false, hasArchive: true });
  assert.deepEqual(plan.argv, ['open', ARCHIVE]);
  assert.equal(plan.target, ARCHIVE);
  assert.equal(plan.text, `No event log since the last rotation; archive folder opened: ${ARCHIVE}`);
});

test('with no log yet nothing is opened and the line says so', () => {
  const plan = openPlan({ configDir: DIR, platform: 'macos', hasLog: false, hasArchive: false });
  assert.equal(plan.argv, null);
  assert.equal(plan.target, null);
  assert.equal(plan.text, `No event log yet: ${LOG} is written once a subagent has run with measuring on.`);
});

test('where nothing can be opened the line gives the path and why', () => {
  const hosted = openPlan({ configDir: DIR, platform: 'linux', isHosted: true, hasLog: true, hasArchive: true });
  assert.equal(hosted.argv, null);
  assert.equal(hosted.text, `The event log is at ${LOG} (not opened: this session runs on a hosted machine) · rotated logs: ${ARCHIVE}`);
  const windows = openPlan({ configDir: DIR, platform: 'windows', hasLog: true, hasArchive: false });
  assert.equal(windows.argv, null);
  assert.equal(windows.text, `The event log is at ${LOG} (not opened: no opener known for windows)`);
  const unknown = openPlan({ configDir: DIR, hasLog: true, hasArchive: false });
  assert.match(unknown.text, /no opener known for this system\)$/);
});

test('a failed open is one line with the path and the reason', () => {
  const plan = openPlan({ configDir: DIR, platform: 'macos', hasLog: true, hasArchive: false });
  assert.equal(failText(plan, 'No application knows how to open it.\nmore'), `Could not open ${LOG}: No application knows how to open it.`);
  assert.equal(failText(plan, ''), `Could not open ${LOG}: the opener failed`);
  assert.equal(failText(plan, 'x'.repeat(500)).length, `Could not open ${LOG}: `.length + 200);
});

test('the control is named once for both renderings', () => {
  assert.equal(LOG_KEY, 'log');
  assert.equal(LOG_HOTKEY, 'l');
  assert.equal(LOG_LABEL, 'Log');
});

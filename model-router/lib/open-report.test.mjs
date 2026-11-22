import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_HOTKEY, PAGE_KEY, PAGE_LABEL, REPORT_PANE, hostKind, isGraphical, reportLine } from './open-report.mjs';

const FILE = '/home/u/.claude/model-router/report.html';

test('every surface but the terminal is graphical', () => {
  for (const surface of ['desktop', 'vscode', 'mobile']) assert.equal(isGraphical(surface), true);
  for (const surface of ['terminal', '', null, undefined, 3]) assert.equal(isGraphical(surface), false);
});

test('an attached terminal makes the host a terminal, whatever else is attached', () => {
  assert.equal(hostKind({ surfaces: ['terminal'], entrypoint: 'cli' }), 'terminal');
  assert.equal(hostKind({ surfaces: ['terminal', 'mobile'], entrypoint: 'cli' }), 'terminal');
});

test('with only graphical surfaces attached the host is graphical', () => {
  assert.equal(hostKind({ surfaces: ['desktop'], entrypoint: 'claude-desktop' }), 'graphical');
  assert.equal(hostKind({ surfaces: ['mobile'], entrypoint: 'cli' }), 'graphical');
});

test('with no surface attached yet, an app that hosts the session is graphical; a shell or the SDK is headless', () => {
  assert.equal(hostKind({ surfaces: [], entrypoint: 'claude-desktop' }), 'graphical');
  assert.equal(hostKind({ surfaces: [], entrypoint: 'claude-vscode' }), 'graphical');
  for (const entrypoint of ['cli', 'CLI ', 'sdk-cli', 'sdk-ts', 'sdk-py', '', undefined, null]) {
    assert.equal(hostKind({ surfaces: [], entrypoint }), 'headless', String(entrypoint));
  }
  assert.equal(hostKind({ surfaces: undefined, entrypoint: undefined }), 'headless');
  assert.equal(hostKind(), 'headless');
});

test('the line says where the report was opened, or why the page was not', () => {
  assert.equal(reportLine('pane'), 'Report opened beside the chat.');
  assert.equal(reportLine('browser', FILE), `Report opened in the default browser: ${FILE}`);
  assert.equal(reportLine('none', FILE, 'no opener known for windows\nmore'), `Report written to ${FILE} (not opened: no opener known for windows)`);
  assert.equal(reportLine('none', FILE), `Report written to ${FILE} (not opened: no browser could be opened)`);
});

test('the pane and its page control are named once', () => {
  assert.deepEqual([REPORT_PANE, PAGE_KEY, PAGE_LABEL, PAGE_HOTKEY], ['model-router-report', 'page', 'Open as page', 'o']);
});

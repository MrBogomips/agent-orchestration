import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_SERVER, BROWSER_TOOL, connectRefusal, fileUrl, hasBrowserPane, paneRefusal, reportLine } from './open-report.mjs';

const FILE = '/home/u/.claude/model-router/report.html';

test('the page is addressed as a file URL, its segments encoded', () => {
  assert.equal(fileUrl(FILE), `file://${FILE}`);
  assert.equal(fileUrl('/Users/a b/#1?/r%.html'), 'file:///Users/a%20b/%231%3F/r%25.html');
  assert.equal(fileUrl('report.html'), null);
  assert.equal(fileUrl(undefined), null);
});

test('only the desktop app has a Browser pane', () => {
  assert.equal(hasBrowserPane(['desktop']), true);
  assert.equal(hasBrowserPane(['terminal', 'desktop']), true);
  for (const surfaces of [['terminal'], ['vscode'], ['mobile'], [], undefined, 'desktop']) assert.equal(hasBrowserPane(surfaces), false);
  assert.deepEqual([BROWSER_SERVER, BROWSER_TOOL], ['Claude_Browser', 'preview_start']);
});

test('a connect answer gives a server, or one line saying why not', () => {
  assert.equal(connectRefusal({ isConnected: true, server: 'Claude_Browser' }), null);
  assert.equal(connectRefusal({ isConnected: false, reason: 'unlisted', message: 'No server of that name.\nmore' }), 'unlisted: No server of that name.');
  assert.equal(connectRefusal({ isConnected: true }), 'the Browser pane is not connected');
  assert.equal(connectRefusal(undefined), 'the Browser pane is not connected');
});

test('a tool result that is missing, denied or failed is a refusal', () => {
  assert.equal(paneRefusal({ content: [{ type: 'text', text: 'opened' }], isError: false }), null);
  assert.equal(paneRefusal({ deny: 'A browser tool must be loaded by the model first.' }), 'A browser tool must be loaded by the model first.');
  assert.equal(paneRefusal({ deny: '' }), 'denied');
  assert.equal(paneRefusal({ isError: true, content: [{ type: 'image' }, { type: 'text', text: 'file URLs are not allowed\nsecond' }] }), 'file URLs are not allowed');
  assert.equal(paneRefusal({ isError: true, content: [] }), 'the Browser pane refused the page');
  assert.equal(paneRefusal(undefined), 'the Browser pane gave no answer');
  assert.equal(paneRefusal({ isError: true, content: [{ type: 'text', text: 'x'.repeat(500) }] }).length, 200);
});

test('the line says where the page was opened, or why it was not', () => {
  assert.equal(reportLine('pane', FILE), `Report opened in the Browser pane: ${FILE}`);
  assert.equal(reportLine('browser', FILE), `Report opened in the default browser: ${FILE}`);
  assert.equal(reportLine('none', FILE, 'no opener known for windows'), `Report written to ${FILE} (not opened: no opener known for windows)`);
  assert.equal(reportLine('none', FILE), `Report written to ${FILE} (not opened: no browser could be opened)`);
});

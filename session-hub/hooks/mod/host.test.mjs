import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostKind, isGraphical } from './host.mjs';

test('every surface but the terminal is graphical', () => {
  for (const surface of ['desktop', 'vscode', 'mobile']) assert.equal(isGraphical(surface), true);
  for (const surface of ['terminal', '', null, undefined]) assert.equal(isGraphical(surface), false);
});

test('an attached terminal is a terminal; only graphical surfaces is graphical', () => {
  assert.equal(hostKind({ surfaces: ['terminal', 'mobile'], entrypoint: 'cli' }), 'terminal');
  assert.equal(hostKind({ surfaces: ['desktop'], entrypoint: 'claude-desktop' }), 'graphical');
});

test('with no surface attached yet an app that hosts the session is graphical; a shell or the SDK is headless', () => {
  assert.equal(hostKind({ surfaces: [], entrypoint: 'claude-desktop' }), 'graphical');
  for (const entrypoint of ['cli', 'sdk-cli', 'sdk-ts', '', undefined]) assert.equal(hostKind({ surfaces: [], entrypoint }), 'headless');
  assert.equal(hostKind(), 'headless');
});

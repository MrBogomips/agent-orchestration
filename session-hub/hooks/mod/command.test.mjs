import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpText, parseCommand } from './command.mjs';

test('no argument shows; help asks for the list; anything else is unknown', () => {
  assert.deepEqual(parseCommand(''), { kind: 'show' });
  assert.deepEqual(parseCommand(undefined), { kind: 'show' });
  assert.deepEqual(parseCommand(' HELP '), { kind: 'help' });
  assert.deepEqual(parseCommand('--help'), { kind: 'help' });
  assert.deepEqual(parseCommand('children'), { kind: 'unknown', word: 'children' });
  assert.deepEqual(parseCommand('help me'), { kind: 'unknown', word: 'help' });
});

test('the help starts with the usage line', () => {
  assert.match(helpText(), /^Usage: \/session-hub \[help\]/);
});

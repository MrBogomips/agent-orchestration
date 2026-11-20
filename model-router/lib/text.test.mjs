import { test } from 'node:test';
import assert from 'node:assert/strict';
import { words, jaccard, isSimilar, parseTag, mentionsFile } from './text.mjs';

test('words lowercases, drops stop words, punctuation and the class tag', () => {
  assert.deepEqual(words('[mr:read-search] Find THE config files, for the router!'), ['find', 'config', 'files', 'router']);
});

test('words of empty or non-string input are empty', () => {
  assert.deepEqual(words(''), []);
  assert.deepEqual(words(undefined), []);
});

test('jaccard is the overlap of two word sets', () => {
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(jaccard([], []), 0);
  assert.equal(jaccard(['x', 'x', 'y'], ['y', 'x']), 1);
});

test('isSimilar applies the threshold to the descriptions', () => {
  assert.equal(isSimilar('Fix login bug in auth', 'fix the login bug in auth module', 0.5), true);
  assert.equal(isSimilar('Fix login bug', 'write release notes', 0.5), false);
});

test('parseTag reads the class and the risky marker at the start of a description', () => {
  assert.deepEqual(parseTag('[mr:edit-specified] Add a flag'), { cls: 'edit-specified', risky: false });
  assert.deepEqual(parseTag('  [mr:edit-specified!] Migrate prod'), { cls: 'edit-specified', risky: true });
  assert.deepEqual(parseTag('Add a flag [mr:edit-specified]'), { cls: null, risky: false });
  assert.deepEqual(parseTag('[mr:nonsense] x', ['read-search']), { cls: null, risky: false });
  assert.deepEqual(parseTag(undefined), { cls: null, risky: false });
});

test('mentionsFile finds a written file by its path or its base name', () => {
  assert.equal(mentionsFile('the change in src/auth.ts is wrong', ['/repo/src/auth.ts']), true);
  assert.equal(mentionsFile('look at /repo/src/auth.ts', ['/repo/src/auth.ts']), true);
  assert.equal(mentionsFile('thanks', ['/repo/src/auth.ts']), false);
  assert.equal(mentionsFile('authentication', ['/repo/src/auth.ts']), false);
});

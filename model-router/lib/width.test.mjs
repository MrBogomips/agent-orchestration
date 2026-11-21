import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutToWidth, displayWidth, padEndTo, padStartTo } from './width.mjs';

test('displayWidth counts wide characters and emoji as two columns and combining marks as none', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('山田'), 4);
  assert.equal(displayWidth('プロジェクト'), 12);
  assert.equal(displayWidth('ＡＢ'), 4, 'fullwidth forms');
  assert.equal(displayWidth('🧪'), 2);
  assert.equal(displayWidth('🟢 good'), 7);
  assert.equal(displayWidth('⚪'), 2);
  assert.equal(displayWidth('é'), 1, 'a combining accent takes no column');
  assert.equal(displayWidth('a​b'), 2, 'a zero-width space takes no column');
  assert.equal(displayWidth('█░·–…'), 5);
});

test('cutToWidth cuts by code point and never splits a pair or overflows a wide character', () => {
  assert.equal(cutToWidth('abcdef', 3), 'abc');
  assert.equal(cutToWidth('山田太郎', 5), '山田');
  assert.equal(cutToWidth('a🧪b', 2), 'a');
  assert.equal(cutToWidth('a🧪b', 3), 'a🧪');
  assert.equal(cutToWidth('ab', 0), '');
});

test('padding fills to a width in columns', () => {
  assert.equal(padEndTo('山', 4), '山  ');
  assert.equal(padStartTo('🧪', 4), '  🧪');
  assert.equal(padEndTo('abcdef', 3), 'abcdef', 'a longer text is left as it is');
});

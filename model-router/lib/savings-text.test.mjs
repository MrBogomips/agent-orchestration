import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_TEXT, GROUP_NAMES, LIMITS, judgeText, leftOutText, moveName, qualityWord, savedPhrase, savingText, verdictSentence, verdictTone, weekText,
} from './savings-text.mjs';

const model = (over = {}) => ({
  tasks: 412, savedShare: 0.21, quality: 'holds', qualityGap: 0.02, verdict: 'pays off', reason: null, ...over,
});

test('the verdict says what it rests on, in one sentence', () => {
  assert.equal(verdictSentence(model()), 'A successful task costs 21% less than on the session\'s model, and quality holds.');
  assert.equal(verdictSentence(model({ quality: null })),
    'A successful task costs 21% less than on the session\'s model; quality is not judged with fewer than 5 tasks on a side.');
  assert.equal(verdictSentence(model({ verdict: 'costs more', savedShare: -0.12 })), 'A successful task costs 12% more than on the session\'s model.');
  assert.equal(verdictSentence(model({ verdict: 'not proven', reason: 'too-few', tasks: 1 })), '1 task compared: a verdict needs 100.');
  assert.equal(verdictSentence(model({ verdict: 'not proven', reason: 'within', savedShare: -0.03 })),
    'A successful task costs 3% more than on the session\'s model: within 5%, too close to call.');
  assert.equal(verdictSentence(model({ verdict: 'not proven', reason: 'quality-drops', quality: 'drops', qualityGap: 0.09 })),
    'A successful task costs 21% less, but tasks moved to a cheaper model are right first time 9 points less often than kept ones.');
  assert.equal(verdictSentence(model({ verdict: 'not proven', reason: 'no-success' })), 'No task compared was right first time.');
  assert.equal(verdictSentence(model({ verdict: 'not proven', reason: 'no-cost', savedShare: null })),
    'The tasks compared carry no cost: there is nothing to save on.');
});

test('the note on the baseline says why it is at the FPY of every task compared, in both cases', async () => {
  const { baselineNote } = await import('./savings-text.mjs');
  const few = { tasks: 7, baselineFpyFrom: 'all', groups: { kept: { tasks: 1, fpy: 1 } } };
  const failed = { tasks: 12, baselineFpyFrom: 'all', groups: { kept: { tasks: 6, fpy: 0 } } };
  assert.match(baselineNote(few), /^Fewer than 5 tasks kept on the session's model: the baseline is at the right-first-time rate of every task compared\.$/);
  assert.match(baselineNote(failed), /^None of the 6 tasks kept on the session's model was right first time: the baseline is at the right-first-time rate of every task compared\.$/);
  assert.equal(baselineNote({ ...failed, baselineFpyFrom: 'kept' }), '');
});

test('a verdict reads as a status tone; quality as a word', () => {
  assert.equal(verdictTone('pays off'), 'good');
  assert.equal(verdictTone('costs more'), 'bad');
  assert.equal(verdictTone('not proven'), 'dim');
  assert.equal(qualityWord('holds'), 'holds');
  assert.equal(qualityWord('drops'), 'drops');
  assert.equal(qualityWord(null), 'not judged');
});

test('amounts, moves, the judge and what was left out are written one way', async () => {
  assert.equal(savingText(5.6), '$5.600');
  assert.equal(savingText(-9), '$9.000 more');
  assert.equal(savingText(null), '–');
  assert.equal(savedPhrase(5.6), 'saved $5.600');
  assert.equal(savedPhrase(-9), 'cost $9.000 more');
  const { sharePhrase } = await import('./savings-text.mjs');
  assert.equal(sharePhrase(0.31), '31% saved');
  assert.equal(sharePhrase(-0.14), '14% more');
  assert.equal(sharePhrase(null), '–');
  assert.equal(moveName('opus', 'haiku'), 'Opus to Haiku');
  assert.equal(weekText('2026-11-16'), '16 Nov');
  assert.equal(weekText('nope'), 'nope');
  assert.equal(judgeText({ calls: 31, totalMs: 26000, medianMs: 800 }), '31 calls · 26 s · median 0.8 s');
  assert.equal(judgeText({ calls: 1, totalMs: 700, medianMs: 700 }), '1 call · 0.7 s · median 0.7 s');
  assert.equal(judgeText({ calls: 0, totalMs: 0, medianMs: null }), 'no call');
  assert.equal(leftOutText(0), '');
  assert.equal(leftOutText(366), '366 tasks left out: no session model or no token counts by kind (both recorded from ' +
    'releases 0.6.0 and 0.7.0), or a session tier with too few recent tasks to price.');
  assert.match(leftOutText(1), /^1 task left out: /);
  assert.deepEqual(Object.keys(GROUP_NAMES), ['cheaper', 'kept', 'stronger']);
  assert.equal(GROUP_NAMES.cheaper, 'Moved to a cheaper model');
});

test('the empty state names release 0.7.0; the known limits are three; the prices are said to be fitted', async () => {
  const { PRICES_TEXT } = await import('./savings-text.mjs');
  assert.match(EMPTY_TEXT, /savings are measured for tasks started from release 0\.7\.0 on/i);
  assert.match(PRICES_TEXT, /^The prices of each model are fitted from the costs logged over the last 90 days/);
  assert.equal(LIMITS.length, 3);
  assert.match(LIMITS.join(' '), /easier on average/);
  assert.match(LIMITS.join(' '), /effort/);
  assert.match(LIMITS.join(' '), /judge's own cost/);
});

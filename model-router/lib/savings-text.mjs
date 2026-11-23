// The words and sentences of Savings that the terminal view, the card and the report page share, written through
// the shared formatters (lib/format.mjs), so the three cannot disagree. Pure: it takes the model of
// lib/savings.mjs and returns text. See docs/design/model-router-quality-loop.md, "Savings".
// Plain ES module with no Node or engine imports, so the mod, the scripts and node tests load it.
import { fmtNum, fmtPct, fmtSeconds, fmtUsd } from './format.mjs';
import { MIN_GROUP, MIN_TASKS, SHARE_MARGIN } from './savings.mjs';

export const SAVINGS_TITLE = 'Savings';
/** What every surface says when no task can be compared. */
export const EMPTY_TEXT = 'Savings are measured for tasks started from release 0.7.0 on: none to compare here yet.';
/** How the baseline is priced, said once in the page's footnote. */
export const PRICES_TEXT = 'The prices of each model are fitted from the costs logged over the last 90 days, per kind of token.';
/** The three places a task ran, in the card's words. */
export const GROUP_NAMES = Object.freeze({
  cheaper: 'Moved to a cheaper model', kept: 'Kept on the session\'s model', stronger: 'Moved to a stronger model',
});
/** How each surface introduces the comparison. */
export const BASIS_TEXT = 'Each task is compared with its cost on the model of the session that started it.';
/** The known limits of the comparison, said in the page's footnote. */
export const LIMITS = Object.freeze([
  'The tasks moved to a cheaper model are easier on average than the kept ones, so comparing their right-first-time ' +
    'rate favours routing. A comparison per class would be fairer; too many starts carry no class today.',
  'The baseline changes the model only: what a lower effort saves is not counted.',
  'The judge\'s own cost is not in the log (the engine does not report it) and is not subtracted; its time is shown. ' +
    'The time the choose-model skill adds to a session is not in the log either.',
]);

const VERDICT_TONES = Object.freeze({ 'pays off': 'good', 'costs more': 'bad' });
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const cap = (text) => (text ? `${String(text)[0].toUpperCase()}${String(text).slice(1)}` : '');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const byHow = (share) => `${fmtPct(Math.abs(share))} ${share < 0 ? 'more' : 'less'}`;

/** The status tone of a verdict: `good`, `bad`, or `dim` for not proven. */
export const verdictTone = (verdict) => VERDICT_TONES[verdict] ?? 'dim';

/** Quality as one word: `holds`, `drops` or `not judged`. */
export const qualityWord = (quality) => (quality === 'holds' || quality === 'drops' ? quality : 'not judged');

/** The verdict's sentence: what the verdict rests on, or why it is not proven. */
export function verdictSentence(s) {
  const versus = `A successful task costs ${byHow(s.savedShare)} than on the session's model`;
  if (s.reason === 'too-few') return `${plural(s.tasks, 'task')} compared: a verdict needs ${MIN_TASKS}.`;
  if (s.reason === 'no-success') return 'No task compared was right first time.';
  if (s.reason === 'no-cost') return 'The tasks compared carry no cost: there is nothing to save on.';
  if (s.reason === 'within') return `${versus}: within ${fmtPct(SHARE_MARGIN)}, too close to call.`;
  if (s.reason === 'quality-drops') {
    return `A successful task costs ${byHow(s.savedShare)}, but tasks moved to a cheaper model are right first time ` +
      `${plural(Math.round(s.qualityGap * 100), 'point')} less often than kept ones.`;
  }
  if (s.verdict === 'costs more') return `${versus}.`;
  return s.quality === 'holds'
    ? `${versus}, and quality holds.`
    : `${versus}; quality is not judged with fewer than ${MIN_GROUP} tasks on a side.`;
}

/** An amount saved; a negative one, an amount spent more: `$9.000 more`. */
export const savingText = (v) => (isNum(v) && v < 0 ? `${fmtUsd(-v)} more` : fmtUsd(v));

/** An amount as a phrase: `saved $5.600`, or `cost $9.000 more`. */
export const savedPhrase = (v) => (isNum(v) && v < 0 ? `cost ${fmtUsd(-v)} more` : `saved ${fmtUsd(v)}`);

/** A saved share as a phrase: `31% saved`, or `14% more` when the tasks cost more than on the session's model. */
export const sharePhrase = (v) => (isNum(v) ? (v < 0 ? `${fmtPct(-v)} more` : `${fmtPct(v)} saved`) : '–');

/** A move between two tiers: `Opus to Haiku`. */
export const moveName = (from, to) => `${cap(from)} to ${cap(to)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A week's Monday (`2026-11-16`) as `16 Nov`; anything else as it is. */
export function weekText(week) {
  const t = new Date(`${week}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? String(week ?? '') : `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/** The judge's calls, their total and median time. */
export function judgeText(j) {
  if (!j?.calls) return 'no call';
  return `${plural(j.calls, 'call')} · ${fmtSeconds(j.totalMs)} · median ${fmtSeconds(j.medianMs)}`;
}

/** The tasks left out, once, or nothing when none was. */
export const leftOutText = (n) => (n > 0
  ? `${plural(n, 'task')} left out: no session model or no token counts by kind (both recorded from releases 0.6.0 ` +
    'and 0.7.0), or a session tier with too few recent tasks to price.'
  : '');

/** Why the baseline is at the FPY of every task compared, or nothing when it is at the kept tasks'. */
export function baselineNote(s) {
  if (s.baselineFpyFrom !== 'all' || !(s.tasks > 0)) return '';
  const kept = s.groups?.kept?.tasks ?? 0;
  const why = kept < MIN_GROUP
    ? `Fewer than ${MIN_GROUP} tasks kept on the session's model`
    : `None of the ${plural(kept, 'task')} kept on the session's model was right first time`;
  return `${why}: the baseline is at the right-first-time rate of every task compared.`;
}

export { cap as capitalise, plural };

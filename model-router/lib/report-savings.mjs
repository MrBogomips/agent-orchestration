// The Savings section of the report page as a view model: what lib/report-html.mjs draws, first on the page. Pure:
// it takes the savings model of lib/savings.mjs (the usage data's own, for the report's window at the user level)
// and writes it through the texts the terminal view and the card share (lib/savings-text.mjs).
// See docs/design/model-router-quality-loop.md, "Savings".
// Plain ES module with no Node or engine imports, so the scripts and node tests load it.
import { fmtNum, fmtPct, fmtSeconds, fmtUsd } from './format.mjs';
import {
  EMPTY_TEXT, GROUP_NAMES, LIMITS, PRICES_TEXT, SAVINGS_TITLE, leftOutText, moveName, plural, qualityWord, savedPhrase, savingText, sharePhrase,
  verdictSentence, verdictTone, weekText,
} from './savings-text.mjs';
import { BAR_SIZE, COLORS, PAIRS_SIZE, pairedBarsSvg, partsBarSvg } from './usage-svg.mjs';

const QUALITY_TONES = Object.freeze({ holds: 'good', drops: 'bad' });
/** The colours of the three-part bar: moved cheaper, kept, moved stronger. */
const PART_COLORS = Object.freeze([COLORS.accent, COLORS.dim, COLORS.fair]);

function cardsOf(s) {
  const { cheaper, kept, stronger } = s.groups;
  return [
    { label: 'Per success', value: fmtUsd(s.perSuccess), detail: `${fmtUsd(s.baselinePerSuccess)} on the session's model · ${sharePhrase(s.savedShare)}` },
    { label: 'Saved', value: savingText(s.saved), detail: `spent ${fmtUsd(s.spent)} of ${fmtUsd(s.baselineSpent)}` },
    {
      label: 'Moved cheaper', value: fmtPct(cheaper.share), detail: `${fmtPct(kept.share)} kept · ${fmtPct(stronger.share)} moved stronger`,
      spark: {
        source: partsBarSvg([cheaper, kept, stronger].map((g, i) => ({ share: g.share, color: PART_COLORS[i] })), BAR_SIZE),
        alt: `${fmtPct(cheaper.share)} moved cheaper, ${fmtPct(kept.share)} kept, ${fmtPct(stronger.share)} moved stronger`, ...BAR_SIZE,
      },
    },
    {
      label: 'Quality', value: fmtPct(cheaper.fpy), unit: 'FPY moved cheaper', chip: { text: qualityWord(s.quality), tone: QUALITY_TONES[s.quality] ?? 'dim' },
      detail: `${fmtPct(kept.fpy)} kept · rework ${fmtPct(cheaper.reworkRate)}`,
    },
  ];
}

function weeksOf(s) {
  if (!s.weeks.length) return null;
  const last = s.weeks.at(-1);
  // The two bars stand side by side, unclamped: a week that cost more shows spent above its baseline, and says so.
  const labels = s.weeks.map((w) => [
    `Week of ${weekText(w.week)}: ${fmtUsd(w.baseline)} on the session's model`,
    `Week of ${weekText(w.week)}: ${fmtUsd(w.spent)} spent, ${savedPhrase(w.saving)}`,
  ]);
  return {
    title: 'Spend per week', latest: `${fmtUsd(last.spent)} of ${fmtUsd(last.baseline)}`,
    picture: {
      source: pairedBarsSvg(s.weeks.map((w) => [w.baseline, w.spent]), { ...PAIRS_SIZE, labels }),
      alt: `Spent ${fmtUsd(s.spent)} of ${fmtUsd(s.baselineSpent)} on the session's model over ${plural(s.weeks.length, 'week')}`, ...PAIRS_SIZE,
    },
    first: s.weeks.length > 1 ? weekText(s.weeks[0].week) : '', last: weekText(last.week),
  };
}

const moveRow = (name, m, saved) => ({
  name, tasks: fmtNum(m.tasks), fpy: fmtPct(m.fpy), rework: fmtPct(m.reworkRate), spent: fmtUsd(m.spent), baseline: fmtUsd(m.baseline), saved,
});

/** The moves per pair of tiers, then the kept tasks, then every task compared. */
function movesOf(s) {
  return [
    ...s.moves.map((m) => moveRow(moveName(m.from, m.to), m, savingText(m.saving))),
    ...(s.groups.kept.tasks ? [moveRow(GROUP_NAMES.kept, s.groups.kept, '–')] : []),
    moveRow('All tasks', { tasks: s.tasks, fpy: s.fpy, reworkRate: s.reworkRate, spent: s.spent, baseline: s.baselineSpent }, savingText(s.movesTotal)),
  ];
}

/**
 * The Savings section for a window's savings model at the user level: null without usage data, one line with no
 * task to compare. `windowTitle` names the window (`Last 30 days`).
 */
export function savingsSection(s, windowTitle, hasUsage = true) {
  if (!hasUsage) return null;
  const caption = `${windowTitle} · user level`;
  if (!s || s.isEmpty) return { title: SAVINGS_TITLE, caption, empty: EMPTY_TEXT };
  return {
    title: SAVINGS_TITLE, empty: null,
    caption: `${caption} · ${plural(s.tasks, 'task')} compared · against the same tasks on the model of the session that started them`,
    verdict: { word: s.verdict, tone: verdictTone(s.verdict), sentence: verdictSentence(s) },
    cards: cardsOf(s), weeks: weeksOf(s),
    judge: [
      { label: 'Judge calls', value: fmtNum(s.judge.calls) },
      { label: 'Time added by the judge', value: s.judge.calls ? `${fmtSeconds(s.judge.totalMs)} · median ${fmtSeconds(s.judge.medianMs)}` : '–' },
    ],
    moves: movesOf(s),
  };
}

/** The footnote lines of Savings: how the baseline is made, its known limits, and the tasks left out. */
export function savingsFootnotes(s, windowTitle) {
  if (!s) return [];
  const counted = `Savings, ${windowTitle.toLowerCase()}: ${plural(s.tasks, 'task')} compared; ${leftOutText(s.leftOut) || 'none left out.'}`;
  return [
    'Savings compares each task with its cost on the model of the session that started it: its own cost when it ran on that ' +
      'model, else its tokens of each kind at that model\'s prices. Per success on the session\'s model is at the ' +
      'right-first-time rate of the tasks kept on it (of every task compared under five kept, or when none of them succeeded).',
    PRICES_TEXT, ...LIMITS, counted,
  ];
}

// The Savings view of the Model routing card, as blocks that hooks/card-kit.tsx lays out: the verdict as a dot and
// a sentence, a key-value grid, the three share rows, spend per week as stacked bars, the moves with a total and the
// closing line. Pure: it takes the savings model of lib/savings.mjs and writes it through lib/savings-text.mjs.
// See docs/design/model-router-quality-loop.md, "Savings", and docs/design/ui-design.md, "The card".
// Plain ES module with no Node or engine imports, so the mod and node tests load it.
import { KIND_COLORS, SHADES, barSvg, chartSvg, scaleOf, segmentsSvg } from './card-parts.mjs';
import { fmtNum, fmtPct, fmtUsd } from './format.mjs';
import {
  BASIS_TEXT, EMPTY_TEXT, GROUP_NAMES, baselineNote, capitalise, judgeText, leftOutText, moveName, plural, qualityWord, savedPhrase, sharePhrase,
  savingText, verdictSentence, verdictTone,
} from './savings-text.mjs';

/** The weeks the chart draws at most, and the moves the table lists before folding the rest into one line. */
export const SAVINGS_WEEKS = 8;
export const MOVES_SHOWN = 8;
/**
 * The kinds of a week's bar: spent is the darker blue, what the session's model would have added the lightest, and
 * the cost above the session's model a context-card orange, clearly apart (ui-design.md, the kinds of a segmented bar).
 */
export const SPEND_COLORS = Object.freeze({ spent: SHADES.opus, added: SHADES.haiku, above: KIND_COLORS[1] });

const note = (text) => ({ kind: 'note', text, tone: null });

function verdictBlocks(s, windowLabel) {
  return [
    { kind: 'table', title: 'Verdict', aside: windowLabel, rows: [{ tone: verdictTone(s.verdict), label: capitalise(s.verdict), value: `${sharePhrase(s.savedShare)} per success` }] },
    note(verdictSentence(s)),
  ];
}

function gridBlock(s) {
  return { kind: 'grid', pairs: [
    { label: 'Per success', value: fmtUsd(s.perSuccess) }, { label: 'On the session\'s model', value: fmtUsd(s.baselinePerSuccess) },
    { label: 'Saved', value: savingText(s.saved) }, { label: 'Spent', value: `${fmtUsd(s.spent)} of ${fmtUsd(s.baselineSpent)}` },
    { label: 'Right first time, moved', value: fmtPct(s.groups.cheaper.fpy) }, { label: 'Right first time, kept', value: fmtPct(s.groups.kept.fpy) },
    { label: 'Quality', value: capitalise(qualityWord(s.quality)) }, { label: 'Judge', value: judgeText(s.judge) },
    { label: 'Tasks compared', value: fmtNum(s.tasks) }, { label: 'Tasks left out', value: fmtNum(s.leftOut) },
  ] };
}

function sharesBlock(s, windowLabel) {
  return { kind: 'shares', label: `Where tasks ran · ${windowLabel}`, rows: Object.entries(GROUP_NAMES).map(([key, name]) => {
    const g = s.groups[key];
    const parts = [`${fmtPct(g.fpy)} right first time`, `${fmtPct(g.reworkRate)} redone`, ...(key !== 'kept' && g.tasks ? [savedPhrase(g.saving)] : [])];
    return { color: null, name, amount: plural(g.tasks, 'task'), share: fmtPct(g.share), bar: barSvg(g.share), detail: parts.join(' · ') };
  }) };
}

/**
 * The stacked bar of each week, from the week's saving in the model: a week that saved is what was spent plus what
 * the session's model would have added; a week that cost more is what the session's model would have cost plus
 * the cost above it, in a tone of its own.
 */
export function weekBars(weeks, weekLabel) {
  return weeks.map((w) => ({
    label: weekLabel(w.week),
    parts: w.saving >= 0
      ? [{ value: w.spent, color: SPEND_COLORS.spent }, { value: w.saving, color: SPEND_COLORS.added }]
      : [{ value: w.baseline, color: SPEND_COLORS.spent }, { value: -w.saving, color: SPEND_COLORS.above }],
  }));
}

/** The chart's legend: a bar of its colours in the proportion the chart draws them, and a row per colour drawn. */
function legendOf(weeks, bars) {
  const names = [
    { color: SPEND_COLORS.spent, name: 'Spent', isDrawn: true },
    { color: SPEND_COLORS.added, name: 'What the session\'s model would have added', isDrawn: weeks.some((w) => w.saving > 0) },
    { color: SPEND_COLORS.above, name: 'Cost above the session\'s model', isDrawn: weeks.some((w) => w.saving < 0) },
  ].filter((n) => n.isDrawn);
  const drawn = names.map((n) => bars.reduce((sum, b) => sum + b.parts.filter((p) => p.color === n.color).reduce((x, p) => x + p.value, 0), 0));
  const whole = drawn.reduce((a, b) => a + b, 0);
  return {
    kind: 'legend', alt: `Spend per week: ${names.map((n) => n.name.toLowerCase()).join(', ')}`,
    source: segmentsSvg(names.map((n, i) => ({ share: whole > 0 ? drawn[i] / whole : 0, color: n.color }))),
    rows: names.map((n) => ({ color: n.color, name: n.name, count: '', share: '' })),
  };
}

/** Spend per week as stacked bars, with its legend. */
function weeksBlock(s, weekLabel) {
  const weeks = s.weeks.slice(-SAVINGS_WEEKS);
  if (!weeks.length) return [];
  const scale = scaleOf(Math.max(0, ...weeks.map((w) => Math.max(w.spent, w.baseline))), (v) => (v === 0 ? '$0' : fmtUsd(v)));
  const bars = weekBars(weeks, weekLabel);
  return [{
    kind: 'chart', title: 'Spend per week',
    alt: `Spent ${fmtUsd(s.spent)} of ${fmtUsd(s.baselineSpent)} on the session's model over ${plural(s.weeks.length, 'week')}`,
    source: chartSvg({ bars, ticks: scale.ticks, max: scale.top }),
  }, legendOf(weeks, bars)];
}

function movesBlock(s, windowLabel) {
  if (!s.moves.length) return [];
  const rows = s.moves.slice(0, MOVES_SHOWN).map((m) => ({
    label: `${moveName(m.from, m.to)} · ${plural(m.tasks, 'task')} · ${fmtPct(m.fpy)} right first time`, value: savingText(m.saving),
  }));
  const more = s.moves.length > MOVES_SHOWN ? [{ label: `${s.moves.length - MOVES_SHOWN} more moves`, value: '' }] : [];
  return [{ kind: 'table', title: 'Saved by move', aside: windowLabel, rows: [...rows, ...more, { label: 'Total', value: savingText(s.movesTotal) }] }];
}

/**
 * The blocks of the Savings view for one savings model (null or empty: one line saying from which release savings
 * are measured). `windowLabel` names the window as the card's dropdown does; `weekLabel` writes a week's Monday as
 * the card's other charts write a day.
 */
export function savingsBlocks(s, { windowLabel, weekLabel }) {
  if (!s || s.isEmpty) return [note(EMPTY_TEXT)];
  const closing = [BASIS_TEXT, leftOutText(s.leftOut), baselineNote(s)].filter(Boolean).join(' ');
  return [
    ...verdictBlocks(s, windowLabel), gridBlock(s), sharesBlock(s, windowLabel), ...weeksBlock(s, weekLabel),
    ...movesBlock(s, windowLabel), note(closing),
  ];
}

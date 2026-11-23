// A record of the event log as one line: when, its type, a leading word with its tone, and the fields that matter
// for its type. Pure: texts already formatted. The Log view of the card (lib/card-view.mjs) draws these lines.
// See docs/design/model-router.md, "The Log view".
// Plain ES module with no Node or engine imports, so the mod and node tests load it.
import { ACTION_TONES } from './usage-cards.mjs';
import { familyOf } from './tiers.mjs';
import { fmtTokens, fmtUsd } from './usage-view.mjs';

const OUTCOME_TONES = Object.freeze({ success: 'good', rework: 'fair', failure: 'bad' });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const model = (m) => (m ? (familyOf(m) === 'other' ? String(m) : familyOf(m)) : '?');
const join = (parts) => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ');

/** A size in bytes as `940 B`, `1.2 kB`, `3.4 MB`. */
export function fmtBytes(n) {
  if (!isNum(n) || n < 0) return '–';
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

// What a record says beyond its type, by type: the fields the log keeps for it, in reading order.
const DETAILS = Object.freeze({
  decision: (r) => join([`${model(r.before)} → ${model(r.after)}${r.effort ? `·${r.effort}` : ''}`, r.subagentType, r.reason]),
  spawn: (r) => join([r.subagentType, r.class, `${model(r.model)}${r.effort ? `·${r.effort}` : ''}`, r.route]),
  outcome: (r) => join([r.class, `${r.tier ?? '?'}${r.effort ? `·${r.effort}` : ''}`, isNum(r.costUsd) ? fmtUsd(r.costUsd) : null, r.why]),
  report: (r) => join([r.status, model(r.model), isNum(r.tokens) ? `${fmtTokens(r.tokens)} tokens` : null, isNum(r.costUsd) ? fmtUsd(r.costUsd) : null]),
  signal: (r) => join([r.file ?? r.tool ?? r.target]),
  // `other` is the engine's word for an end with no particular reason: it says nothing, so it is left out.
  'session-end': (r) => join(['session ended', r.reason && r.reason !== 'other' ? `reason: ${r.reason}` : null]),
});
// The word that leads a record's line, as a chip, with its tone: the action of a decision, the result of an outcome.
const LEADS = Object.freeze({
  decision: (r) => (r.action ? { text: String(r.action), tone: ACTION_TONES[r.action] ?? 'dim' } : null),
  outcome: (r) => (r.outcome ? { text: String(r.outcome), tone: OUTCOME_TONES[r.outcome] ?? 'dim' } : null),
  signal: (r) => (r.kind ? { text: String(r.kind), tone: 'dim' } : null),
});

/** One record as a line: when (UTC), its type, its session's first eight characters, a leading chip and the detail. */
export function recordLine(r) {
  const ts = typeof r?.ts === 'string' ? r.ts : '';
  const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ts) ? `${ts.slice(5, 10)} ${ts.slice(11, 16)}` : ts.slice(0, 16) || '–';
  const type = String(r?.type ?? 'unknown');
  return {
    when, type, session: typeof r?.session === 'string' ? r.session.slice(0, 8) : '',
    lead: Object.hasOwn(LEADS, type) ? LEADS[type](r) : null,
    detail: Object.hasOwn(DETAILS, type) ? DETAILS[type](r) : '',
  };
}

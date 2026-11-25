// The children panel's data: rows from the children record joined with the live session list, and how the mod finds
// the record from the master's own calls to the registry script. Pure: the mod reads the record through
// `scripts/registry.mjs read` and the live list through the ListAgents tool (spike S8), and passes both here.

import { EFFORT_WIDTH, MODEL_WIDTH, modelEffortSegments } from './look.mjs';
import { tokenize } from './shell-words.mjs';

const NOT_LISTED = 'not listed';
const UNKNOWN = '?';
const NONE = '-';

/**
 * Live status per session name from a ListAgents result (`{ result: { sections } }` or the bare result).
 * @returns {Map<string, string> | undefined} undefined when the result has no rows to read
 */
export function liveStatuses(output) {
  const result = output?.result ?? output;
  const sections = result?.sections;
  if (!Array.isArray(sections)) return undefined;
  const live = new Map();
  for (const section of sections) {
    for (const row of Array.isArray(section?.rows) ? section.rows : []) {
      if (typeof row?.name === 'string') live.set(row.name, typeof row.status === 'string' ? row.status : 'listed');
    }
  }
  return live;
}

/**
 * The peer sessions of a ListAgents result as `{ name, ref }` rows; undefined when it has none to read.
 * @returns {Array<{ name?: string, ref?: string }> | undefined}
 */
export function liveRows(output) {
  const sections = (output?.result ?? output)?.sections;
  if (!Array.isArray(sections)) return undefined;
  return sections.flatMap((section) =>
    (Array.isArray(section?.rows) ? section.rows : [])
      .filter((row) => row !== null && typeof row === 'object')
      .map((row) => ({ name: typeof row.name === 'string' ? row.name : undefined, ref: typeof row.ref === 'string' ? row.ref : undefined })),
  );
}

function lastMessage(message) {
  if (!message || typeof message.type !== 'string') return NONE;
  const at = typeof message.at === 'string' ? message.at.slice(0, 16).replace('T', ' ') : '';
  return at ? `${message.type} ${at}` : message.type;
}

const text = (value) => (typeof value === 'string' && value !== '' ? value : NONE);

/**
 * @param {{ children?: unknown[] } | undefined} record
 * @param {Map<string, string> | undefined} live
 */
export function panelRows(record, live) {
  const children = Array.isArray(record?.children) ? record.children : [];
  return children
    .filter((child) => child !== null && typeof child === 'object' && typeof child.name === 'string')
    .map((child) =>
      Object.freeze({
        name: child.name,
        status: text(child.status),
        live: live === undefined ? UNKNOWN : (live.get(child.name) ?? NOT_LISTED),
        model: text(child.model),
        effort: text(child.effort),
        last: lastMessage(child.lastMessage),
      }),
    );
}

const pad = (value, width) => (value.length >= width ? value : value + ' '.repeat(width - value.length));

const NAME_WIDTH = 18;
const STATUS_WIDTH = 12;
const LIVE_WIDTH = 10;
// The model, the four-cell bar and the effort word: `sonnet ▰▰▱▱ medium`.
const MODEL_EFFORT_WIDTH = MODEL_WIDTH + 1 + 4 + 1 + EFFORT_WIDTH;

// The record status and the live status in the theme's good, fair and bad colours (*A shared look*).
const STATUS_TONES = Object.freeze({
  running: 'good',
  working: 'good',
  busy: 'good',
  'waiting-user': 'fair',
  abandoned: 'fair',
  [NOT_LISTED]: 'fair',
  lost: 'bad',
  [UNKNOWN]: 'dim',
});

const statusSegment = (value, width) => {
  const tone = STATUS_TONES[value];
  return tone ? { text: `${pad(value, width)} `, tone } : { text: `${pad(value, width)} ` };
};

// Keeps the first `width` columns of the segments, the last one cut and followed by `…` when they are longer.
function cut(segments, width) {
  const kept = [];
  let room = Math.max(0, width - 1);
  for (const segment of segments) {
    if (room <= 0) break;
    kept.push(segment.text.length <= room ? segment : { ...segment, text: segment.text.slice(0, room) });
    room -= segment.text.length;
  }
  return [...kept, { text: '…' }];
}

/** A row's text, for the `/session-hub` table. */
export const rowText = (segments) => segments.map((segment) => segment.text).join('');

/**
 * One row as segments, `{ text, color?, bold?, tone? }` (`tone`: `dim`, `good`, `fair`, `bad`), cut to `width`
 * columns: the model bold in its tier's colour, the effort as the bar and the word in its level's colour.
 */
export function formatRow(row, width) {
  const modelEffort =
    row.model === NONE && row.effort === NONE
      ? [{ text: pad(NONE, MODEL_EFFORT_WIDTH) }]
      : modelEffortSegments(row.model === NONE ? undefined : row.model, row.effort);
  const segments = [
    { text: `${pad(row.name, NAME_WIDTH)} ` },
    statusSegment(row.status, STATUS_WIDTH),
    statusSegment(row.live, LIVE_WIDTH),
    ...modelEffort,
    { text: ' ' },
    { text: row.last },
  ];
  const last = segments.length - 1;
  const trimmed = segments.map((segment, index) => (index === last ? { ...segment, text: segment.text.trimEnd() } : segment));
  const fitted = rowText(trimmed).length <= width ? trimmed : cut(trimmed, width);
  return fitted.filter((segment) => segment.text !== '');
}

/** The header line that goes with formatRow, as text. */
export function headerRow(width) {
  const cells = [
    pad('child', NAME_WIDTH),
    pad('record', STATUS_WIDTH),
    pad('live', LIVE_WIDTH),
    pad(`${pad('model', MODEL_WIDTH)} effort`, MODEL_EFFORT_WIDTH),
    'last message',
  ];
  const line = cells.join(' ');
  return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * Where a call to the registry script keeps the record: `{ file }` and/or `{ hub }` when the command runs
 * `registry.mjs` with an absolute literal `--file` or `--hub`; undefined otherwise.
 */
export function parseRegistryCall(command) {
  if (typeof command !== 'string' || !command.includes('registry.mjs')) return undefined;
  let tokens;
  try {
    tokens = tokenize(command);
  } catch {
    return undefined;
  }
  const found = {};
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const flag = tokens[i];
    const value = tokens[i + 1];
    if (flag.type !== 'word' || value.type !== 'word' || value.dynamic || !value.value.startsWith('/')) continue;
    if (flag.value === '--file') found.file = value.value;
    if (flag.value === '--hub') found.hub = value.value;
  }
  return found.file || found.hub ? found : undefined;
}

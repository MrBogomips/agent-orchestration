// The children panel's data: rows from the children record joined with the live session list, and how the mod finds
// the record from the master's own calls to the registry script. Pure: the mod reads the record through
// `scripts/registry.mjs read` and the live list through the ListAgents tool (spike S8), and passes both here.

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

/** One line for a row, cut to `width` columns. */
export function formatRow(row, width) {
  const cells = [
    pad(row.name, 18),
    pad(row.status, 12),
    pad(row.live, 10),
    pad(row.model === NONE && row.effort === NONE ? NONE : `${row.model}/${row.effort}`, 15),
    row.last,
  ];
  const line = cells.join(' ').trimEnd();
  return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`;
}

/** The header line that goes with formatRow. */
export function headerRow(width) {
  return formatRow({ name: 'child', status: 'record', live: 'live', model: 'model', effort: 'effort', last: 'last message' }, width);
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

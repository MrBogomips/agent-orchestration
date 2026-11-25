// The outbox: where a child's mod keeps a message its master could not receive, so that a final report is never lost
// (#97). One JSON file per message in a folder next to the children record: `children-<hub id>.json` has its outbox in
// `children-<hub id>.outbox/`. The child's mod writes a file; the master reads them with `registry.mjs outbox` and
// removes each one it has handled. Pure: the mod and the script do the file work.

export const OUTBOX_VERSION = 1;
const RECORD_SUFFIX = '.json';
const OUTBOX_SUFFIX = '.outbox';
// `20261125T101500Z-0d9bc5aa-k3x9.json`: time, the sender's session id cut short, a random tail.
export const OUTBOX_FILE = /^\d{8}T\d{6}Z-[0-9A-Za-z_-]{1,16}-[0-9a-z]{1,8}\.json$/;
const ABSOLUTE = /^(?:[A-Za-z]:)?\//;
// A message is a report, not a file: what goes past this is cut, and the cut is said.
export const MAX_TEXT = 64 * 1024;

/** The outbox folder of a children record, or undefined when the record path is not an absolute `.json` path. */
export function outboxDir(record) {
  const path = typeof record === 'string' ? record.trim() : '';
  if (!ABSOLUTE.test(path) || !path.endsWith(RECORD_SUFFIX) || path.length === RECORD_SUFFIX.length + 1) return undefined;
  return `${path.slice(0, -RECORD_SUFFIX.length)}${OUTBOX_SUFFIX}`;
}

const stampOf = (at) => at.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');

/**
 * The file a message goes into, and its content.
 * @param {{ dir: string, at: string, sessionId?: string, nonce: string, master: string, reason?: string, text: string }} input
 * @returns {{ file: string, content: string }}
 */
export function outboxEntry({ dir, at, sessionId, nonce, master, reason, text }) {
  const from = String(sessionId ?? '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 8) || 'unknown';
  const tail = String(nonce).toLowerCase().replace(/[^0-9a-z]/g, '').slice(0, 8) || '0';
  const body = String(text ?? '');
  const isCut = body.length > MAX_TEXT;
  const message = {
    version: OUTBOX_VERSION,
    at,
    from: { sessionId: sessionId ?? null },
    to: master,
    reason: reason ?? null,
    text: isCut ? body.slice(0, MAX_TEXT) : body,
    ...(isCut ? { cut: body.length } : {}),
  };
  return { file: `${dir}/${stampOf(at)}-${from}-${tail}.json`, content: `${JSON.stringify(message, null, 2)}\n` };
}

/**
 * One outbox file as the master reads it; a file that is not a message is reported, never thrown.
 * @returns {{ file: string, at?: string, from?: string | null, to?: string, reason?: string | null, text?: string, cut?: number, error?: string }}
 */
export function readOutboxMessage(name, content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { file: name, error: `not valid JSON (${error instanceof Error ? error.message : error})` };
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.text !== 'string') {
    return { file: name, error: 'not an outbox message' };
  }
  return {
    file: name,
    at: typeof parsed.at === 'string' ? parsed.at : undefined,
    from: typeof parsed.from?.sessionId === 'string' ? parsed.from.sessionId : null,
    to: typeof parsed.to === 'string' ? parsed.to : undefined,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    text: parsed.text,
    ...(typeof parsed.cut === 'number' ? { cut: parsed.cut } : {}),
  };
}

/** What the guard answers the child's model when its message to the master was not delivered. */
export function undeliveredText({ master, reason, saved, error }) {
  const why = reason ? ` (${String(reason).replace(/^Not sent:\s*/i, '').slice(0, 300)})` : '';
  const head = `[session-hub] The master "${master}" could not be reached${why}.`;
  if (saved) {
    return (
      `${head} The message was saved in the master's outbox (${saved}); the master reads it there, so do not send ` +
      'it again in a loop. Tell the user that the master did not receive it.'
    );
  }
  return (
    `${head} The message could not be saved in the outbox either${error ? ` (${String(error).slice(0, 200)})` : ''}. ` +
    'Tell the user, and keep the whole message in your reply so that it is not lost.'
  );
}

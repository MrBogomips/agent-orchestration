// The master side of a rename (#98): the master's name as `ListAgents` gives it now, compared with the name its
// children were started under (the `master` of the children record, written by `spawn`). Pure: the mod passes the
// ListAgents result, the record and its own session id.

const SELF = /^This session is (.+?) \[([0-9A-Za-z_-]+)\]/m;
const LIVE = Object.freeze(['running', 'waiting-user']);

/**
 * This session's own name and ref, from the first line of a ListAgents result (`{ result: { listing } }` or bare).
 * @returns {{ name: string, ref: string } | undefined}
 */
export function selfFromListing(output) {
  const listing = (output?.result ?? output)?.listing;
  if (typeof listing !== 'string') return undefined;
  const found = SELF.exec(listing);
  return found ? Object.freeze({ name: found[1].trim(), ref: found[2] }) : undefined;
}

/** The master identity a record holds, or undefined. */
export function recordedMaster(record) {
  const master = record?.master;
  if (master === null || typeof master !== 'object' || typeof master.name !== 'string' || master.name === '') return undefined;
  return Object.freeze({
    name: master.name,
    ref: typeof master.ref === 'string' ? master.ref : undefined,
    sessionId: typeof master.sessionId === 'string' ? master.sessionId : undefined,
  });
}

const liveChildren = (record) =>
  (Array.isArray(record?.children) ? record.children : []).filter((child) => LIVE.includes(child?.status)).length;

const children = (count) => (count === 1 ? '1 child' : `${count} children`);

/**
 * The notice to show when this session's name is no longer the one its live children were started under, or
 * undefined when there is nothing to say.
 * @param {{ record: unknown, current: { name: string } | undefined, sessionId?: string }} input
 * @returns {{ name: string, text: string } | undefined} `name` is the current name, for showing the notice once
 */
export function renameNotice({ record, current, sessionId }) {
  const recorded = recordedMaster(record);
  if (!recorded || !current || current.name === recorded.name) return undefined;
  const count = liveChildren(record);
  if (count === 0) return undefined;
  const head = `[session-hub] This session was renamed from "${recorded.name}" to "${current.name}" while ${children(count)} run.`;
  if (recorded.sessionId && recorded.sessionId === sessionId) {
    return {
      name: current.name,
      text: `${head} They still reach it: their send guard finds this session by its id, whatever its name.`,
    };
  }
  return {
    name: current.name,
    text:
      `${head} Children started without this session's id are tied to "${recorded.name}" and can no longer reach ` +
      `it. Rename it back with /rename ${recorded.name}, or replace those children; a message a child could not ` +
      'deliver waits in the outbox, when the child runs session-hub 0.6 or later.',
  };
}

/** The panel's line about messages waiting in the outbox, or undefined when there are none. */
export function outboxNote(count) {
  if (!Number.isInteger(count) || count <= 0) return undefined;
  const what = count === 1 ? '1 message from a child waits' : `${count} messages from children wait`;
  return `${what} in the outbox: read ${count === 1 ? 'it' : 'them'} with session-hub:dispatch.`;
}

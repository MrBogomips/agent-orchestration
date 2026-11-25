// The send guard: in a child, a message may go to the master only (and to the session's own subagents).
// Pure: the mod passes `session.send`'s recipient, the session's agents from $.agent.list() and, when the child knows
// its master's ref, the peer sessions from ListAgents.
//
// `to` is what the model wrote (spike S9): the master's name, or a name followed by ` [<ref>]`. A session's name can
// change while it runs (`/rename`, a title hook, Remote Control) and its ref changes when it restarts; its session id
// changes with neither (spike S21). So the master is the recipient the model meant by any of the master's name when
// the child started, its ref, or its current name (the live session with that ref), and a message to it goes by
// session id when the child knows it, else by the current name. A socket or bridge address (`uds:…`, `bridge:…`)
// cannot be tied to the master, so it is refused and the model is told to use the name.

const PREFIX = '[session-hub]';
const REF_SUFFIX = /\s*\[([0-9A-Za-z_-]+)\]$/;

const DELIVER = Object.freeze({ deliver: true });
// The engine words a refused send as `Not sent: a plugin hook refused it (<reason>)`, so the reason does not repeat it.
const refuse = (reason) =>
  Object.freeze({ deliver: false, reason: `${PREFIX} ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` });

/** The recipient's name without a trailing ` [ref]`. */
export function recipientName(to) {
  return String(to ?? '').trim().replace(REF_SUFFIX, '').trim();
}

/** The ref in a trailing ` [ref]`, if any. */
export function recipientRef(to) {
  return REF_SUFFIX.exec(String(to ?? '').trim())?.[1];
}

const isAddress = (name) => /^[a-z]+:/.test(name);

function isOwnAgent(to, agents) {
  return (agents ?? []).some((agent) => agent && (agent.id === to || (agent.name !== undefined && agent.name === to)));
}

/**
 * The master as the live session list shows it now: the session that holds the master's ref. Undefined when the
 * child does not know the ref, the list was not read, or no session holds it (the master restarted or ended).
 * @param {{ masterRef?: string }} role
 * @param {ReadonlyArray<{ name?: string, ref?: string }> | undefined} live
 * @returns {{ name: string, ref: string } | undefined}
 */
export function liveMaster(role, live) {
  if (!role.masterRef || !Array.isArray(live)) return undefined;
  const row = live.find((entry) => entry?.ref === role.masterRef && typeof entry.name === 'string' && entry.name !== '');
  return row ? Object.freeze({ name: row.name, ref: row.ref }) : undefined;
}

function meansMaster(raw, name, role, current) {
  if (name === role.master) return true;
  if (current && name === current.name) return true;
  if (!role.masterRef) return false;
  return raw === role.masterRef || recipientRef(raw) === role.masterRef;
}

// How the master is named in a refusal: its name when the child started, and its current one when it changed.
function masterWords(role, current) {
  const pinned = `"${role.master}"`;
  return current && current.name !== role.master ? `${pinned} (now named "${current.name}")` : pinned;
}

/**
 * @param {{ role: ReturnType<typeof import('./role.mjs').readRole>, to?: string, agentId?: string,
 *   agents?: ReadonlyArray<{ id: string, name?: string }>, live?: ReadonlyArray<{ name?: string, ref?: string }> }} input
 * @returns {{ deliver: true, toMaster?: undefined } | { deliver: true, toMaster: true, to: string, sessionId?: string }
 *   | { deliver: false, reason: string }}
 */
export function judgeSend({ role, to, agentId, agents, live }) {
  if (!role.guarding) return DELIVER;
  if (role.kind === 'invalid') {
    return refuse(
      `SESSION_HUB_ROLE has an unknown value (${role.raw}), so the send guard cannot tell whom this session may ` +
        'message. Tell the user; the launch command must set SESSION_HUB_ROLE=child.',
    );
  }
  if (!role.master) {
    return refuse(
      'this session is a child, but SESSION_HUB_MASTER is not set, so the send guard does not know its master. ' +
        'Tell the user; the launch command must set it.',
    );
  }
  const raw = String(to ?? '').trim();
  if (raw === '') return refuse('the message has no recipient.');
  const name = recipientName(raw);
  const current = liveMaster(role, live);
  // A ref alone never picks the session a message goes to: a stale or foreign one could pick another. The message
  // goes by session id, or else to the master's current name, or else to its name when the child started.
  if (meansMaster(raw, name, role, current)) {
    const target = { deliver: true, toMaster: true, to: current?.name ?? role.master };
    return Object.freeze(role.masterSessionId ? { ...target, sessionId: role.masterSessionId } : target);
  }
  if (agentId !== undefined && raw === 'main') return DELIVER;
  if (isOwnAgent(raw, agents)) return DELIVER;
  const master = masterWords(role, current);
  if (isAddress(name)) {
    return refuse(
      `this session is a child and may message only its master, ${master}, by its name. Send the message to ` +
        `"${role.master}", not to an address.`,
    );
  }
  return refuse(
    `this session is a child and may message only its master, ${master}. Send what you need to "${role.master}" ` +
      'with your message prefix, even if the master was renamed: the guard delivers it to the master. A request ' +
      'for another session or repository is an `out-of-scope` message, and the master routes it.',
  );
}

// The send guard: in a child, a message may go to the master only (and to the session's own subagents).
// Pure: the mod passes `session.send`'s recipient and the session's agents from $.agent.list().
//
// `to` is what the model wrote (spike S9): the master's name, or its name followed by ` [<ref>]`. A socket or bridge
// address (`uds:…`, `bridge:…`) cannot be tied to a name, so it is refused and the model is told to use the name.

const PREFIX = '[session-hub]';
const REF_SUFFIX = /\s*\[[0-9A-Za-z_-]+\]$/;

const DELIVER = Object.freeze({ deliver: true });
// The engine words a refused send as `Not sent: a plugin hook refused it (<reason>)`, so the reason does not repeat it.
const refuse = (reason) =>
  Object.freeze({ deliver: false, reason: `${PREFIX} ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` });

/** The recipient's name without a trailing ` [ref]`. */
export function recipientName(to) {
  return String(to ?? '').trim().replace(REF_SUFFIX, '').trim();
}

const isAddress = (name) => /^[a-z]+:/.test(name);

function isOwnAgent(to, agents) {
  return (agents ?? []).some((agent) => agent && (agent.id === to || (agent.name !== undefined && agent.name === to)));
}

/**
 * @param {{ role: ReturnType<typeof import('./role.mjs').readRole>, to?: string, agentId?: string,
 *   agents?: ReadonlyArray<{ id: string, name?: string }> }} input
 * @returns {{ deliver: true } | { deliver: false, reason: string }}
 */
export function judgeSend({ role, to, agentId, agents }) {
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
  if (name === role.master) return DELIVER;
  if (agentId !== undefined && raw === 'main') return DELIVER;
  if (isOwnAgent(raw, agents)) return DELIVER;
  const master = `"${role.master}"`;
  if (isAddress(name)) {
    return refuse(
      `this session is a child and may message only its master, ${master}, by its name. Send the message to ` +
        `${master}, not to an address.`,
    );
  }
  return refuse(
    `this session is a child and may message only its master, ${master}. Send what you need to ${master} with ` +
      'your message prefix; a request for another session or repository is an `out-of-scope` message, and the ' +
      'master routes it.',
  );
}

// The session's role, read from the SESSION_HUB_* variables set on the launch command.
// Pure: the mod passes the values it read with $.env.get. Same rules as the classic scope guard: the role value is
// read without regard to case or surrounding spaces, `none` and `master` are not a child, an unknown value is
// invalid and keeps the guards on (they fail closed), and `SESSION_HUB_GUARDS=off` turns the guards off.

const INACTIVE_ROLES = Object.freeze(['', 'none', 'master']);

const normalize = (value) => String(value ?? '').trim().toLowerCase();
const trimmed = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? undefined : text;
};

/**
 * @param {{ role?: string, master?: string, scopeRoot?: string, handoff?: string, registry?: string, guards?: string }} values
 * @returns {Readonly<{ kind: 'none' | 'child' | 'invalid', guarding: boolean, guardsOff: boolean, master?: string,
 *   scopeRoot?: string, handoff?: string, registry?: string, raw?: string }>}
 */
export function readRole(values) {
  const guardsOff = normalize(values.guards) === 'off';
  const role = normalize(values.role);
  if (INACTIVE_ROLES.includes(role)) return Object.freeze({ kind: 'none', guarding: false, guardsOff });
  const kind = role === 'child' ? 'child' : 'invalid';
  return Object.freeze({
    kind,
    guarding: !guardsOff,
    guardsOff,
    master: trimmed(values.master),
    scopeRoot: trimmed(values.scopeRoot),
    handoff: trimmed(values.handoff),
    registry: trimmed(values.registry),
    raw: values.role,
  });
}

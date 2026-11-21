// A child must run under the configuration folder of its master: another folder means another account, other
// settings and plugins, and no messages between the two sessions. The default children record lives in the master's
// folder (`<config dir>/session-hub/children-<hub id>.json`), so its path tells the child where the master runs.
// Pure: the mod passes the variables it read and a way to resolve links. A notice, not a guard: when it cannot tell
// (a record at a path of the hub's own choice, a folder that does not resolve) it says nothing.

const DEFAULT_RECORD = /^(.+)\/session-hub\/children-[0-9a-f]{16}\.json$/;

const clean = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** The master's configuration folder, read from the default path of the children record; else undefined. */
export function masterConfigDir(registry) {
  const match = DEFAULT_RECORD.exec(String(registry ?? '').trim());
  return match && match[1].startsWith('/') ? clean(match[1]) : undefined;
}

/** This session's configuration folder: CLAUDE_CONFIG_DIR (a leading `~` expanded), else `<home>/.claude`. */
export function ownConfigDir({ configDir, home }) {
  const configured = String(configDir ?? '').trim();
  const base = String(home ?? '').trim();
  if (configured === '') return base.startsWith('/') ? `${clean(base)}/.claude` : undefined;
  if (configured === '~' || configured.startsWith('~/')) {
    return base.startsWith('/') ? clean(`${clean(base)}${configured.slice(1)}`) : undefined;
  }
  return configured.startsWith('/') ? clean(configured) : undefined;
}

/**
 * `{ own, master }` when a child runs under another configuration folder than its master, else undefined.
 * @param {{ role: { kind: string, registry?: string }, configDir?: string, home?: string,
 *   realpath?: (path: string) => Promise<string> | string }} given
 */
export async function identityMismatch({ role, configDir, home, realpath = (path) => path }) {
  if (role?.kind !== 'child') return undefined;
  const master = masterConfigDir(role.registry);
  const own = ownConfigDir({ configDir, home });
  if (master === undefined || own === undefined) return undefined;
  try {
    const [ownReal, masterReal] = [clean(await realpath(own)), clean(await realpath(master))];
    return ownReal === masterReal ? undefined : Object.freeze({ own, master });
  } catch {
    return undefined;
  }
}

/** The notice, for the scope line and `/session-hub`. */
export function mismatchText({ own, master }) {
  return (
    `[session-hub] This child runs under another configuration folder (${own}) than its master (${master}): ` +
    'another account and other settings, and no messages between the two sessions. ' +
    'The master must start it again as it was started itself (session-hub:spawn, Launch command).'
  );
}

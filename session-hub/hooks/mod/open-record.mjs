// The "open the log" action of session-hub: its log is the children record. Which file, which command opens it,
// and the one line the person reads. Pure: the mod finds the default path through `scripts/registry.mjs path`,
// checks that the file exists, asks the engine for the platform and runs the command.

/** The control's element key, its hotkey and its label, shared by the terminal and the graphical rendering. */
export const LOG_KEY = 'log';
export const LOG_HOTKEY = 'l';
export const LOG_LABEL = 'Log';

const REASON_CHARS = 200;

// The command that opens a file in the system's default app, by platform (`$.session.info().platform`).
// macOS opens it with `-t`, the default text editor, so a machine with no app set for `.json` still opens it.
const OPENERS = Object.freeze({
  macos: Object.freeze(['open', '-t']),
  linux: Object.freeze(['xdg-open']),
});

/**
 * The argument vector that opens `path` on `platform`, the path one argument of its own; null where no opener is
 * known, or the path is not absolute (it could read as an option).
 */
export function openerArgv(platform, path) {
  const opener = Object.hasOwn(OPENERS, String(platform)) ? OPENERS[platform] : null;
  if (!opener || typeof path !== 'string' || !path.startsWith('/')) return null;
  return [...opener, path];
}

/**
 * Where the record of this session is: `{ file }` when the path is known (a child's SESSION_HUB_REGISTRY, a
 * master's own record), `{ hub }` when it is the default one of a hub (the registry script gives its path), or
 * `{ none }`, the line that says why there is none to open.
 */
export function recordSource({ role, master, cwd }) {
  if (role.kind === 'child') {
    return role.registry
      ? { file: role.registry }
      : { none: 'This child was started without SESSION_HUB_REGISTRY: open the children record from its master.' };
  }
  if (role.kind !== 'none') return { none: 'This session has an unknown session-hub role: there is no children record to open.' };
  return master?.record ? { file: master.record } : { hub: master?.hub ?? cwd };
}

const whyNot = (platform, isHosted) =>
  (isHosted ? 'this session runs on a hosted machine' : `no opener known for ${typeof platform === 'string' && platform !== 'unknown' ? platform : 'this system'}`);

/**
 * What the action does: `{ target, argv, text }`. `argv` is the command to run (null: nothing to run), `text` the
 * line shown when the command succeeds or when there is none.
 */
export function recordPlan({ file, exists, platform, isHosted = false }) {
  if (!exists) return { target: file, argv: null, text: `No children record yet: ${file} is written when the first child starts.` };
  const argv = isHosted ? null : openerArgv(platform, file);
  if (!argv) return { target: file, argv, text: `The children record is at ${file} (not opened: ${whyNot(platform, isHosted)})` };
  return { target: file, argv, text: `Children record opened: ${file}` };
}

/** The line for an open that failed: the path, so the person can still reach it, and the first line of the reason. */
export function failText(plan, reason) {
  const first = String(reason ?? '').trim().split('\n')[0].slice(0, REASON_CHARS);
  return `Could not open ${plan.target}: ${first || 'the opener failed'}`;
}

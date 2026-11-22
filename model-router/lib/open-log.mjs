// The "open the log" action of the usage view: which file, which command opens it, and the one line the person
// reads. Pure: the mod checks what exists, asks the engine for the platform and runs the command.
// See docs/design/model-router.md, "Opening the log".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.

/** The control's element key, its hotkey and its label, shared by the terminal and the graphical rendering. */
export const LOG_KEY = 'log';
export const LOG_HOTKEY = 'l';
export const LOG_LABEL = 'Log';

const REASON_CHARS = 200;

// The command that opens a path in the system's default app, by platform (`$.session.info().platform`).
// `text` is a log: macOS opens it with `-t`, the default text editor, since `.jsonl` often has no app of its own and
// `open` then fails. `default` is a folder or a page, opened by the app the system has for it.
const OPENERS = Object.freeze({
  macos: Object.freeze({ text: ['open', '-t'], default: ['open'] }),
  linux: Object.freeze({ text: ['xdg-open'], default: ['xdg-open'] }),
});

/** The event log and the folder its rotated parts are kept in, under the config folder. */
export function logPaths(configDir) {
  const root = `${String(configDir).replace(/\/+$/, '')}/model-router`;
  return { log: `${root}/events.jsonl`, archive: `${root}/archive` };
}

/**
 * The argument vector that opens `path` (`kind`: `text` or `default`) on `platform`, the path one argument of its
 * own; null where no opener is known, or the path is not absolute (it could read as an option).
 */
export function openerArgv(platform, path, kind) {
  const opener = Object.hasOwn(OPENERS, String(platform)) ? OPENERS[platform][kind === 'text' ? 'text' : 'default'] : null;
  if (!opener || typeof path !== 'string' || !path.startsWith('/')) return null;
  return [...opener, path];
}

/** Why nothing is run to open a path: the session is hosted, or the platform has no known opener. */
export const whyNot = (platform, isHosted) =>
  (isHosted ? 'this session runs on a hosted machine' : `no opener known for ${typeof platform === 'string' && platform !== 'unknown' ? platform : 'this system'}`);

/**
 * What the action does: `{ target, argv, text }`. `argv` is the command to run (null: nothing to run), `target` the
 * path it opens, `text` the line shown when the command succeeds or when there is none. The log is opened; with a
 * log just rotated away, its archive folder; with neither, nothing.
 */
export function openPlan({ configDir, platform, isHosted = false, hasLog, hasArchive }) {
  const { log, archive } = logPaths(configDir);
  if (!hasLog && !hasArchive) {
    return { target: null, argv: null, text: `No event log yet: ${log} is written once a subagent has run with measuring on.` };
  }
  const target = hasLog ? log : archive;
  const argv = isHosted ? null : openerArgv(platform, target, hasLog ? 'text' : 'default');
  const rotated = hasLog && hasArchive ? ` · rotated logs: ${archive}` : '';
  if (!argv) {
    const what = hasLog ? 'The event log is at' : 'No event log since the last rotation; the archive folder is at';
    return { target, argv, text: `${what} ${target} (not opened: ${whyNot(platform, isHosted)})${rotated}` };
  }
  const text = hasLog ? `Event log opened: ${log}${rotated}` : `No event log since the last rotation; archive folder opened: ${archive}`;
  return { target, argv, text };
}

/** The line for an open that failed: the path, so the person can still reach it, and the first line of the reason. */
export function failText(plan, reason) {
  const first = String(reason ?? '').trim().split('\n')[0].slice(0, REASON_CHARS);
  return `Could not open ${plan.target}: ${first || 'the opener failed'}`;
}

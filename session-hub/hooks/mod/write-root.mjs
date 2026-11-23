// The rules a write root must follow, shared by the classic scope guard (hooks/scope-guard.mjs) and the mod's shell
// check, so that the two cannot accept different roots. Pure: each caller reads the file system its own way (the hook
// with node:fs, the mod through $.fs) and passes what it found.

const NAME = 'SESSION_HUB_SCOPE_ROOT';

const SETTINGS_NAME = /^settings[^/]*\.json$/;

// An absolute path on macOS, Linux or Windows: `/…`, `\…`, `C:\…`, `C:/…` or a network share `\\server\share`.
// `C:repo` is relative to the current folder of drive C:, so it is not absolute.
const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/;

// The top of a file system: `/`, `\`, `C:\` or `C:/`. A write root there would cover every file on the drive.
const FILE_SYSTEM_TOP = /^(?:[A-Za-z]:)?[\\/]$/;

// Windows separators as `/`, without a trailing separator; `/` stays `/`.
const slashed = (path) => path.replaceAll('\\', '/').replace(/(.)\/+$/, '$1');

/**
 * Whether `path` is the repository's Claude Code settings, `<root>/.claude/settings*.json`. Their `env` and hook
 * settings can turn a child's guards off (issue #56), so a child may not write them. Both paths are absolute and
 * normalised, with either separator; the comparison ignores case, as the usual macOS and Windows file systems do.
 * @param {string} path
 * @param {string} root
 */
export function isRootSettings(path, root) {
  const top = slashed(root);
  const folder = `${top.endsWith('/') ? top : `${top}/`}.claude/`.toLowerCase();
  const lower = slashed(path).toLowerCase();
  return lower.startsWith(folder) && SETTINGS_NAME.test(lower.slice(folder.length));
}

/** Why a write to the repository's settings is blocked; the caller adds the route to the master. */
export const settingsReason = (path) =>
  `${path} is this repository's Claude Code settings file. Its env and hook settings can turn this child's guards ` +
  'off, so a child does not change it: the master does, if the change is needed.';

/**
 * The root as configured: set and absolute, as a POSIX or a Windows path. Returns it unchanged.
 * @param {unknown} raw
 * @returns {string}
 */
export function checkRootSetting(raw) {
  if (typeof raw !== 'string' || raw === '') throw new Error(`${NAME} is not set`);
  if (!ABSOLUTE.test(raw)) throw new Error(`${NAME} is not an absolute path (${raw})`);
  return raw;
}

/**
 * The root on disk: an existing folder, neither the top of a file system (`/`, `C:\`) nor the home folder. Returns its real path.
 * @param {{ raw: string, real: string, kind: 'dir' | 'other' | 'missing', home?: string }} found  `real` is the root
 *   with its links resolved, `kind` what it is, `home` the real home folder when it is known
 * @returns {string}
 */
export function checkRootFolder({ raw, real, kind, home }) {
  if (kind === 'missing') throw new Error(`${NAME} does not exist (${raw})`);
  if (kind !== 'dir') throw new Error(`${NAME} is not a directory (${raw})`);
  if (FILE_SYSTEM_TOP.test(real) || (home !== undefined && real === home)) {
    throw new Error(`${NAME} is too wide (${raw}): a write root may not be / or the home folder`);
  }
  return real;
}

// The rules a write root must follow, shared by the classic scope guard (hooks/scope-guard.mjs) and the mod's shell
// check, so that the two cannot accept different roots. Pure: each caller reads the file system its own way (the hook
// with node:fs, the mod through $.fs) and passes what it found.

const NAME = 'SESSION_HUB_SCOPE_ROOT';

/**
 * The root as configured: set and absolute. Returns it unchanged.
 * @param {unknown} raw
 * @returns {string}
 */
export function checkRootSetting(raw) {
  if (typeof raw !== 'string' || raw === '') throw new Error(`${NAME} is not set`);
  if (!raw.startsWith('/')) throw new Error(`${NAME} is not an absolute path (${raw})`);
  return raw;
}

/**
 * The root on disk: an existing folder, neither `/` nor the home folder. Returns its real path.
 * @param {{ raw: string, real: string, kind: 'dir' | 'other' | 'missing', home?: string }} found  `real` is the root
 *   with its links resolved, `kind` what it is, `home` the real home folder when it is known
 * @returns {string}
 */
export function checkRootFolder({ raw, real, kind, home }) {
  if (kind === 'missing') throw new Error(`${NAME} does not exist (${raw})`);
  if (kind !== 'dir') throw new Error(`${NAME} is not a directory (${raw})`);
  if (real === '/' || (home !== undefined && real === home)) {
    throw new Error(`${NAME} is too wide (${raw}): a write root may not be / or the home folder`);
  }
  return real;
}

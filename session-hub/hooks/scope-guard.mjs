#!/usr/bin/env node
// session-hub-scope-guard: PreToolUse hook on Edit, Write and NotebookEdit.
//
// In a child session (SESSION_HUB_ROLE=child) it blocks a file write whose real path is not under
// SESSION_HUB_SCOPE_ROOT, and a write to an existing file with more than one hard link (a hard link has no real path
// that leads elsewhere, so another name of the file may be outside the root), and a write to the repository's Claude
// Code settings, <root>/.claude/settings*.json, whose env and hook settings could turn the guards off. It does
// nothing in any other session, or when SESSION_HUB_GUARDS=off.
// It fails closed: when it cannot evaluate a call in a child, it blocks and says why.
//
// Output contract: exit 0 with no output allows the call; exit 2 with the reason on stderr blocks it,
// and the reason is shown to the model.

import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRootFolder, checkRootSetting, isRootSettings, settingsReason } from './mod/write-root.mjs';

// A path without `.`, `..` or a trailing separator, as written.
const asWritten = (path) => nodePath.normalize(String(path)).replace(/(.)[\\/]+$/, '$1');

const PREFIX = '[session-hub]';
// Path fields per tool, in the order they are looked up.
const WRITE_TOOLS = Object.freeze({
  Edit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path'],
});
// Role values that mean "not a child": the guard stays out of the way.
const INACTIVE_ROLES = Object.freeze(['', 'none', 'master']);
const EXIT_BLOCK = 2;
// The hook's timeout in hooks.json is 10 s; a killed hook lets the call through, so give up well before.
const WATCHDOG_MS = 7000;

const ALLOW = Object.freeze({ allow: true });

const block = (why) => Object.freeze({ allow: false, reason: `${PREFIX} Write blocked: ${why}` });

const outOfScopeAdvice =
  'Do not retry this write through the shell or any other tool. Send an `out-of-scope` message to the master ' +
  '(prefix `[<task> <repo>] out-of-scope:`), saying what you need written and why, and tell the user that you ' +
  'passed the request to the master.';

const normalize = (value) => String(value ?? '').trim().toLowerCase();

// 'inactive' (not a child, or guards off), 'child', or 'invalid' (a role value the guard does not know).
export function guardMode(env) {
  const role = normalize(env.SESSION_HUB_ROLE);
  if (INACTIVE_ROLES.includes(role)) return 'inactive';
  if (normalize(env.SESSION_HUB_GUARDS) === 'off') return 'inactive';
  return role === 'child' ? 'child' : 'invalid';
}

const realpath = (path) => realpathSync.native(path);

function scopeRoot(env) {
  const raw = checkRootSetting(env.SESSION_HUB_SCOPE_ROOT);
  let real;
  try {
    real = realpath(raw);
  } catch {
    return checkRootFolder({ raw, real: raw, kind: 'missing' });
  }
  const kind = statSync(real).isDirectory() ? 'dir' : 'other';
  return checkRootFolder({ raw, real, kind, home: realpath(homedir()) });
}

// A file with several names: one of them may be outside the root, and a path cannot tell where the others are.
function hardLinks(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() ? stat.nlink : 1;
  } catch (error) {
    if (error.code === 'ENOENT') return 1;
    throw error;
  }
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Resolves an absolute path component by component, following symbolic links in the parts that exist, so that
// `..` after a link goes to the link target's parent, as the file system does. Parts that do not exist yet are
// kept as written. A dangling link makes realpath fail, which the caller turns into a block.
// The walk starts from the path's own root (`/`, a drive such as `C:\`, or a share `\\server\share\`), never from a
// part of it (issue #89). `path`, `realpath` and `exists` are replaceable so that tests can walk Windows paths.
export function resolveTarget(absolutePath, { path = nodePath, realpath: realOf = realpath, exists: isThere = exists } = {}) {
  const { root } = path.parse(absolutePath);
  const separators = path.sep === '\\' ? /[\\/]/ : '/';
  let current = realOf(path.normalize(root));
  for (const part of absolutePath.slice(root.length).split(separators)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, part);
    current = isThere(next) ? realOf(next) : next;
  }
  return current;
}

export const isUnder = (path, root, { sep } = nodePath) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

function targetPath(input) {
  const fields = WRITE_TOOLS[input.tool_name];
  const raw = fields.map((field) => input.tool_input?.[field]).find((value) => typeof value === 'string' && value);
  if (!raw) throw new Error(`the ${input.tool_name} call has no ${fields.join(' or ')}`);
  if (!nodePath.isAbsolute(raw)) throw new Error(`${raw} is not an absolute path`);
  return raw;
}

export function evaluate(input, env) {
  const mode = guardMode(env);
  if (mode === 'inactive') return ALLOW;
  try {
    if (mode === 'invalid') {
      throw new Error(`SESSION_HUB_ROLE has an unknown value (${env.SESSION_HUB_ROLE}); expected child`);
    }
    const root = scopeRoot(env);
    if (input === null || typeof input !== 'object' || typeof input.tool_name !== 'string') {
      throw new Error('the hook input has no tool name');
    }
    if (!Object.hasOwn(WRITE_TOOLS, input.tool_name)) return ALLOW;
    const raw = targetPath(input);
    const target = resolveTarget(raw);
    if (!isUnder(target, root)) return block(`${raw} is outside this child's write root ${root}. ${outOfScopeAdvice}`);
    // Checked on the real path and as written, against the root as resolved and as configured.
    if (isRootSettings(target, root) || isRootSettings(asWritten(raw), asWritten(env.SESSION_HUB_SCOPE_ROOT))) {
      return block(`${settingsReason(raw)} ${outOfScopeAdvice}`);
    }
    const names = hardLinks(target);
    if (names <= 1) return ALLOW;
    return block(
      `${raw} is a hard link (the file has ${names} names), and the guard cannot tell whether another name is ` +
        `outside this child's write root ${root}: a write here would change the file under every name. ${outOfScopeAdvice}`,
    );
  } catch (error) {
    return block(
      `the scope guard could not evaluate this call (${error.message}). A guard that cannot evaluate does not ` +
        `let the call pass. Tell the user, and ask the master if the scope is wrong.`,
    );
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function exitBlocked(reason) {
  process.stderr.write(`${reason}\n`, () => process.exit(EXIT_BLOCK));
}

function startWatchdog(env) {
  const configured = Number(env.SESSION_HUB_GUARD_WATCHDOG_MS);
  const ms = Number.isFinite(configured) && configured > 0 ? Math.min(configured, WATCHDOG_MS) : WATCHDOG_MS;
  const timer = setTimeout(() => {
    exitBlocked(block(`the scope guard did not finish within ${ms} ms, so the call is not allowed.`).reason);
  }, ms);
  timer.unref();
}

async function main() {
  const env = process.env;
  // Decide before reading stdin, so a session that is not a child never waits on its input.
  if (guardMode(env) === 'inactive') return 0;
  startWatchdog(env);
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (error) {
    process.stderr.write(`${block(`the hook input could not be read as JSON (${error.message}).`).reason}\n`);
    return EXIT_BLOCK;
  }
  const result = evaluate(input, env);
  if (result.allow) return 0;
  process.stderr.write(`${result.reason}\n`);
  return EXIT_BLOCK;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // Set the exit code rather than calling process.exit, so stderr is flushed to a pipe before the process ends.
  main().then(
    (code) => {
      process.exitCode = code;
      if (guardMode(process.env) === 'inactive') process.stdin.destroy();
    },
    (error) => {
      const active = guardMode(process.env) !== 'inactive';
      process.stderr.write(`${PREFIX} Write blocked: the scope guard failed (${error?.message ?? error}).\n`);
      process.exitCode = active ? EXIT_BLOCK : 0;
    },
  );
}

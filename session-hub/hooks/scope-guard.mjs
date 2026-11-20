#!/usr/bin/env node
// session-hub-scope-guard: PreToolUse hook on Edit, Write and NotebookEdit.
//
// In a child session (SESSION_HUB_ROLE=child) it blocks a file write whose real path is not under
// SESSION_HUB_SCOPE_ROOT. It does nothing in any other session, or when SESSION_HUB_GUARDS=off.
// It fails closed: when it cannot evaluate a call in a child, it blocks and says why.
//
// Output contract: exit 0 with no output allows the call; exit 2 with the reason on stderr blocks it,
// and the reason is shown to the model.

import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const raw = env.SESSION_HUB_SCOPE_ROOT;
  if (typeof raw !== 'string' || raw === '' || !isAbsolute(raw)) {
    throw new Error(`SESSION_HUB_SCOPE_ROOT is ${raw ? `not an absolute path (${raw})` : 'not set'}`);
  }
  let real;
  try {
    real = realpath(raw);
  } catch {
    throw new Error(`SESSION_HUB_SCOPE_ROOT does not exist (${raw})`);
  }
  if (!statSync(real).isDirectory()) throw new Error(`SESSION_HUB_SCOPE_ROOT is not a directory (${raw})`);
  if (real === realpath(sep) || real === realpath(homedir())) {
    throw new Error(`SESSION_HUB_SCOPE_ROOT is too wide (${raw}): a write root may not be / or the home folder`);
  }
  return real;
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
export function resolveTarget(absolutePath) {
  let current = realpath(sep);
  for (const part of absolutePath.split(sep)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      current = dirname(current);
      continue;
    }
    const next = current === sep ? `${sep}${part}` : `${current}${sep}${part}`;
    current = exists(next) ? realpath(next) : next;
  }
  return current;
}

const isUnder = (path, root) => path === root || path.startsWith(`${root}${sep}`);

function targetPath(input) {
  const fields = WRITE_TOOLS[input.tool_name];
  const raw = fields.map((field) => input.tool_input?.[field]).find((value) => typeof value === 'string' && value);
  if (!raw) throw new Error(`the ${input.tool_name} call has no ${fields.join(' or ')}`);
  if (!isAbsolute(raw)) throw new Error(`${raw} is not an absolute path`);
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
    if (isUnder(target, root)) return ALLOW;
    return block(`${raw} is outside this child's write root ${root}. ${outOfScopeAdvice}`);
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

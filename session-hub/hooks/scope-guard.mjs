#!/usr/bin/env node
// session-hub-scope-guard: PreToolUse hook on Edit, Write and NotebookEdit.
//
// In a child session (SESSION_HUB_ROLE=child) it blocks a file write whose real path is not under
// SESSION_HUB_SCOPE_ROOT. It does nothing in any other session, or when SESSION_HUB_GUARDS=off.
// It fails closed: when it cannot evaluate a call in a child, it blocks and says why.
//
// Output contract: exit 0 with no output allows the call; exit 2 with the reason on stderr blocks it,
// and the reason is shown to the model.

import { lstatSync, realpathSync, statSync, readFileSync } from 'node:fs';
import { isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = '[session-hub]';
// Path fields per tool, in the order they are looked up.
const WRITE_TOOLS = Object.freeze({
  Edit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path'],
});
const EXIT_BLOCK = 2;

const ALLOW = Object.freeze({ allow: true });

const block = (why) => Object.freeze({ allow: false, reason: `${PREFIX} Write blocked: ${why}` });

const outOfScopeAdvice =
  'Do not retry this write through the shell or any other tool. Send an `out-of-scope` message to the master ' +
  '(prefix `[<task> <repo>] out-of-scope:`), saying what you need written and why, and tell the user that you ' +
  'passed the request to the master.';

export function isActive(env) {
  if (env.SESSION_HUB_ROLE !== 'child') return false;
  return String(env.SESSION_HUB_GUARDS ?? 'on').trim().toLowerCase() !== 'off';
}

function scopeRoot(env) {
  const raw = env.SESSION_HUB_SCOPE_ROOT;
  if (typeof raw !== 'string' || raw === '' || !isAbsolute(raw)) {
    throw new Error(`SESSION_HUB_SCOPE_ROOT is ${raw ? `not an absolute path (${raw})` : 'not set'}`);
  }
  let real;
  try {
    real = realpathSync(raw);
  } catch {
    throw new Error(`SESSION_HUB_SCOPE_ROOT does not exist (${raw})`);
  }
  if (!statSync(real).isDirectory()) throw new Error(`SESSION_HUB_SCOPE_ROOT is not a directory (${raw})`);
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
  let current = realpathSync(sep);
  for (const part of absolutePath.split(sep)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      current = dirname(current);
      continue;
    }
    const next = current === sep ? `${sep}${part}` : `${current}${sep}${part}`;
    current = exists(next) ? realpathSync(next) : next;
  }
  return current;
}

const isUnder = (path, root) => path === root || path.startsWith(root === sep ? sep : `${root}${sep}`);

function targetPath(input) {
  const fields = WRITE_TOOLS[input.tool_name];
  const raw = fields.map((field) => input.tool_input?.[field]).find((value) => typeof value === 'string' && value);
  if (!raw) throw new Error(`the ${input.tool_name} call has no ${fields.join(' or ')}`);
  if (isAbsolute(raw)) return raw;
  const cwd = typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : process.cwd();
  return `${cwd}${sep}${raw}`;
}

export function evaluate(input, env) {
  if (!isActive(env)) return ALLOW;
  try {
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

function main() {
  const env = process.env;
  if (!isActive(env)) return 0;
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
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
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${PREFIX} Write blocked: the scope guard failed (${error?.message ?? error}).\n`);
    process.exitCode = isActive(process.env) ? EXIT_BLOCK : 0;
  }
}

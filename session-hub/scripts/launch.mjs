#!/usr/bin/env node
// How this session was started, so that a session it starts gets the same identity, configuration and permission
// mode. Users often start Claude Code through an alias or a wrapper; what the wrapper did is visible from inside
// the session (its environment, the arguments of its `claude` process), and that is what this script reads.
//
// Usage, from the session's own shell:
//   launch.mjs [--carry <NAME,NAME,...>]
//
// Prints JSON:
//   env         identity variables to set for the new session: only the names below, plus those of --carry
//   flags       arguments of this session's `claude` that configure a session, to repeat as they are
//   model, effort   this session's own, when its launch set them (never carried: the new session gets its own)
//   permission  { bypass, flags }: whether this session was started bypassing permission prompts, and with what
//   unsure      what could not be read for certain; ask the user about each line before starting anything
//
// It never prints the environment: only the named variables, which hold paths and profile names, never tokens.
// Exit 0 with the JSON; exit 1 with a `[session-hub]` message when --carry is malformed.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Variables a launcher sets to choose the account and the configuration. HOME is carried only when it is not the
// account's own home.
export const IDENTITY_VARIABLES = Object.freeze([
  'HOME',
  'CLAUDE_CONFIG_DIR',
  'SHALLOW_PROFILE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
]);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A name that looks like a credential is refused even when asked for: it would land on command lines and in panes.
const SECRET = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|AUTH)/i;

// one: exactly one value. many: every argument up to the next flag. optional: a value only if one follows.
const CARRIED = Object.freeze({
  '--settings': 'one',
  '--mcp-config': 'many',
  '--strict-mcp-config': 'none',
  '--plugin-dir': 'one',
  '--setting-sources': 'one',
  '--agent': 'one',
  '--append-system-prompt': 'one',
});
const DROPPED = Object.freeze({
  '-n': 'one',
  '--name': 'one',
  '-r': 'optional',
  '--resume': 'optional',
  '-c': 'none',
  '--continue': 'none',
  '--session-id': 'one',
  '--fork-session': 'none',
  '-p': 'none',
  '--print': 'none',
  '--bg': 'none',
  '-w': 'optional',
  '--worktree': 'optional',
  '--add-dir': 'many',
});
const BYPASS_FLAG = '--dangerously-skip-permissions';
const BYPASS_MODE = 'bypassPermissions';

export class LaunchError extends Error {}

const isFlag = (text) => text.startsWith('-') && text !== '-';

// The values a flag takes from `rest`, by its kind.
function take(kind, rest) {
  if (kind === 'none') return [];
  const free = [];
  for (const arg of rest) {
    if (isFlag(arg)) break;
    free.push(arg);
  }
  if (kind === 'many') return free;
  return free.slice(0, 1);
}

/**
 * Reads the arguments of a `claude` command. `exact` says the list is the real argument vector; otherwise it was
 * split on spaces from `ps`, and a value with a space in it cannot be told from two arguments.
 * @param {string[]} args arguments after `claude`
 * @param {{ exact?: boolean }} [how]
 */
export function readArguments(args, { exact = false } = {}) {
  const flags = [];
  const unsure = [];
  const permissionFlags = [];
  let model;
  let effort;
  let bypass = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if (!isFlag(arg)) continue; // a prompt, or the value of a flag already read
    const cut = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = cut < 0 ? arg : arg.slice(0, cut);
    const inline = cut < 0 ? undefined : arg.slice(cut + 1);
    const rest = args.slice(i + 1);
    const valueOf = (kind) => (inline !== undefined ? [inline] : take(kind, rest));
    if (name === BYPASS_FLAG) {
      bypass = true;
      permissionFlags.push(BYPASS_FLAG);
    } else if (name === '--permission-mode') {
      const [mode] = valueOf('one');
      if (mode === undefined) unsure.push('--permission-mode has no value');
      else {
        permissionFlags.push('--permission-mode', mode);
        if (mode === BYPASS_MODE) bypass = true;
      }
      if (inline === undefined && mode !== undefined) i += 1;
    } else if (name === '--model' || name === '--effort') {
      const [value] = valueOf('one');
      if (name === '--model') model = value;
      else effort = value;
      if (inline === undefined && value !== undefined) i += 1;
    } else if (name in CARRIED) {
      const kind = CARRIED[name];
      const values = valueOf(kind);
      if (kind !== 'none' && values.length === 0) {
        unsure.push(`${name} has no value: not carried`);
      } else {
        // Split on spaces, a one-value flag followed by more free words may be one value with spaces, or a prompt.
        const spare = inline === undefined && kind === 'one' ? take('many', rest).length - 1 : 0;
        if (!exact && spare > 0) {
          unsure.push(`${name}: its value may contain spaces, which the process list does not show; ask the user for it`);
        }
        flags.push(...(inline !== undefined ? [arg] : [name, ...values]));
      }
      if (inline === undefined) i += values.length;
    } else if (name in DROPPED) {
      if (inline === undefined) i += take(DROPPED[name], rest).length;
    } else {
      unsure.push(`${name} is not a flag this script knows: not carried`);
    }
  }
  return { flags, model, effort, permission: { bypass, flags: permissionFlags }, unsure };
}

// True for the command of a Claude Code session: `claude …`, or `node …/claude …`, or `node …/cli.js` of the package.
function claudeArguments(argv) {
  const [first, second, ...rest] = argv;
  if (first === undefined) return undefined;
  if (basename(first) === 'claude') return [second, ...rest].filter((arg) => arg !== undefined);
  if (/^(node|bun)(\.exe)?$/.test(basename(first)) && second !== undefined) {
    if (basename(second) === 'claude' || /claude-code\/cli\.(m?js)$/.test(second)) return rest;
  }
  return undefined;
}

// A process as { ppid, argv, exact }, or undefined when it cannot be read. Linux gives the real argument vector;
// elsewhere `ps` gives one line, split on spaces.
function systemProcess(pid) {
  let line;
  try {
    line = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
  const match = /^(\d+)\s+(.*)$/s.exec(line);
  if (!match) return undefined;
  const ppid = Number(match[1]);
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (argv.at(-1) === '') argv.pop();
    if (argv.length > 0) return { ppid, argv, exact: true };
  } catch {
    // No /proc (macOS): the `ps` line it is.
  }
  return { ppid, argv: match[2].split(/\s+/).filter(Boolean), exact: false };
}

const MAX_DEPTH = 32;

/** The nearest ancestor that is a Claude Code session: `{ pid, args, exact }`, or undefined. */
export function findClaude(startPid, readProcess = systemProcess) {
  let pid = startPid;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const found = readProcess(pid);
    if (!found) return undefined;
    const args = claudeArguments(found.argv);
    if (args) return { pid, args, exact: found.exact };
    pid = found.ppid;
  }
  return undefined;
}

/** The names of `--carry`, checked. */
export function carryNames(text) {
  if (text === undefined) return [];
  const names = String(text).split(',').map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!NAME.test(name)) throw new LaunchError(`--carry: "${name}" is not a variable name`);
    if (SECRET.test(name)) throw new LaunchError(`--carry: ${name} looks like a credential and is never put on a command line`);
  }
  return names;
}

/** The identity variables to set for a new session, from this one's environment. */
export function identityEnv(env, accountHome, extra = []) {
  const out = {};
  for (const name of [...IDENTITY_VARIABLES, ...extra]) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    if (name === 'HOME' && accountHome !== undefined && value === accountHome) continue;
    out[name] = value;
  }
  return out;
}

/**
 * @param {{ env?: Record<string, string | undefined>, accountHome?: string, startPid?: number, carry?: string[],
 *   readProcess?: (pid: number) => { ppid: number, argv: string[], exact: boolean } | undefined }} [given]
 */
export function describeLaunch({ env = process.env, accountHome, startPid = process.ppid, carry = [], readProcess } = {}) {
  const unsure = [];
  const claude = findClaude(startPid, readProcess);
  if (!claude) unsure.push('the `claude` process of this session was not found: ask the user for the command that started it');
  const read = readArguments(claude?.args ?? [], { exact: claude?.exact });
  for (const name of carry) {
    if (env[name] === undefined || env[name] === '') unsure.push(`${name} (--carry) is not set in this session: not carried`);
  }
  return {
    env: identityEnv(env, accountHome, carry),
    flags: read.flags,
    model: read.model ?? null,
    effort: read.effort ?? null,
    permission: read.permission,
    unsure: [...unsure, ...read.unsure],
  };
}

function accountHomeOf() {
  try {
    return userInfo().homedir;
  } catch {
    return undefined;
  }
}

export function runCli(argv) {
  let carry;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--carry' && carry === undefined && argv[i + 1] !== undefined) {
      carry = argv[i + 1];
      i += 1;
    } else {
      throw new LaunchError(`usage: launch.mjs [--carry <NAME,NAME,...>] (got ${argv[i]})`);
    }
  }
  return JSON.stringify(describeLaunch({ accountHome: accountHomeOf(), carry: carryNames(carry) }), null, 2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${runCli(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`[session-hub] launch: ${error.message}\n`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
// The children record of a session-hub master: one JSON file, written whole and atomically on every change,
// under an exclusive lock so that concurrent writers lose no entry.
//
// Default location: <config dir>/session-hub/children-<hub id>.json, where <config dir> is CLAUDE_CONFIG_DIR (absolute,
// or starting with ~) or ~/.claude and <hub id> is the first 16 hex digits of the sha256 of the hub's real path (NFC).
// Never inside a hub: every path is judged where it really lands before anything is written.
//
// Usage (a write with --file needs --hub too, so that the file can be checked against the hub):
//   registry.mjs path      --hub <dir>
//   registry.mjs read      (--hub <dir> | --file <path>)
//   registry.mjs upsert    --hub <dir> [--file <path>] --entry '<json>'
//   registry.mjs status    --hub <dir> [--file <path>] --name <child> --status <status> [--reason <text>]
//   registry.mjs request   --hub <dir> [--file <path>] --name <child> --text <text> [--outcome <text>]
//   registry.mjs reconcile --hub <dir> [--file <path>] (--live <name,name,...> | --live-none)
//
// Exit 0 on success, with JSON on stdout (the path for `path`); exit 1 with a `[session-hub]` message on stderr.
// A file that cannot be read as a record, or was written by a newer format, is reported and never overwritten.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = Object.freeze(['running', 'waiting-user', 'done', 'abandoned', 'lost']);
const LIVE_STATUSES = Object.freeze(['running', 'waiting-user']);
// Fields an upsert never changes on an existing entry: `started` is set once, `requests` grows only by `request`.
const KEPT_ON_UPSERT = Object.freeze(['started', 'requests']);
const FORMAT_VERSION = 1;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30_000;
const LOCK_BACKOFF_MAX_MS = 200;

export class RegistryError extends Error {}

// The config folder: CLAUDE_CONFIG_DIR, with a leading `~` or `~/` expanded, else ~/.claude. A relative one would
// depend on the current folder (and could land inside a repository), so it is refused.
export function configDir(env = process.env, home = homedir()) {
  const configured = env.CLAUDE_CONFIG_DIR;
  if (!configured) return join(home, '.claude');
  const expanded = configured === '~' || configured.startsWith('~/') ? join(home, configured.slice(1)) : configured;
  if (!isAbsolute(expanded)) {
    throw new RegistryError(`CLAUDE_CONFIG_DIR is not an absolute path (${configured}); the record would depend on the current folder`);
  }
  return expanded;
}

function realHub(hub) {
  try {
    return realpathSync.native(hub).normalize('NFC');
  } catch {
    throw new RegistryError(`hub folder not found: ${hub}`);
  }
}

export function hubId(hub) {
  return createHash('sha256').update(realHub(hub)).digest('hex').slice(0, 16);
}

export function defaultRegistryPath(hub, env = process.env) {
  return join(configDir(env), 'session-hub', `children-${hubId(hub)}.json`);
}

const emptyRecord = () => ({ version: FORMAT_VERSION, hub: null, children: [] });

function validateRecord(record, file) {
  const shapeError = (what) => new RegistryError(`${file} is not a children record: ${what}. Fix or move it by hand.`);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw shapeError('not an object');
  if (!Array.isArray(record.children)) throw shapeError('`children` is not a list');
  for (const child of record.children) {
    if (child === null || typeof child !== 'object' || typeof child.name !== 'string') {
      throw shapeError('an entry has no name');
    }
  }
  return record;
}

export function readRecord(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyRecord();
    throw new RegistryError(`cannot read ${file}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RegistryError(`${file} is not valid JSON (${error.message}). Fix or move it by hand.`);
  }
  return validateRecord(parsed, file);
}

// Synchronous sleep, so the helper stays a plain synchronous command.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function removeIfStale(lock) {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function acquireLock(file, timeoutMs) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + timeoutMs;
  let wait = 10;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return lock;
    } catch (error) {
      if (error.code !== 'EEXIST') throw new RegistryError(`cannot create the lock ${lock}: ${error.message}`);
    }
    removeIfStale(lock);
    if (Date.now() >= deadline) {
      throw new RegistryError(
        `could not take the lock ${lock} within ${timeoutMs} ms: another process is writing the record. ` +
          `Nothing was written. Retry; if no other process holds it, remove the lock file.`,
      );
    }
    sleep(wait);
    wait = Math.min(wait * 2, LOCK_BACKOFF_MAX_MS);
  }
}

function syncDirectory(dir) {
  // Makes the rename durable. Some file systems refuse fsync on a directory; the data itself is already synced.
  let fd;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeRecord(file, record) {
  const dir = dirname(file);
  const temp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
    syncDirectory(dir);
  } catch (error) {
    rmSync(temp, { force: true });
    throw new RegistryError(`cannot write ${file}: ${error.message}`);
  }
  return record;
}

function checkStatus(status) {
  if (!STATUSES.includes(status)) {
    throw new RegistryError(`unknown status "${status}"; use one of ${STATUSES.join(', ')}`);
  }
}

// Reads, changes and writes the record under the lock. `change` returns the new record, or null to write nothing.
function update(file, options, change) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = acquireLock(file, options.lockTimeoutMs ?? LOCK_TIMEOUT_MS);
  try {
    const record = readRecord(file);
    if (typeof record.version === 'number' && record.version > FORMAT_VERSION) {
      throw new RegistryError(
        `${file} was written by a newer format (version ${record.version}); this helper writes version ` +
          `${FORMAT_VERSION} and will not rewrite it. Update the session-hub plugin.`,
      );
    }
    const next = change(record);
    if (next === null) return record;
    const hub = options.hub ? realHub(options.hub) : record.hub ?? null;
    return writeRecord(file, { ...next, version: FORMAT_VERSION, hub });
  } finally {
    rmSync(lock, { force: true });
  }
}

function findIndex(record, name) {
  const index = record.children.findIndex((child) => child.name === name);
  if (index < 0) throw new RegistryError(`no child named "${name}" in the record`);
  return index;
}

const replaceAt = (list, index, item) => list.map((existing, i) => (i === index ? item : existing));

const withoutKept = (entry) =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => !KEPT_ON_UPSERT.includes(key)));

export function upsertChild(file, entry, options = {}) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new RegistryError('the entry must be a JSON object');
  }
  if (typeof entry.name !== 'string' || entry.name === '') throw new RegistryError('the entry has no name');
  if (entry.status !== undefined) checkStatus(entry.status);
  const now = options.now ?? (() => new Date().toISOString());
  return update(file, options, (record) => {
    const index = record.children.findIndex((child) => child.name === entry.name);
    const created = () => ({ status: 'running', started: now(), requests: [], ...entry });
    if (index < 0) return { ...record, children: [...record.children, created()] };
    const existing = record.children[index];
    // A child started again under the name of one that ended is a new child: it gets a fresh entry, not the old
    // one's start time, requests or other fields.
    const restarted = !LIVE_STATUSES.includes(existing.status) && LIVE_STATUSES.includes(entry.status);
    const next = restarted ? created() : { ...existing, ...withoutKept(entry) };
    return { ...record, children: replaceAt(record.children, index, next) };
  });
}

// Sets a child's status, with the reason when one is given (why it was abandoned, say). The reason belongs to that
// status: a later status without one drops it.
export function setStatus(file, name, status, options = {}) {
  checkStatus(status);
  if (options.reason !== undefined && (typeof options.reason !== 'string' || options.reason.trim() === '')) {
    throw new RegistryError('--reason is empty');
  }
  return update(file, options, (record) => {
    const index = findIndex(record, name);
    const { reason: _previous, ...child } = record.children[index];
    const next = options.reason === undefined ? { ...child, status } : { ...child, status, reason: options.reason };
    return { ...record, children: replaceAt(record.children, index, next) };
  });
}

export function addRequest(file, name, request, options = {}) {
  if (typeof request?.text !== 'string' || request.text === '') throw new RegistryError('the request has no text');
  const now = options.now ?? (() => new Date().toISOString());
  return update(file, options, (record) => {
    const index = findIndex(record, name);
    const child = record.children[index];
    const requests = [...(Array.isArray(child.requests) ? child.requests : []), { at: now(), ...request }];
    return { ...record, children: replaceAt(record.children, index, { ...child, requests }) };
  });
}

// Marks as `lost` every running or waiting child missing from the live session list. An empty list would mark
// them all, so it needs `noneLive: true` to say that there really is no live session.
export function reconcile(file, liveNames, options = {}) {
  if (liveNames.length === 0 && !options.noneLive) {
    throw new RegistryError('the live session list is empty; pass --live-none if no session is live');
  }
  const live = new Set(liveNames);
  let changed = [];
  const record = update(file, options, (current) => {
    changed = current.children
      .filter((child) => LIVE_STATUSES.includes(child.status) && !live.has(child.name))
      .map((child) => child.name);
    if (changed.length === 0) return null;
    return {
      ...current,
      children: current.children.map((child) => (changed.includes(child.name) ? { ...child, status: 'lost' } : child)),
    };
  });
  return { record, changed };
}

// Command line

// The options each command takes. Anything else is refused, so that a typo cannot change what a call does.
const COMMAND_OPTIONS = Object.freeze({
  path: ['hub'],
  read: ['hub', 'file'],
  upsert: ['hub', 'file', 'entry'],
  status: ['hub', 'file', 'name', 'status', 'reason'],
  request: ['hub', 'file', 'name', 'text', 'outcome'],
  reconcile: ['hub', 'file', 'live', 'live-none'],
});
const COMMANDS = Object.freeze(Object.keys(COMMAND_OPTIONS));
const FLAGS = Object.freeze(['live-none']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new RegistryError(`unknown command "${command}"; use ${COMMANDS.join(', ')}`);
  const accepted = COMMAND_OPTIONS[command];
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key?.startsWith('--')) throw new RegistryError(`bad argument "${key}"`);
    const name = key.slice(2);
    if (!accepted.includes(name)) {
      throw new RegistryError(`unknown option --${name} for ${command}; it takes ${accepted.map((o) => `--${o}`).join(', ')}`);
    }
    if (Object.hasOwn(options, name)) throw new RegistryError(`--${name} is given twice`);
    if (FLAGS.includes(name)) {
      options[name] = true;
      continue;
    }
    if (i + 1 >= rest.length) throw new RegistryError(`--${name} needs a value`);
    options[name] = rest[i + 1];
    i += 1;
  }
  if (options.live !== undefined && options['live-none']) {
    throw new RegistryError('--live and --live-none say opposite things; give one of them');
  }
  return { command, options };
}

function required(options, key) {
  if (options[key] === undefined) throw new RegistryError(`--${key} is required`);
  return options[key];
}

function isInside(path, dir) {
  return path === dir || path.startsWith(`${dir}${sep}`);
}

// Where a path really lands: the deepest part of it that exists, with its links resolved, and the rest as written.
function landing(path) {
  const missing = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing).normalize('NFC');
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw new RegistryError(`cannot resolve ${path}: ${error.message}`);
      const parent = dirname(current);
      if (parent === current) return resolve(path).normalize('NFC');
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

// The record may never live inside the hub (AGENTS.md: no state files inside a hub or a repository). Judged where the
// file would land, before any folder is made, so neither an alias nor a link to the hub nor a folder not made yet
// gets past it.
function checkOutsideHub(file, hubDir) {
  if (isInside(landing(file), realHub(hubDir))) throw new RegistryError(`the record may not live inside the hub: ${file}`);
  return file;
}

const WRITES = Object.freeze(['upsert', 'status', 'request', 'reconcile']);

function resolveFile(command, options) {
  if (options.file) {
    if (!isAbsolute(options.file)) throw new RegistryError(`--file must be an absolute path: ${options.file}`);
    const file = resolve(options.file);
    if (options.hub) return checkOutsideHub(file, options.hub);
    if (WRITES.includes(command)) {
      throw new RegistryError(`a write with --file needs --hub <dir> too, so that the file can be checked against the hub`);
    }
    return file;
  }
  if (options.hub) return checkOutsideHub(defaultRegistryPath(options.hub), options.hub);
  throw new RegistryError('give --hub <dir> or --file <path>');
}

function parseEntry(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RegistryError(`--entry is not valid JSON (${error.message})`);
  }
}

function liveNames(options) {
  if (options['live-none']) return [];
  const names = required(options, 'live').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new RegistryError('--live is empty; pass --live-none if no session is live');
  return names;
}

// Returns { out, note }: `out` goes to stdout, `note` (if any) to stderr.
export function runCli(argv) {
  const { command, options } = parseArgs(argv);
  if (command === 'path') {
    const hub = required(options, 'hub');
    return { out: checkOutsideHub(defaultRegistryPath(hub), hub) };
  }
  const file = resolveFile(command, options);
  const hub = options.hub ? { hub: options.hub } : {};
  const json = (value) => ({ out: JSON.stringify(value, null, 2) });
  switch (command) {
    case 'read': {
      const note = existsSync(file) ? undefined : `no record yet at ${file}`;
      return { ...json(readRecord(file)), note };
    }
    case 'upsert':
      return json(upsertChild(file, parseEntry(required(options, 'entry')), hub));
    case 'status':
      return json(setStatus(file, required(options, 'name'), required(options, 'status'), { ...hub, reason: options.reason }));
    case 'request': {
      const request = { text: required(options, 'text'), ...(options.outcome ? { outcome: options.outcome } : {}) };
      return json(addRequest(file, required(options, 'name'), request, hub));
    }
    case 'reconcile': {
      const live = liveNames(options);
      const { changed } = reconcile(file, live, { ...hub, noneLive: options['live-none'] === true });
      return json({ file, changed });
    }
    default:
      throw new RegistryError(`unhandled command ${command}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { out, note } = runCli(process.argv.slice(2));
    if (note) process.stderr.write(`[session-hub] registry: ${note}\n`);
    process.stdout.write(`${out}\n`);
  } catch (error) {
    process.stderr.write(`[session-hub] registry: ${error.message}\n`);
    process.exitCode = 1;
  }
}

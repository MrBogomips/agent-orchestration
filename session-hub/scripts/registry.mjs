#!/usr/bin/env node
// The children record of a session-hub master: one JSON file, written whole and atomically on every change.
//
// Default location: <config dir>/session-hub/children-<hub id>.json, where <config dir> is CLAUDE_CONFIG_DIR or
// ~/.claude and <hub id> is the first 16 hex digits of the sha256 of the hub's real path. Never inside a hub.
//
// Usage:
//   registry.mjs path      --hub <dir>
//   registry.mjs read      (--hub <dir> | --file <path>)
//   registry.mjs upsert    (--hub <dir> | --file <path>) --entry '<json>'
//   registry.mjs status    (--hub <dir> | --file <path>) --name <child> --status <status>
//   registry.mjs request   (--hub <dir> | --file <path>) --name <child> --text <text> [--outcome <text>]
//   registry.mjs reconcile (--hub <dir> | --file <path>) --live <name,name,...>
//
// Exit 0 on success, with JSON on stdout (the path for `path`); exit 1 with a `[session-hub]` message on stderr.
// A file that cannot be read as a record is reported and never overwritten.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = Object.freeze(['running', 'waiting-user', 'done', 'abandoned', 'lost']);
const LIVE_STATUSES = Object.freeze(['running', 'waiting-user']);
const FORMAT_VERSION = 1;

export class RegistryError extends Error {}

export function configDir(env = process.env, home = homedir()) {
  return env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
}

function realHub(hub) {
  try {
    return realpathSync(hub);
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

function writeRecord(file, record) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temp, file);
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

function update(file, options, change) {
  const record = readRecord(file);
  const next = change(record);
  const hub = options.hub ? realHub(options.hub) : record.hub ?? null;
  return writeRecord(file, { ...next, version: FORMAT_VERSION, hub });
}

function findIndex(record, name) {
  const index = record.children.findIndex((child) => child.name === name);
  if (index < 0) throw new RegistryError(`no child named "${name}" in the record`);
  return index;
}

const replaceAt = (list, index, item) => list.map((existing, i) => (i === index ? item : existing));

export function upsertChild(file, entry, options = {}) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new RegistryError('the entry must be a JSON object');
  }
  if (typeof entry.name !== 'string' || entry.name === '') throw new RegistryError('the entry has no name');
  if (entry.status !== undefined) checkStatus(entry.status);
  const now = options.now ?? (() => new Date().toISOString());
  return update(file, options, (record) => {
    const index = record.children.findIndex((child) => child.name === entry.name);
    if (index >= 0) {
      return { ...record, children: replaceAt(record.children, index, { ...record.children[index], ...entry }) };
    }
    const created = { status: 'running', started: now(), requests: [], ...entry };
    return { ...record, children: [...record.children, created] };
  });
}

export function setStatus(file, name, status, options = {}) {
  checkStatus(status);
  return update(file, options, (record) => {
    const index = findIndex(record, name);
    return { ...record, children: replaceAt(record.children, index, { ...record.children[index], status }) };
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

export function reconcile(file, liveNames, options = {}) {
  const live = new Set(liveNames);
  const record = readRecord(file);
  const changed = record.children
    .filter((child) => LIVE_STATUSES.includes(child.status) && !live.has(child.name))
    .map((child) => child.name);
  if (changed.length === 0) return { record, changed };
  const written = update(file, options, (current) => ({
    ...current,
    children: current.children.map((child) => (changed.includes(child.name) ? { ...child, status: 'lost' } : child)),
  }));
  return { record: written, changed };
}

// Command line

const COMMANDS = Object.freeze(['path', 'read', 'upsert', 'status', 'request', 'reconcile']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key?.startsWith('--') || i + 1 >= rest.length) throw new RegistryError(`bad argument near "${key}"`);
    options[key.slice(2)] = rest[i + 1];
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

function resolveFile(options) {
  if (options.file) {
    if (!isAbsolute(options.file)) throw new RegistryError(`--file must be an absolute path: ${options.file}`);
    const file = resolve(options.file);
    if (options.hub) {
      const hub = realHub(options.hub);
      let fileDir;
      try {
        fileDir = realpathSync(dirname(file));
      } catch {
        fileDir = dirname(file);
      }
      if (isInside(fileDir, hub)) throw new RegistryError(`the record may not live inside the hub: ${file}`);
    }
    return file;
  }
  if (options.hub) return defaultRegistryPath(options.hub);
  throw new RegistryError('give --hub <dir> or --file <path>');
}

function parseEntry(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RegistryError(`--entry is not valid JSON (${error.message})`);
  }
}

export function runCli(argv) {
  const { command, options } = parseArgs(argv);
  if (!COMMANDS.includes(command)) throw new RegistryError(`unknown command "${command}"; use ${COMMANDS.join(', ')}`);
  if (command === 'path') return defaultRegistryPath(required(options, 'hub'));
  const file = resolveFile(options);
  const hub = options.hub ? { hub: options.hub } : {};
  switch (command) {
    case 'read':
      return JSON.stringify(readRecord(file), null, 2);
    case 'upsert':
      return JSON.stringify(upsertChild(file, parseEntry(required(options, 'entry')), hub), null, 2);
    case 'status':
      return JSON.stringify(setStatus(file, required(options, 'name'), required(options, 'status'), hub), null, 2);
    case 'request': {
      const request = { text: required(options, 'text'), ...(options.outcome ? { outcome: options.outcome } : {}) };
      return JSON.stringify(addRequest(file, required(options, 'name'), request, hub), null, 2);
    }
    case 'reconcile': {
      const live = required(options, 'live').split(',').map((s) => s.trim()).filter(Boolean);
      const { changed } = reconcile(file, live, hub);
      return JSON.stringify({ file, changed }, null, 2);
    }
    default:
      throw new RegistryError(`unhandled command ${command}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${runCli(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`[session-hub] registry: ${error.message}\n`);
    process.exitCode = 1;
  }
}

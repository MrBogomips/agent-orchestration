// The master identity and the outbox of the children record (#97, #98).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { outboxEntry } from '../hooks/mod/outbox.mjs';
import { readOutbox, readRecord, RegistryError, setMaster, upsertChild } from './registry.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'registry.mjs');
const SESSION = '0d9bc5aa-1111-2222-3333-444455556666';
const now = () => '2026-11-25T10:00:00.000Z';

let base;
let hub;
let file;
let outbox;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'registry-master-')));
  hub = join(base, 'hub');
  mkdirSync(hub);
  file = join(base, 'config', 'session-hub', 'children-test.json');
  outbox = join(base, 'config', 'session-hub', 'children-test.outbox');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const cli = (args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: join(base, 'cfg') } });

const drop = (name, text, at = '2026-11-25T10:15:00Z') => {
  mkdirSync(outbox, { recursive: true });
  const entry = outboxEntry({ dir: outbox, at, sessionId: SESSION, nonce: name, master: 'hub-a8', text });
  writeFileSync(entry.file, entry.content);
  return entry.file.slice(outbox.length + 1);
};

test('setMaster records the master identity and keeps the children', () => {
  upsertChild(file, { name: 't42-product', status: 'running' }, { now });
  setMaster(file, { name: 'hub-a8', ref: '0d9bc5', sessionId: SESSION }, { now });
  const record = readRecord(file);
  assert.deepEqual(record.master, { name: 'hub-a8', ref: '0d9bc5', sessionId: SESSION, updatedAt: now() });
  assert.equal(record.children.length, 1);
  setMaster(file, { name: 'CTX-PROJ' }, { now });
  assert.deepEqual(readRecord(file).master, { name: 'CTX-PROJ', updatedAt: now() });
});

test('setMaster refuses an empty name and a ref or id with odd characters', () => {
  assert.throws(() => setMaster(file, { name: ' ' }), RegistryError);
  assert.throws(() => setMaster(file, { name: 'm', ref: '0d 9' }), /--ref/);
  assert.throws(() => setMaster(file, { name: 'm', sessionId: '../x' }), /--session-id/);
  assert.equal(existsSync(file), false);
});

test('a record whose master has no name is reported, never overwritten', () => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, children: [], master: { ref: 'x' } }));
  assert.throws(() => readRecord(file), /`master` has no name/);
});

test('readOutbox lists the messages oldest first, and an empty or missing outbox has none', () => {
  assert.deepEqual(readOutbox(file), { dir: outbox, messages: [], removed: [] });
  const later = drop('b', 'second', '2026-11-25T11:00:00Z');
  const earlier = drop('a', 'first');
  writeFileSync(join(outbox, 'notes.txt'), 'not a message');
  const { messages } = readOutbox(file);
  assert.deepEqual(messages.map((m) => [m.file, m.text]), [[earlier, 'first'], [later, 'second']]);
  assert.equal(messages[0].from, SESSION);
});

test('readOutbox removes only the named messages, and never anything that is not one', () => {
  const one = drop('a', 'first');
  const two = drop('b', 'second', '2026-11-25T11:00:00Z');
  const { messages, removed } = readOutbox(file, [one, '20261125T000000Z-x-gone.json']);
  assert.deepEqual(removed, [one]);
  assert.deepEqual(messages.map((m) => m.file), [two]);
  for (const bad of ['../children-test.json', 'notes.txt', `${two}/..`]) {
    assert.throws(() => readOutbox(file, [bad]), /not the name of an outbox message/, bad);
  }
  assert.ok(existsSync(join(outbox, two)));
});

test('a broken message file is listed with its error', () => {
  mkdirSync(outbox, { recursive: true });
  writeFileSync(join(outbox, '20261125T101500Z-x-a.json'), '{');
  assert.match(readOutbox(file).messages[0].error, /not valid JSON/);
});

test('command line: master and outbox, with --remove a write that needs --hub next to --file', () => {
  const set = cli(['master', '--hub', hub, '--file', file, '--name', 'hub-a8', '--ref', '0d9bc5', '--session-id', SESSION]);
  assert.equal(set.status, 0, set.stderr);
  assert.equal(JSON.parse(set.stdout).name, 'hub-a8');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).master.sessionId, SESSION);
  const name = drop('a', '[T-42 product] done: PR #12');
  const read = cli(['outbox', '--file', file]);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).messages[0].text, '[T-42 product] done: PR #12');
  assert.equal(cli(['outbox', '--file', file, '--remove', name]).status, 1);
  const removed = cli(['outbox', '--hub', hub, '--file', file, '--remove', name]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(JSON.parse(removed.stdout).removed, [name]);
  assert.equal(cli(['master', '--file', file, '--name', 'x']).status, 1);
  assert.equal(cli(['master', '--hub', hub, '--file', file]).status, 1);
});

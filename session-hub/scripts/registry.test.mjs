import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  configDir,
  hubId,
  defaultRegistryPath,
  readRecord,
  upsertChild,
  setStatus,
  addRequest,
  reconcile,
  RegistryError,
} from './registry.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'registry.mjs');

let base;
let hub;
let file;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'registry-')));
  hub = join(base, 'hub');
  mkdirSync(hub);
  file = join(base, 'config', 'session-hub', 'children-test.json');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const entry = (name, extra = {}) => ({ name, repo: join(hub, 'product'), task: 'T-42', status: 'running', ...extra });
const now = () => '2026-11-20T10:00:00.000Z';

describe('paths', () => {
  test('config dir comes from CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    assert.equal(configDir({ CLAUDE_CONFIG_DIR: '/x/cfg' }, '/home/u'), '/x/cfg');
    assert.equal(configDir({}, '/home/u'), '/home/u/.claude');
  });

  test('hub id is the first 16 hex of the sha256 of the real path', () => {
    const expected = createHash('sha256').update(hub).digest('hex').slice(0, 16);
    assert.equal(hubId(hub), expected);
    const link = join(base, 'hub-link');
    spawnSync('ln', ['-s', hub, link]);
    assert.equal(hubId(link), expected);
  });

  test('default path sits under the config dir', () => {
    const path = defaultRegistryPath(hub, { CLAUDE_CONFIG_DIR: join(base, 'cfg') });
    assert.equal(path, join(base, 'cfg', 'session-hub', `children-${hubId(hub)}.json`));
  });
});

describe('record', () => {
  test('reading a missing file gives an empty record', () => {
    assert.deepEqual(readRecord(file).children, []);
    assert.equal(existsSync(file), false);
  });

  test('upsert creates the file and the entry', () => {
    const record = upsertChild(file, entry('t42-product'), { now });
    assert.equal(record.children.length, 1);
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.children[0].name, 't42-product');
    assert.equal(onDisk.children[0].started, now());
    assert.deepEqual(onDisk.children[0].requests, []);
  });

  test('upsert merges into an existing entry by name', () => {
    upsertChild(file, entry('t42-product', { model: 'sonnet' }), { now });
    upsertChild(file, entry('t42-design'), { now });
    upsertChild(file, { name: 't42-product', effort: 'medium' }, { now });
    const record = readRecord(file);
    assert.equal(record.children.length, 2);
    const child = record.children.find((c) => c.name === 't42-product');
    assert.equal(child.model, 'sonnet');
    assert.equal(child.effort, 'medium');
    assert.equal(child.started, now());
  });

  test('upsert rejects an entry without a name or with an unknown status', () => {
    assert.throws(() => upsertChild(file, { repo: '/x' }, { now }), RegistryError);
    assert.throws(() => upsertChild(file, entry('a', { status: 'sleeping' }), { now }), RegistryError);
  });

  test('set status changes one entry and rejects unknown names and statuses', () => {
    upsertChild(file, entry('t42-product'), { now });
    setStatus(file, 't42-product', 'waiting-user');
    assert.equal(readRecord(file).children[0].status, 'waiting-user');
    assert.throws(() => setStatus(file, 'nobody', 'done'), RegistryError);
    assert.throws(() => setStatus(file, 't42-product', 'finished'), RegistryError);
  });

  test('add request appends to the entry', () => {
    upsertChild(file, entry('t42-product'), { now });
    addRequest(file, 't42-product', { text: 'fix typo in design', outcome: 'sent to t42-design' }, { now });
    const { requests } = readRecord(file).children[0];
    assert.deepEqual(requests, [{ at: now(), text: 'fix typo in design', outcome: 'sent to t42-design' }]);
  });

  test('reconcile marks live statuses missing from the session list as lost', () => {
    upsertChild(file, entry('a'), { now });
    upsertChild(file, entry('b', { status: 'waiting-user' }), { now });
    upsertChild(file, entry('c'), { now });
    upsertChild(file, entry('d', { status: 'done' }), { now });
    const { changed } = reconcile(file, ['c']);
    assert.deepEqual(changed.sort(), ['a', 'b']);
    const byName = Object.fromEntries(readRecord(file).children.map((c) => [c.name, c.status]));
    assert.deepEqual(byName, { a: 'lost', b: 'lost', c: 'running', d: 'done' });
  });

  test('reconcile with nothing to change leaves the file alone', () => {
    upsertChild(file, entry('a'), { now });
    const before = readFileSync(file, 'utf8');
    assert.deepEqual(reconcile(file, ['a']).changed, []);
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  test('writes are atomic: no temporary file is left behind', () => {
    upsertChild(file, entry('a'), { now });
    upsertChild(file, entry('b'), { now });
    assert.deepEqual(readdirSync(dirname(file)), ['children-test.json']);
  });

  test('a corrupt file is reported and never overwritten', () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ broken');
    assert.throws(() => readRecord(file), (error) => error instanceof RegistryError && /not valid JSON/.test(error.message));
    assert.throws(() => upsertChild(file, entry('a'), { now }), RegistryError);
    assert.equal(readFileSync(file, 'utf8'), '{ broken');
  });

  test('a file with the wrong shape is reported and never overwritten', () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{"children": "nope"}');
    assert.throws(() => upsertChild(file, entry('a'), { now }), /children/);
    assert.equal(readFileSync(file, 'utf8'), '{"children": "nope"}');
  });

  test('upsert keeps the requests and start time of an existing entry', () => {
    upsertChild(file, entry('a'), { now });
    addRequest(file, 'a', { text: 'r1' }, { now });
    upsertChild(file, { name: 'a', started: '1999-01-01T00:00:00Z', requests: [], model: 'opus' }, { now: () => 'later' });
    const child = readRecord(file).children[0];
    assert.equal(child.started, now());
    assert.equal(child.requests.length, 1);
    assert.equal(child.model, 'opus');
  });

  test('reconcile refuses an empty live list unless told there is no live session', () => {
    upsertChild(file, entry('a'), { now });
    assert.throws(() => reconcile(file, []), /--live-none/);
    assert.equal(readRecord(file).children[0].status, 'running');
    assert.deepEqual(reconcile(file, [], { noneLive: true }).changed, ['a']);
  });

  test('a record written by a newer format is never rewritten', () => {
    mkdirSync(dirname(file), { recursive: true });
    const newer = JSON.stringify({ version: 2, hub: null, children: [] });
    writeFileSync(file, newer);
    assert.deepEqual(readRecord(file).children, []);
    assert.throws(() => upsertChild(file, entry('a'), { now }), /newer/);
    assert.equal(readFileSync(file, 'utf8'), newer);
  });

  test('a write waits for the lock and fails when it cannot take it', () => {
    upsertChild(file, entry('a'), { now });
    writeFileSync(`${file}.lock`, 'held');
    const before = readFileSync(file, 'utf8');
    assert.throws(() => upsertChild(file, entry('b'), { now, lockTimeoutMs: 200 }), /lock/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.ok(existsSync(`${file}.lock`), 'a lock held by someone else is left alone');
  });

  test('a stale lock is removed', () => {
    upsertChild(file, entry('a'), { now });
    writeFileSync(`${file}.lock`, 'stale');
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${file}.lock`, old, old);
    upsertChild(file, entry('b'), { now, lockTimeoutMs: 200 });
    assert.equal(readRecord(file).children.length, 2);
    assert.equal(existsSync(`${file}.lock`), false);
  });

  test('the lock is released after a failed write', () => {
    upsertChild(file, entry('a'), { now });
    assert.throws(() => setStatus(file, 'nobody', 'done'), RegistryError);
    assert.equal(existsSync(`${file}.lock`), false);
  });
});

describe('hub id normalization', () => {
  test('the same hub spelled in another case or Unicode form gets the same id', () => {
    const nfc = join(base, 'café');
    mkdirSync(nfc);
    const nfd = join(base, 'café');
    // A byte-exact filesystem (Linux) has no folder under the other Unicode form; only compare where it resolves.
    if (existsSync(nfd)) assert.equal(hubId(nfd), hubId(nfc));
    const upper = join(base, 'HUB');
    let caseInsensitive = true;
    try {
      realpathSync(upper);
    } catch {
      caseInsensitive = false;
    }
    if (caseInsensitive) assert.equal(hubId(upper), hubId(hub));
  });
});

describe('command line', () => {
  const cli = (args, env = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(base, 'cfg'), ...env },
    });

  test('path, upsert, status, reconcile and read work end to end', () => {
    const path = cli(['path', '--hub', hub]).stdout.trim();
    assert.equal(path, defaultRegistryPath(hub, { CLAUDE_CONFIG_DIR: join(base, 'cfg') }));

    let r = cli(['upsert', '--hub', hub, '--entry', JSON.stringify(entry('t42-product'))]);
    assert.equal(r.status, 0, r.stderr);
    r = cli(['status', '--hub', hub, '--name', 't42-product', '--status', 'done']);
    assert.equal(r.status, 0, r.stderr);
    r = cli(['upsert', '--hub', hub, '--entry', JSON.stringify(entry('t42-design'))]);
    r = cli(['reconcile', '--hub', hub, '--live', '']);
    assert.equal(r.status, 1, 'an empty --live is refused');
    assert.match(r.stderr, /--live-none/);
    r = cli(['reconcile', '--hub', hub, '--live-none']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).changed, ['t42-design']);

    r = cli(['read', '--hub', hub]);
    const record = JSON.parse(r.stdout);
    assert.equal(record.hub, hub);
    assert.deepEqual(record.children.map((c) => c.status), ['done', 'lost']);
  });

  test('read of a missing file says there is no record yet', () => {
    const r = cli(['read', '--hub', hub]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).children, []);
    assert.match(r.stderr, /no record yet/);
  });

  test('parallel upserts from separate processes lose no entry', async () => {
    const { spawn } = await import('node:child_process');
    const runOne = (i) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [SCRIPT, 'upsert', '--hub', hub, '--entry', JSON.stringify(entry(`child-${i}`))],
          { env: { ...process.env, CLAUDE_CONFIG_DIR: join(base, 'cfg') }, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('exit', (code) => resolve({ code, stderr }));
      });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => runOne(i)));
    for (const r of results) assert.equal(r.code, 0, r.stderr);
    const names = readRecord(defaultRegistryPath(hub, { CLAUDE_CONFIG_DIR: join(base, 'cfg') })).children.map((c) => c.name);
    assert.equal(names.length, 10);
  });

  test('--file overrides the default path, and a file inside the hub is refused', () => {
    const custom = join(base, 'elsewhere', 'kids.json');
    let r = cli(['upsert', '--file', custom, '--entry', JSON.stringify(entry('a'))]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(custom));

    r = cli(['upsert', '--hub', hub, '--file', join(hub, 'kids.json'), '--entry', JSON.stringify(entry('a'))]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[session-hub\].*inside the hub/);
    assert.equal(existsSync(join(hub, 'kids.json')), false);
  });

  test('errors exit 1 with a prefixed message', () => {
    mkdirSync(join(base, 'cfg', 'session-hub'), { recursive: true });
    writeFileSync(defaultRegistryPath(hub, { CLAUDE_CONFIG_DIR: join(base, 'cfg') }), 'garbage');
    const r = cli(['read', '--hub', hub]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^\[session-hub\]/);
    assert.equal(cli(['bogus']).status, 1);
    assert.equal(cli(['read']).status, 1);
  });
});

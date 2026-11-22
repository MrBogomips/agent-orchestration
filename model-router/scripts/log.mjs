#!/usr/bin/env node
// The data of the log dashboard: one pass over the event log, archive included, for a window, a record type and a
// page, printed as JSON. The pass counts every record and holds only the newest matching ones (lib/log-data.mjs),
// so the output is bounded whatever the length of the log. Read-only: it compacts nothing and writes nothing.
// See docs/design/model-router.md, "The log dashboard".
//
// Usage: node log.mjs [--config-dir <dir>] [--window 24h|7d|30d|all] [--type <record type>|all] [--page <n>]
// Exits 1 with a message on stderr when the log cannot be read.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfigDir, isMainModule, paths, scanLog } from './compact.mjs';
import { archivePaths } from './rotate.mjs';
import { logCollector, queryOf } from '../lib/log-data.mjs';

/** The most archive files listed by name; the count and the total size cover them all. */
export const ARCHIVE_LISTED = 20;

const sizeOf = (file) => {
  try {
    return statSync(file).size;
  } catch {
    return null;
  }
};

/** The log file and its archive folder: paths, sizes, and the archive's files, newest name first. */
export function logFilesInfo(p) {
  const dir = archivePaths(p.root).dir;
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().reverse() : [];
  const files = names.map((name) => ({ name, bytes: sizeOf(join(dir, name)) ?? 0 }));
  return {
    log: { path: p.events, bytes: sizeOf(p.events) },
    archive: { path: dir, count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), files: files.slice(0, ARCHIVE_LISTED) },
  };
}

/** Reads the log once for the query and returns what the dashboard shows. */
export function readLog({ configDir = defaultConfigDir(), now = Date.now(), query = {} } = {}) {
  const p = paths(configDir);
  const collector = logCollector({ query: queryOf(query), now });
  // Nothing is kept by the scan itself: the collector holds the bounded part.
  scanLog(p, { keep: (record) => (collector.add(record), null) });
  return { version: 1, generatedAt: new Date(now).toISOString(), files: logFilesInfo(p), ...collector.result() };
}

function parseArgs(argv) {
  const args = { configDir: undefined, query: {} };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config-dir') args.configDir = argv[++i];
    else if (argv[i] === '--window') args.query.window = argv[++i];
    else if (argv[i] === '--type') args.query.type = argv[++i];
    else if (argv[i] === '--page') args.query.page = Number(argv[++i]);
  }
  return args;
}

if (isMainModule(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(readLog({ configDir: args.configDir || defaultConfigDir(), query: args.query }))}\n`);
  } catch (err) {
    process.stderr.write(`${String(err?.message ?? err).slice(0, 300)}\n`);
    process.exitCode = 1;
  }
}

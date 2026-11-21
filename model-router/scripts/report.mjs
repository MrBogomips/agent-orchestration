#!/usr/bin/env node
// The quality report: runs a compaction, then writes <config dir>/model-router/report.html and opens it.
// See docs/design/model-router-quality-loop.md, "Report".
//
// Usage: node report.mjs [--config-dir <dir>] [--options '<json>'] [--no-open]
// Prints the path of the page. Nothing leaves the machine.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { compact, defaultConfigDir, effectiveOptions, isMainModule, loadGrid, paths, scanLog, writeWhole } from './compact.mjs';
import { agedCells, classesOf, decisionsOf, latestOutcomes, trendOf } from '../lib/usage-data.mjs';
import { renderReport } from '../lib/report-html.mjs';

/** A JSON file's value, or null when it is missing or unreadable. */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Every project level under quality/projects, sorted by root. */
export function projectLevels(p) {
  if (!existsSync(p.projects)) return [];
  return readdirSync(p.projects)
    .filter((n) => /^[0-9a-f]{16}\.json$/.test(n))
    .map((n) => readJson(join(p.projects, n)))
    .filter(Boolean)
    .sort((a, b) => String(a.project?.root).localeCompare(String(b.project?.root)));
}

/** Everything the page shows, after a compaction. */
export function buildReportData({ configDir = defaultConfigDir(), now = Date.now(), options = {}, grid = loadGrid() } = {}) {
  const opts = effectiveOptions(configDir, options);
  compact({ configDir, now, options: opts, grid });
  const p = paths(configDir);
  // The page shows outcomes and decision counts: only those records are held, however long the log is.
  const { records: events, total } = scanLog(p, { keep: (r) => r.type === 'outcome' || r.type === 'decision' });
  const outcomes = latestOutcomes(events);
  const user = readJson(p.user) ?? { cells: {} };
  const levels = [
    { kind: 'user', title: 'user', classes: classesOf(agedCells(user, now, opts.halfLifeDays), grid, { outcomes }) },
    ...projectLevels(p).map((lv) => ({
      kind: 'project', title: lv.project?.root ?? lv.project?.id ?? 'project',
      classes: classesOf(agedCells(lv, now, opts.halfLifeDays), grid, { outcomes, projectId: lv.project?.id ?? null }),
    })),
  ];
  return {
    generatedAt: new Date(now).toISOString(), configDir, events: total, outcomes: outcomes.length,
    levels, trend: trendOf(outcomes), decisions: decisionsOf(events),
  };
}

/** The command that opens a file on this platform, or null. */
export function openerFor(platform) {
  if (platform === 'darwin') return 'open';
  if (platform === 'linux') return 'xdg-open';
  return null;
}

function openFile(file) {
  const opener = openerFor(process.platform);
  if (!opener) return;
  const child = spawn(opener, [file], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** Compacts, writes the page and opens it (pass `open: null` not to). Returns the page's path. */
export function writeReport({ configDir = defaultConfigDir(), now = Date.now(), options = {}, open = openFile } = {}) {
  const html = renderReport(buildReportData({ configDir, now, options }));
  const file = join(paths(configDir).root, 'report.html');
  writeWhole(file, html);
  if (open) open(file);
  return file;
}

function parseArgs(argv) {
  const args = { configDir: undefined, options: {}, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config-dir') args.configDir = argv[++i];
    else if (argv[i] === '--options') args.options = JSON.parse(argv[++i] ?? '{}');
    else if (argv[i] === '--no-open') args.open = false;
  }
  return args;
}

if (isMainModule(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const file = writeReport({ configDir: args.configDir || defaultConfigDir(), options: args.options, open: args.open ? openFile : null });
    process.stdout.write(`${file}\n`);
  } catch (err) {
    process.stderr.write(`[model-router] report failed: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
// The quality report: runs a compaction, then writes <config dir>/model-router/report.html and opens it.
// See docs/design/model-router-quality-loop.md, "Report".
//
// Usage: node report.mjs [--config-dir <dir>] [--options '<json>'] [--no-open]
// Prints the path of the page. Nothing leaves the machine.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compact, defaultConfigDir, loadGrid, paths, readEvents, writeWhole, DEFAULT_OPTIONS } from './compact.mjs';
import { ageCell, metrics, recommend } from '../lib/aggregate.mjs';
import { renderReport } from '../lib/report-html.mjs';

const READ_ONLY_CLASSES = ['read-search', 'read-analyze'];
const WEAK_N = 5;
const DAY_MS = 86400000;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function exploreShare(outcomes, cell, projectId) {
  const mine = outcomes.filter((o) => o.learn && o.class === cell.class && o.tier === cell.tier && o.effort === cell.effort &&
    (!projectId || o.project?.id === projectId));
  return mine.length ? mine.filter((o) => o.explore).length / mine.length : 0;
}

function classesOf(level, grid, now, options, outcomes) {
  const aged = Object.fromEntries(Object.entries(level.cells ?? {}).map(([k, c]) => [k, ageCell(c, now, options.halfLifeDays)]));
  const projectId = level.kind === 'project' ? level.project?.id : null;
  return grid.classes
    .filter((spec) => Object.values(aged).some((c) => c.class === spec.name))
    .map((spec) => {
      const recommendation = recommend(aged, spec.name, grid);
      const cells = Object.values(aged)
        .filter((c) => c.class === spec.name)
        .sort((a, b) => b.n - a.n)
        .map((c) => {
          const flags = [];
          if (READ_ONLY_CLASSES.includes(c.class)) flags.push('read-only: weak signal');
          if (c.n < WEAK_N) flags.push(`n < ${WEAK_N}`);
          return {
            tier: c.tier, effort: c.effort, model: c.model, ...metrics(c), exploreShare: exploreShare(outcomes, c, projectId), flags,
            recommended: recommendation?.source === 'data' && recommendation.tier === c.tier && recommendation.effort === c.effort,
          };
        });
      const differs = recommendation?.source === 'data' &&
        (recommendation.tier !== spec.default.tier || recommendation.effort !== spec.default.effort);
      return { cls: spec.name, covers: spec.covers, default: spec.default, recommendation, differs, cells };
    });
}

function weekOf(iso) {
  const d = new Date(iso);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function trendOf(outcomes) {
  const weeks = new Map();
  for (const o of outcomes) {
    if (!['success', 'rework', 'failure'].includes(o.outcome)) continue;
    const week = weekOf(o.reportTs ?? o.ts);
    const w = weeks.get(week) ?? { week, n: 0, success: 0, cost: 0, costN: 0 };
    w.n += 1;
    if (o.outcome === 'success') w.success += 1;
    if (typeof o.costUsd === 'number') {
      w.cost += o.costUsd;
      w.costN += 1;
    }
    weeks.set(week, w);
  }
  return [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => {
      const fpy = w.success / w.n;
      const costPerTask = w.costN ? w.cost / w.costN : null;
      return { week: w.week, n: w.n, fpy, costPerSuccess: fpy && costPerTask !== null ? costPerTask / fpy : null };
    });
}

function decisionsOf(events) {
  const byAction = {};
  let total = 0;
  for (const e of events) {
    if (e.type !== 'decision') continue;
    total += 1;
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  }
  return { total, byAction };
}

function projectLevels(p) {
  if (!existsSync(p.projects)) return [];
  return readdirSync(p.projects)
    .filter((n) => /^[0-9a-f]{16}\.json$/.test(n))
    .map((n) => readJson(join(p.projects, n)))
    .filter(Boolean)
    .sort((a, b) => String(a.project?.root).localeCompare(String(b.project?.root)));
}

/** Everything the page shows, after a compaction. */
export function buildReportData({ configDir = defaultConfigDir(), now = Date.now(), options = {}, grid = loadGrid() } = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  compact({ configDir, now, options: opts, grid });
  const p = paths(configDir);
  const events = readEvents(p.events);
  const outcomes = events.filter((e) => e.type === 'outcome');
  const user = readJson(p.user) ?? { cells: {} };
  const levels = [
    { kind: 'user', title: 'user', classes: classesOf({ ...user, kind: 'user' }, grid, now, opts, outcomes) },
    ...projectLevels(p).map((lv) => ({
      kind: 'project', title: lv.project?.root ?? lv.project?.id ?? 'project',
      classes: classesOf({ ...lv, kind: 'project' }, grid, now, opts, outcomes),
    })),
  ];
  return {
    generatedAt: new Date(now).toISOString(), configDir, events: events.length, outcomes: outcomes.length,
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const file = writeReport({ configDir: args.configDir || defaultConfigDir(), options: args.options, open: args.open ? openFile : null });
    process.stdout.write(`${file}\n`);
  } catch (err) {
    process.stderr.write(`[model-router] report failed: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  }
}

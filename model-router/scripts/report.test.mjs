import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReportData, writeReport, openerFor } from './report.mjs';
import { renderReport } from '../lib/report-html.mjs';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const DAY = 86400000;
const at = (ms) => new Date(ms).toISOString();
const PROJECT = { id: 'fedcba9876543210', root: '/work/shop' };
const OPTIONS = { halfLifeDays: 30, reworkWindowMin: 30, similarityThreshold: 0.5 };

function task(i, startMs, { cls = 'edit-specified', model = 'claude-sonnet-5-5', effort = 'medium', status = 'completed', cost = 0.04, reworkFile = false } = {}) {
  const agentId = `a${i}`;
  const lines = [
    { v: 1, type: 'decision', ts: at(startMs), session: 's1', agentId, action: i % 2 ? 'downgrade' : 'keep', before: 'claude-opus-5-5', after: model },
    { v: 1, type: 'spawn', ts: at(startMs), session: 's1', agentId, subagentType: 'general-purpose', description: `job number ${i}`, class: cls, risky: false, model, effort, route: 'judge', project: PROJECT },
    { v: 1, type: 'signal', kind: 'write', ts: at(startMs + 1000), session: 's1', agentId, file: `/work/shop/f${i}.ts` },
    { v: 1, type: 'report', ts: at(startMs + 2000), session: 's1', agentId, status, model, effort, costUsd: cost, tokens: 1000 },
  ];
  if (reworkFile) lines.push({ v: 1, type: 'signal', kind: 'write', ts: at(startMs + 60000), session: 's1', file: `/work/shop/f${i}.ts` });
  return lines;
}

function fixture() {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-report-'));
  mkdirSync(join(configDir, 'model-router'), { recursive: true });
  const lines = [];
  for (let i = 0; i < 6; i += 1) lines.push(...task(i, T0 - 14 * DAY + i * 3600000, { reworkFile: i === 0 }));
  for (let i = 6; i < 9; i += 1) lines.push(...task(i, T0 - 3 * DAY + i * 3600000, { cls: 'read-search', model: 'claude-haiku-5-5', effort: 'low', cost: 0.003 }));
  writeFileSync(join(configDir, 'model-router', 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return configDir;
}

test('the report data has both levels, metrics per cell, a weekly trend and the decisions', () => {
  const configDir = fixture();
  const data = buildReportData({ configDir, now: T0, options: OPTIONS });
  assert.deepEqual(data.levels.map((l) => l.kind), ['user', 'project']);
  assert.equal(data.levels[1].title, '/work/shop');
  const edit = data.levels[0].classes.find((c) => c.cls === 'edit-specified');
  const cell = edit.cells.find((c) => c.tier === 'sonnet' && c.effort === 'medium');
  assert.ok(cell.n > 5.5 && cell.n <= 6);
  assert.ok(Math.abs(cell.fpy - 5 / 6) < 1e-9);
  assert.ok(Math.abs(cell.reworkRate - 1 / 6) < 1e-9);
  assert.ok(Math.abs(cell.costPerSuccess - 0.04 / (5 / 6)) < 1e-9);
  assert.equal(cell.exploreShare, 0);
  assert.deepEqual(edit.recommendation, { tier: 'sonnet', effort: 'medium', source: 'data' });
  const search = data.levels[0].classes.find((c) => c.cls === 'read-search');
  assert.ok(search.cells[0].flags.includes('read-only: weak signal'));
  assert.ok(search.cells[0].flags.includes('n < 5'));
  assert.equal(data.trend.length, 2);
  assert.equal(data.trend[0].n, 6);
  assert.equal(data.decisions.byAction.downgrade, 4);
  assert.equal(data.decisions.total, 9);
});

test('the page is self-contained and shows the numbers', () => {
  const configDir = fixture();
  const html = renderReport(buildReportData({ configDir, now: T0, options: OPTIONS }));
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/(src|href)=["']?https?:/i.test(html), 'no external resource');
  assert.ok(!/<script\s+src/i.test(html));
  assert.match(html, /edit-specified/);
  assert.match(html, /83%/, 'FPY of the edit-specified cell');
  assert.match(html, /\/work\/shop/);
  assert.match(html, /weak signal/);
  assert.match(html, /prefers-color-scheme: dark/);
});

test('text from the data is escaped', () => {
  const html = renderReport({
    generatedAt: at(T0), configDir: '/x', events: 0, outcomes: 0, trend: [], decisions: { total: 0, byAction: {} },
    levels: [{ kind: 'project', title: '<script>alert(1)</script>', classes: [] }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('writeReport compacts, writes report.html under the config folder and opens it', () => {
  const configDir = fixture();
  const opened = [];
  const file = writeReport({ configDir, now: T0, options: OPTIONS, open: (f) => opened.push(f) });
  assert.equal(file, join(configDir, 'model-router', 'report.html'));
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /model-router/);
  assert.deepEqual(opened, [file]);
  assert.ok(existsSync(join(configDir, 'model-router', 'quality', 'user.json')), 'compaction ran first');
});

test('the opener is open on macOS and xdg-open on Linux', () => {
  assert.equal(openerFor('darwin'), 'open');
  assert.equal(openerFor('linux'), 'xdg-open');
  assert.equal(openerFor('win32'), null);
});

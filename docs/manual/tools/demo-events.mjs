#!/usr/bin/env node
// Writes a synthetic model-router event log for the manual's screenshots: six weeks of subagent starts over two
// projects, every task class, tier and effort, and every outcome. Compaction (model-router/scripts/compact.mjs)
// then turns it into outcomes and aggregates, as it does with a real log. The data is invented and deterministic.
//
// Usage: node demo-events.mjs <config dir>   (writes <config dir>/model-router/events.jsonl; refuses to overwrite)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { projectId } from '../../../model-router/lib/project-id.mjs';

const DAY = 86400000;
const MIN = 60000;
const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-5' };
// The demo hub's two repositories. Their ids come from these remotes, so a session started in a clone with the same
// remote (screenshots.sh makes one) finds its project's data whatever the folder.
const DEMO_REMOTES = Object.freeze({ product: 'https://example.com/demo/product.git', design: 'https://example.com/demo/design.git' });
const PROJECTS = [
  { id: (await projectId({ remote: DEMO_REMOTES.product })).id, root: '/work/hub/product', share: 0.7 },
  { id: (await projectId({ remote: DEMO_REMOTES.design })).id, root: '/work/hub/design', share: 0.3 },
];
const COST = { haiku: [0.002, 0.012], sonnet: [0.02, 0.11], opus: [0.09, 0.42], fable: [0.35, 1.2] };
const EFFORT_COST = { low: 0.7, medium: 1, high: 1.45, xhigh: 2 };

// Per class: the descriptions used, and the (tier, effort, weight, first-pass success probability) cells.
const CLASSES = {
  'read-search': {
    tasks: ['Find callers of parseConfig', 'List the endpoints under src/api', 'Locate the CSV writer', 'Find where retries are set'],
    cells: [['haiku', 'low', 8, 0.95], ['sonnet', 'low', 2, 0.97]],
  },
  'read-analyze': {
    tasks: ['Explain the export pipeline', 'Compare the two pagination helpers', 'Summarize the API spec changes'],
    cells: [['sonnet', 'medium', 6, 0.9], ['haiku', 'medium', 3, 0.72]],
  },
  'edit-mechanical': {
    tasks: ['Rename fetchAll to listRecords', 'Add the license header to every file', 'Replace var with const in src'],
    cells: [['haiku', 'low', 6, 0.88], ['sonnet', 'low', 2, 0.95]],
  },
  'edit-specified': {
    tasks: ['Add GET /export with tests', 'Write tests for the CSV writer', 'Fix the off-by-one in paging', 'Add the size limit to export'],
    cells: [['sonnet', 'medium', 7, 0.82], ['sonnet', 'low', 4, 0.86], ['opus', 'medium', 2, 0.9]],
  },
  'review-debug': {
    tasks: ['Review the export branch', 'Debug the flaky upload test', 'Find why the build is slow'],
    cells: [['opus', 'medium', 5, 0.7], ['opus', 'high', 4, 0.86], ['sonnet', 'high', 1, 0.55]],
  },
  'design-open': {
    tasks: ['Design the sync protocol', 'Propose the plugin API', 'Plan the storage migration'],
    cells: [['fable', 'high', 3, 0.85], ['opus', 'high', 3, 0.75]],
  },
};
const CLASS_WEIGHTS = { 'read-search': 9, 'read-analyze': 5, 'edit-mechanical': 4, 'edit-specified': 9, 'review-debug': 4, 'design-open': 2 };

// A small deterministic generator (mulberry32), so every run writes the same log for the same end time.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = (list) => list[Math.floor(rand() * list.length)];
function weighted(entries) {
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
const iso = (ms) => new Date(ms).toISOString();
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// How the start was routed, following the router's rules: an explicit model is kept, the judge never picks
// fable, a change of model needs at least the downgrade confidence, and risky judged work goes to the deep tier.
const PRICE = ['haiku', 'sonnet', 'opus', 'fable'];
const JUDGE_TIER = { haiku: 'fast', sonnet: 'balanced', opus: 'deep' };
function routing(tier, risky) {
  if (tier === 'fable' || rand() < 0.6) {
    return { route: 'explicit', action: 'explicit', modelTier: tier, before: tier, reason: 'the call carries a model', conf: null };
  }
  const parent = weighted([['opus', 6], ['sonnet', 3], ['fable', 1]]);
  const conf = round(0.62 + rand() * 0.36, 2);
  if (risky) {
    const keep = PRICE.indexOf(parent) >= PRICE.indexOf('opus');
    return {
      route: 'judge', action: keep ? 'keep' : 'forced-risk', modelTier: keep ? parent : 'opus', before: MODELS[parent], conf,
      reason: keep ? 'risky work: already at or above the deep tier' : 'risky work: deep tier',
    };
  }
  const up = PRICE.indexOf(tier) - PRICE.indexOf(parent);
  const action = up < 0 ? 'downgrade' : up > 0 ? 'upgrade' : 'keep';
  return { route: 'judge', action, modelTier: tier, before: MODELS[parent], reason: `judge: ${JUDGE_TIER[tier]} at ${conf}`, conf };
}

function task(records, session, at, project, used) {
  let cls = weighted(Object.entries(CLASS_WEIGHTS));
  // A session never repeats a task: a similar start of the same class would read as rework.
  for (let i = 0; i < 20 && CLASSES[cls].tasks.every((t) => used.has(t)); i += 1) cls = weighted(Object.entries(CLASS_WEIGHTS));
  const spec = CLASSES[cls];
  const text = pick(spec.tasks.filter((t) => !used.has(t)).concat(spec.tasks.every((t) => used.has(t)) ? spec.tasks : []));
  used.add(text);
  let [tier, effort, , pSuccess] = weighted(spec.cells.map((c) => [c, c[2]]));
  const risky = cls === 'edit-specified' && rand() < 0.04;
  const untagged = rand() < 0.04;
  const agentId = `a${hex(16)}`;
  const description = untagged ? text : `[mr:${cls}${risky ? '!' : ''}] ${text}`;
  const route = routing(tier, risky);
  const model = MODELS[route.modelTier];
  const subagentType = cls.startsWith('read') ? weighted([['Explore', 3], ['general-purpose', 2]]) : 'general-purpose';
  const finalEffort = risky ? 'high' : effort;
  const explicit = route.route === 'explicit';
  records.push({
    v: 1, type: 'decision', ts: iso(at), session, agentId, toolUseId: `toolu_${hex(24)}`, subagentType,
    class: untagged ? null : cls, action: route.action, before: route.before, after: model, effort: finalEffort,
    judge: explicit ? null : {
      tier: JUDGE_TIER[route.modelTier] ?? 'deep', confidence: route.conf, effort: 1, effortConfidence: 0.7,
      risky: risky ? 0.85 : 0.1, class: cls, ms: 900 + Math.floor(rand() * 2500),
    },
    reason: route.reason,
  });
  records.push({
    v: 1, type: 'spawn', ts: iso(at), session, agentId, subagentType, description, class: untagged ? null : cls, risky,
    model, effort: finalEffort, fork: false, route: route.route, explicitModel: explicit, project: { id: project.id, root: project.root },
  });
  tier = route.modelTier;
  const runMs = (1 + rand() * (cls.startsWith('read') ? 4 : 14)) * MIN;
  const [lo, hi] = COST[tier];
  const cost = round((lo + rand() * (hi - lo)) * EFFORT_COST[finalEffort], 4);
  const tokens = Math.round(cost * (tier === 'haiku' ? 9e6 : tier === 'sonnet' ? 1.6e6 : 4.5e5));
  const files = cls.startsWith('edit') || (cls === 'design-open' && rand() < 0.5)
    ? [`${project.root}/src/${pick(['export', 'records', 'csv', 'paging', 'upload'])}-${hex(4)}.js`, `${project.root}/test/${pick(['export', 'csv', 'paging'])}-${hex(4)}.test.js`]
    : [];
  files.forEach((file, i) => records.push({ v: 1, type: 'signal', kind: 'write', ts: iso(at + runMs * (0.4 + 0.2 * i)), session, agentId, file }));
  const end = at + runMs;
  const roll = rand();
  if (roll < 0.03) return end; // cancelled: no report before the session ends
  const failed = roll > 1 - (1 - pSuccess) * 0.35;
  const status = failed ? 'failed' : 'completed';
  records.push({ v: 1, type: 'report', ts: iso(end), session, agentId, subagentType, status, model, effort: finalEffort, costUsd: cost, tokens });
  if (!failed && rand() > pSuccess) {
    // rework: the main session edits one of the subagent's files, or a similar start of the same class follows
    if (files.length > 0) records.push({ v: 1, type: 'signal', kind: 'write', ts: iso(end + (3 + rand() * 15) * MIN), session, file: files[0] });
    else records.push({ v: 1, type: 'signal', kind: 'prompt', ts: iso(end + 2 * MIN), session, text: `That is not right: ${description.replace(/^\[mr:[^\]]+\] /, '').toLowerCase()} again, more carefully` });
  }
  return end;
}

function build(nowMs) {
  const records = [];
  const firstDay = Math.floor(nowMs / DAY) * DAY - 41 * DAY;
  for (let day = firstDay; day < nowMs; day += DAY) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const sessions = 2 + Math.floor(rand() * 3);
    for (let s = 0; s < sessions; s += 1) {
      const session = `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
      const project = rand() < PROJECTS[0].share ? PROJECTS[0] : PROJECTS[1];
      let at = day + (8 + s * 3 + rand() * 2) * 3600000;
      if (at > nowMs - 90 * MIN) break;
      const tasks = 2 + Math.floor(rand() * 5);
      const used = new Set();
      for (let t = 0; t < tasks && at < nowMs - 60 * MIN; t += 1) at = task(records, session, at, project, used) + (2 + rand() * 10) * MIN;
      const endAt = Math.min(at + 40 * MIN, nowMs - 30 * MIN);
      records.push({ v: 1, type: 'session-end', ts: iso(endAt), session, reason: 'prompt_input_exit' });
    }
  }
  return records.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

const configDir = process.argv[2];
if (!configDir) {
  process.stderr.write('usage: node demo-events.mjs <config dir>\n');
  process.exit(1);
}
const dir = join(configDir, 'model-router');
const file = join(dir, 'events.jsonl');
if (existsSync(file)) {
  process.stderr.write(`refusing to overwrite ${file}\n`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const records = build(Date.now());
writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
process.stdout.write(`${records.length} records, ${records.filter((r) => r.type === 'spawn').length} tasks -> ${file}\n`);

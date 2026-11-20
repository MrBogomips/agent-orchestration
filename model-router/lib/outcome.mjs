// The outcome of each task (one subagent start), fixed when its rework window closes.
// See docs/design/model-router-quality-loop.md, "Signals" and "Outcome of one task".
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.
import { isSimilar, mentionsFile } from './text.mjs';
import { familyOf, effortOf } from './tiers.mjs';

const STALE_MS = 24 * 3600 * 1000;
const PROMPTS_ABOUT_TASK = 2;

const time = (record) => Date.parse(record.ts);
export const taskKey = (session, agentId) => `${session}/${agentId}`;

function bySession(events) {
  const sessions = new Map();
  for (const record of events) {
    if (!record || typeof record.session !== 'string' || !Number.isFinite(time(record))) continue;
    if (!sessions.has(record.session)) sessions.set(record.session, []);
    sessions.get(record.session).push(record);
  }
  return sessions;
}

function reworkSignals(task, records, start, end, threshold) {
  const inWindow = records.filter((r) => time(r) > start && time(r) <= end);
  const why = [];
  const own = task.spawn.agentId;
  const sameFile = inWindow.find((r) => r.type === 'signal' && r.kind === 'write' && r.agentId !== own && task.files.includes(r.file));
  if (sameFile) why.push(`write to ${sameFile.file}`);
  const redo = inWindow.find(
    (r) => r.type === 'spawn' && r.agentId !== own && task.spawn.class && r.class === task.spawn.class &&
      isSimilar(r.description, task.spawn.description, threshold),
  );
  if (redo) why.push(`similar ${redo.class} start`);
  const prompts = inWindow.filter((r) => r.type === 'signal' && r.kind === 'prompt').slice(0, PROMPTS_ABOUT_TASK);
  const about = prompts.find((p) => mentionsFile(p.text, task.files) || isSimilar(p.text, task.spawn.description, threshold));
  if (about) why.push('prompt about the task');
  return why;
}

function stoppedByParent(task, records) {
  const ids = [task.spawn.agentId, task.spawn.name].filter(Boolean);
  return records.some(
    (r) => r.type === 'signal' && r.kind === 'stop' && ids.includes(r.target) && (r.agentId ?? null) === (task.spawn.parentAgentId ?? null),
  );
}

function classify(task, records, end, threshold) {
  const report = task.report;
  if (!report) return { outcome: 'cancelled', why: ['no report'] };
  const why = reworkSignals(task, records, time(report), end, threshold);
  if (report.status === 'failed') return { outcome: 'failure', why: ['failed', ...why] };
  if (report.status === 'stopped') {
    return stoppedByParent(task, records) && why.length > 0
      ? { outcome: 'failure', why: ['stopped by the parent', ...why] }
      : { outcome: 'cancelled', why: ['stopped', ...why] };
  }
  return why.length > 0 ? { outcome: 'rework', why } : { outcome: 'success', why: [] };
}

function windowEnd(task, sessionEnd, windowMs, now) {
  if (task.report) {
    const end = time(task.report) + windowMs;
    if (sessionEnd !== null && sessionEnd < end) return { end: sessionEnd, closed: true };
    return { end, closed: now >= end };
  }
  if (sessionEnd !== null) return { end: sessionEnd, closed: true };
  return { end: now, closed: now - time(task.spawn) >= STALE_MS };
}

function outcomeRecord(task, result, now) {
  const { spawn, report } = task;
  const model = report?.model ?? spawn.model ?? null;
  const tier = familyOf(model);
  const effort = effortOf(report?.effort) ?? effortOf(spawn.effort);
  const cls = spawn.class ?? null;
  const learn = result.outcome !== 'cancelled' && cls !== null && cls !== 'unknown' && !spawn.risky && tier !== 'other' && effort !== null;
  return {
    v: 1, type: 'outcome', ts: new Date(now).toISOString(), session: spawn.session, agentId: spawn.agentId,
    task: taskKey(spawn.session, spawn.agentId), class: cls, tier, model, effort, outcome: result.outcome,
    why: result.why.join('; '), weak: task.files.length === 0, learn, explore: false, route: spawn.route ?? null,
    costUsd: typeof report?.costUsd === 'number' ? report.costUsd : null,
    tokens: typeof report?.tokens === 'number' ? report.tokens : null,
    project: spawn.project ?? null, reportTs: report?.ts ?? null,
  };
}

function tasksOf(records) {
  const tasks = new Map();
  for (const r of records) {
    if (r.type === 'spawn' && r.agentId && !tasks.has(r.agentId)) tasks.set(r.agentId, { spawn: r, report: null, files: [] });
  }
  for (const r of records) {
    const task = r.agentId ? tasks.get(r.agentId) : undefined;
    if (!task) continue;
    if (r.type === 'report') task.report = r;
    if (r.type === 'signal' && r.kind === 'write' && r.file && !task.files.includes(r.file)) task.files.push(r.file);
  }
  return tasks;
}

/**
 * Outcomes of the tasks in `events` whose window has closed at `now` (ms), skipping the keys in `done`.
 * Returns `{ outcomes, openTasks }`, `openTasks` the keys still waiting for their window.
 */
export function computeOutcomes(events, { now, windowMin, similarityThreshold, done = new Set() }) {
  const windowMs = windowMin * 60000;
  const outcomes = [];
  const openTasks = new Set();
  for (const [session, records] of bySession(events)) {
    const ended = records.find((r) => r.type === 'session-end');
    const sessionEnd = ended ? time(ended) : null;
    for (const task of tasksOf(records).values()) {
      const key = taskKey(session, task.spawn.agentId);
      if (done.has(key)) continue;
      const { end, closed } = windowEnd(task, sessionEnd, windowMs, now);
      if (!closed) {
        openTasks.add(key);
        continue;
      }
      outcomes.push(outcomeRecord(task, classify(task, records, end, similarityThreshold), now));
    }
  }
  return { outcomes, openTasks };
}

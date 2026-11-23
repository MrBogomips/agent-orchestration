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

/** The base names of the file-like tokens of a description (a word with a `.` or `/` inside), lowercased. */
function fileNames(text) {
  if (typeof text !== 'string') return new Set();
  return new Set(text.toLowerCase().split(/[\s,;:()'"`[\]]+/).map((w) => w.replace(/^[.]+|[.!?]+$/g, ''))
    .filter((w) => /[a-z0-9_-][./][a-z0-9_]/.test(w)).map((w) => w.split('/').filter(Boolean).pop()).filter(Boolean));
}

/**
 * Whether a later start redoes the task: same class and similar description, unless it is the next item of a
 * batch. A batch item names files, the task names files too, the two share no base name and the later start names
 * no file the task wrote (rename in a.ts, then in b.ts). A start that names no file, or the same file in another
 * form (src/csv.ts and /repo/src/csv.ts), is still a redo.
 */
function isRedo(task, r, threshold) {
  if (r.type !== 'spawn' || r.agentId === task.spawn.agentId || !task.spawn.class || r.class !== task.spawn.class) return false;
  if (!isSimilar(r.description, task.spawn.description, threshold)) return false;
  if (mentionsFile(r.description, task.files)) return true;
  const [a, b] = [fileNames(task.spawn.description), fileNames(r.description)];
  const batch = a.size > 0 && b.size > 0 && [...a].every((w) => !b.has(w));
  return !batch;
}

/** Whether the parent sent the same subagent more work inside the rework window of one of its reports. */
function continuedAfterReport(task, windowMs) {
  return task.resumes.some((r) => task.reports.some((p) => time(p) < time(r) && time(r) <= time(p) + windowMs));
}

function reworkSignals(task, records, start, end, threshold) {
  const inWindow = records.filter((r) => time(r) > start && time(r) <= end);
  const why = [];
  const own = task.spawn.agentId;
  const sameFile = inWindow.find((r) => r.type === 'signal' && r.kind === 'write' && r.agentId !== own && task.files.includes(r.file));
  if (sameFile) why.push(`write to ${sameFile.file}`);
  const redo = inWindow.find((r) => isRedo(task, r, threshold));
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

function classify(task, records, end, threshold, windowMs) {
  const report = task.report;
  if (!report) return { outcome: 'cancelled', why: ['no report'] };
  const why = reworkSignals(task, records, time(report), end, threshold);
  if (continuedAfterReport(task, windowMs)) why.push('continued after its report');
  if (report.status === 'failed') return { outcome: 'failure', why: ['failed', ...why] };
  if (report.status === 'stopped') {
    return stoppedByParent(task, records) && why.length > 0
      ? { outcome: 'failure', why: ['stopped by the parent', ...why] }
      : { outcome: 'cancelled', why: ['stopped', ...why] };
  }
  return why.length > 0 ? { outcome: 'rework', why } : { outcome: 'success', why: [] };
}

/** The first end of the session at or after `start`: a resumed session keeps its id and ends again later. */
function endAfter(ends, start) {
  return ends.find((t) => t >= start) ?? null;
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
    task: taskKey(spawn.session, spawn.agentId), class: cls, tier, model, parentModel: spawn.parentModel ?? null,
    effort, outcome: result.outcome,
    why: result.why.join('; '), weak: task.files.length === 0, learn, explore: false, route: spawn.route ?? null,
    costUsd: typeof report?.costUsd === 'number' ? report.costUsd : null,
    tokens: typeof report?.tokens === 'number' ? report.tokens : null,
    project: spawn.project ?? null, reportTs: report?.ts ?? null,
  };
}

function tasksOf(records) {
  const tasks = new Map();
  for (const r of records) {
    if (r.type === 'spawn' && r.agentId && !tasks.has(r.agentId)) tasks.set(r.agentId, { spawn: r, report: null, reports: [], resumes: [], files: [] });
  }
  for (const r of records) {
    const task = r.agentId ? tasks.get(r.agentId) : undefined;
    if (!task) continue;
    if (r.type === 'report') {
      task.report = r;
      task.reports.push(r);
    }
    if (r.type === 'signal' && r.kind === 'resume') task.resumes.push(r);
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
    const ends = records.filter((r) => r.type === 'session-end').map(time).sort((a, b) => a - b);
    for (const task of tasksOf(records).values()) {
      const key = taskKey(session, task.spawn.agentId);
      if (done.has(key)) continue;
      const { end, closed } = windowEnd(task, endAfter(ends, time(task.spawn)), windowMs, now);
      if (!closed) {
        openTasks.add(key);
        continue;
      }
      outcomes.push(outcomeRecord(task, classify(task, records, end, similarityThreshold, windowMs), now));
    }
  }
  return { outcomes, openTasks };
}

// Reading and writing the event log and the files next to it, without ever holding a log whole.
// See docs/design/model-router-quality-loop.md, "Reading a long log" and "Rotation".
import { readFileSync, readSync, writeFileSync, mkdirSync, openSync, closeSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const CHUNK_BYTES = 1 << 20;
// A torn last line untouched for this long has no writer left: appends are one short `cat >>`.
export const TORN_STALE_MS = 2 * 60000;

/**
 * Reads the complete lines of a file from byte `from`, one chunk at a time, so the file is never held whole (a
 * log past 2 GB cannot be read in one piece). Calls `onLine(text, start)` for each line ending in a newline, with
 * the byte offset of its start, and returns the offset just after the last complete line.
 */
export function eachLine(file, from, onLine, chunkBytes = CHUNK_BYTES) {
  const fd = openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(Math.max(1, chunkBytes));
    let carry = Buffer.alloc(0);
    let carryStart = from;
    let pos = from;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      let at = 0;
      for (let nl = data.indexOf(10, at); nl >= 0; nl = data.indexOf(10, at)) {
        onLine(data.subarray(at, nl).toString('utf8'), carryStart + at);
        at = nl + 1;
      }
      carry = Buffer.from(data.subarray(at));
      carryStart += at;
    }
    return carryStart;
  } finally {
    closeSync(fd);
  }
}

/** The record on one line, or null for a blank or malformed line (skipped, never fatal). */
export function parseLine(text) {
  const line = text.trim();
  if (!line) return null;
  try {
    const record = JSON.parse(line);
    return record && typeof record === 'object' ? record : null;
  } catch {
    return null;
  }
}

/**
 * The parseable records of one or more log files, read in the order given, that `keep` accepts (all by default),
 * and how many parseable records they hold in all. `keep` may return a smaller copy of the record to hold; an
 * absent file reads as empty.
 */
export function scanEvents(files, { keep = (r) => r, chunkBytes = CHUNK_BYTES } = {}) {
  const records = [];
  let total = 0;
  for (const file of Array.isArray(files) ? files : [files]) {
    if (!existsSync(file)) continue;
    eachLine(file, 0, (text) => {
      const record = parseLine(text);
      if (!record) return;
      total += 1;
      const kept = keep(record);
      if (kept) records.push(kept === true ? record : kept);
    }, chunkBytes);
  }
  return { records, total };
}

/** Every parseable record of an event log, in order; an absent file reads as empty. */
export function readEvents(file, { chunkBytes = CHUNK_BYTES } = {}) {
  return scanEvents(file, { chunkBytes }).records;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes a file whole: a temporary name in the same folder, then a rename. */
export function writeWhole(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * How a log ends: `whole` (empty, or on a newline), `writing` (a torn last line changed within the last two
 * minutes: a writer may still be finishing it) or `abandoned` (a torn last line older than that).
 */
export function tailOf(file, now) {
  const { size, mtimeMs } = statSync(file);
  if (size === 0) return 'whole';
  const fd = openSync(file, 'r');
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 10) return 'whole';
  } finally {
    closeSync(fd);
  }
  return now - mtimeMs < TORN_STALE_MS ? 'writing' : 'abandoned';
}

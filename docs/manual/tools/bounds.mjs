#!/usr/bin/env node
// Finds the part of a terminal capture to keep, and prints it as ansi2html.mjs options. No dependencies.
//
// Usage:
//   node bounds.mjs <capture> dock                       the pane docked on the right: from the row above its header
//                                                        (the close mark) to its footer, from the column after the
//                                                        dock's border to the end of the line
//   node bounds.mjs <capture> lines <start> <end> [n]    from the first line matching the regular expression <start>
//                                                        to the last line matching <end> after it, plus n lines
// Prints `--from <a> --to <b> [--cols <c>:]`; exits 1 when the capture has no such part.
import { readFileSync } from 'node:fs';

import { isWide, isZeroWidth } from './ansi2html.mjs';

const strip = (line) => line.replace(/\x1b(\[[0-9;:?]*[A-Za-z]|\][^\x07\x1b]*(\x07|\x1b\\)|.)/g, '');

/** The terminal column (1-based) where the character at `index` of the plain line starts. */
function columnAt(plain, index) {
  let col = 1;
  for (const ch of plain.slice(0, index)) {
    const cp = ch.codePointAt(0);
    if (!isZeroWidth(cp)) col += isWide(cp) ? 2 : 1;
  }
  return col;
}

function fail(message) {
  process.stderr.write(`bounds.mjs: ${message}\n`);
  process.exit(1);
}

function dock(lines) {
  const header = lines.findIndex((l) => /│🔀 model-router/.test(l));
  if (header < 0) fail('no docked model-router pane in the capture');
  const footer = lines.findIndex((l, i) => i > header && /Tab\/⇧Tab tab/.test(l));
  if (footer < 0) fail('the pane has no footer in the capture');
  const border = lines[header].indexOf('│🔀');
  return `--from ${header} --to ${footer + 1} --cols ${columnAt(lines[header], border) + 1}:`;
}

function span(lines, start, end, extra) {
  const from = lines.findIndex((l) => new RegExp(start).test(l));
  if (from < 0) fail(`no line matches ${start}`);
  let to = -1;
  lines.forEach((l, i) => {
    if (i >= from && new RegExp(end).test(l)) to = i;
  });
  if (to < 0) fail(`no line after ${start} matches ${end}`);
  return `--from ${from + 1} --to ${Math.min(lines.length, to + 1 + extra)}`;
}

const [file, mode, start, end, extra] = process.argv.slice(2);
if (!file || !mode) fail('usage: node bounds.mjs <capture> dock | lines <start> <end> [n]');
const lines = readFileSync(file, 'utf8').replace(/\n$/, '').split('\n').map(strip);
if (mode === 'dock') process.stdout.write(`${dock(lines)}\n`);
else if (mode === 'lines' && start && end) process.stdout.write(`${span(lines, start, end, Number(extra) || 0)}\n`);
else fail(`unknown mode ${mode}`);

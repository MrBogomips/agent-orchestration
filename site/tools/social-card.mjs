#!/usr/bin/env node
// Renders site/assets/social-card.png (1200×630, the picture shown when a link to the site is shared) from an
// HTML card in the site's style, with headless Chrome. An authoring step: the PNG is committed.
// CHROME may name the browser; the default is Google Chrome on macOS.
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const site = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hero = join(site, 'assets/img/illus-hero.jpg');
const card = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;800&family=IBM+Plex+Mono:wght@500&display=swap">
<style>html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#090A18;font-family:Manrope,sans-serif}
.bg{position:absolute;inset:0;background:url("file://${hero}") right center/cover no-repeat;opacity:.9}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#090A18 38%,rgba(9,10,24,.2) 75%)}
.c{position:absolute;left:72px;top:96px;width:620px;color:#ECEAFB}
.e{font:500 20px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#A78BFA}
h1{font-size:62px;line-height:1.04;margin:22px 0;font-weight:800;letter-spacing:-.02em}
h1 em{font-style:normal;background:linear-gradient(120deg,#A78BFA,#38BDF8);-webkit-background-clip:text;color:transparent}
p{font-size:26px;color:#A6ABD4;margin:0}</style></head><body><div class="bg"></div><div class="fade"></div>
<div class="c"><div class="e">session-hub · model-router</div><h1>Many sessions.<br>Many repositories.<br><em>The right model.</em></h1>
<p>Two plugins for Claude Code</p></div></body></html>`;
const work = mkdtempSync(join(tmpdir(), 'card-'));
try {
  writeFileSync(join(work, 'card.html'), card);
  const out = join(site, 'assets/social-card.png');
  const r = spawnSync(chrome, ['--headless', '--hide-scrollbars', '--window-size=1200,630', '--virtual-time-budget=4000',
    `--screenshot=${out}`, `file://${join(work, 'card.html')}`], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`Chrome exited with ${r.status}`);
  console.log(`${out} (${readFileSync(out).length} bytes)`);
} catch (err) {
  console.error(`social-card: ${err.message}`);
  process.exitCode = 1;
} finally { rmSync(work, { recursive: true, force: true }); }

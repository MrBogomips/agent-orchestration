// A deliberately small Markdown renderer for CHANGELOG.md: headings, paragraphs, lists, links, inline code,
// bold and fenced code. Anything else is rendered as text.
import { escapeHtml } from './text.mjs';

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
}

export function renderMarkdown(source, { skipTitle = true } = {}) {
  const out = [];
  let list = null;
  let para = [];
  let fence = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; } };
  for (const line of source.split('\n')) {
    if (fence !== null) {
      if (line.startsWith('```')) { out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`); fence = null; } else fence.push(line);
      continue;
    }
    if (line.startsWith('```')) { flushPara(); flushList(); fence = []; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      if (level === 1 && skipTitle) continue;
      const tag = `h${Math.min(level, 3)}`;
      out.push(`<${tag}>${inline(h[2])}</${tag}>`); // ids are added, unique, by addHeadingIds
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flushPara(); (list ??= []).push(li[1]); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list[list.length - 1] += ` ${line.trim()}`; continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

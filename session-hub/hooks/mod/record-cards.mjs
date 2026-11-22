// The children record as children and a timeline: what the Record view of the Session hub card
// (hooks/mod/hub-card.mjs) draws from the record the registry script reads. Pure: texts already formatted. The
// record holds names, paths and URLs only, and so does the view.
// See docs/design/session-hub.md, "The card on the desktop app".

/** The most timeline rows drawn; the rest are counted. */
export const TIMELINE_SHOWN = 40;
const TEXT_CHARS = 200;

// A status as the theme's good, fair and bad, as in the children panel; `done` and anything else are neutral.
const STATUS_TONES = Object.freeze({ running: 'good', 'waiting-user': 'fair', abandoned: 'fair', lost: 'bad' });
// What a child's message reads as in the timeline.
const MESSAGE_TONES = Object.freeze({ done: 'good', blocked: 'bad', question: 'fair', out_of_scope: 'fair', pr: 'accent' });

const text = (value) => (typeof value === 'string' && value !== '' ? value.slice(0, TEXT_CHARS) : null);
const when = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : null);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const timeOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
};

/** One child as a card: its status as a chip, what it runs on, when it started, its last message, its requests. */
function childCard(child) {
  const status = text(child.status) ?? 'unknown';
  const requests = Array.isArray(child.requests) ? child.requests.length : 0;
  const last = child.lastMessage && typeof child.lastMessage === 'object' ? child.lastMessage : null;
  return {
    name: child.name,
    status: { text: status, tone: STATUS_TONES[status] ?? 'dim' },
    reason: text(child.reason),
    runs: [text(child.model), text(child.effort)].filter(Boolean).join(' · ') || 'model and effort not recorded',
    where: [text(child.repo), text(child.task)].filter(Boolean).join(' · ') || null,
    started: when(child.started) ? `started ${when(child.started)} UTC` : 'start not recorded',
    last: last && text(last.type) ? [`last message: ${last.type}`, when(last.at), text(last.text)].filter(Boolean).join(' · ') : 'no message yet',
    requests: requests ? plural(requests, 'request') : 'no request',
  };
}

/** What happened to one child, as timeline events: its start, its last message, each request and its outcome. */
function eventsOf(child) {
  const events = [];
  if (when(child.started)) events.push({ at: child.started, what: { text: 'started', tone: 'dim' }, text: [text(child.repo), text(child.task)].filter(Boolean).join(' · ') });
  const last = child.lastMessage;
  if (last && typeof last === 'object' && text(last.type) && when(last.at)) {
    events.push({ at: last.at, what: { text: String(last.type).slice(0, 24), tone: MESSAGE_TONES[last.type] ?? 'dim' }, text: text(last.text) ?? '' });
  }
  for (const request of Array.isArray(child.requests) ? child.requests : []) {
    if (!request || typeof request !== 'object' || !when(request.at)) continue;
    const outcome = text(request.outcome);
    events.push({ at: request.at, what: { text: 'request', tone: outcome ? 'dim' : 'fair' }, text: `${text(request.text) ?? ''}${outcome ? ` → ${outcome}` : ' → no outcome recorded'}` });
  }
  return events.map((e) => ({ ...e, child: child.name }));
}

/**
 * The record as children and a timeline: `{ subtitle, file, children, timeline, more, empty }`. `timeline` is
 * newest first, at most TIMELINE_SHOWN rows, each `{ when, child, what, text }`; `more` says how many older ones
 * are left out, or null; `total` counts every event. `file` is the record's path.
 */
export function recordView(record, { file } = {}) {
  const list = (Array.isArray(record?.children) ? record.children : []).filter((c) => c !== null && typeof c === 'object' && typeof c.name === 'string');
  const live = list.filter((c) => c.status === 'running' || c.status === 'waiting-user').length;
  const events = list.flatMap(eventsOf).sort((a, b) => timeOf(b.at) - timeOf(a.at));
  const hub = text(record?.hub);
  return {
    subtitle: [plural(list.length, 'child', 'children'), `${live} live`, hub ? `hub ${hub}` : null].filter(Boolean).join(' · '),
    file: file ? `Record: ${file}` : 'Record: path not known',
    children: list.map(childCard),
    timeline: events.slice(0, TIMELINE_SHOWN).map((e) => ({ when: when(e.at), child: e.child, what: e.what, text: e.text })),
    more: events.length > TIMELINE_SHOWN ? `${events.length - TIMELINE_SHOWN} earlier events are in the file.` : null,
    total: events.length,
    empty: list.length ? null : 'No child in the record yet. A child appears here when the master starts one.',
  };
}

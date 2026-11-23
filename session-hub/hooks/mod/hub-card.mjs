// The Session hub card of the desktop app as a plain value: what hooks/card-kit.tsx lays out for the view picked.
// Two views: Children (the children of the record by status, with what the live session list says) and Record (the
// record as counts and a timeline). Pure: the mod passes the role, the master, the children panel's rows and the
// record as the registry script read it; texts come back formatted, drawings as SVG markup.
// See docs/design/session-hub.md, "The card on the desktop app", and docs/design/ui-design.md.
// Plain ES module with no Node or engine imports, so the mod and node tests load it.
import { ACCENT, KIND_COLORS, TONE_COLORS, segmentsSvg } from './card-parts.mjs';
import { recordView } from './record-cards.mjs';

export const CARD_TITLE = 'Session hub';
export const VIEWS = Object.freeze([{ value: 'children', label: 'Children' }, { value: 'record', label: 'Record' }]);
/** The child picker's first option: every child. */
export const ALL = 'all';
/** What a card opens on. `group` is the open status group of Children, null for the first, `none` for none. */
export const DEFAULT_HUB_CARD = Object.freeze({ view: 'children', child: ALL, group: null, isCollapsed: false });
/** The children drawn in the open group at most, and the timeline events of the Record view. */
export const CHILDREN_SHOWN = 12;
export const EVENTS_SHOWN = 7;
/** The children the picker offers at most; the rest are in the record. */
const PICKS_SHOWN = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The statuses of the record, in the order the card lists them, each with its word, tone and colour in the bar. */
export const STATUSES = Object.freeze([
  { status: 'running', name: 'Running', tone: 'good', color: TONE_COLORS.good },
  { status: 'waiting-user', name: 'Waiting for you', tone: 'fair', color: TONE_COLORS.fair },
  { status: 'done', name: 'Done', tone: 'dim', color: ACCENT },
  { status: 'abandoned', name: 'Abandoned', tone: 'dim', color: KIND_COLORS[4] },
  { status: 'lost', name: 'Lost', tone: 'bad', color: TONE_COLORS.bad },
]);
const OTHER = { name: 'Other', tone: 'dim', color: KIND_COLORS[5] };
const TONES = ['good', 'fair', 'bad', 'dim'];

const isText = (v) => typeof v === 'string' && v !== '';
const cap = (text) => (text ? `${String(text)[0].toUpperCase()}${String(text).slice(1)}` : '');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const note = (text, tone = null) => ({ kind: 'note', text, tone });
/** The last part of a path, so that the card shows no machine folder but in its closing line. */
export const baseName = (path) => String(path ?? '').replace(/\/+$/, '').split('/').pop() || String(path ?? '');
const statusOf = (status) => STATUSES.find((s) => s.status === status) ?? { ...OTHER, status };
/** A text whose absolute paths are cut to their last part: the card shows no machine folder but in its last line. */
const noPaths = (text) => String(text ?? '').replace(/(?:\/[^\s/·]+)+\/([^\s/·]+)/g, '$1');
/** `2026-11-20 10:30` (UTC) as `Nov 20, 10:30`. */
function whenText(when) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)$/.exec(String(when ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[4]}` : String(when ?? '');
}
/** A model id and an effort as the card writes them: `Sonnet · medium`. */
function runsOn(model, effort) {
  if (!isText(model) && !isText(effort)) return null;
  const name = isText(model) ? (/(opus|sonnet|fable|haiku)/i.exec(model)?.[1]?.toLowerCase() ?? model) : 'model not recorded';
  return `${cap(name)} · ${isText(effort) ? effort : 'default'}`;
}

/** The view, child, open group and collapsed flag of a card, each a known value. */
export function hubStateOf(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    view: VIEWS.some((v) => v.value === s.view) ? s.view : DEFAULT_HUB_CARD.view,
    child: isText(s.child) ? s.child : ALL,
    group: isText(s.group) ? s.group : null,
    isCollapsed: s.isCollapsed === true,
  };
}

const childrenOf = (record) => (Array.isArray(record?.children) ? record.children : []).filter((c) => c && typeof c === 'object' && isText(c.name));

/** The children counted by status, in the card's order, the empty ones left out: `{ status, name, tone, color, n }`. */
export function statusCounts(children) {
  const counts = new Map();
  for (const c of children) counts.set(c.status ?? 'unknown', (counts.get(c.status ?? 'unknown') ?? 0) + 1);
  const known = STATUSES.filter((s) => counts.has(s.status)).map((s) => ({ ...s, n: counts.get(s.status) }));
  const other = [...counts.keys()].filter((k) => !STATUSES.some((s) => s.status === k)).map((k) => ({ ...OTHER, status: k, n: counts.get(k) }));
  return [...known, ...other];
}

function summaryOf({ role, master, children }) {
  if (role?.kind === 'child') return `child of ${role.master ?? 'a master'}`;
  if (role?.kind === 'invalid') return 'unknown role: guards blocking';
  if (!master?.isMaster) return 'no role';
  const live = children.filter((c) => c.status === 'running' || c.status === 'waiting-user').length;
  return `master · ${plural(children.length, 'child', 'children')}, ${live} live`;
}

function segmentsOf(children) {
  const counts = statusCounts(children);
  if (!children.length) return null;
  return {
    source: segmentsSvg(counts.map((c) => ({ share: c.n / children.length, color: c.color }))),
    alt: `Children by status: ${counts.map((c) => `${c.name} ${c.n}`).join(', ')}`,
  };
}

/** The role and where the session works, as pairs: the first block of Children. */
function roleGrid({ role, master, children, file }) {
  if (role?.kind === 'child') {
    return [
      { label: 'Role', value: `Child of ${role.master ?? '?'}` }, { label: 'Write root', value: baseName(role.scopeRoot) || '–' },
      { label: 'Handoff', value: baseName(role.handoff) || '–' }, { label: 'Guards', value: role.guardsOff ? 'Off' : 'On' },
    ];
  }
  if (role?.kind === 'invalid') return [{ label: 'Role', value: 'Unknown value' }, { label: 'Guards', value: 'Blocking writes and messages' }];
  if (!master?.isMaster) return null;
  const repos = new Set(children.map((c) => c.repo).filter(isText));
  return [
    { label: 'Role', value: 'Master' }, { label: 'Hub', value: master.hub ? baseName(master.hub) : '–' },
    { label: 'Repositories', value: String(repos.size) }, { label: 'Record', value: file ? baseName(file) : master.record ? baseName(master.record) : '–' },
  ];
}

function childRow(child, live) {
  const st = statusOf(child.status);
  const row = live?.get(child.name);
  const sub = [
    row && row.live !== '?' ? `live: ${row.live}` : null,
    row && row.last !== '-' ? `last message: ${row.last}` : child.lastMessage?.type ? `last message: ${child.lastMessage.type}` : null,
    isText(child.reason) ? child.reason : null,
  ].filter(Boolean).join(' · ');
  return { tone: TONES.includes(st.tone) ? st.tone : 'dim', text: child.name, strong: true, value: runsOn(child.model, child.effort), sub: sub || null };
}

function childrenBlocks(input, children) {
  const grid = roleGrid({ ...input, children });
  const blocks = grid ? [{ kind: 'grid', pairs: grid }] : [];
  if (input.role?.kind !== 'child' && !input.master?.isMaster) {
    return [...blocks, note('This session has no session-hub role. It becomes a master when it uses session-hub:spawn or session-hub:dispatch.')];
  }
  if (!children.length) return [...blocks, note('No child in the record yet. A child appears here when the master starts one.')];
  const counts = statusCounts(children);
  const open = input.state.group === 'none' ? null : counts.some((c) => c.status === input.state.group) ? input.state.group : counts[0].status;
  const live = new Map((input.panel?.rows ?? []).map((r) => [r.name, r]));
  const groups = counts.map((c) => {
    const members = c.status === open ? children.filter((child) => (child.status ?? 'unknown') === c.status) : [];
    const rows = members.slice(0, CHILDREN_SHOWN).map((child) => childRow(child, live));
    const more = members.length - rows.length;
    return {
      key: c.status, name: c.name, count: String(c.n), isOpen: c.status === open, aside: null,
      rows: more > 0 ? [...rows, { text: `${more} more in the record`, value: null }] : rows,
    };
  });
  const updated = input.panel?.updatedAt ? note(`Updated ${String(input.panel.updatedAt).slice(11, 16)} UTC; live status from the session list.`) : null;
  return [...blocks, { kind: 'groups', groups }, ...(updated ? [updated] : [])];
}

function recordBlocks(input, children) {
  const view = recordView(input.log?.record, { file: input.log?.file });
  const requests = children.reduce((n, c) => n + (Array.isArray(c.requests) ? c.requests.length : 0), 0);
  const starts = children.map((c) => c.started).filter(isText).sort();
  const picked = input.state.child !== ALL && children.some((c) => c.name === input.state.child) ? input.state.child : null;
  const events = view.timeline.filter((e) => !picked || e.child === picked);
  const shown = events.slice(0, EVENTS_SHOWN);
  // The view keeps the newest events only: for all children the rest of the record's are counted too.
  const left = (picked ? events.length : view.total) - shown.length;
  return [
    { kind: 'grid', pairs: [
      { label: 'Children', value: String(children.length) }, { label: 'Events', value: String(view.total) },
      { label: 'First start', value: starts.length ? whenText(`${starts[0].slice(0, 10)} ${starts[0].slice(11, 16)}`) : '–' }, { label: 'Requests', value: String(requests) },
    ] },
    ...(shown.length
      ? [{ kind: 'table', title: 'Timeline', aside: `latest ${shown.length}${picked ? ` of ${picked}` : ''}`, rows: shown.map((e) => ({
        label: [picked ? null : e.child, e.what.text, noPaths(e.text).replace(/ → /g, ': ')].filter(Boolean).join(' · '), value: whenText(e.when) || '–', tone: TONES.includes(e.what.tone) ? e.what.tone : null,
      })) }]
      : [note(children.length ? 'No event for this child yet.' : 'No child in the record yet. A child appears here when the master starts one.')]),
    ...(left > 0 ? [note(`${plural(left, 'earlier event')} in the record.`)] : []),
  ];
}

function closing(file) {
  return file ? [{ kind: 'markdown', text: `The record is [${baseName(file)}](file://${encodeURI(file)}).` }] : [];
}

/** The view dropdown, and on Record the child picker at the right (drawn in the card's scope slot). */
function navOf(state, children) {
  const view = { view: { value: state.view, options: VIEWS } };
  if (state.view !== 'record' || !children.length) return view;
  const options = [{ value: ALL, label: 'All children' }, ...children.slice(0, PICKS_SHOWN).map((c) => ({ value: c.name, label: c.name }))];
  return { ...view, scope: { value: options.some((o) => o.value === state.child) ? state.child : ALL, options } };
}

/**
 * The card for a state and what was read: `role` (hooks/mod/role.mjs), `master`, `panel` (the children panel's rows,
 * with the live status), `log` ({ record, file, error, isLoading }, the record as read). A view whose record is not
 * read yet says so in one line; a view that cannot be built says why, and the card is still drawn.
 */
export function hubCardOf(input) {
  const state = hubStateOf(input.state);
  const children = childrenOf(input.log?.record);
  const file = input.log?.file ?? null;
  const reading = !input.log?.record && (input.log?.isLoading || !input.log?.error);
  const failed = input.log?.error ? [note(input.log.error, 'warn')] : [];
  let blocks;
  try {
    if (state.view === 'record') blocks = input.log?.record ? [...recordBlocks({ ...input, state }, children), ...closing(file)] : failed.length ? failed : [note('Reading the children record…')];
    else {
      // A session with no role has no record to read: its note says so, and no read error is added under it.
      const hasRole = input.master?.isMaster || input.role?.kind === 'child';
      const status = !hasRole ? [] : reading ? [note('Reading the children record…')] : failed;
      blocks = [...childrenBlocks({ ...input, state, file }, children), ...status, ...closing(file)];
    }
  } catch (err) {
    blocks = [note(`Could not draw this view: ${String(err?.message ?? err).slice(0, 200)}`, 'warn')];
  }
  return {
    title: CARD_TITLE, icon: 'hub', summary: summaryOf({ ...input, children }), isCollapsed: state.isCollapsed,
    segments: segmentsOf(children), nav: navOf(state, children), blocks,
  };
}

/** `/session-hub help` on the desktop app: what each argument opens the card on. */
export function hubHelpCard() {
  return {
    title: '/session-hub', icon: 'hub', summary: '', isCollapsed: false, isStatic: true, segments: null, nav: null,
    blocks: [
      { kind: 'list', rows: [
        { term: '(nothing)', text: 'The card on Children: this session\'s role, and in a master its children by status' },
        { term: 'log  record', text: 'The card on Record: the children record as counts and a timeline' },
        { term: 'help', text: 'This list' },
      ] },
      note('For you only: the model has the scope in its own scope line, and reads the children from the record.'),
    ],
  };
}

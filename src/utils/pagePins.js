/*
 * Nightly 'comment-pins': page pins (Drawboard Projects build item 6).
 * A pin is a page thread with a spot on the page (mark_comments root with
 * pin_x / pin_y, migration 20261110156000). It is a Comment, an Issue or a
 * Task; issues and tasks carry a status and a number (ISS-7, TSK-1).
 *   - N arms the Pin tool; while it is on, M cycles Comment, Issue, Task
 *     (plain M still puts the tools down everywhere else).
 *   - The pin's square bottom-left corner sits on the clicked point and it
 *     stays 26 px at every zoom.
 *   - Done items (issue Closed / Approved / Rejected, task Closed) hide
 *     unless "Show done items" is on; an open card keeps its own pin shown.
 *   - The "Show pins" switches are saved per person on this device.
 * Survey goes past Drawboard in one place: a pin can be dragged.
 */

export const PIN_TOOL_ID = 'pin';
export const PIN_SIZE = 26;
/** Pin paint: the white glyph on a status circle, the dark pin body, a person-less face. */
export const PIN_INK = '#ffffff';
export const PIN_BODY = '#212730';
export const PIN_NO_AUTHOR = '#919A9F';
export const PIN_FACE = 20;
export const PIN_KINDS = Object.freeze(['comment', 'issue', 'task']);
export const PIN_KIND_LABELS = Object.freeze({ comment: 'Comment', issue: 'Issue', task: 'Task' });
export const PIN_CODES = Object.freeze({ issue: 'ISS', task: 'TSK' });

// Status ids match the database check (20261110156000_comment_pins.sql).
export const PIN_STATUSES = Object.freeze({
  issue: Object.freeze(['draft', 'open', 'pending', 'in-review', 'closed', 'approved', 'rejected']),
  task: Object.freeze(['draft', 'open', 'pending', 'in-review', 'on-hold', 'closed']),
});
export const PIN_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  open: 'Open',
  pending: 'Pending',
  'in-review': 'In Review',
  'on-hold': 'On Hold',
  closed: 'Closed',
  approved: 'Approved',
  rejected: 'Rejected',
});
// Drawboard's colours: the pin's circle and the status pill share them.
const STATUS_COLORS = Object.freeze({
  draft: '#919A9F',
  open: '#558EFA',
  pending: '#E8B025',
  'in-review': '#EC7644',
  'on-hold': '#9458F6',
  approved: '#00AB65',
  rejected: '#E04758',
});
const DONE = Object.freeze({
  issue: Object.freeze(['closed', 'approved', 'rejected']),
  task: Object.freeze(['closed']),
});

export const normalizePinKind = (kind) => (PIN_KINDS.includes(kind) ? kind : 'comment');
export const nextPinKind = (kind) => PIN_KINDS[(PIN_KINDS.indexOf(normalizePinKind(kind)) + 1) % PIN_KINDS.length];

export function normalizePinStatus(kind, status) {
  const list = PIN_STATUSES[kind];
  if (!list) return null;
  return list.includes(status) ? status : 'draft';
}

export function pinStatusColor(kind, status) {
  if (status === 'closed') return kind === 'task' ? '#00AB65' : '#666666';
  return STATUS_COLORS[status] || STATUS_COLORS.draft;
}

export function isPinDone(pin) {
  return Boolean(pin && DONE[pin.kind]?.includes(pin.status));
}

export function pinCode(pin) {
  const code = PIN_CODES[pin?.kind];
  return code && pin.number ? `${code}-${pin.number}` : '';
}

/** A comment row (services/markComments mapCommentRow) as a pin, or null. */
export function pinFromComment(comment) {
  const pin = comment?.pin;
  if (!pin || comment.threadId || comment.deletedAt) return null;
  const kind = normalizePinKind(pin.kind);
  return {
    id: comment.id,
    kind,
    status: kind === 'comment' ? null : normalizePinStatus(kind, pin.status),
    number: kind === 'comment' ? null : Number(pin.number) || null,
    pageNumber: comment.pageNumber,
    x: Number(pin.x) || 0,
    y: Number(pin.y) || 0,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: comment.createdAt,
    comment,
  };
}

/** The document's pins, oldest first (a newer pin sits on top). */
export function pinsFromComments(comments) {
  return (comments || []).map(pinFromComment).filter(Boolean);
}

// --- "Show pins" ---------------------------------------------------------

export const DEFAULT_PIN_FILTER = Object.freeze({ comments: true, issues: true, tasks: true, done: false });
const FILTER_KEY = 'survey.pins.filter';
const KIND_SWITCH = Object.freeze({ comment: 'comments', issue: 'issues', task: 'tasks' });

export function normalizePinFilter(filter) {
  const f = filter && typeof filter === 'object' ? filter : {};
  return {
    comments: f.comments !== false,
    issues: f.issues !== false,
    tasks: f.tasks !== false,
    done: f.done === true,
  };
}

/** The master switch shows on only when all three kinds are on. */
export const pinFilterAllOn = (filter) => Boolean(filter.comments && filter.issues && filter.tasks);

/** A click on the master: on turns all three off; otherwise all three on. */
export function togglePinFilterMaster(filter) {
  const on = !pinFilterAllOn(filter);
  return { ...filter, comments: on, issues: on, tasks: on };
}

export function isPinShown(pin, filter, { openId = null } = {}) {
  if (!pin) return false;
  if (pin.id === openId) return true;
  if (!filter[KIND_SWITCH[pin.kind]]) return false;
  return filter.done || !isPinDone(pin);
}

const filterKey = (userId) => (userId ? `${FILTER_KEY}:${userId}` : FILTER_KEY);
export function readPinFilter(userId) {
  try {
    return normalizePinFilter(JSON.parse(globalThis.localStorage?.getItem(filterKey(userId)) || 'null'));
  } catch {
    return { ...DEFAULT_PIN_FILTER };
  }
}
export function savePinFilter(userId, filter) {
  try { globalThis.localStorage?.setItem(filterKey(userId), JSON.stringify(normalizePinFilter(filter))); } catch { /* not kept */ }
}

// --- Keys and placing ----------------------------------------------------

const plainKey = (event, code) => event?.code === code && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
export const isPinToolKey = (event) => plainKey(event, 'KeyN');
export const isPinCycleKey = (event) => plainKey(event, 'KeyM');

/**
 * The page point under a pointer, from the page box on screen (any zoom or
 * page size): the pin's bottom-left corner goes here.
 */
export function pagePointFromClient(rect, clientX, clientY, pageWidth, pageHeight) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const x = ((clientX - rect.left) / rect.width) * pageWidth;
  const y = ((clientY - rect.top) / rect.height) * pageHeight;
  return {
    x: Math.min(pageWidth, Math.max(0, x)),
    y: Math.min(pageHeight, Math.max(0, y)),
  };
}

/** Where a pin sits on its page box, as CSS percentages. */
export function pinPlacement(pin, pageWidth, pageHeight) {
  const w = Number(pageWidth) || 1;
  const h = Number(pageHeight) || 1;
  return {
    left: `${(Math.min(w, Math.max(0, pin.x)) / w) * 100}%`,
    top: `${(Math.min(h, Math.max(0, pin.y)) / h) * 100}%`,
  };
}

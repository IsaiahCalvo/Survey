// src/utils/markerTracking.js
//
// Who is on a survey item, how far along it is and when it is due (Nightly,
// flag 'marker-tracking'). Kept on the marker record as its own field,
// `tracking: { status, assigneeId, due, updatedAt, updatedBy, history }`, so
// with the survey-marker-fields merge a status change and a note edit made on
// two screens at once both land. An item nobody has touched has no `tracking`.
// `history` is the item's Activity log (Drawboard Projects keeps one per
// issue): one `{ at, by, field, from, to }` per changed field, newest last,
// capped at HISTORY_LIMIT so the marker record stays small.

export const MARKER_STATUSES = Object.freeze([
  Object.freeze({ value: 'open', label: 'Open' }),
  Object.freeze({ value: 'in-progress', label: 'In progress' }),
  Object.freeze({ value: 'done', label: 'Done' }),
]);

const STATUS_VALUES = new Set(MARKER_STATUSES.map((s) => s.value));
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_FIELDS = new Set(['status', 'assigneeId', 'due']);
export const HISTORY_LIMIT = 30;

export function statusLabel(status) {
  return MARKER_STATUSES.find((s) => s.value === status)?.label || 'Open';
}

/** The marker's tracking, always whole: { status, assigneeId, due }. */
export function readTracking(marker) {
  const raw = marker?.tracking && typeof marker.tracking === 'object' ? marker.tracking : {};
  return {
    status: STATUS_VALUES.has(raw.status) ? raw.status : 'open',
    assigneeId: typeof raw.assigneeId === 'string' && raw.assigneeId ? raw.assigneeId : null,
    due: typeof raw.due === 'string' && DATE_KEY.test(raw.due) ? raw.due : null,
  };
}

function cleanHistoryValue(field, value) {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'status') return STATUS_VALUES.has(value) ? value : null;
  if (field === 'due') return typeof value === 'string' && DATE_KEY.test(value) ? value : null;
  return typeof value === 'string' ? value : null;
}

/** The item's Activity log, oldest first, with bad entries dropped. */
export function readHistory(marker) {
  const raw = marker?.tracking?.history;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e === 'object' && HISTORY_FIELDS.has(e.field) && typeof e.at === 'string')
    .map((e) => ({
      at: e.at,
      by: typeof e.by === 'string' && e.by ? e.by : null,
      field: e.field,
      from: cleanHistoryValue(e.field, e.from),
      to: cleanHistoryValue(e.field, e.to),
    }));
}

/**
 * The marker's next `tracking` value after `patch`. Returns the current value
 * unchanged (same object) when the patch changes nothing. Each changed field
 * adds one Activity entry, so an item set back to open, nobody and no date
 * keeps its field (and its Activity) rather than losing it.
 */
export function nextTracking(marker, patch, { now = () => new Date().toISOString(), by = null } = {}) {
  const current = readTracking(marker);
  const next = { ...current };
  if ('status' in patch) next.status = STATUS_VALUES.has(patch.status) ? patch.status : 'open';
  if ('assigneeId' in patch) next.assigneeId = typeof patch.assigneeId === 'string' && patch.assigneeId ? patch.assigneeId : null;
  if ('due' in patch) next.due = typeof patch.due === 'string' && DATE_KEY.test(patch.due) ? patch.due : null;
  const changed = ['status', 'assigneeId', 'due'].filter((field) => next[field] !== current[field]);
  if (!changed.length) return marker?.tracking;
  const at = now();
  const history = [
    ...readHistory(marker),
    ...changed.map((field) => ({ at, by, field, from: current[field], to: next[field] })),
  ].slice(-HISTORY_LIMIT);
  return { ...next, updatedAt: at, updatedBy: by, history };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 9, 2:14 PM" in the viewer's own time zone ("Nov 9, 2025, ..." in another year). */
export function activityTimeLabel(at, nowDate = new Date()) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const year = d.getFullYear() === nowDate.getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}, ${time}`;
}

/**
 * One Activity line, without who or when: "set the status to In progress",
 * "changed the status from Open to Done", "gave it to Eddie", "took it on"
 * (gave it to themselves), "cleared the due date".
 * `nameOf(id)` turns a person id into a name.
 */
export function activityText(entry, { nameOf = () => 'someone', today = todayKey() } = {}) {
  const { field, from, to } = entry;
  if (field === 'status') {
    return from && from !== 'open'
      ? `changed the status from ${statusLabel(from)} to ${statusLabel(to)}`
      : `set the status to ${statusLabel(to)}`;
  }
  if (field === 'assigneeId') {
    if (!to) return `took it off ${nameOf(from)}`;
    if (entry.by && to === entry.by && !from) return 'took it on';
    return from ? `moved it from ${nameOf(from)} to ${nameOf(to)}` : `gave it to ${nameOf(to)}`;
  }
  if (!to) return 'cleared the due date';
  return `${from ? 'moved the due date to' : 'set the due date to'} ${shortDayLabel(to, today)}`;
}

/** Today in the viewer's own time zone, as YYYY-MM-DD (due dates are plain days). */
export function todayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isOverdue(tracking, today = todayKey()) {
  return Boolean(tracking?.due) && tracking.status !== 'done' && tracking.due < today;
}

function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** "Due today", "Due tomorrow", "2 days late", "Due Nov 3". */
export function dueLabel(due, today = todayKey()) {
  if (!due) return '';
  const diff = dayNumber(due) - dayNumber(today);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0) return `${-diff} day${diff === -1 ? '' : 's'} late`;
  const [y, m, d] = due.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  const sameYear = Number(today.slice(0, 4)) === y;
  return `Due ${month} ${d}${sameYear ? '' : `, ${y}`}`;
}

/** The due day as the date pill shows it: "Nov 3", or "Nov 3, 2027" in another year. */
export function shortDayLabel(due, today = todayKey()) {
  if (!due || !DATE_KEY.test(due)) return '';
  const [y, m, d] = due.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return Number(today.slice(0, 4)) === y ? `${month} ${d}` : `${month} ${d}, ${y}`;
}

export const EMPTY_TRACKING_FILTER = Object.freeze({ mine: false, dueSoon: false, overdue: false, hideDone: false });
export const DUE_SOON_DAYS = 3;

export function trackingFilterActive(filter) {
  return Boolean(filter?.mine || filter?.dueSoon || filter?.overdue || filter?.hideDone);
}

/** Due today or in the next DUE_SOON_DAYS days, and not done (late items are "Late"). */
export function isDueSoon(tracking, today = todayKey()) {
  if (!tracking?.due || tracking.status === 'done') return false;
  const diff = dayNumber(tracking.due) - dayNumber(today);
  return diff >= 0 && diff <= DUE_SOON_DAYS;
}

/** Whether a marker shows under the list's chips (Assigned to me, Due soon, Late, Hide done). */
export function passesTrackingFilter(marker, filter, { userId = null, today = todayKey() } = {}) {
  if (!trackingFilterActive(filter)) return true;
  const t = readTracking(marker);
  if (filter.mine && (!userId || t.assigneeId !== userId)) return false;
  if (filter.dueSoon && !isDueSoon(t, today)) return false;
  if (filter.overdue && !isOverdue(t, today)) return false;
  if (filter.hideDone && t.status === 'done') return false;
  return true;
}

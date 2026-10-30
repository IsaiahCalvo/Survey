// src/utils/markerTracking.js
//
// Who is on a survey item, how far along it is and when it is due (Nightly,
// flag 'marker-tracking'). Kept on the marker record as its own field,
// `tracking: { status, assigneeId, due, updatedAt, updatedBy }`, so with the
// survey-marker-fields merge a status change and a note edit made on two
// screens at once both land. An item nobody has touched has no `tracking`.

export const MARKER_STATUSES = Object.freeze([
  Object.freeze({ value: 'open', label: 'Open' }),
  Object.freeze({ value: 'in-progress', label: 'In progress' }),
  Object.freeze({ value: 'done', label: 'Done' }),
]);

const STATUS_VALUES = new Set(MARKER_STATUSES.map((s) => s.value));
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * The marker's next `tracking` value after `patch`, or undefined when it is
 * back to nothing set (open, nobody, no date). Returns the current value
 * unchanged (same object) when the patch changes nothing.
 */
export function nextTracking(marker, patch, { now = () => new Date().toISOString(), by = null } = {}) {
  const current = readTracking(marker);
  const next = { ...current };
  if ('status' in patch) next.status = STATUS_VALUES.has(patch.status) ? patch.status : 'open';
  if ('assigneeId' in patch) next.assigneeId = typeof patch.assigneeId === 'string' && patch.assigneeId ? patch.assigneeId : null;
  if ('due' in patch) next.due = typeof patch.due === 'string' && DATE_KEY.test(patch.due) ? patch.due : null;
  if (next.status === current.status && next.assigneeId === current.assigneeId && next.due === current.due) {
    return marker?.tracking;
  }
  if (next.status === 'open' && !next.assigneeId && !next.due) return undefined;
  return { ...next, updatedAt: now(), updatedBy: by };
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

export const EMPTY_TRACKING_FILTER = Object.freeze({ mine: false, overdue: false, hideDone: false });

export function trackingFilterActive(filter) {
  return Boolean(filter?.mine || filter?.overdue || filter?.hideDone);
}

/** Whether a marker shows under the list's chips (Assigned to me, Late, Hide done). */
export function passesTrackingFilter(marker, filter, { userId = null, today = todayKey() } = {}) {
  if (!trackingFilterActive(filter)) return true;
  const t = readTracking(marker);
  if (filter.mine && (!userId || t.assigneeId !== userId)) return false;
  if (filter.overdue && !isOverdue(t, today)) return false;
  if (filter.hideDone && t.status === 'done') return false;
  return true;
}

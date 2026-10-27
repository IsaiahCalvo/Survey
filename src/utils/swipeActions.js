/**
 * swipeActions.js — the pure rules behind SwipeActionsRow (owner 2026-10-27:
 * "slide to delete in all the lists", modelled on the EDC tracker's account
 * list). No DOM, no React, so node tests can pin every number.
 *
 * A row slides LEFT to uncover its actions on the right, in the select-mode
 * order (Duplicate, Move, Copy, Share, Delete - SELECT_MODE_ACTIONS in
 * SectionIconButton.jsx), so Delete is always the far-right one. A row with
 * more than SWIPE_MAX_SLOTS actions folds the first ones into a "More" slot at
 * the front, which keeps the order and leaves room for the row on a phone.
 */

export const SWIPE_ACTION_WIDTH = 72;
export const SWIPE_COMPACT_ACTION_WIDTH = 52;
/* Rows shorter than this show the icon only (desktop rail rows are ~28px). */
export const SWIPE_COMPACT_ROW_HEIGHT = 44;
export const SWIPE_INTENT_SLOP = 8;
export const SWIPE_MAX_SLOTS = 3;
/* A flick faster than this (px/s) counts as a decision, not a drag. */
export const SWIPE_FLING_VELOCITY = 900;
/* How far a release "throws" the row: offset + velocity * this. */
export const SWIPE_PROJECTION_S = 0.1;
/* A full swipe must pass the open tray by this much, and half the row. */
export const SWIPE_FULL_EXTRA = 48;
export const SWIPE_FULL_ROW_SHARE = 0.56;
/* Once armed, a full swipe stays armed until the finger comes back this far. */
export const SWIPE_FULL_HYSTERESIS = 20;

export const SWIPE_ACTION_ORDER = Object.freeze([
  { key: 'duplicate', label: 'Duplicate', icon: 'duplicate', handler: 'onDuplicate' },
  { key: 'move', label: 'Move', icon: 'moveTo', handler: 'onMove' },
  { key: 'copy', label: 'Copy', icon: 'copy', handler: 'onCopy' },
  { key: 'share', label: 'Share', icon: 'share', handler: 'onShare' },
  { key: 'delete', label: 'Delete', icon: 'trash', handler: 'onDelete' },
]);

/**
 * The row's actions from the same handler names SelectModeButtons takes. A
 * missing handler, or `can[key] === false`, leaves the action out; a string
 * `can[key]` keeps it but makes it explain itself instead of running.
 * `labels` renames one (e.g. { delete: 'Remove' }).
 */
export function buildSwipeActions({ can = {}, labels = {}, ...handlers } = {}) {
  const out = [];
  SWIPE_ACTION_ORDER.forEach(({ key, label, icon, handler }) => {
    const run = handlers[handler];
    if (typeof run !== 'function' || can[key] === false) return;
    out.push({
      key,
      label: labels[key] || label,
      icon,
      danger: key === 'delete',
      reason: typeof can[key] === 'string' && can[key] ? can[key] : null,
      onSelect: run,
    });
  });
  return out;
}

/* The tray may cover at most this share of the row - or, for up to three
   actions, this larger share, so a narrow desktop rail still shows three. */
export const SWIPE_TRAY_ROW_SHARE = 0.62;
export const SWIPE_TRAY_ROW_SHARE_SHORT = 0.85;

/**
 * How many slots fit a row: as many as cover no more than ~60% of it (three
 * may take up to 85%), at least 2 and at most 5. A phone row (~360px) and a
 * 260px desktop rail get 3; a wide desktop row all five. Unmeasured (0)
 * counts as a phone.
 */
export function swipeSlotBudget(rowWidth, actionWidth = SWIPE_ACTION_WIDTH) {
  if (!(rowWidth > 0)) return SWIPE_MAX_SLOTS;
  const wide = Math.floor((rowWidth * SWIPE_TRAY_ROW_SHARE) / actionWidth);
  const short = Math.min(SWIPE_MAX_SLOTS, Math.floor((rowWidth * SWIPE_TRAY_ROW_SHARE_SHORT) / actionWidth));
  return Math.min(5, Math.max(2, wide, short));
}

/** What the tray shows: every action, or "More" + the last ones that fit. */
export function layoutSwipeSlots(actions, max = SWIPE_MAX_SLOTS) {
  const list = Array.isArray(actions) ? actions.filter(Boolean) : [];
  if (list.length <= max) return list;
  const keep = Math.max(1, max - 1);
  return [
    { key: 'more', label: 'More', icon: 'moreHorizontal', overflow: list.slice(0, list.length - keep) },
    ...list.slice(list.length - keep),
  ];
}

/** Only a row whose far-right action is a Delete it may run can be full-swiped. */
export const canFullSwipe = (slots) => {
  const last = slots[slots.length - 1];
  return Boolean(last && last.danger && !last.reason);
};

/* iOS-style rubber band: the further past the edge, the less it gives. */
export const rubberBand = (overshoot, dimension) => {
  const c = 0.55;
  return (c * dimension * overshoot) / (dimension + c * overshoot);
};

/** How far left the row must travel before letting go deletes it. */
export const fullSwipeThreshold = (reveal, rowWidth) => Math.max(reveal + SWIPE_FULL_EXTRA, rowWidth * SWIPE_FULL_ROW_SHARE);

/**
 * Where the row sits (negative = slid left) for a finger offset `dx` from a
 * start offset `base`. It follows the finger 1:1 up to the open tray (or the
 * whole row when it can be full-swiped), then rubber-bands. Sliding right of
 * rest only gives a little.
 */
export function swipeOffset(base, dx, { reveal, rowWidth = 320, full = false } = {}) {
  const x = base + dx;
  if (x > 0) return rubberBand(x, 24);
  const limit = full ? Math.max(reveal, rowWidth) : reveal;
  if (-x <= limit) return x;
  return -limit - rubberBand(-x - limit, Math.max(rowWidth, 1));
}

/** Release speed (px/s) from [time ms, x] samples, over the last 80ms. */
export function releaseVelocity(samples) {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find((s) => last[0] - s[0] <= 80) || last;
  const dt = (last[0] - first[0]) / 1000;
  return dt > 0 ? (last[1] - first[1]) / dt : 0;
}

/**
 * What a let-go does: 'full' (run the far-right action, i.e. delete),
 * 'open' or 'close'.
 *   - armed full swipe, not flicked back hard -> full
 *   - a hard flick left that would carry past the full line -> full
 *   - otherwise the throw decides: past half the tray opens, else it shuts.
 */
export function settleSwipe({ offset, velocity, reveal, rowWidth, full, armed }) {
  const travel = -offset;
  const push = -velocity;
  const projected = travel + push * SWIPE_PROJECTION_S;
  if (full && armed && push > -SWIPE_FLING_VELOCITY) return 'full';
  if (full && travel > reveal && push > SWIPE_FLING_VELOCITY && projected > fullSwipeThreshold(reveal, rowWidth)) return 'full';
  return projected > reveal / 2 ? 'open' : 'close';
}

/** 0..1: how much of one action's glyph shows at a tray width. */
export function revealAmount(trayWidth, slots, actionWidth = SWIPE_ACTION_WIDTH) {
  if (!slots) return 0;
  const each = trayWidth / slots;
  return Math.min(1, Math.max(0, (each - actionWidth * 0.25) / (actionWidth * 0.55)));
}

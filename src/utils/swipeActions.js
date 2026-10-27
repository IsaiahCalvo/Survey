/**
 * swipeActions.js — the pure rules behind SwipeActionsRow, copied from the
 * EDC tracker's account list the owner shared (2026-10-27; redone 10-27 after
 * "your animation is way too much - copy what that HTML does"). No DOM, no
 * React, so node tests can pin every number.
 *
 * Like that list, a row has at most one action on each side:
 *   - slide LEFT  -> Delete on the right (danger), a long slide deletes;
 *   - slide RIGHT -> one everyday action on the left (Duplicate, Move, Copy
 *     or Share - the list picks it with `lead`), a long slide runs it.
 * Every other action stays in the row's own menu and right-click menu.
 */

/* One action's width when the row sits open (the HTML's 76px). */
export const SWIPE_ACTION_WIDTH = 76;
/* Rows shorter than this show the icon only (desktop rail rows are ~28px). */
export const SWIPE_COMPACT_ROW_HEIGHT = 44;
export const SWIPE_INTENT_SLOP = 8;
/* A flick faster than this (px/s) counts as a decision, not a drag. */
export const SWIPE_FLING_VELOCITY = 900;
/* How far a release "throws" the row: offset + velocity * this. */
export const SWIPE_PROJECTION_S = 0.1;
/* A full swipe must pass the open action by this much, and 56% of the row. */
export const SWIPE_FULL_EXTRA = 48;
export const SWIPE_FULL_ROW_SHARE = 0.56;
/* Once armed, a full swipe stays armed until the finger comes back this far. */
export const SWIPE_FULL_HYSTERESIS = 20;

/* The HTML's springs (no bounce): open/shut, slide away, Delete widening. */
export const SWIPE_SPRING = Object.freeze({ snappy: 0.26, smooth: 0.4, morph: 0.42 });

export const SWIPE_ACTION_ORDER = Object.freeze([
  { key: 'duplicate', label: 'Duplicate', icon: 'duplicate', handler: 'onDuplicate' },
  { key: 'move', label: 'Move', icon: 'moveTo', handler: 'onMove' },
  { key: 'copy', label: 'Copy', icon: 'copy', handler: 'onCopy' },
  { key: 'share', label: 'Share', icon: 'share', handler: 'onShare' },
  { key: 'delete', label: 'Delete', icon: 'trash', handler: 'onDelete' },
]);

/* Which action slides in from the left when a list does not say. */
export const SWIPE_LEAD_ORDER = Object.freeze(['duplicate', 'move', 'copy', 'share']);

/**
 * The row's actions from the same handler names SelectModeButtons takes, in
 * the select-mode order. A missing handler, or `can[key] === false`, leaves
 * an action out; a string `can[key]` keeps it but makes it explain itself
 * instead of running. `labels` renames one (e.g. { delete: 'Remove' }).
 * `lead` names the action that slides in from the left.
 */
export function buildSwipeActions({ can = {}, labels = {}, lead = null, ...handlers } = {}) {
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
  if (lead) out.lead = lead;
  return out;
}

/** The one action on each side: { leading: [..], trailing: [..] }. */
export function splitSwipeSides(actions) {
  const list = Array.isArray(actions) ? actions.filter(Boolean) : [];
  const trailing = list.filter((a) => a.danger).slice(-1);
  const order = actions?.lead ? [actions.lead, ...SWIPE_LEAD_ORDER] : SWIPE_LEAD_ORDER;
  // The left side only offers what may run now; a blocked one stays in the
  // row's menu, where it explains itself.
  let leading = [];
  for (const key of order) {
    const hit = list.find((a) => a.key === key && !a.danger && !a.reason);
    if (hit) { leading = [hit]; break; }
  }
  return { leading, trailing };
}

/** Which side a row offset shows: right of rest = leading, left = trailing. */
export const swipeSide = (x) => (x > 0 ? 'leading' : x < 0 ? 'trailing' : null);

/** A side can be full-swiped when it has an action that may run. */
export const canFullSwipe = (side) => side.length > 0 && !side[side.length - 1].reason;

/* The HTML's rubber band: past the edge it gives less and less. */
export const rubberBand = (overshoot, dimension) => (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;

/** How far the row must travel before letting go runs the action. */
export const fullSwipeThreshold = (count, rowWidth) => Math.max(count * SWIPE_ACTION_WIDTH + SWIPE_FULL_EXTRA, rowWidth * SWIPE_FULL_ROW_SHARE);

/**
 * Where the row sits for a raw drag position `x` (positive = slid right). It
 * follows 1:1 up to the open action (or the whole row when that side can be
 * full-swiped), then rubber-bands; a side with no action does not move.
 */
export function swipeOffset(x, { leading = [], trailing = [], rowWidth = 320 } = {}) {
  const side = swipeSide(x);
  if (!side) return 0;
  const actions = side === 'leading' ? leading : trailing;
  if (actions.length === 0) return 0;
  const w = rowWidth || 320;
  const limit = canFullSwipe(actions) ? w : actions.length * SWIPE_ACTION_WIDTH;
  const travel = Math.abs(x);
  return Math.sign(x) * (travel <= limit ? travel : limit + rubberBand(travel - limit, w));
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
 * What a let-go does: 'full' (run that side's action), 'open' or 'close'.
 *   - armed full swipe, not flicked back hard -> full
 *   - a hard flick past the open action that would carry past the line -> full
 *   - otherwise the throw decides: past half the action opens, else shuts.
 */
export function settleSwipe({ offset, velocity, count, rowWidth, full, armed }) {
  if (!count) return 'close';
  const dir = Math.sign(offset) || 1;
  const travel = Math.abs(offset);
  const push = velocity * dir;
  const projected = travel + push * SWIPE_PROJECTION_S;
  const open = count * SWIPE_ACTION_WIDTH;
  if (full && armed && push > -SWIPE_FLING_VELOCITY) return 'full';
  if (full && travel > open && push > SWIPE_FLING_VELOCITY && projected > fullSwipeThreshold(count, rowWidth)) return 'full';
  return projected > open / 2 ? 'open' : 'close';
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * One action layer for a row offset `x` (the HTML's MD component). Each
 * action is a full-width coloured layer that rides the row's edge; its glyph
 * sits in the middle of the strip it uncovers, the icon fading and growing
 * in first, then the label. `cover` (0..1) is the armed full swipe: the
 * action takes the whole strip and its glyph stays by the row's edge.
 */
export function layerFrame({ x, side, rank = 0, count = 1, coverRank = null, cover = 0 }) {
  const dir = side === 'leading' ? 1 : -1;
  const travel = Math.max(0, x * dir);
  const each = travel / count;
  const share = ((count - rank) * travel) / count;
  const width = coverRank === rank ? share + cover * (travel - share) : coverRank !== null && rank > coverRank ? share * (1 - cover) : share;
  const anchor = -dir * (coverRank === rank ? each / 2 + cover * (SWIPE_ACTION_WIDTH / 2 - each / 2) : each / 2);
  const own = (v) => (coverRank === rank ? Math.max(v, cover) : coverRank === null ? v : v * (1 - cover));
  const icon = own(clamp01((each - SWIPE_ACTION_WIDTH * 0.25) / (SWIPE_ACTION_WIDTH * 0.55)));
  const label = own(clamp01((each - SWIPE_ACTION_WIDTH * 0.72) / (SWIPE_ACTION_WIDTH * 0.24)));
  return { layerX: dir * width, anchorX: anchor, iconOpacity: icon, iconScale: 0.6 + 0.4 * icon, labelOpacity: label };
}

/**
 * A no-bounce spring (framer-motion's `visualDuration`, bounce 0): critically
 * damped, so it eases in and never overshoots. Returns the value and speed
 * `t` seconds after starting at `from` with speed `velocity` toward `to`.
 */
export function springAt({ from, to, velocity = 0, duration = SWIPE_SPRING.snappy, t }) {
  const omega = (2 * Math.PI) / (duration * 1.2);
  const a = from - to;
  const b = velocity + omega * a;
  const e = Math.exp(-omega * t);
  return { value: to + (a + b * t) * e, velocity: (b - omega * (a + b * t)) * e };
}

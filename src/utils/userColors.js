/**
 * userColors.js — one colour per person, the same everywhere.
 *
 * Owner 2026-10-07: "the user glyph, where it shows the user's initials,
 * shouldn't be gray. Gray indicates inactivity, like they're offline ... if
 * other users come onto a PDF, it uses different pastel colors for each user."
 *
 * So:
 *   - every person gets a soft pastel picked from their user id (a hash into
 *     the eight colours below). It is a pure function of the id, so the same
 *     person has the same colour on every screen and every device — the
 *     account button, the faces on an open PDF, member lists, the share and
 *     team dialogs, phone and desktop;
 *   - YOU wear your own pastel too (not gold, not grey), so you look to
 *     yourself the way other people see you;
 *   - when two people on one PDF hash to the same colour, the later one (in id
 *     order) takes the next free colour for that screen, so up to eight people
 *     on a document are always eight different colours; you never move;
 *   - grey means only "inactive": an idle face on a document turns
 *     USER_INACTIVE_FILL until the person does something again.
 *
 * The palette. OKLCH lightness 0.82, chroma 0.065, eight hues spread round the
 * wheel with the yellow/amber band (~70-110 deg) left out on purpose: gold
 * means "selected" in this app and the owner wants no new gold. Each fill
 * carries dark initials (USER_INITIALS_INK) at 9.2-9.7:1 (WCAG AA wants 4.5:1)
 * and reads as a clear disc on the dark chrome (9.7-10.3:1 on --surface-1)
 * and on white (the light-theme case; the face is identified by its initials).
 * `line` is the same hue darker (OKLCH 0.56 / 0.12) for things drawn on the
 * page itself — a collaborator's outline or cursor — where a pastel would
 * vanish on white paper: 4.3-5.0:1 on white, 3.1-3.6:1 on the dark panel
 * (WCAG 1.4.11 asks 3:1 of a graphic).
 *
 * Per-person hues are deliberately literals, outside the chrome tokens
 * (tokens.css "NOT IN SCOPE": they are the same class of thing as an ink).
 */

export const USER_COLORS = Object.freeze([
  Object.freeze({ name: 'rose', fill: '#ebb3ba', line: '#ae5364' }),
  Object.freeze({ name: 'apricot', fill: '#e8b99f', line: '#ab5d2b' }),
  Object.freeze({ name: 'sage', fill: '#b6cda1', line: '#5d822f' }),
  Object.freeze({ name: 'mint', fill: '#9dd2ba', line: '#008a63' }),
  Object.freeze({ name: 'aqua', fill: '#91d1d5', line: '#008890' }),
  Object.freeze({ name: 'sky', fill: '#9ecaea', line: '#197cb3' }),
  Object.freeze({ name: 'periwinkle', fill: '#b7c2ef', line: '#616dba' }),
  Object.freeze({ name: 'lilac', fill: '#d4b8e2', line: '#8f5da4' }),
]);

/** The initials on any pastel: a fixed near-black (the pastels are light in
 *  every theme, so the ink must not follow the theme). */
export const USER_INITIALS_INK = '#1c1f26';

/** Grey is for inactivity only: an idle face's fill and its (light) ink.
 *  #dadfe8 on #4a505c measures 6.05:1. */
export const USER_INACTIVE_FILL = '#4a505c';
export const USER_INACTIVE_INK = '#dadfe8';

/** 32-bit FNV-1a over the id's UTF-16 units, then a murmur3 finaliser so the
 *  low bits (which pick the colour) depend on every character. Pure and the
 *  same on every device. */
export function hashUserId(id) {
  const s = String(id ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The palette slot a person's id hashes to (0..7). */
export function userColorIndex(id) {
  return hashUserId(id) % USER_COLORS.length;
}

/** A person's own colour, ignoring who else is around: { name, fill, line }. */
export function userColor(id) {
  return USER_COLORS[userColorIndex(id)];
}

/** Just the face fill for a person (the common case). */
export function userColorFill(id) {
  return userColor(id).fill;
}

/**
 * Colours for a group of people seen together (everyone on one PDF).
 * Each person starts at their own colour. You (`selfId`) always keep yours;
 * the others are placed in id order (so the result does not depend on who
 * arrived first or on display order), and anyone whose colour is already taken
 * moves to the next free one. Up to eight people are therefore eight different
 * colours. Past eight a fresh round starts, so no colour is used more than
 * ceil(n / 8) times; names in the list tell those repeats apart.
 * Returns Map(id -> { name, fill, line }).
 */
export function assignUserColors(ids = [], selfId = null) {
  const out = new Map();
  const n = USER_COLORS.length;
  const unique = [...new Set((ids || []).filter((id) => id != null && id !== ''))];
  const order = [];
  if (selfId != null && unique.includes(selfId)) order.push(selfId);
  for (const id of [...unique].sort()) if (id !== selfId) order.push(id);
  const used = new Set();
  for (const id of order) {
    if (used.size >= n) used.clear();
    let slot = userColorIndex(id);
    while (used.has(slot)) slot = (slot + 1) % n;
    used.add(slot);
    out.set(id, USER_COLORS[slot]);
  }
  return out;
}

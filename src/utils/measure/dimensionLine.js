/**
 * dimensionLine.js — Drawboard's Length mark as a dimension line (Nightly,
 * flag 'measure-plus'; live check deep/measure-extras.md §2).
 *
 * The line is drawn `leader` points off the two clicked points, with thin
 * extension lines from each point to just past it, open chevrons at both
 * ends, and the reading inline: centred on the line, which breaks around it,
 * in the stroke colour at 9 pt. A mark carries `data.measure.dim` when it was
 * drawn with the flag on; older Length marks keep their line and pill.
 */

export const DIMENSION_LEADER_PT = 15.31;
export const DIMENSION_CAPTION_PT = 9;
export const DIMENSION_CHEVRON_LENGTH_PT = 7;
export const DIMENSION_CHEVRON_HALF_PT = 4;
export const DIMENSION_EXTENSION_PT = 0.5;
export const DIMENSION_EXTENSION_PAST_PT = 2;
// Space each side of the caption where the line stops.
const CAPTION_GAP_PAD_PT = 3;
// Leaders past this (either side) are clamped: far longer than any caption.
export const DIMENSION_LEADER_MAX_PT = 1000;
export const DIMENSION_CAPTION_PLACES = Object.freeze(['inline', 'above']);
// Space between the line and a caption sitting beside it.
const CAPTION_LIFT_PAD_PT = 2;
// Helvetica's average advance is about 0.55 em; primes and digits sit near it.
const CHAR_EM = 0.55;

/** Whether a saved mark draws as a dimension line. */
export function isDimensionMeasure(obj) {
  const m = obj?.data?.measure;
  return Boolean(m && m.kind === 'length' && m.dim && typeof m.dim === 'object');
}

/** The leader of a mark (points), or the default. */
export function dimensionLeader(obj) {
  const n = Number(obj?.data?.measure?.dim?.leader);
  return Number.isFinite(n) ? n : DIMENSION_LEADER_PT;
}

/** A typed leader (points) as stored: two decimals, clamped; null if not a number. */
export function normalizeDimensionLeader(value) {
  const text = value == null ? '' : String(value).trim();
  // Blank (or only spaces) is not a leader: Number('') would read as 0.
  if (!text) return null;
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(-DIMENSION_LEADER_MAX_PT, Math.min(DIMENSION_LEADER_MAX_PT, n));
  return Math.round(clamped * 100) / 100 || 0;
}

/** Where a mark's caption sits: 'inline' (the line breaks round it) or 'above'. */
export function dimensionCaptionPlace(obj) {
  return obj?.data?.measure?.dim?.caption === 'above' ? 'above' : 'inline';
}

// The caption size buttons (S / M / L = 10 / 12 / 16 px pills) scale the
// 9 pt caption from Medium (measureScale.js MEASURE_LABEL_FONT_PX).
const CAPTION_SIZE_BASE_PX = 12;

/** A mark's caption size (points): 9 pt at Medium, scaled by S / L. */
export function dimensionCaptionPt(obj) {
  const px = Number(obj?.data?.measure?.captionSize);
  return Number.isFinite(px) && px > 0 ? (DIMENSION_CAPTION_PT * px) / CAPTION_SIZE_BASE_PX : DIMENSION_CAPTION_PT;
}

/** A moved caption's offset { x, y } (points, the line's own frame), or null. */
export function dimensionCaptionOffset(obj) {
  const o = obj?.data?.measure?.dim?.captionOffset;
  const x = Number(o?.x);
  const y = Number(o?.y);
  return Number.isFinite(x) && Number.isFinite(y) && (x || y) ? { x, y } : null;
}

/** The width (points) a caption of `text` takes at `fontPt`. */
export function dimensionCaptionWidth(text, fontPt = DIMENSION_CAPTION_PT) {
  return String(text ?? '').length * CHAR_EM * fontPt;
}

/**
 * Geometry in the line's own coordinates. `leader` > 0 puts the line on the
 * left of the direction p1 → p2 (screen-up for a line drawn left to right);
 * a negative leader puts it on the other side. Returns null for a line too
 * short to draw.
 *   segments  one or two [from, to] pieces of the dimension line (broken
 *             round the caption when it fits)
 *   extensions two [from, to] lines, from each clicked point to just past
 *   chevrons  two open arrowheads as point lists [wing, tip, wing]
 * `place` 'above' keeps the line whole and sets the caption beside it.
 * `captionOffset` { x, y } is a dragged caption: the line stays whole and
 * `elbow` is its leader's point list (null when the caption sits on the line).
 *   caption   { x, y, angle } centre and reading angle (degrees, kept so the
 *             text never reads upside down once `turn` is added)
 */
export function dimensionLineGeometry({ x1, y1, x2, y2 }, {
  leader = DIMENSION_LEADER_PT,
  captionWidth = 0,
  captionHeight = DIMENSION_CAPTION_PT,
  place = 'inline',
  captionOffset = null,
  turn = 0,
} = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  const ux = dx / len;
  const uy = dy / len;
  // Left normal of the direction (screen-up for left-to-right in y-down space).
  const nx = uy;
  const ny = -ux;
  const off = Number.isFinite(leader) ? leader : DIMENSION_LEADER_PT;
  const a = { x: x1 + nx * off, y: y1 + ny * off };
  const b = { x: x2 + nx * off, y: y2 + ny * off };
  const side = off < 0 ? -1 : 1;
  const past = DIMENSION_EXTENSION_PAST_PT * side;
  const extensions = [
    [{ x: x1, y: y1 }, { x: a.x + nx * past, y: a.y + ny * past }],
    [{ x: x2, y: y2 }, { x: b.x + nx * past, y: b.y + ny * past }],
  ];
  const L = DIMENSION_CHEVRON_LENGTH_PT;
  const H = DIMENSION_CHEVRON_HALF_PT;
  const chevron = (tip, dirX, dirY) => [
    { x: tip.x + dirX * L + nx * H, y: tip.y + dirY * L + ny * H },
    { x: tip.x, y: tip.y },
    { x: tip.x + dirX * L - nx * H, y: tip.y + dirY * L - ny * H },
  ];
  const chevrons = [chevron(a, ux, uy), chevron(b, -ux, -uy)];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const gapHalf = captionWidth > 0 ? captionWidth / 2 + CAPTION_GAP_PAD_PT : 0;
  // Break the line only when the caption sits inline and leaves room for
  // the chevrons.
  const moved = Boolean(captionOffset && (captionOffset.x || captionOffset.y));
  const segments = !moved && place !== 'above' && gapHalf > 0 && len / 2 - gapHalf > L
    ? [
      [a, { x: mid.x - ux * gapHalf, y: mid.y - uy * gapHalf }],
      [{ x: mid.x + ux * gapHalf, y: mid.y + uy * gapHalf }, b],
    ]
    : [[a, b]];
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const screen = ((((angle + (Number(turn) || 0)) % 360) + 540) % 360) - 180;
  if (screen > 90 || screen <= -90) angle += 180;
  // An Above caption, or one that does not fit between the chevrons, sits
  // beside the line on the side away from the clicked points.
  const outside = !moved && segments.length === 1 && gapHalf > 0;
  const lift = outside ? (Math.max(0, captionHeight) / 2 + CAPTION_LIFT_PAD_PT) * side : 0;
  let caption = { x: mid.x + nx * lift, y: mid.y + ny * lift, angle };
  // A dragged caption sits where it was put (from the inline spot, in the
  // line's own frame) with a thin elbow leader from the line's middle:
  // vertical, then across to the caption's near side.
  let elbow = null;
  if (moved) {
    caption = { x: mid.x + captionOffset.x, y: mid.y + captionOffset.y, angle };
    const halfW = Math.max(0, captionWidth) / 2;
    const halfH = Math.max(0, captionHeight) / 2;
    const ddx = caption.x - mid.x;
    const ddy = caption.y - mid.y;
    if (Math.abs(ddx) > halfW) {
      const endX = caption.x - Math.sign(ddx) * (halfW + CAPTION_LIFT_PAD_PT);
      elbow = [{ x: mid.x, y: mid.y }, { x: mid.x, y: caption.y }, { x: endX, y: caption.y }];
    } else if (Math.abs(ddy) > halfH) {
      elbow = [{ x: mid.x, y: mid.y }, { x: mid.x, y: caption.y - Math.sign(ddy) * (halfH + CAPTION_LIFT_PAD_PT) }];
    }
  }
  return {
    a,
    b,
    segments,
    extensions,
    chevrons,
    caption,
    elbow,
  };
}

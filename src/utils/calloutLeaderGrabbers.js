/**
 * calloutLeaderGrabbers.js — where a selected callout's leader grabbers sit.
 *
 * Owner 2026-10-26: besides the arrow tip, the knee and the text box's eight
 * resize grabbers, a callout gets
 *   - an ATTACH grabber where the knee-to-box line meets the box (drag it to
 *     slide that end along the box border — calloutGeometry textBoxAnchor);
 *   - a SEGMENT grabber halfway along each leader line, arrow-to-knee and
 *     knee-to-box (drag it to move that line as one piece).
 *
 * Grabbers never sit on top of each other. The attach point is often a box
 * corner or edge midpoint, exactly where a resize grabber is, so the attach
 * grabber then steps out along its line until it clears every other grabber;
 * a segment grabber on a line too short to hold it clear of its ends is left
 * out. Pure geometry in page units — no DOM, no React.
 */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isPoint = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * @param {object} args
 * @param {{ line1Start, line2Start, effectiveKnee, shouldHideLine1 }} args.conn
 *   the connection the callout is drawn with (calculateCalloutConnection)
 * @param {{x,y}} args.knee - where the knee grabber is drawn
 * @param {{x,y}} args.arrowTip - where the arrow-tip grabber is drawn
 * @param {Array<{x,y}>} args.boxGrabbers - the text box's resize grabbers
 * @param {number} args.radius - a primary grabber's radius (knee, tip, attach)
 * @param {number} args.secondaryRadius - a segment grabber's radius
 * @param {boolean} args.attachMovable - false when the knee is inside or on
 *   the box, where no side can take the attach point
 * @returns {{ attach: {x,y}|null, segTip: {x,y}|null, segBox: {x,y}|null }}
 */
export function layoutCalloutLeaderGrabbers({
  conn,
  knee,
  arrowTip,
  boxGrabbers = [],
  radius,
  secondaryRadius,
  attachMovable = true,
}) {
  const none = { attach: null, segTip: null, segBox: null };
  if (!conn || !isPoint(knee) || !isPoint(arrowTip) || !(radius > 0)) return none;
  const rs = secondaryRadius > 0 ? secondaryRadius : radius;
  const boxes = (boxGrabbers || []).filter(isPoint);
  // Centres must be at least the two radii apart (touching is fine).
  const clearOf = (p, r, others) => others.every(({ at, r: ro }) => dist(p, at) >= r + ro - 1e-6);
  const fixed = [
    { at: knee, r: radius },
    { at: arrowTip, r: radius },
    ...boxes.map((at) => ({ at, r: radius })),
  ];

  let attach = null;
  const start = conn.line1Start;
  const kneeEnd = conn.effectiveKnee || knee;
  if (attachMovable && !conn.shouldHideLine1 && isPoint(start) && isPoint(kneeEnd)) {
    const len = dist(start, kneeEnd);
    if (len > 0) {
      const ux = (kneeEnd.x - start.x) / len;
      const uy = (kneeEnd.y - start.y) / len;
      const step = radius / 2;
      for (let d = 0; d <= len; d += step) {
        const p = { x: start.x + ux * d, y: start.y + uy * d };
        if (clearOf(p, radius, fixed)) { attach = p; break; }
      }
    }
  }

  const placed = attach ? [...fixed, { at: attach, r: radius }] : fixed;
  const midOf = (a, b) => (isPoint(a) && isPoint(b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);

  let segTip = midOf(conn.line2Start || kneeEnd, arrowTip);
  if (segTip && !clearOf(segTip, rs, placed)) segTip = null;

  let segBox = conn.shouldHideLine1 ? null : midOf(start, kneeEnd);
  if (segBox && !clearOf(segBox, rs, segTip ? [...placed, { at: segTip, r: rs }] : placed)) segBox = null;

  return { attach, segTip, segBox };
}

/**
 * The radius of a grabber's invisible press area: the full pad when nothing is
 * near, shrunk to half the gap to the nearest other grabber so two pads never
 * overlap, and never smaller than the dot itself.
 */
export function leaderGrabberHitRadius(at, padRadius, dotRadius, others = []) {
  let r = padRadius;
  for (const o of others) {
    if (!isPoint(o) || o === at) continue;
    const d = dist(at, o);
    if (d > 0) r = Math.min(r, d / 2);
  }
  return Math.max(dotRadius, r);
}

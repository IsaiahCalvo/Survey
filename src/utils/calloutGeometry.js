/**
 * Callout geometry utilities for calculating connection lines between textbox and arrow tip
 * Ported from combined-tools/src/lib/calloutGeometry.ts
 */

import { HANDLE_RADIUS } from './handleStyle.js';

// Threshold for considering knee "stacked" with border or arrow (in pixels)
const STACKED_THRESHOLD = 2;

// Callout handle geometry. The collision math derives every spacing rule from
// the shared HANDLE_RADIUS constant, so it always tracks the real on-screen
// handle size instead of a stale magic number.
//
// Clear daylight required between a handle and its neighbour. 0 means handles
// are allowed to just touch — edges kissing, nothing overlapping (user
// request 2026-05-18: let handles kiss; the previous 4px gap was too much).
export const HANDLE_CLEAR_GAP = 0;

// Minimum distances to prevent handle overlaps.
// Knee <-> arrow: two handle circles — centers must clear both radii + the gap.
// At gap 0 this is exactly the sum of the two radii, so the circles touch.
export const MIN_KNEE_TO_ARROW_DISTANCE = HANDLE_RADIUS * 2 + HANDLE_CLEAR_GAP;
// Knee/arrow <-> textbox border: one handle circle vs the border — the center
// must clear one radius + the gap. At gap 0 the circle edge touches the border.
export const MIN_KNEE_TO_BOX_EDGE_DISTANCE = HANDLE_RADIUS + HANDLE_CLEAR_GAP;
export const MIN_SEGMENT_LENGTH = 10; // Minimum length for line segments to keep them visible


/**
 * Finds the closest point on the textbox border to a given point
 * @param {{ x: number, y: number }} point
 * @param {number} boxLeft
 * @param {number} boxTop
 * @param {number} boxRight
 * @param {number} boxBottom
 * @returns {{ x: number, y: number }}
 */
function findClosestBorderPoint(point, boxLeft, boxTop, boxRight, boxBottom) {
  // Clamp the point to the box edges
  const clampedX = Math.max(boxLeft, Math.min(point.x, boxRight));
  const clampedY = Math.max(boxTop, Math.min(point.y, boxBottom));

  // If the point is already inside the box, find the closest edge
  if (point.x >= boxLeft && point.x <= boxRight && point.y >= boxTop && point.y <= boxBottom) {
    // Point is inside, find closest edge
    const distToLeft = Math.abs(point.x - boxLeft);
    const distToRight = Math.abs(point.x - boxRight);
    const distToTop = Math.abs(point.y - boxTop);
    const distToBottom = Math.abs(point.y - boxBottom);

    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

    if (minDist === distToLeft) return { x: boxLeft, y: clampedY };
    if (minDist === distToRight) return { x: boxRight, y: clampedY };
    if (minDist === distToTop) return { x: clampedX, y: boxTop };
    return { x: clampedX, y: boxBottom };
  }

  // Point is outside, return the clamped point (which will be on an edge)
  return { x: clampedX, y: clampedY };
}

/**
 * Checks if a point is inside or overlapping the textbox
 * @param {{ x: number, y: number }} point
 * @param {number} boxLeft
 * @param {number} boxTop
 * @param {number} boxRight
 * @param {number} boxBottom
 * @returns {boolean}
 */
function isPointInsideBox(point, boxLeft, boxTop, boxRight, boxBottom) {
  return point.x >= boxLeft && point.x <= boxRight && point.y >= boxTop && point.y <= boxBottom;
}

/**
 * Checks if a point is on or very close to the textbox border (within threshold)
 * @param {{ x: number, y: number }} point
 * @param {number} boxLeft
 * @param {number} boxTop
 * @param {number} boxRight
 * @param {number} boxBottom
 * @param {number} [threshold=STACKED_THRESHOLD]
 * @returns {boolean}
 */
function isPointOnBorder(point, boxLeft, boxTop, boxRight, boxBottom, threshold = STACKED_THRESHOLD) {
  const isOnLeft = Math.abs(point.x - boxLeft) <= threshold;
  const isOnRight = Math.abs(point.x - boxRight) <= threshold;
  const isOnTop = Math.abs(point.y - boxTop) <= threshold;
  const isOnBottom = Math.abs(point.y - boxBottom) <= threshold;

  // Check if point is on horizontal edges (within x bounds)
  if ((isOnTop || isOnBottom) && point.x >= boxLeft - threshold && point.x <= boxRight + threshold) {
    return true;
  }

  // Check if point is on vertical edges (within y bounds)
  if ((isOnLeft || isOnRight) && point.y >= boxTop - threshold && point.y <= boxBottom + threshold) {
    return true;
  }

  return false;
}

/**
 * Checks if two points are very close (within threshold)
 * @param {{ x: number, y: number }} point1
 * @param {{ x: number, y: number }} point2
 * @param {number} [threshold=STACKED_THRESHOLD]
 * @returns {boolean}
 */
function arePointsStacked(point1, point2, threshold = STACKED_THRESHOLD) {
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= threshold;
}

/**
 * Calculates the minimum distance from a point to the textbox edge
 * @param {{ x: number, y: number }} point
 * @param {number} boxLeft
 * @param {number} boxTop
 * @param {number} boxRight
 * @param {number} boxBottom
 * @returns {number}
 */
function distanceToBoxEdge(point, boxLeft, boxTop, boxRight, boxBottom) {
  // If point is inside, distance is 0
  if (point.x >= boxLeft && point.x <= boxRight && point.y >= boxTop && point.y <= boxBottom) {
    const distToLeft = Math.abs(point.x - boxLeft);
    const distToRight = Math.abs(point.x - boxRight);
    const distToTop = Math.abs(point.y - boxTop);
    const distToBottom = Math.abs(point.y - boxBottom);
    return Math.min(distToLeft, distToRight, distToTop, distToBottom);
  }

  // Point is outside, calculate distance to nearest edge
  const distX = Math.max(0, Math.max(boxLeft - point.x, point.x - boxRight));
  const distY = Math.max(0, Math.max(boxTop - point.y, point.y - boxBottom));
  return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Constrains a knee position to maintain minimum distances from arrow and textbox edge
 * Ensures knee always stays between border point and arrow (never past either)
 * @param {{ x: number, y: number }} proposedKnee
 * @param {{ x: number, y: number }} arrowTip
 * @param {number} boxLeft
 * @param {number} boxTop
 * @param {number} boxRight
 * @param {number} boxBottom
 * @param {{ x: number, y: number }} borderPoint
 * @returns {{ x: number, y: number }}
 */
function constrainKneePosition(proposedKnee, arrowTip, boxLeft, boxTop, boxRight, boxBottom, borderPoint) {
  // Calculate the direction vector from border to arrow
  const dxBorderToArrow = arrowTip.x - borderPoint.x;
  const dyBorderToArrow = arrowTip.y - borderPoint.y;
  const distBorderToArrow = Math.sqrt(dxBorderToArrow * dxBorderToArrow + dyBorderToArrow * dyBorderToArrow);

  // If border and arrow are too close, we can't fit a knee between them with minimum distances
  const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
  if (distBorderToArrow < minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE) {
    // Place knee at minimum distance from border for line 1, but ensure it's still before arrow
    const unitX = distBorderToArrow > 0.001 ? dxBorderToArrow / distBorderToArrow : 0;
    const unitY = distBorderToArrow > 0.001 ? dyBorderToArrow / distBorderToArrow : 0;
    const maxDistFromBorder = Math.max(0, distBorderToArrow - MIN_KNEE_TO_ARROW_DISTANCE);
    const distFromBorder = Math.min(minRequiredForLine1, maxDistFromBorder);
    return {
      x: borderPoint.x + unitX * distFromBorder,
      y: borderPoint.y + unitY * distFromBorder
    };
  }

  // Calculate unit vector from border to arrow
  const unitX = distBorderToArrow > 0.001 ? dxBorderToArrow / distBorderToArrow : 0;
  const unitY = distBorderToArrow > 0.001 ? dyBorderToArrow / distBorderToArrow : 0;

  // Project proposed knee onto the border-to-arrow line
  const dxBorderToKnee = proposedKnee.x - borderPoint.x;
  const dyBorderToKnee = proposedKnee.y - borderPoint.y;
  const projectionDistance = dxBorderToKnee * unitX + dyBorderToKnee * unitY;

  // Clamp projection to be between border + MIN_SEGMENT_LENGTH and arrow - MIN_KNEE_TO_ARROW_DISTANCE
  const minDistFromBorder = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
  const maxDistFromBorder = distBorderToArrow - MIN_KNEE_TO_ARROW_DISTANCE;
  const clampedDistFromBorder = Math.max(minDistFromBorder, Math.min(projectionDistance, maxDistFromBorder));

  // Calculate constrained knee position along the border-to-arrow line
  let constrainedKnee = {
    x: borderPoint.x + unitX * clampedDistFromBorder,
    y: borderPoint.y + unitY * clampedDistFromBorder
  };

  // Verify distances are satisfied
  const distToArrow = Math.sqrt(
    Math.pow(arrowTip.x - constrainedKnee.x, 2) +
    Math.pow(arrowTip.y - constrainedKnee.y, 2)
  );
  const distToEdge = distanceToBoxEdge(constrainedKnee, boxLeft, boxTop, boxRight, boxBottom);

  // Final safety check - if still too close to arrow, move back along line
  if (distToArrow < MIN_KNEE_TO_ARROW_DISTANCE && distBorderToArrow > MIN_KNEE_TO_ARROW_DISTANCE) {
    const minRequiredForLine1Check = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
    const safeDistFromBorder = Math.max(minRequiredForLine1Check, distBorderToArrow - MIN_KNEE_TO_ARROW_DISTANCE);
    constrainedKnee = {
      x: borderPoint.x + unitX * safeDistFromBorder,
      y: borderPoint.y + unitY * safeDistFromBorder
    };
  }

  // Final safety check - if still too close to edge or line 1 is too short, move forward along line
  const segment1Length = distToEdge;
  const minRequiredForLine1Check = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
  if ((distToEdge < MIN_KNEE_TO_BOX_EDGE_DISTANCE || segment1Length < MIN_SEGMENT_LENGTH) && distBorderToArrow > minRequiredForLine1Check) {
    const safeDistFromBorder = Math.max(minRequiredForLine1Check, Math.min(minRequiredForLine1Check, distBorderToArrow - MIN_KNEE_TO_ARROW_DISTANCE));
    constrainedKnee = {
      x: borderPoint.x + unitX * safeDistFromBorder,
      y: borderPoint.y + unitY * safeDistFromBorder
    };
  }

  return constrainedKnee;
}

/**
 * Calculate the connection geometry for a callout
 * Returns the start points for line 1 (textbox to knee) and line 2 (knee to arrow)
 *
 * @param {number} boxLeft - Left edge of the textbox
 * @param {number} boxTop - Top edge of the textbox
 * @param {number} boxW - Width of the textbox
 * @param {number} boxH - Height of the textbox
 * @param {{ x: number, y: number }} knee - Current knee position
 * @param {{ x: number, y: number }} [arrowTip] - Arrow tip position (optional)
 * @param {number} [borderWidth=0] - Border width to account for
 * @returns {{ line1Start: { x: number, y: number }, shouldHideLine1: boolean, line2Start: { x: number, y: number }, effectiveKnee: { x: number, y: number } }}
 */
export const calculateCalloutConnection = (boxLeft, boxTop, boxW, boxH, knee, arrowTip, borderWidth = 0) => {
  // Account for border width
  const adjustedBoxLeft = boxLeft + borderWidth;
  const adjustedBoxTop = boxTop + borderWidth;
  const boxRight = boxLeft + boxW + borderWidth;
  const boxBottom = boxTop + boxH + borderWidth;

  // Helper to clamp a point to the box
  const clampToBox = (p) => {
    return {
      x: Math.max(adjustedBoxLeft, Math.min(p.x, boxRight)),
      y: Math.max(adjustedBoxTop, Math.min(p.y, boxBottom))
    };
  };

  // Default Behavior: Line 1 snaps to box edge nearest to Knee
  let line1Start = clampToBox(knee);
  let line2Start = { x: knee.x, y: knee.y };
  let shouldHideLine1 = false;
  let effectiveKnee = { x: knee.x, y: knee.y };

  // Check for "Bad Geometry" (Knee Inside OR Line Crossing)
  if (arrowTip) {
    const isKneeInsideBox = isPointInsideBox(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
    const isKneeOnBorder = isPointOnBorder(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
    const isKneeStackedWithArrow = arePointsStacked(knee, arrowTip);

    // When knee overlaps textbox (inside or on border), calculate based on arrow
    if (isKneeInsideBox || isKneeOnBorder || isKneeStackedWithArrow) {
      // Find the closest outside edge of the textbox to the arrow
      const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

      // Calculate distance between arrow tip and closest border point
      const dx = arrowTip.x - closestBorderPoint.x;
      const dy = arrowTip.y - closestBorderPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if total distance meets minimum requirements
      const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
      const minRequiredDistance = minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE;

      if (distance < minRequiredDistance) {
        // Distance is too small - place knee at minimum distance from both
        const distFromBorder = Math.max(minRequiredForLine1, distance - MIN_KNEE_TO_ARROW_DISTANCE);
        const unitX = distance > 0.001 ? dx / distance : 0;
        const unitY = distance > 0.001 ? dy / distance : 0;

        let midpointKnee = {
          x: closestBorderPoint.x + unitX * distFromBorder,
          y: closestBorderPoint.y + unitY * distFromBorder
        };

        // Constrain to maintain minimum distances
        midpointKnee = constrainKneePosition(midpointKnee, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

        // Verify segment lengths meet minimum
        const segment1Length = Math.sqrt(
          Math.pow(midpointKnee.x - closestBorderPoint.x, 2) +
          Math.pow(midpointKnee.y - closestBorderPoint.y, 2)
        );
        const segment2Length = Math.sqrt(
          Math.pow(arrowTip.x - midpointKnee.x, 2) +
          Math.pow(arrowTip.y - midpointKnee.y, 2)
        );

        if (segment1Length < MIN_SEGMENT_LENGTH || segment2Length < MIN_KNEE_TO_ARROW_DISTANCE) {
          // Can't fit minimum segments. 2026-05-18 — even in the tightest
          // squeeze the knee parks at least one handle-radius
          // (MIN_KNEE_TO_BOX_EDGE_DISTANCE) outside the box, never on or past
          // the border, and line1 is always kept — it shrinks to a sliver but
          // never disappears.
          const unitX2 = distance > 0.001 ? dx / distance : 0;
          const unitY2 = distance > 0.001 ? dy / distance : 0;
          const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
          const clampedDistFromBorder = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, maxDistFromBorder);

          effectiveKnee = {
            x: closestBorderPoint.x + unitX2 * clampedDistFromBorder,
            y: closestBorderPoint.y + unitY2 * clampedDistFromBorder
          };
          line1Start = closestBorderPoint;
          line2Start = effectiveKnee;
          shouldHideLine1 = false;
        } else {
          line1Start = closestBorderPoint;
          line2Start = midpointKnee;
          effectiveKnee = midpointKnee;
          shouldHideLine1 = false;
        }
      } else {
        // Normal case: calculate midpoint ensuring both lines meet minimum lengths
        const minRequiredForLine1Norm = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
        let halfDistance = distance / 2;
        halfDistance = Math.max(minRequiredForLine1Norm, Math.min(halfDistance, distance - MIN_KNEE_TO_ARROW_DISTANCE));

        const unitX = distance > 0 ? dx / distance : 0;
        const unitY = distance > 0 ? dy / distance : 0;

        let midpointKnee = {
          x: closestBorderPoint.x + unitX * halfDistance,
          y: closestBorderPoint.y + unitY * halfDistance
        };

        midpointKnee = constrainKneePosition(midpointKnee, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

        line1Start = closestBorderPoint;
        line2Start = midpointKnee;
        effectiveKnee = midpointKnee;
        shouldHideLine1 = false;
      }

      return { line1Start, shouldHideLine1, line2Start, effectiveKnee };
    }
  }

  // Check for line crossing using Liang-Barsky algorithm
  if (arrowTip) {
    const p1 = arrowTip;
    const p2 = knee;
    let t0 = 0, t1 = 1;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const p = [-dx, dx, -dy, dy];
    const q = [p1.x - adjustedBoxLeft, boxRight - p1.x, p1.y - adjustedBoxTop, boxBottom - p1.y];

    let intersects = true;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) { intersects = false; break; }
      } else {
        const r = q[i] / p[i];
        if (p[i] < 0) {
          if (r > t1) { intersects = false; break; }
          if (r > t0) t0 = r;
        } else {
          if (r < t0) { intersects = false; break; }
          if (r < t1) t1 = r;
        }
      }
    }

    if (intersects && t0 <= t1) {
      const isKneeInsideBox = isPointInsideBox(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
      const isKneeOnBorder = isPointOnBorder(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

      if (isKneeInsideBox || isKneeOnBorder) {
        const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
        const dx = arrowTip.x - closestBorderPoint.x;
        const dy = arrowTip.y - closestBorderPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
        const minRequiredDistance = minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE;

        if (distance < minRequiredDistance) {
          const distFromBorder = Math.max(minRequiredForLine1, distance - MIN_KNEE_TO_ARROW_DISTANCE);
          const unitX = distance > 0.001 ? dx / distance : 0;
          const unitY = distance > 0.001 ? dy / distance : 0;

          let midpointKnee = {
            x: closestBorderPoint.x + unitX * distFromBorder,
            y: closestBorderPoint.y + unitY * distFromBorder
          };

          midpointKnee = constrainKneePosition(midpointKnee, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

          const segment1Length = Math.sqrt(
            Math.pow(midpointKnee.x - closestBorderPoint.x, 2) +
            Math.pow(midpointKnee.y - closestBorderPoint.y, 2)
          );
          const segment2Length = Math.sqrt(
            Math.pow(arrowTip.x - midpointKnee.x, 2) +
            Math.pow(arrowTip.y - midpointKnee.y, 2)
          );

          if (segment1Length < MIN_SEGMENT_LENGTH || segment2Length < MIN_KNEE_TO_ARROW_DISTANCE) {
            const unitX2 = distance > 0.001 ? dx / distance : 0;
            const unitY2 = distance > 0.001 ? dy / distance : 0;
            const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
            // 2026-05-18 — knee parks at least one handle-radius outside the
            // box, never on or past the border (see matching note above).
            const clampedDistFromBorder = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, maxDistFromBorder);

            effectiveKnee = {
              x: closestBorderPoint.x + unitX2 * clampedDistFromBorder,
              y: closestBorderPoint.y + unitY2 * clampedDistFromBorder
            };
            line1Start = closestBorderPoint;
            line2Start = effectiveKnee;
            shouldHideLine1 = clampedDistFromBorder < MIN_SEGMENT_LENGTH;
          } else {
            line1Start = closestBorderPoint;
            line2Start = midpointKnee;
            effectiveKnee = midpointKnee;
            shouldHideLine1 = false;
          }
        } else {
          const minRequiredForLine1Norm = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
          let halfDistance = distance / 2;
          halfDistance = Math.max(minRequiredForLine1Norm, Math.min(halfDistance, distance - MIN_KNEE_TO_ARROW_DISTANCE));

          const unitX = distance > 0 ? dx / distance : 0;
          const unitY = distance > 0 ? dy / distance : 0;

          let midpointKnee = {
            x: closestBorderPoint.x + unitX * halfDistance,
            y: closestBorderPoint.y + unitY * halfDistance
          };

          midpointKnee = constrainKneePosition(midpointKnee, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

          line1Start = closestBorderPoint;
          line2Start = midpointKnee;
          effectiveKnee = midpointKnee;
          shouldHideLine1 = false;
        }
      } else {
        // Knee is outside, but the knee→arrow line crosses the textbox.
        // Phase 15 UAT-3 (2026-04-18) — use the textbox edge closest to
        // the ARROW, not the knee. Using the closest-to-knee edge lets
        // line1 start on the far side of the textbox (from the arrow),
        // which forces the knee midpoint onto a path that cuts through
        // the box. Closest-to-arrow keeps line1 on the arrow's side so
        // line1 + line2 never cross the textbox on commit.
        const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
        const dx = arrowTip.x - closestBorderPoint.x;
        const dy = arrowTip.y - closestBorderPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
        const minRequiredDistance = minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE;

        if (distance < minRequiredDistance) {
          const unitX = distance > 0.001 ? dx / distance : 0;
          const unitY = distance > 0.001 ? dy / distance : 1;
          let segmentLength = Math.max(minRequiredForLine1, distance - MIN_KNEE_TO_ARROW_DISTANCE);

          let kneePoint = {
            x: closestBorderPoint.x + unitX * segmentLength,
            y: closestBorderPoint.y + unitY * segmentLength
          };

          kneePoint = constrainKneePosition(kneePoint, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

          const segment1Length = Math.sqrt(
            Math.pow(kneePoint.x - closestBorderPoint.x, 2) +
            Math.pow(kneePoint.y - closestBorderPoint.y, 2)
          );
          const segment2Length = Math.sqrt(
            Math.pow(arrowTip.x - kneePoint.x, 2) +
            Math.pow(arrowTip.y - kneePoint.y, 2)
          );

          if (segment1Length < MIN_SEGMENT_LENGTH || segment2Length < MIN_KNEE_TO_ARROW_DISTANCE) {
            const unitX2 = distance > 0.001 ? dx / distance : 0;
            const unitY2 = distance > 0.001 ? dy / distance : 0;
            const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
            // 2026-05-18 — knee parks at least one handle-radius outside the
            // box, never on or past the border (see matching note above).
            const clampedDistFromBorder = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, maxDistFromBorder);

            effectiveKnee = {
              x: closestBorderPoint.x + unitX2 * clampedDistFromBorder,
              y: closestBorderPoint.y + unitY2 * clampedDistFromBorder
            };
            line1Start = closestBorderPoint;
            line2Start = effectiveKnee;
            shouldHideLine1 = clampedDistFromBorder < MIN_SEGMENT_LENGTH;
          } else {
            line1Start = closestBorderPoint;
            line2Start = kneePoint;
            effectiveKnee = kneePoint;
            shouldHideLine1 = false;
          }
        } else {
          const minRequiredForLine1Norm = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
          let halfDistance = distance / 2;
          halfDistance = Math.max(minRequiredForLine1Norm, Math.min(halfDistance, distance - MIN_KNEE_TO_ARROW_DISTANCE));

          const unitX = distance > 0.001 ? dx / distance : 0;
          const unitY = distance > 0.001 ? dy / distance : 0;

          let midPoint = {
            x: closestBorderPoint.x + unitX * halfDistance,
            y: closestBorderPoint.y + unitY * halfDistance
          };

          midPoint = constrainKneePosition(midPoint, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

          line1Start = closestBorderPoint;
          line2Start = midPoint;
          effectiveKnee = midPoint;
          shouldHideLine1 = false;
        }
      }
    }
  }

  // Special check: If no arrowTip provided and knee is inside box
  if (!arrowTip) {
    const clampedKnee = clampToBox(knee);
    if (clampedKnee.x === knee.x && clampedKnee.y === knee.y) {
      shouldHideLine1 = true;
    }
  }

  // Final check: only re-route the knee when it is GENUINELY INSIDE the
  // textbox. 2026-05-18 — the knee used to also be re-routed whenever it sat
  // closer than MIN_KNEE_TO_BOX_EDGE_DISTANCE to the border, but that clamp
  // pushed the knee away from where the user actually placed it: the drop
  // check accepts a knee that merely clears the border, while this re-route
  // demanded extra padding, so a knee dropped in the gap between those two
  // thresholds was accepted and then drawn somewhere else — making the knee
  // handle jump on the next grab and the cursor sit offset from it. The knee
  // now stays exactly where it is unless it is truly inside the box.
  if (arrowTip) {
    const isKneeInside = isPointInsideBox(effectiveKnee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

    if (isKneeInside) {
      const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
      const dx = arrowTip.x - closestBorderPoint.x;
      const dy = arrowTip.y - closestBorderPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
      if (distance > minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE) {
        const unitX = dx / distance;
        const unitY = dy / distance;
        const distFromBorder = minRequiredForLine1;

        effectiveKnee = {
          x: closestBorderPoint.x + unitX * distFromBorder,
          y: closestBorderPoint.y + unitY * distFromBorder
        };

        line1Start = closestBorderPoint;
        line2Start = effectiveKnee;
        shouldHideLine1 = false;
      } else if (distance > 0.001) {
        const unitX = dx / distance;
        const unitY = dy / distance;
        const minRequiredForLine1Final = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
        const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
        const distFromBorder = Math.max(0, Math.min(minRequiredForLine1Final, maxDistFromBorder));

        effectiveKnee = {
          x: closestBorderPoint.x + unitX * distFromBorder,
          y: closestBorderPoint.y + unitY * distFromBorder
        };

        line1Start = closestBorderPoint;
        line2Start = effectiveKnee;
        shouldHideLine1 = distFromBorder < MIN_SEGMENT_LENGTH;
      } else {
        // Arrow is on border - push knee outside
        const closestEdgePoint = findClosestBorderPoint(effectiveKnee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
        const dxFromEdge = effectiveKnee.x - closestEdgePoint.x;
        const dyFromEdge = effectiveKnee.y - closestEdgePoint.y;
        const distFromEdgePoint = Math.sqrt(dxFromEdge * dxFromEdge + dyFromEdge * dyFromEdge);

        const minRequiredForLine1Edge = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
        if (distFromEdgePoint > 0.001) {
          const unitX = dxFromEdge / distFromEdgePoint;
          const unitY = dyFromEdge / distFromEdgePoint;
          effectiveKnee = {
            x: closestEdgePoint.x + unitX * minRequiredForLine1Edge,
            y: closestEdgePoint.y + unitY * minRequiredForLine1Edge
          };
        } else {
          effectiveKnee = {
            x: closestEdgePoint.x + minRequiredForLine1Edge,
            y: closestEdgePoint.y
          };
        }
        line1Start = closestEdgePoint;
        line2Start = effectiveKnee;
        shouldHideLine1 = false;
      }
    }
  }

  // 2026-05-18 — the knee→textbox connector is never hidden. The earlier
  // hide-when-short behaviour made the line vanish mid-drag; the line may now
  // shrink to a sliver as the arrow squeezes the knee toward the box, but it
  // always stays visible. (arrowTip is always present for real callouts; the
  // no-arrow branch above is the only producer of a true value.)
  if (arrowTip) shouldHideLine1 = false;

  return { line1Start, shouldHideLine1, line2Start, effectiveKnee };
};

// Export helper functions for potential external use
export { findClosestBorderPoint, isPointInsideBox, isPointOnBorder, arePointsStacked, distanceToBoxEdge, constrainKneePosition };

/*
 * Box placement after a resize (owner Test 44, 2026-10-06). When a callout's
 * box is refitted to its text (a size / font / bold / italic change from the
 * text bar, or typing), it grows or shrinks AWAY from its leader:
 *  - knee below the box: the bottom edge stays, the box grows upward;
 *  - knee above or beside: the top edge stays, the box grows downward;
 *  - a wider box (one long word) keeps the side edge that faces the knee.
 * The knee and arrow tip never move. If the new box would still come within
 * one handle radius of the knee or tip, or cross the knee-to-tip line, the
 * whole box shifts to the nearest clear spot (away from the leader first);
 * the box stays on the page. Before this, the box always grew down from its
 * top-left corner and, when it ran into the knee, the renderer's bad-geometry
 * branch (calculateCalloutConnection) silently re-routed the knee.
 *
 * All values are unscaled page units. A stored box is drawn
 * max(18, height) + fontSize * 0.35 tall (the descender strip,
 * svgAnnotationRenderers renderCallout), so the edges compared here are the
 * DRAWN edges and a font-size change alone moves a bottom-anchored box too.
 */
export const CALLOUT_MIN_BOX_SIZE = 18;
export const CALLOUT_DESCENDER_RATIO = 0.35;

export const calloutDrawnBoxHeight = (height, fontSize) => (
  Math.max(CALLOUT_MIN_BOX_SIZE, Number(height) || 0) + (Number(fontSize) || 12) * CALLOUT_DESCENDER_RATIO
);

const finitePoint = (point) => (
  point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
    ? { x: Number(point.x), y: Number(point.y) }
    : null
);

const pointToRectDistance = (p, r) => {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.sqrt(dx * dx + dy * dy);
};

// Liang-Barsky: does segment a-b touch rectangle r?
const segmentTouchesRect = (a, b, r) => {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.left, r.right - a.x, a.y - r.top, r.bottom - a.y];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
};

/**
 * Where a callout's box goes when its size changes.
 *
 * @param {object} args
 * @param {{left:number, top:number, width:number, height:number}} args.box
 *   the stored box before the change
 * @param {number} args.fontSize the font size before the change
 * @param {{width:number, height:number, fontSize:number}} args.next the new
 *   stored size and font size
 * @param {{x:number, y:number}|null} args.knee
 * @param {{x:number, y:number}|null} args.arrowTip
 * @param {{width:number, height:number}} args.page
 * @param {number} [args.gap] clear space kept around the knee and tip
 * @returns {{left:number, top:number}} the new top-left corner
 */
export function placeResizedCalloutBox({
  box, fontSize, next, knee, arrowTip, page, gap = MIN_KNEE_TO_BOX_EDGE_DISTANCE,
}) {
  const oldLeft = Number(box?.left) || 0;
  const oldTop = Number(box?.top) || 0;
  const oldW = Math.max(CALLOUT_MIN_BOX_SIZE, Number(box?.width) || 0);
  const oldH = calloutDrawnBoxHeight(box?.height, fontSize);
  const newW = Math.max(CALLOUT_MIN_BOX_SIZE, Number(next?.width) || 0);
  const newH = calloutDrawnBoxHeight(next?.height, next?.fontSize ?? fontSize);
  const old = { left: oldLeft, top: oldTop, right: oldLeft + oldW, bottom: oldTop + oldH };
  const unchanged = { left: oldLeft, top: oldTop };

  const kneePt = finitePoint(knee);
  const tipPt = finitePoint(arrowTip);
  const inside = (p) => p.x >= old.left && p.x <= old.right && p.y >= old.top && p.y <= old.bottom;
  // The point the box must turn away from: the knee, or the tip when the knee
  // already sits inside the box. No leader: the top-left corner stays.
  const lead = [kneePt, tipPt].find((p) => p && !inside(p)) || null;
  if (!lead) return unchanged;

  const below = lead.y > old.bottom;
  const above = lead.y < old.top;
  const right = lead.x > old.right;
  const left = lead.x < old.left;
  const preferred = {
    left: right ? old.right - newW : oldLeft,
    top: below ? old.bottom - newH : oldTop,
  };

  // Stay on the page (a box already hanging off it may stay where it was).
  const W = Number(page?.width);
  const H = Number(page?.height);
  const range = (oldPos, oldSize, size, pageSize) => {
    if (!(pageSize > 0)) return [-Infinity, Infinity];
    const lo = Math.min(0, oldPos);
    let hi = Math.max(lo, pageSize - size);
    if (oldPos + oldSize > pageSize) hi = Math.max(hi, oldPos);
    return [lo, hi];
  };
  const [loX, hiX] = range(oldLeft, oldW, newW, W);
  const [loY, hiY] = range(oldTop, oldH, newH, H);
  const clampPos = (pos) => ({
    left: Math.max(loX, Math.min(hiX, pos.left)),
    top: Math.max(loY, Math.min(hiY, pos.top)),
  });

  const clear = (pos, w, h) => {
    const r = { left: pos.left, top: pos.top, right: pos.left + w, bottom: pos.top + h };
    if (kneePt && pointToRectDistance(kneePt, r) < gap - 1e-6) return false;
    if (tipPt && pointToRectDistance(tipPt, r) < gap - 1e-6) return false;
    if (kneePt && tipPt) {
      // Half the gap: the knee itself may sit exactly one gap away.
      const pad = gap / 2;
      const grown = { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
      if (segmentTouchesRect(kneePt, tipPt, grown)) return false;
    }
    return true;
  };

  const start = clampPos(preferred);
  // A layout that was already crowded before the change is left to the
  // anchoring rule alone - never shuffled further on a guess.
  if (clear(start, newW, newH) || !clear(unchanged, oldW, oldH)) return start;

  const up = { x: 0, y: -1 };
  const down = { x: 0, y: 1 };
  const toLeft = { x: -1, y: 0 };
  const toRight = { x: 1, y: 0 };
  let order;
  if (below) order = [up, right ? toLeft : toRight, right ? toRight : toLeft, down];
  else if (above) order = [down, right ? toLeft : toRight, right ? toRight : toLeft, up];
  else if (right) order = [toLeft, up, down, toRight];
  else if (left) order = [toRight, up, down, toLeft];
  else order = [up, down, toLeft, toRight];

  const maxShift = Math.max(W > 0 ? W : 0, H > 0 ? H : 0, newW + newH);
  for (let d = 1; d <= maxShift; d += 1) {
    for (const dir of order) {
      const pos = clampPos({ left: start.left + dir.x * d, top: start.top + dir.y * d });
      if (clear(pos, newW, newH)) return pos;
    }
  }
  return start;
}

import { Point } from '@/types/callout';



export interface ConnectionResult {
    line1Start: Point;
    shouldHideLine1: boolean;
    line2Start: Point;
    effectiveKnee: Point;
}

// Threshold for considering knee "stacked" with border or arrow (in pixels)
const STACKED_THRESHOLD = 2;

// Minimum distances to prevent handle overlaps
export const MIN_KNEE_TO_ARROW_DISTANCE = 15; // Minimum distance from knee center to arrow center (handles are 12x12)
export const MIN_KNEE_TO_BOX_EDGE_DISTANCE = 10; // Minimum distance from knee center to textbox edge
export const MIN_SEGMENT_LENGTH = 10; // Minimum length for line segments to keep them visible

// Minimum distance required between textbox edge and arrow tip for knee to exist
export const MIN_TEXTBOX_TO_ARROW_DISTANCE = MIN_KNEE_TO_BOX_EDGE_DISTANCE + MIN_KNEE_TO_ARROW_DISTANCE;

/**
 * Finds the closest point on the textbox border to a given point
 */
function findClosestBorderPoint(
    point: Point,
    boxLeft: number,
    boxTop: number,
    boxRight: number,
    boxBottom: number
): Point {
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
 */
function isPointInsideBox(
    point: Point,
    boxLeft: number,
    boxTop: number,
    boxRight: number,
    boxBottom: number
): boolean {
    return point.x >= boxLeft && point.x <= boxRight && point.y >= boxTop && point.y <= boxBottom;
}

/**
 * Checks if a point is on or very close to the textbox border (within threshold)
 */
function isPointOnBorder(
    point: Point,
    boxLeft: number,
    boxTop: number,
    boxRight: number,
    boxBottom: number,
    threshold: number = STACKED_THRESHOLD
): boolean {
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
 */
function arePointsStacked(point1: Point, point2: Point, threshold: number = STACKED_THRESHOLD): boolean {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance <= threshold;
}

/**
 * Calculates the minimum distance from a point to the textbox edge
 */
function distanceToBoxEdge(
    point: Point,
    boxLeft: number,
    boxTop: number,
    boxRight: number,
    boxBottom: number
): number {
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
 */
function constrainKneePosition(
    proposedKnee: Point,
    arrowTip: Point,
    boxLeft: number,
    boxTop: number,
    boxRight: number,
    boxBottom: number,
    borderPoint: Point
): Point {
    // Calculate the direction vector from border to arrow
    const dxBorderToArrow = arrowTip.x - borderPoint.x;
    const dyBorderToArrow = arrowTip.y - borderPoint.y;
    const distBorderToArrow = Math.sqrt(dxBorderToArrow * dxBorderToArrow + dyBorderToArrow * dyBorderToArrow);

    // If border and arrow are too close, we can't fit a knee between them with minimum distances
    // Need at least MIN_SEGMENT_LENGTH for line 1 + MIN_KNEE_TO_ARROW_DISTANCE for line 2
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
    // Vector from border to proposed knee
    const dxBorderToKnee = proposedKnee.x - borderPoint.x;
    const dyBorderToKnee = proposedKnee.y - borderPoint.y;
    // Project onto border-to-arrow direction
    const projectionDistance = dxBorderToKnee * unitX + dyBorderToKnee * unitY;

    // Clamp projection to be between border + MIN_SEGMENT_LENGTH and arrow - MIN_KNEE_TO_ARROW_DISTANCE
    // MIN_SEGMENT_LENGTH ensures line 1 (border to knee) meets minimum length requirement
    // MIN_KNEE_TO_ARROW_DISTANCE ensures line 2 (knee to arrow) meets minimum distance requirement
    const minDistFromBorder = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
    const maxDistFromBorder = distBorderToArrow - MIN_KNEE_TO_ARROW_DISTANCE;
    const clampedDistFromBorder = Math.max(minDistFromBorder, Math.min(projectionDistance, maxDistFromBorder));

    // Calculate constrained knee position along the border-to-arrow line
    let constrainedKnee: Point = {
        x: borderPoint.x + unitX * clampedDistFromBorder,
        y: borderPoint.y + unitY * clampedDistFromBorder
    };

    // Verify distances are satisfied
    const distToArrow = Math.sqrt(
        Math.pow(arrowTip.x - constrainedKnee.x, 2) +
        Math.pow(arrowTip.y - constrainedKnee.y, 2)
    );
    const distToEdge = distanceToBoxEdge(constrainedKnee, boxLeft, boxTop, boxRight, boxBottom);

    // Final safety check - if still too close to arrow, move back along line (but maintain minimum for line 1)
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



export const calculateCalloutConnection = (
    boxLeft: number,
    boxTop: number,
    boxW: number,
    boxH: number,
    knee: Point,
    arrowTip?: Point,
    borderWidth: number = 0
): ConnectionResult => {
    // Account for border width - connect to the center of the border edge
    // textBoxWidth is the content width (excluding border)
    // The border is centered on the edge, so:
    // - Right edge center = boxLeft + boxW + borderWidth (content edge + half border on each side, but we want center of right border)
    // - Actually: content right edge = boxLeft + boxW, border center = boxLeft + boxW + borderWidth
    // - Left edge center = boxLeft + borderWidth (border pushes content, center is at borderWidth)
    const adjustedBoxLeft = boxLeft + borderWidth;
    const adjustedBoxTop = boxTop + borderWidth;
    const boxRight = boxLeft + boxW + borderWidth;
    const boxBottom = boxTop + boxH + borderWidth;


    // Helper to clamp a point to the box (now accounting for border)
    const clampToBox = (p: Point) => {
        const clamped = {
            x: Math.max(adjustedBoxLeft, Math.min(p.x, boxRight)),
            y: Math.max(adjustedBoxTop, Math.min(p.y, boxBottom))
        };

        return clamped;
    };

    // Default Behavior: Line 1 snaps to box edge nearest to Knee
    let line1Start = clampToBox(knee);


    let line2Start = { x: knee.x, y: knee.y };
    let shouldHideLine1 = false;

    // Check for "Bad Geometry" (Knee Inside OR Line Crossing)
    let effectiveKnee = { x: knee.x, y: knee.y };

    // Check if knee is inside or overlapping the textbox
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
            // We need at least: MIN_SEGMENT_LENGTH for line 1 + MIN_KNEE_TO_ARROW_DISTANCE for line 2
            const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
            const minRequiredDistance = minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE;

            if (distance < minRequiredDistance) {
                // Distance is too small - place knee at minimum distance from both
                // Place knee at minimum distance from border for line 1 (but ensure line 2 minimum is respected)
                const distFromBorder = Math.max(minRequiredForLine1, distance - MIN_KNEE_TO_ARROW_DISTANCE);
                const unitX = distance > 0.001 ? dx / distance : 0;
                const unitY = distance > 0.001 ? dy / distance : 0;

                let midpointKnee: Point = {
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
                    // Can't fit minimum segments - place knee at border edge (outside textbox)
                    // When there's not enough room, knee stays at the closest border point
                    const unitX = distance > 0.001 ? dx / distance : 0;
                    const unitY = distance > 0.001 ? dy / distance : 0;

                    // Ensure clampedDistFromBorder is never negative (which would put knee inside box)
                    // Place knee as far from border as possible while staying between border and arrow
                    const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
                    const clampedDistFromBorder = Math.max(0, maxDistFromBorder);

                    effectiveKnee = {
                        x: closestBorderPoint.x + unitX * clampedDistFromBorder,
                        y: closestBorderPoint.y + unitY * clampedDistFromBorder
                    };
                    line1Start = closestBorderPoint; // Also update line1Start!
                    line2Start = effectiveKnee;
                    shouldHideLine1 = clampedDistFromBorder < MIN_SEGMENT_LENGTH;
                } else {
                    // Line 1: from closest outside edge to knee (midpoint)
                    line1Start = closestBorderPoint;
                    // Line 2: from knee (midpoint) to arrow
                    line2Start = midpointKnee;
                    effectiveKnee = midpointKnee;
                    shouldHideLine1 = false;
                }
            } else {
                // Normal case: calculate midpoint ensuring both lines meet minimum lengths
                const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
                // Try to place knee at midpoint, but ensure minimum distances are met
                let halfDistance = distance / 2;
                // Ensure line 1 is at least MIN_SEGMENT_LENGTH and line 2 is at least MIN_KNEE_TO_ARROW_DISTANCE
                halfDistance = Math.max(minRequiredForLine1, Math.min(halfDistance, distance - MIN_KNEE_TO_ARROW_DISTANCE));

            // Calculate unit vector from border point to arrow tip
            const unitX = distance > 0 ? dx / distance : 0;
            const unitY = distance > 0 ? dy / distance : 0;

                // Calculate knee position ensuring minimum distances
                let midpointKnee: Point = {
                x: closestBorderPoint.x + unitX * halfDistance,
                y: closestBorderPoint.y + unitY * halfDistance
            };

                // Constrain to maintain minimum distances (this will enforce both line 1 and line 2 minimums)
                midpointKnee = constrainKneePosition(midpointKnee, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

                // Line 1: from closest outside edge to knee (midpoint)
            line1Start = closestBorderPoint;
                // Line 2: from knee (midpoint) to arrow
            line2Start = midpointKnee;
            effectiveKnee = midpointKnee;
            shouldHideLine1 = false;
            }

            // Return early, skipping the rest of the logic
            return { line1Start, shouldHideLine1, line2Start, effectiveKnee };
        }
    }

    if (arrowTip) {
        // Liang-Barsky for segment P1(Arrow) -> P2(Knee)
        // We check if there is ANY intersection with the box.
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
                if (q[i] < 0) { intersects = false; break; } // Parallel and outside
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

        // Check if intersection is valid and within segment
        // Liang-Barsky returns intersection interval [t0, t1].
        // If t0 <= t1, there is an intersection with the infinite lines.
        // We generally need interval to overlap [0, 1].
        // However, standard LB initialization t0=0, t1=1 takes care of clip to segment.
        // So we just check if intersects is true and t0 <= t1 (which loop validity ensures mostly, but explicit check good).
        // Wait, standard LB implementation: if loop finishes with valid=true, then [t0, t1] is the visible segment of [0,1].
        // So if intersects is true, we have a Crossing or Inside case.

        // One edge case: If Arrow is strictly outside and Knee is strictly outside and line does NOT cross.
        // Then intersects logic above sets intersects=false eventually?
        // Yes, e.g. r > t1 check or r < t0 check breaks.

        // If valid intersection with box found and t0 (entry) is before knee (t=1)
        if (intersects && t0 <= t1) {
            // Crossing Detected! Arrow is inside or overlapping the textbox
            // Check if knee is also inside or overlapping the textbox
            const isKneeInsideBox = isPointInsideBox(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
            const isKneeOnBorder = isPointOnBorder(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

            // If knee overlaps textbox, use closest outside edge to ARROW (not knee)
            if (isKneeInsideBox || isKneeOnBorder) {
                // Find the closest outside edge of the textbox to the arrow
                const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

                // Calculate distance from border point to arrow tip
                const dx = arrowTip.x - closestBorderPoint.x;
                const dy = arrowTip.y - closestBorderPoint.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Check if total distance meets minimum requirements
                // We need at least: MIN_SEGMENT_LENGTH for line 1 + MIN_KNEE_TO_ARROW_DISTANCE for line 2
                const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
                const minRequiredDistance = minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE;

                if (distance < minRequiredDistance) {
                    // Distance is too small - place knee at minimum distance from both
                    // Place knee at minimum distance from border for line 1 (but ensure line 2 minimum is respected)
                    const distFromBorder = Math.max(minRequiredForLine1, distance - MIN_KNEE_TO_ARROW_DISTANCE);
                    const unitX = distance > 0.001 ? dx / distance : 0;
                    const unitY = distance > 0.001 ? dy / distance : 0;

                    let midpointKnee: Point = {
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
                        // Can't fit minimum segments - place knee at border edge (outside textbox)
                        const unitX = distance > 0.001 ? dx / distance : 0;
                        const unitY = distance > 0.001 ? dy / distance : 0;

                        // Ensure clampedDistFromBorder is never negative
                        const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
                        const clampedDistFromBorder = Math.max(0, maxDistFromBorder);

                        effectiveKnee = {
                            x: closestBorderPoint.x + unitX * clampedDistFromBorder,
                            y: closestBorderPoint.y + unitY * clampedDistFromBorder
                        };
                        line1Start = closestBorderPoint;
                        line2Start = effectiveKnee;
                        shouldHideLine1 = clampedDistFromBorder < MIN_SEGMENT_LENGTH;
                    } else {
                        // Line 1: from closest outside edge to knee (midpoint)
                        line1Start = closestBorderPoint;
                        // Line 2: from knee (midpoint) to arrow
                        line2Start = midpointKnee;
                        effectiveKnee = midpointKnee;
                        shouldHideLine1 = false;
                    }
                } else {
                    // Normal case: calculate midpoint ensuring both lines meet minimum lengths
                    const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
                    // Try to place knee at midpoint, but ensure minimum distances are met
                    let halfDistance = distance / 2;
                    // Ensure line 1 is at least MIN_SEGMENT_LENGTH and line 2 is at least MIN_KNEE_TO_ARROW_DISTANCE
                    halfDistance = Math.max(minRequiredForLine1, Math.min(halfDistance, distance - MIN_KNEE_TO_ARROW_DISTANCE));

                    // Calculate unit vector from border point to arrow tip
                    const unitX = distance > 0 ? dx / distance : 0;
                    const unitY = distance > 0 ? dy / distance : 0;

                    // Calculate knee position ensuring minimum distances
                    let midpointKnee: Point = {
                        x: closestBorderPoint.x + unitX * halfDistance,
                        y: closestBorderPoint.y + unitY * halfDistance
                    };

                    // Constrain to maintain minimum distances (this will enforce both line 1 and line 2 minimums)
                    midpointKnee = constrainKneePosition(midpointKnee, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

                    // Line 1: from closest outside edge to knee (midpoint)
                    line1Start = closestBorderPoint;
                    // Line 2: from knee (midpoint) to arrow
                    line2Start = midpointKnee;
                    effectiveKnee = midpointKnee;
                    shouldHideLine1 = false;
                }
            } else {
                // Knee is outside, but arrow crosses textbox - use closest edge to knee
                let closestBorderPoint = findClosestBorderPoint(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

            // Calculate distance from border point to arrow tip (for midpoint calculation)
            let dx = arrowTip.x - closestBorderPoint.x;
            let dy = arrowTip.y - closestBorderPoint.y;
            let distance = Math.sqrt(dx * dx + dy * dy);

                // Check if total distance meets minimum requirements
                // We need at least: MIN_SEGMENT_LENGTH for line 1 + MIN_KNEE_TO_ARROW_DISTANCE for line 2
                const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
                const minRequiredDistance = minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE;

            // If distance is very small, extend the segment outward from the border
                if (distance < minRequiredDistance) {
                // Calculate direction from border to arrow (or outward if arrow is inside)
                    const unitX = distance > 0.001 ? dx / distance : 0;
                    const unitY = distance > 0.001 ? dy / distance : 1; // Default to downward if arrow is exactly on border

                    // Place knee at minimum distance from border for line 1
                    let segmentLength = Math.max(minRequiredForLine1, distance - MIN_KNEE_TO_ARROW_DISTANCE);

                    // Create a knee point that's at least MIN_KNEE_TO_BOX_EDGE_DISTANCE away from the border
                    let kneePoint: Point = {
                    x: closestBorderPoint.x + unitX * segmentLength,
                    y: closestBorderPoint.y + unitY * segmentLength
                };

                    // Constrain to maintain minimum distances
                    kneePoint = constrainKneePosition(kneePoint, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

                    // Verify segment lengths meet minimum
                    const segment1Length = Math.sqrt(
                        Math.pow(kneePoint.x - closestBorderPoint.x, 2) +
                        Math.pow(kneePoint.y - closestBorderPoint.y, 2)
                    );
                    const segment2Length = Math.sqrt(
                        Math.pow(arrowTip.x - kneePoint.x, 2) +
                        Math.pow(arrowTip.y - kneePoint.y, 2)
                    );

                    if (segment1Length < MIN_SEGMENT_LENGTH || segment2Length < MIN_KNEE_TO_ARROW_DISTANCE) {
                        // Can't fit minimum segments - place knee at border edge (outside textbox)
                        const unitX = distance > 0.001 ? dx / distance : 0;
                        const unitY = distance > 0.001 ? dy / distance : 0;

                        // Ensure clampedDistFromBorder is never negative
                        const maxDistFromBorder = Math.max(0, distance - MIN_KNEE_TO_ARROW_DISTANCE);
                        const clampedDistFromBorder = Math.max(0, maxDistFromBorder);

                        effectiveKnee = {
                            x: closestBorderPoint.x + unitX * clampedDistFromBorder,
                            y: closestBorderPoint.y + unitY * clampedDistFromBorder
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
                // Normal case: calculate midpoint ensuring both lines meet minimum lengths
                    const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
                    // Try to place knee at midpoint, but ensure minimum distances are met
                    let halfDistance = distance / 2;
                    // Ensure line 1 is at least MIN_SEGMENT_LENGTH and line 2 is at least MIN_KNEE_TO_ARROW_DISTANCE
                    halfDistance = Math.max(minRequiredForLine1, Math.min(halfDistance, distance - MIN_KNEE_TO_ARROW_DISTANCE));
                    const unitX = distance > 0.001 ? dx / distance : 0;
                    const unitY = distance > 0.001 ? dy / distance : 0;

                    let midPoint: Point = {
                        x: closestBorderPoint.x + unitX * halfDistance,
                        y: closestBorderPoint.y + unitY * halfDistance
                    };

                    // Constrain to maintain minimum distances
                    midPoint = constrainKneePosition(midPoint, arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom, closestBorderPoint);

                line1Start = closestBorderPoint;
                line2Start = midPoint;
                effectiveKnee = midPoint;
                    shouldHideLine1 = false;
                }
            }
        }
    }

    // Special check: If Knee is legally inside but Arrow detection didn't trigger (e.g. no arrow?), force hide.
    // (Though if Arrow exists, LB handles Knee Inside too because segment Arrow->Knee enters box).
    // If no arrowTip provided (e.g. dragging knee?), we might want to suppress Line 1 if Knee inside.
    if (!arrowTip) {
        const clampedKnee = clampToBox(knee);
        if (clampedKnee.x === knee.x && clampedKnee.y === knee.y) {
            shouldHideLine1 = true;
            // Should effective knee change here?
            // If dragging knee inside, maybe it should effectively be the clamped point?
            // But if no arrow, line 2 is implied.
            // Let's leave effectiveKnee as is for this edge case to keep handle accessible.
        }
    }

    // Final check: Ensure effectiveKnee is never inside the textbox
    // This prevents the knee from going inside even in edge cases
    if (arrowTip) {
        const isKneeInside = isPointInsideBox(effectiveKnee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
        const distToEdge = distanceToBoxEdge(effectiveKnee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

        if (isKneeInside || distToEdge < MIN_KNEE_TO_BOX_EDGE_DISTANCE) {
            // Find the closest border point to the arrow (not the knee, to maintain proper direction)
            const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);

            // Calculate direction from border to arrow
            const dx = arrowTip.x - closestBorderPoint.x;
            const dy = arrowTip.y - closestBorderPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // We need at least: MIN_SEGMENT_LENGTH for line 1 + MIN_KNEE_TO_ARROW_DISTANCE for line 2
            const minRequiredForLine1 = Math.max(MIN_KNEE_TO_BOX_EDGE_DISTANCE, MIN_SEGMENT_LENGTH);
            if (distance > minRequiredForLine1 + MIN_KNEE_TO_ARROW_DISTANCE) {
                // We have enough space - place knee at minimum distance from border for line 1
                const unitX = dx / distance;
                const unitY = dy / distance;

                // Place knee at minimum distance from border (ensuring line 1 meets MIN_SEGMENT_LENGTH)
                const distFromBorder = minRequiredForLine1;

                effectiveKnee = {
                    x: closestBorderPoint.x + unitX * distFromBorder,
                    y: closestBorderPoint.y + unitY * distFromBorder
                };

                // Update line1Start to use the closest border point
                line1Start = closestBorderPoint;
                line2Start = effectiveKnee;
                shouldHideLine1 = false;
            } else if (distance > 0.001) {
                // Not enough space for both minimums - place knee as far as possible from border while respecting arrow distance
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
                // May need to hide line1 if distFromBorder is too small
                if (distFromBorder < MIN_SEGMENT_LENGTH) {
                    shouldHideLine1 = true;
                } else {
                    shouldHideLine1 = false;
                }
            } else {
                // Arrow is on border - push knee outside in any direction
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
                    // Default to pushing right if exactly on edge
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

    return { line1Start, shouldHideLine1, line2Start, effectiveKnee };
};

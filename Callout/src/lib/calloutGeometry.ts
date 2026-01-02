import { Point } from '@/types/callout';



export interface ConnectionResult {
    line1Start: Point;
    shouldHideLine1: boolean;
    line2Start: Point;
    effectiveKnee: Point;
}

// Threshold for considering knee "stacked" with border or arrow (in pixels)
const STACKED_THRESHOLD = 2;

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

    // Check if knee is stacked with textbox border or arrow tip
    if (arrowTip) {
        const isKneeStackedWithBorder = isPointOnBorder(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
        const isKneeStackedWithArrow = arePointsStacked(knee, arrowTip);
        
        if (isKneeStackedWithBorder || isKneeStackedWithArrow) {
            // Find the closest point on the textbox border to the arrow tip
            const closestBorderPoint = findClosestBorderPoint(arrowTip, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
            
            // Calculate distance between arrow tip and closest border point
            const dx = arrowTip.x - closestBorderPoint.x;
            const dy = arrowTip.y - closestBorderPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Divide distance in half to get midpoint
            const halfDistance = distance / 2;
            
            // Calculate unit vector from border point to arrow tip
            const unitX = distance > 0 ? dx / distance : 0;
            const unitY = distance > 0 ? dy / distance : 0;
            
            // Calculate midpoint knee position
            const midpointKnee: Point = {
                x: closestBorderPoint.x + unitX * halfDistance,
                y: closestBorderPoint.y + unitY * halfDistance
            };
            
            // Set Line 1 from Box -> Knee (Midpoint)
            line1Start = closestBorderPoint;
            // Set Line 2 from Knee (Midpoint) -> Arrow
            line2Start = midpointKnee;
            effectiveKnee = midpointKnee;
            shouldHideLine1 = false;
            
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
            // IMPORTANT: Find the closest point on the textbox border to the KNEE (not the arrow)
            // This ensures line1 (from box border to knee) doesn't cross through the box
            let closestBorderPoint = findClosestBorderPoint(knee, adjustedBoxLeft, adjustedBoxTop, boxRight, boxBottom);
            
            // Calculate distance from border point to arrow tip (for midpoint calculation)
            let dx = arrowTip.x - closestBorderPoint.x;
            let dy = arrowTip.y - closestBorderPoint.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            // If arrow is very close to or on the border, use a small offset to prevent stacking
            const MIN_SEGMENT_LENGTH = 10; // Minimum length for line segments to prevent stacking
            let segmentLength = Math.max(MIN_SEGMENT_LENGTH, distance / 2);
            
            // If distance is very small, extend the segment outward from the border
            if (distance < MIN_SEGMENT_LENGTH * 2) {
                // Calculate direction from border to arrow (or outward if arrow is inside)
                const unitX = distance > 0.1 ? dx / distance : 0;
                const unitY = distance > 0.1 ? dy / distance : 1; // Default to downward if arrow is exactly on border
                
                // Create a knee point that's MIN_SEGMENT_LENGTH away from the border
                const kneePoint: Point = {
                    x: closestBorderPoint.x + unitX * segmentLength,
                    y: closestBorderPoint.y + unitY * segmentLength
                };
                
                // Ensure knee point is not too close to arrow (at least MIN_SEGMENT_LENGTH away)
                const kneeToArrowDist = Math.sqrt(Math.pow(arrowTip.x - kneePoint.x, 2) + Math.pow(arrowTip.y - kneePoint.y, 2));
                if (kneeToArrowDist < MIN_SEGMENT_LENGTH) {
                    // Extend knee point further from arrow
                    const arrowToKneeX = kneePoint.x - arrowTip.x;
                    const arrowToKneeY = kneePoint.y - arrowTip.y;
                    const arrowToKneeDist = Math.sqrt(arrowToKneeX * arrowToKneeX + arrowToKneeY * arrowToKneeY);
                    const extendUnitX = arrowToKneeDist > 0.1 ? arrowToKneeX / arrowToKneeDist : 0;
                    const extendUnitY = arrowToKneeDist > 0.1 ? arrowToKneeY / arrowToKneeDist : 1;
                    kneePoint.x = arrowTip.x + extendUnitX * MIN_SEGMENT_LENGTH;
                    kneePoint.y = arrowTip.y + extendUnitY * MIN_SEGMENT_LENGTH;
                }
                
                line1Start = closestBorderPoint;
                line2Start = kneePoint;
                effectiveKnee = kneePoint;
            } else {
                // Normal case: use midpoint
                const midPoint = {
                    x: closestBorderPoint.x + (dx / 2),
                    y: closestBorderPoint.y + (dy / 2)
                };
                line1Start = closestBorderPoint;
                line2Start = midPoint;
                effectiveKnee = midPoint;
            }
            
            shouldHideLine1 = false;   // Show Line 1 so we have two visible segments
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

    return { line1Start, shouldHideLine1, line2Start, effectiveKnee };
};

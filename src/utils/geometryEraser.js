/**
 * geometryEraser.js — boolean-subtracts an eraser stroke from a Fabric.js path's
 * geometry, producing new path commands ("cookie-cutter" erase).
 *
 * Exports booleanErasePath (flattens the path, converts the stroke to a constant-
 * width ribbon polygon via bisector miter offsets, unions eraser circles, and
 * Martinez-diffs them; returns { pathData, isConvertedToOutline }) and
 * splitPathDataByEraser (a simpler segment-cutting fallback). Used by the eraser
 * tool to reshape ink strokes in local path space.
 */
import { diff, union } from 'martinez-polygon-clipping';
// Copied from geometryHitTest.js to avoid circular dependencies or just for self-containment
const transformPointInverse = (point, matrix) => {
    if (!matrix) return point;
    const [a, b, c, d, e, f] = matrix;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-10) return point;
    const invDet = 1 / det;
    const px = point.x - e;
    const py = point.y - f;
    return {
        x: (d * px - c * py) * invDet,
        y: (-b * px + a * py) * invDet
    };
};

/**
 * Flattens a Fabric.js path commands array into an array of polylines (array of points).
 * Handles M, L, Q, C, Z commands.
 */
const flattenPathToPolylines = (pathData) => {
    const polylines = [];
    let currentPolyline = [];
    let currentX = 0, currentY = 0;
    let startX = 0, startY = 0;

    if (!pathData) return [];

    for (const cmd of pathData) {
        const type = cmd[0];

        if (type === 'M') {
            if (currentPolyline.length > 0) {
                polylines.push(currentPolyline);
                currentPolyline = [];
            }
            currentX = cmd[1];
            currentY = cmd[2];
            startX = currentX;
            startY = currentY;
            currentPolyline.push({ x: currentX, y: currentY });
        } else if (type === 'L') {
            currentX = cmd[1];
            currentY = cmd[2];
            currentPolyline.push({ x: currentX, y: currentY });
        } else if (type === 'Q') {
            // Quadratic Bezier
            const cx = cmd[1], cy = cmd[2];
            const ex = cmd[3], ey = cmd[4];
            // Adaptive sampling: native pen strokes from PencilBrush produce
            // many tiny Q commands (~1-2 px chord each) so 4 samples is fine.
            // PDF-imported ink strokes (e.g. Drawboard) often export a simplified
            // path with long Q commands (10-50 px chord each); 4 samples turns
            // a curved arc into a 4-segment zig-zag, so a crescent eraser on
            // an imported stroke cuts the straight-chord approximation instead
            // of the actual curve — producing a much larger gap than on native
            // strokes. Ensuring each flattened segment stays ≤ 2 px makes the
            // eraser interaction visually match across both sources.
            const chordLen = Math.hypot(ex - currentX, ey - currentY)
              + Math.hypot(cx - currentX, cy - currentY) * 0.5
              + Math.hypot(ex - cx, ey - cy) * 0.5;
            const samples = Math.max(4, Math.ceil(chordLen / 2));
            for (let i = 1; i <= samples; i++) {
                const t = i / samples;
                const mt = 1 - t;
                const x = mt * mt * currentX + 2 * mt * t * cx + t * t * ex;
                const y = mt * mt * currentY + 2 * mt * t * cy + t * t * ey;
                currentPolyline.push({ x, y });
            }
            currentX = ex;
            currentY = ey;
        } else if (type === 'C') {
            // Cubic Bezier
            const cx1 = cmd[1], cy1 = cmd[2];
            const cx2 = cmd[3], cy2 = cmd[4];
            const ex = cmd[5], ey = cmd[6];
            // Adaptive sampling — see Q command above for rationale.
            const chordLen = Math.hypot(ex - currentX, ey - currentY)
              + Math.hypot(cx1 - currentX, cy1 - currentY) * 0.5
              + Math.hypot(cx2 - cx1, cy2 - cy1) * 0.5
              + Math.hypot(ex - cx2, ey - cy2) * 0.5;
            const samples = Math.max(6, Math.ceil(chordLen / 2));
            for (let i = 1; i <= samples; i++) {
                const t = i / samples;
                const mt = 1 - t;
                const mt2 = mt * mt;
                const mt3 = mt2 * mt;
                const t2 = t * t;
                const t3 = t2 * t;
                const x = mt3 * currentX + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * ex;
                const y = mt3 * currentY + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * ey;
                currentPolyline.push({ x, y });
            }
            currentX = ex;
            currentY = ey;
        } else if (type === 'Z') {
            if (currentX !== startX || currentY !== startY) {
                currentPolyline.push({ x: startX, y: startY });
            }
            // Start new polyline
            if (currentPolyline.length > 0) {
                polylines.push(currentPolyline);
                currentPolyline = [];
            }
        }
    }
    if (currentPolyline.length > 0) {
        polylines.push(currentPolyline);
    }
    return polylines;
};

/**
 * Checks intersection between a line segment and a circle.
 * Returns intersection t values (0..1).
 */
const intersectLineCircle = (p1, p2, circle) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lx = p1.x - circle.x;
    const ly = p1.y - circle.y;

    const a = dx * dx + dy * dy;
    const b = 2 * (lx * dx + ly * dy);
    const c = lx * lx + ly * ly - circle.r * circle.r;

    if (a < 1e-9) return []; // Points are too close

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    const intersections = [];
    if (t1 >= 0 && t1 <= 1) intersections.push(t1);
    if (t2 >= 0 && t2 <= 1) intersections.push(t2);

    return intersections.sort((a, b) => a - b);
};

/**
 * Subtracts eraser circles from a single polyline.
 * Returns array of polylines.
 */
const subtractEraserFromPolyline = (polyline, eraserCircles) => {
    if (polyline.length < 2) return [polyline];

    // We process the polyline segment by segment.
    // This is a naive implementation: O(N_segments * M_circles). 
    // For ink strokes, N is usually < 1000, M < 100.

    let currentSegments = [polyline]; // Start with the whole polyline

    for (const circle of eraserCircles) {
        const nextSegments = [];

        for (const segmentPoints of currentSegments) {
            if (segmentPoints.length < 2) {
                nextSegments.push(segmentPoints);
                continue;
            }

            // Check if this polyline is completely outside the circle (bounding box check)
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of segmentPoints) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }

            if (minX > circle.x + circle.r || maxX < circle.x - circle.r ||
                minY > circle.y + circle.r || maxY < circle.y - circle.r) {
                nextSegments.push(segmentPoints);
                continue;
            }

            // If bounding box overlaps, perform detailed cutting
            let currentPiece = [];

            for (let i = 0; i < segmentPoints.length - 1; i++) {
                const p1 = segmentPoints[i];
                const p2 = segmentPoints[i + 1];

                // Check if p1 is inside
                const p1In = (p1.x - circle.x) ** 2 + (p1.y - circle.y) ** 2 <= circle.r ** 2;
                // Check if p2 is inside
                const p2In = (p2.x - circle.x) ** 2 + (p2.y - circle.y) ** 2 <= circle.r ** 2;

                if (p1In && p2In) {
                    // Both inside: discard segment
                    if (currentPiece.length > 0) {
                        nextSegments.push(currentPiece);
                        currentPiece = [];
                    }
                } else if (!p1In && !p2In) {
                    // Both endpoints outside. Check for intersection.
                    const ts = intersectLineCircle(p1, p2, circle);
                    if (ts.length === 2) {
                        // Enters and exits
                        const int1 = {
                            x: p1.x + ts[0] * (p2.x - p1.x),
                            y: p1.y + ts[0] * (p2.y - p1.y)
                        };
                        const int2 = {
                            x: p1.x + ts[1] * (p2.x - p1.x),
                            y: p1.y + ts[1] * (p2.y - p1.y)
                        };

                        if (currentPiece.length === 0) currentPiece.push(p1);
                        currentPiece.push(int1);
                        nextSegments.push(currentPiece);
                        currentPiece = [int2]; // Start new piece from exit
                    } else {
                        // No intersection or touches: keep segment
                        if (currentPiece.length === 0) currentPiece.push(p1);
                        currentPiece.push(p2);
                    }
                } else if (p1In && !p2In) {
                    // Starts inside, exits
                    if (currentPiece.length > 0) {
                        nextSegments.push(currentPiece);
                        currentPiece = [];
                    }
                    const ts = intersectLineCircle(p1, p2, circle);
                    if (ts.length > 0) {
                        const intPt = {
                            x: p1.x + ts[0] * (p2.x - p1.x),
                            y: p1.y + ts[0] * (p2.y - p1.y)
                        };
                        currentPiece.push(intPt);
                    }
                    currentPiece.push(p2);
                } else if (!p1In && p2In) {
                    // Starts outside, enters
                    if (currentPiece.length === 0) currentPiece.push(p1);

                    const ts = intersectLineCircle(p1, p2, circle);
                    if (ts.length > 0) {
                        const intPt = {
                            x: p1.x + ts[0] * (p2.x - p1.x),
                            y: p1.y + ts[0] * (p2.y - p1.y)
                        };
                        currentPiece.push(intPt);
                    }
                    nextSegments.push(currentPiece);
                    currentPiece = [];
                }
            }
            if (currentPiece.length > 0) {
                nextSegments.push(currentPiece);
            }
        }
        currentSegments = nextSegments;
    }

    return currentSegments;
};


/**
 * Main function to split path data by eraser path.
 * Modifies the path data string/structure.
 * 
 * @param {Array} pathData - Fabric.js path commands usually found in pathObj.path
 * @param {Object} eraserPath - { points: [{x,y}, ...] }
 * @param {number} eraserRadius
 * @param {Object} pathObj - The fabric object (wrapper for transform info)
 */

/**
 * Creates a circular polygon (approximate)
 */
const createCirclePolygon = (cx, cy, r, segments = 32) => {
    const points = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    // Close loop
    points.push([points[0][0], points[0][1]]);
    return [points]; // Martinez expects array of rings (multipolygon structure)
};

/**
 * Capsule (stadium) polygon covering the swept disk between two points: a
 * semicircle behind p1, straight flanks, a semicircle past p2. This is the
 * true area a round eraser covers moving from p1 to p2 — subtracting isolated
 * disks at sparse pointer samples left un-erased gaps on fast swipes.
 */
const CAP_ARC_SEGMENTS = 16; // per semicircle → 32-gon resolution end-to-end
const createCapsulePolygon = (p1, p2, r) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return createCirclePolygon(p1.x, p1.y, r);
    // unit normal (perpendicular to travel direction)
    const a1 = Math.atan2(dx / len, -dy / len); // angle of normal n = (-dy, dx)/len
    const ring = [];
    // back semicircle around p1: from +n CCW through -direction to -n
    for (let i = 0; i <= CAP_ARC_SEGMENTS; i++) {
        const ang = a1 + (i / CAP_ARC_SEGMENTS) * Math.PI;
        ring.push([p1.x + Math.cos(ang) * r, p1.y + Math.sin(ang) * r]);
    }
    // front semicircle around p2: from -n CCW through +direction back to +n
    for (let i = 0; i <= CAP_ARC_SEGMENTS; i++) {
        const ang = a1 + Math.PI + (i / CAP_ARC_SEGMENTS) * Math.PI;
        ring.push([p2.x + Math.cos(ang) * r, p2.y + Math.sin(ang) * r]);
    }
    ring.push([ring[0][0], ring[0][1]]);
    return [ring];
};

/**
 * Groups closed rings into martinez polygons-with-holes by even-odd nesting.
 * A previous erase persists the stroke as a filled outline whose hole rings
 * are separate M…Z subpaths; feeding each ring to martinez as its own
 * positively-filled polygon made a later erase treat holes as solid ink.
 */
const groupRingsIntoPolygons = (rings) => {
    const ringContains = (ring, x, y) => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };
    const ringArea = (ring) => {
        let s = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
        }
        return Math.abs(s / 2);
    };
    const entries = rings
        .map((ring) => ({ ring, area: ringArea(ring) }))
        .sort((a, b) => b.area - a.area);
    const polygons = []; // [{ rings: [outer, hole...], entryIndexes }]
    const meta = [];     // parallel: { entry, depth, polygonIndex }
    for (const entry of entries) {
        const [px, py] = entry.ring[0];
        // Count how many already-placed (strictly larger) rings contain this one;
        // the smallest such ring is the immediate parent.
        let depth = 0;
        let parent = null;
        for (const m of meta) {
            if (ringContains(m.entry.ring, px, py)) {
                depth += 1;
                if (!parent || m.entry.area < parent.entry.area) parent = m;
            }
        }
        if (depth % 2 === 0) {
            polygons.push([entry.ring]);
            meta.push({ entry, depth, polygonIndex: polygons.length - 1 });
        } else {
            polygons[parent.polygonIndex].push(entry.ring);
            meta.push({ entry, depth, polygonIndex: parent.polygonIndex });
        }
    }
    return polygons;
};

/**
 * Converts a simple polyline stroke to a polygon outline (ribbon).
 *
 * Each interior vertex uses the BISECTOR of its two adjacent segments (with a
 * miter-length compensation), so the ribbon stays constant width perpendicular
 * to the centerline curve. The earlier naive version only used one segment's
 * perpendicular per vertex, which produced a visible "jog" at every bend —
 * that jog is what made newly-erased thin pen strokes look slightly fatter
 * than the original stroked rendering. With bisector offsets + a conservative
 * miter limit, the ribbon matches the visual thickness of the original stroke
 * (which the browser renders with round joins) closely enough that the first-
 * erase "thickening" is no longer perceptible.
 */
const strokeToPolygon = (polyline, width) => {
    if (polyline.length < 2) return null;

    const halfWidth = width / 2;
    const n = polyline.length;
    const leftSide = new Array(n);
    const rightSide = new Array(n);

    // Precompute per-segment unit perpendiculars.
    // perpSeg[i] = normalized perpendicular of segment polyline[i] -> polyline[i+1].
    const perpSeg = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
        const p1 = polyline[i];
        const p2 = polyline[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) {
            perpSeg[i] = null;
        } else {
            perpSeg[i] = { x: -dy / len, y: dx / len };
        }
    }

    // Find first and last valid segment indices (non-degenerate).
    let firstSeg = 0;
    while (firstSeg < perpSeg.length && !perpSeg[firstSeg]) firstSeg++;
    let lastSeg = perpSeg.length - 1;
    while (lastSeg >= 0 && !perpSeg[lastSeg]) lastSeg--;
    if (firstSeg > lastSeg) return null;

    const MITER_LIMIT = 4;

    for (let i = 0; i < n; i++) {
        const p = polyline[i];
        let offX, offY;

        // Neighboring segment perpendiculars (may be null at degenerate spots).
        const prev = i > 0 ? perpSeg[i - 1] : null;
        const next = i < perpSeg.length ? perpSeg[i] : null;

        if (prev && next) {
            // Interior vertex — bisector direction with miter-length compensation.
            let bx = prev.x + next.x;
            let by = prev.y + next.y;
            const blen = Math.hypot(bx, by);
            if (blen < 1e-6) {
                // Segments are anti-parallel; fall back to one perpendicular.
                offX = prev.x * halfWidth;
                offY = prev.y * halfWidth;
            } else {
                bx /= blen;
                by /= blen;
                // Miter compensation so the ribbon stays constant width:
                // offset = halfWidth / cos(angle/2), where cos(angle/2) = bisector · segmentPerpendicular.
                const dot = prev.x * bx + prev.y * by;
                let miter = dot !== 0 ? 1 / dot : 1;
                if (miter > MITER_LIMIT) miter = MITER_LIMIT;
                if (miter < -MITER_LIMIT) miter = -MITER_LIMIT;
                offX = bx * halfWidth * miter;
                offY = by * halfWidth * miter;
            }
        } else if (next) {
            offX = next.x * halfWidth;
            offY = next.y * halfWidth;
        } else if (prev) {
            offX = prev.x * halfWidth;
            offY = prev.y * halfWidth;
        } else {
            offX = 0;
            offY = 0;
        }

        leftSide[i] = { x: p.x + offX, y: p.y + offY };
        rightSide[i] = { x: p.x - offX, y: p.y - offY };
    }

    // Construct polygon ring: leftSide forward, round END cap, rightSide
    // reversed, round START cap. The browser renders the live stroke with
    // round caps (strokeLinecap: round); a butt-capped ribbon made the
    // subtracted geometry visibly disagree with the rendered ink at both ends.
    const CAP_STEPS = 12;
    const appendCap = (ring, center, fromPt, sweepCW) => {
        // semicircle from fromPt around center; sweepCW rotates clockwise
        const sx = fromPt.x - center.x;
        const sy = fromPt.y - center.y;
        const startAng = Math.atan2(sy, sx);
        const dir = sweepCW ? -1 : 1;
        for (let s = 1; s < CAP_STEPS; s++) {
            const ang = startAng + dir * (s / CAP_STEPS) * Math.PI;
            const r = Math.hypot(sx, sy);
            ring.push([center.x + Math.cos(ang) * r, center.y + Math.sin(ang) * r]);
        }
    };
    const ring = [];
    for (let i = 0; i < n; i++) ring.push([leftSide[i].x, leftSide[i].y]);
    // end cap: from leftSide[n-1] around the last point to rightSide[n-1],
    // bulging along the outgoing tangent (CW sweep reaches +tangent halfway)
    appendCap(ring, polyline[n - 1], leftSide[n - 1], true);
    for (let i = n - 1; i >= 0; i--) ring.push([rightSide[i].x, rightSide[i].y]);
    // start cap: from rightSide[0] around the first point back to leftSide[0],
    // bulging along the reversed tangent
    appendCap(ring, polyline[0], rightSide[0], true);
    if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]); // close

    return [ring];
};

/**
 * Boolean subtraction of eraser from path.
 * Converts stroke to outline if necessary.
 */
export const booleanErasePath = (pathObj, eraserPath, eraserRadius) => {
    if (!pathObj || !eraserPath || !eraserPath.points.length) return null;

    const strokeWidth = pathObj.strokeWidth || 0;
    // If it's a thin line (approx 1px), maybe just use splitting? 
    // But user asked for cookie cutter, so always convert to outline if strokeWidth > 0.

    const matrix = pathObj.calcTransformMatrix();
    const pathOffset = pathObj.pathOffset || { x: 0, y: 0 };

    // Build the eraser geometry in WORLD space — a disk for a single sample,
    // swept capsules between consecutive samples (a fast swipe used to leave
    // un-erased gaps between sparse pointer disks) — then inverse-transform
    // every vertex into the object's local space. Mapping vertices (instead of
    // scaling a radius by scaleX only) keeps the eraser shape exact under
    // rotation and non-uniform scale.
    const toLocal = (x, y) => {
        const localP = transformPointInverse({ x, y }, matrix);
        return [localP.x + pathOffset.x, localP.y + pathOffset.y];
    };
    const worldEraserPolys = [];
    const pts = eraserPath.points;
    if (pts.length === 1) {
        worldEraserPolys.push(createCirclePolygon(pts[0].x, pts[0].y, eraserRadius));
    } else {
        for (let i = 0; i < pts.length - 1; i++) {
            worldEraserPolys.push(createCapsulePolygon(pts[i], pts[i + 1], eraserRadius));
        }
    }
    let combinedEraserPoly = [];
    for (const poly of worldEraserPolys) {
        const localPoly = poly.map((ring) => ring.map(([x, y]) => toLocal(x, y)));
        combinedEraserPoly = combinedEraserPoly.length === 0
            ? localPoly
            : union(combinedEraserPoly, localPoly);
    }

    // Convert path to polygons (outlines)
    // If already filled, use fill geometry? Fabric paths are weird.
    // Usually ink is M...L... with no fill.
    const polylines = flattenPathToPolylines(pathObj.path);

    // Convert stroke to explicit polygon outline
    let subjectPolys = []; // Array of polygons (each = [outer, hole...])

    if (strokeWidth > 0) {
        for (const poly of polylines) {
            const outline = strokeToPolygon(poly, strokeWidth);
            if (outline) subjectPolys.push(outline);
        }
    } else {
        // strokeWidth=0: path is already a filled outline (a previous erase
        // converted stroke→outline, possibly with hole rings as separate M…Z
        // subpaths). Regroup rings into polygons-with-holes so martinez treats
        // holes as holes — feeding each ring as its own solid polygon made a
        // repeat erase resurrect ink inside previously punched holes.
        const rings = [];
        for (const poly of polylines) {
            if (poly.length >= 3) {
                const ring = poly.map(p => [p.x, p.y]);
                ring.push([ring[0][0], ring[0][1]]); // close ring
                rings.push(ring);
            }
        }
        if (rings.length === 0) return null;
        subjectPolys = groupRingsIntoPolygons(rings);
    }

    const resultPolys = subjectPolys;

    // Subtract combined eraser from each subject poly
    const finalPolys = [];
    for (const subject of resultPolys) {
        const diffResult = diff(subject, combinedEraserPoly);
        if (diffResult && diffResult.length > 0) {
            finalPolys.push(...diffResult); // Flatten result
        }
    }

    if (finalPolys.length === 0) return []; // Fully erased

    // Convert back to SVG path commands
    // Martinez returns: [ [ [x,y], [x,y]... (outer) ], [ (hole) ], ... ]
    // We treat them all as filled areas.

    const newPathCommands = [];
    for (const poly of finalPolys) {
        // poly is an array of rings. First is outer.
        if (poly.length === 0) continue;

        const outerRing = poly[0];
        if (outerRing.length < 3) continue;

        newPathCommands.push(['M', outerRing[0][0], outerRing[0][1]]);
        for (let i = 1; i < outerRing.length; i++) {
            newPathCommands.push(['L', outerRing[i][0], outerRing[i][1]]);
        }
        newPathCommands.push(['Z']);

        // Handle holes? Fabric path with multiple Z commands might work for holes if winding rule is EvenOdd.
        // But standard SVG paths handle holes by winding.
        for (let j = 1; j < poly.length; j++) {
            const holeRing = poly[j];
            if (holeRing.length < 3) continue;
            newPathCommands.push(['M', holeRing[0][0], holeRing[0][1]]);
            for (let k = 1; k < holeRing.length; k++) {
                newPathCommands.push(['L', holeRing[k][0], holeRing[k][1]]);
            }
            newPathCommands.push(['Z']);
        }
    }

    return {
        pathData: newPathCommands,
        isConvertedToOutline: strokeWidth > 0 // Only flag conversion if this was originally a stroked path
    };
};

/**
 * geometryEraser.js — boolean-subtracts an eraser stroke from a Fabric.js path's
 * geometry, producing new path commands ("cookie-cutter" erase).
 *
 * Exports booleanErasePath (flattens the path, unions swept eraser capsules, and
 * Martinez-diffs them; returns { pathData, isConvertedToOutline }). Used by the
 * eraser tool to reshape ink strokes in local path space.
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
 * Creates a circular polygon (approximate)
 */
const createCirclePolygon = (cx, cy, r, segments = 36) => {
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
 * A pointer stream can be sparse during a fast swipe. Joining sampled circles
 * leaves untouched gaps, so each consecutive pair becomes a round-ended
 * capsule and the capsules are unioned into one continuous swept disk.
 */
const createCapsulePolygon = (start, end, radius, arcSegments = 18) => {
    // Callers only pass compacted samples (≥0.1 apart), so a zero-length
    // circle fallback is unreachable here.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const direction = Math.atan2(dy, dx);
    const startAngle = direction + Math.PI / 2;
    const ring = [];
    for (let i = 0; i <= arcSegments; i++) {
        const angle = startAngle + (i / arcSegments) * Math.PI;
        ring.push([
            start.x + Math.cos(angle) * radius,
            start.y + Math.sin(angle) * radius,
        ]);
    }
    for (let i = 0; i <= arcSegments; i++) {
        const angle = startAngle + Math.PI + (i / arcSegments) * Math.PI;
        ring.push([
            end.x + Math.cos(angle) * radius,
            end.y + Math.sin(angle) * radius,
        ]);
    }
    ring.push([ring[0][0], ring[0][1]]);
    return [ring];
};

const createSweptEraserPolygon = (samples) => {
    const compacted = [];
    for (const sample of samples || []) {
        const previous = compacted[compacted.length - 1];
        if (!previous || Math.hypot(sample.x - previous.x, sample.y - previous.y) >= 0.1) {
            compacted.push(sample);
        }
    }
    if (compacted.length === 0) return [];
    if (compacted.length === 1) {
        const sample = compacted[0];
        return createCirclePolygon(sample.x, sample.y, sample.r);
    }

    let swept = null;
    for (let i = 1; i < compacted.length; i++) {
        const previous = compacted[i - 1];
        const current = compacted[i];
        const capsule = createCapsulePolygon(previous, current, Math.max(previous.r, current.r));
        swept = swept ? union(swept, capsule) : capsule;
    }
    return swept || [];
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

    // Transform eraser to local space
    // Assuming uniform scale for simplicity of radius
    const scaleX = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
    const localEraserRadius = eraserRadius / scaleX;

    const localEraserCircles = eraserPath.points.map(p => {
        const localP = transformPointInverse(p, matrix);
        return {
            x: localP.x + pathOffset.x,
            y: localP.y + pathOffset.y,
            r: localEraserRadius
        };
    });

    // Convert path to polygons (outlines)
    // If already filled, use fill geometry? Fabric paths are weird. 
    // Usually ink is M...L... with no fill.
    const polylines = flattenPathToPolylines(pathObj.path);

    // Convert stroke to explicit polygon outline
    let subjectPolys = []; // Array of multipolygons

    if (strokeWidth > 0) {
        // Match the demo's paper-ink model: the visible stroke is the union of
        // round swept disks around its centerline. This preserves round caps
        // and joins on the first partial erase instead of converting the path
        // to a square-ended miter ribbon.
        for (const poly of polylines) {
            const outline = createSweptEraserPolygon(poly.map((point) => ({
                ...point,
                r: strokeWidth / 2,
            })));
            if (outline?.length) subjectPolys.push(outline);
        }
    } else {
        // strokeWidth=0: path is already a filled polygon (e.g., after a previous
        // erase converted stroke→outline). Use the path data directly as the
        // subject polygon for boolean subtraction.
        for (const poly of polylines) {
            if (poly.length >= 3) {
                const ring = poly.map(p => [p.x, p.y]);
                ring.push([ring[0][0], ring[0][1]]); // close ring
                subjectPolys.push([ring]);
            }
        }
        if (subjectPolys.length === 0) return null;
    }

    // Iterate eraser circles and subtract from subjectPolys
    let resultPolys = subjectPolys;

    // Optimization: Filter circles that don't touch bounds
    // We can also union the eraser circles first if they are many
    // But martinez union is robust.

    const combinedEraserPoly = createSweptEraserPolygon(localEraserCircles);

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

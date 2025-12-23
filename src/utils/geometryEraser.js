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
            const samples = 4; // Low resolution is usually fine for ink
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
            const samples = 6;
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
const createCirclePolygon = (cx, cy, r, segments = 16) => {
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
 * Converts a simple polyline stroke to a polygon outline (ribbon).
 * This is a naive implementation of stroke expansion.
 */
const strokeToPolygon = (polyline, width) => {
    if (polyline.length < 2) return null;

    const leftSide = [];
    const rightSide = [];
    const halfWidth = width / 2;

    for (let i = 0; i < polyline.length - 1; i++) {
        const p1 = polyline[i];
        const p2 = polyline[i + 1];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) continue;

        const nx = -dy / len;
        const ny = dx / len;

        // Offset points
        leftSide.push({ x: p1.x + nx * halfWidth, y: p1.y + ny * halfWidth });
        rightSide.push({ x: p1.x - nx * halfWidth, y: p1.y - ny * halfWidth });

        if (i === polyline.length - 2) {
            leftSide.push({ x: p2.x + nx * halfWidth, y: p2.y + ny * halfWidth });
            rightSide.push({ x: p2.x - nx * halfWidth, y: p2.y - ny * halfWidth });
        }
    }

    // Construct polygon ring (CCW)
    const ring = [];
    leftSide.forEach(p => ring.push([p.x, p.y]));
    // reverse right side
    for (let i = rightSide.length - 1; i >= 0; i--) {
        ring.push([rightSide[i].x, rightSide[i].y]);
    }
    // close
    if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);

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

    // Create union of all eraser circles to form one big eraser polygon
    // Optimization: Unions are expensive. Maybe just union them first?
    let eraserPoly = null;

    // Create polygon for first circle
    if (localEraserCircles.length > 0) {
        eraserPoly = createCirclePolygon(localEraserCircles[0].x, localEraserCircles[0].y, localEraserCircles[0].r);

        // Union subsequent circles - NAIEVE. 
        // Better to check which actually intersect bounds
        // For performance, we might just loop subtraction?
        // Or union them in chunks?
        // Let's rely on iterating subtraction for now, it's safer than massive union if not optimized
    }

    // Convert stroke to explicit polygon outline
    let subjectPolys = []; // Array of multipolygons

    if (strokeWidth > 0) {
        for (const poly of polylines) {
            const outline = strokeToPolygon(poly, strokeWidth);
            if (outline) subjectPolys.push(outline);
        }
    } else {
        // It's a filled shape or 0 width? behavior undefined for ink. 
        // Assume ink has width.
        return null;
    }

    // Iterate eraser circles and subtract from subjectPolys
    let resultPolys = subjectPolys;

    // Optimization: Filter circles that don't touch bounds
    // We can also union the eraser circles first if they are many
    // But martinez union is robust.

    // Let's create a single eraser multipolygon by unioning all circles
    let combinedEraserPoly = [];
    if (localEraserCircles.length > 0) {
        combinedEraserPoly = createCirclePolygon(localEraserCircles[0].x, localEraserCircles[0].y, localEraserCircles[0].r);
        for (let i = 1; i < localEraserCircles.length; i++) {
            const nextCircle = createCirclePolygon(localEraserCircles[i].x, localEraserCircles[i].y, localEraserCircles[i].r);
            combinedEraserPoly = union(combinedEraserPoly, nextCircle);
        }
    }

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
        isConvertedToOutline: true // Flag to tell consumer to switch stroke->fill
    };
};

// ... keep splitPathDataByEraser for fallback or simpler usage ...
export const splitPathDataByEraser = (pathObj, eraserPath, eraserRadius) => {

    if (!pathObj.path || !eraserPath || !eraserPath.points.length) return null;

    const matrix = pathObj.calcTransformMatrix();
    const pathOffset = pathObj.pathOffset || { x: 0, y: 0 };

    // 1. Transform eraser points to local space
    // We need to account for non-uniform scaling if present, but simpler to assume uniform for eraser radius
    // effectively mapping local space.

    // Calculate average scale to adjust radius
    const scaleX = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
    const scaleY = Math.sqrt(matrix[2] * matrix[2] + matrix[3] * matrix[3]);
    const avgScale = (scaleX + scaleY) / 2;

    const localEraserRadius = eraserRadius / avgScale;

    const localEraserCircles = eraserPath.points.map(p => {
        const localP = transformPointInverse(p, matrix);
        // Add pathOffset because pathData coordinates are relative to (top-left + pathOffset)
        return {
            x: localP.x + pathOffset.x,
            y: localP.y + pathOffset.y,
            r: localEraserRadius
        };
    });

    // 2. Flatten path to polylines
    const polylines = flattenPathToPolylines(pathObj.path);

    // 3. Subtract eraser circles from polylines
    let resultPolylines = polylines;

    // Optimization: Spatial index or bounding box check?
    // Since we have multiple eraser circles, we can just process them.
    // Merging close eraser circles could optimize this.

    for (const poly of polylines) {
        // replace poly with fragmented versions
        // Done in helper
    }

    // Actually we need to loop over all polylines and apply subtraction
    let finalPolylines = [];
    for (const poly of polylines) {
        const fragments = subtractEraserFromPolyline(poly, localEraserCircles);
        finalPolylines.push(...fragments);
    }

    // 4. Reconstruct path commands
    if (finalPolylines.length === 0) return [['M', 0, 0]]; // Empty path?

    const newPathCommands = [];
    for (const poly of finalPolylines) {
        if (poly.length < 2) continue; // Skip single points
        newPathCommands.push(['M', poly[0].x, poly[0].y]);
        for (let i = 1; i < poly.length; i++) {
            newPathCommands.push(['L', poly[i].x, poly[i].y]);
        }
    }

    return newPathCommands;
};

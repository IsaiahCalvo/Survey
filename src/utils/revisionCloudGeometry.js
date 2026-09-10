// Approved revision-cloud geometry, copied from the standalone studio at
// commit d1abe783160f7274b5ffb51f58d81739ddaf3c5d (cloud-final-short-gap).
// Keep every app renderer on this one engine so live, imported, and printed
// clouds use the same corner joins, spacing, and resize transitions.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a, b, k = 1) => ({
    x: a.x + b.x * k,
    y: a.y + b.y * k,
});
const mix = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});
const num = (v) => Number(v.toFixed(5));
const xy = (p) => `${num(p.x)} ${num(p.y)}`;
const K = 0.5522847498307936;
export function area(points) {
    return (points.reduce((s, p, i) => {
        const q = points[(i + 1) % points.length];
        return s + p.x * q.y - q.x * p.y;
    }, 0) / 2);
}
export function heading(points, i, closed, _side = 1) {
    const p = points[i], prev = points[i ? i - 1 : closed ? points.length - 1 : 0], next = points[i + 1 < points.length ? i + 1 : closed ? 0 : i];
    const a = Math.atan2(p.y - prev.y, p.x - prev.x), b = Math.atan2(next.y - p.y, next.x - p.x);
    let ax = Math.cos(a) + Math.cos(b), ay = Math.sin(a) + Math.sin(b);
    if (!closed && i === 0) {
        ax = Math.cos(b);
        ay = Math.sin(b);
    }
    if (!closed && i === points.length - 1) {
        ax = Math.cos(a);
        ay = Math.sin(a);
    }
    if (Math.hypot(ax, ay) < 1e-6) {
        ax = Math.cos(b);
        ay = Math.sin(b);
    }
    return Math.atan2(ay, ax);
}
export function turnAt(points, i, closed, side) {
    if (!closed && (i === 0 || i === points.length - 1))
        return 1;
    const p = points[i], a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
    return ((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) * side < 0
        ? -1
        : 1;
}
function bendAt(points, i) {
    const p = points[i], a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
    const d = Math.atan2(b.y - p.y, b.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x);
    return Math.atan2(Math.sin(d), Math.cos(d));
}
function clearanceAt(points, i, closed) {
    const prev = i > 0
        ? dist(points[i], points[i - 1])
        : closed
            ? dist(points[i], points.at(-1))
            : Infinity;
    const next = i < points.length - 1
        ? dist(points[i], points[i + 1])
        : closed
            ? dist(points[i], points[0])
            : Infinity;
    return Math.min(prev, next);
}
export function makeShape(kind, points, id, style) {
    const closed = kind !== 'polyline' && kind !== 'freehand';
    const side = closed && area(points) < 0 ? -1 : 1;
    return {
        id,
        kind,
        points: points.map((p) => ({ ...p })),
        angles: points.map((_, i) => heading(points, i, closed, side)),
        clearance: points.map((_, i) => clearanceAt(points, i, closed)),
        bends: points.map((_, i) => bendAt(points, i)),
        turns: points.map((_, i) => turnAt(points, i, closed, side)),
        size: 28,
        depth: 12,
        stroke: 2.5,
        color: '#c42747',
        ...style,
        side,
    };
}
export function arc(start, end, depth, side = 1) {
    const width = dist(start, end), u = width > 1e-8
        ? { x: (end.x - start.x) / width, y: (end.y - start.y) / width }
        : { x: 1, y: 0 };
    const n = { x: u.y * side, y: -u.x * side }, mid = mix(start, end, 0.5), apex = add(mid, n, depth), r = width / 2;
    const angle = 0.28, k = (4 / 3) * Math.tan(angle / 4);
    const tail = add(add(mid, u, r * Math.cos(angle)), n, -depth * Math.sin(angle));
    return {
        start,
        baseEnd: end,
        end: tail,
        apex,
        width,
        depth,
        controls: [
            add(start, n, depth * K),
            add(apex, u, -r * K),
            apex,
            add(apex, u, r * K),
            add(end, n, depth * K),
            end,
            add(end, n, -depth * k),
            add(add(tail, u, r * Math.sin(angle) * k), n, depth * Math.cos(angle) * k),
            tail,
        ],
    };
}
/** Independent strokes preserve the rounded end of each full-size scallop. */
export function path(lobes) {
    let result = '';
    for (let j = 0; j < lobes.length; j++) {
        const l = lobes[j];
        if (j)
            result += ' ';
        result += `M ${xy(l.start)} `;
        for (let i = 0; i < l.controls.length; i += 3) {
            if (i)
                result += ' ';
            result += `C ${xy(l.controls[i])} ${xy(l.controls[i + 1])} ${xy(l.controls[i + 2])}`;
        }
    }
    return result;
}
export function corner(shape, i) {
    const p = shape.points[i], angle = shape.angles[i], u = { x: Math.cos(angle), y: Math.sin(angle) }, n = {
        x: u.y * shape.side,
        y: -u.x * shape.side,
    };
    const center = add(p, n, -shape.depth), start = add(center, u, -shape.size / 2), end = add(center, u, shape.size / 2);
    return arc(start, end, shape.depth, shape.side);
}
/** Counts are a pure function of geometry. There is no clock-driven catch-up. */
export function stepCount(_state, ratio, now, _animate = true) {
    const count = clamp(Math.round(ratio), 1, 512);
    return { count, from: count, to: count, started: now, progress: 1 };
}
export function weights(s) {
    return Array.from({ length: s.count }, () => ({
        width: 1 / s.count,
        height: 1,
    }));
}
function split(c, t) {
    const a = mix(c[0], c[1], t), b = mix(c[1], c[2], t), d = mix(c[2], c[3], t);
    const e = mix(a, b, t), f = mix(b, d, t), g = mix(e, f, t);
    return [
        [c[0], a, e, g],
        [g, f, d, c[3]],
    ];
}
export function runBetween(id, start, end, shape, _state, shortCap = 0) {
    // Every row uses the same continuous entry, at every length. Switching to
    // an integer-count fit on longer rows skips the separation between crowns.
    const length = dist(start, end), target = Math.max(0.5, shape.size);
    if (length < 1e-8)
        return { id, d: '', lobes: [] };
    const u = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    if (shortCap > 0 && length < target) {
        const mid = mix(start, end, 0.5);
        const full = arc(add(mid, u, -target / 2), add(mid, u, target / 2), shape.depth, shape.side);
        // Select the central part of the original ellipse instead of shrinking it.
        let lo = 0, hi = 1;
        for (let k = 0; k < 40; k++) {
            const t = (lo + hi) / 2, a = 1 - t;
            const x = -a * a * a - 3 * a * a * t - 3 * K * a * t * t;
            if (x < -length / target)
                lo = t;
            else
                hi = t;
        }
        const from = (lo + hi) / 2;
        // Keep both quarters even at a nearly empty span. Generic trimming drops
        // tiny pieces; their removal would change this cap's control layout.
        const left = split([full.start, full.controls[0], full.controls[1], full.controls[2]], from)[1];
        const right = split([full.controls[2], full.controls[3], full.controls[4], full.controls[5]], 1 - from)[0];
        const cap = {
            start: left[0],
            controls: [...left.slice(1), ...right.slice(1)],
        };
        const delta = { x: start.x - cap.start.x, y: start.y - cap.start.y };
        const shift = (p) => ({ x: p.x + delta.x, y: p.y + delta.y });
        const tailWeight = smooth((length / target - 0.75) / 0.25);
        const nativeEnd = full.baseEnd;
        const controls = cap.controls.map(shift);
        controls[5] = end;
        for (const p of full.controls.slice(6))
            controls.push({
                x: end.x + (p.x - nativeEnd.x) * tailWeight,
                y: end.y + (p.y - nativeEnd.y) * tailWeight,
            });
        // Fade to the ordinary arc before its vertical endpoint: directly clipping
        // near that endpoint has unbounded speed with respect to span length.
        const weight = shortCap * smooth((1 - length / target) / 0.2);
        const native = arc(start, end, (shape.depth * length) / target, shape.side);
        const blended = controls.map((p, i) => mix(native.controls[i], p, weight));
        const apex = mix(native.apex, shift(full.apex), weight);
        const lobe = {
            ...native,
            controls: blended,
            apex,
            end: blended[8],
            depth: dist(apex, mid),
        };
        return { id, d: path([lobe]), lobes: [lobe] };
    }
    // Keep the row phase fixed. Its last three gaps share a small correction
    // while a full-size crown separates at the end, behind the changing tail.
    const w = Math.max(Math.min(target, length), length / (1 + 2047 * 0.88)), pitch = 0.88 * w, span = Math.max(0, length - w);
    const count = Math.floor(span / pitch + 1e-9) + 1;
    const fraction = Math.max(0, span / pitch - (count - 1));
    const eased = fraction ** 3 * (10 + fraction * (-15 + 6 * fraction));
    const rawCorrection = (fraction - eased) * pitch;
    // With only one full rectangle gap, the shared fit can flatten its valley.
    // Ease its correction toward an eight-percent bound so the entering pair
    // separates sooner. This keeps both endpoint speeds continuous and leaves
    // all longer rows unchanged.
    const correction = shape.kind === 'rectangle' && count === 2
        ? rawCorrection / Math.hypot(1, rawCorrection / (0.08 * w))
        : rawCorrection;
    const group = Math.min(3, count - 1);
    const offsets = Array.from({ length: count }, (_, i) => i * pitch +
        correction * (group ? Math.max(0, (i - (count - 1 - group)) / group) : 0));
    if (span - offsets.at(-1) > 1e-7)
        offsets.push(span);
    // Give the entering pair room by sharing a small shift across nearby gaps.
    // The shift fades to zero at count boundaries; widths and anchors stay fixed.
    const phase = Math.sin(Math.PI * fraction) ** 2;
    if (offsets.length > 2) {
        const neighbors = Math.min(5, offsets.length - 2);
        const first = offsets.length - 2 - neighbors;
        let step = Math.min(0.04 * w * phase, Math.max(0, pitch - (offsets.at(-1) - offsets.at(-2))) / neighbors);
        for (let i = first + 1; i < offsets.length - 1; i++)
            step = Math.min(step, Math.max(0, offsets[i] - offsets[i - 1] - 0.831 * w));
        for (let i = first + 1; i < offsets.length - 1; i++)
            offsets[i] -= step * (i - first);
    }
    const lobes = offsets.map((x) => arc(add(start, u, x), add(start, u, x + w), (shape.depth * w) / target, shape.side));
    return { id, d: path(overlapAligned(lobes, u)), lobes };
}
const smooth = (v) => {
    const t = clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
};
function cutLobe(l, from, to) {
    const controls = [];
    let start = l.start, end = l.end;
    for (let i = 0; i < l.controls.length / 3; i++) {
        const lo = clamp(from - i, 0, 1), hi = clamp(to - i, 0, 1);
        if (hi - lo < 1e-9)
            continue;
        let c = [
            i ? l.controls[3 * i - 1] : l.start,
            l.controls[3 * i],
            l.controls[3 * i + 1],
            l.controls[3 * i + 2],
        ];
        if (hi < 1)
            c = split(c, hi)[0];
        if (lo > 0)
            c = split(c, lo / hi)[1];
        if (!controls.length)
            start = c[0];
        controls.push(c[1], c[2], c[3]);
        end = c[3];
    }
    return { ...l, start, end, controls };
}
function overlapAligned(lobes, u, complete = false) {
    const from = lobes.map(() => 0), to = lobes.map((l) => l.controls.length / 3);
    const continuations = lobes.map(() => undefined);
    for (let i = 1; i < lobes.length; i++) {
        const prev = lobes[i - 1], l = lobes[i], w = l.width;
        const d = (l.start.x - prev.start.x) * u.x + (l.start.y - prev.start.y) * u.y;
        // Equal-radius ellipses cross half way between their centers. Locate that
        // point on the actual cubic, then trim both sides of the hidden overlap.
        const target = clamp(1 - d / w, 0, 1);
        let t = Math.sqrt(target);
        // Solve the normalized quarter-ellipse cubic once in scalar form. This
        // avoids allocating and splitting a curve 24 times for every tiny hump.
        for (let step = 0; step < 7 && target > 1e-12; step++) {
            const value = 3 * (1 - K) * t * t + (3 * K - 2) * t * t * t;
            const derivative = 6 * (1 - K) * t + 3 * (3 * K - 2) * t * t;
            t = clamp(t - (value - target) / Math.max(derivative, 1e-12), 0, 1);
        }
        from[i] = t;
        const crossing = 2 - t;
        // While two full crowns separate, the inner tail is hidden. Let it emerge
        // with their spacing, so a second tail cannot pop into a merged crown.
        to[i - 1] = complete
            ? to[i - 1]
            : crossing + (to[i - 1] - crossing) * smooth((d / w - 0.65) / 0.23);
        if (!complete) {
            const tail = replacementTail(prev, crossing, d, u);
            if (tail) {
                continuations[i - 1] = tail;
                to[i - 1] = crossing;
            }
        }
    }
    return lobes.map((l, i) => {
        const cut = cutLobe(l, from[i], to[i]), tail = continuations[i];
        return tail
            ? { ...cut, end: tail.at(-1), controls: [...cut.controls, ...tail] }
            : cut;
    });
}
/** Restore a visible divider without drawing the hidden native loop. Its
 * position follows the existing crossing; crown positions and counts never change. */
function replacementTail(prev, crossing, d, u, inside) {
    const w = prev.width, r = d / w;
    if (r <= 1e-8 || r >= 0.88 || prev.depth <= 1e-8)
        return;
    const native = cutLobe(prev, crossing, 3), nc = cubics(native);
    if (nc.length !== 2)
        return;
    const alpha = smooth((r - 0.65) / 0.23);
    const length = 0.75 * prev.depth * smooth((r - 0.12) / 0.2);
    const slope = Math.sqrt(Math.max(0, 1 - r * r)) /
        (2 * (prev.depth / w) * Math.max(r, 1e-9));
    const bend = Math.min(0.4 * length, 0.25 * slope * length, 0.08 * w, d * 0.2);
    const center = mix(prev.start, prev.baseEnd, 0.5);
    const inward = inside ?? {
        x: (center.x - prev.apex.x) / prev.depth,
        y: (center.y - prev.apex.y) / prev.depth,
    };
    const p = native.start;
    const synthetic = [
        p,
        add(add(p, u, 0.3 * bend), inward, 0.2 * length),
        add(add(p, u, bend), inward, 0.6 * length),
        add(add(p, u, bend), inward, length),
    ];
    return split(synthetic, 0.5).flatMap((c, j) => c.slice(1).map((v, k) => mix(v, nc[j][k + 1], alpha)));
}
function cubics(l) {
    const result = [];
    let p = l.start;
    for (let i = 0; i < l.controls.length; i += 3) {
        const c = [p, l.controls[i], l.controls[i + 1], l.controls[i + 2]];
        result.push(c);
        p = c[3];
    }
    return result;
}
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export function intersect(a, b) {
    const ab = bounds(a), bb = bounds(b);
    if (ab.x > bb.x + bb.width ||
        bb.x > ab.x + ab.width ||
        ab.y > bb.y + bb.height ||
        bb.y > ab.y + ab.height)
        return;
    // Keep de Casteljau arithmetic and first-hit seed order unchanged while
    // avoiding temporary points and split arrays in this inner resize loop.
    const coordinate = (a, b, c, d, t) => {
        const ab = a + (b - a) * t, bc = b + (c - b) * t, cd = c + (d - c) * t;
        const abc = ab + (bc - ab) * t, bcd = bc + (cd - bc) * t;
        return abc + (bcd - abc) * t;
    };
    const at = (c, t) => ({
        x: coordinate(c[0].x, c[1].x, c[2].x, c[3].x, t),
        y: coordinate(c[0].y, c[1].y, c[2].y, c[3].y, t),
    });
    const derivative = (a, b, c, d, t) => {
        const ab = b - a, bc = c - b, cd = d - c;
        const abc = ab + (bc - ab) * t, bcd = bc + (cd - bc) * t;
        return (abc + (bcd - abc) * t) * 3;
    };
    const tangent = (c, t) => ({
        x: derivative(c[0].x, c[1].x, c[2].x, c[3].x, t),
        y: derivative(c[0].y, c[1].y, c[2].y, c[3].y, t),
    });
    const N = 16;
    const ap = Array.from({ length: N + 1 }, (_, i) => at(a, i / N)), bp = Array.from({ length: N + 1 }, (_, i) => at(b, i / N));
    for (let i = 0; i < N; i++) {
        const p = ap[i], rx = ap[i + 1].x - p.x, ry = ap[i + 1].y - p.y;
        for (let j = 0; j < N; j++) {
            const q = bp[j], vx = bp[j + 1].x - q.x, vy = bp[j + 1].y - q.y;
            const den = rx * vy - ry * vx;
            if (Math.abs(den) < 1e-10)
                continue;
            const dx = q.x - p.x, dy = q.y - p.y;
            const x = (dx * vy - dy * vx) / den, y = (dx * ry - dy * rx) / den;
            if (x < 0 || x > 1 || y < 0 || y > 1)
                continue;
            let t = (i + x) / N, u = (j + y) / N;
            for (let k = 0; k < 10; k++) {
                const delta = sub(at(b, u), at(a, t)), da = tangent(a, t), db = tangent(b, u), det = cross(da, db);
                if (Math.abs(det) < 1e-12)
                    break;
                t += cross(delta, db) / det;
                u += cross(delta, da) / det;
            }
            if (t > 1e-7 &&
                t < 1 - 1e-7 &&
                u > 1e-7 &&
                u < 1 - 1e-7 &&
                dist(at(a, t), at(b, u)) < 1e-5)
                return { t, u };
        }
    }
}
/** Outward arcs overlap at a re-entrant vertex. Keep their outer pieces and
 * discard the hidden loop; never reverse a scallop to manufacture a corner. */
function joinConcave(prev, next) {
    for (let i = Math.max(0, prev.lobes.length - 2); i < prev.lobes.length; i++) {
        const ac = cubics(prev.lobes[i]);
        for (let ai = 0; ai < ac.length; ai++)
            for (let j = Math.min(1, next.lobes.length - 1); j >= 0; j--) {
                const bc = cubics(next.lobes[j]);
                for (let bi = bc.length - 1; bi >= 0; bi--) {
                    const hit = intersect(ac[ai], bc[bi]);
                    if (!hit)
                        continue;
                    const left = split(ac[ai], hit.t)[0], right = split(bc[bi], hit.u)[1];
                    right[0] = left[3];
                    const a = prev.lobes[i], b = next.lobes[j];
                    prev.lobes = [
                        ...prev.lobes.slice(0, i),
                        {
                            ...a,
                            end: left[3],
                            controls: [...ac.slice(0, ai), left].flatMap((c) => c.slice(1)),
                        },
                    ];
                    next.lobes = [
                        {
                            ...b,
                            start: left[3],
                            controls: [right, ...bc.slice(bi + 1)].flatMap((c) => c.slice(1)),
                        },
                        ...next.lobes.slice(j + 1),
                    ];
                    prev.d = path(prev.lobes);
                    next.d = path(next.lobes);
                    return;
                }
            }
    }
}
function ellipseIntersection(a, b, axis, canonical) {
    let ax0 = Infinity, ax1 = -Infinity, ay0 = Infinity, ay1 = -Infinity, bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const origin = a[0];
    for (let i = 0; i < 4; i++) {
        const dx = a[i].x - origin.x, dy = a[i].y - origin.y, x = dx * axis.x + dy * axis.y, y = dx * axis.y - dy * axis.x;
        ax0 = Math.min(ax0, x);
        ax1 = Math.max(ax1, x);
        ay0 = Math.min(ay0, y);
        ay1 = Math.max(ay1, y);
        const ex = b[i].x - origin.x, ey = b[i].y - origin.y, u = ex * axis.x + ey * axis.y, v = ex * axis.y - ey * axis.x;
        bx0 = Math.min(bx0, u);
        bx1 = Math.max(bx1, u);
        by0 = Math.min(by0, v);
        by1 = Math.max(by1, v);
    }
    const eps = 1e-9;
    if (ax0 > bx1 + eps || bx0 > ax1 + eps || ay0 > by1 + eps || by0 > ay1 + eps)
        return;
    return canonical ? adjacentIntersection(a, b, axis) : intersect(a, b);
}
function adjacentIntersection(a, b, axis) {
    const along = (p) => p.x * axis.x + p.y * axis.y;
    const forward = (c) => c
        .slice(1)
        .every((p, i) => (p.x - c[i].x) * axis.x + (p.y - c[i].y) * axis.y >= -1e-12);
    if (!forward(a) || !forward(b)) {
        return intersect(a, b);
    }
    const ah = split(a, 0.5), bh = split(b, 0.5);
    const transverse = (c, sign) => c
        .slice(1)
        .every((p, i) => sign * ((p.x - c[i].x) * axis.y - (p.y - c[i].y) * axis.x) >= -1e-12);
    // Shared x range must be confined to these opposing monotone half-curves.
    if (along(ah[0][3]) >= along(b[0]) ||
        along(bh[0][3]) <= along(a[3]) ||
        !transverse(ah[1], -1) ||
        !transverse(bh[0], 1)) {
        return intersect(a, b);
    }
    const coordinate = (a, b, c, d, t) => {
        const ab = a + (b - a) * t, bc = b + (c - b) * t, cd = c + (d - c) * t;
        const abc = ab + (bc - ab) * t, bcd = bc + (cd - bc) * t;
        return abc + (bcd - abc) * t;
    };
    const at = (c, t) => ({
        x: coordinate(c[0].x, c[1].x, c[2].x, c[3].x, t),
        y: coordinate(c[0].y, c[1].y, c[2].y, c[3].y, t),
    });
    const derivative = (a, b, c, d, t) => {
        const ab = b - a, bc = c - b, cd = d - c;
        const abc = ab + (bc - ab) * t, bcd = bc + (cd - bc) * t;
        return (abc + (bcd - abc) * t) * 3;
    };
    const tangent = (c, t) => ({
        x: derivative(c[0].x, c[1].x, c[2].x, c[3].x, t),
        y: derivative(c[0].y, c[1].y, c[2].y, c[3].y, t),
    });
    let t = 0.75, u = 0.25;
    for (let k = 0; k < 5; k++) {
        const delta = sub(at(b, u), at(a, t)), da = tangent(a, t), db = tangent(b, u), det = cross(da, db);
        if (Math.abs(det) < 1e-12)
            return intersect(a, b);
        t += cross(delta, db) / det;
        u += cross(delta, da) / det;
        if (t < -0.5 || t > 1.5 || u < -0.5 || u > 1.5)
            return intersect(a, b);
    }
    if (t > 1e-7 &&
        t < 1 - 1e-7 &&
        u > 1e-7 &&
        u < 1 - 1e-7 &&
        dist(at(a, t), at(b, u)) < 1e-8) {
        return { t, u };
    }
    return intersect(a, b);
}
/** Hide only the leading branch below a crossing. Keep the complete crown
 * and the preceding arc's round trailing end; never clip both crowns. */
function overlapTails(lobes, closed = false) {
    const from = lobes.map(() => 0), to = lobes.map((l) => l.controls.length / 3);
    const continuations = lobes.map(() => undefined);
    for (let i = closed ? 0 : 1; i < lobes.length; i++) {
        const j = (i + lobes.length - 1) % lobes.length, prev = lobes[j], l = lobes[i], ac = cubics(prev), bc = cubics(l);
        let found = false;
        for (let a = ac.length - 1; a >= 0 && !found; a--)
            for (let b = 0; b < bc.length; b++) {
                const hit = closed
                    ? ellipseIntersection(ac[a], bc[b], {
                        x: (prev.baseEnd.x - prev.start.x) / prev.width,
                        y: (prev.baseEnd.y - prev.start.y) / prev.width,
                    }, a === 1 && b === 0)
                    : intersect(ac[a], bc[b]);
                if (!hit)
                    continue;
                from[i] = b + hit.u;
                const d = dist(mix(prev.start, prev.baseEnd, 0.5), mix(l.start, l.baseEnd, 0.5));
                const crossing = a + hit.t;
                to[j] =
                    crossing + (to[j] - crossing) * smooth((d / l.width - 0.65) / 0.23);
                const pc = mix(prev.start, prev.baseEnd, 0.5), lc = mix(l.start, l.baseEnd, 0.5);
                const nx = (pc.x - prev.apex.x) / prev.depth + (lc.x - l.apex.x) / l.depth;
                const ny = (pc.y - prev.apex.y) / prev.depth + (lc.y - l.apex.y) / l.depth;
                const normalLength = Math.hypot(nx, ny);
                if (a === 1 && b === 0 && normalLength > 1) {
                    const u = {
                        x: (prev.baseEnd.x - prev.start.x) / prev.width,
                        y: (prev.baseEnd.y - prev.start.y) / prev.width,
                    };
                    const tail = replacementTail(prev, crossing, d, u, {
                        x: nx / normalLength,
                        y: ny / normalLength,
                    });
                    if (tail) {
                        const start = cutLobe(prev, 0, crossing).end;
                        const tailCurve = {
                            ...prev,
                            start,
                            end: tail.at(-1),
                            controls: tail,
                        };
                        const nextCurve = cutLobe(l, from[i], 3);
                        // On tight turns, reject a separator that would cross the next crown.
                        const nextCubics = cubics(nextCurve);
                        const loops = cubics(tailCurve).some((a) => nextCubics.some((b) => closed ? ellipseIntersection(a, b, u, false) : intersect(a, b)));
                        if (!loops) {
                            continuations[j] = tail;
                            to[j] = crossing;
                        }
                    }
                }
                found = true;
                break;
            }
    }
    return lobes.map((l, i) => {
        const cut = cutLobe(l, from[i], to[i]), tail = continuations[i];
        return tail
            ? { ...cut, end: tail.at(-1), controls: [...cut.controls, ...tail] }
            : cut;
    });
}
export function bounds(points) {
    // Linear, not `Math.min(...xs)`: exportSvg hands this every lobe control
    // point of every run, which overflows the call stack on a big cloud (see
    // src/utils/arrayExtrema.js). Same result, constant stack.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let index = 0; index < points.length; index += 1) {
        const { x, y } = points[index];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}
function rectangleFit(shape) {
    const b = bounds(shape.points), q = shape.depth / shape.size;
    return {
        width: Math.min(shape.size, Math.min(b.width, b.height) / (Math.SQRT2 * (0.5 + q) + 1)),
    };
}
export function cloudRuns(shape, states, now, animate = true) {
    if (shape.points.length < 2)
        return [];
    if (shape.kind === 'rectangle') {
        const b = bounds(shape.points);
        if (Math.min(b.width, b.height) < 0.001)
            return [];
    }
    // Depth is stored on the legacy 2–40 scale; the UI presents roundness.
    // Keep a usable curve aspect ratio even at either control extreme.
    shape = {
        ...shape,
        depth: shape.size * (0.24 + 0.4 * clamp(shape.depth / 40, 0, 1)),
    };
    if (shape.kind === 'circle' || shape.kind === 'ellipse')
        return ellipseRuns(shape, states, now, animate);
    const closed = shape.kind !== 'polyline' && shape.kind !== 'freehand';
    const clearance = shape.clearance ??
        shape.points.map((_, i) => clearanceAt(shape.points, i, closed));
    const scales = clearance.map((d) => Math.min(1, d / (3 * (shape.size / 2 + shape.depth))));
    const rectFit = shape.kind === 'rectangle' ? rectangleFit(shape) : undefined;
    const styles = scales.map((scale) => ({
        ...shape,
        size: rectFit?.width ?? shape.size * scale,
        depth: rectFit
            ? (shape.depth * rectFit.width) / shape.size
            : shape.depth * scale,
    }));
    const cornerRuns = shape.points.map((p, i) => {
        const style = styles[i];
        const id = `${shape.id}:corner:${i}`;
        const convex = corner(style, i);
        const signedBend = (shape.bends?.[i] ?? bendAt(shape.points, i)) * shape.side;
        if (signedBend >= 0.24)
            return { id, d: path([convex]), lobes: [convex] };
        const bend = shape.bends?.[i] ?? bendAt(shape.points, i), a = shape.angles[i] - bend / 2, b = shape.angles[i] + bend / 2;
        const prev = {
            id,
            d: '',
            lobes: [
                arc(add(p, { x: Math.cos(a), y: Math.sin(a) }, -style.size), p, style.depth, shape.side),
            ],
        };
        const next = {
            id,
            d: '',
            lobes: [
                arc(p, add(p, { x: Math.cos(b), y: Math.sin(b) }, style.size), style.depth, shape.side),
            ],
        };
        // The inward branch ends at the valley; a tail here would cross the
        // opposite branch. The outgoing lobe owns the corner's trailing end.
        prev.lobes = prev.lobes.map((l) => ({
            ...l,
            end: l.baseEnd,
            controls: l.controls.slice(0, 6),
        }));
        joinConcave(prev, next);
        const join = prev.lobes.at(-1).end;
        const shift = { x: p.x - join.x, y: p.y - join.y };
        const move = (v) => add(v, shift);
        const lobes = [...prev.lobes, ...next.lobes].map((l) => ({
            ...l,
            start: move(l.start),
            end: move(l.end),
            apex: move(l.apex),
            baseEnd: l.baseEnd ? move(l.baseEnd) : undefined,
            controls: l.controls.map(move),
        }));
        if (signedBend <= -0.48)
            return { id, d: path(lobes), lobes };
        // Keep every outward corner a full crown. Begin the continuous change to
        // a valley only after the vertex turns inward; both patches keep its anchor.
        const cc = cubics(convex), from = [...split(cc[0], 0.5), ...split(cc[1], 0.5), cc[2]], to = lobes.flatMap(cubics);
        if (to.length === 5) {
            const f = clamp(-signedBend / 0.48, 0, 1), t = f * f * (3 - 2 * f);
            const controls = from.flatMap((c, j) => c.slice(1).map((p, k) => mix(p, to[j][k + 1], t)));
            const l = {
                ...convex,
                start: mix(convex.start, lobes[0].start, t),
                end: controls.at(-1),
                baseEnd: mix(convex.baseEnd, lobes.at(-1).baseEnd, t),
                controls,
            };
            return { id, d: path([l]), lobes: [l] };
        }
        return { id, d: path(lobes), lobes };
    });
    // Before close corners overlap, let their facing halves share one arch.
    // The opposite halves and both visible vertices stay fixed. Begin early
    // enough that the intervening row can shrink away without a clipping jump.
    // Open paths dock only internal corners and follow their signed bend.
    if (shape.kind === 'polygon' || !closed) {
        for (let i = closed ? 0 : 1; i < shape.points.length - (closed ? 0 : 2); i++) {
            const j = (i + 1) % shape.points.length;
            const L = dist(shape.points[i], shape.points[j]), f = clamp(((closed ? 2.4 : 2) * shape.size - L) /
                ((closed ? 1.2 : 0.8) * shape.size), 0, 1), t = f * f * (3 - 2 * f);
            if (!t)
                continue;
            const prev = cornerRuns[i], next = cornerRuns[j];
            const flatten = (run) => ({
                ...run.lobes[0],
                end: run.lobes.at(-1).end,
                baseEnd: run.lobes.at(-1).baseEnd,
                controls: run.lobes.flatMap((l) => l.controls),
            });
            const a = flatten(prev), b = flatten(next), A = shape.points[i], B = shape.points[j];
            // Collapsed curves can have several coincident control points. The
            // corner layout, not the first matching point, identifies its anchor.
            const aIndex = a.controls.length === 9 ? 2 : a.controls.length === 15 ? 5 : -1;
            const anchorIndex = b.controls.length === 9 ? 2 : b.controls.length === 15 ? 5 : -1;
            if (aIndex < 0 ||
                anchorIndex < 0 ||
                dist(a.controls[aIndex], A) > 1e-6 ||
                dist(b.controls[anchorIndex], B) > 1e-6)
                continue;
            const u = { x: (B.x - A.x) / (L || 1), y: (B.y - A.y) / (L || 1) }, n = { x: u.y * shape.side, y: -u.x * shape.side };
            const alignment = (dx, dy) => (dx * u.x + dy * u.y) / Math.max(1e-9, Math.hypot(dx, dy));
            const facing = Math.min(alignment(a.controls[aIndex + 1].x - A.x, a.controls[aIndex + 1].y - A.y), alignment(B.x - b.controls[anchorIndex - 1].x, B.y - b.controls[anchorIndex - 1].y));
            // When the span folds back, a deep arch can brush the preceding curve.
            // Reduce only its bow; keep docking active through coincident vertices.
            const g = clamp(facing / 0.5, 0, 1), bowScale = 0.15 + 0.85 * g * g * (3 - 2 * g);
            const tangent = (dx, dy) => {
                const longitudinal = dx * u.x + dy * u.y, transverse = dx * n.x + dy * n.y;
                return clamp(transverse / Math.max(1e-9, 0.2 * Math.hypot(dx, dy), longitudinal), -1, 1);
            };
            const ka = tangent(a.controls[aIndex + 1].x - A.x, a.controls[aIndex + 1].y - A.y);
            const kb = tangent(B.x - b.controls[anchorIndex - 1].x, B.y - b.controls[anchorIndex - 1].y);
            // Endpoint tangents alone can cancel the arch and leave a flat join.
            // Keep an outward bow, limited by the space between the two vertices.
            const bow = Math.min(0.35 * L, 1.35 * shape.depth);
            // Reversing an open line reverses its bend, but not its chosen cloud side.
            // Follow that bend smoothly so the bridge cannot fold into the next crown.
            const archSign = closed
                ? 1
                : Math.tanh(3 *
                    ((shape.bends?.[i] ?? bendAt(shape.points, i)) +
                        (shape.bends?.[j] ?? bendAt(shape.points, j))) *
                    shape.side);
            const curve = [
                A,
                add(add(A, u, L / 3), n, archSign * bowScale * Math.max(bow, (ka * L) / 3)),
                add(add(B, u, -L / 3), n, archSign * bowScale * Math.max(bow, (-kb * L) / 3)),
                B,
            ];
            const [left, right] = split(curve, 0.5), dock = left[3];
            const leftCount = (a.controls.length - aIndex - 1) / 3 - 1;
            const leftControls = (leftCount === 2 ? split(left, 0.5) : [left]).flatMap((c) => c.slice(1));
            const aa = {
                ...a,
                baseEnd: mix(a.baseEnd, dock, t),
                end: mix(a.end, dock, t),
                controls: a.controls.map((p, k) => k <= aIndex
                    ? p
                    : mix(p, k < a.controls.length - 3 ? leftControls[k - aIndex - 1] : dock, t)),
            };
            const prefix = (anchorIndex === 5 ? split(right, 0.5) : [right]).flatMap((c) => c.slice(1));
            const bb = {
                ...b,
                start: mix(b.start, dock, t),
                controls: b.controls.map((p, k) => k <= anchorIndex ? mix(p, prefix[k], t) : p),
            };
            const repack = (original, flat) => {
                let offset = 0, start = flat.start;
                return original.map((old, k) => {
                    const controls = flat.controls.slice(offset, offset + old.controls.length);
                    offset += old.controls.length;
                    const l = {
                        ...old,
                        start,
                        controls,
                        end: controls.at(-1),
                        baseEnd: k === original.length - 1 ? flat.baseEnd : old.baseEnd,
                    };
                    start = l.end;
                    return l;
                });
            };
            prev.lobes = repack(prev.lobes, aa);
            prev.d = path(prev.lobes);
            next.lobes = repack(next.lobes, bb);
            next.d = path(next.lobes);
        }
    }
    // A sharply folded tip can loop or form a bulbous return. Blend it into one
    // full crown at the same visible anchor, then share the docking change only
    // with nearby crowns. Keep the original row fit so distant paint stays fixed.
    const oldDocks = cornerRuns.map((r) => ({
        start: r.lobes[0].start,
        end: r.lobes.at(-1).baseEnd ?? r.lobes.at(-1).end,
    }));
    const shifts = shape.points.map(() => ({
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
    }));
    if (!closed)
        for (let i = 1; i < shape.points.length - 1; i++) {
            const p = shape.points[i], A = shape.points[i - 1], B = shape.points[i + 1];
            const la = dist(A, p), lb = dist(p, B);
            const ua = {
                x: (p.x - A.x) / Math.max(la, 1e-9),
                y: (p.y - A.y) / Math.max(la, 1e-9),
            };
            const ub = {
                x: (B.x - p.x) / Math.max(lb, 1e-9),
                y: (B.y - p.y) / Math.max(lb, 1e-9),
            };
            const bend = Math.atan2(ua.x * ub.y - ua.y * ub.x, ua.x * ub.x + ua.y * ub.y);
            const fold = Math.acos(clamp(ua.x * ub.x + ua.y * ub.y, -1, 1));
            const turnSign = Math.sign(shape.bends?.[i] ?? bend) || shape.side;
            const turnWeight = clamp(Math.abs(shape.bends?.[i] ?? bend) / 0.48, 0, 1);
            const room = Math.min(dist(i === 1 ? shape.points[i - 1] : oldDocks[i - 1].end, oldDocks[i].start), dist(oldDocks[i].end, i === shape.points.length - 2
                ? shape.points[i + 1]
                : oldDocks[i + 1].start));
            const fit = clamp(room / (0.5 * shape.size), 0, 1);
            const f = clamp((fold - 2) / 0.6, 0, 1), t = fit *
                fit *
                (3 - 2 * fit) *
                f *
                f *
                (3 - 2 * f) *
                turnWeight *
                turnWeight *
                (3 - 2 * turnWeight) *
                clamp(Math.min(la, lb) / (0.1 * shape.size), 0, 1);
            if (!t)
                continue;
            const nx = ua.x - ub.x, ny = ua.y - ub.y;
            const orientation = Math.atan2(nx * turnSign, -ny * turnSign);
            const target = corner({
                ...styles[i],
                side: turnSign,
                angles: shape.angles.map((a, k) => (k === i ? orientation : a)),
            }, i);
            const run = cornerRuns[i], old = run.lobes.flatMap(cubics), tc = cubics(target);
            const targetCubics = old.length === 5
                ? [...split(tc[0], 0.5), ...split(tc[1], 0.5), tc[2]]
                : tc;
            if (old.length !== targetCubics.length)
                continue;
            const l = {
                ...target,
                start: mix(old[0][0], target.start, t),
                end: mix(old.at(-1)[3], target.end, t),
                baseEnd: mix(oldDocks[i].end, target.baseEnd, t),
                controls: old.flatMap((c, j) => c.slice(1).map((v, k) => mix(v, targetCubics[j][k + 1], t))),
            };
            run.lobes = [l];
            run.d = path([l]);
            shifts[i] = {
                start: {
                    x: l.start.x - oldDocks[i].start.x,
                    y: l.start.y - oldDocks[i].start.y,
                },
                end: {
                    x: l.baseEnd.x - oldDocks[i].end.x,
                    y: l.baseEnd.y - oldDocks[i].end.y,
                },
            };
        }
    const corners = oldDocks;
    const result = [];
    for (let i = 0; i < shape.points.length; i++) {
        const hasCorner = closed || (i > 0 && i < shape.points.length - 1);
        if (hasCorner)
            result.push(cornerRuns[i]);
        if (!closed && i === shape.points.length - 1)
            break;
        const j = (i + 1) % shape.points.length;
        const start = !closed && i === 0 ? shape.points[i] : corners[i].end;
        const end = !closed && j === shape.points.length - 1
            ? shape.points[j]
            : corners[j].start;
        const id = `${shape.id}:edge:${i}`, s = stepCount(states.get(id), dist(start, end) / shape.size, now, animate);
        states.set(id, s);
        // A short neighboring edge may need a smaller corner, but it must not
        // shrink this whole row when this edge has room for full-size crowns.
        const scale = rectFit
            ? rectFit.width / shape.size
            : Math.max(Math.sqrt(styles[i].size * styles[j].size) / shape.size, Math.min(1, dist(shape.points[i], shape.points[j]) /
                (3 * (shape.size / 2 + shape.depth))));
        let shortCap = 0;
        if (shape.kind === 'polygon' && dist(start, end) < shape.size * scale) {
            const actualI = bendAt(shape.points, i) * shape.side;
            const actualJ = bendAt(shape.points, j) * shape.side;
            shortCap =
                smooth((Math.min((shape.bends?.[i] ?? actualI / shape.side) * shape.side, actualI) -
                    0.24) /
                    0.24) *
                    smooth((Math.min((shape.bends?.[j] ?? actualJ / shape.side) * shape.side, actualJ) -
                        0.24) /
                        0.24) *
                    smooth((Math.PI - Math.abs(actualI)) / 0.4) *
                    smooth((Math.PI - Math.abs(actualJ)) / 0.4);
        }
        const run = runBetween(id, start, end, { ...shape, size: shape.size * scale, depth: shape.depth * scale }, s, shortCap);
        if (shortCap > 0 && run.lobes.length === 1) {
            const l = run.lobes[0], a = cornerRuns[i].lobes.at(-1), b = cornerRuns[j].lobes[0];
            const baseIndex = a?.baseEnd
                ? a.controls.findIndex((p, k) => k % 3 === 2 && dist(p, a.baseEnd) < 1e-8)
                : -1;
            if (l.controls.length === 9 &&
                baseIndex >= 2 &&
                b?.controls.length >= 3) {
                const L = dist(start, end), u = { x: (end.x - start.x) / L, y: (end.y - start.y) / L };
                const ta = sub(a.baseEnd, a.controls[baseIndex - 1]), tb = sub(b.controls[0], b.start);
                const da = ta.x * u.x + ta.y * u.y, db = tb.x * u.x + tb.y * u.y;
                const forward = Math.min(da / Math.max(1e-9, Math.hypot(ta.x, ta.y)), db / Math.max(1e-9, Math.hypot(tb.x, tb.y)));
                const weight = shortCap *
                    smooth((0.8 - L / Math.max(0.5, shape.size * scale)) / 0.3) *
                    smooth((forward - 0.6) / 0.2);
                if (weight > 0) {
                    const bridge = [
                        start,
                        add(start, ta, L / (3 * da)),
                        add(end, tb, -L / (3 * db)),
                        end,
                    ];
                    const halves = split(bridge, 0.5);
                    const bridgeControls = [
                        ...halves[0].slice(1),
                        ...halves[1].slice(1),
                        end,
                        end,
                        end,
                    ];
                    const controls = l.controls.map((p, k) => mix(p, bridgeControls[k], weight));
                    const next = {
                        ...l,
                        controls,
                        apex: controls[2],
                        end: controls[8],
                        depth: dist(controls[2], mix(start, end, 0.5)),
                    };
                    run.lobes = [next];
                    run.d = path([next]);
                    // This divider belongs to the swallowed row, so retract only its
                    // trailing extension while the two crowns share their bridge.
                    const prev = cornerRuns[i];
                    const tail = {
                        ...a,
                        controls: a.controls.map((p, k) => k <= baseIndex ? p : mix(p, a.baseEnd, weight)),
                    };
                    tail.end = tail.controls.at(-1);
                    prev.lobes = [...prev.lobes.slice(0, -1), tail];
                    prev.d = path(prev.lobes);
                }
            }
        }
        if (!closed && j === shape.points.length - 1 && run.lobes.length) {
            const l = run.lobes.at(-1);
            run.lobes[run.lobes.length - 1] = {
                ...l,
                end: l.baseEnd,
                controls: l.controls.slice(0, 6),
            };
            const length = dist(start, end), u = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
            run.d = path(overlapAligned(run.lobes, u));
        }
        // Shift the existing clipped paint over at most three crown widths.
        // Moving controls as well keeps each join attached throughout the blend.
        if (!closed && run.lobes.length) {
            const ds = i === 0 ? { x: 0, y: 0 } : shifts[i].end, de = j === shape.points.length - 1 ? { x: 0, y: 0 } : shifts[j].start;
            const dx = end.x - start.x, dy = end.y - start.y, L = Math.hypot(dx, dy), range = Math.min(3 * shape.size, L);
            const smooth = (x) => {
                x = clamp(x, 0, 1);
                return x * x * (3 - 2 * x);
            };
            const warp = (p) => {
                const q = ((p.x - start.x) * dx + (p.y - start.y) * dy) / (L || 1);
                const a = smooth(1 - q / range), b = smooth(1 - (L - q) / range);
                return { x: p.x + a * ds.x + b * de.x, y: p.y + a * ds.y + b * de.y };
            };
            if (Math.hypot(ds.x, ds.y) + Math.hypot(de.x, de.y) > 1e-9) {
                run.d = run.d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x, y) => xy(warp({ x: Number(x), y: Number(y) })));
                run.lobes = run.lobes.map((l) => ({
                    ...l,
                    start: warp(l.start),
                    end: warp(l.end),
                    baseEnd: l.baseEnd ? warp(l.baseEnd) : undefined,
                    apex: warp(l.apex),
                    controls: l.controls.map(warp),
                }));
            }
        }
        result.push(run);
    }
    // Align near-parallel branches at a concave join without moving its anchor.
    if (!closed) {
        for (let i = 1; i < result.length; i++) {
            const run = result[i], prev = result[i - 1];
            if (!run.id.includes(':corner:') ||
                !prev.id.includes(':edge:') ||
                run.lobes.length !== 2 ||
                !prev.lobes.length)
                continue;
            const index = Number(run.id.split(':').at(-1));
            if (index <= 0 || index >= shape.points.length - 1)
                continue;
            const shift = shifts[index - 1].end;
            const scope = smooth(Math.hypot(shift.x, shift.y) / (0.1 * shape.size));
            if (!scope)
                continue;
            const incoming = prev.lobes.at(-1), next = run.lobes[0];
            if (incoming.controls.length !== 9 ||
                !incoming.baseEnd ||
                dist(incoming.baseEnd, next.start) > 1e-5)
                continue;
            const a = sub(incoming.controls[4], incoming.baseEnd), b = sub(next.controls[0], next.start);
            const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
            if (Math.min(la, lb) < 1e-8)
                continue;
            const dot = (a.x * b.x + a.y * b.y) / (la * lb);
            const aPoint = shape.points[index - 1], p = shape.points[index], bPoint = shape.points[index + 1];
            const incomingLength = dist(aPoint, p), outgoingLength = dist(p, bPoint);
            const fold = Math.acos(clamp(((p.x - aPoint.x) * (bPoint.x - p.x) +
                (p.y - aPoint.y) * (bPoint.y - p.y)) /
                Math.max(1e-12, incomingLength * outgoingLength), -1, 1));
            const t = scope *
                smooth((dot - 0.85) / 0.1) *
                smooth((-(shape.bends?.[index] ?? 0) * shape.side - 0.48) / 0.24) *
                smooth((2 - fold) / 0.3) *
                smooth(Math.min(incomingLength, outgoingLength) / shape.size);
            if (!t)
                continue;
            const target = add(next.start, a, lb / la);
            run.lobes = [
                {
                    ...next,
                    controls: [
                        mix(next.controls[0], target, t),
                        ...next.controls.slice(1),
                    ],
                },
                ...run.lobes.slice(1),
            ];
            run.d = path(run.lobes);
        }
    }
    return result;
}
function ellipseRuns(shape, states, now, animate) {
    const b = bounds(shape.points), rx = Math.max(0.01, b.width / 2), ry = Math.max(0.01, b.height / 2), cx = b.x + rx, cy = b.y + ry;
    // Arc-length table keeps the scallop spacing even on a long, narrow ellipse.
    const opticalTarget = shape.size *
        Math.min(1, Math.min(b.width, b.height) / (3 * (shape.size / 2 + shape.depth)));
    const target = Math.max(0.5, opticalTarget);
    let radius = Math.max(0, opticalTarget * 0.5 - Math.min(rx, ry) ** 2 / Math.max(rx, ry));
    const samples = [], lengths = [0];
    let length = 0;
    const sampleOutline = () => {
        const ex = Math.max(0.0001, rx - radius), ey = Math.max(0.0001, ry - radius);
        samples.length = 0;
        lengths.length = 1;
        lengths[0] = 0;
        length = 0;
        for (let i = 0; i <= 2048; i++) {
            const t = (i / 2048) * Math.PI * 2;
            const nx = Math.cos(t) / ex, ny = Math.sin(t) / ey, norm = Math.hypot(nx, ny);
            const p = {
                x: cx + ex * Math.cos(t) + (radius * nx) / norm,
                y: cy + ey * Math.sin(t) + (radius * ny) / norm,
            };
            samples.push(p);
            if (i) {
                length += dist(samples[i - 1], p);
                lengths.push(length);
            }
        }
    };
    sampleOutline();
    // Round tips for the crowns actually painted after minimum width/count limits.
    // Recompute the distance table when that width changes the rounded outline.
    for (let pass = 0; pass < 4; pass++) {
        const fittedWidth = Math.max(length / 2048, Math.min(target * 0.88, length / 4)) / 0.88;
        const nextRadius = Math.max(0, fittedWidth * 0.5 - Math.min(rx, ry) ** 2 / Math.max(rx, ry));
        if (Math.abs(nextRadius - radius) < 1e-7)
            break;
        radius = nextRadius;
        sampleOutline();
    }
    const at = (f) => {
        const target = f * length;
        let lo = 0, hi = 2048;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (lengths[mid] < target)
                lo = mid;
            else
                hi = mid;
        }
        return mix(samples[lo], samples[hi], (target - lengths[lo]) / (lengths[hi] - lengths[lo] || 1));
    };
    const id = `${shape.id}:curve`;
    const pitch = Math.max(length / 2048, Math.min(target * 0.88, length / 4)), w = pitch / 0.88;
    const count = Math.max(4, Math.floor(length / pitch + 1e-9)), fraction = Math.max(0, length / pitch - count);
    const eased = fraction ** 3 * (10 + fraction * (-15 + 6 * fraction));
    const correction = (fraction - eased) * pitch;
    const offsets = Array.from({ length: count }, (_, i) => i * pitch + correction * Math.max(0, (i - (count - 3)) / 3));
    if (fraction > 1e-8)
        offsets.push(count * pitch + correction);
    const phase = Math.sin(Math.PI * fraction) ** 2;
    const neighbors = Math.min(5, offsets.length - 1);
    const first = offsets.length - 1 - neighbors;
    let step = Math.min(0.04 * w * phase, Math.max(0, pitch - (length - offsets.at(-1))) / neighbors);
    for (let i = first + 1; i < offsets.length; i++)
        step = Math.min(step, Math.max(0, offsets[i] - offsets[i - 1] - 0.831 * w));
    for (let i = first + 1; i < offsets.length; i++)
        offsets[i] -= step * (i - first);
    const lobes = offsets.map((offset) => {
        const f = offset / length, p = at((f - pitch / (2 * length) + 1) % 1), q = at((f + pitch / (2 * length)) % 1), center = mix(p, q, 0.5), d = dist(p, q), u = {
            x: (q.x - p.x) / Math.max(d, 1e-10),
            y: (q.y - p.y) / Math.max(d, 1e-10),
        };
        return arc(add(center, u, -w / 2), add(center, u, w / 2), (shape.depth * w) / shape.size);
    });
    states.set(id, stepCount(undefined, lobes.length, now, animate));
    return [{ id, d: path(overlapTails(lobes, true)), lobes }];
}
export function moveVertex(shape, index, p) {
    const points = shape.points.map((old, i) => i === index ? { ...p } : { ...old });
    const angles = shape.angles.slice();
    angles[index] = heading(points, index, shape.kind !== 'polyline' && shape.kind !== 'freehand', shape.side);
    const turns = shape.turns.slice();
    turns[index] = turnAt(points, index, shape.kind !== 'polyline' && shape.kind !== 'freehand', shape.side);
    const bends = shape.bends?.slice() ?? shape.points.map((_, i) => bendAt(shape.points, i));
    bends[index] = bendAt(points, index);
    const closed = shape.kind !== 'polyline' && shape.kind !== 'freehand';
    const clearance = shape.clearance?.slice() ??
        shape.points.map((_, i) => clearanceAt(shape.points, i, closed));
    clearance[index] = clearanceAt(points, index, closed);
    return { ...shape, points, angles, turns, bends, clearance };
}
export function exportSvg(shapes, rendered) {
    const paths = rendered
        ? rendered.flatMap(({ shape: s, runs }) => runs.map((r) => ({ r, s })))
        : shapes.flatMap((s) => cloudRuns(s, new Map(), 0, false).map((r) => ({ r, s })));
    const all = paths.flatMap(({ r }) => r.lobes.flatMap((l) => [l.start, l.end, ...l.controls]));
    if (!all.length)
        return '';
    const b = bounds(all), pad = Math.max(...shapes.map((s) => s.stroke)) + 4;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}">${paths.map(({ r, s }) => `<path d="${r.d}" fill="none" stroke="${s.color}" stroke-width="${s.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
}
/** Keep a provisional endpoint on every frame. Samples are spaced behind it,
 * so release uses exactly the same shape as the final pointer move. */
export function freehandPoints(samples, end, size) {
    const spacing = Math.max(24, size * 1.6);
    while (dist(samples.at(-1), end) > spacing * 2) {
        const last = samples.at(-1);
        samples.push(mix(last, end, spacing / dist(last, end)));
    }
    return dist(samples.at(-1), end) < 1e-6
        ? samples.map((p) => ({ ...p }))
        : [...samples.map((p) => ({ ...p })), { ...end }];
}

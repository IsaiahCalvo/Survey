import { cloudRuns, makeShape, moveVertex } from './revisionCloudGeometry.js';

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

// UX 2026-09-09: the approved studio (revision-cloud-tool @ d1abe78) draws a
// new cloud with a 2.5-unit crimson line. A cloud is a border STYLE on the
// rect/ellipse/polygon/polyline tools, whose own defaults (red, 2) exist for
// plain outlines, so the Cloud style carries the studio's paint as ITS default
// and remembers the user's later changes separately (tool preference 'cloud').
// Scallop size is independent of the line width, exactly as in the studio.
export const CLOUD_STYLE_DEFAULTS = Object.freeze({
  strokeColor: '#c42747',
  strokeWidth: 2.5,
  strokeOpacity: 100,
});

// The studio's hit surface: a transparent 18-unit stroke along the crowns, so
// a click or hover on a hump apex lands on the cloud (page units, so it scales
// with zoom exactly like the crowns do).
export const CLOUD_HIT_STROKE_WIDTH = 18;

// Bump -> scallop size, in page units: 14 * Bump (Bump 2 = the studio's 28
// default), capped at the studio's 80 maximum. `strokeWidth` is accepted for
// call-site compatibility but deliberately IGNORED: in the studio the scallop
// size never depends on the line width, and a thick-line floor here made the
// same Bump render different crowns from the studio at wide strokes.
export function cloudRadiusForIntensity(intensity = 2, _strokeWidth = 1, unitScale = 1) {
  const scale = Math.max(0.01, finite(unitScale, 1));
  const level = Math.max(0.25, finite(intensity, 2));
  const size = Math.min(80 * scale, 14 * level * scale);
  return size / 2;
}

// UX 2026-09-09: roundness is stored on the approved engine's legacy 2-40
// scale, which cloudRuns maps to a real depth via `size * (0.24 + 0.4*d/40)`.
// 12 is the value the approved studio build shipped, and the app exposes no
// roundness control, so every cloud - drawn, imported or flattened - must pass
// exactly this constant. Passing a size-relative depth instead is only correct
// at the default 28-unit scallop and makes clouds progressively rounder as the
// scallop grows, so imported clouds stopped matching drawn ones.
const APPROVED_CLOUD_DEPTH = 12;

// The approved engine renders `run.d`, not `run.lobes`: `d` carries the
// overlap-trimmed crowns and their separator tails, while `lobes` is the raw
// pre-trim arc set. Re-reading `d` is what keeps the app pixel-identical to the
// studio, including its 5-decimal rounding. The engine only ever emits
// absolute M and C, so this parser is total for its output.
const parseCloudPathData = (data) => {
  const tokens = String(data).split(/\s+/).filter(Boolean);
  const commands = [];
  let index = 0;
  while (index < tokens.length) {
    const verb = tokens[index];
    const arity = verb === 'M' ? 2 : verb === 'C' ? 6 : -1;
    if (arity < 0 || index + arity >= tokens.length) return null;
    const values = tokens.slice(index + 1, index + 1 + arity).map(Number);
    if (values.some((value) => !Number.isFinite(value))) return null;
    commands.push([verb, ...values]);
    index += arity + 1;
  }
  return commands;
};

// UX 2026-09-09: the Cloud border style is offered on every closed/open SHAPE
// annotation - rectangle, ellipse/circle, polygon and (open) polyline - and
// never on arrow, counter or a single straight line, because a revision cloud
// is a region marker: it has to enclose or trace something. These are the only
// four geometry kinds the approved engine builds runs for, and this map is the
// ONE place a caller's shape name becomes an engine kind so every render path
// (SVG, canvas, pdf-lib flatten, importer) asks for the identical outline.
const CLOUD_ENGINE_KIND = Object.freeze({
  rect: 'rectangle',
  rectangle: 'rectangle',
  square: 'rectangle',
  ellipse: 'ellipse',
  circle: 'ellipse',
  oval: 'ellipse',
  polygon: 'polygon',
  polyline: 'polyline',
});

// Open shapes (polyline) are legal with two vertices; every closed shape needs
// at least three or there is no interior to trace.
const cloudMinimumVertexCount = (engineKind) => (engineKind === 'polyline' ? 2 : 3);

/**
 * The single decision point for "does this annotation draw as a cloud, and
 * with what engine geometry?". Returns null for every shape the Cloud style is
 * not offered on (arrow, counter, single line, triangle, text, ink...) so no
 * render path can grow its own opinion about which shapes may be cloudy.
 *
 * @returns {{ kind: string, intensity: number, unitScale: number }|null}
 */
export function resolveAnnotationCloudSpec(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const rawIntensity = obj?.data?.pdfCloudIntensity;
  if (rawIntensity == null) return null;
  const intensity = Number(rawIntensity);
  if (!Number.isFinite(intensity)) return null;
  // Counters are circles internally; they are a pin, never a region marker.
  if (obj?.data?.type === 'counter') return null;
  const kind = cloudEngineKindForShape(obj?.type);
  if (!kind) return null;
  const spec = {
    kind,
    intensity,
    unitScale: Number.isFinite(Number(obj?.data?.pdfCloudUnitScale))
      ? Number(obj.data.pdfCloudUnitScale)
      : 1,
  };
  // The studio's "move one vertex, the rest stay in place" memory. Only a
  // state built for exactly this vertex list at exactly this scale applies;
  // anything else (a resize, an import, a different point count) falls back
  // to the fresh makeShape fit, which is what the studio does after a resize.
  if (kind === 'polygon' || kind === 'polyline') {
    const state = validCloudVertexState(
      obj?.data?.pdfCloudVertexState,
      Array.isArray(obj?.points) ? obj.points.length : 0,
      Math.abs(finite(obj?.scaleX, 1)),
      Math.abs(finite(obj?.scaleY, 1)),
    );
    if (state) spec.vertexState = state;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Vertex-edit memory (studio parity for single-vertex drags)
//
// In the studio, dragging one vertex calls moveVertex(): it rewrites ONLY the
// dragged vertex's heading / turn / bend / clearance and keeps every other
// vertex's corner exactly as it was, and that shape (with its now-stale
// neighbours) is what stays on screen after release. Rebuilding with makeShape
// instead re-fits both neighbouring corner crowns in frame and snaps them on
// release. The app therefore carries the studio's per-vertex arrays on the
// annotation (data.pdfCloudVertexState) and feeds them back to the engine.
// ---------------------------------------------------------------------------

const isNumberArray = (value, length) => Array.isArray(value)
  && value.length === length
  && value.every((entry) => Number.isFinite(Number(entry)));

/**
 * Returns the stored vertex state when it belongs to a vertex list of
 * `pointCount` points built at |scaleX|/|scaleY|, else null.
 */
export function validCloudVertexState(state, pointCount, scaleX = 1, scaleY = 1) {
  if (!state || typeof state !== 'object' || !(pointCount > 0)) return null;
  if (!isNumberArray(state.angles, pointCount)
    || !isNumberArray(state.turns, pointCount)
    || !isNumberArray(state.bends, pointCount)
    || !isNumberArray(state.clearance, pointCount)) return null;
  const side = Number(state.side);
  if (side !== 1 && side !== -1) return null;
  if (Math.abs(finite(state.scaleX, 1) - scaleX) > 1e-9) return null;
  if (Math.abs(finite(state.scaleY, 1) - scaleY) > 1e-9) return null;
  return {
    angles: state.angles.map(Number),
    turns: state.turns.map(Number),
    bends: state.bends.map(Number),
    clearance: state.clearance.map(Number),
    side,
    scaleX: finite(state.scaleX, 1),
    scaleY: finite(state.scaleY, 1),
  };
}

const vertexStateOfShape = (shape, scaleX, scaleY) => ({
  angles: shape.angles.slice(),
  turns: shape.turns.slice(),
  bends: (shape.bends || []).slice(),
  clearance: (shape.clearance || []).slice(),
  side: shape.side,
  scaleX,
  scaleY,
});

const applyVertexState = (shape, state) => (state
  ? {
      ...shape,
      angles: state.angles.slice(),
      turns: state.turns.slice(),
      bends: state.bends.slice(),
      clearance: state.clearance.slice(),
      side: state.side,
    }
  : shape);

/** The fresh makeShape() state for `points` — what a vertex drag starts from. */
export function cloudVertexStateForPoints(kind, points, scaleX = 1, scaleY = 1) {
  const engineKind = cloudEngineKindForShape(kind) || 'polygon';
  const clean = points.map((point) => ({ x: finite(point?.x), y: finite(point?.y) }));
  return vertexStateOfShape(makeShape(engineKind, clean, 'survey-cloud'), scaleX, scaleY);
}

/**
 * moveVertex() twin: `points`/`state` are the shape at drag start, `point` the
 * dragged vertex's current position. Returns the moved points and the state
 * to store — only entry `index` changes, exactly like the studio.
 */
export function moveCloudVertex(kind, points, state, index, point) {
  const engineKind = cloudEngineKindForShape(kind) || 'polygon';
  const clean = points.map((entry) => ({ x: finite(entry?.x), y: finite(entry?.y) }));
  const base = applyVertexState(makeShape(engineKind, clean, 'survey-cloud'), state);
  const moved = moveVertex(base, index, { x: finite(point?.x), y: finite(point?.y) });
  return {
    points: moved.points,
    state: vertexStateOfShape(moved, finite(state?.scaleX, 1), finite(state?.scaleY, 1)),
  };
}

/** Shape/tool name -> approved-engine geometry kind, or null when unsupported. */
export function cloudEngineKindForShape(shape) {
  const key = String(shape || '').toLowerCase();
  return CLOUD_ENGINE_KIND[key] || null;
}

/**
 * UX 2026-09-09: the toolbar offers Cloud for exactly these contexts, whether
 * the tool is armed before drawing or such an annotation is selected. Kept
 * next to the geometry map so the menu can never drift from what renders.
 */
export function toolSupportsCloudBorderStyle(tool) {
  return cloudEngineKindForShape(tool) != null;
}

// One engine pass: the studio shape for these vertices and its rendered runs.
const buildCloudShapeRuns = (points, intensity, strokeWidth, unitScale, kind, options) => {
  const engineKind = cloudEngineKindForShape(kind) || 'polygon';
  if (!Array.isArray(points) || points.length < cloudMinimumVertexCount(engineKind)) return null;
  // A non-finite vertex must reject rather than collapse to the origin: a
  // silently zeroed corner draws a cloud that spans the whole page.
  if (points.some((point) => (
    !Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))
  ))) return null;
  const clean = points.map((point) => ({ x: finite(point?.x), y: finite(point?.y) }));
  const size = cloudRadiusForIntensity(intensity, strokeWidth, unitScale) * 2;
  const shape = applyVertexState(
    makeShape(engineKind, clean, 'survey-cloud', {
      size,
      depth: APPROVED_CLOUD_DEPTH,
      stroke: Math.max(0.1, finite(strokeWidth, 1)),
    }),
    validCloudVertexState(options?.vertexState, clean.length,
      finite(options?.vertexState?.scaleX, 1), finite(options?.vertexState?.scaleY, 1)),
  );
  const runs = cloudRuns(shape, new Map(), 0, false);
  const outline = [];
  const subpaths = [];
  for (const run of runs) {
    if (!run?.d) continue;
    const parsed = parseCloudPathData(run.d);
    if (!parsed) return null;
    outline.push(...parsed);
    subpaths.push(...splitCloudSubpaths(parsed));
  }
  if (outline.length === 0) return null;
  return { engineKind, shape, runs, outline, subpaths };
};

// Split flat M/C commands into subpaths of points: [p0, c1, c2, p1, c3, c4, p2…]
const splitCloudSubpaths = (commands) => {
  const subpaths = [];
  let current = null;
  for (const command of commands) {
    if (command[0] === 'M') {
      current = [{ x: command[1], y: command[2] }];
      subpaths.push(current);
    } else if (command[0] === 'C' && current) {
      current.push(
        { x: command[1], y: command[2] },
        { x: command[3], y: command[4] },
        { x: command[5], y: command[6] },
      );
    }
  }
  return subpaths.filter((subpath) => subpath.length >= 4);
};

const signedArea = (points) => {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

// Sample a cubic chain so its enclosed (chord-closed) signed area is honest.
const sampleCubicChain = (chain) => {
  const samples = [chain[0]];
  for (let index = 1; index + 2 < chain.length; index += 3) {
    const start = samples[samples.length - 1];
    const [c1, c2, end] = [chain[index], chain[index + 1], chain[index + 2]];
    for (let step = 1; step <= 4; step += 1) {
      const t = step / 4;
      samples.push({
        x: cubicAt(start.x, c1.x, c2.x, end.x, t),
        y: cubicAt(start.y, c1.y, c2.y, end.y, t),
      });
    }
  }
  return samples;
};

const chainToCommands = (chain, close) => {
  const commands = [['M', chain[0].x, chain[0].y]];
  for (let index = 1; index + 2 < chain.length; index += 3) {
    commands.push(['C',
      chain[index].x, chain[index].y,
      chain[index + 1].x, chain[index + 1].y,
      chain[index + 2].x, chain[index + 2].y,
    ]);
  }
  if (close) commands.push(['Z']);
  return commands;
};

/**
 * UX 2026-09-09: professional revision clouds (Drawboard, Bluebeam) fill the
 * whole region bounded by the scalloped OUTLINE, humps included — never just
 * the inner rectangle/ellipse/polygon with hollow crowns. The fill is one
 * nonzero-winding path: the shape body plus every painted crown closed on its
 * chord, all wound the same way so overlaps add up instead of punching holes.
 * Painting it as ONE path is what keeps a translucent fill uniform where body
 * and crowns overlap. Open polylines have no interior and return null.
 */
const cubicPointAt = (cubic, t) => ({
  x: cubicAt(cubic[0].x, cubic[1].x, cubic[2].x, cubic[3].x, t),
  y: cubicAt(cubic[0].y, cubic[1].y, cubic[2].y, cubic[3].y, t),
});

const mixPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// de Casteljau: the part of `cubic` from 0 to t.
const cubicPrefix = (cubic, t) => {
  const a = mixPoint(cubic[0], cubic[1], t);
  const b = mixPoint(cubic[1], cubic[2], t);
  const c = mixPoint(cubic[2], cubic[3], t);
  const d = mixPoint(a, b, t);
  const e = mixPoint(b, c, t);
  return [cubic[0], a, d, mixPoint(d, e, t)];
};

const chainCubics = (chain) => {
  const cubics = [];
  for (let index = 1; index + 2 < chain.length; index += 3) {
    cubics.push([chain[index - 1], chain[index], chain[index + 1], chain[index + 2]]);
  }
  return cubics;
};

// Closest point on a cubic chain to `target`: coarse samples, then a ternary
// refinement on the winning cubic. The engine starts every painted crown ON
// the previous crown (at their crossing, or at its very end), so the distance
// is ~0 in the normal case and the parameter is where that crown gets cut.
const closestOnChain = (cubics, target) => {
  let best = { index: 0, t: 0, distance: Infinity };
  cubics.forEach((cubic, index) => {
    for (let step = 0; step <= 24; step += 1) {
      const t = step / 24;
      const point = cubicPointAt(cubic, t);
      const distance = Math.hypot(point.x - target.x, point.y - target.y);
      if (distance < best.distance) best = { index, t, distance };
    }
  });
  if (!Number.isFinite(best.distance)) return best;
  const cubic = cubics[best.index];
  let lo = Math.max(0, best.t - 1 / 24);
  let hi = Math.min(1, best.t + 1 / 24);
  const at = (t) => {
    const point = cubicPointAt(cubic, t);
    return Math.hypot(point.x - target.x, point.y - target.y);
  };
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (at(m1) < at(m2)) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { index: best.index, t, distance: at(t) };
};

const nearlySame = (a, b) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;

/**
 * UX 2026-09-09: professional revision clouds (Drawboard, Bluebeam) fill the
 * whole region bounded by the scalloped OUTLINE, humps included — never just
 * the inner rectangle/ellipse/polygon with hollow crowns. The fill is ONE
 * nonzero-winding path so a translucent colour stays uniform where its pieces
 * overlap:
 *   1. the closed outer contour — every painted crown, in outline order, cut
 *      exactly where the next painted crown starts on it (the engine's own
 *      crossing points), so the fill edge IS the stroked scallop;
 *   2. every raw crown arc closed on its chord, and
 *   3. the source polygon (rectangles/polygons)
 * as safety pieces wound the same way, so a tight-spacing kink in the contour
 * can never leave a pin-hole. Open polylines have no interior and return null.
 */
const buildCloudFillFromRuns = (built) => {
  if (!built || built.engineKind === 'polyline') return null;
  const { engineKind, shape, runs, subpaths } = built;
  if (subpaths.length === 0) return null;
  const tolerance = Math.max(1e-3, 0.01 * shape.size);

  // 1. Outer contour.
  const contour = [];
  const pushChain = (chain) => {
    if (chain.length === 0) return;
    if (contour.length === 0) {
      contour.push(['M', chain[0].x, chain[0].y]);
    } else if (!nearlySame(contour.__end, chain[0])) {
      contour.push(['L', chain[0].x, chain[0].y]);
    }
    for (const cubic of chainCubics(chain)) {
      contour.push(['C', cubic[1].x, cubic[1].y, cubic[2].x, cubic[2].y, cubic[3].x, cubic[3].y]);
    }
    contour.__end = chain[chain.length - 1];
  };
  for (let index = 0; index < subpaths.length; index += 1) {
    const piece = subpaths[index];
    const next = subpaths[(index + 1) % subpaths.length][0];
    const cubics = chainCubics(piece);
    const hit = closestOnChain(cubics, next);
    if (hit.distance > tolerance) {
      // Not chained (a bridged gap): keep the whole painted piece and let the
      // contour jump straight to the next crown.
      pushChain(piece);
      continue;
    }
    if (hit.index === 0 && hit.t < 1e-6) continue; // next crown starts where this one does
    const kept = [piece[0]];
    for (let cubicIndex = 0; cubicIndex < hit.index; cubicIndex += 1) {
      kept.push(cubics[cubicIndex][1], cubics[cubicIndex][2], cubics[cubicIndex][3]);
    }
    const cut = cubicPrefix(cubics[hit.index], hit.t);
    kept.push(cut[1], cut[2], cut[3]);
    pushChain(kept);
  }
  if (contour.length < 2) return null;
  delete contour.__end;
  contour.push(['Z']);
  const contourPoints = [];
  let cursor = null;
  for (const command of contour) {
    if (command[0] === 'M' || command[0] === 'L') {
      cursor = { x: command[1], y: command[2] };
      contourPoints.push(cursor);
    } else if (command[0] === 'C') {
      const cubic = [cursor, { x: command[1], y: command[2] }, { x: command[3], y: command[4] }, { x: command[5], y: command[6] }];
      for (let step = 1; step <= 4; step += 1) contourPoints.push(cubicPointAt(cubic, step / 4));
      cursor = cubic[3];
    }
  }
  const sign = signedArea(contourPoints) < 0 ? -1 : 1;
  const commands = [...contour];

  // 2. + 3. Safety pieces, wound like the contour.
  const pieces = [];
  for (const run of runs) {
    for (const lobe of run?.lobes || []) {
      if (!lobe?.start || !Array.isArray(lobe.controls) || lobe.controls.length < 6) continue;
      pieces.push([lobe.start, ...lobe.controls.slice(0, 6)]);
    }
  }
  for (const piece of pieces) {
    const area = signedArea(sampleCubicChain(piece));
    if (Math.abs(area) < 0.25) continue;
    const oriented = (area < 0 ? -1 : 1) === sign ? piece : piece.slice().reverse();
    commands.push(...chainToCommands(oriented, true));
  }
  if (engineKind !== 'ellipse' && shape.points.length >= 3) {
    const body = signedArea(shape.points) < 0 === (sign < 0)
      ? shape.points
      : shape.points.slice().reverse();
    commands.push(['M', body[0].x, body[0].y]);
    for (let index = 1; index < body.length; index += 1) commands.push(['L', body[index].x, body[index].y]);
    commands.push(['Z']);
  }
  return commands;
};

/**
 * Both painted cloud paths from one engine pass:
 *   outline — the studio's crowns (absolute M/C only), stroked with fill:none
 *   fill    — the closed scalloped region (M/L/C/Z, nonzero), or null when the
 *             shape is open
 * `options.vertexState` carries the studio's per-vertex arrays for shapes that
 * were edited one vertex at a time (see moveCloudVertex).
 */
export function buildCloudRenderPaths(
  points,
  intensity = 2,
  strokeWidth = 1,
  unitScale = 1,
  kind = 'polygon',
  options = null,
) {
  const built = buildCloudShapeRuns(points, intensity, strokeWidth, unitScale, kind, options);
  if (!built) return null;
  // The fill contour costs a second pass over every crown, so callers that
  // have no visible fill paint ask for the outline alone (options.fill=false).
  return {
    outline: built.outline,
    fill: options?.fill === false ? null : buildCloudFillFromRuns(built),
    // Crown apexes (the outer cusps of the scallops) straight from the
    // engine's lobes - the studio locks polygon vertices to these, and the
    // selection handles sit on them (cloudAnnotationGeometry.cloudSelectionChrome).
    cusps: collectCloudCusps(built.runs),
  };
}

/**
 * Every painted crown's apex, in engine order. `arc()` records the apex it
 * bulged to; a trimmed cap keeps the same control layout, so controls[2] is
 * the same point when a lobe has no apex field.
 */
const collectCloudCusps = (runs) => {
  const cusps = [];
  for (const run of runs || []) {
    for (const lobe of run?.lobes || []) {
      const apex = lobe?.apex
        || (Array.isArray(lobe?.controls) && lobe.controls.length >= 3 ? lobe.controls[2] : null);
      if (!apex || !Number.isFinite(apex.x) || !Number.isFinite(apex.y)) continue;
      const last = cusps[cusps.length - 1];
      if (last && Math.abs(last.x - apex.x) < 1e-6 && Math.abs(last.y - apex.y) < 1e-6) continue;
      cusps.push({ x: apex.x, y: apex.y });
    }
  }
  return cusps;
};

/**
 * Whether a Fabric fill paint would put ink on the page. Shared by every cloud
 * render path so "is this cloud filled?" has one answer (an rgba() with zero
 * alpha or an 8-digit hex ending in 00 is as empty as 'transparent').
 */
export function hasVisibleCloudFill(value) {
  if (value == null) return false;
  const text = String(value).trim().toLowerCase();
  if (text === '' || text === 'none' || text === 'transparent') return false;
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba) return rgba[1] == null || Number(rgba[1]) > 0;
  const hex = text.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/);
  if (hex) {
    const alpha = hex[1].length === 4 ? hex[1].slice(3, 4) : hex[1].slice(6, 8);
    return parseInt(alpha, 16) > 0;
  }
  return true;
}

// This is the sole app entry point for revision-cloud outlines. The approved
// engine emits separate open crowns so its short rounded tails stay intact.
export function buildCloudPathCommands(
  points,
  intensity = 2,
  strokeWidth = 1,
  unitScale = 1,
  kind = 'polygon',
  options = null,
) {
  const built = buildCloudShapeRuns(points, intensity, strokeWidth, unitScale, kind, options);
  return built ? built.outline : null;
}

/** The closed scalloped fill region alone (null for open shapes). */
export function buildCloudFillPathCommands(
  points,
  intensity = 2,
  strokeWidth = 1,
  unitScale = 1,
  kind = 'polygon',
  options = null,
) {
  return buildCloudFillFromRuns(
    buildCloudShapeRuns(points, intensity, strokeWidth, unitScale, kind, options),
  );
}

/** Flat command arrays (M/L/C/Z) -> SVG path data, the way every renderer joins them. */
export function cloudCommandsToPathData(commands) {
  return Array.isArray(commands)
    ? commands.map((segment) => segment.join(' ')).join(' ')
    : '';
}

/**
 * The engine reads an ellipse cloud straight off the bounding box of the
 * points it is handed (revisionCloudGeometry.ellipseRuns), so every caller
 * hands it the same four box corners rather than sampling an outline itself.
 */
export function ellipseCloudPoints(left, top, width, height) {
  const x = finite(left);
  const y = finite(top);
  const w = finite(width);
  const h = finite(height);
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

const cubicAt = (start, c1, c2, end, t) => {
  const mt = 1 - t;
  return mt ** 3 * start + 3 * mt ** 2 * t * c1 + 3 * mt * t ** 2 * c2 + t ** 3 * end;
};

export function getCloudPathBounds(commands) {
  if (!Array.isArray(commands)) return null;
  let cursor = null;
  const points = [];
  for (const command of commands) {
    if (command[0] === 'M') {
      cursor = { x: command[1], y: command[2] };
      points.push(cursor);
    } else if (command[0] === 'C' && cursor) {
      const end = { x: command[5], y: command[6] };
      for (let step = 1; step <= 100; step += 1) {
        const t = step / 100;
        points.push({
          x: cubicAt(cursor.x, command[1], command[3], end.x, t),
          y: cubicAt(cursor.y, command[2], command[4], end.y, t),
        });
      }
      cursor = end;
    }
  }
  if (points.length === 0) return null;
  const round = (value) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return {
    minX: round(Math.min(...points.map((point) => point.x))),
    minY: round(Math.min(...points.map((point) => point.y))),
    maxX: round(Math.max(...points.map((point) => point.x))),
    maxY: round(Math.max(...points.map((point) => point.y))),
  };
}

export function buildStickyNoteGlyphSpec({ width, height, left = 0, top = 0 } = {}) {
  const w = Math.max(1, finite(width, 20));
  const h = Math.max(1, finite(height, 20));
  const size = Math.min(w, h);
  const inset = Math.max(0.5, size * 0.04);
  const radius = Math.max(1.5, size * 0.18);
  const bodyBottom = top + h * 0.76;
  const x0 = left + inset;
  const y0 = top + inset;
  const x1 = left + w - inset;
  const tailLeft = left + w * 0.24;
  const tailRight = left + w * 0.46;
  const bubblePath = [
    `M ${x0 + radius} ${y0}`,
    `L ${x1 - radius} ${y0}`,
    `Q ${x1} ${y0} ${x1} ${y0 + radius}`,
    `L ${x1} ${bodyBottom - radius}`,
    `Q ${x1} ${bodyBottom} ${x1 - radius} ${bodyBottom}`,
    `L ${tailRight} ${bodyBottom}`,
    `L ${tailLeft} ${top + h}`,
    `L ${tailLeft} ${bodyBottom}`,
    `L ${x0 + radius} ${bodyBottom}`,
    `Q ${x0} ${bodyBottom} ${x0} ${bodyBottom - radius}`,
    `L ${x0} ${y0 + radius}`,
    `Q ${x0} ${y0} ${x0 + radius} ${y0}`,
    'Z',
  ].join(' ');
  const lineStart = left + w * 0.25;
  return {
    bubblePath,
    textLines: [0.31, 0.46, 0.61].map((ratio, index) => ({
      x1: lineStart,
      y1: top + h * ratio,
      x2: left + w * (index === 2 ? 0.62 : 0.75),
      y2: top + h * ratio,
    })),
  };
}

export function stickyNoteOutlineColor(value) {
  const text = String(value || '').trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i)?.[1];
  const rgbMatch = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  const channels = hex
    ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => parseInt(part, 16))
    : rgbMatch?.slice(1, 4).map(Number);
  if (!channels?.every(Number.isFinite)) return 'rgba(65, 57, 12, 0.78)';
  const darker = channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel * 0.48))));
  return `rgba(${darker[0]}, ${darker[1]}, ${darker[2]}, 0.78)`;
}

export function isStickyNoteGlyphObject(obj) {
  return obj?.data?.type === 'note'
    && (obj?.data?.pdfNoteGlyph === 'note' || obj?.pdfAnnotationType === 'Text');
}

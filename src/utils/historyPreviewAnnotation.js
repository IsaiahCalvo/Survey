// src/utils/historyPreviewAnnotation.js
//
// History-spotlight preview projection for outline ink.
//
// Since the capsule-eraser cutover (a3380bbf), pen strokes persist as FILLED
// OUTLINE geometry (createProductionPaperInk): `path` holds absolute
// page-space commands, strokeWidth is 0, left/top stay 0, and the object
// carries `polygons` + `paperCenterline` copies of the same geometry.
//
// The History panel's spotlight contract is fabric-shaped: it renders
// `previewAnnotation.path` inside translate(left, top) and falls back to a
// left/top/width/height bounding rect when the path was clamped away
// (documentHistoryService.clampPreviewAnnotation). Feeding it the raw outline
// object breaks both halves — left/top of 0 park the rect fallback at the
// page origin, and the duplicate geometry blows the payload cap that decides
// whether the path survives at all.
//
// projectAnnotationForHistoryPreview() returns a compact fabric-shaped
// preview for outline ink (path rebased to its visual origin, that origin in
// left/top, coordinates rounded to 0.01 page units) and passes every other
// annotation through untouched. Pure module — node --test friendly.

/** True for the post-a3380bbf outline-ink pen/highlighter objects. */
export function isOutlineInkAnnotation(annotation) {
  return Boolean(
    annotation
    && annotation.paperInkGeometry
    && Array.isArray(annotation.path),
  );
}

const round2 = (value) => Math.round(value * 100) / 100;

// Vertex budget for the preview path. Keeps the projected preview under the
// service's 4000-char clamp (documentHistoryService.clampPreviewAnnotation)
// so long strokes stay path-shaped instead of degrading to the rect fallback.
// A glow outline needs nowhere near full fidelity.
const MAX_PREVIEW_PATH_VERTICES = 180;

// Decimate an M/L/Z command list ring-aware: keep every stride-th vertex of
// each ring (always its first + last), preserving M starts and Z closes.
function decimatePathCommands(path, maxVertices) {
  const totalVertices = path.reduce((n, cmd) => (
    Array.isArray(cmd) && cmd.length >= 3 ? n + 1 : n
  ), 0);
  if (totalVertices <= maxVertices) return path;
  const stride = Math.ceil(totalVertices / maxVertices);
  const out = [];
  let ring = [];
  const flushRing = (closed) => {
    if (ring.length) {
      const kept = ring.filter((_, i) => i === 0 || i === ring.length - 1 || i % stride === 0);
      out.push(...kept);
      if (closed) out.push(['Z']);
    }
    ring = [];
  };
  for (const cmd of path) {
    if (!Array.isArray(cmd)) continue;
    if (cmd[0] === 'Z') { flushRing(true); continue; }
    if (cmd[0] === 'M') flushRing(false);
    ring.push(cmd);
  }
  flushRing(false);
  return out;
}

function boundsOfPathCommands(path) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of path) {
    if (!Array.isArray(command)) continue;
    for (let i = 1; i + 1 < command.length; i += 2) {
      const x = Number(command[i]);
      const y = Number(command[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Project an annotation into the compact preview shape the History spotlight
 * consumes. Outline ink is rebased + slimmed; everything else is returned
 * as-is (the caller keeps its existing clone/clamp pipeline).
 *
 * @param {object|null|undefined} annotation  serialized annotation object
 * @returns {object|null}
 */
export function projectAnnotationForHistoryPreview(annotation) {
  if (!annotation) return null;
  if (!isOutlineInkAnnotation(annotation)) return annotation;
  const bounds = boundsOfPathCommands(annotation.path);
  if (!bounds) return null;
  const path = decimatePathCommands(annotation.path, MAX_PREVIEW_PATH_VERTICES).map((command) => {
    if (!Array.isArray(command)) return command;
    const rebased = [command[0]];
    for (let i = 1; i + 1 < command.length; i += 2) {
      rebased.push(round2(Number(command[i]) - bounds.minX), round2(Number(command[i + 1]) - bounds.minY));
    }
    return rebased;
  });
  const preview = {
    type: 'path',
    path,
    left: round2(bounds.minX),
    top: round2(bounds.minY),
    width: round2(bounds.maxX - bounds.minX),
    height: round2(bounds.maxY - bounds.minY),
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    strokeWidth: 0,
    // Legacy fabric ink carried strokeUniform: true; the spotlight maps it to
    // vector-effect: non-scaling-stroke so the glow's halo stays a constant
    // screen width across zoom (its size tolerance is zoom-independent).
    strokeUniform: true,
  };
  // Context-restore fallbacks (historyContextRestore.js reads these off the
  // preview for rows without a uiContext stamp) — carry them when present.
  for (const key of ['regionId', 'moduleId', 'spaceId']) {
    if (annotation[key] != null) preview[key] = annotation[key];
  }
  return preview;
}

// RULED 2026-09-28 owner: History option A. The "Before" copy a History row
// keeps of an edited mark (for the Before / After peek) is only what the ghost
// needs: where it was, its size, turn and color — plus its outline when that
// is small. Keeps History rows small (Supabase storage, refresh downloads,
// the device cache) and under the 12 KB row trim.
const PREVIEW_BEFORE_SHAPE_CHARS = 1500;
const PREVIEW_BEFORE_KEYS = ['type', 'tool', 'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
  'originX', 'originY', 'x1', 'y1', 'x2', 'y2', 'stroke', 'fill', 'strokeWidth', 'strokeUniform', 'pathOffset'];
export function slimHistoryPreviewBefore(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;
  const out = {};
  for (const key of PREVIEW_BEFORE_KEYS) {
    if (annotation[key] !== undefined) out[key] = annotation[key];
  }
  const data = annotation.data || {};
  const slimData = {};
  for (const key of ['type', 'tool', 'color', 'strokeColor', 'fillColor']) {
    if (data[key] !== undefined) slimData[key] = data[key];
  }
  if (data.style?.fontColor !== undefined) slimData.style = { fontColor: data.style.fontColor };
  if (Object.keys(slimData).length) out.data = slimData;
  for (const key of ['path', 'points']) {
    if (!Array.isArray(annotation[key])) continue;
    try {
      if (JSON.stringify(annotation[key]).length <= PREVIEW_BEFORE_SHAPE_CHARS) out[key] = annotation[key];
    } catch (_err) { /* skip the outline */ }
  }
  return out;
}

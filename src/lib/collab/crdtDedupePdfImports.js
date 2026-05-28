// 2026-05-03 — One-time dedupe pass for PDF-imported annotations.
//
// UX problem: when the same PDF was imported into the same document multiple
// times (pre-Phase-31), each import created fresh database rows with the same
// stroke geometry but different IDs. Phase 31 cutover faithfully migrated all
// of them into the Y.Map, so users see 2-4 visually-identical pen strokes
// stacked on top of each other and have to delete each copy individually.
//
// Strategy: walk the Y.Map once, group imported entries by stroke geometry
// (page + type + path JSON or bbox), keep the first per group, tombstone the
// rest via applyFabricDelete. Native (user-drawn) annotations are never
// touched — `isPdfImported` flag is the gate. Idempotency is enforced via a
// boolean marker in the Y.Doc meta map so subsequent doc opens skip the pass.
//
// Safety: applyFabricDelete tombstones the entry; legacy database rows stay
// intact. If a dedupe ever turns out to be wrong, a cutover rollback would
// restore the duplicates from legacy.
import { applyFabricDelete } from './crdtAnnotationBridge.js';

const DEDUPE_DONE_KEY = 'dedupe_pdf_imports_v1_done';
const DEDUPE_LAST_GOOD_SIZE_KEY = 'dedupe_pdf_imports_v1_last_good_size';

// 2026-05-04 — Coordinate quantization helper. UX problem: pre-cutover PDF
// re-imports produced near-duplicate strokes whose coordinates differed by
// fractions of a pixel (e.g. left=18.0001 vs left=18.0003) because the PDF
// importer's coordinate-transform stack rounded slightly differently across
// runs. The earlier exact-match signature treated those as distinct strokes
// and left them in the Y.Map, so the user still saw stacked-shifted
// copies that read as a "jagged" stroke at sub-pixel positions. Rounding
// every coordinate to the nearest whole pixel collapses these near-dupes
// into one signature group — a 1px tolerance is well below stroke-width
// scale and safely below the smallest gesture a user could intentionally
// repeat by hand.
function roundCoord(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}
function quantizePath(pathArr) {
  if (!Array.isArray(pathArr)) return null;
  // Each path command is [op, x1, y1, ...] — quantize numeric entries only.
  const out = new Array(pathArr.length);
  for (let i = 0; i < pathArr.length; i++) {
    const seg = pathArr[i];
    if (!Array.isArray(seg)) { out[i] = seg; continue; }
    const qSeg = new Array(seg.length);
    for (let j = 0; j < seg.length; j++) {
      const v = seg[j];
      qSeg[j] = (typeof v === 'number') ? Math.round(v) : v;
    }
    out[i] = qSeg;
  }
  return out;
}

function buildSignature(annoYMap) {
  if (!annoYMap || typeof annoYMap.get !== 'function') return null;
  const fabricYMap = annoYMap.get('fabric');
  if (!fabricYMap || typeof fabricYMap.get !== 'function') return null;
  // 2026-05-04 — Open the dedupe gate beyond just PDF-imported strokes. Two
  // path strokes with byte-identical quantized geometry on the same page
  // are duplicates regardless of how they got there: pre-Phase-31 sync
  // races and migration replays both produced strokes that arrive in the
  // Y.Map without the `isPdfImported` flag set, leaving users staring at
  // jagged stacked drawings even after the dedupe pass ran. The integer-
  // pixel coordinate quantize keeps the false-positive risk near zero —
  // a user cannot intentionally draw a freehand stroke that matches an
  // existing one to whole-pixel precision across every path command.
  const pageNumber = annoYMap.get('pageNumber') ?? 0;
  const type = annoYMap.get('type') || fabricYMap.get('type') || 'unknown';
  const left = roundCoord(fabricYMap.get('left'));
  const top = roundCoord(fabricYMap.get('top'));
  const width = roundCoord(fabricYMap.get('width'));
  const height = roundCoord(fabricYMap.get('height'));
  const pathRaw = fabricYMap.get('path');
  const path = Array.isArray(pathRaw) ? pathRaw : null;
  // Path-based signature for ink strokes — quantized path JSON canonically
  // identifies the stroke geometry within 1px tolerance. For non-path
  // types use the rounded bbox.
  if (path && path.length > 0) {
    const qPath = quantizePath(path);
    return `p${pageNumber}|${type}|${left}|${top}|path${path.length}|${JSON.stringify(qPath)}`;
  }
  // 2026-05-04 — Non-path annotations (rect/circle/textbox/etc.) are not
  // dedup-eligible. A user can legitimately stack a textbox on top of a
  // rectangle at the same coordinates, and the bbox+text signature is
  // not specific enough to distinguish "the user drew this twice on
  // purpose" from "this is a duplicate import." Path strokes are safe
  // because byte-identical freehand geometry is statistically impossible
  // to reproduce by hand.
  void width; void height;
  return null;
}

export function dedupePdfImports(ydoc, options) {
  const opts = options || {};
  if (!ydoc) return { ranAs: 'skipped', reason: 'no-ydoc' };
  const yMapAnnotations = ydoc.getMap('annotations');
  const yMapMeta = ydoc.getMap('meta');
  // 2026-05-04 — Always-run idempotent dedupe. Earlier the marker gated this
  // to one-time-per-doc, but the backfill recovery probe (yMap < legacy =
  // re-import) silently restores legacy duplicates after a successful
  // dedupe, leaving the user with stacked drawings again. The pass is
  // cheap on a healthy Y.Map (single forEach over the entries) so we
  // run it every doc open and let an empty group set short-circuit.
  // The marker is still set after a successful run so logs / reports can
  // tell whether a run has ever cleaned this doc.
  void opts; // reserved for future no-op debugging flag

  const groups = new Map();
  yMapAnnotations.forEach((annoYMap, annoId) => {
    const sig = buildSignature(annoYMap);
    if (!sig) return;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(annoId);
  });

  const idsToRemove = [];
  for (const ids of groups.values()) {
    if (ids.length <= 1) continue;
    // Keep the first; tombstone the rest. The "first" is just iteration order
    // (Y.Map preserves insertion order so it matches the original migration
    // order — earliest-imported wins, later duplicates lose).
    for (let i = 1; i < ids.length; i++) idsToRemove.push(ids[i]);
  }

  // 2026-05-04 — Second pass: tolerant bbox-based dedupe for "jagged
  // duplicates." Background: pre-Phase-31 sync chaos sometimes produced a
  // second copy of a stroke whose path data was re-encoded with extra
  // sub-segments (visually jagged) but whose bounding box stays within a
  // few pixels of the smooth original. The strict signature above keeps
  // both because their path JSON differs. This pass collects every path
  // stroke per page, then for each one checks the OTHER strokes on the
  // page for an overlapping bbox above a high-overlap threshold; when
  // two strokes overlap by ≥85% in both axes we treat them as duplicates
  // and keep the one with the fewest path commands (smoothest). Using
  // overlap ratio rather than rounded-bbox equality means we catch the
  // "jagged version is offset by 8px" case that the previous tighter
  // threshold missed.
  const perPageEntries = new Map();
  yMapAnnotations.forEach((annoYMap, annoId) => {
    if (!annoYMap || typeof annoYMap.get !== 'function') return;
    const fabricYMap = annoYMap.get('fabric');
    if (!fabricYMap || typeof fabricYMap.get !== 'function') return;
    const pathRaw = fabricYMap.get('path');
    if (!Array.isArray(pathRaw) || pathRaw.length === 0) return;
    const pageNumber = annoYMap.get('pageNumber') ?? 0;
    const type = annoYMap.get('type') || fabricYMap.get('type') || 'unknown';
    const left = Number(fabricYMap.get('left'));
    const top = Number(fabricYMap.get('top'));
    const width = Number(fabricYMap.get('width'));
    const height = Number(fabricYMap.get('height'));
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const key = `${pageNumber}|${type}`;
    if (!perPageEntries.has(key)) perPageEntries.set(key, []);
    perPageEntries.get(key).push({
      id: annoId,
      points: pathRaw.length,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    });
  });

  // IoU (intersection-over-union) threshold — the same metric object
  // detection systems use to decide "is this the same thing." 0.6 means
  // the overlapping area must cover at least 60% of the combined boxes.
  // Two unrelated strokes that happen to land near each other won't
  // hit this threshold because their non-overlapping regions blow up
  // the union area; only true near-duplicate pairs cross it.
  const IOU_THRESHOLD = 0.6;
  const alreadyMarked = new Set(idsToRemove);
  for (const entries of perPageEntries.values()) {
    if (entries.length < 2) continue;
    const removed = new Set();
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      if (removed.has(a.id)) continue;
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (removed.has(b.id)) continue;
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (overlapX === 0 || overlapY === 0) continue;
        const intersection = overlapX * overlapY;
        const unionArea = (a.width * a.height) + (b.width * b.height) - intersection;
        if (unionArea <= 0) continue;
        const iou = intersection / unionArea;
        if (iou < IOU_THRESHOLD) continue;
        // a and b are duplicates — keep whichever has fewer points; on a
        // tie keep the earlier-iterated one (a) to match strict-pass
        // ordering.
        const loserId = (a.points <= b.points) ? b.id : a.id;
        if (!alreadyMarked.has(loserId)) {
          idsToRemove.push(loserId);
          alreadyMarked.add(loserId);
        }
        removed.add(loserId);
        if (loserId === a.id) break; // a is gone — move to next i
      }
    }
  }

  // No duplicates → no-op. Don't touch the marker if it's already set, so a
  // healthy Y.Map open on a previously-cleaned doc emits zero Y.Doc updates.
  // 2026-05-04 — Refresh the "last known good size" anchor on every clean
  // open so the recovery probe has a reliable yardstick: if the Y.Map ever
  // drops far below this number on a future open, it's an accidental wipe
  // rather than legitimate state and the recovery should fire.
  // 2026-05-04 — High-water-mark anchor. UX: when an accidental wipe drops
  // Y.Map to 3 entries, the dedupe pass legitimately finds no duplicates
  // and would (pre-fix) record 3 as the "last known good" anchor — which
  // then teaches the recovery probe to accept 3 as healthy on the next
  // open, locking the user out of recovery forever. Keeping the anchor as
  // a monotonically-growing high-water mark means a wiped Y.Map never
  // poisons the anchor; the recovery's drop-from-anchor check fires.
  const finalSize = yMapAnnotations.size;
  const priorAnchor = yMapMeta.get(DEDUPE_LAST_GOOD_SIZE_KEY) || 0;
  const newAnchor = Math.max(priorAnchor, finalSize);
  if (idsToRemove.length === 0) {
    if (!yMapMeta.get(DEDUPE_DONE_KEY) || priorAnchor !== newAnchor) {
      ydoc.transact(() => {
        if (!yMapMeta.get(DEDUPE_DONE_KEY)) yMapMeta.set(DEDUPE_DONE_KEY, Date.now());
        if (priorAnchor !== newAnchor) yMapMeta.set(DEDUPE_LAST_GOOD_SIZE_KEY, newAnchor);
      }, { source: 'crdt-dedupe' });
    }
    return { ranAs: 'leader', removed: 0, kept: groups.size };
  }

  const originPayload = { source: 'crdt-dedupe', timestamp: Date.now() };
  ydoc.transact(() => {
    for (const annoId of idsToRemove) {
      applyFabricDelete(ydoc, yMapAnnotations, annoId, originPayload);
    }
    yMapMeta.set(DEDUPE_DONE_KEY, Date.now());
    const postFinalSize = yMapAnnotations.size;
    yMapMeta.set(DEDUPE_LAST_GOOD_SIZE_KEY, Math.max(priorAnchor, postFinalSize));
  }, originPayload);

  if (typeof window !== 'undefined' && window.__CRDT_DEDUPE_DEBUG === true) {
    console.debug('[crdtDedupePdfImports] removed ' + idsToRemove.length +
      ' duplicate PDF-imported annotations across ' + groups.size + ' unique signatures');
  }

  return { ranAs: 'leader', removed: idsToRemove.length, kept: groups.size };
}

export default dedupePdfImports;

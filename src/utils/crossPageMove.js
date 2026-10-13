/**
 * crossPageMove.js — drag a picked mark off one page and onto the next
 * (owner, after Test 46, 2026-10-06).
 *
 * Owner: "I should be able to take an annotation and move it onto the next
 * page. Drawboard lets you take an annotation, drag it to the edge of a page,
 * and keep dragging it off the edge. As it goes to the edge it becomes
 * invisible — it falls off the edge — but once 100% of it is off the edge, it
 * snaps onto the next page, and you can do that back and forth."
 *
 * (Measured 2026-10-06: the Drawboard WEB app does not do this — it stops the
 * mark at the page edge and never moves it to another page; the owner's rule
 * is the native app's. scratchpad notes: crossPage/DRAWBOARD-NOTES.md.)
 *
 * The rule, in page units (the SVG viewBox of each page):
 *   - While dragging, the mark follows the pointer with no page clamp and is
 *     clipped by the page it is on (it "falls off the edge").
 *   - When the mark's box is 100% off its page AND the pointer is over another
 *     page, the mark jumps to that page at the same offset from the pointer,
 *     so it keeps following the cursor. Back and forth works the same way.
 *   - The mark keeps its size in page units (never stretched to a page of a
 *     different size).
 *   - Let go on another page: the mark lands there, pulled fully inside it.
 *     Let go in the gap or off the document: it stays on the page it belongs
 *     to (the in-page rule puts it back at that page's edge).
 *   - Survey Markers, Spaces / survey-linked marks, callouts, counters, text
 *     highlights tied to PDF text, imported PDF annotations and locked marks
 *     never cross (they stay clamped to their page).
 *
 * Pure JS (no DOM) except readPageLayers — the Node test runner imports it.
 */
import { commitInkObjectMove, isAbsoluteInkGeometry } from './inkGeometryTransform.js';
import { markIdOf } from './moveCommit.js';
import { canMoveAnnotation } from './annotationFamilyRules.js';

// Kinds of mark that stay on their page for now.
const PAGE_BOUND_DATA_TYPES = new Set([
  'callout',
  'text-markup',
  'counter',
  'survey-marker',
  'surveyMarker',
  'space-region',
  'region',
]);

/** May this one mark be dragged onto another page? */
export function canMarkCrossPages(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (markIdOf(obj) == null) return false; // id-less legacy marks: no safe identity to move
  const data = obj.data || {};
  if (PAGE_BOUND_DATA_TYPES.has(String(data.type || ''))) return false;
  if (String(obj.tool || data.tool || '') === 'survey-marker') return false;
  // Survey / Spaces links (region- or module-scoped marks) stay with their page.
  if (obj.regionId || data.regionId || obj.moduleId || data.moduleId || obj.spaceId || data.spaceId) return false;
  // Imported PDF annotations and stamp proxies keep their page.
  if (obj.isPdfImported || obj.pdfAnnotationId || data.pdfAnnotationId || data.isPdfStampProxy) return false;
  // Locked / movement-locked marks never move (same rule as any drag).
  return canMoveAnnotation(obj);
}

/**
 * May this whole drag cross pages? Only when every moving member is a mark
 * that may cross and nothing in the selection stays behind (callouts, Survey
 * Markers, locked members) — a selection is never split across two pages.
 */
export function canSelectionCrossPages(objects, { selectedCount = null, calloutCount = 0, markerCount = 0 } = {}) {
  const list = Array.isArray(objects) ? objects : [];
  if (list.length === 0) return false;
  if (calloutCount > 0 || markerCount > 0) return false;
  if (selectedCount != null && selectedCount !== list.length) return false;
  return list.every(canMarkCrossPages);
}

/** Client (screen) point -> page units with a 2x3 matrix [a, b, c, d, e, f]. */
export function clientToPagePoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function isPointInPage(point, width, height) {
  return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
}

/** Does any part of the box lie on the page? (Touching an edge does not count.) */
export function boxOverlapsPage(box, width, height) {
  return box.left < width
    && box.left + box.width > 0
    && box.top < height
    && box.top + box.height > 0;
}

/** The one box around several boxes (page units). */
export function unionBox(boxes) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const box of boxes || []) {
    if (!box) continue;
    minX = Math.min(minX, box.left);
    minY = Math.min(minY, box.top);
    maxX = Math.max(maxX, box.left + box.width);
    maxY = Math.max(maxY, box.top + box.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * One pointer frame of a cross-page drag.
 *   pages:      [{ pageNumber, width, height, matrix }] (matrix: client -> page units)
 *   hostPage:   the page the mark is on now
 *   pointer:    { x, y } client
 *   grabOffset: pointer minus the box's top-left at the press (page units)
 *   size:       { width, height } of the box (page units, never changes)
 * Returns { hostPage, box, jumped } — box in hostPage units.
 */
export function resolveCrossPageStep({ pages, hostPage, pointer, grabOffset, size }) {
  const list = Array.isArray(pages) ? pages : [];
  const host = list.find((page) => page.pageNumber === hostPage);
  const boxOn = (page) => {
    const point = clientToPagePoint(page.matrix, pointer.x, pointer.y);
    return {
      point,
      box: { left: point.x - grabOffset.x, top: point.y - grabOffset.y, width: size.width, height: size.height },
    };
  };
  if (!host) return { hostPage, box: null, jumped: false };
  const onHost = boxOn(host);
  if (boxOverlapsPage(onHost.box, host.width, host.height)) {
    return { hostPage, box: onHost.box, jumped: false };
  }
  // 100 % off its page: it jumps to the page under the pointer, if any.
  for (const page of list) {
    if (page.pageNumber === hostPage) continue;
    const onPage = boxOn(page);
    if (isPointInPage(onPage.point, page.width, page.height)) {
      return { hostPage: page.pageNumber, box: onPage.box, jumped: true };
    }
  }
  return { hostPage, box: onHost.box, jumped: false };
}

/** Pull a box fully inside a page; a box bigger than the page is centred on it. */
export function clampBoxInsidePage(box, width, height) {
  const fit = (start, length, limit) => (
    length >= limit ? (limit - length) / 2 : Math.min(Math.max(start, 0), limit - length)
  );
  return { ...box, left: fit(box.left, box.width, width), top: fit(box.top, box.height, height) };
}

/**
 * Where a let-go lands. Another page -> that page, fully inside it.
 * The origin page (or the gap / off the document while still on it) -> null:
 * the ordinary in-page move rule applies.
 */
export function resolveCrossPageDrop({ pages, originPage, hostPage, box }) {
  if (hostPage == null || hostPage === originPage || !box) return null;
  const host = (pages || []).find((page) => page.pageNumber === hostPage);
  if (!host) return null;
  return { pageNumber: hostPage, box: clampBoxInsidePage(box, host.width, host.height) };
}

/**
 * The mark moved by (dx, dy) page units — the same translate the in-page move
 * commit applies (useSVGInteraction): page-space ink moves its path, every
 * other mark moves left / top from its drag-start spot, and a curved line's
 * absolute midpoint rides along.
 */
export function translateMovedMark(obj, start, dx, dy) {
  if (isAbsoluteInkGeometry(obj)) return { ...obj, ...commitInkObjectMove(obj, dx, dy) };
  const moved = {
    ...obj,
    left: (start?.left ?? obj.left ?? 0) + dx,
    top: (start?.top ?? obj.top ?? 0) + dy,
  };
  if (String(obj.type || '').toLowerCase() === 'line' && obj.data?.midpoint) {
    moved.data = {
      ...obj.data,
      midpoint: { x: obj.data.midpoint.x + dx, y: obj.data.midpoint.y + dy },
    };
  }
  return moved;
}

/**
 * The two pages after the move: the marks leave `fromPage` and are added on
 * top of `toPage`, keeping their ids. null when the move is not safe (a mark
 * is gone, or already on the target page) — nothing is then changed.
 * Returns { fromPage, toPage, toIndices }.
 */
export function buildCrossPageMovePlan({ fromPage, toPage, marks }) {
  const fromObjects = Array.isArray(fromPage?.objects) ? fromPage.objects : [];
  const toObjects = Array.isArray(toPage?.objects) ? toPage.objects : [];
  const list = Array.isArray(marks) ? marks : [];
  if (list.length === 0) return null;
  const ids = new Set(list.map((mark) => (mark?.id == null ? null : String(mark.id))));
  if (ids.has(null) || ids.size !== list.length) return null;
  const foundOnFrom = fromObjects.filter((obj) => ids.has(markIdOf(obj)));
  if (foundOnFrom.length !== ids.size) return null;
  if (toObjects.some((obj) => ids.has(markIdOf(obj)))) return null;
  const nextFrom = fromObjects.filter((obj) => !ids.has(markIdOf(obj)));
  const added = list.map((mark) => mark.object);
  const nextTo = [...toObjects, ...added];
  return {
    fromPage: { ...(fromPage || {}), objects: nextFrom },
    toPage: { ...(toPage || {}), objects: nextTo },
    toIndices: added.map((_, k) => toObjects.length + k),
  };
}

/** What renders a carried mark on the page it is hovering over. */
export function crossPageGhostKind(obj) {
  const type = String(obj?.type || '').toLowerCase();
  if (type === 'path' && Array.isArray(obj.path) && obj.path.length > 0) return 'path';
  if (type === 'rect') return 'rect';
  if (type === 'line') return 'line';
  if (type === 'group' && Array.isArray(obj.objects)
    && obj.objects.some((o) => o && ['line', 'polyline', 'path'].includes(String(o.type || '').toLowerCase()))) return 'arrow';
  if (type === 'circle' || type === 'ellipse') return 'ellipse';
  if (type === 'polygon' && Array.isArray(obj.points) && obj.points.length > 0) return 'polygon';
  if (type === 'polyline' && Array.isArray(obj.points) && obj.points.length > 0) return 'polyline';
  if (type === 'textbox' || type === 'i-text' || type === 'text') return 'text';
  return null;
}

/** Every page annotation layer on screen: its page size and client -> page matrix. */
export function readPageLayers(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return [];
  const out = [];
  for (const svg of root.querySelectorAll('svg[data-svg-annotation-layer]')) {
    const pageNumber = Number(svg.getAttribute('data-svg-annotation-layer'));
    const viewBox = svg.viewBox?.baseVal;
    const ctm = svg.getScreenCTM?.();
    if (!Number.isFinite(pageNumber) || !viewBox || !viewBox.width || !ctm) continue;
    const inv = ctm.inverse();
    out.push({ pageNumber, width: viewBox.width, height: viewBox.height, matrix: [inv.a, inv.b, inv.c, inv.d, inv.e, inv.f] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The carried mark's picture on the page it hovers over. Only the drag that
// owns it writes it; each page layer reads its own page's entry.
// ---------------------------------------------------------------------------
let ghost = null;
const listeners = new Set();

export function setCrossPageGhost(next) {
  if (ghost === next) return;
  ghost = next || null;
  listeners.forEach((listener) => listener());
}

export function getCrossPageGhost() {
  return ghost;
}

export function subscribeCrossPageGhost(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function crossPageGhostFor(documentId, pageNumber) {
  return ghost && ghost.pageNumber === pageNumber && (ghost.documentId ?? null) === (documentId ?? null)
    ? ghost
    : null;
}

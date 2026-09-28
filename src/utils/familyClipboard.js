/**
 * familyClipboard.js — ONE clipboard for any selection of the annotation
 * family (w53, 2026-09-28): marks (pen, shapes, lines, text, counters,
 * stamps, imported marks), callouts and Survey Markers, in any mix.
 *
 * UX (owner: "annotations are annotations"; Figma / Bluebeam / Illustrator):
 *   * Cmd+C / Cmd+X / right-click Copy / Cut take the WHOLE selection;
 *   * Cmd+V / right-click Paste drop it with its layout intact (the group's
 *     top-left at the pointer; a repeat paste at the same spot steps down-
 *     right); Duplicate (Cmd+D / right-click) drops a copy 16 page units
 *     down-right of the original without touching the clipboard;
 *   * every pasted item is NEW (fresh id, no import provenance, a Survey
 *     Marker gets no Excel identity), takes the scope of where it lands
 *     (the open Survey module / region, like a new mark), keeps the stacking
 *     order it had among the copied items and lands on top of the page;
 *   * the whole paste / duplicate is ONE save and ONE Undo step.
 *
 * Pure (no React): the viewer resolves page geometry, scope and Survey
 * categories and commits.
 */
import { deepClone } from './deepClone.js';
import { getAnnotationBBox } from './svgBoundingBox.js';
import { translateAnnotationForMove } from './annotationFamilyRules.js';
import { mintPastedCloneIdentity } from './pasteCloneIdentity.js';
import { applyPasteScope } from './annotationCreationCommit.js';
import {
  buildFamilyStack,
  buildPastedSurveyMarker,
  markIdOf,
  stacksForSequence,
  surveyMarkerClipboardEntry,
} from './surveyMarkerFamily.js';

export const DUPLICATE_OFFSET_PAGE_UNITS = 16;

// Import provenance a pasted callout must not keep (the keys
// mintPastedCloneIdentity strips from a pasted mark).
const CALLOUT_PROVENANCE_KEYS = [
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType', 'pdfNativeAnnotationIdentity',
  'pdfImportedAt', 'pdfImportedSource',
];

// The mark's author = the paster, wherever the mark keeps it.
function stampAuthor(object, authorId) {
  object.meta = { ...(object.meta || {}), authorId };
  if (object.authorId !== undefined) object.authorId = authorId;
  if (object.data && typeof object.data === 'object' && object.data.authorId !== undefined) {
    object.data = { ...object.data, authorId };
  }
}

const isCalloutObject = (object) => object?.data?.type === 'callout';

/** A callout's page-unit top-left (arrow tip, knee and text box together). */
function calloutTopLeft(callout, pageWidth, pageHeight) {
  const xs = [callout?.arrowTip?.x, callout?.knee?.x, callout?.textBoxPosition?.x].filter(Number.isFinite);
  const ys = [callout?.arrowTip?.y, callout?.knee?.y, callout?.textBoxPosition?.y].filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return { left: Math.min(...xs) * pageWidth, top: Math.min(...ys) * pageHeight };
}

/**
 * Build the clipboard for a selection on one page.
 * @param {object} input
 *   objects       the page's marks (bottom → top; callouts are projected
 *                 objects with data.type 'callout')
 *   indices       selected mark indexes (callout objects are ignored here)
 *   callouts      [callout record] selected on this page
 *   markers       [{ id, record, categoryName }] selected Survey Markers
 *   pageMarkers   [{ id, stack }] the page's drawn markers (for the order)
 *   pageWidth / pageHeight
 * @returns {{ items: Array, origin: {left, top}, sourcePageNumber } | null}
 *   items (bottom → top): { kind: 'mark', object } | { kind: 'callout',
 *   callout } | { kind: 'marker', entry, categoryName, sourceModuleId }
 */
export function buildFamilyClipboard({
  pageNumber,
  objects = [],
  indices = [],
  callouts = [],
  markers = [],
  pageMarkers = [],
  pageWidth = 612,
  pageHeight = 792,
}) {
  const list = Array.isArray(objects) ? objects : [];
  const pickedIndices = new Set([...indices].filter((i) => Number.isInteger(i) && list[i] && !isCalloutObject(list[i])));
  const calloutById = new Map((callouts || []).filter(Boolean).map((c) => [String(c.id), c]));
  const markerById = new Map((markers || []).filter((m) => m?.record?.bounds).map((m) => [String(m.id), m]));
  const sequence = buildFamilyStack(list, (pageMarkers || []).filter((m) => markerById.has(String(m.id))));
  // Selected markers the page does not draw in a known slot go on top.
  const placed = new Set(sequence.filter((e) => e.kind === 'marker').map((e) => e.id));
  for (const id of markerById.keys()) if (!placed.has(id)) sequence.push({ kind: 'marker', id });
  const items = [];
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  const widen = (left, top, right = left, bottom = top) => {
    if (Number.isFinite(left)) minLeft = Math.min(minLeft, left);
    if (Number.isFinite(top)) minTop = Math.min(minTop, top);
    if (Number.isFinite(right)) maxRight = Math.max(maxRight, right);
    if (Number.isFinite(bottom)) maxBottom = Math.max(maxBottom, bottom);
  };
  for (const entry of sequence) {
    if (entry.kind === 'mark') {
      const object = list[entry.index];
      if (isCalloutObject(object)) {
        const id = String(object?.data?.id ?? '');
        const callout = calloutById.get(id);
        if (!callout) continue;
        items.push({ kind: 'callout', callout: deepClone(callout) });
        const tl = calloutTopLeft(callout, pageWidth, pageHeight);
        if (tl) {
          const right = (Number(callout.textBoxPosition?.x) + (Number(callout.textBoxWidth) || 0)) * pageWidth;
          const bottom = (Number(callout.textBoxPosition?.y) + (Number(callout.textBoxHeight) || 0)) * pageHeight;
          widen(tl.left, tl.top, right, bottom);
        }
        continue;
      }
      if (!pickedIndices.has(entry.index)) continue;
      items.push({ kind: 'mark', object: deepClone(object) });
      const box = getAnnotationBBox(object);
      if (box) widen(box.left, box.top, box.left + (box.width || 0), box.top + (box.height || 0));
      continue;
    }
    const marker = markerById.get(entry.id);
    if (!marker) continue;
    items.push({
      kind: 'marker',
      entry: surveyMarkerClipboardEntry(marker.record),
      categoryName: marker.categoryName ?? null,
      sourceModuleId: marker.record.moduleId ?? null,
    });
    const b = marker.record.bounds;
    widen(Number(b.x), Number(b.y), Number(b.x) + Number(b.width || 0), Number(b.y) + Number(b.height || 0));
  }
  if (items.length === 0) return null;
  return {
    items,
    // The source page's size: callouts store page fractions, rescaled when
    // pasted onto a page of another size so they keep their place in the group.
    pageWidth,
    pageHeight,
    origin: { left: Number.isFinite(minLeft) ? minLeft : 0, top: Number.isFinite(minTop) ? minTop : 0 },
    // The copied group's page-unit box (a paste keeps it on the page).
    extent: Number.isFinite(maxRight) && Number.isFinite(maxBottom) && Number.isFinite(minLeft) && Number.isFinite(minTop)
      ? { left: minLeft, top: minTop, width: maxRight - minLeft, height: maxBottom - minTop }
      : null,
    sourcePageNumber: pageNumber,
  };
}

/**
 * Plan a paste of `clipboard` onto a page, moved by (dx, dy) page units.
 * @param {object} opts
 *   objects        the landing page's marks now
 *   dx, dy         page units
 *   pageWidth / pageHeight
 *   scope          the landing paste scope (applyPasteScope)
 *   newId()        a fresh uuid
 *   authorId       the viewer (stamped on a callout that carries no author)
 *   resolveMarker(item) → { moduleId, categoryId, name, regionId } | null
 *                  where a copied Survey Marker lands (null = skip it)
 *   userId         stamped on new Survey Markers
 *   pageNumber
 * @returns {{ objects, newMarkIds, newCalloutIds, callouts, markers, skippedMarkers }}
 *   objects: the page's marks WITH the new marks appended in the copied order
 *   (callouts come back separately: the viewer projects them into the page);
 *   callouts: new callout records; markers: new marker records (their
 *   `stack` places each among the pasted marks in the copied order).
 */
export function planFamilyPaste(clipboard, {
  objects = [],
  dx = 0,
  dy = 0,
  pageWidth = 612,
  pageHeight = 792,
  scope = null,
  newId = () => globalThis.crypto.randomUUID(),
  authorId = null,
  resolveMarker = () => null,
  userId = null,
  pageNumber,
} = {}) {
  const pasted = [];
  const newMarks = [];
  const newCallouts = [];
  const newMarkers = [];
  let skippedMarkers = 0;
  for (const item of clipboard?.items || []) {
    if (item.kind === 'mark') {
      const clone = translateAnnotationForMove(item.object, dx, dy);
      mintPastedCloneIdentity(clone, newId());
      // A pasted mark is the paster's own new mark (own Undo, own Cut).
      if (authorId) stampAuthor(clone, authorId);
      if (scope) applyPasteScope(clone, scope);
      newMarks.push(clone);
      pasted.push({ kind: 'mark', object: clone });
    } else if (item.kind === 'callout') {
      const source = item.callout;
      // Page fractions of the SOURCE page → page units → fractions of the
      // landing page (another page size keeps the group's layout).
      const srcW = Number(clipboard.pageWidth) || pageWidth || 1;
      const srcH = Number(clipboard.pageHeight) || pageHeight || 1;
      const landW = pageWidth || 1;
      const landH = pageHeight || 1;
      const shift = (pt) => (pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y))
        ? { ...pt, x: (Number(pt.x) * srcW + dx) / landW, y: (Number(pt.y) * srcH + dy) / landH }
        : pt);
      const callout = {
        ...deepClone(source),
        id: `callout-${newId()}`,
        pageNumber,
        ...(source.textBoxPosition ? { textBoxPosition: shift(source.textBoxPosition) } : {}),
        ...(source.knee ? { knee: shift(source.knee) } : {}),
        ...(source.arrowTip ? { arrowTip: shift(source.arrowTip) } : {}),
        ...(!source.arrowTip && source.anchor ? { anchor: shift(source.anchor) } : {}),
      };
      if (Number.isFinite(Number(source.textBoxWidth)) && srcW !== landW) {
        callout.textBoxWidth = (Number(source.textBoxWidth) * srcW) / landW;
      }
      if (Number.isFinite(Number(source.textBoxHeight)) && srcH !== landH) {
        callout.textBoxHeight = (Number(source.textBoxHeight) * srcH) / landH;
      }
      // A NEW native callout: no import provenance (two callouts must never
      // claim one PDF annotation), and the paster's own.
      for (const key of CALLOUT_PROVENANCE_KEYS) delete callout[key];
      if (authorId) callout.meta = { ...(callout.meta || {}), authorId };
      if (scope) applyPasteScope(callout, scope);
      newCallouts.push(callout);
      pasted.push({ kind: 'callout', id: callout.id });
    } else if (item.kind === 'marker') {
      const landing = resolveMarker(item);
      if (!landing) { skippedMarkers += 1; continue; }
      const id = `surveyMarker-${newId()}`;
      const record = buildPastedSurveyMarker(item.entry, {
        id,
        pageNumber,
        dx,
        dy,
        moduleId: landing.moduleId,
        regionId: landing.regionId ?? null,
        categoryId: landing.categoryId,
        name: landing.name,
        userId,
      });
      newMarkers.push(record);
      pasted.push({ kind: 'marker', id });
    }
  }
  return {
    objects: [...(Array.isArray(objects) ? objects : []), ...newMarks],
    newMarkIds: newMarks.map((object) => markIdOf(object)),
    callouts: newCallouts,
    markers: newMarkers,
    pastedOrder: pasted,
    skippedMarkers,
  };
}

/**
 * After the viewer projected the new callouts into the page, put every
 * pasted mark / callout object back into the COPIED order at the top of the
 * page, and give each new Survey Marker the `stack` that places it among
 * them in that order (above every mark that was already on the page).
 * @param {Array} pageObjects  the page after projection
 * @param {Array} pastedOrder  planFamilyPaste(...).pastedOrder
 * @param {Array} markers      planFamilyPaste(...).markers (mutated: stack set)
 * @returns {Array} the page objects, reordered
 */
export function orderPastedFamily(pageObjects, pastedOrder, markers) {
  const list = Array.isArray(pageObjects) ? pageObjects : [];
  const keyOf = (item) => (item.kind === 'mark' ? markIdOf(item.object) : String(item.id));
  const pastedMarkKeys = new Set(pastedOrder.filter((item) => item.kind !== 'marker').map(keyOf));
  const byKey = new Map();
  const rest = [];
  for (const object of list) {
    const key = markIdOf(object);
    if (key != null && pastedMarkKeys.has(key)) byKey.set(key, object);
    else rest.push(object);
  }
  const ordered = [...rest];
  const sequence = rest.map((object) => ({ kind: 'mark', object }));
  for (const item of pastedOrder) {
    if (item.kind === 'marker') {
      sequence.push({ kind: 'marker', id: item.id });
      continue;
    }
    const object = byKey.get(keyOf(item));
    if (!object) continue;
    ordered.push(object);
    sequence.push({ kind: 'mark', object });
  }
  const stacks = stacksForSequence(sequence);
  const now = Date.now();
  for (const record of markers || []) {
    const stack = stacks.get(String(record.id));
    if (stack) record.stack = { ...stack, order: now + stack.order };
  }
  return ordered;
}

// Nightly 'text-review-remove' (Drawboard PDF Review > Remove): drag over
// words and the highlight, underline, squiggle and strike-through on them come
// off. Only the words you drag over lose their marks: a mark that runs past
// the drag is cut back to what is left, and one that is wholly covered goes.
// One save, one Undo step (the caller commits the transaction).
import {
  buildTextMarkupDocumentAction,
  getPdfAnnotationMutationState,
  isTextMarkupAnnotation,
} from './textMarkupGroupTransactions.js';

export const TEXT_REMOVE_TYPES = Object.freeze(['highlight', 'underline', 'squiggly', 'strikeout']);
const MIN_PIECE = 0.5; // page units: thinner leftovers are dropped
const LINE_OVERLAP = 0.5; // share of the shorter line two boxes must share to be one line

const pageObjects = (page) => (Array.isArray(page?.objects) ? page.objects : []);
const num = (value) => Number(value);

/** A quad's box: { left, right, top, bottom }. */
export function quadBox(quad) {
  const xs = [quad?.x1, quad?.x2, quad?.x3, quad?.x4].map(num).filter(Number.isFinite);
  const ys = [quad?.y1, quad?.y2, quad?.y3, quad?.y4].map(num).filter(Number.isFinite);
  if (xs.length < 2 || ys.length < 2) return null;
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const boxQuad = ({ left, right, top, bottom }) => ({
  x1: left, y1: top, x2: right, y2: top, x3: left, y3: bottom, x4: right, y4: bottom,
});

const sameLine = (a, b) => {
  const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
  return shorter > 0 && shared >= shorter * LINE_OVERLAP;
};

/** What is left of a mark's quads once the cut boxes are taken out of each line. */
export function cutQuads(quads, cuts) {
  const out = [];
  let changed = false;
  for (const quad of Array.isArray(quads) ? quads : []) {
    const box = quadBox(quad);
    if (!box) { out.push(quad); continue; }
    let pieces = [{ left: box.left, right: box.right }];
    for (const cut of cuts) {
      if (!sameLine(box, cut) || cut.right <= box.left || cut.left >= box.right) continue;
      changed = true;
      pieces = pieces.flatMap((piece) => {
        if (cut.right <= piece.left || cut.left >= piece.right) return [piece];
        const left = { left: piece.left, right: Math.max(piece.left, cut.left) };
        const right = { left: Math.min(piece.right, cut.right), right: piece.right };
        return [left, right].filter((p) => p.right - p.left >= MIN_PIECE);
      });
    }
    if (pieces.length === 1 && pieces[0].left === box.left && pieces[0].right === box.right) {
      out.push(quad);
    } else {
      pieces.forEach((p) => out.push(boxQuad({ ...p, top: box.top, bottom: box.bottom })));
    }
  }
  return { quads: out, changed };
}

const boundsOf = (quads) => {
  const boxes = quads.map(quadBox).filter(Boolean);
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  return {
    left,
    top,
    width: Math.max(...boxes.map((b) => b.right)) - left,
    height: Math.max(...boxes.map((b) => b.bottom)) - top,
  };
};

/**
 * Takes the review marks off the selected words.
 * `selectionPages`: [{ pageNumber, quads }] (the live text selection).
 * Returns { action, nextByPage, removed, trimmed, selectionGroupIds, ...pdf
 * annotation state } or null when nothing under the drag carried a mark.
 */
export function buildTextMarkupRemoveTransaction(annotationsByPage, selectionPages, { types = TEXT_REMOVE_TYPES } = {}) {
  const previousByPage = annotationsByPage || {};
  const wanted = new Set(types.map((t) => String(t).toLowerCase()));
  const cutsByPage = new Map();
  for (const page of Array.isArray(selectionPages) ? selectionPages : []) {
    const boxes = (page?.quads || []).map(quadBox).filter(Boolean);
    if (!boxes.length) continue;
    const key = Number(page.pageNumber);
    cutsByPage.set(key, [...(cutsByPage.get(key) || []), ...boxes]);
  }
  if (cutsByPage.size === 0) return null;

  const nextByPage = { ...previousByPage };
  const groupIds = new Set();
  let removed = 0;
  let trimmed = 0;
  for (const [pageKey, page] of Object.entries(previousByPage)) {
    const cuts = cutsByPage.get(Number(pageKey));
    if (!cuts) continue;
    let pageChanged = false;
    const objects = [];
    for (const annotation of pageObjects(page)) {
      const type = String(annotation?.data?.markupType || annotation?.exportType || '').toLowerCase();
      if (!isTextMarkupAnnotation(annotation) || !wanted.has(type)) { objects.push(annotation); continue; }
      const { quads, changed } = cutQuads(annotation.data.quads, cuts);
      if (!changed) { objects.push(annotation); continue; }
      pageChanged = true;
      groupIds.add(annotation.data.selectionGroupId);
      if (quads.length === 0) { removed += 1; continue; }
      trimmed += 1;
      // The text range no longer matches the cut quads, so it is dropped (the
      // quads are what every renderer and the export draw from).
      const { textRange: _range, textRangeModel: _model, ...data } = annotation.data;
      objects.push({ ...annotation, ...boundsOf(quads), data: { ...data, quads } });
    }
    if (pageChanged) nextByPage[String(pageKey)] = { ...page, objects };
  }
  if (groupIds.size === 0) return null;
  const action = buildTextMarkupDocumentAction(previousByPage, nextByPage);
  if (!action) return null;
  return {
    action,
    nextByPage,
    removed,
    trimmed,
    removedSelectionGroupIds: [...groupIds],
    selectionGroupIds: [...groupIds],
    ...getPdfAnnotationMutationState(previousByPage, nextByPage),
  };
}

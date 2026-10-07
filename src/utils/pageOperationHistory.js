// Undo / Redo of page changes (owner 2026-10-07, like Drawboard: Ctrl+Z takes
// back a page delete, turn, duplicate, move, paste or blank page).
//
// A page change is ONE step on the viewer's undo timeline (the "legacy" lane,
// interleaved with mark edits by the shared checkpoint counter). The step
// holds no snapshot: Undo runs the change's INVERSE through the same page
// operation path as any page change (hooks/usePageOperations.js: the instant
// page view, the page-addressed state remap, one background pdf-lib rewrite
// and upload), and Redo runs the change again. Because the timeline is strict
// (newest first), every mark step older than a page change is only reached
// after that change was undone, so page numbers always line up again.
//
// Pure: no React, no DOM.

const PAGE_REASON = 'page:';

/** The page step a history meta entry stands for, or null. */
export function pageOperationStepId(meta) {
  const reason = typeof meta?.reason === 'string' ? meta.reason : '';
  if (!reason.startsWith(PAGE_REASON)) return null;
  const id = meta?.context?.pageOperationId;
  return id == null ? null : id;
}

/** The legacy-lane entry (state placeholder + meta) for a page step. */
export function pageOperationCheckpoint(id, operation, checkpointId, now = new Date()) {
  const type = String(operation?.type || 'change');
  return {
    state: { pageOperationStep: id },
    meta: {
      checkpointId,
      createdAt: now.toISOString(),
      reason: `${PAGE_REASON}${type}`,
      context: { pageOperationId: id, pageOperationType: type },
      summary: { mode: 'page-operation', type },
      delta: null,
      snapshotHash: `page-operation:${id}`,
      snapshotBytes: 0,
    },
  };
}

/**
 * The inverse of a page change that was applied as `pdfOperation` (the shape
 * the view and the pdf-lib rewrite ran; a turn's delta includes any old
 * presentation rotation it folded in) to `stateBefore`.
 *   deletedEntry      — for a delete: what the page showed (pageViewEntry)
 *   pageTransformBefore — for a turn: the page's presentation transform before
 * Returns { pdfOperation, stateOperation } or null when it cannot be undone.
 */
export function inversePageOperation(pdfOperation, { stateBefore = null, deletedEntry = null, pageTransformBefore } = {}) {
  const type = pdfOperation?.type;
  const page = (value) => Number(value);
  if (type === 'rotate') {
    const back = { type: 'rotate', page: page(pdfOperation.page), delta: -Number(pdfOperation.delta || 0) };
    return {
      pdfOperation: back,
      stateOperation: { ...back, pageTransformation: pageTransformBefore ?? null },
    };
  }
  if (type === 'move' || type === 'reorder') {
    const back = { type: 'move', from: page(pdfOperation.to), to: page(pdfOperation.from) };
    return { pdfOperation: back, stateOperation: back };
  }
  if (type === 'insert') {
    const back = { type: 'delete', page: page(pdfOperation.afterPage) + 1 };
    return { pdfOperation: back, stateOperation: back };
  }
  if (type === 'duplicate') {
    const back = { type: 'delete', page: page(pdfOperation.page) + 1 };
    return { pdfOperation: back, stateOperation: back };
  }
  if (type === 'copy') {
    const back = { type: 'delete', page: page(pdfOperation.afterPage ?? pdfOperation.page ?? pdfOperation.target) + 1 };
    return { pdfOperation: back, stateOperation: back };
  }
  if (type === 'delete') {
    if (!deletedEntry || !stateBefore) return null;
    const removed = page(pdfOperation.page);
    return {
      pdfOperation: { type: 'restore', afterPage: removed - 1, entry: deletedEntry },
      stateOperation: { type: 'restore', afterPage: removed - 1, from: stateBefore, fromPage: removed },
    };
  }
  return null;
}

/**
 * The inverse of a change to several pages at once (owner 2026-10-07: delete,
 * turn, duplicate, paste or move a selection = ONE Undo step). `steps` are its
 * single-page changes in the order they ran, each { pdfOperation, context }
 * where context is what inversePageOperation needs AT THAT STEP. The inverse
 * runs their inverses newest first, as one batch. null if any step cannot be
 * undone.
 */
export function inversePageOperationSteps(steps = []) {
  const pdfOperations = [];
  const stateOperations = [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const inverse = inversePageOperation(steps[index]?.pdfOperation, steps[index]?.context || {});
    if (!inverse) return null;
    pdfOperations.push(inverse.pdfOperation);
    stateOperations.push(inverse.stateOperation);
  }
  return {
    pdfOperation: { type: 'batch', operations: pdfOperations },
    stateOperation: { type: 'batch', operations: stateOperations },
  };
}

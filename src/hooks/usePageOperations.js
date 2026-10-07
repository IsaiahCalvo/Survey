// usePageOperations — page mutation handlers for the thumbnail sidebar.
//
// Owner 2026-10-01: every page operation (cut, copy, paste, add, delete, move,
// rotate, mirror, reset) must look instant on phone and desktop. So an
// operation is applied OPTIMISTICALLY: the page-addressed app state
// (annotations, survey markers, spaces, bookmarks, page names) is remapped and
// the viewer's in-memory page view (utils/pageViewDocument.js) is updated in
// the same tick, and the expensive part — rewriting the PDF bytes with pdf-lib
// and uploading the new version — runs in the background. Operations that
// arrive while a rewrite is pending are coalesced into ONE rewrite + upload.
// If the rewrite or the upload fails, every operation that was not saved is
// rolled back (state and view) and the user is told.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { showToast } from '../utils/toast';
import { createPageMutationFile } from '../utils/pageMutationFile.js';
import { transformPageState } from '../utils/pageAnnotationReindex.js';
// PERF (KAL-384): pdfPageMutation pulls in pdf-lib (~429 kB). It is loaded in
// a worker (or, as a fallback, imported dynamically) only when a page
// operation is saved, never at first viewer paint.
import { mutatePdfPagesOffThread } from '../utils/pdfPageMutationOffThread.js';
import { inversePageOperation, inversePageOperationSteps } from '../utils/pageOperationHistory.js';
import { applyPageViewOperation, pageViewEntry } from '../utils/pageViewDocument.js';
import {
  batchOperation,
  copyPagesAfter,
  deletePages,
  duplicatePages,
  movePagesNextTo,
  movePagesToIndex,
  normalizePageSelection,
  rotatePages,
} from '../utils/pageSelectionOperations.js';

// Short: long enough that a burst of taps (move down, move down, ...) becomes
// one rewrite, short enough that the upload starts right away.
const FLUSH_DELAY_MS = 150;

const OPERATION_VERBS = {
  delete: 'delete',
  insert: 'add',
  duplicate: 'duplicate',
  copy: 'paste',
  move: 'move',
  reorder: 'move',
  rotate: 'rotate',
  restore: 'restore',
  batch: 'change',
};

// A selection of pages (an array) or one page (a number).
const isPageList = (value) => Array.isArray(value);

// Several single-page steps of a batch run as one pdf-lib pass list.
const flattenOperations = (operations) => operations.flatMap((operation) => (
  operation?.type === 'batch' ? flattenOperations(operation.operations || []) : [operation]
));

const newPageCopyId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `page-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

const deepCopy = (value) => {
  if (value == null) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch { /* fall through */ }
  return JSON.parse(JSON.stringify(value));
};

// The rolled-back marks must be NEW objects: the cloud capture skips a mark
// whose object is the very one it last saw from the document (useAnnotationDoc
// viewer capture), so restoring the old references would leave the shared
// document on the failed operation's page numbers.
function freshCopyOfPageState(state) {
  return {
    ...state,
    annotationsByPage: deepCopy(state.annotationsByPage || {}),
    surveyMarkers: deepCopy(state.surveyMarkers || {}),
    annotations: deepCopy(state.annotations || {}),
  };
}

export function usePageOperations({
  pdfFile,
  onUpdatePDFFile,
  getPageState,
  commitPageState,
  // (operation) => previousView | null — apply the operation to the viewer's
  // page view now; returns what to hand back to restorePageView on rollback.
  applyPageView,
  restorePageView,
  setPageNames,
  setPageTransformations,
  clipboardPage,
  setClipboardPage,
  clipboardType,
  setClipboardType,
  flushDelayMs = FLUSH_DELAY_MS,
}) {
  // Undo / Redo (utils/pageOperationHistory.js): every page change the user
  // makes is kept here by id, with what its inverse needs. commitPageState's
  // third argument tells the viewer which step a commit is ({ id, phase:
  // 'do' | 'undo' | 'redo' }); the viewer puts 'do' steps on its timeline.
  const historyRef = useRef(new Map());
  const historySeqRef = useRef(0);
  // The newest PDF bytes this hook knows about: the prop, or a rewrite of ours
  // that React has not rendered yet. Files we produced never reset the chain.
  const pdfFileRef = useRef(pdfFile);
  const renderedPdfFileRef = useRef(pdfFile);
  const ownFilesRef = useRef(new WeakSet());
  const pageStateRef = useRef(null);
  // The bytes the viewer's document was opened from: a deleted page is put
  // back from them on Undo (its page view entry names its page there).
  const baseFileRef = useRef(pdfFile);
  if (renderedPdfFileRef.current !== pdfFile) {
    renderedPdfFileRef.current = pdfFile;
    if (!pdfFile || !ownFilesRef.current.has(pdfFile)) {
      pdfFileRef.current = pdfFile;
      baseFileRef.current = pdfFile;
      pageStateRef.current = null;
      // A different document (or someone else's version) is open now: the
      // page steps kept for the old one can no longer be undone.
      historyRef.current = new Map();
    }
  }

  // Operations applied on screen but not yet written into the PDF bytes, each
  // with the state/view it replaced (for rollback).
  const pendingRef = useRef([]);
  const chainRef = useRef(Promise.resolve());
  const timerRef = useRef(null);
  const statusRef = useRef({ pending: 0, savedCount: 0, failedCount: 0 });
  const mountedRef = useRef(true);
  const callbacksRef = useRef({});
  callbacksRef.current = { onUpdatePDFFile, commitPageState, restorePageView };

  const publishStatus = useCallback(() => {
    statusRef.current.pending = pendingRef.current.length;
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      // Dev-only probe for the page-operation timing/consistency harness.
      window.__surveyPageOps = { ...statusRef.current, file: pdfFileRef.current };
    }
  }, []);

  const rollback = useCallback((records, error) => {
    const first = records[0];
    if (!first) return;
    // The steps that failed to save are gone, and the viewer clears its
    // timeline on this rollback commit: nothing kept here refers to it.
    historyRef.current = new Map();
    const { commitPageState: commit, restorePageView: restore } = callbacksRef.current;
    if (first.viewBefore !== undefined) restore?.(first.viewBefore);
    if (first.stateBefore) {
      const restored = freshCopyOfPageState(first.stateBefore);
      commit?.(restored, { type: 'rollback' });
      pageStateRef.current = null;
    }
    statusRef.current.failedCount += 1;
    const verb = OPERATION_VERBS[first.operation?.type === 'batch'
      ? first.operation.operations?.[0]?.type
      : first.operation?.type] || 'change';
    const what = records.length > 1 ? 'the last page changes' : `the page ${verb}`;
    showToast(`Couldn't save ${what}, so it was undone. ${error?.message || ''}`.trim(), 'error');
  }, []);

  // Write every pending operation into the PDF bytes in one pdf-lib pass and
  // hand the new file to the persistence callback (upload for cloud docs).
  const runBatch = useCallback(async () => {
    const records = pendingRef.current.slice();
    if (records.length === 0) return;
    const currentPdfFile = pdfFileRef.current;
    try {
      if (!currentPdfFile || !callbacksRef.current.onUpdatePDFFile) {
        throw new Error('PDF file not available for manipulation');
      }
      // An Undo of a delete copies the page back from the document as first
      // opened; those bytes are read only when such a step is saved.
      const steps = flattenOperations(records.map((record) => record.pdfOperation));
      const needsBase = steps.some((step) => step?.type === 'restore' && !step.entry?.blank);
      const baseBytes = needsBase && baseFileRef.current ? await baseFileRef.current.arrayBuffer() : null;
      const operations = steps.map((step) => (
        step?.type === 'restore' && baseBytes
          ? { ...step, baseBytes: baseBytes.slice(0) }
          : step
      ));
      // pdf-lib runs in a worker: the rewrite never janks the UI it follows.
      const pdfBytes = await mutatePdfPagesOffThread(
        () => currentPdfFile.arrayBuffer(),
        operations,
      );
      const newFile = createPageMutationFile(pdfBytes, currentPdfFile);
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = currentPdfFile.id;
      newFile.projectId = currentPdfFile.projectId;
      newFile.supabaseFilePath = currentPdfFile.supabaseFilePath;
      newFile.contentSha256 = currentPdfFile.contentSha256 || null;
      newFile.user_id = currentPdfFile.user_id || null;
      newFile.filePath = currentPdfFile.filePath || null;
      ownFilesRef.current.add(newFile);
      await callbacksRef.current.onUpdatePDFFile(newFile);
      pdfFileRef.current = newFile;
      pendingRef.current = pendingRef.current.slice(records.length);
      statusRef.current.savedCount += 1;
      publishStatus();
    } catch (error) {
      console.error('Error saving page change:', error);
      // Everything still pending was applied on top of this batch, so it goes
      // too: back to the state and view before the first unsaved operation.
      const dropped = pendingRef.current.slice();
      pendingRef.current = [];
      publishStatus();
      if (mountedRef.current) rollback(dropped, error);
    }
  }, [publishStatus, rollback]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = chainRef.current.then(() => {
      if (pendingRef.current.length > 0) return runBatch();
      return undefined;
    });
    chainRef.current = next.catch(() => {});
    return next.then(() => pdfFileRef.current, () => pdfFileRef.current);
  }, [runBatch]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, flushDelayMs);
  }, [flush, flushDelayMs]);

  // A page change still being written must not be lost to a reload/close.
  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;
    const onBeforeUnload = (event) => {
      if (pendingRef.current.length === 0) return undefined;
      flush();
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Leaving the document (tab closed / switched away) must still save.
      if (pendingRef.current.length > 0) flush();
    };
  }, [flush]);

  // `step` (Undo / Redo only): { id, phase, stateOperation, pdfOperation,
  // createdIds } - run that instead of `operation` and record nothing new.
  const executeMutation = useCallback((operation, errorVerb, step = null) => {
    if (!pdfFileRef.current || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return false;
    }
    try {
      // The getter is normally current (PDFViewer's ref is written by the
      // commit itself and by every render). Only when it still returns the
      // very state the previous operation started from — it has not caught
      // up yet — does this chain on that operation's result. Anything edited
      // since (new marks, renamed pages) is in the getter's newer state.
      const fromGetter = typeof getPageState === 'function' ? getPageState() : null;
      const chained = pageStateRef.current;
      const sourceState = chained && (!fromGetter || chained.base === fromGetter)
        ? chained.next
        : fromGetter;
      // A copied page's marks get new ids; Redo hands out the SAME ids again
      // so later steps that touch those marks still find them.
      const replayIds = step?.createdIds ? [...step.createdIds] : null;
      const createdIds = [];
      const createId = () => {
        const id = (replayIds && replayIds.length > 0) ? replayIds.shift() : newPageCopyId();
        createdIds.push(id);
        return id;
      };
      const stateOperation = step?.stateOperation || operation;
      // A turn folds the page's old presentation rotation into the PDF.
      const foldRotation = (single, state) => (single?.type === 'rotate'
        ? {
          ...single,
          delta: Number(single.delta || 0)
            + Number(state?.pageTransformations?.[single.page]?.rotation || 0),
        }
        : single);
      // A batch (several pages at once) runs its steps in order; each step's
      // state before it is kept for its own inverse (one Undo for them all).
      const batchSteps = !step && operation?.type === 'batch' ? [] : null;
      let nextState;
      let pdfOperation;
      if (batchSteps) {
        let state = sourceState;
        for (const single of operation.operations || []) {
          const pdfStep = foldRotation(single, state);
          batchSteps.push({
            pdfOperation: pdfStep,
            context: { stateBefore: state, pageTransformBefore: state?.pageTransformations?.[single?.page] ?? null },
          });
          state = state ? transformPageState(state, single, { createId }) : null;
        }
        nextState = state;
        pdfOperation = { type: 'batch', operations: batchSteps.map((entry) => entry.pdfOperation) };
      } else {
        nextState = sourceState ? transformPageState(sourceState, stateOperation, { createId }) : null;
        pdfOperation = step?.pdfOperation || foldRotation(operation, sourceState);
      }
      // View first, then the remapped state, in the same tick: React renders
      // the moved page and its annotations together.
      const viewBefore = typeof applyPageView === 'function' ? applyPageView(pdfOperation) : undefined;
      let historyStep = step ? { id: step.id, phase: step.phase } : null;
      if (!step) {
        let inverse;
        if (batchSteps) {
          // What each deleted page showed, read off the view as it was just
          // before that step.
          let view = viewBefore;
          for (const entry of batchSteps) {
            if (entry.pdfOperation?.type === 'delete') entry.context.deletedEntry = pageViewEntry(view, entry.pdfOperation.page);
            try { view = view ? applyPageViewOperation(view, entry.pdfOperation) : view; } catch { view = null; }
          }
          inverse = inversePageOperationSteps(batchSteps);
        } else {
          inverse = inversePageOperation(pdfOperation, {
            stateBefore: sourceState,
            deletedEntry: pdfOperation?.type === 'delete' ? pageViewEntry(viewBefore, pdfOperation.page) : null,
            pageTransformBefore: sourceState?.pageTransformations?.[operation?.page] ?? null,
          });
        }
        if (inverse) {
          historySeqRef.current += 1;
          const id = historySeqRef.current;
          historyRef.current.set(id, {
            forward: { pdfOperation, stateOperation: operation, commitOperation: operation },
            inverse: { ...inverse, commitOperation: inverse.stateOperation },
            createdIds,
          });
          historyStep = { id, phase: 'do' };
        }
      }
      if (nextState) commitPageState(nextState, step?.commitOperation || operation, historyStep);
      pageStateRef.current = { base: fromGetter, next: nextState };
      pendingRef.current.push({ operation: step?.commitOperation || operation, pdfOperation, stateBefore: sourceState, viewBefore });
      publishStatus();
      scheduleFlush();
      return true;
    } catch (error) {
      console.error(`Error ${errorVerb} page:`, error);
      showToast(`Error ${errorVerb} page: ${error.message}`, 'error');
      return false;
    }
  }, [applyPageView, commitPageState, getPageState, onUpdatePDFFile, publishStatus, scheduleFlush]);

  // Undo / Redo one page step (the viewer's timeline calls these). Returns
  // false when the step is no longer known (another document version was
  // opened, or a save failed and was rolled back): it cannot be taken back.
  const undoPageOperation = useCallback((id) => {
    const entry = historyRef.current.get(id);
    if (!entry) return false;
    return executeMutation(entry.inverse.commitOperation, 'undoing', {
      id,
      phase: 'undo',
      stateOperation: entry.inverse.stateOperation,
      pdfOperation: entry.inverse.pdfOperation,
      commitOperation: entry.inverse.commitOperation,
    });
  }, [executeMutation]);

  const redoPageOperation = useCallback((id) => {
    const entry = historyRef.current.get(id);
    if (!entry) return false;
    return executeMutation(entry.forward.commitOperation, 'redoing', {
      id,
      phase: 'redo',
      stateOperation: entry.forward.stateOperation,
      pdfOperation: entry.forward.pdfOperation,
      commitOperation: entry.forward.commitOperation,
      createdIds: entry.createdIds,
    });
  }, [executeMutation]);

  const runMutation = useCallback((operation, errorVerb) => (
    Promise.resolve(executeMutation(operation, errorVerb))
  ), [executeMutation]);

  // Several pages at once (an array of page numbers, the Pages tab's
  // selection): ONE batch = one view swap, one commit, one Undo step.
  // Resolves to the pages the result occupies (the new selection), or false.
  const runPlan = useCallback((plan, errorVerb) => {
    const operation = batchOperation(plan?.operations);
    if (!operation) return Promise.resolve(false);
    return runMutation(operation, errorVerb).then((ok) => (ok ? plan.selection : false));
  }, [runMutation]);

  const handleDuplicatePage = useCallback((pageNumber) => (
    isPageList(pageNumber)
      ? runPlan(duplicatePages(Infinity, pageNumber), 'duplicating')
      : runMutation({ type: 'duplicate', page: pageNumber }, 'duplicating')
  ), [runMutation, runPlan]);

  const handleRenamePage = useCallback((pageNumber, newName) => {
    setPageNames((prev) => ({ ...prev, [pageNumber]: newName }));
  }, [setPageNames]);

  const handleDeletePage = useCallback((pageNumber) => (
    isPageList(pageNumber)
      ? runPlan(deletePages(Infinity, pageNumber), 'deleting')
      : runMutation({ type: 'delete', page: pageNumber }, 'deleting')
  ), [runMutation, runPlan]);

  // The page clipboard holds one page number, or several (a sorted array).
  const clipboardValue = (pageNumber) => {
    if (!isPageList(pageNumber)) return pageNumber;
    const pages = normalizePageSelection(pageNumber);
    return pages.length === 1 ? pages[0] : pages;
  };

  const handleCutPage = useCallback((pageNumber) => {
    setClipboardPage(clipboardValue(pageNumber));
    setClipboardType('cut');
  }, [setClipboardPage, setClipboardType]);

  const handleCopyPage = useCallback((pageNumber) => {
    setClipboardPage(clipboardValue(pageNumber));
    setClipboardType('copy');
  }, [setClipboardPage, setClipboardType]);

  // Paste the clipboard page below the target (the default, "after") or above
  // it (position 'above'; owner 2026-10-07, the page menu's Paste above).
  const handlePastePage = useCallback(async (targetPageNumber, sourcePageNumber, pasteType, position = 'below') => {
    if (!sourcePageNumber || !pasteType) return false;
    if (isPageList(sourcePageNumber)) {
      // Several pages: a cut moves them as one block next to the target, a
      // copy pastes copies of them (in order) as one block.
      const target = Number(targetPageNumber);
      const plan = pasteType === 'cut'
        ? movePagesNextTo(Math.max(target, ...sourcePageNumber), sourcePageNumber, target, position)
        : copyPagesAfter(Math.max(target, ...sourcePageNumber), sourcePageNumber, position === 'above' ? target - 1 : target);
      const result = await runPlan(plan, 'pasting');
      if (result && pasteType === 'cut') {
        setClipboardPage(null);
        setClipboardType(null);
      }
      return result;
    }
    if (pasteType === 'cut' && sourcePageNumber === targetPageNumber) {
      setClipboardPage(null);
      setClipboardType(null);
      return true;
    }
    // The slot the page goes into: after this page (0 = before page 1).
    const afterPage = position === 'above' ? targetPageNumber - 1 : targetPageNumber;
    const operation = pasteType === 'cut'
      ? {
        type: 'move',
        from: sourcePageNumber,
        // Removing a source that was before the slot shifts it back by one.
        to: sourcePageNumber <= afterPage ? afterPage : afterPage + 1,
      }
      : { type: 'copy', source: sourcePageNumber, afterPage };
    const succeeded = await runMutation(operation, 'pasting');
    if (succeeded && pasteType === 'cut') {
      setClipboardPage(null);
      setClipboardType(null);
    }
    return succeeded;
  }, [runMutation, setClipboardPage, setClipboardType]);

  const pageClipboardPayload = useMemo(() => (
    clipboardPage ? { pageNumber: clipboardPage, type: clipboardType } : null
  ), [clipboardPage, clipboardType]);

  const handlePastePageHere = useCallback((targetPageNumber) => (
    handlePastePage(targetPageNumber, clipboardPage, clipboardType)
  ), [clipboardPage, clipboardType, handlePastePage]);

  // One page to a page's slot, or several pages (an array) as one block to
  // `{ index, pageCount }`: the slot among the pages that stay (a drag).
  const handleReorderPages = useCallback((sourcePageNumber, targetPageNumber) => (
    isPageList(sourcePageNumber)
      ? runPlan(movePagesToIndex(targetPageNumber?.pageCount, sourcePageNumber, targetPageNumber?.index), 'moving')
      : runMutation({ type: 'move', from: sourcePageNumber, to: targetPageNumber }, 'moving')
  ), [runMutation, runPlan]);

  // delta: 90 turns right (clockwise), -90 left.
  const handleRotatePage = useCallback((pageNumber, delta = 90) => (
    isPageList(pageNumber)
      ? runPlan(rotatePages(Infinity, pageNumber, delta), 'rotating')
      : runMutation({ type: 'rotate', page: pageNumber, delta: delta === -90 ? -90 : 90 }, 'rotating')
  ), [runMutation, runPlan]);

  const handleMirrorPage = useCallback((pageNumber, direction) => {
    setPageTransformations((prev) => {
      const current = prev[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
      return {
        ...prev,
        [pageNumber]: {
          ...current,
          [direction === 'horizontal' ? 'mirrorH' : 'mirrorV']:
            !current[direction === 'horizontal' ? 'mirrorH' : 'mirrorV'],
        },
      };
    });
  }, [setPageTransformations]);

  const handleResetPage = useCallback((pageNumber) => {
    setPageTransformations((prev) => {
      const next = { ...prev };
      delete next[pageNumber];
      return next;
    });
  }, [setPageTransformations]);

  const handleRotatePageCW = useCallback((pageNumber) => (
    runMutation({ type: 'rotate', page: pageNumber, delta: 90 }, 'rotating')
  ), [runMutation]);

  const handleRotatePageCCW = useCallback((pageNumber) => (
    runMutation({ type: 'rotate', page: pageNumber, delta: -90 }, 'rotating')
  ), [runMutation]);

  // afterPageNumber 0 adds the blank above page 1. Its size is the page
  // above it (or page 1 at the top): utils/blankPageSize.js.
  const handleInsertBlankPage = useCallback((afterPageNumber) => (
    runMutation({ type: 'insert', afterPage: Math.max(0, Number(afterPageNumber) || 0) }, 'inserting')
  ), [runMutation]);

  return {
    handleDuplicatePage,
    handleRenamePage,
    handleDeletePage,
    handleCutPage,
    handleCopyPage,
    handlePastePage,
    pageClipboardPayload,
    handlePastePageHere,
    handleReorderPages,
    handleRotatePage,
    handleMirrorPage,
    handleResetPage,
    handleRotatePageCW,
    handleRotatePageCCW,
    handleInsertBlankPage,
    undoPageOperation,
    redoPageOperation,
    // Resolves (with the newest File) once every page change on screen is in
    // the PDF bytes — export/print read the bytes, so they wait for it.
    flushPageOperations: flush,
  };
}

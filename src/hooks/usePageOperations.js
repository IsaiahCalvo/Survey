// usePageOperations — durable PDF page mutation handlers for the thumbnail
// sidebar. PDF bytes are persisted first; the corresponding page-addressed
// app state is committed only after that persistence succeeds.

import { useCallback, useMemo, useRef } from 'react';
import { showToast } from '../utils/toast';
import { createPageMutationFile } from '../utils/pageMutationFile.js';
import { transformPageState } from '../utils/pageAnnotationReindex.js';
// PERF (KAL-384): pdfPageMutation pulls in pdf-lib (~429 kB). Page add /
// delete / rotate / reorder is a deliberate user action, so the module is
// imported dynamically at the call site below instead of at first viewer paint.
import { persistThenCommitPageMutation } from '../utils/pageMutationTransaction.js';

export function usePageOperations({
  pdfFile,
  onUpdatePDFFile,
  getPageState,
  commitPageState,
  withMutation,
  setPageNames,
  setPageTransformations,
  clipboardPage,
  setClipboardPage,
  clipboardType,
  setClipboardType,
}) {
  const pdfFileRef = useRef(pdfFile);
  const renderedPdfFileRef = useRef(pdfFile);
  const pageStateRef = useRef(null);
  if (renderedPdfFileRef.current !== pdfFile) {
    renderedPdfFileRef.current = pdfFile;
    pdfFileRef.current = pdfFile;
    pageStateRef.current = null;
  }
  const mutationQueueRef = useRef(Promise.resolve());

  const executeMutation = useCallback(async (operation, errorVerb) => {
    const currentPdfFile = pdfFileRef.current;
    if (!currentPdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return false;
    }

    try {
      const managedLocal = currentPdfFile.storageMode === 'local' && !!currentPdfFile.localId && !currentPdfFile.id;
      const expectedLocalRevision = currentPdfFile.localRevision;
      const stateFingerprint = () => JSON.stringify(getPageState?.(), (_key, value) => (
        value instanceof Map ? Object.fromEntries(value) : value
      ));
      const observedState = stateFingerprint();
      const sourceState = pageStateRef.current
        || (typeof getPageState === 'function' ? getPageState() : null);
      const nextState = sourceState ? transformPageState(sourceState, operation) : null;
      const pdfOperation = operation?.type === 'rotate'
        ? {
          ...operation,
          delta: Number(operation.delta || 0)
            + Number(sourceState?.pageTransformations?.[operation.page]?.rotation || 0),
        }
        : operation;
      const { mutatePdfPages } = await import('../utils/pdfPageMutation.js');
      const pdfBytes = await mutatePdfPages(await currentPdfFile.arrayBuffer(), pdfOperation);
      if (pdfFileRef.current !== currentPdfFile
        || (managedLocal && currentPdfFile.localRevision !== expectedLocalRevision)
        || stateFingerprint() !== observedState) {
        throw new Error('The document changed during this page action. Your latest edits were kept. Retry the page action.');
      }
      const newFile = createPageMutationFile(pdfBytes, currentPdfFile);
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = currentPdfFile.id;
      newFile.projectId = currentPdfFile.projectId;
      newFile.supabaseFilePath = currentPdfFile.supabaseFilePath;
      newFile.user_id = currentPdfFile.user_id || null;
      newFile.filePath = currentPdfFile.filePath || null;

      // This callback is the production storage boundary. Never publish the
      // remapped metadata before the new PDF bytes are durable.
      await persistThenCommitPageMutation({
        file: newFile,
        state: nextState,
        operation,
        persist: onUpdatePDFFile,
        commit: commitPageState,
      });
      // A second page action can arrive before React has rendered the new File
      // prop. Keep the serialized operation queue on the just-persisted bytes
      // so rapid taps cannot branch from a stale page count or overwrite work.
      pdfFileRef.current = newFile;
      pageStateRef.current = nextState;
      return true;
    } catch (error) {
      console.error(`Error ${errorVerb} page:`, error);
      showToast(`Error ${errorVerb} page: ${error.message}`, 'error');
      return false;
    }
  }, [commitPageState, getPageState, onUpdatePDFFile]);

  const runMutation = useCallback((operation, errorVerb) => {
    const result = mutationQueueRef.current.then(async () => {
      try {
        return typeof withMutation === 'function'
          ? await withMutation(() => executeMutation(operation, errorVerb))
          : await executeMutation(operation, errorVerb);
      } catch (error) {
        showToast(error.message || 'This page action could not finish. Your document was kept.', 'error');
        return false;
      }
    });
    mutationQueueRef.current = result.catch(() => false);
    return result;
  }, [executeMutation, withMutation]);

  const handleDuplicatePage = useCallback((pageNumber) => (
    runMutation({ type: 'duplicate', page: pageNumber }, 'duplicating')
  ), [runMutation]);

  const handleRenamePage = useCallback((pageNumber, newName) => {
    setPageNames((prev) => ({ ...prev, [pageNumber]: newName }));
  }, [setPageNames]);

  const handleDeletePage = useCallback((pageNumber) => (
    runMutation({ type: 'delete', page: pageNumber }, 'deleting')
  ), [runMutation]);

  const handleCutPage = useCallback((pageNumber) => {
    setClipboardPage(pageNumber);
    setClipboardType('cut');
  }, [setClipboardPage, setClipboardType]);

  const handleCopyPage = useCallback((pageNumber) => {
    setClipboardPage(pageNumber);
    setClipboardType('copy');
  }, [setClipboardPage, setClipboardType]);

  const handlePastePage = useCallback(async (targetPageNumber, sourcePageNumber, pasteType) => {
    if (!sourcePageNumber || !pasteType) return false;
    if (pasteType === 'cut' && sourcePageNumber === targetPageNumber) {
      setClipboardPage(null);
      setClipboardType(null);
      return true;
    }
    const operation = pasteType === 'cut'
      ? {
        type: 'move',
        from: sourcePageNumber,
        // Paste means "after target". Removing a source that was before the
        // target shifts that insertion slot back by one.
        to: sourcePageNumber <= targetPageNumber ? targetPageNumber : targetPageNumber + 1,
      }
      : { type: 'copy', source: sourcePageNumber, afterPage: targetPageNumber };
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

  const handleReorderPages = useCallback((sourcePageNumber, targetPageNumber) => (
    runMutation({ type: 'move', from: sourcePageNumber, to: targetPageNumber }, 'moving')
  ), [runMutation]);

  const handleRotatePage = useCallback((pageNumber) => (
    runMutation({ type: 'rotate', page: pageNumber, delta: 90 }, 'rotating')
  ), [runMutation]);

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

  const handleInsertBlankPage = useCallback((afterPageNumber) => (
    runMutation({ type: 'insert', afterPage: afterPageNumber }, 'inserting')
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
  };
}

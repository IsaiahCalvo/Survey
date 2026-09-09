// usePageOperations — durable PDF page mutation handlers for the thumbnail
// sidebar. PDF bytes are persisted first; the corresponding page-addressed
// app state is committed only after that persistence succeeds.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { showToast } from '../utils/toast';
import { createPageMutationFile } from '../utils/pageMutationFile.js';
import { transformPageState } from '../utils/pageAnnotationReindex.js';
// PERF (KAL-384): pdfPageMutation pulls in pdf-lib (~429 kB). Page add /
// delete / rotate / reorder is a deliberate user action, so the module is
// imported dynamically at the call site below instead of at first viewer paint.
import { persistThenCommitPageMutation } from '../utils/pageMutationTransaction.js';

const fingerprintPageState = state => JSON.stringify(state, (_key, value) => (
  value instanceof Map ? Object.fromEntries(value) : value
));

export function usePageOperations({
  pdfFile,
  actorUserId = null,
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
  const pageStateObservedFingerprintRef = useRef(null);
  const operationScopeRef = useRef({ actorUserId });
  const pendingPageFileRef = useRef(null);
  const mountRef = useRef(null);
  useLayoutEffect(() => {
    const mount = {};
    mountRef.current = mount;
    return () => { if (mountRef.current === mount) mountRef.current = null; };
  }, []);
  if (operationScopeRef.current.actorUserId !== actorUserId
    || (renderedPdfFileRef.current !== pdfFile && pdfFileRef.current !== pdfFile
      && !(pendingPageFileRef.current?.file === pdfFile
        && pendingPageFileRef.current?.scope === operationScopeRef.current))) {
    operationScopeRef.current = { actorUserId };
    pageStateRef.current = null;
    pageStateObservedFingerprintRef.current = null;
  }
  const operationScope = operationScopeRef.current;
  const pendingPageFile = pendingPageFileRef.current;
  if (pendingPageFile?.scope === operationScope && pdfFile === pendingPageFile.sourceFile
    && fingerprintPageState(getPageState?.()) !== pendingPageFile.observedState) {
    pendingPageFile.editsArrived = true;
  }
  if (renderedPdfFileRef.current !== pdfFile) {
    renderedPdfFileRef.current = pdfFile;
    pdfFileRef.current = pdfFile;
    pageStateRef.current = null;
    pageStateObservedFingerprintRef.current = null;
  }
  const mutationQueueRef = useRef(Promise.resolve());

  const executeMutation = useCallback(async (operation, errorVerb) => {
    const mount = mountRef.current;
    const isCurrent = () => mount && mountRef.current === mount && operationScopeRef.current === operationScope;
    if (!isCurrent()) return false;
    const currentPdfFile = pdfFileRef.current;
    if (!currentPdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return false;
    }

    try {
      const managedLocal = currentPdfFile.storageMode === 'local' && !!currentPdfFile.localId && !currentPdfFile.id;
      const expectedLocalRevision = currentPdfFile.localRevision;
      const stateFingerprint = () => fingerprintPageState(getPageState?.());
      const observedState = stateFingerprint();
      // A queued action can precede React's new File prop. Only reuse its
      // committed graph while the live view is that graph or the known old
      // capture. A third state means edits arrived between actions; it must
      // not be replaced by our older queued snapshot.
      if (pageStateRef.current && observedState !== pageStateObservedFingerprintRef.current
        && observedState !== fingerprintPageState(pageStateRef.current)) {
        throw new Error('New edits arrived between page actions. Your latest edits were kept. Retry the page action.');
      }
      const sourceState = pageStateRef.current
        || (typeof getPageState === 'function' ? getPageState() : null);
      const pdfOperation = operation?.type === 'rotate'
        ? {
          ...operation,
          delta: Number(operation.delta || 0)
            + Number(sourceState?.pageTransformations?.[operation.page]?.rotation || 0),
        }
        : operation;
      const { mutatePdfPagesWithIdentity } = await import('../utils/pdfPageMutation.js');
      const { bytes: pdfBytes, copiedWidgets } = await mutatePdfPagesWithIdentity(
        await currentPdfFile.arrayBuffer(), pdfOperation,
      );
      if (!isCurrent() || pdfFileRef.current !== currentPdfFile
        || (managedLocal && currentPdfFile.localRevision !== expectedLocalRevision)
        || stateFingerprint() !== observedState) {
        throw new Error('The document changed during this page action. Your latest edits were kept. Retry the page action.');
      }
      // A copied native form must use the exact widget identity and unique
      // field name emitted with these bytes. Never guess it from page order.
      const nextState = sourceState ? transformPageState(sourceState, operation, { copiedWidgets }) : null;
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
      const pendingFile = { file: newFile, sourceFile: currentPdfFile, scope: operationScope, observedState, editsArrived: false };
      pendingPageFileRef.current = pendingFile;
      try {
        await persistThenCommitPageMutation({
          file: newFile,
          state: nextState,
          operation,
          persist: (...args) => {
            if (!isCurrent() || pdfFileRef.current !== currentPdfFile) throw new Error('The document changed before this page action could save.');
            return onUpdatePDFFile(...args);
          },
          commit: (...args) => {
            if (!isCurrent() || (pdfFileRef.current !== currentPdfFile && pdfFileRef.current !== newFile)) {
              throw new Error('The document changed while this page action was saving.');
            }
            // Only count edits rendered against the old source. Publishing the
            // new File can itself flush pending view updates and hydration.
            if (pendingFile.editsArrived) {
              throw new Error('New edits arrived while this page action was saving. PDF bytes may have saved, but the new edits were not replaced. Review the document before another page action.');
            }
            return commitPageState?.(...args);
          },
        });
      } finally {
        if (pendingPageFileRef.current === pendingFile) pendingPageFileRef.current = null;
      }
      if (!isCurrent()) return false;
      // A second page action can arrive before React has rendered the new File
      // prop. Keep the serialized operation queue on the just-persisted bytes
      // so rapid taps cannot branch from a stale page count or overwrite work.
      pdfFileRef.current = newFile;
      // A flushSync persistence callback may already have rendered newFile.
      // In that case the live view owns later hydration/edits; reinstalling
      // this temporary pre-render cache would reject every subsequent action.
      const awaitingFileRender = renderedPdfFileRef.current !== newFile;
      pageStateRef.current = awaitingFileRender ? nextState : null;
      pageStateObservedFingerprintRef.current = awaitingFileRender ? observedState : null;
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      console.error(`Error ${errorVerb} page:`, error);
      showToast(`Error ${errorVerb} page: ${error.message}`, 'error');
      return false;
    }
  }, [commitPageState, getPageState, onUpdatePDFFile, operationScope]);

  const executionRef = useRef(null);
  executionRef.current = { executeMutation, withMutation, scope: operationScope };

  const runMutation = useCallback((operation, errorVerb) => {
    const mount = mountRef.current;
    const result = mutationQueueRef.current.then(async () => {
      try {
        const run = () => {
          const latest = executionRef.current;
          if (!mount || mountRef.current !== mount || operationScopeRef.current !== operationScope
            || latest.scope !== operationScope) return false;
          return latest.executeMutation(operation, errorVerb);
        };
        if (!mount || mountRef.current !== mount || operationScopeRef.current !== operationScope) return false;
        const prepare = executionRef.current.withMutation;
        return typeof prepare === 'function' ? await prepare(run) : await run();
      } catch (error) {
        if (!mount || mountRef.current !== mount || operationScopeRef.current !== operationScope) return false;
        showToast(error.message || 'This page action could not finish. Your document was kept.', 'error');
        return false;
      }
    });
    mutationQueueRef.current = result.catch(() => false);
    return result;
  }, [operationScope]);

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

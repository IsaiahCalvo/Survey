import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const blankFor = scope => ({ scope, review: null, busy: false, error: '', blocked: false,
  retryPending: false });
const message = problem => problem?.message || 'The document upgrade was kept for retry.';
const installedFor = (result, actorUserId, documentId) => result?.publication?.state === 'published'
  && result?.opened?.mode === 'checked' && result.opened.actorUserId === actorUserId
  && result.opened.documentId === documentId;

/** UI state only. The deep client module owns durable intent, exact receipts,
 * consent ordering, publication recovery, and checked installation. */
export function useDocumentFirstGenerationAdoption({ enabled = false, actorUserId = null,
  documentId = null, legacy = false, ownerHint = false, client = null,
  captureAccepted = null, revalidateCapture = null, retireGeneration = null,
  install = null, isCurrent = () => true } = {}) {
  const key = JSON.stringify([actorUserId, documentId, legacy === true]);
  const scopeRef = useRef(null);
  if (scopeRef.current?.key !== key) {
    scopeRef.current?.controller?.abort();
    scopeRef.current = { key, live: true, request: 0, controller: null };
  }
  const scope = scopeRef.current;
  const blank = useMemo(() => blankFor(scope), [scope]);
  const [state, setState] = useState(blank);
  const shown = state.scope === scope ? state : blank;
  const available = enabled === true && legacy === true && ownerHint === true
    && typeof actorUserId === 'string' && typeof documentId === 'string' && client !== null;
  const current = useCallback(() => scopeRef.current === scope && scope.live
    && isCurrent({ actorUserId, documentId }) === true, [actorUserId, documentId, isCurrent, scope]);
  const update = useCallback(next => {
    if (!current()) return;
    setState(previous => ({ ...(previous.scope === scope ? previous : blank), ...next, scope }));
  }, [blank, current, scope]);

  useEffect(() => {
    scope.live = true;
    setState(blank);
    if (!available || typeof retireGeneration !== 'function' || typeof install !== 'function') {
      return () => { scope.live = false; scope.request++; };
    }
    const controller = new AbortController(), token = ++scope.request;
    scope.controller = controller;
    void client.resume({ documentId, signal: controller.signal, retireGeneration, install })
      .then(result => {
        if (!current() || token !== scope.request) return;
        const row = result?.row;
        update({ review: row?.phase === 'review' ? row.receipt : null,
          blocked: row?.phase === 'reserved', retryPending: false, error: '' });
      }, problem => {
        if (!current() || token !== scope.request) return;
        update({ error: message(problem), blocked: true, retryPending: true });
      });
    return () => { controller.abort(); if (scope.controller === controller) scope.controller = null;
      if (scope.request === token) scope.request++; scope.live = false; };
  }, [available, blank, client, current, documentId, install, retireGeneration, scope, update]);

  const requestReview = useCallback(async () => {
    if (!available || !current() || shown.busy || typeof captureAccepted !== 'function'
      || typeof revalidateCapture !== 'function') throw new Error('The document upgrade is not available.');
    scope.controller?.abort();
    const token = ++scope.request, controller = new AbortController();
    scope.controller = controller;
    update({ busy: true, error: '', blocked: false });
    try {
      let result = await client.review({ documentId, captureAccepted, revalidateCapture,
        signal: controller.signal });
      if (!current() || token !== scope.request) throw new Error('The document or account changed.');
      if (result?.needsReview !== true) {
        result = await client.resume({ documentId, signal: controller.signal,
          retireGeneration, install });
        if (!current() || token !== scope.request) throw new Error('The document or account changed.');
        update({ review: null, blocked: false, retryPending: false, error: '' });
        return result;
      }
      const review = result?.row?.phase === 'review' ? result.row.receipt : null;
      if (!review) throw new Error('The document upgrade review could not be verified.');
      update({ review, blocked: false, retryPending: false });
      return review;
    } catch (problem) {
      if (current() && token === scope.request) update({ error: message(problem), blocked: true });
      throw problem;
    } finally {
      if (scope.controller === controller) scope.controller = null;
      if (current() && token === scope.request) update({ busy: false });
    }
  }, [available, captureAccepted, client, current, documentId, install, revalidateCapture,
    retireGeneration, scope, shown.busy, update]);

  const confirm = useCallback(async () => {
    const review = shown.review;
    if (!available || !current() || shown.busy || !review
      || typeof retireGeneration !== 'function' || typeof install !== 'function') {
      throw new Error('Review the document upgrade again.');
    }
    scope.controller?.abort();
    const token = ++scope.request, controller = new AbortController();
    scope.controller = controller;
    update({ busy: true, error: '' });
    try {
      const result = shown.retryPending
        ? await client.resume({ documentId, signal: controller.signal, retireGeneration, install })
        : await client.confirm({ documentId, reviewSha256: review.review_sha256,
          signal: controller.signal, retireGeneration, install });
      // The exact checked install retires this hook's legacy scope by design.
      // All other late results still fail the old actor/document request guard.
      if (!current() || token !== scope.request) {
        if (installedFor(result, actorUserId, documentId)) return result;
        throw new Error('The document or account changed.');
      }
      update({ review: null, blocked: false, retryPending: false, error: '' });
      return result;
    } catch (problem) {
      if (current() && token === scope.request) update({ error: message(problem), blocked: true,
        retryPending: true });
      throw problem;
    } finally {
      if (scope.controller === controller) scope.controller = null;
      if (current() && token === scope.request) update({ busy: false });
    }
  }, [available, client, current, documentId, install, retireGeneration,
    scope, shown.busy, shown.retryPending, shown.review, update]);

  const closeReview = useCallback(() => {
    if (!current() || shown.busy) return false;
    scope.request++; scope.controller?.abort(); scope.controller = null;
    update({ review: null }); return true;
  }, [current, scope, shown.busy, update]);

  return useMemo(() => Object.freeze({ available, review: shown.review, busy: shown.busy,
    error: shown.error, blocked: shown.blocked, requestReview, confirm, closeReview }),
  [available, closeReview, confirm, requestReview, shown]);
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';
import { captureManagedLocalEntityCatalog, documentEntityAdoptionIdentity,
  validateManagedLocalEntityCatalog } from '../services/documentEntityCatalog.js';
import { getDocumentEntityAdoptionIntentStore } from '../services/documentEntityAdoptionIntentStore.js';
import { isManagedLocalDocument } from '../services/localDocumentState.js';

const alwaysCurrent = () => true;
const EMPTY = Object.freeze([]);
const sameSource = (catalog, preview) => catalog?.status === 'accepted'
  && catalog.documentId === preview?.documentId
  && catalog.source?.templateId === preview?.source?.templateId
  && catalog.source?.templateUpdatedAt === preview?.source?.templateUpdatedAt
  && catalog.source?.entitiesSha256 === preview?.source?.entitiesSha256;
const sameIntent = (catalog, row) => sameSource(catalog, row?.preview)
  && catalog?.seed?.operationId === row?.operationId
  && catalog?.seed?.requestSha256 === row?.requestSha256;
const errorText = error => error?.message || 'The document entity list could not be loaded.';

export function useDocumentEntityCatalog({ enabled = false, file, actorUserId, template,
  cloudClient = null, adoptionStore = null, readManagedLocal = null,
  persistManagedLocal = null, isCurrent = alwaysCurrent } = {}) {
  const isLocal = isManagedLocalDocument(file);
  const documentId = file?.id || null;
  const legacyBypass = !enabled || (!isLocal && !documentId);
  const scopeKey = isLocal ? `local:${file.localId}`
    : `cloud:${actorUserId || ''}:${documentId || ''}:${file?.pdfGenerationId || ''}`;
  const scopeRef = useRef(null);
  if (scopeRef.current?.key !== scopeKey) scopeRef.current = {
    key: scopeKey, live: true, request: 0, read: 0, busy: false,
  };
  const scope = scopeRef.current;
  const initialLocal = useMemo(() => {
    if (!isLocal || typeof readManagedLocal !== 'function') return {
      catalog: null, known: isLocal || legacyBypass, error: '',
    };
    try {
      const value = readManagedLocal(file);
      return { catalog: value == null ? null : validateManagedLocalEntityCatalog(value, file.localId),
        known: true, error: '' };
    } catch (error) {
      return { catalog: null, known: false,
        error: errorText(error) || 'The saved document entity list is invalid. Its data was kept.' };
    }
  }, [file, isLocal, legacyBypass, readManagedLocal, scopeKey]);
  const blank = useMemo(() => ({ scope, catalog: initialLocal.catalog,
    review: null, busy: false, error: initialLocal.error, known: initialLocal.known }), [initialLocal, scope]);
  const [view, setView] = useState(blank);
  const shown = view.scope === scope ? view : blank;
  const store = adoptionStore || (!isLocal && enabled && globalThis.indexedDB
    ? getDocumentEntityAdoptionIntentStore() : null);
  const current = useCallback(() => scopeRef.current === scope && scope.live
    && isCurrent({ actorUserId, documentId, localId: file?.localId || null }) === true,
  [actorUserId, documentId, file?.localId, isCurrent, scope]);
  const update = useCallback(next => {
    if (!current()) return;
    setView(old => ({ ...(old.scope === scope ? old : blank), ...next, scope }));
  }, [blank, current, scope]);

  useEffect(() => {
    scope.live = true;
    setView(blank);
    if (isLocal || !enabled || !documentId || !actorUserId || !cloudClient) {
      return () => { scope.live = false; };
    }
    const controller = new AbortController();
    const incarnation = ++scope.read;
    const readCurrent = () => current() && scope.read === incarnation;
    void (async () => {
      let saved = null, cached = null;
      const firstRead = Promise.resolve().then(() => cloudClient.read({
        documentId, signal: controller.signal,
      })).then(value => ({ value }), error => ({ error }));
      try {
        if (store) [saved, cached] = await Promise.all([
          store.get(actorUserId, documentId), store.getAccepted(actorUserId, documentId),
        ]);
      } catch (error) { if (readCurrent()) update({ known: false, error: errorText(error) }); return; }
      if (!readCurrent()) return;
      let authoritative = null;
      let intentConflict = false;
      try {
        const outcome = await firstRead;
        if (outcome.error) throw outcome.error;
        let result = outcome.value;
        if (!readCurrent()) return;
        authoritative = result;
        if (saved) {
          let dispatched = saved;
          if (!sameIntent(result, saved)) {
            if (result.status === 'accepted') {
              intentConflict = true;
              throw new Error('A different entity list is already adopted for this document.');
            }
            if (saved.phase === 'pending') dispatched = await store.markDispatched(actorUserId,
              documentId, saved.revision, saved.operationId);
            if (!readCurrent()) return;
            try { result = await cloudClient.adopt({ preview: dispatched.preview,
              operationId: dispatched.operationId, signal: controller.signal }); }
            catch (error) {
              if (!readCurrent()) return;
              const reconciled = await cloudClient.read({ documentId, signal: controller.signal });
              if (!sameIntent(reconciled, dispatched)) throw error;
              result = reconciled;
            }
          }
          authoritative = result;
          if (!sameIntent(result, dispatched)) throw new Error('A saved entity-list adoption needs review.');
          await store.putAccepted(actorUserId, documentId, result);
          await store.finish(actorUserId, documentId, dispatched.revision,
            dispatched.operationId, dispatched.requestSha256);
        } else if (store && result.status === 'accepted') await store.putAccepted(actorUserId, documentId, result);
        if (readCurrent()) update({ catalog: result, known: true, error: '' });
      } catch (error) {
        if (!readCurrent()) return;
        const forbidden = error?.code === 'DOCUMENT_ENTITY_CATALOG_FORBIDDEN';
        const trusted = !intentConflict && authoritative?.status === 'accepted' ? authoritative : null;
        update({ catalog: forbidden ? null : (trusted || (!authoritative ? cached : null)),
          known: !forbidden && Boolean(trusted || (!authoritative && cached)),
          error: errorText(error) });
      }
    })();
    return () => { scope.live = false; if (scope.read === incarnation) scope.read++; controller.abort(); };
  }, [actorUserId, blank, cloudClient, current, documentId, enabled, isLocal,
    scope, store, update]);

  const requestAdoption = useCallback(async (nextTemplate = template) => {
    if (!current() || !nextTemplate || scope.busy) throw new Error('The document or template changed.');
    if (!enabled) throw new Error('Document entity lists are not enabled.');
    if (!shown.known) throw new Error('The saved document entity list must be resolved before adoption.');
    const token = ++scope.request;
    scope.busy = true;
    update({ busy: true, error: '' });
    try {
      let next;
      if (isLocal) next = { kind: 'local', preview: await captureManagedLocalEntityCatalog({
        localId: file.localId, template: nextTemplate,
      }), templateName: nextTemplate.name || 'this template' };
      else {
        if (!enabled || !cloudClient || !documentId) throw new Error('Shared document entity lists are not enabled.');
        const templateId = nextTemplate.supabaseId || nextTemplate.id;
        const preview = await cloudClient.preview({ documentId, templateId });
        next = { kind: 'cloud', preview, operationId: randomUUID(),
          templateName: nextTemplate.name || 'this template' };
      }
      if (!current() || token !== scope.request) throw new Error('The document or account changed.');
      update({ review: Object.freeze(next) });
      return next;
    } catch (error) {
      if (current() && token === scope.request) update({ error: errorText(error) });
      throw error;
    } finally {
      if (token === scope.request) scope.busy = false;
      if (current() && token === scope.request) update({ busy: false });
    }
  }, [cloudClient, current, documentId, enabled, file, isLocal, scope,
    shown.busy, shown.known, template, update]);

  const confirmAdoption = useCallback(async () => {
    const pending = shown.review;
    if (!pending || !current() || scope.busy) throw new Error('Review this entity list again.');
    const token = ++scope.request;
    scope.busy = true;
    update({ busy: true, error: '' });
    try {
      let accepted;
      if (pending.kind === 'local') {
        if (typeof persistManagedLocal !== 'function') throw new Error('Local document storage is not available.');
        await persistManagedLocal(file, pending.preview);
        accepted = pending.preview;
      } else {
        if (!store) throw new Error('Saved entity-list adoption is not available.');
        const identity = await documentEntityAdoptionIdentity(pending.preview, pending.operationId);
        if (!current() || token !== scope.request) throw new Error('The document or account changed.');
        const reserved = await store.reserve(actorUserId, documentId, { preview: pending.preview,
          operationId: identity.operationId, requestSha256: identity.requestSha256 });
        if (!current() || token !== scope.request) throw new Error('The document or account changed.');
        if (!reserved.created && (reserved.row.operationId !== identity.operationId
          || reserved.row.requestSha256 !== identity.requestSha256)) {
          throw new Error('A prior entity-list adoption must be resolved first.');
        }
        let dispatched = reserved.row;
        if (dispatched.phase === 'pending') dispatched = await store.markDispatched(actorUserId,
          documentId, dispatched.revision, dispatched.operationId);
        if (!current() || token !== scope.request) throw new Error('The document or account changed.');
        try { accepted = await cloudClient.adopt({ preview: dispatched.preview,
          operationId: dispatched.operationId }); }
        catch (error) {
          if (!current() || token !== scope.request) throw error;
          const resolved = await cloudClient.read({ documentId });
          if (!sameIntent(resolved, dispatched)) throw error;
          accepted = resolved;
        }
        if (!current() || token !== scope.request || !sameIntent(accepted, dispatched)) {
          throw new Error('The saved entity-list adoption did not match.');
        }
        await store.putAccepted(actorUserId, documentId, accepted);
        await store.finish(actorUserId, documentId, dispatched.revision,
          dispatched.operationId, dispatched.requestSha256);
      }
      if (!current() || token !== scope.request) throw new Error('The document or account changed.');
      update({ catalog: accepted, known: true, review: null });
      return accepted;
    } catch (error) {
      if (current() && token === scope.request) update({ error: errorText(error) });
      throw error;
    } finally {
      if (token === scope.request) scope.busy = false;
      if (current() && token === scope.request) update({ busy: false });
    }
  }, [actorUserId, cloudClient, current, documentId, file, persistManagedLocal,
    scope, shown.busy, shown.review, store, update]);

  const cancelAdoption = useCallback(() => {
    if (!current() || scope.busy) return false;
    scope.request++; update({ review: null, error: '' }); return true;
  }, [current, scope, shown.busy, update]);
  const accepted = shown.catalog?.status === 'accepted';
  const legacy = shown.known && shown.catalog?.status !== 'accepted';
  return useMemo(() => Object.freeze({ mode: accepted ? 'accepted' : (legacy ? 'legacy' : 'unknown'),
    catalog: shown.catalog,
    entities: accepted ? shown.catalog.entities
      : (legacy ? (template?.entities || template?.config?.entities || EMPTY) : EMPTY),
    review: shown.review, busy: shown.busy, error: shown.error,
    requestAdoption, confirmAdoption, cancelAdoption }), [accepted, cancelAdoption,
    confirmAdoption, legacy, requestAdoption, shown, template]);
}

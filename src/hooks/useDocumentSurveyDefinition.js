import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';
import { captureManagedLocalSurveyDefinition, documentSurveyDefinitionAdoptionIdentity,
  validateManagedLocalSurveyDefinition } from '../services/documentSurveyDefinition.js';
import { getDocumentSurveyDefinitionAdoptionIntentStore }
  from '../services/documentSurveyDefinitionAdoptionIntentStore.js';
import { isManagedLocalDocument } from '../services/localDocumentState.js';

const alwaysCurrent = () => true;
const EMPTY = Object.freeze([]);
const SAFE_ERRORS = Object.freeze({
  DOCUMENT_SURVEY_DEFINITION_FORBIDDEN: 'You no longer have access to this document survey definition.',
  DOCUMENT_SURVEY_DEFINITION_UNAVAILABLE: 'The document survey definition could not be loaded.',
  DOCUMENT_SURVEY_DEFINITION_CONFLICT: 'The survey template changed. Review it again.',
  DOCUMENT_SURVEY_DEFINITION_STALE: 'The document or account changed.',
  DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_INVALID: 'The saved survey-definition adoption is invalid.',
  DOCUMENT_SURVEY_DEFINITION_ADOPTION_STORE_UNAVAILABLE: 'The saved survey-definition adoption is unavailable.',
});
const errorText = error => SAFE_ERRORS[error?.code]
  || (error?.safe === true ? error.message : 'The document survey definition could not be loaded.');
const fail = message => Object.assign(new Error(message), { safe: true });
const sameSource = (definition, preview) => definition?.status === 'accepted'
  && definition.documentId === preview?.documentId
  && definition.source?.templateId === preview?.source?.templateId
  && definition.source?.templateUpdatedAt === preview?.source?.templateUpdatedAt
  && definition.source?.structureSha256 === preview?.source?.structureSha256;
const sameIntent = (definition, row) => sameSource(definition, row?.preview)
  && definition?.seed?.operationId === row?.operationId
  && definition?.seed?.requestSha256 === row?.requestSha256;
const hasWorkbookLink = template => [template, template?.config].some(value => Boolean(
  value?.linkedExcelPath || value?.isOneDrive || value?.isSharePoint
  || value?.oneDriveFileId || value?.oneDriveApiPath || value?.sharePointDriveId));

export function useDocumentSurveyDefinition({ enabled = false, file, actorUserId, template,
  cloudClient = null, adoptionStore = null, readManagedLocal = null,
  persistManagedLocal = null, isCurrent = alwaysCurrent } = {}) {
  const isLocal = isManagedLocalDocument(file);
  const documentId = file?.id || null;
  const isCurrentRef = useRef(isCurrent);
  isCurrentRef.current = isCurrent;
  const scopeRef = useRef(null);
  const prior = scopeRef.current;
  if (!prior || prior.file !== file || prior.actorUserId !== actorUserId
    || prior.documentId !== documentId || prior.generationId !== (file?.pdfGenerationId || null)
    || prior.localId !== (file?.localId || null) || prior.enabled !== enabled) {
    scopeRef.current = { file, actorUserId, documentId,
      generationId: file?.pdfGenerationId || null, localId: file?.localId || null,
      enabled, live: true, request: 0, read: 0, busy: false, controller: null,
      initialized: false, definition: null, review: null, known: false };
  }
  const scope = scopeRef.current;
  scope.readManagedLocal = readManagedLocal;
  const bypass = !isLocal && !documentId;
  const initialLocal = useMemo(() => {
    if (!isLocal) return { definition: null, known: bypass, error: '' };
    if (typeof readManagedLocal !== 'function') return { definition: null, known: false,
      error: 'The saved document survey definition could not be read.' };
    try {
      const value = readManagedLocal(file);
      return { definition: value == null ? null
        : validateManagedLocalSurveyDefinition(value, file.localId), known: true, error: '' };
    } catch (error) {
      return { definition: null, known: false,
        error: errorText(error) || 'The saved document survey definition is invalid. Its data was kept.' };
    }
  }, [bypass, file, isLocal, readManagedLocal]);
  const blank = useMemo(() => ({ scope, definition: initialLocal.definition,
    review: null, busy: false, error: initialLocal.error, known: initialLocal.known }),
  [initialLocal, scope]);
  if (!scope.initialized) {
    scope.initialized = true;
    scope.definition = initialLocal.definition;
    scope.review = null;
    scope.known = initialLocal.known;
  }
  const [view, setView] = useState(blank);
  const shown = view.scope === scope ? view : blank;
  const store = adoptionStore || (!isLocal && documentId && actorUserId && globalThis.indexedDB
    ? getDocumentSurveyDefinitionAdoptionIntentStore() : null);
  const current = useCallback(() => scopeRef.current === scope && scope.live
    && isCurrentRef.current({ actorUserId, documentId, localId: file?.localId || null,
      generationId: file?.pdfGenerationId || null, file }) === true,
  [actorUserId, documentId, file, scope]);
  const update = useCallback(next => {
    if (!current()) return;
    if (Object.hasOwn(next, 'definition')) scope.definition = next.definition;
    if (Object.hasOwn(next, 'review')) scope.review = next.review;
    if (Object.hasOwn(next, 'known')) scope.known = next.known;
    setView(old => ({ ...(old.scope === scope ? old : blank), ...next, scope }));
  }, [blank, current, scope]);
  const reconcileManagedLocal = useCallback((localId, operationScope) => {
    const active = scopeRef.current;
    if (!active?.live || active.localId !== localId) return;
    const ownsActiveOperation = active === operationScope;
    let next;
    try {
      if (typeof active.readManagedLocal !== 'function') throw fail('The saved document survey definition could not be read.');
      const value = active.readManagedLocal(active.file);
      if (value == null) throw fail('Reopen this document to load its saved survey definition.');
      const definition = validateManagedLocalSurveyDefinition(value, active.localId);
      active.definition = definition;
      active.known = true;
      next = { definition, known: true, error: '',
        ...(ownsActiveOperation ? { review: null, busy: false } : {}) };
    } catch (error) {
      active.definition = null;
      active.known = false;
      next = { definition: null, known: false, error: errorText(error),
        ...(ownsActiveOperation ? { review: null, busy: false } : {}) };
    }
    if (ownsActiveOperation) {
      active.review = null;
      active.busy = false;
    }
    setView(old => scopeRef.current === active && active.live
      ? { ...(old.scope === active ? old : { scope: active, busy: active.busy }), ...next, scope: active }
      : old);
  }, []);

  useEffect(() => {
    scope.live = true;
    setView(blank);
    const incarnation = ++scope.read;
    const effectCurrent = () => current() && scope.read === incarnation;
    const controller = new AbortController();
    if (isLocal || bypass) {
      return () => {
        if (scope.read === incarnation) scope.read++;
        scope.request++;
        scope.controller?.abort();
        scope.controller = null;
        scope.live = false;
        controller.abort();
      };
    }
    void (async () => {
      let saved = null;
      let cached = null;
      try {
        if (store) [saved, cached] = await Promise.all([
          store.get(actorUserId, documentId), store.getAccepted(actorUserId, documentId),
        ]);
      } catch (error) {
        if (effectCurrent()) update({ known: false, error: errorText(error) });
        return;
      }
      if (!effectCurrent()) return;
      if (!enabled) {
        update({ definition: cached,
          known: Boolean(cached) || !saved,
          error: saved && !cached
            ? 'A saved survey-definition adoption must be resolved before this definition can be used.' : '' });
        return;
      }
      if (!actorUserId || !documentId || !cloudClient) {
        update({ definition: null, known: false,
          error: 'The document survey definition cannot be checked.' });
        return;
      }

      let authoritative = null;
      let intentConflict = false;
      try {
        let result = await cloudClient.read({ documentId, signal: controller.signal });
        if (!effectCurrent()) return;
        authoritative = result;
        if (saved) {
          let dispatched = saved;
          if (!sameIntent(result, saved)) {
            if (result.status === 'accepted') {
              intentConflict = true;
              throw fail('A different survey definition is already adopted for this document.');
            }
            if (saved.phase === 'pending') {
              dispatched = await store.markDispatched(actorUserId, documentId,
                saved.revision, saved.operationId);
              if (!effectCurrent() || !scope.enabled) return;
            }
            try {
              result = await cloudClient.adopt({ preview: dispatched.preview,
                operationId: dispatched.operationId, signal: controller.signal });
            } catch (error) {
              if (!effectCurrent() || !scope.enabled) return;
              const reconciled = await cloudClient.read({ documentId, signal: controller.signal });
              if (!effectCurrent() || !sameIntent(reconciled, dispatched)) throw error;
              result = reconciled;
            }
          }
          authoritative = result;
          if (!sameIntent(result, dispatched)) {
            intentConflict = true;
            throw fail('A saved survey-definition adoption needs review.');
          }
          await store.putAccepted(actorUserId, documentId, result);
          if (!effectCurrent()) return;
          await store.finish(actorUserId, documentId, dispatched.revision,
            dispatched.operationId, dispatched.requestSha256);
        } else if (store && result.status === 'accepted') {
          await store.putAccepted(actorUserId, documentId, result);
        }
        if (effectCurrent()) update({ definition: result, known: true, error: '' });
      } catch (error) {
        if (!effectCurrent()) return;
        const forbidden = error?.code === 'DOCUMENT_SURVEY_DEFINITION_FORBIDDEN';
        const trusted = !intentConflict && authoritative?.status === 'accepted' ? authoritative : null;
        update({ definition: forbidden ? null : (trusted || (!authoritative ? cached : null)),
          known: !forbidden && Boolean(trusted || (!authoritative && cached)),
          error: errorText(error) });
      }
    })();
    return () => {
      if (scope.read === incarnation) scope.read++;
      scope.request++;
      scope.controller?.abort();
      scope.controller = null;
      scope.live = false;
      controller.abort();
    };
  }, [actorUserId, blank, bypass, cloudClient, current, documentId, enabled,
    isLocal, scope, store, update]);

  const requestAdoption = useCallback(async (nextTemplate = template) => {
    if (!current() || !nextTemplate || scope.busy) throw fail('The document or template changed.');
    if (!scope.enabled) throw fail('Document survey definitions are not enabled.');
    if (!scope.known) throw fail('The saved document survey definition must be resolved before adoption.');
    if (scope.definition?.status === 'accepted') throw fail('This document already has a survey definition.');
    if (hasWorkbookLink(nextTemplate)) {
      throw fail('Linked Excel survey templates cannot be adopted yet.');
    }
    const token = ++scope.request;
    const controller = new AbortController();
    scope.controller = controller;
    scope.busy = true;
    update({ busy: true, error: '' });
    try {
      let next;
      if (isLocal) {
        next = { kind: 'local', preview: await captureManagedLocalSurveyDefinition({
          localId: file.localId, template: nextTemplate,
        }), templateName: nextTemplate.name || 'this template' };
      } else {
        if (!cloudClient || !documentId) throw fail('Shared document survey definitions are not available.');
        const templateId = nextTemplate.supabaseId || nextTemplate.id;
        const preview = await cloudClient.preview({ documentId, templateId, signal: controller.signal });
        next = { kind: 'cloud', preview, operationId: randomUUID(),
          templateName: nextTemplate.name || 'this template' };
      }
      if (!current() || token !== scope.request || !scope.enabled) {
        throw fail('The document or account changed.');
      }
      next = Object.freeze(next);
      update({ review: next });
      return next;
    } catch (error) {
      if (current() && token === scope.request) update({ error: errorText(error) });
      throw error;
    } finally {
      if (token === scope.request) {
        scope.busy = false;
        if (scope.controller === controller) scope.controller = null;
      }
      if (current() && token === scope.request) update({ busy: false });
    }
  }, [cloudClient, current, documentId, file, isLocal, scope, shown.definition,
    shown.known, template, update]);

  const confirmAdoption = useCallback(async () => {
    const pending = shown.review;
    if (!pending || pending !== scope.review || !current() || scope.busy) {
      throw fail('Review this survey definition again.');
    }
    if (!scope.enabled) throw fail('Document survey definitions are not enabled.');
    if (scope.definition?.status === 'accepted') throw fail('This document already has a survey definition.');
    const token = ++scope.request;
    const controller = new AbortController();
    scope.controller = controller;
    scope.busy = true;
    update({ busy: true, error: '' });
    try {
      let accepted;
      if (pending.kind === 'local') {
        if (typeof persistManagedLocal !== 'function') {
          throw fail('Local document storage is not available.');
        }
        await persistManagedLocal(file, pending.preview);
        reconcileManagedLocal(file.localId, scope);
        accepted = pending.preview;
      } else {
        if (!store || !cloudClient) throw fail('Saved survey-definition adoption is not available.');
        const identity = await documentSurveyDefinitionAdoptionIdentity(pending.preview, pending.operationId);
        if (!current() || token !== scope.request || !scope.enabled) {
          throw fail('The document or account changed.');
        }
        const reserved = await store.reserve(actorUserId, documentId, {
          preview: pending.preview, operationId: identity.operationId,
          requestSha256: identity.requestSha256,
        });
        if (!current() || token !== scope.request || !scope.enabled) {
          throw fail('The document or account changed.');
        }
        if (!reserved.created && (reserved.row.operationId !== identity.operationId
          || reserved.row.requestSha256 !== identity.requestSha256)) {
          throw fail('A prior survey-definition adoption must be resolved first.');
        }
        let dispatched = reserved.row;
        if (dispatched.phase === 'pending') {
          dispatched = await store.markDispatched(actorUserId, documentId,
            dispatched.revision, dispatched.operationId);
        }
        if (!current() || token !== scope.request || !scope.enabled) {
          throw fail('The document or account changed.');
        }
        try {
          accepted = await cloudClient.adopt({ preview: dispatched.preview,
            operationId: dispatched.operationId, signal: controller.signal });
        } catch (error) {
          if (!current() || token !== scope.request || !scope.enabled) throw error;
          const resolved = await cloudClient.read({ documentId, signal: controller.signal });
          if (!current() || token !== scope.request || !sameIntent(resolved, dispatched)) throw error;
          accepted = resolved;
        }
        if (!current() || token !== scope.request || !scope.enabled
          || !sameIntent(accepted, dispatched)) {
          throw fail('The saved survey-definition adoption did not match.');
        }
        await store.putAccepted(actorUserId, documentId, accepted);
        if (!current() || token !== scope.request || !scope.enabled) {
          throw fail('The document or account changed.');
        }
        await store.finish(actorUserId, documentId, dispatched.revision,
          dispatched.operationId, dispatched.requestSha256);
      }
      if (!current() || token !== scope.request || !scope.enabled) {
        throw fail('The document or account changed.');
      }
      update({ definition: accepted, known: true, review: null, error: '' });
      return accepted;
    } catch (error) {
      if (current() && token === scope.request) update({ error: errorText(error) });
      throw error;
    } finally {
      if (token === scope.request) {
        scope.busy = false;
        if (scope.controller === controller) scope.controller = null;
      }
      if (current() && token === scope.request) update({ busy: false });
    }
  }, [actorUserId, cloudClient, current, documentId, file, persistManagedLocal,
    reconcileManagedLocal, scope, shown.definition, shown.review, store, update]);

  const cancelAdoption = useCallback(() => {
    if (!current() || scope.busy) return false;
    scope.request++;
    scope.controller?.abort();
    scope.controller = null;
    update({ review: null, error: '' });
    return true;
  }, [current, scope, update]);

  const accepted = shown.definition?.status === 'accepted';
  const legacy = shown.known && !accepted;
  return useMemo(() => Object.freeze({
    mode: accepted ? 'accepted' : (legacy ? 'legacy' : 'unknown'),
    definition: accepted ? shown.definition : null,
    modules: accepted ? shown.definition.modules : EMPTY,
    review: shown.review,
    busy: shown.busy,
    error: shown.error,
    requestAdoption,
    confirmAdoption,
    cancelAdoption,
  }), [accepted, cancelAdoption, confirmAdoption, legacy, requestAdoption,
    shown.busy, shown.definition, shown.error, shown.review]);
}

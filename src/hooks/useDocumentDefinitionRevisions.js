import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';
import { getDocumentDefinitionRevisionCache } from '../services/documentDefinitionRevisionCache.js';

const EMPTY = Object.freeze([]);
const alwaysCurrent = () => true;
const fail = message => Object.assign(new Error(message), { safe: true });
const errorText = error => error?.safe === true ? error.message : ({
  DOCUMENT_DEFINITION_REVISION_FORBIDDEN: 'You no longer have access to this document definition.',
  DOCUMENT_DEFINITION_REVISION_CONFLICT: 'The document definition changed. Review it again.',
  DOCUMENT_DEFINITION_REVISION_INTEGRITY: 'The document definition could not be verified.',
  DOCUMENT_DEFINITION_REVISION_STALE: 'The document or account changed.',
  DOCUMENT_DEFINITION_REVISION_CACHE_FULL: 'This definition could not be kept for offline history. Free device space and retry.',
  DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE: 'Offline definition history is not available. Retry before editing.',
}[error?.code] || 'The document definition could not be loaded.');

const referenceKey = value => value
  ? `${value.definitionRevision}:${value.definitionDigest}`
  : null;
const sameOperation = (receipt, intent) => Boolean(receipt && intent
  && receipt.review?.operationId === intent.operationId
  && receipt.review?.requestSha256 === intent.requestSha256);

export const sameDefinitionRevisionReference = (left, right) => Boolean(left && right
  && left.documentId === right.documentId
  && left.definitionRevision === right.definitionRevision
  && left.definitionDigest === right.definitionDigest);

export const getDefinitionHistoryReference = target => target?.definitionReference
  || target?.meta?.get?.('definitionReference') || null;

export function stampDefinitionHistoryReference(stackItem, reference) {
  if (!reference || !stackItem?.meta?.has || !stackItem?.meta?.set
    || stackItem.meta.has('definitionReference')) return false;
  stackItem.meta.set('definitionReference', Object.freeze({ ...reference }));
  return true;
}

export const needsDefinitionHistoryReview = (target, currentReference) => {
  const targetReference = getDefinitionHistoryReference(target);
  return Boolean(targetReference && currentReference
    && !sameDefinitionRevisionReference(targetReference, currentReference));
};

function archivedSemanticIds(template) {
  const values = [];
  for (const module of template?.modules || template?.spaces || []) {
    if (module?.archived === true) values.push({ kind: 'module', id: module.id });
    for (const category of module?.categories || []) {
      if (category?.archived === true) values.push({ kind: 'category', id: category.id });
      for (const item of category?.checklist || category?.items || []) {
        if (item?.archived === true) values.push({ kind: 'checklistItem', id: item.id });
      }
    }
  }
  for (const entity of template?.entities || template?.config?.entities || []) {
    if (entity?.archived === true) values.push({ kind: 'entity', id: entity.id });
  }
  return values;
}

const templateId = value => value?.supabaseId || value?.id || null;

export const isDocumentDefinitionSourceLoadCurrent = (scopeCurrent, live, captured) => Boolean(
  scopeCurrent && live?.enabled === true && live.owner === true && live.canReview === true
  && live.load === captured?.load && live.publish === captured?.publish,
);

export const resolveDocumentDefinitionReadOnlyTool = (tool, mutationsBlocked) => (
  mutationsBlocked === true && tool !== 'pan' && tool !== 'text-select' ? 'pan' : tool
);

export const canCommitDocumentDefinitionMutation = mutationsBlocked => mutationsBlocked !== true;

export async function loadDocumentDefinitionRevisionSources({ load, isCurrent = alwaysCurrent, publish }) {
  if (typeof load !== 'function' || typeof publish !== 'function') {
    throw fail('Template sources are not available.');
  }
  const rows = await load();
  if (!isCurrent()) throw fail('The document or account changed.');
  if (!Array.isArray(rows)) throw fail('Template sources could not be loaded.');
  const templates = rows.map(row => {
    const config = row?.config && typeof row.config === 'object' ? row.config : null;
    if (!config) return row;
    const { ballInCourtEntities, ...currentConfig } = config;
    return { ...currentConfig,
      entities: currentConfig.entities ?? ballInCourtEntities ?? [],
      id: currentConfig.id || row.id, supabaseId: row.id,
      name: currentConfig.name || row.name || 'Unnamed template' };
  });
  if (!isCurrent()) throw fail('The document or account changed.');
  publish(templates);
  return templates;
}

export function useDocumentDefinitionRevisions({ enabled = false, file, checkedBundle = null,
  actorUserId, owner = false, active = true, template = null, client = null, cache = null,
  createOperationId = randomUUID, isCurrent = alwaysCurrent } = {}) {
  const documentId = file?.id || null;
  const generationId = checkedBundle?.pdfGenerationId || file?.pdfGenerationId || null;
  const isCurrentRef = useRef(isCurrent);
  isCurrentRef.current = isCurrent;
  const scopeRef = useRef(null);
  const prior = scopeRef.current;
  if (!prior || prior.file !== file || prior.actorUserId !== actorUserId
    || prior.documentId !== documentId || prior.generationId !== generationId
    || prior.enabled !== enabled || prior.active !== active) {
    prior?.controller?.abort();
    scopeRef.current = { file, actorUserId, documentId, generationId, enabled, active,
      live: true, request: 0, controller: null, currentReceipt: null,
      review: null, busy: false, receipts: new Map() };
  }
  const scope = scopeRef.current;
  const store = useMemo(() => {
    if (!enabled) return null;
    if (cache) return cache;
    try { return globalThis.indexedDB ? getDocumentDefinitionRevisionCache() : null; }
    catch { return null; }
  }, [cache, enabled]);
  const blank = useMemo(() => ({ scope, currentReceipt: null, review: null,
    busy: false, error: '', known: !enabled, online: false, recoveryBlocked: false }), [enabled, scope]);
  const [view, setView] = useState(blank);
  const shown = view.scope === scope ? view : blank;
  const current = useCallback(() => scopeRef.current === scope && scope.live
    && isCurrentRef.current({ actorUserId, documentId, generationId, file }) === true,
  [actorUserId, documentId, file, generationId, scope]);
  const update = useCallback(next => {
    if (!current()) return;
    if (Object.hasOwn(next, 'currentReceipt')) scope.currentReceipt = next.currentReceipt;
    if (Object.hasOwn(next, 'review')) scope.review = next.review;
    setView(old => ({ ...(old.scope === scope ? old : blank), ...next, scope }));
  }, [blank, current, scope]);
  const remember = useCallback(receipt => {
    scope.receipts.set(referenceKey(receipt), receipt);
    return receipt;
  }, [scope]);

  useEffect(() => {
    scope.live = true;
    if (!enabled || !active) return () => { scope.live = false; };
    const token = ++scope.request;
    const controller = new AbortController();
    scope.controller = controller;
    const effectCurrent = () => current() && token === scope.request;
    if (!actorUserId || !documentId || !generationId || !client || !store) {
      update({ known: false, error: 'Shared document definitions are not available.' });
      return () => { controller.abort(); scope.live = false; };
    }
    void (async () => {
      let cached = null;
      try {
        const [intent, savedCurrent] = await Promise.all([
          store.getIntent(actorUserId, documentId),
          store.getCurrentReceipt(actorUserId, documentId),
        ]);
        cached = savedCurrent;
        let receipt;
        try { receipt = await client.readCurrent({ documentId, signal: controller.signal }); }
        catch (error) {
          if (error?.code !== 'DOCUMENT_DEFINITION_REVISION_UNAVAILABLE' || !cached) throw error;
          if (!effectCurrent()) return;
          remember(cached);
          update({ currentReceipt: cached, review: owner ? intent?.review || null : null,
            known: true, online: false, recoveryBlocked: Boolean(intent),
            error: intent
              ? 'A saved definition update needs an online retry before editing can continue.'
              : 'Showing the last verified definition while offline. Editing is paused.' });
          return;
        }
        if (!effectCurrent()) return;
        await store.putCurrentReceipt(actorUserId, documentId, receipt);
        if (!effectCurrent()) return;
        remember(receipt);
        let recoveredReview = null;
        if (intent) {
          if (sameOperation(receipt, intent)) {
            const dispatched = intent.phase === 'pending' ? await store.markDispatched(actorUserId,
              documentId, intent.revision, intent.operationId) : intent;
            await store.finishIntent(actorUserId, documentId, dispatched.revision,
              dispatched.operationId, dispatched.requestSha256);
          } else if (intent.phase === 'dispatched' && owner) {
            const operationReceipt = await client.apply({ review: intent.review,
              signal: controller.signal });
            await store.putReceipt(actorUserId, documentId, operationReceipt);
            remember(operationReceipt);
            receipt = await client.readCurrent({ documentId, signal: controller.signal });
            await store.putCurrentReceipt(actorUserId, documentId, receipt);
            remember(receipt);
            await store.finishIntent(actorUserId, documentId, intent.revision,
              intent.operationId, intent.requestSha256);
          } else if (owner) recoveredReview = intent.review;
        }
        if (effectCurrent()) update({ currentReceipt: receipt, review: recoveredReview,
          known: true, online: true,
          recoveryBlocked: Boolean(intent && !owner && !sameOperation(receipt, intent)),
          error: intent && !owner && !sameOperation(receipt, intent)
            ? 'Only the document owner can finish the saved definition update.' : '' });
      } catch (error) {
        if (effectCurrent()) {
          const mayShowBlockedCache = cached && [
            'DOCUMENT_DEFINITION_REVISION_CACHE_FULL',
            'DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
          ].includes(error?.code);
          if (mayShowBlockedCache) remember(cached);
          update({ currentReceipt: mayShowBlockedCache ? cached : null,
            known: Boolean(mayShowBlockedCache), online: false,
            recoveryBlocked: true, error: errorText(error) });
        }
      }
    })();
    return () => {
      if (scope.controller === controller) scope.controller = null;
      if (token === scope.request) scope.request++;
      controller.abort();
      scope.live = false;
    };
  }, [active, actorUserId, blank, client, current, documentId, enabled, generationId,
    owner, remember, scope, store, update]);

  const requireOwner = useCallback(() => {
    if (!current() || !scope.enabled) throw fail('The document or account changed.');
    if (!owner) throw fail('Only the document owner can change its shared definition.');
    if (!shown.currentReceipt) throw fail('The shared document definition is not ready.');
    if (shown.online !== true || shown.recoveryBlocked === true) {
      throw fail('Finish the saved definition check before editing or applying another update.');
    }
    if (!client || !store) throw fail('Shared document definitions are not available.');
  }, [client, current, owner, scope, shown.currentReceipt, shown.online,
    shown.recoveryBlocked, store]);

  const requestReview = useCallback(async (selection = template) => {
    requireOwner();
    if (!selection || scope.busy) throw fail('Choose a template and retry.');
    const token = ++scope.request;
    const controller = new AbortController();
    scope.controller = controller;
    scope.busy = true;
    update({ busy: true, error: '' });
    try {
      const split = Object.hasOwn(selection, 'surveyTemplate')
        || Object.hasOwn(selection, 'entityTemplate');
      const surveyTemplate = split ? selection.surveyTemplate : selection;
      const entityTemplate = split ? selection.entityTemplate : selection;
      const hasSurvey = Boolean(surveyTemplate)
        && (Array.isArray(surveyTemplate.modules) || Array.isArray(surveyTemplate.spaces));
      const hasEntities = Boolean(entityTemplate)
        && (Array.isArray(entityTemplate.entities) || Array.isArray(entityTemplate.config?.entities));
      if (!hasSurvey && !hasEntities) throw fail('Choose a survey or entity template and retry.');
      const archives = [
        ...archivedSemanticIds(surveyTemplate).filter(value => value.kind !== 'entity'),
        ...archivedSemanticIds(entityTemplate).filter(value => value.kind === 'entity'),
      ];
      const review = await client.preview({ documentId,
        surveyTemplateId: hasSurvey
          ? templateId(surveyTemplate) : shown.currentReceipt.surveyDefinition.source.templateId,
        entityTemplateId: hasEntities
          ? templateId(entityTemplate) : shown.currentReceipt.entityCatalog.source.templateId,
        archivedSemanticIds: archives,
        operationId: createOperationId(), signal: controller.signal });
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      await store.putCurrentReceipt(actorUserId, documentId, review.currentReceipt);
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      remember(review.currentReceipt);
      await store.reserveIntent(actorUserId, documentId, review);
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      update({ review, busy: false, error: '' });
      return review;
    } catch (error) {
      if (current() && token === scope.request) update({ busy: false, error: errorText(error) });
      throw error;
    } finally {
      if (token === scope.request) {
        scope.busy = false;
        if (scope.controller === controller) scope.controller = null;
      }
    }
  }, [actorUserId, client, createOperationId, current, documentId, remember,
    requireOwner, scope, shown.currentReceipt, store, template, update]);

  const applyReview = useCallback(async () => {
    requireOwner();
    const review = shown.review;
    if (!review || review !== scope.review || scope.busy) throw fail('Review the document definition again.');
    const token = ++scope.request;
    const controller = new AbortController();
    scope.controller = controller;
    scope.busy = true;
    update({ busy: true, error: '' });
    let dispatched = null;
    try {
      await store.putCurrentReceipt(actorUserId, documentId, review.currentReceipt);
      const reserved = await store.reserveIntent(actorUserId, documentId, review);
      dispatched = reserved.row;
      if (dispatched.phase === 'pending') dispatched = await store.markDispatched(actorUserId,
        documentId, dispatched.revision, dispatched.operationId);
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      let accepted;
      try { accepted = await client.apply({ review: dispatched.review, signal: controller.signal }); }
      catch (error) {
        if (!current() || token !== scope.request) throw error;
        const reconciled = await client.readCurrent({ documentId, signal: controller.signal });
        if (!sameOperation(reconciled, dispatched)) throw error;
        accepted = reconciled;
      }
      if (!current() || token !== scope.request || !sameOperation(accepted, dispatched)) {
        throw fail('The applied document definition did not match its saved review.');
      }
      await store.putReceipt(actorUserId, documentId, accepted);
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      remember(accepted);
      const actualCurrent = await client.readCurrent({ documentId, signal: controller.signal });
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      await store.putCurrentReceipt(actorUserId, documentId, actualCurrent);
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      remember(actualCurrent);
      await store.finishIntent(actorUserId, documentId, dispatched.revision,
        dispatched.operationId, dispatched.requestSha256);
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      update({ currentReceipt: actualCurrent, review: null, busy: false, known: true,
        online: true, recoveryBlocked: false, error: '' });
      return actualCurrent;
    } catch (error) {
      if (current() && token === scope.request) update({ busy: false,
        recoveryBlocked: Boolean(dispatched), online: dispatched ? false : shown.online,
        error: dispatched
          ? 'The shared update may have reached the server, but its local recovery proof is incomplete. Retry before editing.'
          : errorText(error) });
      throw error;
    } finally {
      if (token === scope.request) {
        scope.busy = false;
        if (scope.controller === controller) scope.controller = null;
      }
    }
  }, [actorUserId, client, current, documentId, remember, requireOwner,
    scope, shown.online, shown.review, store, update]);

  const cancelReview = useCallback(async () => {
    requireOwner();
    const review = shown.review;
    if (!review || scope.busy) return false;
    const row = await store.getIntent(actorUserId, documentId);
    if (row?.phase === 'dispatched') throw fail('This definition update may have reached the server. Retry it instead.');
    if (row) await store.cancelIntent(actorUserId, documentId, row.revision, row.operationId);
    if (!current()) return false;
    scope.request++;
    scope.controller?.abort();
    scope.controller = null;
    update({ review: null, error: '' });
    return true;
  }, [actorUserId, current, documentId, requireOwner, scope, shown.review, store, update]);

  const getCachedRevision = useCallback(reference => {
    if (!current() || reference?.documentId !== documentId) return null;
    return scope.receipts.get(referenceKey(reference)) || null;
  }, [current, documentId, scope]);
  const loadRevision = useCallback(async reference => {
    if (!current() || reference?.documentId !== documentId) throw fail('The document or account changed.');
    const key = referenceKey(reference);
    const memory = scope.receipts.get(key);
    if (memory) return memory;
    let receipt = await store.getReceipt(actorUserId, documentId,
      reference.definitionRevision, reference.definitionDigest);
    if (!receipt) {
      const controller = new AbortController();
      scope.controller = controller;
      receipt = await client.readRevision({ documentId,
        definitionRevision: reference.definitionRevision,
        expectedDigest: reference.definitionDigest, signal: controller.signal });
      if (!current()) throw fail('The document or account changed.');
      await store.putReceipt(actorUserId, documentId, receipt);
    }
    if (!current()) throw fail('The document or account changed.');
    return remember(receipt);
  }, [actorUserId, client, current, documentId, remember, scope, store]);

  const accepted = shown.known && shown.currentReceipt?.status === 'accepted';
  return useMemo(() => Object.freeze({
    mode: !enabled ? 'disabled' : (accepted ? 'accepted' : 'unknown'),
    currentReceipt: accepted ? shown.currentReceipt : null,
    surveyDefinition: accepted ? shown.currentReceipt.surveyDefinition : null,
    entityCatalog: accepted ? shown.currentReceipt.entityCatalog : null,
    entities: accepted ? shown.currentReceipt.entityCatalog.entities : EMPTY,
    modules: accepted ? shown.currentReceipt.surveyDefinition.modules : EMPTY,
    review: shown.review, busy: shown.busy, error: shown.error,
    canReview: accepted && owner && shown.online === true && shown.recoveryBlocked !== true,
    mutationsBlocked: enabled && (!accepted || shown.online !== true || shown.recoveryBlocked === true),
    online: shown.online === true, recoveryBlocked: shown.recoveryBlocked === true,
    requestReview, applyReview,
    cancelReview, getCachedRevision, loadRevision,
  }), [accepted, applyReview, cancelReview, enabled, getCachedRevision, loadRevision,
    owner, requestReview, shown.busy, shown.currentReceipt, shown.error, shown.online,
    shown.recoveryBlocked, shown.review]);
}

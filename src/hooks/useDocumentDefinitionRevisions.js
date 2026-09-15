import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';
import { getDocumentDefinitionRevisionCache } from '../services/documentDefinitionRevisionCache.js';
import { projectDocumentDefinitionForNewUse } from '../services/documentDefinitionRetirement.js';

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
    prior?.initialReadController?.abort();
    prior?.refreshController?.abort();
    prior?.subscriptionController?.abort();
    scopeRef.current = { file, actorUserId, documentId, generationId, enabled, active,
      live: true, request: 0, controller: null, currentReceipt: null,
      initialReadController: null, refreshController: null, subscriptionController: null, readEpoch: 0,
      initialReadPending: false, refreshDirty: false, refreshPending: false, flushRefresh: null,
      browserOffline: false, online: false, recoveryBlocked: false, refreshing: false,
      projection: null, projectionReceipt: null, review: null, busy: false, receipts: new Map() };
  }
  const scope = scopeRef.current;
  const store = useMemo(() => {
    if (!enabled) return null;
    if (cache) return cache;
    try { return globalThis.indexedDB ? getDocumentDefinitionRevisionCache() : null; }
    catch { return null; }
  }, [cache, enabled]);
  const blank = useMemo(() => ({ scope, currentReceipt: null, review: null,
    busy: false, refreshing: false, error: '', known: !enabled,
    online: false, recoveryBlocked: false }), [enabled, scope]);
  const [view, setView] = useState(blank);
  const shown = view.scope === scope ? view : blank;
  const current = useCallback(() => scopeRef.current === scope && scope.live
    && isCurrentRef.current({ actorUserId, documentId, generationId, file }) === true,
  [actorUserId, documentId, file, generationId, scope]);
  const update = useCallback(next => {
    if (!current()) return;
    if (Object.hasOwn(next, 'currentReceipt')) scope.currentReceipt = next.currentReceipt;
    if (Object.hasOwn(next, 'review')) scope.review = next.review;
    for (const key of ['online', 'recoveryBlocked', 'refreshing']) {
      if (Object.hasOwn(next, key)) scope[key] = next[key];
    }
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
    const readEpoch = ++scope.readEpoch;
    const controller = new AbortController();
    scope.controller = controller;
    const effectCurrent = () => current() && token === scope.request
      && readEpoch === scope.readEpoch;
    if (!actorUserId || !documentId || !generationId || !client || !store) {
      update({ known: false, error: 'Shared document definitions are not available.' });
      return () => { controller.abort(); scope.live = false; };
    }
    scope.initialReadController = controller;
    scope.initialReadPending = true;
    update({ refreshing: true });
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
    })().finally(() => {
      if (scope.initialReadController !== controller) return;
      scope.initialReadController = null;
      scope.initialReadPending = false;
      if (scope.refreshDirty) scope.flushRefresh?.();
      else update({ refreshing: false });
    });
    return () => {
      if (scope.controller === controller) scope.controller = null;
      if (scope.initialReadController === controller) {
        scope.initialReadController = null;
        scope.initialReadPending = false;
      }
      if (token === scope.request) scope.request++;
      controller.abort();
      scope.live = false;
    };
  }, [active, actorUserId, blank, client, current, documentId, enabled, generationId,
    owner, remember, scope, store, update]);

  useEffect(() => {
    if (!enabled || !active || !actorUserId || !documentId || !generationId
      || !client || !store) return undefined;
    const generation = scope.readEpoch;
    const subscriptionController = new AbortController();
    scope.subscriptionController = subscriptionController;
    let disposed = false;
    let queued = false;
    let pending = false;
    let disposeSubscription = () => {};
    let refreshController = null;
    const scopeCurrent = () => !disposed && !subscriptionController.signal.aborted
      && current() && scope.readEpoch >= generation;

    const schedule = () => {
      if (!scopeCurrent() || scope.browserOffline || queued || pending
        || scope.busy || scope.initialReadPending
        || !scope.refreshDirty) return;
      queued = true;
      Promise.resolve().then(() => {
        queued = false;
        if (!scopeCurrent() || scope.browserOffline || pending
          || scope.busy || scope.initialReadPending
          || !scope.refreshDirty) return;
        scope.refreshDirty = false;
        pending = true;
        const readGeneration = ++scope.readEpoch;
        refreshController = new AbortController();
        scope.refreshController = refreshController;
        void (async () => {
          let cached = scope.currentReceipt;
          try {
            const [intent, savedCurrent] = await Promise.all([
              store.getIntent(actorUserId, documentId),
              store.getCurrentReceipt(actorUserId, documentId),
            ]);
            cached ||= savedCurrent;
            const receipt = await client.readCurrent({ documentId,
              signal: refreshController.signal });
            if (!scopeCurrent() || readGeneration !== scope.readEpoch) return;
            await store.putCurrentReceipt(actorUserId, documentId, receipt);
            if (!scopeCurrent() || readGeneration !== scope.readEpoch) return;
            remember(receipt);

            let nextIntent = intent;
            let nextReview = scope.review;
            if (nextIntent && sameOperation(receipt, nextIntent)) {
              await store.finishIntent(actorUserId, documentId, nextIntent.revision,
                nextIntent.operationId, nextIntent.requestSha256);
              nextIntent = null;
              nextReview = null;
            } else if (nextReview
              && !sameDefinitionRevisionReference(nextReview.currentReceipt, receipt)) {
              if (nextIntent?.phase === 'pending'
                && nextIntent.operationId === nextReview.wire?.review?.operationId) {
                await store.cancelIntent(actorUserId, documentId, nextIntent.revision,
                  nextIntent.operationId);
                nextIntent = null;
              }
              nextReview = nextIntent?.phase === 'dispatched' ? nextReview : null;
            }
            if (!scopeCurrent() || readGeneration !== scope.readEpoch) return;
            update({ currentReceipt: receipt, review: nextReview, known: true,
              online: true, refreshing: scope.refreshDirty,
              recoveryBlocked: nextIntent?.phase === 'dispatched',
              error: nextIntent?.phase === 'dispatched'
                ? 'A saved definition update needs an online retry before editing can continue.' : '' });
          } catch (error) {
            if (!scopeCurrent() || readGeneration !== scope.readEpoch) return;
            const mayShowBlockedCache = cached && [
              'DOCUMENT_DEFINITION_REVISION_UNAVAILABLE',
              'DOCUMENT_DEFINITION_REVISION_CACHE_FULL',
              'DOCUMENT_DEFINITION_REVISION_CACHE_UNAVAILABLE',
            ].includes(error?.code);
            if (mayShowBlockedCache) remember(cached);
            update({ currentReceipt: mayShowBlockedCache ? cached : null,
              known: Boolean(mayShowBlockedCache),
              online: false, refreshing: scope.refreshDirty, recoveryBlocked: true,
              error: mayShowBlockedCache
                ? 'Showing the last verified definition while offline. Editing is paused.'
                : errorText(error) });
          } finally {
            if (scope.refreshController === refreshController) scope.refreshController = null;
            refreshController = null;
            pending = false;
            if (scopeCurrent() && scope.refreshDirty) schedule();
            else scope.refreshPending = false;
          }
        })();
      });
    };
    const invalidate = () => {
      if (!scopeCurrent()) return;
      if (scope.browserOffline) return;
      scope.refreshDirty = true;
      scope.refreshPending = true;
      update({ refreshing: true });
      schedule();
    };
    const offline = () => {
      if (!scopeCurrent()) return;
      scope.browserOffline = true;
      scope.readEpoch++;
      scope.refreshDirty = false;
      scope.refreshPending = false;
      refreshController?.abort();
      update({ online: false, refreshing: false, recoveryBlocked: true,
        error: 'Showing the last verified definition while offline. Editing is paused.' });
    };
    const online = () => {
      if (!scopeCurrent()) return;
      scope.browserOffline = false;
      invalidate();
    };
    scope.flushRefresh = schedule;
    const onVisible = () => {
      if (globalThis.document?.hidden !== true) invalidate();
    };
    globalThis.window?.addEventListener?.('offline', offline);
    globalThis.window?.addEventListener?.('online', online);
    globalThis.window?.addEventListener?.('focus', invalidate);
    globalThis.document?.addEventListener?.('visibilitychange', onVisible);
    if (typeof client.subscribeCurrent === 'function') {
      try {
        disposeSubscription = client.subscribeCurrent({ documentId,
          signal: subscriptionController.signal, onInvalidate: invalidate }) || (() => {});
      } catch { /* focus, online, and the initial authoritative read remain available */ }
    }
    return () => {
      disposed = true;
      scope.readEpoch++;
      subscriptionController.abort();
      refreshController?.abort();
      try { disposeSubscription(); } catch { /* best-effort teardown */ }
      globalThis.window?.removeEventListener?.('offline', offline);
      globalThis.window?.removeEventListener?.('online', online);
      globalThis.window?.removeEventListener?.('focus', invalidate);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
      if (scope.subscriptionController === subscriptionController) scope.subscriptionController = null;
      if (scope.refreshController === refreshController) scope.refreshController = null;
      if (scope.flushRefresh === schedule) scope.flushRefresh = null;
      scope.refreshPending = false;
    };
  }, [active, actorUserId, client, current, documentId, enabled, generationId,
    remember, scope, store, update]);

  const requireOwner = useCallback(() => {
    if (!current() || !scope.enabled) throw fail('The document or account changed.');
    if (!owner) throw fail('Only the document owner can change its shared definition.');
    if (!shown.currentReceipt) throw fail('The shared document definition is not ready.');
    if (shown.online !== true || shown.recoveryBlocked === true || shown.refreshing === true
      || scope.browserOffline || scope.initialReadPending || scope.refreshDirty || scope.refreshPending) {
      throw fail('Finish the saved definition check before editing or applying another update.');
    }
    if (!client || !store) throw fail('Shared document definitions are not available.');
  }, [client, current, owner, scope, shown.currentReceipt, shown.online,
    shown.recoveryBlocked, shown.refreshing, store]);

  const requestReview = useCallback(async (selection = template) => {
    requireOwner();
    if (!selection || scope.busy) throw fail('Choose a template and retry.');
    const version = selection?.version === 2 ? 2 : 1;
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
      if (version === 1 && !hasSurvey && !hasEntities) {
        throw fail('Choose a survey or entity template and retry.');
      }
      const archives = [
        ...archivedSemanticIds(surveyTemplate).filter(value => value.kind !== 'entity'),
        ...archivedSemanticIds(entityTemplate).filter(value => value.kind === 'entity'),
      ];
      const review = await client.preview({ ...(version === 2 ? { version:2 } : {}), documentId,
        surveyTemplateId: hasSurvey ? templateId(surveyTemplate)
          : (version === 2 ? null : shown.currentReceipt.surveyDefinition.source.templateId),
        entityTemplateId: hasEntities ? templateId(entityTemplate)
          : (version === 2 ? null : shown.currentReceipt.entityCatalog.source.templateId),
        archivedSemanticIds: archives,
        ...(version === 2 ? { retiredSemanticRoots:selection.retiredSemanticRoots || [] } : {}),
        operationId: createOperationId(), signal: controller.signal });
      if (!current() || token !== scope.request) throw fail('The document or account changed.');
      if (review?.status === 'retirement-required' && review.version === 2) {
        update({ busy:false, error:'' });
        return review;
      }
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
        scope.flushRefresh?.();
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
        online: !scope.browserOffline, recoveryBlocked: scope.browserOffline,
        error: scope.browserOffline
          ? 'Showing the last verified definition while offline. Editing is paused.' : '' });
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
        scope.flushRefresh?.();
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
  const projection = useMemo(() => projectDocumentDefinitionForNewUse(
    accepted ? shown.currentReceipt : null), [accepted, shown.currentReceipt]);
  scope.projection = projection;
  scope.projectionReceipt = accepted ? shown.currentReceipt : null;
  const isAvailable = useCallback((kind, id) => Boolean(current() && scope.enabled
    && scope.online === true && scope.recoveryBlocked !== true && scope.refreshing !== true
    && !scope.browserOffline && !scope.initialReadPending && !scope.refreshDirty
    && !scope.refreshPending && !scope.busy && scope.projectionReceipt === scope.currentReceipt
    && scope.projection?.isAvailable(kind, id)),
  [current, scope]);
  return useMemo(() => Object.freeze({
    mode: !enabled ? 'disabled' : (accepted ? 'accepted' : 'unknown'),
    currentReceipt: accepted ? shown.currentReceipt : null,
    surveyDefinition: accepted ? shown.currentReceipt.surveyDefinition : null,
    entityCatalog: accepted ? shown.currentReceipt.entityCatalog : null,
    entities: accepted ? shown.currentReceipt.entityCatalog.entities : EMPTY,
    modules: accepted ? shown.currentReceipt.surveyDefinition.modules : EMPTY,
    availableEntities: accepted ? projection.entities : EMPTY,
    availableModules: accepted ? projection.modules : EMPTY,
    isAvailable,
    review: shown.review, busy: shown.busy, error: shown.error,
    canReview: accepted && owner && shown.online === true && shown.recoveryBlocked !== true
      && shown.refreshing !== true,
    mutationsBlocked: enabled && (!accepted || shown.online !== true
      || shown.recoveryBlocked === true || shown.refreshing === true),
    online: shown.online === true, recoveryBlocked: shown.recoveryBlocked === true,
    requestReview, applyReview,
    cancelReview, getCachedRevision, loadRevision,
  }), [accepted, applyReview, cancelReview, enabled, getCachedRevision, isAvailable, loadRevision,
    owner, projection.entities, projection.modules, requestReview, shown.busy, shown.currentReceipt, shown.error, shown.online,
    shown.recoveryBlocked, shown.refreshing, shown.review]);
}

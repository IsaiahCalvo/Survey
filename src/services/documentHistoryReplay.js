import { supabase } from '../supabaseClient.js';
import { runActorBoundDatabaseMutation } from './actorBoundDatabaseMutation.js';
import { getDocumentHistoryStore } from './documentHistoryStore.js';

const CLOUD_FIELDS = 'id, document_id, user_id, client_event_id, event_type, source, page_number, annotation_id, summary, payload, is_undoable, is_checkpoint, occurred_at, created_at';
const LOCK_PREFIX = 'survey:document-history-replay:';
const ACCOUNT_PREFIX = 'account:';

const stripLocalFields = row => {
  const { id: _localId, __local: _localOnly, __syncState: _syncState, ...cloudRow } = row || {};
  return cloudRow;
};

const validActor = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && !/[\u0000-\u001f\u007f]/.test(value);
const lockFor = actorUserId => `${LOCK_PREFIX}${actorUserId}`;
const responseCode = response => response?.error?.code || (response?.status ? `HTTP_${response.status}` : null);
const isTransient = (responseOrError) => {
  const status = Number(responseOrError?.status || 0);
  const error = responseOrError?.error || responseOrError;
  if (status === 408 || status === 429 || status >= 500) return true;
  if (status > 0) return false;
  return ['NETWORK_ERROR', 'DATABASE_MUTATION_FAILED', '40001', '40P01', '55P03', '57014', ''].includes(error?.code ?? '')
    && /fetch|network|load|timeout|database change could not be confirmed/i.test(String(error?.message || ''));
};

async function withActorLock({ lockManager, actorUserId, signal, ifAvailable = false, timeoutMs = 60000 }, work) {
  if (!lockManager || typeof lockManager.request !== 'function') return { status: 'locked', code: 'DOCUMENT_HISTORY_SAFE_LOCK_UNAVAILABLE' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  let entered = false;
  try {
    const lockOptions = ifAvailable
      ? { mode: 'exclusive', ifAvailable: true }
      : { mode: 'exclusive', signal: controller.signal };
    return await lockManager.request(lockFor(actorUserId), lockOptions, lock => {
      entered = true;
      return ifAvailable && !lock
        ? { status: 'locked', code: 'DOCUMENT_HISTORY_LOCK_BUSY' }
        : work();
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') return { status: 'aborted', code: 'DATABASE_MUTATION_ABORTED' };
    if (!entered) return { status: 'locked', code: 'DOCUMENT_HISTORY_SAFE_LOCK_UNAVAILABLE' };
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

/** Upload one already-admitted immutable row and confirm only an exact cloud readback. */
export async function replayDocumentHistoryRow({ actorUserId, isCurrent, cloud = supabase,
  localStore, item, lockManager = globalThis.navigator?.locks, signal, lockHeld = false,
  includePermanent = false } = {}) {
  const token = item?.token;
  let row = item?.row;
  if (!validActor(actorUserId) || typeof isCurrent !== 'function' || !cloud || !localStore
    || token?.scopeKey !== `${ACCOUNT_PREFIX}${actorUserId}` || !row?.document_id || !row?.client_event_id
    || token?.documentId !== row.document_id || token?.clientEventId !== row.client_event_id) {
    return { status: 'aborted', code: 'DOCUMENT_HISTORY_REPLAY_INPUT' };
  }
  const operationController = new AbortController();
  const abortOperation = () => operationController.abort();
  signal?.addEventListener?.('abort', abortOperation, { once: true });
  if (signal?.aborted) abortOperation();
  const operationTimer = setTimeout(abortOperation, 60000);
  const send = async ({ reread = false } = {}) => {
    await localStore.setScopeError?.(token.scopeKey, null);
    if (reread) {
      const current = await localStore.getPending(token, { includePermanent });
      if (!current) return { status: 'stale' };
      row = current.row;
    }
    let outcome;
    try {
      outcome = await runActorBoundDatabaseMutation({ client: cloud, actorUserId, isCurrent,
        signal: operationController.signal }, async ({ request }) => {
        const writeResponse = await request(() => {
          let query = cloud.from('document_history_events').upsert(stripLocalFields(row), {
            onConflict: 'document_id,client_event_id', ignoreDuplicates: true,
          });
          if (typeof query?.select === 'function') query = query.select(CLOUD_FIELDS);
          return query;
        });
        if (writeResponse?.error) return { kind: 'write-error', response: writeResponse };
        const written = Array.isArray(writeResponse?.data) ? writeResponse.data[0] : writeResponse?.data;
        if (written) return { kind: 'readback', row: written };
        const readResponse = await request(() => {
          let query = cloud.from('document_history_events').select(CLOUD_FIELDS)
            .eq('document_id', row.document_id).eq('client_event_id', row.client_event_id);
          if (typeof query?.limit === 'function') query = query.limit(1);
          return query;
        }, { write: false });
        if (readResponse?.error) return { kind: 'read-error', response: readResponse };
        const canonical = Array.isArray(readResponse?.data) ? readResponse.data[0] : readResponse?.data;
        return canonical ? { kind: 'readback', row: canonical } : { kind: 'missing' };
      });
    } catch (error) {
      if (error?.code === 'DATABASE_MUTATION_ABORTED' || error?.code === 'DATABASE_MUTATION_SCOPE_CHANGED') {
        return { status: 'aborted', code: error.code };
      }
      return { status: isTransient(error) ? 'transient' : 'permanent', code: error?.code || 'DATABASE_MUTATION_FAILED' };
    }
    if (outcome.kind === 'readback') {
      const confirmed = await localStore.confirm(token, outcome.row);
      return confirmed ? { status: 'confirmed' }
        : { status: 'permanent', code: 'DOCUMENT_HISTORY_CLOUD_EVENT_CONFLICT' };
    }
    if (outcome.kind === 'missing') return { status: 'transient', code: 'DOCUMENT_HISTORY_CLOUD_READBACK_MISSING' };
    const response = outcome.response;
    return { status: isTransient(response) ? 'transient' : 'permanent',
      code: responseCode(response) || 'DATABASE_MUTATION_FAILED' };
  };
  try {
    return lockHeld ? await send({ reread: true }) : await withActorLock({ lockManager, actorUserId,
      signal: operationController.signal }, () => send({ reread: true }));
  } finally {
    clearTimeout(operationTimer);
    signal?.removeEventListener?.('abort', abortOperation);
  }
}

/** Start bounded reconnect replay for one exact signed-in actor. */
export function startDocumentHistoryReplay({ actorUserId, isCurrent, cloud = supabase,
  localStore, lockManager = globalThis.navigator?.locks, signal, batchSize = 25,
  baseDelayMs = 1000, maxDelayMs = 30000, setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout, eventTarget = globalThis.window,
  retryPermanent = false } = {}) {
  let store = localStore;
  try { store ||= getDocumentHistoryStore(); } catch { store = null; }
  const controller = new AbortController();
  let stopped = false;
  let timer = null;
  let scanCursor = null;
  let scanRetryAt = null;
  let unsubscribe = () => {};
  let running = false;
  let wakePending = false;
  let ignoreWake = false;
  const setReplayError = async code => {
    ignoreWake = true;
    try { await store.setScopeError?.(scopeKey, code); } finally { ignoreWake = false; }
  };
  const current = () => {
    try { return !stopped && isCurrent() === true; } catch { return false; }
  };
  const valid = validActor(actorUserId) && typeof isCurrent === 'function' && store
    && Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 100
    && Number.isSafeInteger(baseDelayMs) && baseDelayMs > 0
    && Number.isSafeInteger(maxDelayMs) && maxDelayMs >= baseDelayMs
    && typeof retryPermanent === 'boolean'
    && typeof setTimeoutFn === 'function' && typeof clearTimeoutFn === 'function';
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer != null) clearTimeoutFn(timer);
    controller.abort();
    signal?.removeEventListener?.('abort', stop);
    eventTarget?.removeEventListener?.('online', wake);
    try { unsubscribe(); } catch { /* cleanup is best-effort */ }
  };
  signal?.addEventListener?.('abort', stop, { once: true });
  const scopeKey = `${ACCOUNT_PREFIX}${actorUserId}`;
  if (!valid || signal?.aborted || !lockManager?.request) {
    if (store && validActor(actorUserId)) {
      void store.setScopeError?.(scopeKey, 'DOCUMENT_HISTORY_SAFE_LOCK_UNAVAILABLE').catch?.(() => {});
    }
    stop(); return stop;
  }
  const schedule = delay => {
    if (stopped || timer != null) return;
    timer = setTimeoutFn(run, delay);
  };
  function wake() {
    if (ignoreWake) return;
    if (running) wakePending = true;
    else schedule(0);
  }
  async function run() {
    timer = null;
    if (!current()) { stop(); return; }
    running = true;
    let sawTransient = false;
    let retryDelay = maxDelayMs;
    let nextCursor = null;
    let replayFailed = false;
    try {
      const lockResult = await withActorLock({ lockManager, actorUserId, signal: controller.signal,
        ifAvailable: true }, async () => {
        await setReplayError(null);
        if (!current()) return { status: 'aborted' };
        const page = await store.listPending(scopeKey, { limit: batchSize, cursor: scanCursor,
          now: Date.now(), includePermanent: retryPermanent });
        nextCursor = page?.nextCursor ?? null;
        const futureRetryAt = Number(page?.nextRetryAt);
        if (Number.isFinite(futureRetryAt) && futureRetryAt > Date.now()) {
          scanRetryAt = scanRetryAt == null ? futureRetryAt : Math.min(scanRetryAt, futureRetryAt);
        }
        for (const item of page?.items || []) {
          if (!current()) return { status: 'aborted' };
          const result = await replayDocumentHistoryRow({ actorUserId, isCurrent, cloud, localStore: store,
            item, lockManager, signal: controller.signal, lockHeld: true,
            includePermanent: retryPermanent });
          if (result.status === 'confirmed' || result.status === 'aborted' || result.status === 'stale') continue;
          const attempts = Math.max(0, Number(item.attemptCount ?? item.token?.attemptCount) || 0);
          const itemDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(attempts, 20)));
          const retryAt = result.status === 'transient' ? Date.now() + itemDelay : null;
          try {
            const deferred = await store.deferPending(item.token, { errorCode: result.code,
              retryAt, permanent: result.status === 'permanent' });
            if (result.status === 'transient' && deferred === 'updated') {
              sawTransient = true;
              retryDelay = Math.min(retryDelay, itemDelay);
            }
          } catch (error) {
            try {
              await setReplayError(error?.code || 'DOCUMENT_HISTORY_REPLAY_DEFERRAL_FAILED');
            } catch { /* the durable pending row remains protected */ }
          }
        }
        return { status: 'done' };
      });
      if (lockResult?.status === 'locked') {
        if (lockResult.code === 'DOCUMENT_HISTORY_SAFE_LOCK_UNAVAILABLE') {
          await setReplayError(lockResult.code);
        }
        sawTransient = true;
        retryDelay = baseDelayMs;
      }
    } catch {
      replayFailed = true;
      sawTransient = true;
      retryDelay = baseDelayMs;
      try { await setReplayError('DOCUMENT_HISTORY_REPLAY_FAILED'); } catch { /* row stays protected */ }
    }
    running = false;
    if (!current()) { stop(); return; }
    scanCursor = nextCursor;
    if (wakePending) { wakePending = false; schedule(0); }
    else if (nextCursor != null) schedule(0);
    else {
      const dueDelay = scanRetryAt == null ? null : Math.max(0, scanRetryAt - Date.now());
      scanRetryAt = null;
      if (dueDelay != null) schedule(Math.min(maxDelayMs, dueDelay));
      else if (sawTransient || replayFailed) schedule(retryDelay);
    }
  }
  try { unsubscribe = store.subscribe(scopeKey, wake) || (() => {}); } catch { unsubscribe = () => {}; }
  eventTarget?.addEventListener?.('online', wake);
  schedule(0);
  return stop;
}

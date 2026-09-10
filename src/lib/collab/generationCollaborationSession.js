import { attachAuthSessionBridge } from './authSessionBridge.js';
import { attachDocumentCollaborationStatus } from './documentCollaborationStatus.js';
import { createGenerationLegacyRecovery } from './generationLegacyRecovery.js';
import { createGenerationPresence } from './generationPresence.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const roles = new Set(['owner', 'editor', 'viewer']);
const keys = (value, names) => Object.keys(value).sort().join('|') === names.sort().join('|');
const fail = () => Object.assign(new Error('This document session could not be verified. Saved work was kept.'), {
  code: 'GENERATION_COLLABORATION_UNAVAILABLE',
});

/** Authority, presence and retained-legacy recovery for one checked open.
 * Never creates a legacy Y.Doc, backfills, drains old queues or adopts old undo.
 * The caller still owns the modern annotation handle and its local save proof.
 * Deliberately not mounted by legacy app routes until full adoption is ready.
 */
export function createGenerationCollaborationSession({
  checkedBundle, generationSession, client, getCurrentActorUserId, isCurrentOpen = () => true,
  isActive = true, indexedDb = globalThis.indexedDB, timeoutMs = 15000,
  windowTarget = globalThis.window, documentTarget = globalThis.document,
  recoveryFactory = createGenerationLegacyRecovery, presenceFactory = createGenerationPresence,
}) {
  const { documentId, actorUserId, pdfGenerationId } = checkedBundle || {};
  const contentModelVersion = checkedBundle?.contentModelVersion ?? 1;
  if (![documentId, actorUserId, pdfGenerationId].every(v => typeof v === 'string' && UUID.test(v))
    || ![1, 2].includes(contentModelVersion)
    || generationSession?.documentId !== documentId || generationSession?.actorUserId !== actorUserId
    || generationSession?.pdfGenerationId !== pdfGenerationId
    || (generationSession?.contentModelVersion ?? 1) !== contentModelVersion
    || typeof generationSession.onSyncStatus !== 'function'
    || typeof generationSession.getGenerationStatus !== 'function' || typeof getCurrentActorUserId !== 'function'
    || typeof isCurrentOpen !== 'function'
    || !client?.rpc || !client?.auth?.getSession || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw fail();
  const pdf = Object.freeze({ ...checkedBundle.pdf });
  const publication = Object.freeze({ ...checkedBundle.publication });
  if (!keys(pdf, ['bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'])
    || pdf.bucket_id !== 'documents' || typeof pdf.path !== 'string' || !pdf.path || pdf.path.length > 2048
    || /[\u0000-\u001f\u007f]/.test(pdf.path) || !UUID.test(pdf.id) || !UUID.test(pdf.version)
    || typeof pdf.byte_length !== 'string' || !/^[1-9][0-9]{0,18}$/.test(pdf.byte_length)
    || BigInt(pdf.byte_length) > 9223372036854775807n || !/^[0-9a-f]{64}$/.test(pdf.content_sha256)
    || !keys(publication, ['operation_id', 'generation_id', 'published_at', 'wal_head'])
    || !UUID.test(publication.operation_id) || publication.generation_id !== pdfGenerationId
    || typeof publication.published_at !== 'string' || !Number.isFinite(Date.parse(publication.published_at))
    || typeof publication.wal_head !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(publication.wal_head)
    || BigInt(publication.wal_head) > 9223372036854775807n) throw fail();
  let disposed = false, retired = false, epoch = 0, pendingAuthority = null;
  let bridge, statusMonitor, presence, unsubscribeSync;
  const abort = new AbortController(), listeners = new Set(), closeChecks = new Set(), receipts = new WeakMap();
  let state = Object.freeze({ docRole: 'viewer', authorityStatus: 'checking', accessRevoked: false,
    loginExpired: false, isDocShared: null, presenceStatus: 'connecting',
    syncStatus: generationSession.getSyncStatus?.() ?? null });
  const unavailableState = Object.freeze({ docRole: 'viewer', authorityStatus: 'scope-changed', accessRevoked: true,
    loginExpired: true, isDocShared: null, presenceStatus: 'offline', syncStatus: null });
  const scopeCurrent = () => { try { return !disposed && getCurrentActorUserId() === actorUserId && isCurrentOpen() === true; } catch { return false; } };
  const authorityCurrent = () => scopeCurrent() && !retired && !abort.signal.aborted;
  function publish(next) {
    if (disposed || Object.keys(next).every(k => Object.is(state[k], next[k]))) return;
    if (['docRole', 'accessRevoked', 'loginExpired'].some(k => Object.hasOwn(next, k) && next[k] !== state[k])) {
      epoch++;
      for (const controller of closeChecks) controller.abort();
    }
    state = Object.freeze({ ...state, ...next });
    for (const listener of listeners) { try { listener(); } catch { /* isolate view subscribers */ } }
  }
  function seal(reason) {
    if (disposed) return;
    retired = true; abort.abort();
    statusMonitor?.dispose(); presence?.dispose();
    publish({ docRole: 'viewer', accessRevoked: true, authorityStatus: reason,
      loginExpired: reason === 'actor-changed' || state.loginExpired, presenceStatus: 'offline' });
  }
  function assertAuthority() {
    if (!scopeCurrent()) { seal('actor-changed'); throw fail(); }
    const generation = generationSession.getGenerationStatus();
    if (generation?.blocked !== false || generation.pdfGenerationId !== pdfGenerationId) seal('generation-retired');
    if (!authorityCurrent()) throw fail();
  }
  async function scopedWork(run) {
    assertAuthority();
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let timer;
    const stop = () => controller.abort();
    abort.signal.addEventListener('abort', stop, { once: true });
    const check = () => {
      assertAuthority();
      if (controller.signal.aborted || performance.now() >= deadline) throw fail();
    };
    const work = Promise.resolve().then(() => { check(); return run(controller.signal, check); });
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(fail()), { once: true });
        timer = setTimeout(stop, timeoutMs);
        if (controller.signal.aborted) reject(fail());
      })]);
    } catch { throw fail(); }
    finally { clearTimeout(timer); abort.signal.removeEventListener('abort', stop); controller.abort(); }
  }
  async function readActorSession(check) {
    const { data, error } = await client.auth.getSession();
    check();
    const session = data?.session;
    if (error || session?.user?.id !== actorUserId || typeof session.access_token !== 'string'
      || !session.access_token || session.access_token.length > 8192 || /\s/.test(session.access_token)) {
      seal('actor-changed'); throw fail();
    }
    return session;
  }
  const request = create => scopedWork(async (signal, check) => {
    const session = await readActorSession(check);
    check();
    let query = create();
    if (typeof query?.setHeader !== 'function' || typeof query?.abortSignal !== 'function') throw fail();
    query = query.setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(signal);
    const result = await query; check(); return result;
  });
  function authorize() {
    if (!authorityCurrent()) return Promise.resolve(false);
    if (pendingAuthority) return pendingAuthority;
    const task = Promise.resolve().then(async () => {
      const opened = await request(() => client.rpc('read_document_generation_collaboration', {
        p_document_id: documentId, p_generation_id: pdfGenerationId,
      }));
      if (opened.error) {
        if (['42501', 'SG001', 'SG002'].includes(opened.error.code)) seal('access-revoked');
        throw fail();
      }
      const value = opened.data;
      if (!value || value.version !== 1
        || !keys(value, ['version', 'actor_user_id', 'document_id', 'generation_id', 'pdf', 'publication', 'role'])
        || !value.pdf || !keys(value.pdf, Object.keys(pdf))
        || !value.publication || !keys(value.publication, Object.keys(publication))) throw fail();
      if (value?.actor_user_id !== actorUserId || value.document_id !== documentId || value.generation_id !== pdfGenerationId
        || !Object.keys(pdf).every(k => value.pdf?.[k] === pdf[k])
        || !Object.keys(publication).every(k => value.publication?.[k] === publication[k])) {
        seal('generation-retired'); throw fail();
      }
      if (value.role === null) { seal('access-revoked'); return false; }
      if (!roles.has(value.role)) throw fail();
      publish({ docRole: value.role, authorityStatus: 'confirmed' });
      return true;
    }).catch(() => {
      if (authorityCurrent()) publish({ docRole: 'viewer', authorityStatus: 'unavailable' });
      return false;
    }).finally(() => { if (pendingAuthority === task) pendingAuthority = null; });
    pendingAuthority = task;
    return task;
  }
  const recovery = recoveryFactory({ documentId, actorUserId, pdfGenerationId,
    contentModelVersion, indexedDb, isCurrent: scopeCurrent });
  const closeCurrent = receipt => {
    const issued = receipts.get(receipt);
    return Boolean(issued && scopeCurrent() && issued.epoch === epoch && recovery.isCurrent(issued.recovery));
  };
  async function closeOperation(operation, options = {}) {
    if (!scopeCurrent() || options.signal?.aborted) throw fail();
    const controller = new AbortController(), cancel = () => controller.abort();
    closeChecks.add(controller); options.signal?.addEventListener('abort', cancel, { once: true });
    const start = epoch;
    try {
      const result = await operation({ ...options, signal: controller.signal,
        readOnly: options.readOnly === true || state.docRole === 'viewer' || retired });
      if (!scopeCurrent() || start !== epoch || controller.signal.aborted) throw fail();
      return result;
    } catch { throw fail(); }
    finally { closeChecks.delete(controller); options.signal?.removeEventListener('abort', cancel); }
  }
  const localCloseSession = Object.freeze({
    prepareLocalClose: options => closeOperation(async checked => {
      const recovered = await recovery.prepare(checked), receipt = Object.freeze({});
      receipts.set(receipt, { recovery: recovered, epoch });
      if (!closeCurrent(receipt)) throw fail();
      return receipt;
    }, options),
    isLocalCloseReceiptCurrent: closeCurrent,
    validateLocalCloseReceipt: (receipt, options) => closeOperation(async checked => {
      if (!closeCurrent(receipt)) throw fail();
      const valid = await recovery.validate(receipts.get(receipt).recovery, checked);
      if (!valid || !closeCurrent(receipt)) throw fail();
      return true;
    }, options),
  });
  // Existing presentation monitor supplies visible-only coalesced refreshes.
  // Its reads are wrapped, not allowed to pick up a later actor's shared JWT.
  const scopedClient = {
    rpc: async () => await authorize() ? { data: state.docRole, error: null } : { error: { code: 'UNAVAILABLE' } },
    from(table) {
      if (table !== 'document_collaborators') throw fail();
      let query = client.from(table);
      const builder = {
        select(...args) { query = query.select(...args); return builder; },
        eq(...args) { query = query.eq(...args); return builder; },
        abortSignal() { return builder; }, // the session request owns its abort signal
        then(resolve, reject) { return request(() => query).then(resolve, reject); },
      };
      return builder;
    },
    channel: (...args) => client.channel(...args),
    removeChannel: channel => client.removeChannel(channel),
  };
  function dispose() {
    if (disposed) return;
    disposed = true; abort.abort();
    for (const controller of closeChecks) controller.abort();
    statusMonitor?.dispose(); presence?.dispose(); bridge?.detach(); unsubscribeSync?.(); listeners.clear();
  }
  try {
    bridge = attachAuthSessionBridge({ supabase: client, expectedUserId: actorUserId,
      onActorChanged: () => seal('actor-changed'), onError: () => publish({ presenceStatus: 'offline' }) });
    assertAuthority();
    unsubscribeSync = generationSession.onSyncStatus(next => {
      if (!scopeCurrent()) { seal('actor-changed'); return; }
      if (generationSession.getGenerationStatus().blocked) seal('generation-retired');
      publish({ syncStatus: next });
    });
    statusMonitor = attachDocumentCollaborationStatus({ client: scopedClient, documentId, actorUserId,
      getSession: () => scopedWork((_, check) => readActorSession(check)),
      isCurrent: authorityCurrent, signal: abort.signal, isActive, windowTarget, documentTarget,
      onRole: role => { if (authorityCurrent()) publish({ docRole: roles.has(role) ? role : 'viewer' }); },
      onSharedState: shared => { if (authorityCurrent()) publish({ isDocShared: shared }); },
      onAccessDenied: () => seal('access-revoked') });
    presence = presenceFactory({ client, documentId, actorUserId, pdfGenerationId, isCurrent: authorityCurrent,
      authorize, isActive, onStatus: next => { if (authorityCurrent()) publish({ presenceStatus: next }); } });
  } catch { dispose(); throw fail(); }
  return Object.freeze({
    getState: () => scopeCurrent() ? state : unavailableState,
    isCurrent: authorityCurrent,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    authorize,
    localCloseSession,
    getAwareness: () => authorityCurrent() ? presence?.getAwareness() ?? null : null,
    setActive(value) { if (!disposed) { statusMonitor?.setActive(value); presence?.setActive(value); } },
    checkActor() { if (!scopeCurrent()) seal('actor-changed'); },
    dispose,
  });
}

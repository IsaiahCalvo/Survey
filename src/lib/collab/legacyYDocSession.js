import { attachAuthSessionBridge } from './authSessionBridge.js';
import { attachLifecycle } from './ydocLifecycle.js';
import { getLegacyYDocScopeKey } from './legacyYDocScope.js';
import { createTransportProviderCoordinator } from './transportStatus.js';

/** One actor-bound generation. Callers retain the registry doc on retirement;
 * this handle never destroys, relabels, imports, or deletes pending data.
 * Capture this handle, not a ref to a later handle, across each async operation.
 */
export function attachLegacyYDocSession({
  ydoc, documentId, actorUserId, supabase, getSession, createTransportProvider,
  onStorageState, onRoleChange, onTransportState, onUpdateRejected, onRetired,
  onSignedOut, attachLocalLifecycle = attachLifecycle,
}) {
  const scopeKey = getLegacyYDocScopeKey(documentId, actorUserId);
  if (!ydoc || typeof getSession !== 'function' || typeof createTransportProvider !== 'function') {
    throw new TypeError('ydoc, getSession and createTransportProvider are required');
  }
  if (ydoc.guid !== scopeKey) throw new Error('Y.Doc does not match the actor/document scope');
  if (ydoc.isDestroyed) throw new Error('Cannot attach a destroyed Y.Doc');
  const controller = new AbortController();
  let retired = false;
  let detached = false;
  let bridge = null;
  let lifecycle = null;
  let provider = null;
  let closePromise = null;
  const isCurrent = () => !retired && !detached;
  const closeLocal = () => {
    if (!lifecycle || closePromise) return closePromise;
    // The registry still owns the live bytes. Completion here only means that
    // local resources closed; it is NOT a durable-save receipt.
    try { closePromise = Promise.resolve(lifecycle.detach()); }
    catch (error) { closePromise = Promise.reject(error); }
    // Auth callbacks cannot await cleanup. Keep the original rejection for an
    // explicit detach() caller without leaking an unhandled rejection here.
    closePromise.catch(() => {});
    return closePromise;
  };
  const retire = (state) => {
    if (!isCurrent()) return;
    retired = true;
    controller.abort();
    coordinator.dispose();
    ydoc.off('destroy', onDestroyed);
    closeLocal();
    bridge?.detach();
    try {
      onRetired?.({ ...state, documentId, actorUserId, localStateRetained: !ydoc.isDestroyed });
    } catch { console.warn('[legacyYDocSession] Retirement callback failed'); }
  };
  const coordinator = createTransportProviderCoordinator({
    getCurrentProvider: () => provider,
    setCurrentProvider: (next) => { provider = next; },
    createProvider: async ({ isCurrent: isCurrentAttempt }) => {
      const current = () => isCurrent() && isCurrentAttempt();
      if (!current()) return null;
      const session = await getSession();
      if (!current()) return null;
      if (session?.user?.id !== actorUserId) {
        retire({ event: 'SESSION_CHECK', userId: session?.user?.id ?? null });
        return null;
      }
      return createTransportProvider({
        documentId, ydoc, supabase, isCurrent: current, signal: controller.signal,
        onTransportState: (state) => { if (current()) onTransportState?.(state); },
        onUpdateRejected: (reason) => { if (current()) onUpdateRejected?.(reason); },
      });
    },
  });
  const onDestroyed = () => retire({ event: 'DOCUMENT_DESTROYED', userId: actorUserId });
  ydoc.on('destroy', onDestroyed);
  try {
    // Listen before opening local channels or starting any network work. An
    // initial event may fire synchronously in a client adapter.
    bridge = attachAuthSessionBridge({
      supabase, expectedUserId: actorUserId,
      onActorChanged: retire,
      onSignedOut,
      onError: () => { if (isCurrent()) onTransportState?.('offline'); },
    });
    if (isCurrent()) {
      lifecycle = attachLocalLifecycle(ydoc, documentId, {
        actorUserId,
        onStorageState: (state) => { if (isCurrent()) onStorageState?.(state); },
        onRoleChange: (role) => { if (isCurrent()) onRoleChange?.(role); },
      });
    }
    if (!isCurrent()) {
      bridge.detach();
      closeLocal();
    }
  } catch (error) {
    detached = true;
    controller.abort();
    coordinator.dispose();
    ydoc.off('destroy', onDestroyed);
    bridge?.detach();
    closeLocal();
    throw error;
  }
  return Object.freeze({
    scopeKey,
    isCurrent,
    signal: controller.signal,
    role: () => lifecycle?.role() ?? 'unknown',
    getProvider: () => provider,
    restartTransport: () => isCurrent() ? coordinator.restart() : Promise.resolve(null),
    detach() {
      if (detached) return closePromise;
      detached = true;
      controller.abort();
      coordinator.dispose();
      ydoc.off('destroy', onDestroyed);
      bridge?.detach();
      return closeLocal();
    },
  });
}

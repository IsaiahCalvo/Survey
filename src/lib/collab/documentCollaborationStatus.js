import { fetchMyDocumentRole } from './documentRole.js';
import { hasRemoteDocumentCollaborator } from './transportStatus.js';

/** One runtime's presentation reads, not its sync transport or save queue.
 * Initial role authority is unchanged: resolve once on open. Shared-status
 * refreshes borrow that first request, then share only pending role requests.
 * Nothing is cached across runtimes, actors, or document opens.
 */
export function attachDocumentCollaborationStatus({
  client, documentId, actorUserId, getSession, isCurrent, signal,
  onSharedState, onRole, isActive = true,
  windowTarget = globalThis.window, documentTarget = globalThis.document,
}) {
  let disposed = false;
  let active = isActive;
  let timer = null;
  let channel = null;
  let pending = null;
  let rolePending = null;
  let dirty = false;
  let generation = 0;
  const requestAbort = new AbortController();
  const current = () => !disposed && !signal?.aborted && isCurrent();
  const visible = () => active && documentTarget?.hidden !== true;

  function readRole() {
    if (!current()) return Promise.resolve(null);
    if (rolePending) return rolePending.generation === generation
      ? rolePending.promise : rolePending.promise.then(() => readRole());
    const request = { generation, promise: fetchMyDocumentRole(client, documentId) };
    rolePending = request;
    request.promise.finally(() => { if (rolePending === request) rolePending = null; });
    return request.promise;
  }

  function refresh(initial = false) {
    if (!current() || (!initial && !visible())) return;
    if (pending) return pending;
    dirty = false;
    const requestedGeneration = generation;
    const canPublish = () => current() && generation === requestedGeneration;
    // Defer execution so even a synchronous dependency failure cannot leave a
    // settled promise registered as pending forever.
    const request = Promise.resolve().then(async () => {
      let initialRole;
      try {
        const session = await getSession();
        if (!current()) return;
        if (!initial && !visible()) { dirty = true; return; }
        if (session?.user?.id !== actorUserId) {
          if (canPublish()) onSharedState(null);
          if (initial) onRole(null);
          return;
        }
        if (initial) {
          initialRole = readRole();
          initialRole.then(role => { if (current()) onRole(role); });
        }
        let query = client.from('document_collaborators').select('user_id')
          .eq('document_id', documentId).eq('status', 'active');
        if (typeof query.abortSignal === 'function') query = query.abortSignal(requestAbort.signal);
        const { data, error } = await query;
        if (!canPublish()) return;
        if (error) { onSharedState(null); return; }
        const ids = (data || []).map(row => row?.user_id).filter(Boolean);
        if (ids.some(id => id !== actorUserId)) { onSharedState(true); return; }
        // With no own row, the role cannot change this decision. Avoid a role
        // RPC for every private-document poll (the common case).
        if (!ids.includes(actorUserId)) { onSharedState(false); return; }
        if (!initial && !visible()) { dirty = true; return; }
        const role = await (initialRole || readRole());
        if (canPublish()) onSharedState(role == null ? null : hasRemoteDocumentCollaborator({
          activeCollaboratorUserIds: ids, currentUserId: actorUserId, currentRole: role,
        }));
      } catch {
        if (canPublish()) onSharedState(null);
        if (initial && !initialRole && current()) onRole(null);
      }
    });
    pending = request;
    request.finally(() => {
      if (pending === request) pending = null;
      if (dirty && current() && visible()) refresh();
    });
    return request;
  }

  function invalidate() {
    if (!current()) return;
    generation++;
    dirty = true;
    refresh();
  }

  function updateTimer() {
    if (timer !== null) clearInterval(timer);
    timer = current() && visible() ? setInterval(() => refresh(), 30_000) : null;
  }

  function visibilityChanged() {
    updateTimer();
    if (visible()) invalidate();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    requestAbort.abort();
    if (timer !== null) clearInterval(timer);
    timer = null;
    windowTarget?.removeEventListener('focus', invalidate);
    windowTarget?.removeEventListener('online', invalidate);
    documentTarget?.removeEventListener('visibilitychange', visibilityChanged);
    signal?.removeEventListener('abort', dispose);
    if (channel) {
      try { Promise.resolve(client.removeChannel(channel)).catch(() => {}); } catch { /* best effort */ }
    }
  }

  if (current()) {
    signal?.addEventListener('abort', dispose, { once: true });
    windowTarget?.addEventListener('focus', invalidate);
    windowTarget?.addEventListener('online', invalidate);
    documentTarget?.addEventListener('visibilitychange', visibilityChanged);
    try {
      const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      channel = client.channel(`ydoc-shared-state:${documentId}:${suffix}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'document_collaborators',
          filter: `document_id=eq.${documentId}`,
        }, invalidate).subscribe();
    } catch { /* The visible fallback poll still checks sharing. */ }
    updateTimer();
    refresh(true);
  }
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      updateTimer();
      if (active) invalidate();
    },
    dispose,
  };
}

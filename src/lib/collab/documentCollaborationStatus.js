import { KNOWN_DOCUMENT_ROLES } from './documentRole.js';
import { hasRemoteDocumentCollaborator } from './transportStatus.js';

/** One runtime's presentation reads, not its sync transport or save queue.
 * Access events and wake/reconnect refresh role authority as well as sharing.
 * A confirmed private-owner poll still avoids an unnecessary role read.
 * Non-owner/unknown polls recheck access in case an access event was missed. Pending
 * reads share one refresh, with one trailing read after invalidation.
 * Nothing is cached across runtimes, actors, or document opens.
 */
export function attachDocumentCollaborationStatus({
  client, documentId, actorUserId, getSession, isCurrent, signal,
  onSharedState, onRole, onAccessDenied, isActive = true,
  windowTarget = globalThis.window, documentTarget = globalThis.document,
}) {
  let disposed = false;
  let active = isActive;
  let timer = null;
  let channel = null;
  let pending = null;
  let roleNeedsRefresh = true;
  let lastConfirmedRole = null;
  let channelHasJoined = false;
  let channelNeedsRefresh = false;
  let dirty = false;
  let generation = 0;
  const requestAbort = new AbortController();
  const current = () => !disposed && !signal?.aborted && isCurrent();
  const visible = () => active && documentTarget?.hidden !== true;

  async function readRole() {
    try {
      const { data, error } = await client.rpc('get_my_document_role', { doc_id: documentId });
      if (error) return { kind: 'unknown' };
      if (data === null) return { kind: 'denied' };
      return KNOWN_DOCUMENT_ROLES.includes(data) ? { kind: 'role', role: data } : { kind: 'unknown' };
    } catch {
      return { kind: 'unknown' };
    }
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
      let roleWork;
      const requestRole = () => {
        if (roleWork) return roleWork;
        if (!canPublish()) return Promise.resolve(null);
        roleNeedsRefresh = false;
        roleWork = readRole().then(result => {
          if (!canPublish()) return null;
          if (result.kind === 'role') {
            lastConfirmedRole = result.role;
            onRole(result.role);
            return result.role;
          }
          if (result.kind === 'denied') {
            lastConfirmedRole = null;
            // A confirmed denial is not a viewer role. Use the existing
            // revoked-access gate; successful reads never clear that gate.
            onAccessDenied?.();
            onRole(null);
          } else {
            // Keep a confirmed viewer restriction during a transient failure.
            // Initial unknown retains the prior presentation contract.
            roleNeedsRefresh = true;
            if (initial) onRole(null);
          }
          return null;
        });
        return roleWork;
      };
      try {
        const session = await getSession();
        if (!canPublish()) return;
        if (!initial && !visible()) { dirty = true; return; }
        if (session?.user?.id !== actorUserId) {
          if (canPublish()) onSharedState(null);
          if (initial && canPublish()) onRole(null);
          return;
        }
        if (initial || roleNeedsRefresh || lastConfirmedRole !== 'owner') requestRole();
        let query = client.from('document_collaborators').select('user_id')
          .eq('document_id', documentId).eq('status', 'active');
        if (typeof query.abortSignal === 'function') query = query.abortSignal(requestAbort.signal);
        const { data, error } = await query;
        if (!canPublish()) return;
        if (error) { onSharedState(null); return; }
        const ids = (data || []).map(row => row?.user_id).filter(Boolean);
        if (ids.some(id => id !== actorUserId)) { onSharedState(true); return; }
        // With no own row, the role cannot change the sharing decision. A
        // non-owner's authority was still checked above: its missing row may
        // mean revoked access, not a newly private document.
        if (!ids.includes(actorUserId)) { onSharedState(false); return; }
        if (!initial && !visible()) { dirty = true; return; }
        const role = await requestRole();
        if (canPublish()) onSharedState(role == null ? null : hasRemoteDocumentCollaborator({
          activeCollaboratorUserIds: ids, currentUserId: actorUserId, currentRole: role,
        }));
      } catch {
        if (canPublish()) onSharedState(null);
        if (initial && !roleWork && canPublish()) onRole(null);
      } finally {
        // Keep the role request inside the shared pending lifetime, including
        // the remote-collaborator and private-document early-return paths.
        await roleWork;
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
    roleNeedsRefresh = true;
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
        }, invalidate).subscribe(status => {
          if (!current()) return;
          if (status === 'SUBSCRIBED') {
            const refreshAfterJoin = channelHasJoined || channelNeedsRefresh;
            channelHasJoined = true;
            channelNeedsRefresh = false;
            if (refreshAfterJoin) invalidate();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            channelNeedsRefresh = true;
          }
        });
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

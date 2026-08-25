// ?docId= deep-link + invite-accept helpers.
// Extracted so Node can prove the visitor list is not the only resolver.

export function findOwnedDeepLinkDocument(documents, documentId) {
  if (documentId == null || documentId === '') return null;
  return (documents || []).find(
    (document) => String(document?.id) === String(documentId),
  ) || null;
}

export async function resolveDeepLinkDocument({
  documents,
  documentId,
  loadInviteDocument,
} = {}) {
  const owned = findOwnedDeepLinkDocument(documents, documentId);
  if (owned) return { document: owned, source: 'owned-list' };
  if (!documentId || typeof loadInviteDocument !== 'function') {
    return { document: null, source: 'unresolved' };
  }
  const invited = await loadInviteDocument(documentId);
  if (invited) return { document: invited, source: 'invite' };
  return { document: null, source: 'unresolved' };
}

/**
 * Link-only invites stay reusable after the first accept. The RPC stamps
 * accepted_by on the first visitor and then returns already_accepted for
 * everyone else — including a second real account that still has no grant.
 */
export function interpretInviteAcceptResult({
  rpcStatus,
  invite,
  currentUserId,
  hasActiveGrant,
} = {}) {
  if (rpcStatus !== 'already_accepted') {
    return { status: rpcStatus || 'invalid', action: 'use-rpc' };
  }
  if (hasActiveGrant || (currentUserId && invite?.accepted_by === currentUserId)) {
    return { status: 'already_accepted', action: 'open-existing' };
  }
  if (invite?.revoked_at) return { status: 'revoked', action: 'stop' };
  if (invite?.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: 'expired', action: 'stop' };
  }
  if (invite && !invite.target_email) {
    return { status: 'accepted', action: 'grant-from-invite' };
  }
  return { status: 'already_accepted', action: 'stop' };
}

export function inviteRowsToVoidOnRemove(invites, { documentId, userId } = {}) {
  if (!documentId || !userId) return [];
  return (invites || []).filter((invite) => (
    String(invite?.document_id) === String(documentId)
    && !invite?.revoked_at
    && String(invite?.accepted_by) === String(userId)
  ));
}

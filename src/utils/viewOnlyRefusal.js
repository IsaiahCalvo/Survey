// Round 5 #19: someone made a Viewer (or Commenter) after a change of theirs
// was refused. The View-only banner already says they can't edit, so the
// refusal reads 'view-only': no lasting error, and the sync chip shows the
// cloud copy's real state instead of "Not saved". The refused change stays
// kept aside on the device; nothing is deleted.
export const VIEW_ONLY_SYNC_STATUS = Object.freeze({ stage: 'idle', healthy: true, error: null });

export function viewOnlyRefusal(editBlocked, docRole) {
  return editBlocked === 'denied' && (docRole === 'viewer' || docRole === 'commenter');
}

// What the viewer shows for a refused edit, given the person's role now.
export function presentEditBlocked({ editBlocked, syncStatus, docRole }) {
  if (!viewOnlyRefusal(editBlocked, docRole)) return { editBlocked, syncStatus };
  return {
    editBlocked: 'view-only',
    syncStatus: syncStatus?.stage === 'blocked' ? VIEW_ONLY_SYNC_STATUS : syncStatus,
  };
}

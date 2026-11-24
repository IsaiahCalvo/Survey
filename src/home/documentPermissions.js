// Rename, delete and share are owner-only on the server (RLS). The UI greys
// them out for a shared viewer/editor instead of failing with a raw error.
export function canManageDocument(raw, userId) {
  return Boolean(raw && ((userId && raw.user_id === userId) || raw.my_role === 'owner'));
}

// For a multi-selection: null when every selected document can be managed
// (null, not false: SelectModeButtons reads `can: false` as "off"),
// otherwise the reason (used as the disabled tooltip).
export function manageSelectionBlock(raws, userId, verb) {
  const list = Array.isArray(raws) ? raws : [];
  if (list.every((raw) => canManageDocument(raw, userId))) return null;
  return `Only the owner can ${verb} ${list.length > 1 ? 'some of these' : 'this'}`;
}

// Share on one document: why it is off, or null. A file kept only on this
// device can't be shared at all, owner or not, so it says that instead of
// "Only the owner can share this" (round 4 audit, r4d #5).
export function shareBlockReason(raw, userId) {
  if (raw?.device_file) {
    return userId
      ? 'Files on this device can’t be shared. Save it to your account first.'
      : 'Files on this device can’t be shared. Sign in and save it to your account first.';
  }
  return manageSelectionBlock([raw], userId, 'share');
}

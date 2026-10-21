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

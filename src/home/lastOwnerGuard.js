// Client-side last-owner gate used by AccessManagementModal.
// The SQL trigger is the source of truth; this avoids a round-trip for the
// obvious last-owner demote/remove cases.

export function countActiveOwners(members = []) {
  return members.filter((member) => String(member?.role || '').toLowerCase() === 'owner').length;
}

export function lastOwnerBlockReason({ members = [], member, action, nextRole } = {}) {
  const role = String(member?.role || '').toLowerCase();
  if (role !== 'owner') return null;
  if (countActiveOwners(members) > 1) return null;
  if (action === 'demote' && String(nextRole || '').toLowerCase() !== 'owner') {
    return 'You cannot demote the last owner. Promote another collaborator first.';
  }
  if (action === 'remove') {
    return 'You cannot remove the last owner. Promote another collaborator first.';
  }
  return null;
}

/**
 * Advanced Survey entitlement is always required to manage Spaces and Regions.
 * On shared documents, the collaborator must also hold an editing role.
 *
 * A paid plan never upgrades a shared document's viewer role, and an editor
 * role never bypasses the user's personal plan.
 */
export function canManageCollaborativeSpaces({
  hasAdvancedSurvey,
  documentId,
  documentOwnerId,
  viewerId,
  documentRole,
}) {
  if (!hasAdvancedSurvey) return false;
  if (!documentId) return true;
  if (!viewerId) return false;
  if (documentOwnerId && documentOwnerId === viewerId) return true;
  return documentRole === 'editor' || documentRole === 'owner';
}

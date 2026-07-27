/**
 * A collaborator's document role, not their personal plan, controls whether
 * they can edit Spaces inside somebody else's shared document.
 *
 * This grant is deliberately narrow: it does not unlock survey templates,
 * exports, or Space creation in the Free user's own documents.
 */
export function canManageCollaborativeSpaces({
  hasAdvancedSurvey,
  documentId,
  documentOwnerId,
  viewerId,
  documentRole,
}) {
  if (hasAdvancedSurvey) return true;
  if (!documentId || !documentOwnerId || !viewerId) return false;
  return documentRole === 'editor' && documentOwnerId !== viewerId;
}

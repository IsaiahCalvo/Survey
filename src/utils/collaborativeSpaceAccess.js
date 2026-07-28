/**
 * A collaborator's document role, not their personal plan, controls whether
 * they can edit Spaces inside somebody else's shared document.
 *
 * This grant is deliberately narrow: a paid plan never upgrades a shared
 * document's viewer role, and a collaborator grant does not unlock survey
 * templates, exports, or Space creation in the Free user's own documents.
 */
export function canManageCollaborativeSpaces({
  hasAdvancedSurvey,
  documentId,
  documentOwnerId,
  viewerId,
  documentRole,
}) {
  if (!documentId) return !!hasAdvancedSurvey;
  if (!documentOwnerId || !viewerId) return false;
  if (documentOwnerId === viewerId) {
    return !!hasAdvancedSurvey;
  }
  return documentRole === 'editor' || documentRole === 'owner';
}

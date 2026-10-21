// Share on a project file is allowed by the server for the uploader, a
// document collaborator-owner, or the project's owner (user_can_access_document
// with required_role 'owner'). Viewers and editors of a shared project get
// Share greyed out instead of a raw database error.
export function canManageProjectFile(file, project, userId) {
  if (!file || userId == null) return false;
  if (file.user_id === userId) return true;
  if (file.my_role === 'owner') return true;
  return Boolean(project && project.user_id != null && project.user_id === userId);
}

// Delete goes through archive_document, which only accepts documents.user_id.
// Project owners and collaborator-owners still get not_owner from the RPC.
export function canDeleteProjectFile(file, userId) {
  return Boolean(file && userId != null && file.user_id === userId);
}

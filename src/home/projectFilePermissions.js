// Delete and Share on a project file are allowed by the server only for the
// person who uploaded the file or the project's owner. Viewers and editors of
// a shared project get these greyed out instead of a raw database error.
export function canManageProjectFile(file, project, userId) {
  if (!file || userId == null) return false;
  if (file.user_id === userId) return true;
  if (file.my_role === 'owner') return true;
  return Boolean(project && project.user_id != null && project.user_id === userId);
}

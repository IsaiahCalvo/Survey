// Delete and Share on a project file are allowed by the server only for the
// person who uploaded the file or the project's owner. Viewers and editors of
// a shared project get these greyed out instead of a raw database error.
export function canManageProjectFile(file, project, userId) {
  if (!file || userId == null) return false;
  if (file.user_id === userId) return true;
  if (file.my_role === 'owner') return true;
  return Boolean(project && project.user_id != null && project.user_id === userId);
}

// Deleting or sharing a whole project is owner-only on the server.
export function canManageProject(project, userId) {
  if (!project || userId == null) return false;
  if (project.my_role === 'owner') return true;
  return project.user_id != null && project.user_id === userId;
}

// Projects select bar: Share and Delete need every selected project to be
// yours, the same rule as the row menu. A string is the reason a tap shows.
export function projectSelectionCan(projects, userId) {
  const list = Array.isArray(projects) ? projects : [];
  const owned = list.length > 0 && list.every((p) => canManageProject(p, userId));
  const reason = owned ? true : 'Only the project owner can do this';
  return { delete: reason, share: list.length > 1 ? 'Share one project at a time' : reason };
}

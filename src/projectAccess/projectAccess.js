/* Projects: project settings and access (flag `project-access`, Drawboard
   Projects parity PS-01..21 in drawboard-trial/deep/projects-parity-spec.md).
   Pure helpers, no React and no network (tests/projectAccess.test.mjs). The
   screens are ProjectSettings.jsx; the tables and functions are migration
   20261114130000_project_access.sql. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_FOR_MIME = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

/** Cover picture path: <project>/cover-<n>.<ext>, n counting up on each change
   so a cached old picture never shows. The server checks the same shape. */
export function coverPath(projectId, previousPath, mime) {
  const ext = EXT_FOR_MIME[mime];
  if (!ext || !UUID_RE.test(String(projectId || ''))) return null;
  const m = /\/cover-(\d{1,6})\.(jpg|png|webp)$/.exec(String(previousPath || ''));
  const next = m ? (Number(m[1]) % 999999) + 1 : 1;
  return `${String(projectId).toLowerCase()}/cover-${next}.${ext}`;
}

/* Access choices, in Drawboard's order: Private, then company-wide with one
   role for everyone. Survey's company is Drawboard's workspace. */
export const ACCESS_PRIVATE = 'private';
export const ACCESS_COMPANY = 'company';
export const COMPANY_ROLES = Object.freeze([
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
]);

/** The project's access as the settings card shows it. */
export function accessOf(project) {
  const role = project?.company_access;
  return role === 'viewer' || role === 'editor'
    ? { kind: ACCESS_COMPANY, role }
    : { kind: ACCESS_PRIVATE, role: 'viewer' };
}

/** One line for the Team banner and the card's note. */
export function accessSummary(project, companyName) {
  const a = accessOf(project);
  if (a.kind === ACCESS_PRIVATE) return 'Private: only people you invite can open this project.';
  const who = companyName ? `Everyone in ${companyName}` : 'Everyone in your company';
  return `${who} can open this project as ${a.role === 'editor' ? 'an Editor' : 'a Viewer'}.`;
}

/** The role the server should get: null for Private. */
export const accessRoleToSave = (kind, role) => (kind === ACCESS_COMPANY && (role === 'viewer' || role === 'editor') ? role : null);

/** Trimmed fields and what changed, for the Save button. */
export function settingsChanges(project, draft) {
  const name = String(draft?.name ?? '').trim();
  const description = String(draft?.description ?? '').trim();
  const out = {};
  if (name && name !== (project?.name || '')) out.name = name;
  if (description !== (project?.description || '')) out.description = description;
  const before = accessOf(project);
  const nextRole = accessRoleToSave(draft?.access, draft?.role);
  const beforeRole = accessRoleToSave(before.kind, before.role);
  if (nextRole !== beforeRole) out.access = nextRole;
  if (draft?.coverFile) out.coverFile = draft.coverFile;
  if (draft?.removeCover && project?.cover_path) out.removeCover = true;
  return out;
}

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 1000;

export function settingsProblem(draft) {
  const name = String(draft?.name ?? '').trim();
  if (!name) return 'Give the project a name.';
  if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (String(draft?.description ?? '').trim().length > DESCRIPTION_MAX) return `Keep the description under ${DESCRIPTION_MAX} characters.`;
  return null;
}

/** Closed projects swap places with the open list, as Drawboard's Show archived. */
export function projectsForList(projects, showClosed) {
  return (projects || []).filter((p) => Boolean(p?.closed_at) === Boolean(showClosed));
}

export const closedCount = (projects) => (projects || []).filter((p) => p?.closed_at).length;

/** Who may leave: anyone but the owner. */
export function leaveBlock(project, userId, role) {
  if (!project || !userId) return 'Sign in first';
  if (project.user_id === userId || String(role || '').toLowerCase() === 'owner') return 'You own this project, so you can’t leave it';
  return null;
}

/* "What can each role do?" — Survey's three roles. */
export const ROLE_GUIDE = Object.freeze([
  { can: 'Open the project and every document in it', owner: true, editor: true, viewer: true },
  { can: 'See issues, tasks, photos and activity', owner: true, editor: true, viewer: true },
  { can: 'Mark up documents and answer surveys', owner: true, editor: true, viewer: false },
  { can: 'Add files, photos, issues and tasks', owner: true, editor: true, viewer: false },
  { can: 'Rename the project, change its cover and description', owner: true, editor: true, viewer: false },
  { can: 'Invite people, change roles, remove people', owner: true, editor: false, viewer: false },
  { can: 'Change who can open the project', owner: true, editor: false, viewer: false },
  { can: 'Close, reopen or delete the project', owner: true, editor: false, viewer: false },
  { can: 'Leave the project', owner: false, editor: true, viewer: true },
]);

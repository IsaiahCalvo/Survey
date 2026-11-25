// Who may do what on a shared document or project, and the role names the
// pickers offer.
//
// Owner, 2026-11-24 (audit round 5, #6): a Commenter sits between Viewer and
// Editor. They read everything a Viewer reads and may comment, reply and
// resolve, but never draw, answer Survey items or change the file. The
// pickers offer it in Nightly only (flag commenter-role). Every build reads a
// Commenter as a Viewer for drawing, so a stable build never hands them tools.
import { isFeatureOn } from '../featureFlags.js';

export const COMMENTER_ROLE_FLAG = 'commenter-role';

/** May the role post and answer comments? */
export function canCommentRole(role) {
  const r = String(role || '').toLowerCase();
  return r === 'owner' || r === 'editor' || r === 'commenter';
}

/** The role as the drawing tools see it: a Commenter draws as a Viewer. */
export function drawingRole(role) {
  return String(role || '').toLowerCase() === 'commenter' ? 'viewer' : role;
}

/** Role names for the pickers, highest first: Owner, Editor, (Commenter,) Viewer. */
export function roleNamesHighToLow(commenterOn = isFeatureOn(COMMENTER_ROLE_FLAG)) {
  return commenterOn ? ['Owner', 'Editor', 'Commenter', 'Viewer'] : ['Owner', 'Editor', 'Viewer'];
}

/** Sort rank for a role name or value (Owner first). */
export function roleRank(role) {
  const r = String(role || '').toLowerCase();
  return { owner: 0, editor: 1, commenter: 2, viewer: 3 }[r] ?? 4;
}

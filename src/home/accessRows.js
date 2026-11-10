/* One person, one row in Manage Access / Manage Team (inviteFix, 2026-10-07).
 *
 * The access lists draw the collaborator rows and the pending email invites
 * side by side. When an invite email to an existing account fails, the
 * account already HAS access (an active collaborator row) but its invite row
 * stays open (accepted_at is only written after the email goes out), so the
 * same person showed twice: once Active, once Pending with Resend.
 *
 * Client-side rule: a pending email invite whose address already belongs to
 * a listed (active) member is not shown. Resend / Revoke are for people who
 * do not have access yet. No database change.
 * Tests: tests/accessRows.test.mjs.
 */

const norm = (v) => String(v || '').trim().toLowerCase();

/** Invites that are still open: not accepted, not revoked, not expired. */
export function openInvites(invites, now = Date.now()) {
  const list = Array.isArray(invites) ? invites : [];
  const t = now instanceof Date ? now.getTime() : Number(now);
  return list.filter((i) => i
    && !i.accepted_at
    && !i.revoked_at
    && new Date(i.expires_at).getTime() > t);
}

/**
 * Open invites in their original order, leaving out any email invite for
 * someone who is already a member.
 * @param members rows carrying `email` or `user.email`
 */
export function visibleOpenInvites(invites, members, now = Date.now()) {
  const memberEmails = new Set();
  for (const m of Array.isArray(members) ? members : []) {
    const email = norm(m?.user?.email || m?.email);
    if (email) memberEmails.add(email);
  }
  return openInvites(invites, now)
    .filter((i) => !i.target_email || !memberEmails.has(norm(i.target_email)));
}

/** The same, split into link-only invites and pending email invites. */
export function accessInviteRows(invites, members, now = Date.now()) {
  const open = visibleOpenInvites(invites, members, now);
  return {
    links: open.filter((i) => !i.target_email),
    emails: open.filter((i) => i.target_email),
  };
}

/**
 * Display text for one member row (share-dialog fix, 2026-10-21). Never a
 * raw user id: the owner row often carries no email of its own, so it uses
 * the owner profile (get_document_owner_profile) or the signed-in user's own
 * account, and otherwise falls back to a role word.
 * @returns {{ primary: string, secondary: string, title: string }}
 */
export function memberIdentity(member, { owner = null, currentUser = null } = {}) {
  const m = member || {};
  const id = m.user_id || m.user?.id || null;
  const role = norm(m.role);
  let name = String(m.user?.name || m.name || m.display_name || '').trim();
  let email = String(m.user?.email || m.email || '').trim();
  const fill = (n, e) => {
    if (!name && n) name = String(n).trim();
    if (!email && e) email = String(e).trim();
  };
  if (owner && ((id && owner.user_id === id) || (!owner.user_id && role === 'owner'))) {
    fill(owner.name, owner.email);
  }
  if (currentUser && id && currentUser.id === id) {
    const meta = currentUser.user_metadata || {};
    fill(meta.full_name || meta.name, currentUser.email);
  }
  const fallback = role === 'owner' ? 'Owner' : 'Collaborator';
  const primary = name || email || fallback;
  const secondary = name && email ? email : '';
  return { primary, secondary, title: [name, email].filter(Boolean).join(' · ') || fallback };
}

/* ---- Share dialog extras (Nightly flag share-extras) -------------------
 * Drawboard's share dialog always lists the owner first, marks your own row
 * "(you)", and sorts the people by Role, Name or Activity (Role first).
 * Tests: tests/shareExtras.test.mjs. */

export const ACCESS_SORTS = Object.freeze([
  Object.freeze({ key: 'role', label: 'Role' }),
  Object.freeze({ key: 'name', label: 'Name' }),
  Object.freeze({ key: 'activity', label: 'Activity' }),
]);

const ROLE_RANK = { owner: 0, editor: 1, commenter: 2, viewer: 3 };

/**
 * The member list with the document's owner in it. Documents made before
 * sharing often have no collaborator row for their owner, so the dialog said
 * "No collaborators yet" while the owner plainly had it. A stand-in row is
 * added from the owner profile (or your own account when it is yours).
 */
export function withOwnerRow(members, { ownerId = null, ownerProfile = null, currentUser = null } = {}) {
  const list = Array.isArray(members) ? members : [];
  const id = ownerId || ownerProfile?.user_id || null;
  if (!id) return list;
  if (list.some((m) => (m?.user_id || m?.user?.id) === id)) return list;
  const mine = currentUser?.id === id;
  const email = ownerProfile?.email || (mine ? currentUser?.email : '') || '';
  return [{ id: `owner:${id}`, user_id: id, role: 'owner', status: 'active', email, standIn: true }, ...list];
}

/**
 * Members in the chosen order. The document's owner always comes first, as
 * in Drawboard; the rest go by role (Owner, Editor, Viewer), by name, or by
 * who opened the document most recently (never opened last).
 * @param activity Map of user id -> last opened ISO time
 */
export function sortAccessMembers(members, key = 'role', { ownerId = null, nameOf = (m) => m?.email || '', activity = null } = {}) {
  const list = Array.isArray(members) ? [...members] : [];
  const name = (m) => String(nameOf(m) || '').toLowerCase();
  const byName = (a, b) => name(a).localeCompare(name(b));
  const opened = (m) => {
    const t = activity?.get?.(m?.user_id);
    const ms = t ? Date.parse(t) : NaN;
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  const isOwner = (m) => Boolean(ownerId) && m?.user_id === ownerId;
  return list.sort((a, b) => {
    if (isOwner(a) !== isOwner(b)) return isOwner(a) ? -1 : 1;
    if (key === 'name') return byName(a, b);
    if (key === 'activity') return (opened(b) - opened(a)) || byName(a, b);
    const ra = ROLE_RANK[norm(a?.role)] ?? 9;
    const rb = ROLE_RANK[norm(b?.role)] ?? 9;
    return (ra - rb) || byName(a, b);
  });
}

/** "Opened 5 mins ago" for a member row; "Not opened yet" without a time. */
export function openedLabel(iso, now = Date.now()) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return 'Not opened yet';
  const mins = Math.floor(Math.max(0, now - ms) / 60000);
  if (mins < 1) return 'Opened just now';
  if (mins < 60) return `Opened ${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Opened ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Opened yesterday';
  if (days < 30) return `Opened ${days} days ago`;
  return `Opened ${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** The personal message on an email invite: plain text, at most 500
 *  characters, line breaks kept (at most one blank line in a row). */
export const INVITE_MESSAGE_MAX = 500;
export function cleanInviteMessage(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\x00-\x09\x0b-\x1f\x7f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, INVITE_MESSAGE_MAX)
    .trim();
}

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

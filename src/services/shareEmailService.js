/* KAL-31 sharing server-action helpers.
 *
 * Browser code never calls the generic `send-email` relay. Invite sends and
 * collaborator access changes go through narrow endpoints that derive the
 * recipient and message from trusted server-side records.
 */
import { supabase } from '../supabaseClient';

export async function manageCollaboratorAccess({
  kind,
  resourceId,
  targetUserId,
  action,
  newRole,
}) {
  if (!kind || !resourceId || !targetUserId || !action) {
    return { success: false, error: 'missing access-change fields' };
  }
  const body = { kind, resourceId, targetUserId, action };
  if (action === 'role') body.newRole = newRole;
  try {
    const { data, error } = await supabase.functions.invoke('manage-collaborator-access', {
      body,
    });
    if (error) {
      console.warn('[KAL-31] access change invoke error:', error?.message || error);
      return { success: false, error: error.message || String(error) };
    }
    return data?.success
      ? { success: true, emailSent: !!data.emailSent }
      : { success: false, error: data?.error || 'Access change failed' };
  } catch (err) {
    console.warn('[KAL-31] access change threw:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/** GOAL-1 — smart invite-email send, replacing the old client-side
 * document/project/template invite senders.
 *
 * One call to the `send-invite-email` edge function, which handles BOTH
 * delivery branches server-side (new user → Supabase auth mailer invite;
 * existing account → Resend via send-email) and derives recipient, role,
 * and every emailed URL from the invite row — so a dev/localhost origin can
 * never leak into an email and the response never reveals whether the
 * invitee already has an account. Only `token` is security-relevant;
 * name/inviterName are cosmetic copy (escaped + length-capped server-side).
 *
 * Deliberately NO client-side fallback send on failure: a refusal means the
 * server saw a revoked/accepted/expired/not-owned invite (or the send
 * failed) and a client-built email could carry a stale or wrong-origin
 * link. Email stays best-effort by contract — warn and move on, exactly
 * like the failure mode this app has always had.
 */
export async function sendInviteEmailSmart({ token, kind, name, inviterName }) {
  if (!token) return { success: false, error: 'missing token' };
  const displayName = kind === 'project'
    ? (name ? `the project "${name}"` : 'a project')
    : kind === 'template'
      ? (name ? `the template "${name}"` : 'a template')
      : (name || 'a document');
  try {
    const { data, error } = await supabase.functions.invoke('send-invite-email', {
      body: {
        token,
        displayName,
        inviterName: inviterName || 'A Survey user',
      },
    });
    if (error) {
      console.warn('[GOAL-1] send-invite-email invoke error:', error?.message || error);
      return { success: false, error: error.message || String(error) };
    }
    return { success: !!data?.sent, response: data };
  } catch (err) {
    console.warn('[GOAL-1] send-invite-email threw:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

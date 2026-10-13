/* KAL-31 — Phase C share-email helper.
 *
 * Thin wrapper over the deployed `send-email` Supabase Edge Function. The
 * function already handles Resend authentication via the `RESEND_API_KEY`
 * function secret. Callers just provide template + data. Permission-change
 * and removal notifications remain best-effort; invitation delivery reports
 * a definite failure or an uncertain outcome to its caller.
 */
import { supabase } from '../supabaseClient';

function appOrigin() {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return 'https://survey.app';
}

async function invokeSendEmail({ to, subject, template, data }) {
  if (!to || !template) return { success: false, error: 'missing to/template' };
  try {
    const { data: res, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, template, data: data || {} },
    });
    if (error) {
      console.warn('[KAL-31] send-email invoke error:', error?.message || error);
      return { success: false, error: error.message || String(error) };
    }
    return { success: true, response: res };
  } catch (err) {
    console.warn('[KAL-31] send-email threw:', err?.message || err);
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
 * link. The caller can safely distinguish a definite unsent failure from an
 * uncertain transport outcome without exposing whether the account exists.
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
      let response = data || null;
      if (!response && error?.context?.clone) {
        try { response = await error.context.clone().json(); } catch { /* no structured body */ }
      }
      const status = Number(error?.context?.status) || 0;
      const hasStructuredRetryability = typeof response?.retryable === 'boolean';
      const deliveryUncertain = response?.retryable === false
        || response?.error === 'Delivery outcome unknown'
        || (!hasStructuredRetryability && (status === 0 || status >= 500));
      return {
        success: false,
        retryable: hasStructuredRetryability
          ? response.retryable === true && !deliveryUncertain
          : !deliveryUncertain,
        deliveryUncertain,
        error: response?.error || error.message || String(error),
        response,
      };
    }
    if (data?.sent !== true) {
      const deliveryUncertain = data?.retryable === false
        || data?.error === 'Delivery outcome unknown';
      return {
        success: false,
        retryable: !deliveryUncertain,
        deliveryUncertain,
        error: data?.error || 'Email was not sent',
        response: data,
      };
    }
    return { success: true, retryable: false, response: data };
  } catch (err) {
    console.warn('[GOAL-1] send-invite-email threw:', err?.message || err);
    return {
      success: false,
      retryable: false,
      deliveryUncertain: true,
      error: err?.message || String(err),
    };
  }
}

export function inviteEmailFailureMessage(
  emailResult,
  { completedAction, retryInstruction },
) {
  // Plain words, one sentence each (inviteFix 2026-10-07). When the send
  // outcome is unknown the email may have arrived, so no retry hint. The
  // Share / Invite dialogs word their own outcome via home/inviteSendSummary.js.
  if (emailResult?.deliveryUncertain || emailResult?.retryable === false) {
    return `${completedAction}, but we couldn't confirm the email was sent.`;
  }
  return `${completedAction}, but the email didn't send. ${retryInstruction}`;
}

/** Send the permission-changed email after a role update. */
export async function sendPermissionChangedEmail({
  email,
  documentName,
  changedByName,
  newRole,
  oldRole,
  documentUrl,
}) {
  if (!email) return { success: false, error: 'no recipient' };
  const subject = `Your access to ${documentName || 'a document'} changed`;
  return invokeSendEmail({
    to: email,
    subject,
    template: 'permission-changed',
    data: {
      documentName: documentName || 'a document',
      changedByName: changedByName || 'An owner',
      newRole: newRole || 'Viewer',
      oldRole: oldRole || null,
      documentUrl: documentUrl || appOrigin(),
      appUrl: appOrigin(),
    },
  });
}

/** Send the access-removed email after a collaborator is removed. */
export async function sendAccessRemovedEmail({
  email,
  documentName,
  removedByName,
}) {
  if (!email) return { success: false, error: 'no recipient' };
  const subject = `Your access to ${documentName || 'a document'} was removed`;
  return invokeSendEmail({
    to: email,
    subject,
    template: 'access-removed',
    data: {
      documentName: documentName || 'a document',
      removedByName: removedByName || 'An owner',
    },
  });
}

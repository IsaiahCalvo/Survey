/* KAL-31 — Phase C share-email helper.
 *
 * Thin wrapper over the deployed `send-email` Supabase Edge Function. The
 * function already handles Resend authentication via the `RESEND_API_KEY`
 * function secret. Callers just provide template + data; failures are logged
 * but never throw because email delivery is best-effort and must not block
 * the underlying invite/role-change/remove action.
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

/** Send the document-invite email. Best-effort; tolerates missing email. */
export async function sendDocumentInviteEmail({
  email,
  documentName,
  inviterName,
  role,
  inviteUrl,
  expiresAt,
}) {
  if (!email) return { success: false, error: 'no recipient' };
  const subject = `${inviterName || 'A Survey user'} invited you to ${documentName || 'a document'} on Survey`;
  return invokeSendEmail({
    to: email,
    subject,
    template: 'document-invite',
    data: {
      documentName: documentName || 'a document',
      inviterName: inviterName || 'A Survey user',
      role: role || 'Viewer',
      inviteUrl: inviteUrl || appOrigin(),
      expiresAt: expiresAt || null,
    },
  });
}

/** Send the project-invite email. Best-effort; tolerates missing email.
 *
 * Reuses the deployed `document-invite` template (the only invite template
 * the live send-email function ships) with the name phrased as
 * `the project "X"`, so the email honestly reads
 * "invited you to join the project "X" as <Role>". A dedicated
 * project-invite template is a later edge-function change.
 */
export async function sendProjectInviteEmail({
  email,
  projectName,
  inviterName,
  role,
  inviteUrl,
  expiresAt,
}) {
  if (!email) return { success: false, error: 'no recipient' };
  const displayName = projectName ? `the project "${projectName}"` : 'a project';
  const subject = `${inviterName || 'A Survey user'} invited you to ${displayName} on Survey`;
  return invokeSendEmail({
    to: email,
    subject,
    template: 'document-invite',
    data: {
      documentName: displayName,
      inviterName: inviterName || 'A Survey user',
      role: role || 'Viewer',
      inviteUrl: inviteUrl || appOrigin(),
      expiresAt: expiresAt || null,
    },
  });
}

/** Send the template-invite email. Best-effort; tolerates missing email.
 * Same deployed-template reuse as sendProjectInviteEmail. */
export async function sendTemplateInviteEmail({
  email,
  templateName,
  inviterName,
  role,
  inviteUrl,
  expiresAt,
}) {
  if (!email) return { success: false, error: 'no recipient' };
  const displayName = templateName ? `the template "${templateName}"` : 'a template';
  const subject = `${inviterName || 'A Survey user'} invited you to ${displayName} on Survey`;
  return invokeSendEmail({
    to: email,
    subject,
    template: 'document-invite',
    data: {
      documentName: displayName,
      inviterName: inviterName || 'A Survey user',
      role: role || 'Viewer',
      inviteUrl: inviteUrl || appOrigin(),
      expiresAt: expiresAt || null,
    },
  });
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

/* KAL-31 — document invite service.
 *
 * Phase B wiring: create/revoke/resend/accept invite tokens against
 * `document_invites` and the `kal31_*` Supabase RPCs added in the
 * 20260521000100 migration. UI layers (ShareModal, AccessManagementModal)
 * should call these helpers, not the supabase client directly, so role
 * gating and error-state handling stay in one place.
 *
 * Locked spec (see KAL-31 Linear comment 2026-05-21 17:00):
 *   - Roles are exactly viewer | editor | owner.
 *   - Only owners can invite, revoke, resend, or remove.
 *   - Free users cannot create invites.
 *   - Email invites grant existing accounts access immediately.
 *   - Free invitees accepted as viewer; intended_role preserved for upgrade.
 *   - Invites expire after 7 days; resend refreshes the window.
 */
import { supabase } from '../supabaseClient';
import { sendInviteEmailSmart } from './shareEmailService';

const ROLE_SET = new Set(['viewer', 'editor', 'owner']);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeRole(role) {
  if (!role) return 'viewer';
  const lower = String(role).toLowerCase();
  return ROLE_SET.has(lower) ? lower : 'viewer';
}

function newToken() {
  // 32-hex-char (128-bit) secure random invite token. FAIL CLOSED: never fall
  // back to weak Math.random() — a guessable invite token (persisted + emailed)
  // is a real security hole, and crypto.getRandomValues is present in every
  // browser/Electron build we ship. (Security hardening 2026-06-28.)
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('secure RNG unavailable — refusing to mint a guessable invite token');
  }
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create an invite. If `email` is provided, the invite is email-bound and
 * acceptance requires the signed-in account email to match. If `email` is
 * null/empty, the invite is link-only.
 *
 * @returns {Promise<{success: boolean, invite?: object, error?: string}>}
 */
export async function createDocumentInvite({ documentId, role, email = null, currentUser, documentName = null, inviterName = null }) {
  if (!documentId) return { success: false, error: 'Missing documentId' };
  if (!currentUser?.id) return { success: false, error: 'Must be signed in' };

  const normRole = normalizeRole(role);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  const row = {
    document_id: documentId,
    token,
    role: normRole,
    intended_role: normRole,
    target_email: email ? String(email).toLowerCase().trim() : null,
    created_by: currentUser.id,
    expires_at: expiresAt,
  };

  const { data, error } = await supabase
    .from('document_invites')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error('[KAL-31] createDocumentInvite failed:', error);
    return { success: false, error: error.message };
  }

  // An email invite to an existing account is both a courtesy notification and
  // an immediate access grant. New addresses keep the pending-invite flow.
  //
  // Port note (2026-07-17): the acceptance marker is DEFERRED until after the
  // email send below — the send-invite-email edge function refuses invites
  // whose accepted_at is already set (handler.js 409 "Invite already
  // accepted"), so marking first would silently drop the notification email
  // for exactly the existing-account branch this grant serves.
  let pendingAcceptanceMarker = null;
  if (row.target_email) {
    const { data: matches, error: lookupError } = await supabase.rpc(
      'check_collaborator_by_email',
      { email_address: row.target_email },
    );

    if (!lookupError) {
      const existingUser = Array.isArray(matches) ? matches[0] : matches;
      if (existingUser?.user_id) {
        const effectiveRole = normRole === 'viewer' || existingUser.can_collaborate
          ? normRole
          : 'viewer';
        const { error: grantError } = await supabase
          .from('document_collaborators')
          .upsert({
            document_id: documentId,
            user_id: existingUser.user_id,
            email: existingUser.email || row.target_email,
            role: effectiveRole,
            status: 'active',
            invited_by: currentUser.id,
          }, { onConflict: 'document_id,user_id' });

        if (grantError) {
          console.error('[KAL-31] immediate collaborator grant failed:', grantError);
          return { success: false, error: grantError.message };
        }

        pendingAcceptanceMarker = {
          accepted_by: existingUser.user_id,
          accepted_role: effectiveRole,
        };
      }
    } else {
      console.warn('[KAL-31] existing-account lookup failed; leaving invite pending:', lookupError.message);
    }
  }

  // Phase C: fire invite email (best-effort) for email-bound invites.
  // GOAL-1: one server-side call — recipient/role/URL derived from the row.
  if (email) {
    try {
      await sendInviteEmailSmart({
        token: data.token,
        kind: 'document',
        name: documentName || '',
        inviterName: inviterName || currentUser.email || 'A Survey user',
      });
    } catch (mailErr) {
      console.warn('[KAL-31] invite email send failed (best-effort):', mailErr?.message || mailErr);
    }
  }

  // Existing-account branch: access was already granted above — now that the
  // notification email has fired, record the invite as accepted so it never
  // lingers as "pending" in Manage Access. Best-effort: a failed marker only
  // leaves a cosmetic pending row; the grant itself already succeeded.
  if (pendingAcceptanceMarker) {
    const { error: acceptError } = await supabase
      .from('document_invites')
      .update({
        accepted_at: new Date().toISOString(),
        ...pendingAcceptanceMarker,
      })
      .eq('id', data.id);
    if (acceptError) {
      console.warn('[KAL-31] invite granted but acceptance marker failed:', acceptError.message);
    }
  }

  return { success: true, invite: data };
}

/**
 * List active invites for a document (owners only — RLS enforces this).
 */
export async function listDocumentInvites(documentId) {
  if (!documentId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('document_invites')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[KAL-31] listDocumentInvites failed:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/**
 * Revoke a pending invite.
 */
export async function revokeDocumentInvite(inviteId) {
  const { data, error } = await supabase.rpc('kal31_revoke_document_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
  return { success: !!data };
}

/**
 * Resend an invite — refreshes the 7-day expiration window. Caller is
 * responsible for re-triggering the invite email through the edge function
 * (Phase C).
 */
export async function resendDocumentInvite(inviteId, { documentName = null, inviterName = null } = {}) {
  const { data, error } = await supabase.rpc('kal31_resend_document_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
  // Reload the invite row so we can email it again.
  try {
    const { data: row } = await supabase
      .from('document_invites')
      .select('*')
      .eq('id', inviteId)
      .single();
    if (row?.target_email && row?.token) {
      await sendInviteEmailSmart({
        token: row.token,
        kind: 'document',
        name: documentName || '',
        inviterName: inviterName || 'A Survey user',
      });
    }
  } catch (mailErr) {
    console.warn('[KAL-31] resend email failed (best-effort):', mailErr?.message || mailErr);
  }
  return { success: true, expiresAt: data };
}

/**
 * Accept an invite token. Returns one of: accepted | wrong_account |
 * invalid | expired | revoked | already_accepted, with the effective role
 * actually granted (which may be 'viewer' for free users invited as
 * editor/owner — `upgradeRequired` will be true in that case).
 */
export async function acceptDocumentInvite(token) {
  if (!token) return { status: 'invalid' };
  const { data, error } = await supabase.rpc('kal31_accept_document_invite', { invite_token: token });
  if (error) {
    console.error('[KAL-31] acceptDocumentInvite failed:', error);
    return { status: 'invalid', error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: row?.status || 'invalid',
    documentId: row?.document_id || null,
    effectiveRole: row?.effective_role || null,
    intendedRole: row?.intended_role || null,
    upgradeRequired: !!row?.upgrade_required,
  };
}

/**
 * Build a user-facing invite link from an invite row + the current origin.
 */
export function buildInviteUrl(invite) {
  if (!invite?.token) return '';
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || 'https://survey.app';
  return `${origin}/invite/${invite.token}`;
}

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
import { interpretInviteAcceptResult } from '../home/documentDeepLink';
import {
  inviteEmailFailureMessage,
  sendInviteEmailSmart,
} from './shareEmailService';

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

async function findExistingUserActiveGrant(invite) {
  if (!invite?.document_id || !invite?.target_email) return { state: 'none' };

  const { data: matches, error: lookupError } = await supabase.rpc(
    'check_collaborator_by_email',
    { email_address: invite.target_email },
  );
  if (lookupError) return { state: 'unknown', error: lookupError };

  const existingUser = Array.isArray(matches) ? matches[0] : matches;
  if (!existingUser?.user_id) return { state: 'none' };

  const { data: access, error: accessError } = await supabase
    .from('document_collaborators')
    .select('role')
    .eq('document_id', invite.document_id)
    .eq('user_id', existingUser.user_id)
    .eq('status', 'active')
    .maybeSingle();
  if (accessError) return { state: 'unknown', error: accessError };
  if (!access?.role) return { state: 'none' };

  return {
    state: 'active',
    userId: existingUser.user_id,
    role: access.role,
  };
}

async function markExistingUserInviteAccepted(invite, knownGrant = null) {
  if (!invite?.id) return false;
  const grant = knownGrant || await findExistingUserActiveGrant(invite);
  if (grant?.state !== 'active') return false;

  const { data: acceptedRow, error: acceptError } = await supabase
    .from('document_invites')
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: grant.userId,
      accepted_role: grant.role,
    })
    .eq('id', invite.id)
    .select('accepted_at, accepted_by, accepted_role')
    .maybeSingle();
  if (
    acceptError
    || !acceptedRow?.accepted_at
    || acceptedRow.accepted_by !== grant.userId
    || acceptedRow.accepted_role !== grant.role
  ) {
    console.warn(
      '[KAL-31] notification delivered but acceptance marker was not confirmed:',
      acceptError?.message || 'updated row was not returned',
    );
    return false;
  }
  return true;
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
    // KAL-284(d): the partial unique index uniq_document_invites_pending_email
    // rejects a second live pending invite for the same (document, email).
    // Surface that as guidance, not a raw constraint violation.
    if (error.code === '23505') {
      return {
        success: false,
        error: 'An invite for this email is already pending on this document. Resend or revoke the existing invite instead.',
      };
    }
    // P2-01: server-side free-tier gate (trigger + RLS) — same copy as ShareModal.
    if (
      error.code === '42501'
      || /Pro subscription|invite_blocked_free_tier|cannot create invite/i.test(error.message || '')
    ) {
      return {
        success: false,
        error: 'Free plan accounts cannot create invite links. Upgrade to Pro or higher to share.',
      };
    }
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
          state: 'active',
          userId: existingUser.user_id,
          role: effectiveRole,
        };
      }
    } else {
      console.warn('[KAL-31] existing-account lookup failed; leaving invite pending:', lookupError.message);
    }
  }

  // Phase C: one server-side call for both paths. The edge function derives
  // recipient, template, and URL from the owner-visible invite row. For an
  // existing user it also verifies the active collaborator grant above and
  // sends a direct document notification with no token. New users receive the
  // secure acceptance link.
  let emailResult = null;
  if (email) {
    try {
      emailResult = await sendInviteEmailSmart({
        token: data.token,
        kind: 'document',
        name: documentName || '',
        inviterName: inviterName || currentUser.email || 'A Survey user',
      });
    } catch (mailErr) {
      emailResult = {
        success: false,
        retryable: false,
        deliveryUncertain: true,
        error: mailErr?.message || String(mailErr),
      };
    }
    if (!emailResult?.success) {
      console.warn('[KAL-31] invite email was not sent:', emailResult?.error || 'unknown failure');
      return {
        success: false,
        invite: data,
        accessGranted: !!pendingAcceptanceMarker,
        emailSent: false,
        retryable: emailResult?.retryable !== false,
        error: inviteEmailFailureMessage(emailResult, {
          completedAction: pendingAcceptanceMarker ? 'Access was granted' : 'The invite was created',
          retryInstruction: 'Retry it from Manage Access.',
        }),
      };
    }
  }

  // Existing-account branch: access was already granted above — now that the
  // notification email has fired, record the invite as accepted so it never
  // lingers as "pending" in Manage Access. This close is authoritative:
  // reporting success while it remains pending would allow another resend.
  if (pendingAcceptanceMarker) {
    const markerClosed = await markExistingUserInviteAccepted(
      {
        ...data,
        id: data.id,
        document_id: documentId,
        target_email: row.target_email,
      },
      pendingAcceptanceMarker,
    );
    if (!markerClosed) {
      return {
        success: false,
        invite: data,
        accessGranted: true,
        emailSent: true,
        retryable: true,
        error: 'Access was granted and the notification was delivered, but the pending invite could not be closed. Retry to finish closing it.',
      };
    }
  }

  return {
    success: true,
    invite: data,
    accessGranted: !!pendingAcceptanceMarker,
    emailSent: email ? true : null,
  };
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
  // P2-05: the RPC deletes the matching document_collaborators grant. A
  // true return means the pending invite was revoked (and any immediate
  // existing-account grant was dropped).
  return { success: !!data };
}

/**
 * Resend an invite. Pending token invites refresh their 7-day window.
 * Existing-user direct notifications retain their current delivery generation
 * until the accepted marker is confirmed, preventing a closure retry from
 * transporting the same notification twice.
 */
export async function resendDocumentInvite(
  inviteId,
  { documentName = null, inviterName = null, forceNewDelivery = false } = {},
) {
  try {
    // Read before refreshing. Existing-user grants deliberately retain the
    // current delivery generation: if closing the accepted marker fails after
    // delivery, a retry reuses the completed delivery claim instead of sending
    // a second email under a newly refreshed expiration timestamp.
    let { data: row, error: rowError } = await supabase
      .from('document_invites')
      .select('*')
      .eq('id', inviteId)
      .single();
    if (rowError || !row) {
      return {
        success: false,
        emailSent: false,
        retryable: true,
        error: 'The invite details could not be loaded. Try again.',
      };
    }

    const existingGrant = await findExistingUserActiveGrant(row);
    if (existingGrant.state === 'unknown') {
      return {
        success: false,
        expiresAt: row.expires_at,
        emailSent: false,
        retryable: true,
        error: 'The current access grant could not be verified. Try again.',
      };
    }

    let expiresAt = row.expires_at;
    const isExpired = !row.expires_at || new Date(row.expires_at).getTime() <= Date.now();
    const mustRefresh = forceNewDelivery
      || existingGrant.state !== 'active'
      || isExpired
      || !!row.revoked_at;
    if (mustRefresh) {
      const { data, error } = forceNewDelivery
        ? await supabase.rpc('rotate_invite_email_delivery', {
          p_kind: 'document',
          p_invite_id: inviteId,
        })
        : await supabase.rpc('kal31_resend_document_invite', { invite_id: inviteId });
      if (error) return { success: false, error: error.message };
      if (forceNewDelivery && !data?.expiresAt) {
        return { success: false, error: 'Could not start a new document invite delivery.' };
      }
      expiresAt = forceNewDelivery ? data.expiresAt : data;

      const refreshed = await supabase
        .from('document_invites')
        .select('*')
        .eq('id', inviteId)
        .single();
      row = refreshed.data;
      rowError = refreshed.error;
      if (rowError || !row) {
        return {
          success: false,
          expiresAt,
          emailSent: false,
          retryable: true,
          error: 'The invite was refreshed, but its email details could not be loaded. Try again.',
        };
      }
    }

    if (row?.target_email && row?.token) {
      const emailResult = await sendInviteEmailSmart({
        token: row.token,
        kind: 'document',
        name: documentName || '',
        inviterName: inviterName || 'A Survey user',
      });
      if (!emailResult?.success) {
        return {
          success: false,
          expiresAt,
          emailSent: false,
          retryable: emailResult?.retryable !== false,
          error: inviteEmailFailureMessage(emailResult, {
            completedAction: 'The invite was refreshed',
            retryInstruction: 'Try again.',
          }),
        };
      }
      if (existingGrant.state === 'active') {
        const markerClosed = await markExistingUserInviteAccepted(row, existingGrant);
        if (!markerClosed) {
          return {
            success: false,
            expiresAt,
            emailSent: true,
            retryable: true,
            error: 'The notification was delivered, but the pending invite could not be closed. Retry to finish closing it.',
          };
        }
      }
      return {
        success: true,
        expiresAt,
        emailSent: true,
      };
    }
    return { success: true, expiresAt, emailSent: null };
  } catch (mailErr) {
    console.warn('[KAL-31] resend email failed:', mailErr?.message || mailErr);
    const emailResult = {
      success: false,
      retryable: false,
      deliveryUncertain: true,
      error: mailErr?.message || String(mailErr),
    };
    return {
      success: false,
      emailSent: false,
      retryable: false,
      error: inviteEmailFailureMessage(emailResult, {
        completedAction: 'The invite was refreshed',
        retryInstruction: 'Try again.',
      }),
    };
  }
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
  const rpcResult = {
    status: row?.status || 'invalid',
    documentId: row?.document_id || null,
    effectiveRole: row?.effective_role || null,
    intendedRole: row?.intended_role || null,
    upgradeRequired: !!row?.upgrade_required,
  };
  if (rpcResult.status !== 'already_accepted') return rpcResult;

  const { data: authData } = await supabase.auth.getUser();
  const currentUser = authData?.user || null;
  const { data: invite } = await supabase
    .from('document_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  let hasActiveGrant = false;
  if (currentUser?.id && rpcResult.documentId) {
    const { data: grant } = await supabase
      .from('document_collaborators')
      .select('role')
      .eq('document_id', rpcResult.documentId)
      .eq('user_id', currentUser.id)
      .eq('status', 'active')
      .maybeSingle();
    hasActiveGrant = !!grant?.role;
  }
  const interpreted = interpretInviteAcceptResult({
    rpcStatus: rpcResult.status,
    invite,
    currentUserId: currentUser?.id,
    hasActiveGrant,
  });
  if (interpreted.action === 'grant-from-invite' && currentUser?.id && rpcResult.documentId) {
    const role = normalizeRole(invite?.intended_role || rpcResult.intendedRole || 'viewer');
    const { error: grantError } = await supabase
      .from('document_collaborators')
      .insert({
        document_id: rpcResult.documentId,
        user_id: currentUser.id,
        email: currentUser.email || null,
        role,
        status: 'active',
        invited_by: invite?.created_by || null,
      });
    if (!grantError) {
      return {
        ...rpcResult,
        status: 'accepted',
        effectiveRole: role,
      };
    }
  }
  return { ...rpcResult, status: interpreted.status };
}

/**
 * Build a user-facing invite link from an invite row + the current origin.
 */
export function buildInviteUrl(invite) {
  if (!invite?.token) return '';
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || 'https://survey.app';
  return `${origin}/invite/${invite.token}`;
}

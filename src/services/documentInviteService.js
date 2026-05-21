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
 *   - Free invitees accepted as viewer; intended_role preserved for upgrade.
 *   - Invites expire after 7 days; resend refreshes the window.
 */
import { supabase } from '../supabaseClient';

const ROLE_SET = new Set(['viewer', 'editor', 'owner']);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeRole(role) {
  if (!role) return 'viewer';
  const lower = String(role).toLowerCase();
  return ROLE_SET.has(lower) ? lower : 'viewer';
}

function newToken() {
  // 22-char url-safe random (~128 bits of entropy).
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Create an invite. If `email` is provided, the invite is email-bound and
 * acceptance requires the signed-in account email to match. If `email` is
 * null/empty, the invite is link-only.
 *
 * @returns {Promise<{success: boolean, invite?: object, error?: string}>}
 */
export async function createDocumentInvite({ documentId, role, email = null, currentUser }) {
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
export async function resendDocumentInvite(inviteId) {
  const { data, error } = await supabase.rpc('kal31_resend_document_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
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

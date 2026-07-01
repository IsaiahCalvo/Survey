/* Template invite + collaborator service.
 *
 * Mirrors documentInviteService.js exactly, against the template tables/RPCs
 * added in migration 20260701120000_project_template_sharing.sql:
 *   - `template_invites` table (owner-gated RLS)
 *   - kal31_accept_template_invite / kal31_resend_template_invite /
 *     kal31_revoke_template_invite RPCs
 *   - `template_collaborators` (owner-gated writes, viewer-gated SELECT via
 *     user_can_access_template — RLS enforces gating, not this layer).
 *
 * Same locked KAL-31 semantics as documents:
 *   - Roles are exactly viewer | editor | owner.
 *   - Only owners can invite, revoke, resend, or remove.
 *   - Free invitees accepted as viewer; intended_role preserved for upgrade.
 *   - Invites expire after 7 days; resend refreshes the window.
 */
import { supabase } from '../supabaseClient';
import { buildInviteUrl } from './documentInviteService';
import { sendTemplateInviteEmail } from './shareEmailService';

// Re-export so UI layers can import one URL builder per service. Template and
// project invites share the /invite/<token> URL space with documents — the
// accept page resolves the token across all three kinds.
export { buildInviteUrl };

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
  // browser/Electron build we ship. (Mirrors documentInviteService.)
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('secure RNG unavailable — refusing to mint a guessable invite token');
  }
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a template invite. If `email` is provided, the invite is email-bound
 * and acceptance requires the signed-in account email to match. If `email`
 * is null/empty, the invite is link-only.
 *
 * @returns {Promise<{success: boolean, invite?: object, error?: string}>}
 */
export async function createTemplateInvite({ templateId, role, email = null, currentUser, templateName = null, inviterName = null }) {
  if (!templateId) return { success: false, error: 'Missing templateId' };
  if (!currentUser?.id) return { success: false, error: 'Must be signed in' };

  const normRole = normalizeRole(role);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  const row = {
    template_id: templateId,
    token,
    role: normRole,
    intended_role: normRole,
    target_email: email ? String(email).toLowerCase().trim() : null,
    created_by: currentUser.id,
    expires_at: expiresAt,
  };

  const { data, error } = await supabase
    .from('template_invites')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error('[KAL-31] createTemplateInvite failed:', error);
    return { success: false, error: error.message };
  }

  // Fire invite email (best-effort) for email-bound invites.
  if (email) {
    try {
      const inviteUrl = buildInviteUrl(data);
      await sendTemplateInviteEmail({
        email,
        templateName: templateName || 'a template',
        inviterName: inviterName || currentUser.email || 'A Survey user',
        role: normRole.charAt(0).toUpperCase() + normRole.slice(1),
        inviteUrl,
        expiresAt: expiresAt,
      });
    } catch (mailErr) {
      console.warn('[KAL-31] template invite email send failed (best-effort):', mailErr?.message || mailErr);
    }
  }

  return { success: true, invite: data };
}

/**
 * List invites for a template (owners only — RLS enforces this).
 */
export async function listTemplateInvites(templateId) {
  if (!templateId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('template_invites')
    .select('*')
    .eq('template_id', templateId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[KAL-31] listTemplateInvites failed:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/**
 * Revoke a pending template invite.
 */
export async function revokeTemplateInvite(inviteId) {
  const { data, error } = await supabase.rpc('kal31_revoke_template_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
  return { success: !!data };
}

/**
 * Resend a template invite — refreshes the 7-day expiration window and
 * re-sends the invite email (best-effort) when the invite is email-bound.
 */
export async function resendTemplateInvite(inviteId, { templateName = null, inviterName = null } = {}) {
  const { data, error } = await supabase.rpc('kal31_resend_template_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
  // Reload the invite row so we can email it again.
  try {
    const { data: row } = await supabase
      .from('template_invites')
      .select('*')
      .eq('id', inviteId)
      .single();
    if (row?.target_email && row?.token) {
      const inviteUrl = buildInviteUrl(row);
      await sendTemplateInviteEmail({
        email: row.target_email,
        templateName: templateName || 'a template',
        inviterName: inviterName || 'A Survey user',
        role: (row.intended_role || 'viewer').charAt(0).toUpperCase() + (row.intended_role || 'viewer').slice(1),
        inviteUrl,
        expiresAt: data,
      });
    }
  } catch (mailErr) {
    console.warn('[KAL-31] template resend email failed (best-effort):', mailErr?.message || mailErr);
  }
  return { success: true, expiresAt: data };
}

/**
 * Accept a template invite token. Returns one of: accepted | wrong_account |
 * invalid | expired | revoked | already_accepted, with the effective role
 * actually granted (which may be 'viewer' for free users invited as
 * editor/owner — `upgradeRequired` will be true in that case).
 */
export async function acceptTemplateInvite(token) {
  if (!token) return { status: 'invalid' };
  const { data, error } = await supabase.rpc('kal31_accept_template_invite', { invite_token: token });
  if (error) {
    console.error('[KAL-31] acceptTemplateInvite failed:', error);
    return { status: 'invalid', error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: row?.status || 'invalid',
    templateId: row?.template_id || null,
    effectiveRole: row?.effective_role || null,
    intendedRole: row?.intended_role || null,
    upgradeRequired: !!row?.upgrade_required,
  };
}

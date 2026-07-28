/* Project invite + collaborator service.
 *
 * Mirrors documentInviteService.js exactly, against the project tables/RPCs
 * added in migration 20260701120000_project_template_sharing.sql:
 *   - `project_invites` table (owner-gated RLS)
 *   - kal31_accept_project_invite / kal31_resend_project_invite /
 *     kal31_revoke_project_invite RPCs
 *   - `project_collaborators` (owner-gated INSERT/UPDATE/DELETE,
 *     viewer-gated SELECT — RLS enforces gating, not this layer).
 *
 * Same locked KAL-31 semantics as documents:
 *   - Roles are exactly viewer | editor | owner.
 *   - Only owners can invite, revoke, resend, or remove.
 *   - Free invitees accepted as viewer; intended_role preserved for upgrade.
 *   - Invites expire after 7 days; resend refreshes the window.
 */
import { supabase } from '../supabaseClient';
import { buildInviteUrl } from './documentInviteService';
import {
  inviteEmailFailureMessage,
  sendInviteEmailSmart,
} from './shareEmailService';

// Re-export so UI layers can import one URL builder per service. Project and
// template invites share the /invite/<token> URL space with documents — the
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
 * Create a project invite. If `email` is provided, the invite is email-bound
 * and acceptance requires the signed-in account email to match. If `email`
 * is null/empty, the invite is link-only.
 *
 * @returns {Promise<{success: boolean, invite?: object, error?: string}>}
 */
export async function createProjectInvite({ projectId, role, email = null, currentUser, projectName = null, inviterName = null }) {
  if (!projectId) return { success: false, error: 'Missing projectId' };
  if (!currentUser?.id) return { success: false, error: 'Must be signed in' };

  const normRole = normalizeRole(role);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  const row = {
    project_id: projectId,
    token,
    role: normRole,
    intended_role: normRole,
    target_email: email ? String(email).toLowerCase().trim() : null,
    created_by: currentUser.id,
    expires_at: expiresAt,
  };

  const { data, error } = await supabase
    .from('project_invites')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error('[KAL-31] createProjectInvite failed:', error);
    return { success: false, error: error.message };
  }

  // GOAL-1: one server-side call — recipient/role/URL derived from the row.
  // Keep the row retryable and report delivery separately if the transport
  // fails; creating a token is not the same as sending an email.
  if (email) {
    let emailResult;
    try {
      emailResult = await sendInviteEmailSmart({
        token: data.token,
        kind: 'project',
        name: projectName || '',
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
      console.warn('[KAL-31] project invite email was not sent:', emailResult?.error || 'unknown failure');
      return {
        success: false,
        invite: data,
        emailSent: false,
        retryable: emailResult?.retryable !== false,
        error: inviteEmailFailureMessage(emailResult, {
          completedAction: 'The project invite was created',
          retryInstruction: 'Retry it from Manage Team.',
        }),
      };
    }
  }

  return { success: true, invite: data, emailSent: email ? true : null };
}

/**
 * List invites for a project (owners only — RLS enforces this).
 */
export async function listProjectInvites(projectId) {
  if (!projectId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('project_invites')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[KAL-31] listProjectInvites failed:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/**
 * Revoke a pending project invite.
 */
export async function revokeProjectInvite(inviteId) {
  const { data, error } = await supabase.rpc('kal31_revoke_project_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
  return { success: !!data };
}

/**
 * Retry a project invite using its stable delivery generation. Pass
 * forceNewDelivery only for an intentional additional copy; ordinary retries
 * (including a lost HTTP response) remain idempotent.
 */
export async function resendProjectInvite(
  inviteId,
  { projectName = null, inviterName = null, forceNewDelivery = false } = {},
) {
  const { data, error } = forceNewDelivery
    ? await supabase.rpc('rotate_invite_email_delivery', {
      p_kind: 'project',
      p_invite_id: inviteId,
    })
    : await supabase.rpc('kal31_resend_project_invite', { invite_id: inviteId });
  if (error) return { success: false, error: error.message };
  if (forceNewDelivery && !data?.expiresAt) {
    return { success: false, error: 'Could not start a new project invite delivery.' };
  }
  const expiresAt = forceNewDelivery ? data.expiresAt : data;
  // Reload the invite row so we can email it again.
  try {
    const { data: row, error: rowError } = await supabase
      .from('project_invites')
      .select('*')
      .eq('id', inviteId)
      .single();
    if (rowError || !row) {
      return {
        success: false,
        expiresAt,
        emailSent: false,
        retryable: true,
        error: 'The project invite was refreshed, but its email details could not be loaded. Try again.',
      };
    }
    if (row?.target_email && row?.token) {
      const emailResult = await sendInviteEmailSmart({
        token: row.token,
        kind: 'project',
        name: projectName || '',
        inviterName: inviterName || 'A Survey user',
      });
      if (!emailResult?.success) {
        return {
          success: false,
          expiresAt,
          emailSent: false,
          retryable: emailResult?.retryable !== false,
          error: inviteEmailFailureMessage(emailResult, {
            completedAction: 'The project invite was refreshed',
            retryInstruction: 'Try again.',
          }),
        };
      }
      return {
        success: true,
        expiresAt,
        emailSent: true,
      };
    }
    return { success: true, expiresAt, emailSent: null };
  } catch (mailErr) {
    console.warn('[KAL-31] project resend email failed:', mailErr?.message || mailErr);
    const emailResult = {
      success: false,
      retryable: false,
      deliveryUncertain: true,
      error: mailErr?.message || String(mailErr),
    };
    return {
      success: false,
      expiresAt,
      emailSent: false,
      retryable: false,
      error: inviteEmailFailureMessage(emailResult, {
        completedAction: 'The project invite was refreshed',
        retryInstruction: 'Try again.',
      }),
    };
  }
}

/**
 * Accept a project invite token. Returns one of: accepted | wrong_account |
 * invalid | expired | revoked | already_accepted, with the effective role
 * actually granted (which may be 'viewer' for free users invited as
 * editor/owner — `upgradeRequired` will be true in that case).
 */
export async function acceptProjectInvite(token) {
  if (!token) return { status: 'invalid' };
  const { data, error } = await supabase.rpc('kal31_accept_project_invite', { invite_token: token });
  if (error) {
    console.error('[KAL-31] acceptProjectInvite failed:', error);
    return { status: 'invalid', error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: row?.status || 'invalid',
    projectId: row?.project_id || null,
    effectiveRole: row?.effective_role || null,
    intendedRole: row?.intended_role || null,
    upgradeRequired: !!row?.upgrade_required,
  };
}

// ============================================
// COLLABORATOR OPERATIONS
// (mirror the document versions in documentAnnotationService.js;
//  RLS enforces owner-gating on writes, viewer-gating on reads)
// ============================================

/**
 * Get active collaborators for a project.
 */
export async function getProjectCollaborators(projectId) {
  if (!projectId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('project_collaborators')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'active');

  if (error) {
    console.error('[KAL-31] Error fetching project collaborators:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Get active collaborators for MANY projects in one query — used by the hub
 * project tree so member counts / team panels reflect real data without one
 * round-trip per project. Returns the raw rows; callers group by project_id.
 */
export async function listProjectCollaboratorsForProjects(projectIds) {
  const ids = (Array.isArray(projectIds) ? projectIds : []).filter(Boolean);
  if (!ids.length) return { data: [], error: null };

  const { data, error } = await supabase
    .from('project_collaborators')
    .select('*')
    .in('project_id', ids)
    .eq('status', 'active');

  if (error) {
    console.error('[KAL-31] Error fetching collaborators for projects:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Update a project collaborator's role.
 * @param {string} projectId
 * @param {string} userId
 * @param {string} newRole - 'viewer' | 'editor' | 'owner'
 */
export async function updateProjectCollaboratorRole(projectId, userId, newRole) {
  const { error } = await supabase
    .from('project_collaborators')
    .update({ role: normalizeRole(newRole) })
    .eq('project_id', projectId)
    .eq('user_id', userId);

  if (error) {
    console.error('[KAL-31] Error updating project collaborator role:', error);
    return { success: false, error };
  }

  return { success: true };
}

/**
 * Remove a collaborator from a project.
 */
export async function removeProjectCollaborator(projectId, userId) {
  const { error } = await supabase
    .from('project_collaborators')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);

  if (error) {
    console.error('[KAL-31] Error removing project collaborator:', error);
    return { success: false, error };
  }

  return { success: true };
}

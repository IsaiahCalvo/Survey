export const CANONICAL_ORIGIN = 'https://surveytool.app';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status, body) {
  return { status, body };
}

const ALLOWED_KINDS = new Set(['document', 'project']);
const ALLOWED_ROLES = new Set(['viewer', 'editor', 'owner']);

function sanitizeNotificationField(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > 300 ? cleaned.slice(0, 300) : cleaned;
}

function roleLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export async function handleManageCollaboratorAccess(input, deps) {
  if (input.method === 'OPTIONS') return { status: 200, body: null };
  if (input.method !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

  const jwt = String(input.authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === deps.anonKey) {
    return json(401, { success: false, error: 'Unauthorized' });
  }

  const actor = await deps.getUserFromToken(jwt);
  if (!actor) return json(401, { success: false, error: 'Unauthorized' });

  const kind = input.body?.kind;
  const resourceId = typeof input.body?.resourceId === 'string' ? input.body.resourceId.trim() : '';
  const targetUserId = typeof input.body?.targetUserId === 'string' ? input.body.targetUserId.trim() : '';
  const action = input.body?.action;
  const newRole = typeof input.body?.newRole === 'string' ? input.body.newRole.toLowerCase() : '';

  if (!ALLOWED_KINDS.has(kind) || !resourceId || !targetUserId) {
    return json(400, { success: false, error: 'Invalid request' });
  }
  if (action !== 'role' && action !== 'remove') {
    return json(400, { success: false, error: 'Invalid action' });
  }
  if (action === 'role' && !ALLOWED_ROLES.has(newRole)) {
    return json(400, { success: false, error: 'Invalid role' });
  }

  const collaborator = await deps.selectCollaborator(kind, resourceId, targetUserId);
  if (!collaborator) {
    return json(404, { success: false, error: 'Collaborator or resource not found' });
  }
  if (action === 'role' && collaborator.role === newRole) {
    return json(409, { success: false, error: 'Role is unchanged' });
  }
  const resource = await deps.selectResource(kind, resourceId);
  if (!resource) return json(404, { success: false, error: 'Collaborator or resource not found' });
  if (resource.user_id === targetUserId) {
    return json(409, { success: false, error: 'The resource creator cannot be changed' });
  }

  const changedRows = action === 'role'
    ? await deps.updateRole(kind, resourceId, targetUserId, newRole)
    : await deps.removeAccess(kind, resourceId, targetUserId);
  if (!Array.isArray(changedRows) || changedRows.length !== 1) {
    return json(403, { success: false, error: 'Access change was not authorized' });
  }

  const resourceName = sanitizeNotificationField(resource.name, kind === 'project' ? 'a project' : 'a document');
  const displayName = kind === 'project' ? `the project "${resourceName}"` : resourceName;
  const actorName = sanitizeNotificationField(
    actor.user_metadata?.full_name || actor.email,
    'An owner',
  );
  let targetEmail = null;
  try {
    targetEmail = await deps.getTargetEmail(targetUserId);
  } catch {
    return json(200, { success: true, emailSent: false });
  }
  if (!targetEmail) {
    return json(200, { success: true, emailSent: false });
  }

  let payload;
  if (action === 'role') {
    payload = {
      to: targetEmail,
      subject: `Your access to ${displayName} changed`,
      template: 'permission-changed',
      data: {
        documentName: displayName,
        changedByName: actorName,
        newRole: roleLabel(newRole),
        oldRole: roleLabel(collaborator.role || 'viewer'),
        documentUrl: CANONICAL_ORIGIN,
        appUrl: CANONICAL_ORIGIN,
      },
    };
  } else {
    payload = {
      to: targetEmail,
      subject: `Your access to ${displayName} was removed`,
      template: 'access-removed',
      data: {
        documentName: displayName,
        removedByName: actorName,
      },
    };
  }

  let emailSent = false;
  try {
    emailSent = await deps.sendEmail(payload);
  } catch {
    emailSent = false;
  }
  return json(200, { success: true, emailSent: !!emailSent });
}

// The one gate every agent tool passes. An agent gets exactly what its human
// has: the human's role on the document and the human's plan, never more.
// This check is for clear errors up front; the database (RLS, quota triggers)
// still refuses anything the human could not do, since the agent's requests
// carry the human's own sign-in.

export const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };

// tool.access = { signIn?: boolean, minRole?: 'viewer'|'editor'|'owner', feature?: string }
// ctx = { signedIn, role (for the document the tool acts on), features: string[] }
export function checkAgentAccess(access = {}, ctx = {}) {
  if ((access.signIn || access.minRole || access.feature) && !ctx.signedIn) {
    return 'Sign in to Survey first. Agents act as the signed-in user.';
  }
  if (access.minRole) {
    const have = ROLE_RANK[ctx.role] || 0;
    if (have < ROLE_RANK[access.minRole]) {
      return ctx.role
        ? `You are a ${ctx.role} on this document; this needs ${access.minRole}.`
        : 'You do not have access to this document.';
    }
  }
  if (access.feature) {
    const features = ctx.features || [];
    if (!features.includes('all') && !features.includes(access.feature)) {
      return 'Your Survey plan does not include this. Upgrade to use it.';
    }
  }
  return null;
}

export function planFeatures(tier, tierLimits) {
  return (tierLimits?.[tier] || tierLimits?.free)?.features || [];
}

/* GOAL-1 — send-invite-email: pure handler (dependency-injected, node-testable).
 *
 * Two-branch invite delivery, both branches SERVER-side so the response is
 * generic and never an account-existence oracle, and every emailed URL is
 * built from the canonical origin (never a dev/localhost origin):
 *   Branch A (no account yet): auth.admin.inviteUserByEmail → the proven
 *     Supabase auth mailer (owner-configured Brevo SMTP + installed branded
 *     "Invite" template) with redirectTo = canonical /invite/<token>.
 *   Branch B (account exists → GoTrue email_exists): after verifying the
 *     immediate document collaborator grant, call the deployed send-email
 *     function with a canonical direct-document URL and no invite token.
 *     Project/template invites, or document invites without a verified
 *     grant, keep the canonical acceptance URL.
 *
 * Authorization model: the caller's own JWT is used for the invite-row
 * lookup (anon-key client + caller Authorization header in index.ts), so
 * RLS owner-select policies decide visibility — exactly the same semantics
 * as the kal31 resend/revoke RPCs (co-owners included). A caller can only
 * make this function email the target of an invite row they legitimately
 * own; it is not an open relay. Tier gating remains UI-level (pre-existing,
 * see PLAN-GOAL1-invite-email.md follow-ups).
 *
 * All plan/security review: PLAN-GOAL1-invite-email.md +
 * PLAN-GOAL1-REVIEW-LOG.md (Codex APPROVED round 4).
 */

export const CANONICAL_ORIGIN = 'https://surveytool.app';

// Lookup order mirrors InviteAcceptPage.acceptAnyInvite (document is the
// common case). All three tables share the same column shape.
export const KIND_TABLES = [
  { kind: 'document', table: 'document_invites' },
  { kind: 'project', table: 'project_invites' },
  { kind: 'template', table: 'template_invites' },
];

export const CORS_HEADERS = {
  // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (false positive if an
  // audit flags it). Same bundle ships to web + Electron prod (file:// → Origin:
  // null) + Capacitor iOS/Android; an allowlist CORS-breaks email/Excel/payments
  // on desktop+mobile, and Electron would then need Origin:null allowed — the very
  // hole tightening tries to close. Bearer-token auth (not cookies) ⇒ '*' is
  // non-exploitable. Why: CLAUDE.md "DO NOT BREAK" + HANDOFF-post-launch-hardening.md
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COPY_MAX = 300;

function copyField(v, fallback) {
  if (typeof v !== 'string') return fallback;
  // Control chars stripped as header/subject-injection defense-in-depth —
  // these fields reach the email subject line, which send-email does not
  // HTML-escape (it isn't HTML).
  const s = v.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').trim();
  if (!s) return fallback;
  return s.length > COPY_MAX ? s.slice(0, COPY_MAX) : s;
}

function json(status, body) {
  return { status, body };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {{ method: string, authHeader: string|null, body: any }} input
 * @param {{
 *   anonKey: string,
 *   getUserFromToken: (jwt: string) => Promise<object|null>,
 *   selectInviteRow: (table: string, token: string) => Promise<object|null>,
 *   selectActiveDocumentAccess: (documentId: string, email: string) => Promise<{role: string}|null>,
 *   claimInviteDelivery: (kind: string, token: string, claimId: string) => Promise<'claimed'|'busy'|'completed'|'error'>,
 *   completeInviteDelivery: (claimId: string) => Promise<boolean>,
 *   releaseInviteDelivery: (claimId: string) => Promise<boolean>,
 *   newClaimId?: () => string,
 *   inviteUserByEmail: (email: string, redirectTo: string) => Promise<{ error: object|null, outcome?: 'confirmed'|'definite-failure'|'uncertain' }>,
 *   sendFallbackEmail: (payload: { to: string, subject: string, template: string, data: object }) => Promise<boolean|{ outcome: 'confirmed'|'definite-failure'|'uncertain' }>,
 * }} deps
 * @returns {Promise<{ status: number, body: object|null }>}
 */
export async function handleSendInviteEmail(input, deps) {
  if (input.method === 'OPTIONS') return { status: 200, body: null };
  if (input.method !== 'POST') return json(405, { sent: false, error: 'Method not allowed' });

  // Caller auth: a real signed-in user, never the anonymous public key.
  const jwt = String(input.authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === deps.anonKey) return json(401, { sent: false, error: 'Unauthorized' });
  const user = await deps.getUserFromToken(jwt);
  if (!user) return json(401, { sent: false, error: 'Unauthorized' });

  const token = typeof input.body?.token === 'string' ? input.body.token.trim() : '';
  if (!token) return json(400, { sent: false, error: 'Missing token' });

  // Cosmetic copy only — recipient/role/URLs come from the invite row.
  // (Escaped downstream by send-email's escapeHtml; length-capped here.)
  const inviterName = copyField(input.body?.inviterName, 'A Survey user');

  // Owner-scoped lookup: the row is only visible through the CALLER's RLS
  // authority (see index.ts), so "not found" uniformly covers unknown token
  // and not-your-invite.
  let found = null;
  for (const { kind, table } of KIND_TABLES) {
    const row = await deps.selectInviteRow(table, token);
    if (row) { found = { kind, row }; break; }
  }
  if (!found) return json(404, { sent: false, error: 'Invite not found' });

  const { kind, row } = found;
  const displayName = copyField(input.body?.displayName, `a ${kind}`);
  if (!row.target_email) return json(409, { sent: false, error: 'Invite is link-only' });
  if (row.revoked_at) return json(409, { sent: false, error: 'Invite was revoked' });
  if (row.accepted_at) return json(409, { sent: false, error: 'Invite already accepted' });
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return json(409, { sent: false, error: 'Invite expired' });
  }

  // Claim this exact invite generation before touching either transport.
  // The database RPC is the concurrency authority across all edge instances;
  // an in-memory lock would not protect simultaneous cold starts. Delivery
  // identity is a dedicated UUID, never expires_at, so an expiry refresh or a
  // retry after a lost response cannot accidentally mint a second send.
  const claimId = typeof deps.newClaimId === 'function'
    ? deps.newClaimId()
    : crypto.randomUUID();
  let claimStatus = 'error';
  try {
    claimStatus = await deps.claimInviteDelivery(kind, row.token, claimId);
  } catch (claimError) {
    console.error('[send-invite-email] delivery claim failed:', claimError);
  }
  if (claimStatus === 'completed') return json(200, { sent: true });
  if (claimStatus === 'busy') {
    return json(202, { sent: false, retryable: true, error: 'Delivery in progress' });
  }
  if (claimStatus !== 'claimed') {
    return json(502, { sent: false, retryable: true, error: 'Send failed' });
  }

  const releaseFailedClaim = async () => {
    try {
      await deps.releaseInviteDelivery(claimId);
    } catch (releaseError) {
      // A stranded claim fails closed. It is never automatically taken over:
      // after transport outcome is uncertain, silence is safer than a duplicate.
      console.error('[send-invite-email] delivery claim release failed:', releaseError);
    }
    return json(502, { sent: false, retryable: true, error: 'Send failed' });
  };
  const retainUncertainClaim = (transport) => {
    // The request crossed the transport boundary, but no authoritative
    // delivery result came back. Never release this generation: a retry could
    // duplicate an email the provider already accepted. Only the owner's
    // explicit Resend action may rotate to a new generation.
    console.error(`[send-invite-email] ${transport} delivery outcome is uncertain; retaining claim`);
    return json(502, { sent: false, retryable: false, error: 'Delivery outcome unknown' });
  };
  const completeConfirmedDelivery = async () => {
    try {
      const completed = await deps.completeInviteDelivery(claimId);
      if (!completed) {
        // The transport has confirmed delivery, so the honest response is
        // still sent:true. Keep the claim (do not release) to fail closed
        // against a duplicate. An owner can explicitly request a new delivery
        // generation when another copy is genuinely needed.
        console.error('[send-invite-email] confirmed send could not be marked completed');
      }
    } catch (completeError) {
      console.error('[send-invite-email] confirmed send completion failed:', completeError);
    }
    return json(200, { sent: true });
  };

  // Canonical, server-built — the only allowlisted origin; never client input.
  const inviteUrl = `${CANONICAL_ORIGIN}/invite/${encodeURIComponent(row.token)}`;

  // Branch A — no existing account: GoTrue sends the installed Invite
  // template via the auth mailer. Admin calls RETURN {data,error}; they
  // don't throw.
  const inviteResult = await deps.inviteUserByEmail(row.target_email, inviteUrl);
  const { error } = inviteResult;
  if (!error) return completeConfirmedDelivery();
  if (inviteResult.outcome === 'uncertain') {
    return retainUncertainClaim('auth mailer');
  }

  const isExisting = error.code === 'email_exists'
    || (error.status === 422 && /already.*registered|email_exists/i.test(error.message || ''));
  // Bulk-invite resilience: past the auth mailer's hourly cap GoTrue 429s.
  // Fall through to the Resend transport so the invitee still gets a real
  // email with the accept link (they sign up from the accept page — the
  // pre-GOAL-1 flow for every new user), instead of a silent drop.
  const isRateLimited = error.code === 'over_email_send_rate_limit' || error.status === 429;
  if (!isExisting && !isRateLimited) {
    console.error('[send-invite-email] inviteUserByEmail failed:', error.code || error.status || error.message);
    return releaseFailedClaim();
  }

  // Existing document accounts are granted access by documentInviteService
  // before this function is called. Verify that active grant through the
  // caller's owner-scoped RLS client before choosing a token-free direct link.
  // If lookup/grant failed, keep the still-valid acceptance link.
  let activeDocumentAccess = null;
  if (
    isExisting
    && kind === 'document'
    && row.document_id
    && typeof deps.selectActiveDocumentAccess === 'function'
  ) {
    activeDocumentAccess = await deps.selectActiveDocumentAccess(
      row.document_id,
      row.target_email,
    );
  }

  const roleLabel = capitalize(row.intended_role || row.role || 'viewer');
  const effectiveRole = capitalize(activeDocumentAccess?.role || 'viewer');
  const directRoleLabel = effectiveRole === 'Viewer' && roleLabel !== 'Viewer'
    ? `Viewer (${roleLabel} activates after upgrade)`
    : effectiveRole;
  const directDocumentUrl = `${CANONICAL_ORIGIN}/?docId=${encodeURIComponent(row.document_id || '')}`;
  const subject = activeDocumentAccess
    ? `${inviterName} shared ${displayName} with you on Survey`
    : `${inviterName} invited you to ${displayName} on Survey`;
  const fallbackResult = await deps.sendFallbackEmail({
    to: row.target_email,
    subject,
    template: activeDocumentAccess ? 'document-shared' : 'document-invite',
    data: activeDocumentAccess
      ? {
          documentName: displayName,
          sharedByName: inviterName,
          role: directRoleLabel,
          documentUrl: directDocumentUrl,
          appUrl: CANONICAL_ORIGIN,
        }
      : {
          documentName: displayName,
          inviterName,
          role: roleLabel,
          inviteUrl,
          expiresAt: row.expires_at || null,
        },
  });
  const fallbackOutcome = typeof fallbackResult === 'object'
    ? fallbackResult?.outcome
    : (fallbackResult ? 'confirmed' : 'definite-failure');
  if (fallbackOutcome === 'uncertain') {
    return retainUncertainClaim('fallback');
  }
  if (fallbackOutcome !== 'confirmed') {
    console.error('[send-invite-email] fallback send failed');
    return releaseFailedClaim();
  }
  return completeConfirmedDelivery();
}

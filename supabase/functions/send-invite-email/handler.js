/* GOAL-1 — send-invite-email: pure handler (dependency-injected, node-testable).
 *
 * Two-branch invite delivery, both branches SERVER-side so the response is
 * generic and never an account-existence oracle, and every emailed URL is
 * built from the canonical origin (never a dev/localhost origin):
 *   Branch A (no account yet): auth.admin.inviteUserByEmail → the proven
 *     Supabase auth mailer (owner-configured Brevo SMTP + installed branded
 *     "Invite" template) with redirectTo = canonical /invite/<token>.
 *   Branch B (account exists → GoTrue email_exists): server-to-server call
 *     to the deployed send-email function (Resend transport, per the
 *     GOAL-autonomous-post-launch.md decided default) with the same
 *     canonical invite URL.
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
 *   inviteUserByEmail: (email: string, redirectTo: string) => Promise<{ error: object|null }>,
 *   sendFallbackEmail: (payload: { to: string, subject: string, template: string, data: object }) => Promise<boolean>,
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

  // Canonical, server-built — the only allowlisted origin; never client input.
  const inviteUrl = `${CANONICAL_ORIGIN}/invite/${encodeURIComponent(row.token)}`;

  // Branch A — no existing account: GoTrue sends the installed Invite
  // template via the auth mailer. Admin calls RETURN {data,error}; they
  // don't throw.
  const { error } = await deps.inviteUserByEmail(row.target_email, inviteUrl);
  if (!error) return json(200, { sent: true });

  const isExisting = error.code === 'email_exists'
    || (error.status === 422 && /already.*registered|email_exists/i.test(error.message || ''));
  // Bulk-invite resilience: past the auth mailer's hourly cap GoTrue 429s.
  // Fall through to the Resend transport so the invitee still gets a real
  // email with the accept link (they sign up from the accept page — the
  // pre-GOAL-1 flow for every new user), instead of a silent drop.
  const isRateLimited = error.code === 'over_email_send_rate_limit' || error.status === 429;
  if (!isExisting && !isRateLimited) {
    console.error('[send-invite-email] inviteUserByEmail failed:', error.code || error.status || error.message);
    return json(502, { sent: false, error: 'Send failed' });
  }

  // Branch B — account exists (or auth mailer rate-limited): same generic
  // response, Resend transport via the deployed send-email function
  // (trusted service-role caller path).
  const roleLabel = capitalize(row.intended_role || row.role || 'viewer');
  const subject = `${inviterName} invited you to ${displayName} on Survey`;
  const ok = await deps.sendFallbackEmail({
    to: row.target_email,
    subject,
    template: 'document-invite',
    data: {
      documentName: displayName,
      inviterName,
      role: roleLabel,
      inviteUrl,
      expiresAt: row.expires_at || null,
    },
  });
  if (!ok) {
    console.error('[send-invite-email] fallback send failed');
    return json(502, { sent: false, error: 'Send failed' });
  }
  return json(200, { sent: true });
}

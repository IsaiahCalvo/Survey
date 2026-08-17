/* KAL-439 — send-email authorization policy (pure, dependency-injected,
 * node-testable like send-invite-email/handler.js).
 *
 * Closes the authenticated-open-relay hole: before this module existed, ANY
 * signed-in user could send an arbitrary {to, subject, template} through the
 * app's domain. The policy enforces, for user-JWT callers:
 *   1. a template allowlist (billing templates are service-role only);
 *   2. recipient binding — `to` must match a real invite/collaborator row the
 *      caller can see through their OWN RLS authority (owner-select policies
 *      on *_invites, owner-visible rows on *_collaborators). Free-form
 *      recipients are rejected;
 *   3. a per-user rate limit + the free-tier invite gate, both enforced
 *      atomically in the database via the claim_email_send RPC
 *      (20260817020000_kal439_email_send_guardrails.sql) so parallel edge
 *      instances cannot race past the cap.
 *
 * Service-role callers (stripe-webhook) are trusted infrastructure and are
 * not restricted here — their recipient/template are already server-derived.
 */

// Billing lifecycle emails: only our own backend (service-role key) may send.
export const SERVICE_ONLY_TEMPLATES = [
  'trial-ending',
  'payment-failed',
  'subscription-canceled',
  'payment-succeeded',
];

// Sharing emails a signed-in user may trigger — every one recipient-bound.
export const USER_TEMPLATES = [
  'document-invite',
  'document-shared',
  'permission-changed',
  'access-removed',
];

// Invite-class templates additionally require a paid tier ("Free users cannot
// create invites" — KAL-31 locked spec, previously UI-only).
export const INVITE_TEMPLATES = ['document-invite', 'document-shared'];

// Per-user sends per rolling hour (see claim_email_send). Generous enough for
// bulk team invites, far too small for a spam relay.
export const USER_HOURLY_SEND_LIMIT = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased, trimmed recipient — or null if it isn't a plausible email. */
export function normalizeRecipient(to) {
  if (typeof to !== 'string') return null;
  const email = to.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Escape LIKE/ILIKE wildcards so a recipient like "%@%" cannot be used to
 * pattern-match its way past the binding lookups. */
export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Authorize a user-JWT send request. Service-role callers must NOT be routed
 * through this function.
 *
 * @param {{ template: string, to: string }} request
 * @param {{
 *   findInviteRowForRecipient: (email: string) => Promise<{ revokedAt: string|null, acceptedAt: string|null, expiresAt: string|null }|null>,
 *   findActiveCollaboratorForRecipient: (email: string) => Promise<object|null>,
 *   claimSendBudget: (template: string, recipient: string, isInvite: boolean) => Promise<'allowed'|'rate_limited'|'invite_blocked_free_tier'|'error'>,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<{ ok: true, recipient: string } | { ok: false, status: number, error: string }>}
 */
export async function authorizeUserSend({ template, to }, deps) {
  if (SERVICE_ONLY_TEMPLATES.includes(template)) {
    return { ok: false, status: 403, error: 'This template is not available to app callers' };
  }
  if (!USER_TEMPLATES.includes(template)) {
    return { ok: false, status: 403, error: `Template not allowed: ${template}` };
  }

  const recipient = normalizeRecipient(to);
  if (!recipient) {
    return { ok: false, status: 400, error: 'Invalid recipient' };
  }

  // ---- Recipient binding (caller-scoped RLS decides what is visible). ----
  const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
  const invite = await deps.findInviteRowForRecipient(recipient);
  const inviteIsFresh = !!invite
    && !invite.revokedAt
    && !invite.acceptedAt
    && (!invite.expiresAt || new Date(invite.expiresAt).getTime() > nowMs);

  let bound = false;
  if (template === 'document-invite') {
    // A pending (unrevoked, unaccepted, unexpired) invite must exist.
    bound = inviteIsFresh;
  } else if (template === 'document-shared') {
    // Sent when an existing account already holds the grant: accept either the
    // (possibly just-accepted) invite row or the active collaborator row.
    bound = (!!invite && !invite.revokedAt)
      || !!(await deps.findActiveCollaboratorForRecipient(recipient));
  } else if (template === 'permission-changed') {
    bound = !!(await deps.findActiveCollaboratorForRecipient(recipient)) || !!invite;
  } else if (template === 'access-removed') {
    // The collaborator row is hard-deleted BEFORE this email goes out, so the
    // binding leans on the surviving invite rows (email invites persist after
    // acceptance/revocation). Link-only collaborators with no invite row fall
    // through to rejection — the notification is best-effort by design.
    bound = !!invite || !!(await deps.findActiveCollaboratorForRecipient(recipient));
  }
  if (!bound) {
    return {
      ok: false,
      status: 403,
      error: 'Recipient is not tied to an invite or share you manage',
    };
  }

  // ---- Tier gate + per-user rate limit (atomic, in the database). ----
  const budget = await deps.claimSendBudget(
    template,
    recipient,
    INVITE_TEMPLATES.includes(template),
  );
  if (budget === 'invite_blocked_free_tier') {
    return { ok: false, status: 403, error: 'Sharing invites require a Pro subscription' };
  }
  if (budget === 'rate_limited') {
    return { ok: false, status: 429, error: 'Too many emails sent — try again later' };
  }
  if (budget !== 'allowed') {
    return { ok: false, status: 503, error: 'Email delivery is temporarily unavailable' };
  }

  return { ok: true, recipient };
}

/** Strip header-injection vectors from a caller-supplied subject line. */
export function sanitizeSubject(subject, fallback) {
  if (typeof subject !== 'string') return fallback;
  const clean = subject.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 300 ? clean.slice(0, 300) : clean;
}

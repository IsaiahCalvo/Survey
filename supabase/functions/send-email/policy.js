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
 * Choose the invite row that should represent this recipient for binding.
 * Candidate rows come from ALL invite tables — a FRESH (unrevoked, unaccepted,
 * unexpired) row always outranks stale ones regardless of table or age, so a
 * stale revoked document invite can never shadow a live project/template
 * invite and 403 a legitimate email. With no fresh row, the newest stale row
 * wins (it still binds document-shared / access-removed).
 *
 * @param {Array<{ revokedAt: string|null, acceptedAt: string|null, expiresAt: string|null, createdAt?: string|null }>} rows
 * @param {number} [nowMs]
 */
export function pickBindingInviteRow(rows, nowMs = Date.now()) {
  const candidates = (rows || []).filter(Boolean);
  if (!candidates.length) return null;
  const isFresh = (row) => !row.revokedAt
    && !row.acceptedAt
    && (!row.expiresAt || new Date(row.expiresAt).getTime() > nowMs);
  const newestFirst = [...candidates].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
  return newestFirst.find(isFresh) ?? newestFirst[0];
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
    // A revoked invite is no tie: only a live collaborator or an unrevoked
    // invite (a pending person whose role changed) may get this email.
    bound = !!(await deps.findActiveCollaboratorForRecipient(recipient))
      || (!!invite && !invite.revokedAt);
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

// Sharing emails go out from no-reply@surveytool.app, so a signed-in caller
// must not choose their subject line or where their buttons point: that would
// make the app a phishing sender. User-template subjects are rebuilt here from
// the template, and every link is pinned to one of our own web origins.
export const APP_ORIGIN = 'https://surveytool.app';
const LINK_ORIGINS = new Set([
  APP_ORIGIN,
  'https://surveytool-nightly.vercel.app',
  'http://localhost:5173',
]);

function subjectName(value, fallback) {
  const clean = typeof value === 'string'
    ? value.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (!clean) return fallback;
  return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

/** Server-built subject for a user template (the caller's subject is ignored). */
export function userTemplateSubject(template, data = {}) {
  const doc = subjectName(data?.documentName, 'a document');
  switch (template) {
    case 'document-invite':
      return `${subjectName(data?.inviterName, 'A Survey user')} invited you to ${doc} on Survey`;
    case 'document-shared':
      return `${subjectName(data?.sharedByName, 'A Survey user')} shared ${doc} with you on Survey`;
    case 'permission-changed':
      return `Your access to ${doc} changed`;
    case 'access-removed':
      return `Your access to ${doc} was removed`;
    default:
      return 'Notification from Survey';
  }
}

/** Keep a link on our own web origin. Any other origin (an attacker's site, or
 * file:// / capacitor:// from the desktop and phone apps) is moved onto
 * https://surveytool.app with the same query and hash. Unparseable → '#'. */
export function pinLinkToApp(value) {
  if (typeof value !== 'string' || !value.trim()) return '#';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return '#';
  }
  if (LINK_ORIGINS.has(url.origin)) return url.href;
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  const pathname = web ? url.pathname : '/';
  return `${APP_ORIGIN}${pathname}${url.search}${url.hash}`;
}

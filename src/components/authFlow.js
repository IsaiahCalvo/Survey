/**
 * authFlow.js — pure helpers for the account-flow UI state machines.
 *
 * No React, no Supabase, no DOM — importable from node tests. Used by
 * AuthModal.jsx (resend-confirmation cooldown) and ResetPasswordPage.jsx
 * (recovery-session phase resolution + new-password validation).
 */

// How long the resend-confirmation button stays disabled after each send.
export const RESEND_COOLDOWN_MS = 30_000;

// How long ResetPasswordPage keeps waiting for a recovery session after the
// AuthProvider finishes booting. detectSessionInUrl exchanges the emailed
// link's code during client initialization, so the session is normally
// present by the time boot completes — this grace window only covers a
// late-arriving PASSWORD_RECOVERY event before we declare the link invalid.
export const RECOVERY_SESSION_GRACE_MS = 4_000;

// Milliseconds left on the resend cooldown; 0 when nothing was sent yet or
// the cooldown elapsed. `lastSentAt`/`now` are epoch-ms timestamps.
export function resendCooldownRemainingMs(lastSentAt, now, cooldownMs = RESEND_COOLDOWN_MS) {
  if (!lastSentAt) return 0;
  const remaining = cooldownMs - (now - lastSentAt);
  return remaining > 0 ? remaining : 0;
}

// ResetPasswordPage phase machine, session-detection side:
//   'checking' → 'ready'   (a session exists — recovery link worked)
//   'checking' → 'invalid' (boot finished, grace elapsed, still no session)
// Submit-side transitions ('ready' → 'success', 'invalid' → 'link-sent')
// happen directly in the component on the async call results.
export function resolveRecoveryPhase({ hasSession, bootFinished, graceElapsed }) {
  if (hasSession) return 'ready';
  if (bootFinished && graceElapsed) return 'invalid';
  return 'checking';
}

// Password policy — kept in sync with the Supabase auth config (min length +
// required character classes) so the client blocks weak passwords with a
// friendly message before the server ever returns its raw policy error.
export const PASSWORD_MIN_LENGTH = 12;

// Live requirements checklist for a candidate password. Pure + synchronous so
// the tooltip and validators share one source of truth. `opts` lets callers
// pass the email/name so we can reject passwords that embed personal info.
// The reuse-history and breached-password checks are enforced server-side
// (Supabase same-password rejection + leaked-password protection), not here.
export function passwordRequirements(password = '', opts = {}) {
  const pw = String(password || '');
  const lower = pw.toLowerCase();
  const email = String(opts.email || '').toLowerCase().trim();
  const emailLocal = email.split('@')[0] || '';
  const personal = [emailLocal, opts.firstName, opts.lastName]
    .map((s) => String(s || '').toLowerCase().trim())
    .filter((s) => s.length >= 3);
  const containsPersonal = pw.length > 0 && personal.some((p) => lower.includes(p));
  return [
    { id: 'length', label: `Be at least ${PASSWORD_MIN_LENGTH} characters long`, met: pw.length >= PASSWORD_MIN_LENGTH },
    { id: 'upper', label: 'Contain an uppercase letter (A–Z)', met: /[A-Z]/.test(pw) },
    { id: 'lower', label: 'Contain a lowercase letter (a–z)', met: /[a-z]/.test(pw) },
    { id: 'number', label: 'Contain a number (0–9)', met: /[0-9]/.test(pw) },
    { id: 'special', label: 'Contain a special character (e.g. ! @ # $ % ^ & *)', met: /[^A-Za-z0-9\s]/.test(pw) },
    { id: 'nospace', label: 'Not contain any spaces', met: pw.length > 0 && !/\s/.test(pw) },
    { id: 'nopersonal', label: 'Not contain your name or email', met: pw.length > 0 && !containsPersonal },
  ];
}

// True when every checkable requirement is met.
export function passwordMeetsRequirements(password, opts = {}) {
  return passwordRequirements(password, opts).every((r) => r.met);
}

// Returns an error string, or null when the pair is acceptable. Enforces the
// full requirement set (see passwordRequirements) plus the confirm match.
export function validateNewPassword(password, confirmPassword, opts = {}) {
  if (!password) return 'Please enter a new password';
  if (!passwordMeetsRequirements(password, opts)) return 'Password does not meet requirements';
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

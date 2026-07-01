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

// Returns an error string, or null when the pair is acceptable. The 6-char
// minimum matches Supabase's default policy and AccountSettings.jsx.
export function validateNewPassword(password, confirmPassword) {
  if (!password) return 'Please enter a new password';
  if (password.length < 6) return 'Password must be at least 6 characters';
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

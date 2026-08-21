/** Re-sign-in must restore the same account that expired. */
export function isSameReSignInUser(expectedUserId, signedInUserId) {
  if (!expectedUserId || !signedInUserId) return true;
  return String(expectedUserId) === String(signedInUserId);
}

/**
 * Forgot-password on the inline re-sign-in modal uses the same
 * AuthContext.resetPassword path as AuthModal / AccountSettings.
 * Empty email and an unfinished Turnstile must fail closed — never claim a send.
 */
export function planReSignInPasswordReset({
  email,
  captchaToken,
  captchaBroken,
  turnstileEnabled,
} = {}) {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (!trimmed) return { ok: false, errorCode: 'reset_email' };
  if (turnstileEnabled && !captchaToken && !captchaBroken) {
    return { ok: false, errorCode: 'captcha' };
  }
  return { ok: true, email: trimmed, captchaToken: captchaToken || '' };
}

export function describeReSignInResetOutcome(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('captcha') || msg.includes('verification') || msg.includes('human')) {
    return 'captcha';
  }
  if (msg.includes('network') || err?.name === 'TypeError' || msg.includes('fetch')) {
    return 'network';
  }
  return 'reset_failed';
}

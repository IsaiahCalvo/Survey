// A person who joined through an invite email (Supabase "invite" link) is
// signed in by the link itself: they never typed a name or a password, and
// never ticked the Terms box. Without a password they cannot sign in again on
// another device or after the session ends, so the invite page asks them to
// finish their account first (KAL-649).

export function needsAccountFinish(user) {
  if (!user || user.is_anonymous) return false;
  if (!user.invited_at) return false;
  const providers = user.app_metadata?.providers || [user.app_metadata?.provider].filter(Boolean);
  // Google or Microsoft sign-in gives them a way back in already.
  if (providers.some((p) => p && p !== 'email')) return false;
  return !user.user_metadata?.terms_accepted;
}

export function finishAccountError({ firstName, lastName, agreed }) {
  if (!String(firstName || '').trim() || !String(lastName || '').trim()) return 'Enter your first and last name.';
  if (!agreed) return 'Tick the box to agree to the Terms of Service and Privacy Policy.';
  return null;
}

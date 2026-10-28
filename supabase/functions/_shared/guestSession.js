// Guest links (Nightly): a guest is an anonymous Supabase session that can
// open one shared document. The edge functions do account work (email,
// billing, Excel, the agents), so they turn guest sessions away. Plain JS so
// Deno, Vite and node tests load the same file.

export const GUEST_REFUSED_MESSAGE = 'Guests cannot do this. Sign in with a Survey account.';

/** True for an anonymous (guest) user from auth.getUser. */
export function isGuestUser(user) {
  return user?.is_anonymous === true;
}

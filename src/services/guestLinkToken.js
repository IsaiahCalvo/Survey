// src/services/guestLinkToken.js
//
// The guest link secret in a page address (/?guest=<secret>). AppShell reads
// it on every load, so it stays apart from the rest of services/guestLinks.js.

export const GUEST_LINK_PARAM = 'guest';

/** The secret in a page address, or null. */
export function guestTokenFrom(href) {
  try {
    const value = new URL(href).searchParams.get(GUEST_LINK_PARAM);
    return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

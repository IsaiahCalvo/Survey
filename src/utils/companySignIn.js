/**
 * companySignIn.js — input + error helpers for company single sign-on (SAML
 * through Supabase Auth's signInWithSSO).
 *
 * People type a work email ("jane@acme.com"), a bare domain, or paste a URL.
 * Supabase matches the registered provider by bare domain, so reduce all of
 * those to "acme.com" before calling it.
 */

export function companyDomainFrom(input) {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return '';
  const at = value.lastIndexOf('@');
  if (at !== -1) value = value.slice(at + 1);
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  value = value.split(/[/?#:]/)[0].replace(/\.+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : '';
}

// Supabase answers saml_provider_disabled while SAML is off for the project
// and sso_provider_not_found when no company is registered for the domain.
// Either way the person can't fix it themselves, so say what to do instead of
// showing the raw server text.
export function companySignInErrorMessage(error, domain) {
  const code = error?.code || error?.error_code || '';
  const text = String(error?.message || '');
  const notSetUp = code === 'saml_provider_disabled'
    || code === 'sso_provider_not_found'
    || /saml 2\.0 is disabled|no sso provider/i.test(text);
  if (notSetUp) {
    const who = domain ? ` for ${domain}` : '';
    return `Company sign-in isn't set up${who} yet. Ask your IT team to contact Survey, or sign in with your email for now.`;
  }
  return text || 'Company sign-in failed. Please try again.';
}

// When a company requires its own sign-in and someone signs in another way,
// the app signs them out and reloads; this note (one tab, this session)
// lets the sign-in form open on company sign-in and say why.
const REQUIRED_NOTE_KEY = 'survey.companySignInRequired';

export function markCompanySignInRequired(email) {
  try { sessionStorage.setItem(REQUIRED_NOTE_KEY, companyDomainFrom(email) || '1'); } catch { /* storage off */ }
}

// Reads the note without clearing it: the domain, '' when there was a note
// without one, or null when there was none. The sign-out reloads the page
// right after the form first opens, so the note has to outlive that first
// look; the form clears it once it closes, and a signed-in check clears it.
export function peekCompanySignInRequired() {
  try {
    const value = sessionStorage.getItem(REQUIRED_NOTE_KEY);
    if (value == null) return null;
    return value === '1' ? '' : value;
  } catch {
    return null;
  }
}

export function clearCompanySignInRequired() {
  try { sessionStorage.removeItem(REQUIRED_NOTE_KEY); } catch { /* storage off */ }
}

export const companySignInOfferMessage = (domain) =>
  `${domain ? `${domain} signs in` : 'Your company signs in'} with its work account. Continue with company SSO below.`;

export const companySignInRequiredMessage = (domain) =>
  `${domain ? `${domain} asks` : 'Your company asks'} you to sign in with your work account. Continue with company SSO below.`;

// A company sign-in that fails at Supabase comes back to the app with the
// reason only in the address (`?error_code=saml_assertion_no_email&...`), and
// the form looked as if nothing had happened. The form remembers the domain
// before it leaves, then reads, explains and removes the reason on return.
const ATTEMPT_KEY = 'survey.companySignInAttempt';

export function noteCompanySignInAttempt(domain) {
  try { sessionStorage.setItem(ATTEMPT_KEY, domain || ''); } catch { /* storage off */ }
}

const FAILURE_PARAMS = ['error', 'error_code', 'error_description'];

function failureMessage(code, description) {
  if (code === 'saml_assertion_no_email' || /does not contain an email/i.test(description)) {
    return "Your company's sign-in didn't send your email address to Survey. Ask your IT team to include the email claim, then try again.";
  }
  if (/relaystate has expired|try logging in again/i.test(description)) {
    return 'Company sign-in took too long to finish. Please try again.';
  }
  return `Company sign-in didn't finish${description ? `: ${description}` : '.'} Please try again.`;
}

/**
 * The company sign-in failure in this address, or null. Only a SAML/SSO error,
 * or any error right after this tab started company sign-in, counts. Removes
 * the reason from the address so a reload doesn't show it again.
 * @returns {{ domain: string, message: string } | null}
 */
export function takeCompanySignInFailure(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.location) return null;
  let attempt = null;
  try { attempt = win.sessionStorage?.getItem(ATTEMPT_KEY) ?? null; } catch { /* storage off */ }
  const url = new URL(win.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const from = url.searchParams.has('error_code') || url.searchParams.has('error') ? url.searchParams : hash;
  const code = from.get('error_code') || '';
  const description = from.get('error_description') || '';
  if (!code && !from.get('error')) return null;
  const isCompany = /^(saml|sso)_/.test(code) || /saml|sso/i.test(description);
  if (!isCompany && attempt === null) return null;
  for (const key of FAILURE_PARAMS) { url.searchParams.delete(key); hash.delete(key); }
  const rest = hash.toString();
  try {
    win.history?.replaceState?.(win.history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);
  } catch { /* history off */ }
  try { win.sessionStorage?.removeItem(ATTEMPT_KEY); } catch { /* storage off */ }
  return { domain: attempt || '', message: failureMessage(code, description) };
}

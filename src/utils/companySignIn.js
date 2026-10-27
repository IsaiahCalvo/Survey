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

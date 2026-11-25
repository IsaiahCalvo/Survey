import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companyDomainFrom, companySignInErrorMessage } from '../src/utils/companySignIn.js';

const AUTH_MODAL_SOURCE = readFileSync(new URL('../src/components/AuthModal.jsx', import.meta.url), 'utf8');
const AUTH_CONTEXT_SOURCE = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');

test('company sign-in reduces a work email, domain or URL to the bare domain', () => {
  assert.equal(companyDomainFrom('jane@Acme.com'), 'acme.com');
  assert.equal(companyDomainFrom('  acme.com  '), 'acme.com');
  assert.equal(companyDomainFrom('https://www.acme.co.uk/login?x=1'), 'acme.co.uk');
  assert.equal(companyDomainFrom('@acme.com'), 'acme.com');
  assert.equal(companyDomainFrom('acme.com.'), 'acme.com');
  assert.equal(companyDomainFrom('acme.com:443'), 'acme.com');
});

test('company sign-in rejects input with no usable domain', () => {
  for (const bad of ['', '   ', 'acme', 'jane@', 'not a domain.com', null, undefined]) {
    assert.equal(companyDomainFrom(bad), '', `expected "" for ${JSON.stringify(bad)}`);
  }
});

test('a company that is not set up gets a plain next step, not the server text', () => {
  for (const error of [
    { code: 'saml_provider_disabled', message: 'SAML 2.0 is disabled' },
    { code: 'sso_provider_not_found', message: 'No SSO provider assigned for this domain' },
    { message: 'SAML 2.0 is disabled' },
  ]) {
    const message = companySignInErrorMessage(error, 'acme.com');
    assert.match(message, /isn't set up for acme\.com yet/);
    assert.doesNotMatch(message, /SAML|provider/);
  }
});

test('other company sign-in errors keep their own text', () => {
  assert.equal(companySignInErrorMessage({ message: 'captcha protection: request disallowed' }, 'acme.com'), 'captcha protection: request disallowed');
  assert.equal(companySignInErrorMessage({}, 'acme.com'), 'Company sign-in failed. Please try again.');
});

test('company sign-in sends the captcha token and returns to the same app', () => {
  // Supabase runs its captcha check on POST /sso, so the modal must collect a
  // Turnstile token in SSO mode and the context must forward it.
  assert.match(AUTH_MODAL_SOURCE, /captchaMode = [^;]*mode === 'sso'/);
  assert.match(AUTH_MODAL_SOURCE, /signInWithSSO\(domain, captchaToken\)/);
  const ssoCall = AUTH_CONTEXT_SOURCE.match(/supabase\.auth\.signInWithSSO\(\{[\s\S]*?\}\);/)?.[0] || '';
  assert.match(ssoCall, /redirectTo: authRedirectTarget\(\)/);
  assert.match(ssoCall, /captchaToken/);
});

test('OneDrive is a Pro feature, as the pricing page sells it', () => {
  assert.match(AUTH_CONTEXT_SOURCE, /oneDrive: \['pro', 'enterprise', 'developer'\]\.includes\(subscriptionTier\)/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(viewer, /features\?\.sso/);
  assert.match(viewer, /if \(!features\?\.oneDrive\)/);
});

test('a failed password on a company-sign-in email moves the form to company sign-in', async () => {
  const { companySignInOfferMessage } = await import('../src/utils/companySignIn.js');
  assert.match(companySignInOfferMessage('acme.com'), /acme\.com signs in with its work account/);
  const loginBlock = AUTH_MODAL_SOURCE.slice(AUTH_MODAL_SOURCE.indexOf("if (mode === 'login')"));
  const tryAt = loginBlock.indexOf('await signIn(email, password, captchaToken)');
  const askAt = loginBlock.indexOf('await companySignInForEmail(email)');
  assert.ok(tryAt > 0 && askAt > tryAt, 'asks about company sign-in only after the password fails');
  const branch = loginBlock.slice(askAt, askAt + 500);
  assert.match(branch, /setMode\('sso'\)/);
  assert.match(branch, /setSsoDomain\(domain\)/);
  assert.match(branch, /resetCaptcha\(\)/, 'a fresh human check for the SSO step');
  const migration = readFileSync(new URL('../supabase/migrations/20261125100000_company_sign_in_for_email.sql', import.meta.url), 'utf8');
  assert.match(migration, /d\.verified_at is not null/);
  assert.match(migration, /o\.sso_provider_id is not null/);
  assert.doesNotMatch(migration, /require_sso/, 'offered whether or not the company requires it');
  assert.match(migration, /grant execute on function public\.company_sign_in_for_email\(text\) to anon/);
});

function fakeWindow(href, attempt) {
  const store = new Map(attempt == null ? [] : [['survey.companySignInAttempt', attempt]]);
  const win = {
    location: { href },
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    history: { state: null, replaceState: (_s, _t, next) => { win.replaced = next; } },
  };
  return win;
}

test('a failed company sign-in comes back with a plain reason and a clean address', async () => {
  const { takeCompanySignInFailure } = await import('../src/utils/companySignIn.js');
  const win = fakeWindow('https://surveytool.app/?error=invalid_request&error_code=saml_assertion_no_email&error_description=SAML+Assertion+does+not+contain+an+email+address', 'acme.com');
  const failure = takeCompanySignInFailure(win);
  assert.equal(failure.domain, 'acme.com');
  assert.match(failure.message, /didn't send your email address/);
  assert.equal(win.replaced, '/');
  assert.equal(win.sessionStorage.getItem('survey.companySignInAttempt'), null);
  assert.equal(takeCompanySignInFailure(fakeWindow('https://surveytool.app/?tab=1')), null);
  // An unrelated error with no company sign-in under way is left alone.
  assert.equal(takeCompanySignInFailure(fakeWindow('https://surveytool.app/#error=access_denied&error_code=otp_expired')), null);
  const late = takeCompanySignInFailure(fakeWindow('https://surveytool.app/?x=2#error=server_error&error_description=SAML+RelayState+has+expired.+Try+logging+in+again%3F', ''));
  assert.match(late.message, /took too long/);
  assert.match(AUTH_MODAL_SOURCE, /noteCompanySignInAttempt\(domain\);\s*await signInWithSSO/);
  assert.match(AUTH_MODAL_SOURCE, /takeCompanySignInFailure\(\)/);
});

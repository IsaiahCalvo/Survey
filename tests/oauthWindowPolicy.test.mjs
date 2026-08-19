// Allowlist guarding the legacy embedded Microsoft OAuth window (KAL-289).
//
// The handler in src/electron-main.js used to trust whatever authUrl /
// redirectUri the renderer handed it and to declare the flow complete on
// `url.startsWith(redirectUri)`. These tests pin the replacement: exact origin
// equality against a hard-coded list, and an origin+path completion check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ALLOWED_AUTH_ORIGINS,
  ALLOWED_REDIRECT_ORIGINS,
  validateOAuthWindowRequest,
  isRedirectCallback,
} from '../src/electron/oauthWindowPolicy.cjs';

const AUTH_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&response_type=code';
const REDIRECT_URI = 'https://surveytool.app/';

test('a legitimate Microsoft auth URL and registered redirect are accepted', () => {
  const result = validateOAuthWindowRequest({ authUrl: AUTH_URL, redirectUri: REDIRECT_URI });
  assert.equal(result.ok, true);
  assert.equal(result.redirect.origin, 'https://surveytool.app');
  assert.equal(result.redirect.pathname, '/');
});

test('every registered redirect origin is accepted', () => {
  for (const origin of ALLOWED_REDIRECT_ORIGINS) {
    const result = validateOAuthWindowRequest({ authUrl: AUTH_URL, redirectUri: `${origin}/` });
    assert.equal(result.ok, true, `${origin} must be allowed`);
  }
});

test('the /mobile redirect path is accepted and round-trips', () => {
  const result = validateOAuthWindowRequest({
    authUrl: AUTH_URL,
    redirectUri: 'https://surveytool.app/mobile',
  });
  assert.equal(result.ok, true);
  assert.equal(result.redirect.pathname, '/mobile');
});

test('lookalike auth hosts are refused', () => {
  for (const authUrl of [
    'https://login.microsoftonline.com.evil.com/common/oauth2/v2.0/authorize',
    'https://login.microsoftonline.com.attacker.test/authorize',
    'https://evil.com/login.microsoftonline.com/authorize',
    'https://loginxmicrosoftonline.com/authorize',
    'https://attacker.example/?next=https://login.microsoftonline.com',
  ]) {
    const result = validateOAuthWindowRequest({ authUrl, redirectUri: REDIRECT_URI });
    assert.equal(result.ok, false, `${authUrl} must be refused`);
    assert.equal(result.error, 'auth-url-origin-not-allowed');
  }
});

test('lookalike redirect hosts are refused', () => {
  for (const redirectUri of [
    'https://evil-supabase.co/',
    'https://surveytool.app.evil.com/',
    'https://surveytool.app.attacker.test/',
    'https://evilsurveytool.app/',
    'https://surveytool.app.co/',
    'http://localhost:5174/',
  ]) {
    const result = validateOAuthWindowRequest({ authUrl: AUTH_URL, redirectUri });
    assert.equal(result.ok, false, `${redirectUri} must be refused`);
    assert.equal(result.error, 'redirect-uri-origin-not-allowed');
  }
});

test('a scheme-only or empty redirect is refused', () => {
  // The original bug: redirectUri "https://" prefix-matched the very first
  // navigation, so the handler returned the callback URL (with the
  // authorization code) to whoever asked.
  for (const redirectUri of ['https://', 'http://', '', null, undefined, '   ']) {
    const result = validateOAuthWindowRequest({ authUrl: AUTH_URL, redirectUri });
    assert.equal(result.ok, false, `${String(redirectUri)} must be refused`);
  }
});

test('an unparseable URL is refused rather than throwing', () => {
  for (const authUrl of ['not a url', '://///', 'https://', '', null, undefined, 42, {}]) {
    const result = validateOAuthWindowRequest({ authUrl, redirectUri: REDIRECT_URI });
    assert.equal(result.ok, false, `${String(authUrl)} must be refused`);
  }
  for (const redirectUri of ['not a url', '://///', 7, []]) {
    const result = validateOAuthWindowRequest({ authUrl: AUTH_URL, redirectUri });
    assert.equal(result.ok, false, `${String(redirectUri)} must be refused`);
  }
  assert.equal(validateOAuthWindowRequest().ok, false);
  assert.equal(validateOAuthWindowRequest({}).ok, false);
});

test('non-https auth schemes are refused', () => {
  for (const authUrl of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>1</script>',
    'http://login.microsoftonline.com/authorize',
  ]) {
    const result = validateOAuthWindowRequest({ authUrl, redirectUri: REDIRECT_URI });
    assert.equal(result.ok, false, `${authUrl} must be refused`);
  }
});

test('the completion check matches origin and path, not a string prefix', () => {
  const { redirect } = validateOAuthWindowRequest({ authUrl: AUTH_URL, redirectUri: REDIRECT_URI });

  assert.equal(isRedirectCallback('https://surveytool.app/?code=abc&state=xyz', redirect), true);
  assert.equal(isRedirectCallback('https://surveytool.app/#code=abc', redirect), true);
  assert.equal(isRedirectCallback('https://surveytool.app', redirect), true);

  // Prefix-matching traps that the old startsWith() accepted.
  assert.equal(isRedirectCallback('https://surveytool.app.evil.com/?code=abc', redirect), false);
  assert.equal(isRedirectCallback('https://login.microsoftonline.com/common/', redirect), false);
  assert.equal(isRedirectCallback('http://surveytool.app/?code=abc', redirect), false);
  assert.equal(isRedirectCallback('https://surveytool.app/other?code=abc', redirect), false);
  assert.equal(isRedirectCallback('garbage', redirect), false);
  assert.equal(isRedirectCallback('https://surveytool.app/', null), false);
});

test('the /mobile completion check does not accept the root callback', () => {
  const { redirect } = validateOAuthWindowRequest({
    authUrl: AUTH_URL,
    redirectUri: 'https://surveytool.app/mobile',
  });
  assert.equal(isRedirectCallback('https://surveytool.app/mobile?code=abc', redirect), true);
  assert.equal(isRedirectCallback('https://surveytool.app/mobile/?code=abc', redirect), true);
  assert.equal(isRedirectCallback('https://surveytool.app/?code=abc', redirect), false);
  assert.equal(isRedirectCallback('https://surveytool.app/mobilexyz?code=abc', redirect), false);
});

test('the allowlists are frozen and contain no wildcards', () => {
  assert.equal(Object.isFrozen(ALLOWED_AUTH_ORIGINS), true);
  assert.equal(Object.isFrozen(ALLOWED_REDIRECT_ORIGINS), true);
  for (const origin of [...ALLOWED_AUTH_ORIGINS, ...ALLOWED_REDIRECT_ORIGINS]) {
    assert.equal(origin, new URL(origin).origin, `${origin} must be a bare origin`);
    assert.ok(!origin.includes('*'), `${origin} must not contain a wildcard`);
  }
});

test('electron-main gates oauth:openWindow on the allowlist, not startsWith', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const electronMain = readFileSync(join(root, 'src', 'electron-main.js'), 'utf8');
  assert.match(electronMain, /validateOAuthWindowRequest\(\{ authUrl, redirectUri \}\)/);
  assert.match(electronMain, /isRedirectCallback\(url, allowedRedirect\)/);
  assert.ok(
    !/url\.startsWith\(redirectUri\)/.test(electronMain),
    'the prefix-matching completion check must not come back'
  );
});

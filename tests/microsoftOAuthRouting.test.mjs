import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  cleanMicrosoftReturnUrl,
  isCapacitorNativeRuntime,
  isMicrosoftConnectAvailable,
  microsoftRedirectUriFor,
  microsoftReturnUrlFor,
  shouldStartFullPageMicrosoftOAuth,
} from '../src/utils/microsoftOAuthRouting.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contextSource = readFileSync(join(root, 'src', 'contexts', 'MSGraphContext.jsx'), 'utf8');
const accountSettingsSource = readFileSync(join(root, 'src', 'components', 'AccountSettings.jsx'), 'utf8');

test('registered origins keep their Azure redirect; unknown browser origins fall back to production', () => {
  assert.equal(
    microsoftRedirectUriFor({ origin: 'https://surveytool.app', pathname: '/' }),
    'https://surveytool.app/',
  );
  assert.equal(
    microsoftRedirectUriFor({ origin: 'https://www.surveytool.app', pathname: '/' }),
    'https://surveytool.app/',
  );
  assert.equal(
    microsoftRedirectUriFor({ origin: 'http://localhost:5173', pathname: '/' }),
    'http://localhost:5173/',
  );
  assert.equal(
    microsoftRedirectUriFor({ origin: 'http://localhost:5173', pathname: '/mobile' }),
    'http://localhost:5173/mobile',
  );
  assert.equal(
    microsoftRedirectUriFor({ origin: 'http://127.0.0.1:5173', pathname: '/' }),
    'https://surveytool.app/',
  );
  assert.equal(microsoftRedirectUriFor(null), 'https://surveytool.app/');
});

test('return URL keeps path/search/hash and cleanMicrosoftReturnUrl strips only OAuth fields', () => {
  const location = {
    origin: 'https://surveytool.app',
    pathname: '/mobile',
    search: '?mobileNav=tabs&invite=abc',
    hash: '#team',
  };
  assert.equal(microsoftReturnUrlFor(location), '/mobile?mobileNav=tabs&invite=abc#team');
  assert.equal(
    cleanMicrosoftReturnUrl(
      '/mobile?mobileNav=tabs&invite=abc&code=secret&state=s&error=access_denied&error_description=no#team',
      location.origin,
    ),
    '/mobile?mobileNav=tabs&invite=abc#team',
  );
  assert.throws(
    () => cleanMicrosoftReturnUrl('https://evil.example/', location.origin),
    /cross-origin/,
  );
});

test('Capacitor native runtime hides Connect and never starts a full-page OAuth redirect', () => {
  const capacitorWindow = {
    Capacitor: { isNativePlatform: () => true },
    location: { origin: 'capacitor://localhost', pathname: '/mobile' },
  };
  assert.equal(isCapacitorNativeRuntime(capacitorWindow), true);
  assert.equal(isMicrosoftConnectAvailable(capacitorWindow), false);
  assert.equal(shouldStartFullPageMicrosoftOAuth(capacitorWindow), false);

  const capacitorOriginOnly = {
    location: { origin: 'capacitor://localhost', pathname: '/mobile' },
  };
  assert.equal(isCapacitorNativeRuntime(capacitorOriginOnly), true);
  assert.equal(isMicrosoftConnectAvailable(capacitorOriginOnly), false);

  const ionicOrigin = { location: { origin: 'ionic://localhost', pathname: '/' } };
  assert.equal(isMicrosoftConnectAvailable(ionicOrigin), false);
  assert.equal(shouldStartFullPageMicrosoftOAuth(ionicOrigin), false);
});

test('web and Electron still offer Connect; Capacitor origin redirect stays unused production fallback', () => {
  const web = { location: { origin: 'https://surveytool.app', pathname: '/' } };
  assert.equal(isMicrosoftConnectAvailable(web), true);
  assert.equal(shouldStartFullPageMicrosoftOAuth(web), true);

  const electron = {
    location: { origin: 'https://surveytool.app', pathname: '/' },
    electronAPI: { microsoftSignIn: () => {} },
  };
  assert.equal(isMicrosoftConnectAvailable(electron), true);
  assert.equal(shouldStartFullPageMicrosoftOAuth(electron), false);

  const embeddedElectron = {
    location: { origin: 'http://localhost:5173', pathname: '/' },
    electronAPI: { openOAuthWindow: () => {} },
  };
  assert.equal(shouldStartFullPageMicrosoftOAuth(embeddedElectron), false);

  // Legacy Azure fallback (accountNativeE2EContracts): Capacitor origin still
  // maps to production, but Connect is refused so PKCE never starts there.
  assert.equal(
    microsoftRedirectUriFor({ origin: 'capacitor://localhost', protocol: 'capacitor:', pathname: '/mobile' }),
    'https://surveytool.app/mobile',
  );
});

test('MSGraphContext refuses Capacitor login before window.location.href and publishes the hide flag', () => {
  const loginStart = contextSource.indexOf('const login = useCallback');
  const hrefIndex = contextSource.indexOf('window.location.href = authUrl');
  assert.ok(loginStart > 0 && hrefIndex > loginStart);
  const loginBody = contextSource.slice(loginStart, hrefIndex);
  assert.match(loginBody, /isMicrosoftConnectAvailable\(\)/);
  assert.match(loginBody, /shouldStartFullPageMicrosoftOAuth\(\)/);
  assert.match(contextSource, /microsoftConnectAvailable/);
  assert.match(contextSource, /isMicrosoftConnectAvailable\(\)/);
});

test('AccountSettings Connect is hidden when microsoftConnectAvailable is false (P2-13 stopgap)', () => {
  // The auth layer owns the flag. Settings must consume it so Capacitor users
  // never see a dead-end Connect button. If this fails, the hide leaked.
  assert.match(accountSettingsSource, /microsoftConnectAvailable(?:: msConnectAvailable)? = true/);
  assert.match(accountSettingsSource, /microsoftConnectAvailable \? \(/);
  assert.match(accountSettingsSource, /Not available in the iOS\/Android app/);
});

// KAL-369: the desktop main window trusts only Survey's own Supabase project
// as a sign-in host, and only a real callback on the app's own address is
// handed to the app. See src/electron/mainWindowAuthPolicy.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = require('../src/electron/mainWindowAuthPolicy.cjs');
const {
  PRODUCTION_SUPABASE_ORIGIN,
  resolveTrustedSupabaseOrigin,
  isTrustedSignInHost,
  isTrustedSignInUrl,
  isAppCallbackTarget,
  readOAuthCallbackHash,
  matchMainWindowCallback,
} = policy;

const appPath = path.join(repo, 'fake-app');
const appFileUrl = pathToFileURL(path.join(appPath, 'dist', 'index.html')).href;
const session = 'access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=signup';

test('only Survey\'s own Supabase project is a trusted sign-in host', () => {
  assert.equal(isTrustedSignInHost('cvamwtpsuvxvjdnotbeg.supabase.co'), true);
  assert.equal(isTrustedSignInHost('attacker.supabase.co'), false);
  assert.equal(isTrustedSignInHost('supabase.co'), false);
  assert.equal(isTrustedSignInHost('cvamwtpsuvxvjdnotbeg.supabase.co.evil.com'), false);
  assert.equal(isTrustedSignInHost('accounts.google.com'), true);
  assert.equal(isTrustedSignInHost('accounts.google.com.evil.com'), false);
  assert.equal(isTrustedSignInHost('login.microsoftonline.com'), true);
  assert.equal(isTrustedSignInHost('contoso.microsoftonline.com'), true);
  assert.equal(isTrustedSignInHost('microsoftonline.com.evil.com'), false);
  assert.equal(isTrustedSignInHost(''), false);
});

test('sign-in pages must be https', () => {
  assert.equal(isTrustedSignInUrl('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(isTrustedSignInUrl('http://accounts.google.com/o/oauth2/v2/auth'), false);
  assert.equal(isTrustedSignInUrl('not a url'), false);
});

test('the trusted Supabase origin comes from the main process, never wider than one project', () => {
  assert.equal(resolveTrustedSupabaseOrigin({}), PRODUCTION_SUPABASE_ORIGIN);
  assert.equal(resolveTrustedSupabaseOrigin({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co/' }), 'https://abcdefgh.supabase.co');
  assert.equal(resolveTrustedSupabaseOrigin({ SURVEY_SUPABASE_URL: 'https://xyz.supabase.co', VITE_SUPABASE_URL: 'https://abc.supabase.co' }), 'https://xyz.supabase.co');
  for (const bad of ['http://abc.supabase.co', 'https://evil.com', 'https://abc.supabase.co.evil.com', 'https://u:p@abc.supabase.co', 'https://abc.supabase.co:8443', '*.supabase.co', '']) {
    assert.equal(resolveTrustedSupabaseOrigin({ VITE_SUPABASE_URL: bad }), PRODUCTION_SUPABASE_ORIGIN, bad);
  }
  const other = resolveTrustedSupabaseOrigin({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co' });
  assert.equal(isTrustedSignInHost('abcdefgh.supabase.co', { supabaseOrigin: other }), true);
  assert.equal(isTrustedSignInHost('cvamwtpsuvxvjdnotbeg.supabase.co', { supabaseOrigin: other }), false);
});

test('a callback may land only on the app\'s own address', () => {
  assert.equal(isAppCallbackTarget(`${appFileUrl}#${session}`, { appPath }), true);
  assert.equal(isAppCallbackTarget(pathToFileURL(path.join(repo, 'other', 'dist', 'index.html')).href, { appPath }), false);
  assert.equal(isAppCallbackTarget(appFileUrl, {}), false);
  assert.equal(isAppCallbackTarget('https://surveytool.app/#x=1', { appPath }), true);
  assert.equal(isAppCallbackTarget('https://www.surveytool.app/', { appPath }), true);
  assert.equal(isAppCallbackTarget('https://surveytool.app/somewhere', { appPath }), false);
  assert.equal(isAppCallbackTarget('https://surveytool.app.evil.com/', { appPath }), false);
  assert.equal(isAppCallbackTarget('https://accounts.google.com/', { appPath }), false);
  assert.equal(isAppCallbackTarget('http://localhost:5173/#a', { appPath }), false);
  assert.equal(isAppCallbackTarget('http://localhost:5173/#a', { appPath, development: true, devPort: '5173' }), true);
  assert.equal(isAppCallbackTarget('http://localhost:5174/#a', { appPath, development: true, devPort: '5173' }), false);
});

test('only real OAuth parameters count as a callback, and only known keys pass', () => {
  assert.equal(readOAuthCallbackHash('https://surveytool.app/#section=codes'), null);
  assert.equal(readOAuthCallbackHash('https://surveytool.app/#access_token=only'), null);
  assert.equal(readOAuthCallbackHash('https://surveytool.app/'), null);
  const hash = readOAuthCallbackHash(`https://surveytool.app/#${session}&extra=<script>`);
  const params = new URLSearchParams(hash.slice(1));
  assert.equal(params.get('access_token'), 'AAA');
  assert.equal(params.get('refresh_token'), 'RRR');
  assert.equal(params.get('extra'), null);
  assert.equal(new URLSearchParams(readOAuthCallbackHash('https://surveytool.app/#error=access_denied&error_description=No').slice(1)).get('error'), 'access_denied');
  assert.equal(new URLSearchParams(readOAuthCallbackHash('https://surveytool.app/#code=abc').slice(1)).get('code'), 'abc');
});

test('a callback is handed over only while the window is on a trusted sign-in page', () => {
  const base = { toUrl: `https://surveytool.app/#${session}`, appPath };
  assert.ok(matchMainWindowCallback({ ...base, fromUrl: 'https://accounts.google.com/signin/oauth' }));
  assert.ok(matchMainWindowCallback({ ...base, fromUrl: `${PRODUCTION_SUPABASE_ORIGIN}/auth/v1/callback` }));
  assert.ok(matchMainWindowCallback({ toUrl: `${appFileUrl}#${session}`, appPath, fromUrl: 'https://accounts.google.com/' }));
  // The app page itself, a stranger's Supabase project, or no page at all.
  assert.equal(matchMainWindowCallback({ ...base, fromUrl: appFileUrl }), null);
  assert.equal(matchMainWindowCallback({ ...base, fromUrl: 'https://attacker.supabase.co/' }), null);
  assert.equal(matchMainWindowCallback({ ...base, fromUrl: '' }), null);
  // Wrong landing address, or no session in it.
  assert.equal(matchMainWindowCallback({ appPath, fromUrl: 'https://accounts.google.com/', toUrl: `https://evil.com/#${session}` }), null);
  assert.equal(matchMainWindowCallback({ appPath, fromUrl: 'https://accounts.google.com/', toUrl: 'https://surveytool.app/#hello' }), null);
});

test('electron-main uses the policy for the main window and checks redirects too', () => {
  const main = fs.readFileSync(path.join(repo, 'src', 'electron-main.js'), 'utf8');
  assert.match(main, /require\('\.\/electron\/mainWindowAuthPolicy\.cjs'\)/);
  assert.match(main, /resolveTrustedSupabaseOrigin\(process\.env\)/);
  assert.match(main, /webContents\.on\('will-redirect'/);
  assert.match(main, /matchMainWindowCallback\(/);
  assert.doesNotMatch(main, /endsWith\('\.supabase\.co'\)/);
  assert.doesNotMatch(main, /hash\.includes\('access_token'\)/);
});

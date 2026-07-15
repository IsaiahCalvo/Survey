import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  completeSupabaseOAuthCallback,
  signInWithGoogleOAuth,
} from '../src/contexts/supabaseOAuth.js';

const authContextSource = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');

test('Electron Supabase OAuth completes an implicit token callback in the app renderer', async () => {
  const calls = [];
  const auth = {
    async setSession(session) {
      calls.push(session);
      return { data: { session: { user: { id: 'user-1' } } }, error: null };
    },
  };

  const data = await completeSupabaseOAuthCallback(
    auth,
    'file:///Applications/Survey/dist/index.html#access_token=access-1&refresh_token=refresh-1&expires_in=3600',
    'file:///Applications/Survey/dist/index.html',
  );

  assert.deepEqual(calls, [{ access_token: 'access-1', refresh_token: 'refresh-1' }]);
  assert.equal(data.session.user.id, 'user-1');
});

test('Electron Supabase OAuth exchanges a PKCE code callback in the app renderer', async () => {
  const calls = [];
  const auth = {
    async exchangeCodeForSession(code) {
      calls.push(code);
      return { data: { session: { user: { id: 'user-2' } } }, error: null };
    },
  };

  const data = await completeSupabaseOAuthCallback(
    auth,
    'http://localhost:5173/?code=code-1',
    'http://localhost:5173/',
  );

  assert.deepEqual(calls, ['code-1']);
  assert.equal(data.session.user.id, 'user-2');
});

test('Electron Supabase OAuth rejects mismatched redirects and provider errors', async () => {
  const auth = {
    setSession: async () => { throw new Error('must not be called'); },
    exchangeCodeForSession: async () => { throw new Error('must not be called'); },
  };

  await assert.rejects(
    completeSupabaseOAuthCallback(
      auth,
      'http://localhost.attacker.test:5173/#access_token=a&refresh_token=r',
      'http://localhost:5173/',
    ),
    /did not match/,
  );
  await assert.rejects(
    completeSupabaseOAuthCallback(
      auth,
      'http://localhost:5173/#error=access_denied&error_description=Google%20sign-in%20was%20cancelled',
      'http://localhost:5173/',
    ),
    /Google sign-in was cancelled/,
  );
});

test('Google OAuth in Electron stays in the sandbox window and returns a session to the app', async () => {
  const calls = [];
  const auth = {
    async signInWithOAuth(options) {
      calls.push(['signIn', options]);
      return { data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' }, error: null };
    },
    async setSession(session) {
      calls.push(['setSession', session]);
      return { data: { session: { user: { id: 'google-user' } } }, error: null };
    },
  };
  const openOAuthWindow = async (authUrl, redirectUri) => {
    calls.push(['openWindow', authUrl, redirectUri]);
    return {
      success: true,
      url: `${redirectUri}#access_token=access-google&refresh_token=refresh-google`,
    };
  };

  const data = await signInWithGoogleOAuth({
    auth,
    currentUrl: 'file:///Applications/Survey/dist/index.html#old',
    openOAuthWindow,
  });

  assert.equal(calls[0][1].options.skipBrowserRedirect, true);
  assert.equal(calls[0][1].options.redirectTo, 'file:///Applications/Survey/dist/index.html');
  assert.equal(calls[1][0], 'openWindow');
  assert.deepEqual(calls[2], ['setSession', { access_token: 'access-google', refresh_token: 'refresh-google' }]);
  assert.equal(data.session.user.id, 'google-user');
});

test('AuthContext delegates Google sign-in to the isolated Electron OAuth flow', () => {
  assert.match(authContextSource, /import \{ signInWithGoogleOAuth \} from '\.\/supabaseOAuth'/);
  assert.match(
    authContextSource,
    /signInWithGoogleOAuth\(\{[\s\S]{0,250}auth: supabase\.auth,[\s\S]{0,250}openOAuthWindow:/,
  );
  assert.doesNotMatch(authContextSource, /skipBrowserRedirect:\s*false/);
});

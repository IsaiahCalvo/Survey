import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isAuthRefreshTokenError } from '../src/supabaseClient.js';

const AUTH_CONTEXT_SOURCE = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
const SUPABASE_CLIENT_SOURCE = readFileSync(new URL('../src/supabaseClient.js', import.meta.url), 'utf8');
const DASHBOARD_SOURCE = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
const YDOC_PROVIDER_SOURCE = readFileSync(new URL('../src/components/collab/YDocProvider.jsx', import.meta.url), 'utf8');

test('detects Supabase invalid refresh token errors', () => {
  assert.equal(isAuthRefreshTokenError(new Error('Invalid Refresh Token: Refresh Token Not Found')), true);
  assert.equal(isAuthRefreshTokenError({ message: 'refresh_token_not_found' }), true);
  assert.equal(isAuthRefreshTokenError(new Error('network failed')), false);
});

test('Supabase client has explicit browser auth persistence and recovery helpers', () => {
  assert.match(SUPABASE_CLIENT_SOURCE, /autoRefreshToken: true/);
  assert.match(SUPABASE_CLIENT_SOURCE, /persistSession: true/);
  assert.match(SUPABASE_CLIENT_SOURCE, /detectSessionInUrl: true/);
  assert.match(SUPABASE_CLIENT_SOURCE, /clearSupabaseAuthStorage/);
  assert.match(SUPABASE_CLIENT_SOURCE, /recoverSupabaseAuthSession/);
  assert.match(SUPABASE_CLIENT_SOURCE, /getSupabaseSession/);
});

test('AuthProvider recovers corrupted refresh-token state before dev auto-login', () => {
  // 2026-10-07: the start-up read moved to readStartupSession (same recovery,
  // plus an `offline` answer so a saved sign-in that only lacks the network is
  // not treated as signed out).
  assert.match(AUTH_CONTEXT_SOURCE, /readStartupSession\('AuthProvider\.getSession'\)/);
  assert.match(SUPABASE_CLIENT_SOURCE, /export async function readStartupSession[\s\S]*?recoverSupabaseAuthSession\(err, context\)/);
  assert.match(AUTH_CONTEXT_SOURCE, /recoverSupabaseAuthSession\(error, 'AuthProvider\.getSession'\)/);
  assert.match(AUTH_CONTEXT_SOURCE, /finishAuthBoot\(null\)/);
  assert.match(AUTH_CONTEXT_SOURCE, /runDevAutoLoginIfNeeded/);
});

test('direct session readers use the recoverable session helper', () => {
  // kal49Harness lives in Dashboard.jsx since the Dashboard was extracted from App.jsx.
  assert.match(DASHBOARD_SOURCE, /getSupabaseSession\('kal49Harness'\)/);
  assert.match(YDOC_PROVIDER_SOURCE, /getSupabaseSession\('YDocProvider\.undoManager'\)/);
  assert.match(YDOC_PROVIDER_SOURCE, /getSupabaseSession\('YDocProvider\.cleanupAudit'\)/);
});

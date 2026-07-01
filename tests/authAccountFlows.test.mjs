/* Account-flow gap closures (2026-07-01): password-reset completion page,
 * resend-confirmation-email flow, and change-password current-password verify.
 *
 * Pure-logic tests import src/components/authFlow.js directly (no React, no
 * network). The wiring tests follow the source-assertion pattern from
 * supabaseAuthRecovery.test.mjs: read the JSX as text and guard the contract.
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESEND_COOLDOWN_MS,
  resendCooldownRemainingMs,
  resolveRecoveryPhase,
  validateNewPassword,
} from '../src/components/authFlow.js';

const MAIN_SOURCE = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const AUTH_CONTEXT_SOURCE = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
const AUTH_MODAL_SOURCE = readFileSync(new URL('../src/components/AuthModal.jsx', import.meta.url), 'utf8');
const ACCOUNT_SETTINGS_SOURCE = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
const RESET_PAGE_SOURCE = readFileSync(new URL('../src/components/ResetPasswordPage.jsx', import.meta.url), 'utf8');

// --- resend cooldown (pure) -------------------------------------------------

test('resend cooldown is idle before any send and counts down after one', () => {
  assert.equal(resendCooldownRemainingMs(0, 1_000_000), 0);
  assert.equal(resendCooldownRemainingMs(null, 1_000_000), 0);

  const sentAt = 1_000_000;
  assert.equal(resendCooldownRemainingMs(sentAt, sentAt), RESEND_COOLDOWN_MS);
  assert.equal(resendCooldownRemainingMs(sentAt, sentAt + 10_000), RESEND_COOLDOWN_MS - 10_000);
  assert.equal(resendCooldownRemainingMs(sentAt, sentAt + RESEND_COOLDOWN_MS), 0);
  // Never negative, even long after expiry.
  assert.equal(resendCooldownRemainingMs(sentAt, sentAt + RESEND_COOLDOWN_MS * 5), 0);
});

test('resend cooldown honors a custom duration', () => {
  assert.equal(resendCooldownRemainingMs(100, 100, 5_000), 5_000);
  assert.equal(resendCooldownRemainingMs(100, 4_000, 5_000), 1_100);
});

// --- reset-password phase machine (pure) ------------------------------------

test('recovery phase: a session always means ready', () => {
  assert.equal(resolveRecoveryPhase({ hasSession: true, bootFinished: false, graceElapsed: false }), 'ready');
  assert.equal(resolveRecoveryPhase({ hasSession: true, bootFinished: true, graceElapsed: true }), 'ready');
});

test('recovery phase: keeps checking until boot AND grace both finish', () => {
  assert.equal(resolveRecoveryPhase({ hasSession: false, bootFinished: false, graceElapsed: false }), 'checking');
  assert.equal(resolveRecoveryPhase({ hasSession: false, bootFinished: true, graceElapsed: false }), 'checking');
  assert.equal(resolveRecoveryPhase({ hasSession: false, bootFinished: false, graceElapsed: true }), 'checking');
});

test('recovery phase: no session after boot + grace means the link is invalid', () => {
  assert.equal(resolveRecoveryPhase({ hasSession: false, bootFinished: true, graceElapsed: true }), 'invalid');
});

test('new-password validation mirrors the AccountSettings rules', () => {
  assert.equal(validateNewPassword('', ''), 'Please enter a new password');
  assert.equal(validateNewPassword('12345', '12345'), 'Password must be at least 6 characters');
  assert.equal(validateNewPassword('123456', '654321'), 'Passwords do not match');
  assert.equal(validateNewPassword('123456', '123456'), null);
});

// --- wiring: /reset-password route + page -----------------------------------

test('main.jsx mounts ResetPasswordPage standalone inside ErrorBoundary+AuthProvider', () => {
  assert.match(MAIN_SOURCE, /\/\^\\\/reset-password/); // pathname regex route guard
  assert.match(MAIN_SOURCE, /import\('\.\/components\/ResetPasswordPage'\)/);
  const mountBlock = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('isResetPasswordRoute'));
  assert.match(mountBlock, /<ErrorBoundary>\s*<AuthProvider>\s*<ResetPasswordPage \/>/);
});

test('ResetPasswordPage talks to supabase.auth only through AuthContext', () => {
  assert.match(RESET_PAGE_SOURCE, /from '\.\.\/contexts\/AuthContext'/);
  assert.match(RESET_PAGE_SOURCE, /updatePassword\(password\)/);
  assert.match(RESET_PAGE_SOURCE, /resetPassword\(resendEmail\)/);
  assert.doesNotMatch(RESET_PAGE_SOURCE, /supabaseClient/);
  assert.doesNotMatch(RESET_PAGE_SOURCE, /supabase\.auth\./);
});

test('ResetPasswordPage renders the success and expired-link affordances', () => {
  assert.match(RESET_PAGE_SOURCE, /Back to Survey/);
  assert.match(RESET_PAGE_SOURCE, /Request a new link/);
  assert.match(RESET_PAGE_SOURCE, /resolveRecoveryPhase/);
});

// --- wiring: resend confirmation email ---------------------------------------

test('AuthContext exposes resendConfirmation using supabase.auth.resend', () => {
  assert.match(AUTH_CONTEXT_SOURCE, /supabase\.auth\.resend\(\{\s*type: 'signup',\s*email,\s*\}\)/);
  assert.match(AUTH_CONTEXT_SOURCE, /resendConfirmation,/);
});

test('AuthModal signup lands on a persistent confirm panel, not a timed close', () => {
  assert.doesNotMatch(AUTH_MODAL_SOURCE, /Account created! Please check your email/);
  assert.match(AUTH_MODAL_SOURCE, /setMode\('confirm'\)/);
  assert.match(AUTH_MODAL_SOURCE, /resendConfirmation\(email\)/);
  assert.match(AUTH_MODAL_SOURCE, /Resend confirmation email/);
  assert.match(AUTH_MODAL_SOURCE, /Use a different email/);
  // Cooldown gates the resend button via the shared pure helper.
  assert.match(AUTH_MODAL_SOURCE, /resendCooldownRemainingMs/);
  assert.match(AUTH_MODAL_SOURCE, /disabled=\{loading \|\| resendRemaining > 0\}/);
  // Signed-in-immediately signups (email confirmation disabled) still close.
  assert.match(AUTH_MODAL_SOURCE, /if \(data\?\.session\)/);
});

// --- wiring: change-password verifies the current password -------------------

test('AccountSettings verifies the current password server-side before updating', () => {
  assert.match(ACCOUNT_SETTINGS_SOURCE, /await signIn\(user\.email, currentPassword\)/);
  assert.match(ACCOUNT_SETTINGS_SOURCE, /Current password is incorrect/);
  const verifyIndex = ACCOUNT_SETTINGS_SOURCE.indexOf('signIn(user.email, currentPassword)');
  const updateIndex = ACCOUNT_SETTINGS_SOURCE.indexOf('updatePassword(newPassword)');
  assert.ok(verifyIndex > -1 && updateIndex > -1 && verifyIndex < updateIndex,
    'current-password verification must run before updatePassword');
});

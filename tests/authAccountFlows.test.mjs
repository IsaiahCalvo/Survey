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
  passwordRequirements,
  passwordMeetsRequirements,
  PASSWORD_MIN_LENGTH,
} from '../src/components/authFlow.js';
import {
  DEFAULT_TURNSTILE_SITE_KEY,
  isTurnstileEnabled,
  resolveTurnstileSiteKey,
} from '../src/components/turnstileConfig.js';

const MAIN_SOURCE = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const VITE_CONFIG_SOURCE = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
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

test('new-password validation enforces the full requirement set', () => {
  const strong = 'Str0ng!Passw0rd';
  assert.equal(validateNewPassword('', ''), 'Please enter a new password');
  // Too short / missing classes → "does not meet requirements" (not the raw server message)
  assert.equal(validateNewPassword('12345', '12345'), 'Password does not meet requirements');
  assert.equal(validateNewPassword('short1!A', 'short1!A'), 'Password does not meet requirements');
  // Strong password but mismatched confirm.
  assert.equal(validateNewPassword(strong, 'different'), 'Passwords do not match');
  // Strong + matching passes.
  assert.equal(validateNewPassword(strong, strong), null);
});

test('password requirements checklist reflects each rule', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  const met = (pw, opts) => Object.fromEntries(passwordRequirements(pw, opts).map((r) => [r.id, r.met]));
  const weak = met('abc');
  assert.equal(weak.length, false);
  assert.equal(weak.upper, false);
  assert.equal(weak.special, false);
  const good = met('Str0ng!Passw0rd');
  assert.equal(good.length, true);
  assert.equal(good.upper, true);
  assert.equal(good.lower, true);
  assert.equal(good.number, true);
  assert.equal(good.special, true);
  assert.equal(good.nospace, true);
  // Spaces and personal info are rejected.
  assert.equal(met('Str0ng! Passw0rd').nospace, false);
  assert.equal(met('Isaiah!2026aaaa', { firstName: 'Isaiah' }).nopersonal, false);
  assert.equal(met('Str0ng!Passw0rd', { firstName: 'Isaiah' }).nopersonal, true);
  assert.equal(passwordMeetsRequirements('Str0ng!Passw0rd'), true);
  assert.equal(passwordMeetsRequirements('weak'), false);
});

test('Turnstile can be disabled locally with an explicit empty env value', () => {
  assert.equal(resolveTurnstileSiteKey({}), DEFAULT_TURNSTILE_SITE_KEY);
  assert.equal(resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: '' }), '');
  assert.equal(resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: '   ' }), '');
  assert.equal(isTurnstileEnabled(''), false);
  assert.equal(isTurnstileEnabled(DEFAULT_TURNSTILE_SITE_KEY), true);
});

test('dev auth bootstrap endpoint mints only a token hash through server-side Supabase admin', () => {
  assert.match(VITE_CONFIG_SOURCE, /\/__dev-auth\/session/);
  assert.match(VITE_CONFIG_SOURCE, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(VITE_CONFIG_SOURCE, /admin\.auth\.admin\.generateLink\(\{\s*type: 'magiclink'/);
  assert.match(VITE_CONFIG_SOURCE, /data\?\.properties\?\.hashed_token/);
  assert.match(VITE_CONFIG_SOURCE, /sendJson\(res, 200, \{ token_hash: tokenHash, type: 'magiclink' \}\)/);
});

test('dev auto-login falls back to magic-link bootstrap after captcha failure', () => {
  assert.match(AUTH_CONTEXT_SOURCE, /runDevAuthBootstrapIfCaptchaBlocked\(error, devEmail\)/);
  assert.match(AUTH_CONTEXT_SOURCE, /X-Dev-Auth-Bootstrap/);
  assert.match(AUTH_CONTEXT_SOURCE, /supabase\.auth\.verifyOtp\(\{\s*token_hash: payload\.token_hash,\s*type: payload\.type \|\| 'magiclink'/);
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
  // resetPassword now forwards a Turnstile token as its second arg.
  assert.match(RESET_PAGE_SOURCE, /resetPassword\(resendEmail, captchaToken\)/);
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
  // signIn now forwards a Turnstile token as its third arg (re-auth is captcha-gated).
  assert.match(ACCOUNT_SETTINGS_SOURCE, /await signIn\(user\.email, currentPassword, captchaToken\)/);
  assert.match(ACCOUNT_SETTINGS_SOURCE, /Current password is incorrect/);
  const verifyIndex = ACCOUNT_SETTINGS_SOURCE.indexOf('signIn(user.email, currentPassword');
  const updateIndex = ACCOUNT_SETTINGS_SOURCE.indexOf('updatePassword(newPassword)');
  assert.ok(verifyIndex > -1 && updateIndex > -1 && verifyIndex < updateIndex,
    'current-password verification must run before updatePassword');
});

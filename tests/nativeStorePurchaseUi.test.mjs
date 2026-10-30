import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getNativeAppPlatform, isGoogleSignInHidden, isPurchaseUiHidden } from '../src/utils/accountPlatform.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const cap = (native, platform) => ({ Capacitor: { isNativePlatform: () => native, getPlatform: () => platform } });

test('purchase UI is hidden only inside the native iOS/Android apps', () => {
  assert.equal(getNativeAppPlatform(cap(true, 'ios')), 'ios');
  assert.equal(getNativeAppPlatform(cap(true, 'android')), 'android');
  assert.equal(isPurchaseUiHidden(cap(true, 'ios')), true);
  assert.equal(isPurchaseUiHidden(cap(true, 'android')), true);
  assert.equal(isPurchaseUiHidden(cap(false, 'web')), false);
  assert.equal(isPurchaseUiHidden({}), false);
  assert.equal(isPurchaseUiHidden({ electronAPI: {} }), false);
  assert.equal(isPurchaseUiHidden(null), false);
});

test('every checkout / billing-portal / upgrade entry point is gated', () => {
  assert.match(read('src/components/StripeCheckout.jsx'), /if \(isPurchaseUiHidden\(\)\) return null;/);
  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /!isPurchaseUiHidden\(\) && subscription && subscription\.tier !== 'free' && subscription\.stripe_customer_id/);
  assert.match(settings, /!isPurchaseUiHidden\(\) && subscription\?\.tier === 'free'/);
  assert.match(settings, /isPurchaseUiHidden\(\) \? \(\s*<div className="account-subscription-card" data-testid="native-plan-status"/);
  assert.match(read('src/components/UsageIndicator.jsx'), /!isPurchaseUiHidden\(\) && tier === 'free'/);
  const invokers = ['create-checkout-session', 'create-portal-session'];
  for (const name of invokers) {
    const hits = [read('src/components/StripeCheckout.jsx'), settings].join('\n').split(name).length - 1;
    assert.ok(hits >= 1, `${name} entry point moved — re-check native gating`);
  }
});

test('Google sign-in is hidden in both store apps (App Store 4.8; no OAuth return path on Android yet)', () => {
  assert.equal(isGoogleSignInHidden(cap(true, 'ios')), true);
  assert.equal(isGoogleSignInHidden(cap(true, 'android')), true);
  assert.equal(isGoogleSignInHidden(cap(false, 'web')), false);
  assert.equal(isGoogleSignInHidden({}), false);
  assert.match(read('src/components/AuthModal.jsx'), /\{!isGoogleSignInHidden\(\) && \(\s*<button\s+type="button"\s+className="auth-google-btn"/);
  assert.match(read('src/components/AccountSettings.jsx'), /\(!isGoogleSignInHidden\(\) \|\| user\?\.app_metadata\?\.provider === 'google'/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SUBSCRIPTION_LOAD_FAILED_TEXT } from '../src/utils/accountPlatform.js';

// Polish round 6: with no backend reachable, Settings > Subscription printed
// the raw JS error ("Cannot read properties of null (reading 'from')"). It now
// shows one plain line plus Retry; the technical reason goes to the console.
const jsx = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');

test('the failure line is plain words, no technical detail', () => {
  assert.match(SUBSCRIPTION_LOAD_FAILED_TEXT, /^Your plan couldn't be loaded right now\./);
  assert.doesNotMatch(SUBSCRIPTION_LOAD_FAILED_TEXT, /error|null|undefined|properties|supabase/i);
});

test('Settings shows the plain line, never err.message, on a failed load', () => {
  const at = jsx.indexOf('const fetchSubscription = async');
  const body = jsx.slice(at, jsx.indexOf('\n  };', at));
  assert.match(body, /setSubscriptionError\(SUBSCRIPTION_LOAD_FAILED_TEXT\)/);
  assert.doesNotMatch(body, /setSubscriptionError\([^)]*message/);
  // The request itself is unchanged.
  assert.match(body, /\.from\('user_subscriptions'\)\s*\.select\('\*'\)\s*\.eq\('user_id', user\.id\)\s*\.maybeSingle\(\)/);
});

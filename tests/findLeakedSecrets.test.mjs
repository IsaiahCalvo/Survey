import test from 'node:test';
import assert from 'node:assert/strict';
import { findLeakedSecrets } from '../scripts/lib/findLeakedSecrets.mjs';

const jwt = (payload) => [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'c2lnbmF0dXJlLXNpZ25hdHVyZQ',
].join('.');

test('the public anon key is allowed', () => {
  assert.deepEqual(findLeakedSecrets(`const key = "${jwt({ role: 'anon', ref: 'x' })}";`), []);
});

test('a service_role key is caught', () => {
  const found = findLeakedSecrets(`k="${jwt({ role: 'service_role', ref: 'x' })}"`);
  assert.equal(found.length, 1);
  assert.match(found[0].kind, /service_role/);
});

test('Stripe, webhook, Brevo and Groq secrets are caught', () => {
  const text = [
    'sk_live_' + 'a'.repeat(24),
    'whsec_' + 'b'.repeat(32),
    'xkeysib-' + 'c'.repeat(64),
    'gsk_' + 'D'.repeat(52),
  ].join(' ');
  assert.deepEqual(findLeakedSecrets(text).map((f) => f.kind), [
    'Stripe secret or restricted key', 'Stripe webhook secret', 'Brevo API key', 'Groq API key',
  ]);
});

test('redaction regexes in app code are not flagged', () => {
  assert.deepEqual(findLeakedSecrets('[/\\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/g,`[REDACTED_KEY]`]'), []);
});

test('a new-style Supabase secret key is caught, the publishable key is not', () => {
  assert.deepEqual(findLeakedSecrets('k="sb_publishable_' + 'p'.repeat(30) + '"'), []);
  const found = findLeakedSecrets('k="sb_secret_' + 's'.repeat(30) + '"');
  assert.deepEqual(found.map((f) => f.kind), ['Supabase secret key']);
});

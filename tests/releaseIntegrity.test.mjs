import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertFunctionsInSync,
  assertMigrationsInSync,
  assertRequiredSecrets,
  assertStaticReleaseContract,
  parseFunctionJwtConfig,
} from '../scripts/release-integrity.mjs';

test('release contract keeps backend deployment ahead of Vercel', () => {
  assert.doesNotThrow(() => assertStaticReleaseContract(process.cwd()));
});

test('migration gate rejects local-only and remote-only versions', () => {
  assert.doesNotThrow(() => assertMigrationsInSync({
    migrations: [{ local: '20260727131230', remote: '20260727131230' }],
  }));
  assert.throws(() => assertMigrationsInSync({
    migrations: [
      { local: '20260727131230', remote: '' },
      { local: '', remote: '20260727140000' },
    ],
  }), /migration drift/i);
});

test('function gate rejects missing, inactive, or auth-drifted functions', () => {
  const expected = new Map([['stripe-webhook', false]]);
  assert.doesNotThrow(() => assertFunctionsInSync({
    functions: [{ slug: 'stripe-webhook', status: 'ACTIVE', verify_jwt: false }],
  }, ['stripe-webhook'], expected));
  assert.throws(() => assertFunctionsInSync({ functions: [] }, ['stripe-webhook'], expected), /not deployed/);
  assert.throws(() => assertFunctionsInSync({
    functions: [{ slug: 'stripe-webhook', status: 'ACTIVE', verify_jwt: true }],
  }, ['stripe-webhook'], expected), /verify_jwt drift/);
});

test('function JWT config defaults secure and preserves explicit exceptions', () => {
  const parsed = parseFunctionJwtConfig(`
    [functions.stripe-webhook]
    verify_jwt = false
  `, ['ordinary-function', 'stripe-webhook']);
  assert.equal(parsed.get('ordinary-function'), true);
  assert.equal(parsed.get('stripe-webhook'), false);
});

test('Stripe configuration gate checks every required secret by name', () => {
  const names = [
    'STRIPE_PRO_ANNUAL_PRICE_ID',
    'STRIPE_PRO_MONTHLY_PRICE_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];
  assert.doesNotThrow(() => assertRequiredSecrets({
    secrets: names.map((name) => ({ name })),
  }));
  assert.throws(() => assertRequiredSecrets({ secrets: [] }), /Missing Supabase Stripe secrets/);
});

test('Enterprise price secret is deliberately NOT required (KAL-414 contact-us tier)', () => {
  // 2026-08-19: STRIPE_ENTERPRISE_PRICE_ID was removed from production so a
  // hand-crafted tier:'enterprise' checkout fails loudly. A deploy without it
  // must pass; re-adding it to REQUIRED_STRIPE_SECRETS before an Enterprise
  // price actually exists would block every deploy against the live config.
  const withoutEnterprise = [
    'STRIPE_PRO_ANNUAL_PRICE_ID',
    'STRIPE_PRO_MONTHLY_PRICE_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];
  assert.doesNotThrow(() => assertRequiredSecrets({
    secrets: withoutEnterprise.map((name) => ({ name })),
  }));
});

test('Node test gate isolates files and bounds hangs', () => {
  const runner = readFileSync('scripts/run-node-tests.mjs', 'utf8');
  assert.match(runner, /spawn\(process\.execPath, \['--experimental-strip-types', '--test', file\]/);
  assert.match(runner, /timeoutMs = 120_000/);
  assert.match(runner, /exceeded its \$\{timeoutMs\}ms file timeout/);
});

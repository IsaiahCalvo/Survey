import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertEveryFunctionDeployed,
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
  // 2026-10-13 (KAL-446): the per-file bound moved into
  // scripts/test-file-guard.mjs and is now judged on the file's own CPU time
  // and progress, not raw wall-clock time; its behaviour is tested in
  // tests/testFileGuard.test.mjs. This keeps the wiring honest.
  const runner = readFileSync('scripts/run-node-tests.mjs', 'utf8');
  const guard = readFileSync('scripts/test-file-guard.mjs', 'utf8');
  assert.match(runner, /import \{ runGuardedTestFile \} from '\.\/test-file-guard\.mjs'/);
  assert.match(runner, /await runGuardedTestFile\(file(?:, \{ nodeArgs \})?\)/);
  assert.match(guard, /spawn\(process\.execPath, \[(?:\.\.\.nodeArgs, )?'--test', file\]/);
  assert.match(guard, /WALL_GRACE_MS = 120_000/);
  assert.match(guard, /CPU_BUDGET_MS = 120_000/);
  assert.match(guard, /HARD_CAP_MS = 3_600_000/);
});

test('deploy list gate catches a function folder missing from the production deploy', () => {
  const workflow = [
    '        run: supabase functions deploy --project-ref "$REF" --use-api send-email',
    '        run: >-',
    '          supabase functions deploy --project-ref "$REF" --use-api --jobs 4',
    '          agent-auth',
    '          stripe-webhook',
  ].join('\n');
  assert.doesNotThrow(() => assertEveryFunctionDeployed(workflow, ['agent-auth', 'send-email', 'stripe-webhook']));
  assert.throws(
    () => assertEveryFunctionDeployed(workflow, ['agent-auth', 'sheet-sync', 'send']),
    /missing from deploy-production\.yml: sheet-sync, send/,
  );
});

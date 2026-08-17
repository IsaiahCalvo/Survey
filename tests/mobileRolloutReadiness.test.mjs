import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  REQUIRED_MIGRATIONS,
  assertDeleteAccountFunction,
  assertElectronPackagingContract,
  assertExpoStaticContract,
  assertExpoUpdateFreshness,
  assertLocalMobileRollout,
  assertRequiredRemoteMigrations,
  assertReleaseTreeStatus,
  assertVercelProductionEnvironment,
  computeExpoSourceHash,
} from '../scripts/verify-mobile-rollout-readiness.mjs';

test('local mobile rollout contract pins all five migrations and fail-closed deletion', () => {
  assert.equal(REQUIRED_MIGRATIONS.length, 5);
  assert.deepEqual(REQUIRED_MIGRATIONS.slice(0, 2), [
    '20260802010000_allow_last_owner_document_cascade.sql',
    '20260810010000_integration_test_bytea_roundtrip.sql',
  ]);
  assert.doesNotThrow(() => assertLocalMobileRollout(process.cwd()));
});

test('Electron package and Expo Updates contracts are release-gated', () => {
  assert.doesNotThrow(() => assertElectronPackagingContract(process.cwd()));
  assert.doesNotThrow(() => assertExpoStaticContract(process.cwd()));
  assert.match(computeExpoSourceHash(process.cwd()), /^[0-9a-f]{64}$/);
});

test('release evidence rejects an uncommitted source tree', () => {
  assert.doesNotThrow(() => assertReleaseTreeStatus(''));
  assert.throws(() => assertReleaseTreeStatus(' M src/App.jsx'), /not clean/);
  assert.throws(() => assertReleaseTreeStatus('?? src/new-helper.js'), /not clean/);
});

test('Expo update metadata requires the exact shell hash and pinned runtime', () => {
  const hash = 'a'.repeat(64);
  const update = {
    name: 'expo-go',
    currentPage: [{
      message: `release:abc shell:${hash}`,
      runtimeVersion: 'exposdk:54.0.0',
      platforms: 'ios',
      group: 'a42f8432-65f4-4b3a-872b-2bc6a6f11fc5',
    }],
  };
  assert.doesNotThrow(() => assertExpoUpdateFreshness(update, hash, 'exposdk:54.0.0'));
  update.currentPage[0].message = `"shell:${hash} release:abc" (30 seconds ago by isaiahcalvo)`;
  assert.doesNotThrow(() => assertExpoUpdateFreshness(update, hash, 'exposdk:54.0.0'));
  assert.throws(() => assertExpoUpdateFreshness(update, 'b'.repeat(64), 'exposdk:54.0.0'), /stale or absent/);
  assert.throws(() => assertExpoUpdateFreshness(update, hash, 'exposdk:55.0.0'), /runtime/);
});

test('remote migration gate requires every exact local/remote version pair', () => {
  const migrations = REQUIRED_MIGRATIONS.map((name) => ({ local: name.slice(0, 14), remote: name.slice(0, 14) }));
  assert.doesNotThrow(() => assertRequiredRemoteMigrations({ migrations }));
  assert.throws(() => assertRequiredRemoteMigrations({ migrations: migrations.slice(1) }), /not applied remotely/);
});

test('delete-account gate requires an active deployed function', () => {
  assert.doesNotThrow(() => assertDeleteAccountFunction({ functions: [{ slug: 'delete-account', status: 'ACTIVE' }] }));
  assert.throws(() => assertDeleteAccountFunction({ functions: [] }), /not deployed/);
  assert.throws(() => assertDeleteAccountFunction({ functions: [{ slug: 'delete-account', status: 'FAILED' }] }), /not active/);
});

test('Vercel gate requires server-only analytics prerequisites in production', () => {
  const envs = [
    'AGENT_NATIVE_ANALYTICS_PUBLIC_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].map((key) => ({ key, target: ['production'] }));
  assert.doesNotThrow(() => assertVercelProductionEnvironment({ envs }));
  assert.throws(() => assertVercelProductionEnvironment({ envs: envs.slice(1) }), /AGENT_NATIVE_ANALYTICS_PUBLIC_KEY/);
  assert.throws(() => assertVercelProductionEnvironment({ envs: envs.map((entry) => ({ ...entry, target: ['preview'] })) }), /not available.*production/);
});

test('mobile diagnostics documentation exposes only the authenticated Survey proxy', () => {
  const mobileRun = readFileSync('docs/MOBILE-RUN.md', 'utf8');
  assert.match(mobileRun, /surveytool\.app\/api\/analytics\/track/);
  assert.match(mobileRun, /Guest and signed-out\s+activity is not sent/);
  assert.match(mobileRun, /500 events\/user\/day and 10,000/);
  assert.match(mobileRun, /BLOCK CODE DEPLOYMENT/);
  for (const migration of REQUIRED_MIGRATIONS) assert.match(mobileRun, new RegExp(migration.replace('.', '\\.')));
  assert.match(mobileRun, /shell:\$\{EXPO_SHELL_HASH\}/);
  assert.match(mobileRun, /read-only.*update:list/is);
  assert.match(mobileRun, /dist\/release\.json/);
  assert.match(mobileRun, /clean (?:Git )?worktree/i);
  assert.doesNotMatch(mobileRun, /VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY|EXPO_PUBLIC_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY/);
  assert.doesNotMatch(mobileRun, /survey-analytics-796\.netlify/);

  const e2e = readFileSync('docs/FULL-APP-E2E.md', 'utf8');
  assert.match(e2e, /npm run test:mobile-secondary/);
  assert.match(e2e, /not\s+Supabase durability, native iOS\/Android gesture delivery/);
});

test('send-email source returns a generic 503 before using a missing Brevo key', () => {
  const source = readFileSync('supabase/functions/send-email/index.ts', 'utf8');
  const guard = source.indexOf('if (!BREVO_API_KEY)');
  const header = source.indexOf("'api-key': BREVO_API_KEY");
  assert.ok(guard >= 0 && header > guard);
  assert.match(source.slice(guard, header), /status:\s*503/);
  assert.doesNotMatch(source.slice(guard, header), /JSON\.stringify\([^)]*BREVO_API_KEY/);
});

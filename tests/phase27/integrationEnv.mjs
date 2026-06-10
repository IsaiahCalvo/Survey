// tests/phase27/integrationEnv.mjs
// Shared guard for the phase27 Supabase integration tests (KAL-257).
//
// These tests INSERT real rows, so they must never run against production and
// must never leak into the unit suite (`npm test`). Three independent locks:
//   1. SUPABASE_INTEGRATION=1 must be set explicitly. `npm run test:integration`
//      sets it; plain `npm test` never does — so a stray SUPABASE_TEST_URL in
//      the shell cannot change the 1326-test unit baseline.
//   2. SUPABASE_TEST_URL's host must be in the hardcoded allowlist below —
//      dedicated test projects only. The production project
//      (cvamwtpsuvxvjdnotbeg.supabase.co) is structurally excluded.
//   3. SUPABASE_TEST_SERVICE_KEY must be present (the phase27 tables carry
//      deny-all RLS stubs from the 20260428 migration; the anon key can only
//      produce confusing failures, so there is deliberately NO anon fallback).
//
// integrationSkipReason() returns a skip-reason string when any lock
// disagrees, else false (run). Missing env therefore SKIPS, never fails —
// the §2.5 guardrail from PRE-REBUILD-READINESS.md.

const ALLOWED_TEST_HOSTS = [
  'zgdkyslxbkusexmkfvgd.supabase.co', // survey-test (created 2026-06-10 for KAL-257)
];

export function integrationSkipReason() {
  if (process.env.SUPABASE_INTEGRATION !== '1') {
    return 'SUPABASE_INTEGRATION=1 not set — integration tests only run via `npm run test:integration`';
  }
  const url = process.env.SUPABASE_TEST_URL;
  if (!url) {
    return 'SUPABASE_TEST_URL not set — see .env.test.example';
  }
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return `SUPABASE_TEST_URL is not a valid URL — refusing`;
  }
  if (!ALLOWED_TEST_HOSTS.includes(host)) {
    return `SUPABASE_TEST_URL host "${host}" is not an allowlisted TEST project — refusing (production is never allowed)`;
  }
  if (!process.env.SUPABASE_TEST_SERVICE_KEY) {
    return 'SUPABASE_TEST_SERVICE_KEY not set — phase27 tables have deny-all RLS; the service key is required (no anon fallback)';
  }
  return false;
}

// Short masked identifier for log/assertion messages — never the full ref.
export function maskedTestRef() {
  try {
    return `${new URL(process.env.SUPABASE_TEST_URL).host.split('.')[0].slice(0, 4)}…`;
  } catch {
    return 'unknown';
  }
}

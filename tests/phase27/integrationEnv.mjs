// tests/phase27/integrationEnv.mjs
// Shared guard for the phase27 Supabase integration tests (KAL-257).
//
// These tests validate the live Survey schema and use one service-role-only,
// test-specific bytea table. They must never leak into the unit suite
// (`npm test`). Four independent locks:
//   1. SUPABASE_INTEGRATION=1 must be set explicitly. `npm run test:integration`
//      sets it; plain `npm test` never does — so a stray SUPABASE_TEST_URL in
//      the shell cannot change the 1326-test unit baseline.
//   2. SUPABASE_TEST_TARGET must explicitly say main-isolated.
//   3. SUPABASE_TEST_URL must be the exact main Survey project. Arbitrary hosts
//      are refused so the service-role key can never be sent elsewhere.
//   4. SUPABASE_TEST_SERVICE_KEY must be present. There is deliberately no anon
//      fallback.
//
// integrationSkipReason() returns a skip-reason string when any lock
// disagrees, else false (run). Missing env therefore SKIPS, never fails —
// the §2.5 guardrail from PRE-REBUILD-READINESS.md.

const MAIN_SURVEY_HOST = 'cvamwtpsuvxvjdnotbeg.supabase.co';

export function integrationSkipReason() {
  if (process.env.SUPABASE_INTEGRATION !== '1') {
    return 'SUPABASE_INTEGRATION=1 not set — integration tests only run via `npm run test:integration`';
  }
  if (process.env.SUPABASE_TEST_TARGET !== 'main-isolated') {
    return 'SUPABASE_TEST_TARGET=main-isolated not set — refusing cloud integration writes';
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
  if (host !== MAIN_SURVEY_HOST) {
    return `SUPABASE_TEST_URL host "${host}" is not the main Survey project — refusing`;
  }
  if (!process.env.SUPABASE_TEST_SERVICE_KEY) {
    return 'SUPABASE_TEST_SERVICE_KEY not set — service role is required (no anon fallback)';
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

export async function loadPublicOpenApiSchema() {
  const baseUrl = process.env.SUPABASE_TEST_URL.replace(/\/+$/, '');
  const key = process.env.SUPABASE_TEST_SERVICE_KEY;
  const response = await fetch(`${baseUrl}/rest/v1/`, {
    headers: {
      Accept: 'application/openapi+json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`PostgREST OpenAPI request failed: HTTP ${response.status}`);
  }
  const schema = await response.json();
  if (!schema?.definitions) {
    throw new Error('PostgREST OpenAPI response did not contain definitions');
  }
  return schema;
}

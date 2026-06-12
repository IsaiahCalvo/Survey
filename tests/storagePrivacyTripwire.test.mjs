// tests/storagePrivacyTripwire.test.mjs
// KAL-288 S2 — privacy-regression tripwire for the `documents` storage bucket.
//
// The 2026-06-11 audit (.planning/optimization/KAL-288-BUCKET-PRIVACY-REPORT.md)
// confirmed the bucket is PRIVATE, but a single dashboard toggle (`public` → true)
// would expose every PDF to any path holder and nothing in the repo would notice.
// This test turns that toggle into a red test: it asserts the bucket flag is
// `public:false` AND that an anonymous GET on the exact public route the SDK
// builds is denied for an existence-verified object.
//
// READ-ONLY BY CONSTRUCTION: every request is an HTTP GET via fetch (keys live in
// headers, never argv); all object probes carry `Range: bytes=0-0` so at most one
// byte of PDF content moves. No supabase-js client is created — there is no code
// path here that could write. That is why production is allowlisted below, unlike
// tests/phase27/integrationEnv.mjs (those tests INSERT rows and exclude prod by
// design — do not merge the two guards).
//
// Conditional-skip pattern (KAL-257 / PRE-REBUILD-READINESS.md §2.5): missing env
// SKIPS, never fails, so the plain `npm test` unit baseline only gains a skip.
// Runs for real via `npm run test:privacy` (this file only — immune to phase27/
// survey-test health) and also inside `npm run test:integration`; both need the
// two vars below in .env.test (see .env.test.example).

import { test } from 'node:test';
import { ok, fail, strictEqual } from 'node:assert';

// Hardcoded allowlist: the service key is sent as a header to this host, so an
// arbitrary/typo'd URL must be refused. PRODUCTION ONLY — the privacy risk this
// tripwire guards lives on the production bucket; allowing survey-test here
// would open a false-green path (green against survey-test while prod is
// public). Codex review r1 finding 1.
const ALLOWED_PROBE_HOSTS = [
  'cvamwtpsuvxvjdnotbeg.supabase.co', // production — GET-only probes are safe here
];

const FETCH_TIMEOUT_MS = 15_000;

function skipReason() {
  if (process.env.SUPABASE_INTEGRATION !== '1') {
    return 'SUPABASE_INTEGRATION=1 not set — run this tripwire via `npm run test:privacy` (or `npm run test:integration`)';
  }
  const url = process.env.SUPABASE_PRIVACY_PROBE_URL;
  if (!url) {
    return 'SUPABASE_PRIVACY_PROBE_URL not set — see .env.test.example';
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'SUPABASE_PRIVACY_PROBE_URL is not a valid URL — refusing';
  }
  if (parsed.protocol !== 'https:') {
    return 'SUPABASE_PRIVACY_PROBE_URL must be https — refusing to send the service key over anything else';
  }
  // URL.host includes any port, so exact match also rejects nonstandard ports.
  if (!ALLOWED_PROBE_HOSTS.includes(parsed.host)) {
    return `SUPABASE_PRIVACY_PROBE_URL host "${parsed.host}" is not allowlisted for privacy probes — refusing`;
  }
  if (!process.env.SUPABASE_PRIVACY_PROBE_SERVICE_KEY) {
    return 'SUPABASE_PRIVACY_PROBE_SERVICE_KEY not set — the bucket-config endpoint requires the service role';
  }
  return false;
}

// Audit masking convention: first 6 + last 10 chars — a full path is a reusable
// URL component and must never land in test output.
function maskPath(p) {
  if (typeof p !== 'string' || p.length <= 16) return '(short path)';
  return `${p.slice(0, 6)}…${p.slice(-10)}`;
}

// Slashes must stay path separators, matching the SDK's URL construction.
function encodeObjectPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function baseUrl() {
  return process.env.SUPABASE_PRIVACY_PROBE_URL.replace(/\/+$/, '');
}

function serviceHeaders() {
  const key = process.env.SUPABASE_PRIVACY_PROBE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

// Requests carrying the service key never follow redirects — a cross-origin
// redirect would re-send the custom apikey header to the new host (fetch only
// strips Authorization). A 3xx therefore surfaces as a non-ok status and fails
// the calling assertion loudly; Supabase storage/PostgREST do not redirect.
// The anonymous probe DOES follow redirects: if any redirect chain ends in a
// 2xx, the object is anonymously readable and the test must go red.
async function get(url, headers, { redirect = 'manual' } = {}) {
  return fetch(url, {
    method: 'GET',
    headers,
    redirect,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

test('documents bucket privacy tripwire (KAL-288 S2)', { skip: skipReason() }, async (t) => {
  await t.test('bucket flag: GET /storage/v1/bucket/documents reports public:false', async () => {
    const res = await get(`${baseUrl()}/storage/v1/bucket/documents`, serviceHeaders());
    strictEqual(
      res.status,
      200,
      `bucket-config endpoint must return 200 (got ${res.status}) — a 404 means the ` +
        'documents bucket was renamed/deleted and this tripwire can no longer see what it guards'
    );
    const bucket = await res.json();
    strictEqual(
      bucket.public,
      false,
      'documents bucket reports public:true — every PDF is readable by any path holder. ' +
        'Flip it back to private in the Supabase dashboard NOW, then audit access logs.'
    );
  });

  await t.test('behavior: anonymous public-route GET is denied on an existence-verified object', async (t2) => {
    // Newest rows first (most likely to exist — the audit found the OLDEST
    // sampled row orphaned). 15 samples, not 5: a burst of orphaned recent rows
    // must not fail the tripwire while one verifiable object exists (r1 finding 6).
    const selectUrl = `${baseUrl()}/rest/v1/documents?select=file_path&order=created_at.desc&limit=15`;
    let rowsRes = await get(selectUrl, serviceHeaders());
    if (!rowsRes.ok) {
      // Column-shape tolerance: retry once without the order clause.
      rowsRes = await get(`${baseUrl()}/rest/v1/documents?select=file_path&limit=15`, serviceHeaders());
    }
    ok(rowsRes.ok, `documents row sample failed: HTTP ${rowsRes.status}`);
    const rows = (await rowsRes.json()).filter((r) => typeof r.file_path === 'string' && r.file_path);

    if (rows.length === 0) {
      // Legitimate on a fresh test project; the flag assertion above already ran.
      t2.skip('documents table has no rows — nothing to probe anonymously');
      return;
    }

    // Existence gate: anonymous 4xx is only evidence of privacy for an object that
    // verifiably exists (service-role read, Range-limited).
    let verifiedPath = null;
    const gateStatuses = [];
    for (const { file_path: path } of rows) {
      const res = await get(
        `${baseUrl()}/storage/v1/object/authenticated/documents/${encodeObjectPath(path)}`,
        { ...serviceHeaders(), Range: 'bytes=0-0' }
      );
      gateStatuses.push(`${maskPath(path)}→${res.status}`);
      if (res.status === 206 || res.status === 200) {
        verifiedPath = path;
        break;
      }
    }
    if (!verifiedPath) {
      fail(
        'no sampled document object exists in storage — tripwire cannot certify the anonymous ' +
          `route, and every sampled row being orphaned is itself an anomaly. Gate results: ${gateStatuses.join(', ')}`
      );
    }

    // The exact route getPublicUrl() string-concats (verified against storage-js
    // source in the KAL-288 audit). Zero headers: truly anonymous.
    const anonRes = await get(
      `${baseUrl()}/storage/v1/object/public/documents/${encodeObjectPath(verifiedPath)}`,
      { Range: 'bytes=0-0' },
      { redirect: 'follow' }
    );
    ok(
      !anonRes.ok,
      `anonymous public-route GET returned ${anonRes.status} for existence-verified object ` +
        `${maskPath(verifiedPath)} — the documents bucket is anonymously readable. Treat as exposed ` +
        'regardless of what the bucket flag says.'
    );
  });
});

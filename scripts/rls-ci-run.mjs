// scripts/rls-ci-run.mjs
// CI gate for the RLS regression suite (tests/phase28/rls/05-10) — the app's
// permission layer is RLS-only, so this proves owner/editor/viewer/non-collaborator
// access stays correct on every change.
//
// Runs against the DEDICATED Supabase TEST project (survey-test) via the Management
// API. Each test file wraps BEGIN/ROLLBACK, so nothing persists. NEVER production.
//
// What it does:
//   1. Provisions the test DB (idempotent) so the suite runs LIVE, not skipped.
//   2. Runs each 05-10 file with a probe injected before its final `END $$;`.
//      - probe fired (exception text present)  => LIVE-PASS (ran every assertion)
//      - clean (HTTP 201, no probe)            => SKIPPED  -> FAIL the gate
//      - other error                           => assertion FAILED -> FAIL the gate
//
// Local use:  npm run test:rls   (loads .env.test if present)
// CI use:     needs the SUPABASE_ACCESS_TOKEN secret; if absent the gate is a no-op
//             (loud ::warning::) so it never blocks contributors/forks without the secret.
import fs from 'node:fs';

const PROD_REF = 'cvamwtpsuvxvjdnotbeg';                 // production — never allowed
const REF = process.env.SUPABASE_TEST_REF || 'zgdkyslxbkusexmkfvgd'; // survey-test
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const RLS_DIR = 'tests/phase28/rls';
const FILES = [
  '05_documents_rls', '06_document_collaborators_rls', '07_document_annotations_rls',
  '08_document_invites_rls', '09_storage_documents_bucket_rls', '10_excel_sync_audit_immutability',
];
const PROBE = 'PROBE_END_REACHED_LIVE';

const warn = (m) => console.log(`::warning::${m}`);
const err = (m) => console.log(`::error::${m}`);

if (REF === PROD_REF) { err('Refusing to run RLS tests against the production project.'); process.exit(1); }
if (!TOKEN) {
  warn('SUPABASE_ACCESS_TOKEN not set — RLS regression gate SKIPPED. Add it as a GitHub Actions secret (and SUPABASE_TEST_REF if not survey-test) to activate the gate.');
  process.exit(0);
}

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.status === 200 || r.status === 201, status: r.status, body: await r.text() };
}

// 1. provision (idempotent) so the suite runs live instead of skipping
for (const f of ['scripts/rls-test-db-provision.sql', 'scripts/rls-test-db-personas.sql']) {
  const r = await q(fs.readFileSync(f, 'utf8'));
  if (!r.ok) { err(`provision step failed (${f}) [HTTP ${r.status}]: ${r.body.slice(0, 400).replace(/\s+/g, ' ')}`); process.exit(1); }
  console.log(`provisioned ${f}`);
}

// 2. run + probe each file
let failures = 0;
for (const name of FILES) {
  const sql = fs.readFileSync(`${RLS_DIR}/${name}.sql`, 'utf8');
  const i = sql.lastIndexOf('END $$;');
  if (i < 0) { err(`${name}: no 'END $$;' found — cannot probe`); failures++; continue; }
  const probed = sql.slice(0, i) + `  RAISE EXCEPTION '${PROBE}';\n` + sql.slice(i);
  const r = await q(probed);
  if (r.body.includes(PROBE)) {
    console.log(`LIVE-PASS  ${name}`);
  } else if (r.ok) {
    err(`${name}: SKIPPED (prerequisites missing — gate not meaningful). Re-run provisioning.`); failures++;
  } else {
    err(`${name}: assertion FAILED [HTTP ${r.status}]: ${r.body.slice(0, 400).replace(/\s+/g, ' ')}`); failures++;
  }
}

if (failures) { err(`${failures} RLS test file(s) did not LIVE-PASS — permission regression or setup drift.`); process.exit(1); }
console.log('\nAll RLS regression tests LIVE-PASS ✔');

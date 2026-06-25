// edgeMatcherDrift.test.mjs — KAL-309 guarded-copy drift gate (PLAN-KAL309 §C, F14/F15).
//
// The excel-apply-changeset Edge Function imports the matcher + token modules from a
// COPY under supabase/functions/_shared/matcher/ (Deno isolates can't resolve
// ../../../src/services/*.js at deploy). This test FAILS the suite if that copy ever
// drifts byte-for-byte from src/services/*, so a silent stale copy — the KAL-307
// inline-copy bug class — can never reach deploy. Refresh the copy with
// `bash scripts/sync-matcher-to-edge.sh`.
//
// Auto-discovered by scripts/run-node-tests.mjs (tests/*.test.mjs), so it runs in the gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src', 'services');
const DST = join(ROOT, 'supabase', 'functions', '_shared', 'matcher');

// The exact set the Edge copy must contain — no more, no less. Keep in lockstep with
// scripts/sync-matcher-to-edge.sh FILES.
const MATCHER_FILES = [
  'rowIdToken.js',
  'rowFingerprint.js',
  'excelConflictDetect.js',
  'excelIdentityRecord.js',
  'rowImportMatcher.js',
  'buildScopeImportPlans.js',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

test('Edge matcher copy is byte-identical to src/services (hash compare)', async () => {
  for (const name of MATCHER_FILES) {
    const [srcBuf, dstBuf] = await Promise.all([
      readFile(join(SRC, name)),
      readFile(join(DST, name)).catch(() => {
        throw new Error(
          `Edge matcher copy missing ${name}. Run: bash scripts/sync-matcher-to-edge.sh`,
        );
      }),
    ]);
    assert.equal(
      sha256(dstBuf),
      sha256(srcBuf),
      `DRIFT: supabase/functions/_shared/matcher/${name} differs from src/services/${name}. ` +
        'Run: bash scripts/sync-matcher-to-edge.sh',
    );
  }
});

test('Edge matcher copy contains exactly the sanctioned files (no extras, no strays)', async () => {
  const entries = await readdir(DST);
  const jsFiles = entries.filter((e) => e.endsWith('.js')).sort();
  assert.deepEqual(
    jsFiles,
    [...MATCHER_FILES].sort(),
    'The Edge matcher copy directory must contain exactly the six sanctioned modules. ' +
      'A stray or missing file means the copy mechanism drifted — re-run ' +
      'bash scripts/sync-matcher-to-edge.sh and reconcile the FILES list.',
  );
});

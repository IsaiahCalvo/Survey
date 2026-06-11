// KAL-260 backup annotations — unit tests for all pure helpers (no network).
// Plan §7 test list: keyset loop, sweep comparator, drift/retry, checkpoint
// verification glue, buildRestoreBatches, exit precedence, write-leak source
// scan, manifest allowlist + poisoned-input, precision tripwire.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HASH_SCHEME,
  payloadHash,
  sha256Hex,
} from '../scripts/kal261-baseline-dedup-preview.mjs';
import {
  PINNED_BASELINE_SHA256,
  aggregateExitCode,
  anchorUserDrawn,
  verifyCheckpointIntegrity,
} from '../scripts/kal262-zero-loss-harness.mjs';
import {
  BACKUP_TABLE,
  DriftError,
  REQUIRED_COLUMNS,
  RESTORE_RUNBOOK,
  buildGroundTruthInputs,
  buildRestoreBatches,
  checkSchemaCompleteness,
  compareSweepTodump,
  computeBackupExitCode,
  fetchDump,
  fetchSweep,
  makeBackupRoGet,
  scanPrecisionWarnings,
  serializeManifestMd,
  verifyArtifactsOnDisk,
} from '../scripts/kal260-backup-annotations.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROD_HOST = 'cvamwtpsuvxvjdnotbeg.supabase.co';

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const DOC = 'doc-kal260';

function makeRow(id, annotationId, extra = {}) {
  return {
    id,
    annotation_id: annotationId,
    document_id: DOC,
    page_number: 1,
    annotation_type: 'ink',
    user_id: 'user-1',
    created_at: '2026-06-01T00:00:00+00:00',
    updated_at: '2026-06-02T00:00:00+00:00',
    annotation_data: { fabricObject: { stroke: '#f00' }, pageNumber: 1 },
    ...extra,
  };
}

// Build a fake roGet that simulates keyset-paginated responses.
// Reads id=gt.<cursor> from params and returns the correct page slice.
function makePaginatedRoGet(allRows, pageSize = 3) {
  const sorted = [...allRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return async function fakeRoGet(table, params, opts = {}) {
    // Parse id=gt.<cursor> from params string
    const m = String(params ?? '').match(/id=gt\.([^&]+)/);
    const cursor = m ? decodeURIComponent(m[1]) : null;
    let start = 0;
    if (cursor) {
      const idx = sorted.findIndex((r) => r.id === cursor);
      start = idx >= 0 ? idx + 1 : sorted.length;
    }
    const page = sorted.slice(start, start + pageSize);
    const rawBody = JSON.stringify(page);
    return {
      rows: page,
      contentRange: `0-${Math.max(0, page.length - 1)}/${allRows.length}`,
      rawBody,
    };
  };
}

// Build a fake roGet that always returns the same full page of rows (simulating
// a server that keeps returning the same page — ids never advance). Use with
// pageSize equal to the page length to avoid the short-page exit before
// detecting the duplicate on the second call.
function makeDuplicatingRoGet(rows) {
  return async function fakeRoGet() {
    const rawBody = JSON.stringify(rows);
    return { rows, contentRange: `0-${rows.length - 1}/${rows.length}`, rawBody };
  };
}

// ---------------------------------------------------------------------------
// 1 — keyset loop: page assembly, gt cursor, short-page exit
// ---------------------------------------------------------------------------

test('keyset loop: assembles rows across pages using gt cursor; exits on short page', async () => {
  const rows = [
    makeRow('id-01', 'a-01'),
    makeRow('id-02', 'a-02'),
    makeRow('id-03', 'a-03'),
    makeRow('id-04', 'a-04'),
    makeRow('id-05', 'a-05'),
  ];
  // pageSize:2 → pages [r1,r2], [r3,r4], [r5] (short) → 3 pages total
  const roGet = makePaginatedRoGet(rows, 2);
  const result = await fetchDump(roGet, { pageSize: 2 });
  assert.equal(result.rows.length, 5);
  assert.equal(result.rawPages.length, 3);
  assert.equal(result.jsonlLines.length, 5);
  for (const { body } of result.rawPages) {
    assert.ok(Array.isArray(JSON.parse(body)));
  }
  assert.equal(result.rawPages[0].filename, 'page-00001.json');
  assert.equal(result.rawPages[2].filename, 'page-00003.json');
});

// ---------------------------------------------------------------------------
// 2 — keyset loop: empty table returns zero rows and zero pages
// ---------------------------------------------------------------------------

test('keyset loop: empty table (page 1 returns empty array) exits immediately', async () => {
  const roGet = makePaginatedRoGet([], 3);
  const result = await fetchDump(roGet, { pageSize: 3 });
  assert.equal(result.rows.length, 0);
  assert.equal(result.rawPages.length, 1); // one page fetched (empty)
  assert.equal(result.jsonlLines.length, 0);
});

// ---------------------------------------------------------------------------
// 3 — keyset loop: cross-page duplicate id detection
// ---------------------------------------------------------------------------

test('keyset loop: throws on cross-page duplicate id', async () => {
  // Return a full page (1 row at pageSize:1) every call — cursor never advances
  // so the same id appears on page 2 and duplicate detection fires.
  const dupRow = makeRow('id-dup', 'a-dup');
  const roGet = makeDuplicatingRoGet([dupRow]);
  await assert.rejects(
    () => fetchDump(roGet, { pageSize: 1 }),
    /duplicate id id-dup/,
  );
});

// ---------------------------------------------------------------------------
// 4 — sweep comparator: equal multisets PASS
// ---------------------------------------------------------------------------

test('sweep comparator: equal multisets pass', () => {
  const rows = [makeRow('r1', 'a1'), makeRow('r2', 'a2')];
  const sweepMap = new Map([
    ['r1', '2026-06-02T00:00:00+00:00'],
    ['r2', '2026-06-02T00:00:00+00:00'],
  ]);
  const result = compareSweepTodump(rows, sweepMap);
  assert.equal(result.pass, true);
  assert.equal(result.reason, null);
});

// ---------------------------------------------------------------------------
// 5 — sweep comparator: same-count id swap fails
// ---------------------------------------------------------------------------

test('sweep comparator: same-count id swap fails (id missing from sweep)', () => {
  const rows = [makeRow('r1', 'a1'), makeRow('r2', 'a2')];
  const sweepMap = new Map([
    ['r1', '2026-06-02T00:00:00+00:00'],
    ['r3', '2026-06-02T00:00:00+00:00'], // r3 instead of r2
  ]);
  const result = compareSweepTodump(rows, sweepMap);
  assert.equal(result.pass, false);
  assert.match(result.reason, /id r2 present in dump but absent in sweep/);
});

// ---------------------------------------------------------------------------
// 6 — sweep comparator: updated_at drift fails
// ---------------------------------------------------------------------------

test('sweep comparator: updated_at drift fails', () => {
  const rows = [makeRow('r1', 'a1', { updated_at: '2026-06-02T00:00:00+00:00' })];
  const sweepMap = new Map([
    ['r1', '2026-06-03T00:00:00+00:00'], // different updated_at
  ]);
  const result = compareSweepTodump(rows, sweepMap);
  assert.equal(result.pass, false);
  assert.match(result.reason, /updated_at drift on id r1/);
});

// ---------------------------------------------------------------------------
// 7 — sweep comparator: count mismatch fails
// ---------------------------------------------------------------------------

test('sweep comparator: count mismatch fails (dump has more rows than sweep)', () => {
  const rows = [makeRow('r1', 'a1'), makeRow('r2', 'a2')];
  const sweepMap = new Map([
    ['r1', '2026-06-02T00:00:00+00:00'],
  ]);
  const result = compareSweepTodump(rows, sweepMap);
  assert.equal(result.pass, false);
  assert.match(result.reason, /row count mismatch/);
});

// ---------------------------------------------------------------------------
// 8 — sweep comparator: extra id in sweep (same count, swapped id) fails
// ---------------------------------------------------------------------------

test('sweep comparator: extra id in sweep that is absent from dump fails', () => {
  const rows = [makeRow('r1', 'a1'), makeRow('r2', 'a2')];
  const sweepMap = new Map([
    ['r1', '2026-06-02T00:00:00+00:00'],
    ['r9', '2026-06-02T00:00:00+00:00'], // r9 not in dump — same count but swap
  ]);
  const result = compareSweepTodump(rows, sweepMap);
  assert.equal(result.pass, false);
  // Either r2 is absent from sweep or r9 is extra
  assert.ok(result.reason, 'expected a failure reason');
});

// ---------------------------------------------------------------------------
// 9 — DriftError: is exported and instanceof Error
// ---------------------------------------------------------------------------

test('DriftError: is exported and instanceof Error', () => {
  const err = new DriftError('test drift');
  assert.ok(err instanceof DriftError);
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'test drift');
});

// ---------------------------------------------------------------------------
// 10 — checkpoint verification glue: missing id → throws
// ---------------------------------------------------------------------------

test('checkpoint integrity gate: throws on missing baseline file', () => {
  assert.throws(
    () => verifyCheckpointIntegrity({}, { 'missing.json': 'abc123' }),
    /missing baseline file/,
  );
});

// ---------------------------------------------------------------------------
// 11 — checkpoint verification glue: unattributed hash mismatch → refuses
// ---------------------------------------------------------------------------

test('checkpoint integrity gate: refuses on sha256 mismatch', () => {
  const text = JSON.stringify({ hash_scheme: HASH_SCHEME, marks: [] });
  const pins = { 'x.json': sha256Hex(text) };
  assert.throws(
    () => verifyCheckpointIntegrity({ 'x.json': text + ' ' }, pins),
    /sha256 .* != pinned/,
  );
});

// ---------------------------------------------------------------------------
// 12 — checkpoint verification glue: hash_scheme drift → refuses
// ---------------------------------------------------------------------------

test('checkpoint integrity gate: refuses on hash_scheme drift', () => {
  const badScheme = JSON.stringify({
    hash_scheme: { ...HASH_SCHEME, algorithm: 'md5-different' },
    marks: [],
  });
  const pins = { 'user_drawn_marks_checkpoint.json': sha256Hex(badScheme) };
  assert.throws(
    () => verifyCheckpointIntegrity(
      { 'user_drawn_marks_checkpoint.json': badScheme },
      pins,
    ),
    /hash_scheme differs/,
  );
});

// ---------------------------------------------------------------------------
// 13 — checkpoint verification glue: attributed post-baseline change passes
//      (correct sha256 + correct hash_scheme)
// ---------------------------------------------------------------------------

test('checkpoint integrity gate: passes on exact sha256 + correct hash_scheme for all pinned files', () => {
  // verifyCheckpointIntegrity checks hash_scheme on both checkpoint files;
  // we must supply both in fileTexts and pin both sha256s.
  const checkpointText = JSON.stringify({ hash_scheme: HASH_SCHEME, count: 0, marks: [] });
  const survivorsText = JSON.stringify({ hash_scheme: HASH_SCHEME, count: 0, divergent_count: 0, survivors: [] });
  const baselineText = JSON.stringify({ run: { snapshot_before: {}, snapshot_after: {} } });
  const pins = {
    'user_drawn_marks_checkpoint.json': sha256Hex(checkpointText),
    'embedded_dedup_survivors.json': sha256Hex(survivorsText),
    'migration_baseline.json': sha256Hex(baselineText),
  };
  assert.doesNotThrow(() =>
    verifyCheckpointIntegrity(
      {
        'user_drawn_marks_checkpoint.json': checkpointText,
        'embedded_dedup_survivors.json': survivorsText,
        'migration_baseline.json': baselineText,
      },
      pins,
    ),
  );
});

// ---------------------------------------------------------------------------
// 14 — checkpoint verification glue: survivor-policy mismatch detection
//      (wrong survivor count in the file triggers hash mismatch)
// ---------------------------------------------------------------------------

test('checkpoint integrity gate: verifies real committed baseline files (615 marks, 10960 survivors)', async () => {
  const texts = {};
  for (const name of Object.keys(PINNED_BASELINE_SHA256)) {
    texts[name] = await readFile(
      `.planning/optimization/migration-baseline/${name}`,
      'utf8',
    );
  }
  const parsed = verifyCheckpointIntegrity(texts);
  assert.equal(parsed['user_drawn_marks_checkpoint.json'].count, 615);
  assert.equal(parsed['embedded_dedup_survivors.json'].count, 10960);
});

// ---------------------------------------------------------------------------
// 15 — buildRestoreBatches: batching
// ---------------------------------------------------------------------------

test('buildRestoreBatches: splits rows into correct batch sizes', () => {
  const rows = Array.from({ length: 7 }, (_, i) => makeRow(`r${i}`, `a${i}`));
  const batches = buildRestoreBatches(rows, 3);
  assert.equal(batches.length, 3); // 3 + 3 + 1
  assert.equal(batches[0].rowCount, 3);
  assert.equal(batches[1].rowCount, 3);
  assert.equal(batches[2].rowCount, 1);
  assert.equal(batches[0].offset, 0);
  assert.equal(batches[1].offset, 3);
  assert.equal(batches[2].offset, 6);
});

// ---------------------------------------------------------------------------
// 16 — buildRestoreBatches: fidelity (JSON-array round-trip)
// ---------------------------------------------------------------------------

test('buildRestoreBatches: body is a JSON array that parses back to the original rows verbatim', () => {
  const rows = [makeRow('r1', 'a1'), makeRow('r2', 'a2')];
  const [batch] = buildRestoreBatches(rows, 10);
  const parsed = JSON.parse(batch.body);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed, rows);
});

// ---------------------------------------------------------------------------
// 17 — buildRestoreBatches: header/conflict-mode completeness
// ---------------------------------------------------------------------------

test('buildRestoreBatches: batch has method, path, headers, preferResolution, conflictTarget', () => {
  const [batch] = buildRestoreBatches([makeRow('r1', 'a1')], 10);
  assert.equal(batch.method, 'POST');
  assert.equal(batch.path, `/rest/v1/${BACKUP_TABLE}`);
  assert.ok(batch.headers['Content-Type']);
  assert.ok(batch.headers['Prefer']);
  assert.equal(batch.preferResolution, 'merge-duplicates');
  assert.equal(batch.conflictTarget, 'id');
});

// ---------------------------------------------------------------------------
// 18 — buildRestoreBatches: empty rows returns no batches
// ---------------------------------------------------------------------------

test('buildRestoreBatches: empty rows returns empty array', () => {
  assert.deepEqual(buildRestoreBatches([], 10), []);
});

// ---------------------------------------------------------------------------
// 19 — exit precedence: FAIL(1) > DRIFT(2) > PASS(0)
// ---------------------------------------------------------------------------

test('exit precedence: FAIL(1) beats DRIFT(2) beats PASS(0)', () => {
  const base = {
    selfTestPass: true,
    anyUnexplained: false,
    anyVerifyFail: false,
    tableMoved: false,
  };
  assert.equal(aggregateExitCode(base), 0);
  assert.equal(aggregateExitCode({ ...base, tableMoved: true }), 2);
  assert.equal(aggregateExitCode({ ...base, anyVerifyFail: true }), 1);
  assert.equal(aggregateExitCode({ ...base, anyUnexplained: true }), 1);
  assert.equal(aggregateExitCode({ ...base, selfTestPass: false }), 1);
  // FAIL wins even when table also moved
  assert.equal(aggregateExitCode({ ...base, tableMoved: true, anyUnexplained: true }), 1);
  assert.equal(aggregateExitCode({ ...base, tableMoved: true, anyVerifyFail: true }), 1);
});

// ---------------------------------------------------------------------------
// 20 — write-leak source scan: exactly one fetchImpl( call site (roGet wrapper)
// ---------------------------------------------------------------------------

test('write-leak source scan: exactly one fetchImpl( call site in kal260-backup-annotations.mjs', async () => {
  const src = await readFile('scripts/kal260-backup-annotations.mjs', 'utf8');
  // There must be exactly ONE fetchImpl( — the call inside roGet.
  const implMatches = [...src.matchAll(/\bfetchImpl\s*\(/g)];
  assert.equal(
    implMatches.length,
    1,
    `expected exactly 1 fetchImpl( call site, found ${implMatches.length}`,
  );
  // No raw global fetch( call bypasses the wrapper (fetch is only used as
  // the default parameter value: fetchImpl = fetch, never called directly).
  const rawFetchCalls = [...src.matchAll(/\bfetch\s*\(/g)];
  assert.equal(
    rawFetchCalls.length,
    0,
    `expected 0 raw fetch( calls in the script, found ${rawFetchCalls.length}`,
  );
});

// ---------------------------------------------------------------------------
// 21 — write-leak source scan: no supabase-js import
// ---------------------------------------------------------------------------

test('write-leak source scan: no supabase-js or createClient in the script', async () => {
  const src = await readFile('scripts/kal260-backup-annotations.mjs', 'utf8');
  assert.doesNotMatch(src, /supabase-js|createClient/);
});

// ---------------------------------------------------------------------------
// 22 — write-leak source scan: no /rpc/ in URL template literals
// ---------------------------------------------------------------------------

test('write-leak source scan: no /rpc/ embedded in URL template literals or string concatenations', async () => {
  const src = await readFile('scripts/kal260-backup-annotations.mjs', 'utf8');
  // The guard regex /\/rpc\// is intentionally present to REJECT rpc paths —
  // that is correct. What must not appear is /rpc/ inside a template-literal
  // URL (e.g. `${base}/rpc/...`) or a string URL. Check for that pattern.
  assert.doesNotMatch(src, /`[^`]*\/rpc\//);      // no /rpc/ in backtick URLs
  assert.doesNotMatch(src, /'[^']*\/rpc\//);      // no /rpc/ in single-quote strings
  assert.doesNotMatch(src, /"[^"]*\/rpc\//);      // no /rpc/ in double-quote strings
});

// ---------------------------------------------------------------------------
// 23 — write-leak source scan: inert method:'POST' IS present in
//      buildRestoreBatches but no second fetch( references it
// ---------------------------------------------------------------------------

test("write-leak source scan: inert method:'POST' literal exists in buildRestoreBatches; no second fetchImpl( references it", async () => {
  const src = await readFile('scripts/kal260-backup-annotations.mjs', 'utf8');
  // The POST literal must exist (inert data in buildRestoreBatches for the runbook)
  assert.match(src, /method:\s*'POST'/);
  // There is still exactly ONE fetchImpl( (the roGet wrapper) — no code path
  // can execute the POST literal through a second call site.
  const fetchImplCalls = [...src.matchAll(/\bfetchImpl\s*\(/g)];
  assert.equal(
    fetchImplCalls.length,
    1,
    `inert POST present but found ${fetchImplCalls.length} fetchImpl( calls`,
  );
});

// ---------------------------------------------------------------------------
// 24 — manifest allowlist: conforming input passes
// ---------------------------------------------------------------------------

function makeManifestMdData(overrides = {}) {
  return {
    task: 'KAL-260',
    generated_at: '2026-06-11T14:00:00.000Z',
    host: PROD_HOST,
    output_dir: '/tmp/test-kal260',
    row_count: 53229,
    page_count: 54,
    precision_warnings_count: 0,
    jsonl_sha256: 'abc123',
    raw_pages_sha256: 'def456',
    schema_sha256: 'ghi789',
    snapshot_before: { total: 53229, maxUpdatedAt: '2026-06-11T12:00:00+00:00' },
    snapshot_after: { total: 53229, maxUpdatedAt: '2026-06-11T12:00:00+00:00' },
    sweep_result: 'PASS',
    checkpoint_integrity: 'PASSED (pinned sha256s verified)',
    ground_truth_result: 'PASS — UD matched=615 drift=0; EM matched=10960 drift=0 (dump-derived inputs)',
    schema_check: 'PASS — row-key union covers all 9 required columns and equals the OpenAPI column set',
    file_integrity: 'PASS — 54 raw pages + JSONL reread, re-parsed, re-hashed OK',
    exit_code: 0,
    verdict: 'PASS',
    restore_runbook: {
      target_table: BACKUP_TABLE,
      fk_prerequisites: 'parent docs must exist',
      conflict_mode: 'merge-duplicates',
      batch_size: 500,
      sequence_note: 'UUID ids, no sequence reset',
      verification_after_restore: 're-run kal260',
      residual: "restore drill on Isaiah's go",
    },
    ...overrides,
  };
}

test('manifest allowlist: conforming data passes serializeManifestMd without throwing', () => {
  const data = makeManifestMdData();
  assert.doesNotThrow(() => serializeManifestMd(data));
  const md = serializeManifestMd(data);
  assert.ok(md.includes('KAL-260'));
  assert.ok(md.includes('Gate B1 SATISFIED'));
});

// ---------------------------------------------------------------------------
// 25 — manifest allowlist: poisoned-input rejection (annotation_data key)
// ---------------------------------------------------------------------------

test('manifest allowlist: rejects forbidden key "annotation_data" in input', () => {
  const data = makeManifestMdData({ annotation_data: { raw: true } });
  assert.throws(
    () => serializeManifestMd(data),
    /manifest allowlist: forbidden key "annotation_data"/,
  );
});

// ---------------------------------------------------------------------------
// 26 — manifest allowlist: poisoned-input rejection (nested fabricObject key)
// ---------------------------------------------------------------------------

test('manifest allowlist: rejects forbidden nested key "fabricObject" in restore_runbook', () => {
  const data = makeManifestMdData();
  data.restore_runbook = { ...data.restore_runbook, fabricObject: { raw: true } };
  assert.throws(
    () => serializeManifestMd(data),
    /manifest allowlist: forbidden key "fabricObject"/,
  );
});

// ---------------------------------------------------------------------------
// 27 — manifest: non-zero exit code generates NOT SATISFIED gate statement
// ---------------------------------------------------------------------------

test('manifest serializer: exit_code=2 generates NOT SATISFIED gate statement', () => {
  const data = makeManifestMdData({ exit_code: 2, verdict: 'DRIFT' });
  const md = serializeManifestMd(data);
  assert.ok(md.includes('Gate B1 NOT SATISFIED'));
});

// ---------------------------------------------------------------------------
// 28 — precision tripwire: safe integers pass; unsafe integers flagged
// ---------------------------------------------------------------------------

test('precision tripwire: safe integers not flagged; unsafe integers (> MAX_SAFE_INTEGER) are flagged', () => {
  const safe = [{ filename: 'page-00001.json', body: '{"id":"uuid","count":999}' }];
  assert.deepEqual(scanPrecisionWarnings(safe), []);

  // Number.MAX_SAFE_INTEGER + 1 = 9007199254740992
  const unsafe = [{ filename: 'page-00001.json', body: '[{"bignum":9007199254740992}]' }];
  const warnings = scanPrecisionWarnings(unsafe);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].page, 'page-00001.json');
  assert.equal(warnings[0].token, '9007199254740992');
});

// ---------------------------------------------------------------------------
// 29 — precision tripwire: string-delimited numbers not flagged
// ---------------------------------------------------------------------------

test('precision tripwire: number tokens inside JSON strings are not flagged', () => {
  // UUID ids or strings like "9007199254740992" (quoted) should NOT trigger
  const body = '{"id":"9007199254740992","page_number":1}';
  const warnings = scanPrecisionWarnings([{ filename: 'p.json', body }]);
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// 30 — makeBackupRoGet: rejects non-production origin
// ---------------------------------------------------------------------------

test('makeBackupRoGet: throws on non-production origin', () => {
  assert.throws(
    () => makeBackupRoGet('https://evil.example.com', 'key'),
    /not https:\/\/cvamwtpsuvxvjdnotbeg\.supabase\.co/,
  );
});

// ---------------------------------------------------------------------------
// 31 — makeBackupRoGet: rejects non-whitelisted table
// ---------------------------------------------------------------------------

test('makeBackupRoGet: rejects request to non-whitelisted table', async () => {
  const roGet = makeBackupRoGet(`https://${PROD_HOST}`, 'k', async () => ({
    status: 200,
    headers: { get: () => '0-0/0' },
    text: async () => '[]',
  }));
  await assert.rejects(
    () => roGet('documents', 'select=id'),
    /not whitelisted/,
  );
});

// ---------------------------------------------------------------------------
// 32 — makeBackupRoGet: issues GET with correct auth headers and no body
// ---------------------------------------------------------------------------

test('makeBackupRoGet: issues GET with apikey/Authorization headers and no body', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method, body: init?.body, headers: init?.headers });
    return {
      status: 200,
      headers: { get: () => '0-0/1' },
      text: async () => JSON.stringify([makeRow('r1', 'a1')]),
    };
  };
  const roGet = makeBackupRoGet(`https://${PROD_HOST}`, 'svc-key', fakeFetch);
  await roGet(BACKUP_TABLE, 'select=id&limit=1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].body, undefined);
  assert.equal(seen[0].headers.apikey, 'svc-key');
  assert.ok(seen[0].url.includes('/rest/v1/document_annotations?'));
  assert.doesNotMatch(seen[0].url, /\/rpc\//);
});

// ---------------------------------------------------------------------------
// 33 — finding 6: raw page persisted via onRawPage BEFORE parsing
// ---------------------------------------------------------------------------

test('raw-page persistence: onRawPage receives every page body, in order, before parsing', async () => {
  const rows = [makeRow('id-01', 'a-01'), makeRow('id-02', 'a-02'), makeRow('id-03', 'a-03')];
  const roGet = makePaginatedRoGet(rows, 2);
  const persisted = [];
  const result = await fetchDump(roGet, {
    pageSize: 2,
    onRawPage: async (filename, body) => persisted.push({ filename, body }),
  });
  assert.equal(persisted.length, 2); // [r1,r2], [r3] (short page)
  assert.equal(persisted[0].filename, 'page-00001.json');
  assert.equal(persisted[1].filename, 'page-00002.json');
  // persisted bodies are byte-identical to what fetchDump kept in memory
  assert.deepEqual(persisted.map((p) => p.body), result.rawPages.map((p) => p.body));
});

test('raw-page persistence: a page that fails to parse is ALREADY persisted when the dump aborts', async () => {
  let call = 0;
  const roGet = async () => {
    call += 1;
    if (call === 1) {
      return { rows: null, contentRange: null, rawBody: JSON.stringify([makeRow('p1', 'a1')]) };
    }
    return { rows: null, contentRange: null, rawBody: '{truncated-not-json' };
  };
  const persisted = [];
  await assert.rejects(
    () => fetchDump(roGet, {
      pageSize: 1,
      onRawPage: async (filename, body) => persisted.push({ filename, body }),
    }),
    /body persisted but failed to parse/,
  );
  // both pages hit the persistence callback, including the malformed one
  assert.equal(persisted.length, 2);
  assert.equal(persisted[1].filename, 'page-00002.json');
  assert.equal(persisted[1].body, '{truncated-not-json');
});

// ---------------------------------------------------------------------------
// 34 — finding 1: ground-truth inputs are derived from the dump
// ---------------------------------------------------------------------------

const GT_CUTOFF = '2026-06-10T00:00:00+00:00'; // after the fixture rows' created_at

test('buildGroundTruthInputs: classifies user-drawn vs embedded from full dump rows, dedups survivors, filters by cutoff, hashes the dump rows', () => {
  const ud = makeRow('gt-ud', 'a-ud');
  const em1 = makeRow('gt-em1', 'a-em1', {
    page_number: 3,
    annotation_data: { fabricObject: { isPdfImported: true, pdfAnnotationId: 'P1' }, pageNumber: 3 },
  });
  // duplicate of the same embedded key — later updated_at wins latest_updated_at
  const em2 = makeRow('gt-em2', 'a-em2', {
    page_number: 3,
    updated_at: '2026-06-03T00:00:00+00:00',
    annotation_data: { fabricObject: { isPdfImported: true, pdfAnnotationId: 'P1' }, pageNumber: 3 },
  });
  const postCutoff = makeRow('gt-post', 'a-post', { created_at: '2026-06-20T00:00:00+00:00' });
  const gt = buildGroundTruthInputs([ud, em1, em2, postCutoff], GT_CUTOFF);

  // classification
  assert.equal(gt.userDrawn.length, 1);
  assert.equal(gt.userDrawn[0].id, 'gt-ud');
  assert.equal(gt.freshSurvivors.length, 1); // two candidates, one dedup key
  assert.deepEqual(gt.freshSurvivors[0].key, [DOC, 3, 'P1']);
  assert.equal(gt.freshSurvivors[0].picks.latest_updated_at.id, 'gt-em2');
  // cutoff filter
  assert.ok(!gt.fullRowsById.has('gt-post'));
  // hashes computed FROM the dump rows with the generator's own scheme
  assert.equal(gt.freshHashById.get('gt-ud'), payloadHash(ud));
  assert.equal(
    gt.freshEmbeddedHashById.get('gt-em2'),
    payloadHash(em2, { excludeAnnotationId: true }),
  );
  assert.equal(gt.anomalyCount, 0);
});

test('ground-truth verifies THE DUMP: a tampered dump row yields an unexplained FAIL even when the prod probe is healthy', async () => {
  const orig = makeRow('gt-1', 'a-gt1');
  const checkpoint = {
    count: 1,
    marks: [{
      id: 'gt-1', annotation_id: 'a-gt1', document_id: DOC,
      annotation_type: 'ink', payload_sha256: payloadHash(orig),
    }],
  };
  // the dump carries a corrupted copy; prod (probe) still has the healthy row
  const tampered = { ...orig, annotation_data: { ...orig.annotation_data, fabricObject: { stroke: '#0f0' } } };
  const gt = buildGroundTruthInputs([tampered], GT_CUTOFF);
  const probeById = async (id) => ({ id, created_at: orig.created_at, updated_at: orig.updated_at });
  const res = await anchorUserDrawn({
    checkpoint,
    freshUserDrawn: gt.userDrawn,
    freshHashById: gt.freshHashById,
    freshRowsById: gt.fullRowsById,
    probeById,
    cutoff: GT_CUTOFF,
  });
  assert.equal(res.matched, 0);
  assert.equal(res.unexplained.length, 1);
  assert.equal(res.unexplained[0].type, 'hash_mismatch');
  assert.equal(res.unexplained[0].key, 'gt-1');
});

test('ground-truth verifies THE DUMP: a checkpoint row missing from the dump but alive pre-cutoff in prod is an unexplained FAIL', async () => {
  const orig = makeRow('gt-2', 'a-gt2');
  const checkpoint = {
    count: 1,
    marks: [{
      id: 'gt-2', annotation_id: 'a-gt2', document_id: DOC,
      annotation_type: 'ink', payload_sha256: payloadHash(orig),
    }],
  };
  const gt = buildGroundTruthInputs([], GT_CUTOFF); // the dump dropped the row
  // prod is healthy: the by-id probe finds the row, created pre-cutoff →
  // OUR dump dropped it → unexplained (kal262 classifyMissingId semantics)
  const probeById = async (id) => ({ id, created_at: orig.created_at, updated_at: orig.updated_at });
  const res = await anchorUserDrawn({
    checkpoint,
    freshUserDrawn: gt.userDrawn,
    freshHashById: gt.freshHashById,
    freshRowsById: gt.fullRowsById,
    probeById,
    cutoff: GT_CUTOFF,
  });
  assert.equal(res.unexplained.length, 1);
  assert.equal(res.unexplained[0].type, 'missing_from_fresh');
});

// ---------------------------------------------------------------------------
// 35 — finding 2: attributed drift caps the exit at 2, never 0
// ---------------------------------------------------------------------------

test('computeBackupExitCode: drift_explained > 0 can never exit 0; FAIL still beats DRIFT', () => {
  // clean run
  assert.equal(computeBackupExitCode({ isDrift: false }), 0);
  // pull-loop drift
  assert.equal(computeBackupExitCode({ isDrift: true }), 2);
  // attributed checkpoint drift alone → DRIFT, not PASS
  assert.equal(computeBackupExitCode({ isDrift: false, driftExplainedCount: 1 }), 2);
  for (const n of [1, 2, 7, 1244]) {
    assert.notEqual(
      computeBackupExitCode({ isDrift: false, driftExplainedCount: n }),
      0,
      `driftExplainedCount=${n} must not exit 0`,
    );
  }
  // FAIL beats DRIFT regardless of drift counts
  assert.equal(computeBackupExitCode({ isDrift: false, driftExplainedCount: 3, anyUnexplained: true }), 1);
  assert.equal(computeBackupExitCode({ isDrift: true, driftExplainedCount: 3, anyVerifyFail: true }), 1);
});

// ---------------------------------------------------------------------------
// 36 — finding 3: schema completeness gate
// ---------------------------------------------------------------------------

function openApiText(columns) {
  return JSON.stringify({
    definitions: {
      document_annotations: {
        properties: Object.fromEntries(columns.map((c) => [c, { type: 'string' }])),
      },
    },
  });
}

test('schema completeness: dump keys covering required columns and equal to the OpenAPI set pass; schema extras present in rows are recorded and allowed', () => {
  const rows = [makeRow('s1', 'a1')]; // exactly the 9 required keys
  const ok = checkSchemaCompleteness(rows, openApiText(REQUIRED_COLUMNS));
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.missingRequired, []);
  assert.deepEqual(ok.extras, []);

  // a 10th column present in BOTH schema and rows: allowed, recorded verbatim
  const rowsExtra = [{ ...makeRow('s2', 'a2'), workspace_id: 'w-1' }];
  const okExtra = checkSchemaCompleteness(rowsExtra, openApiText([...REQUIRED_COLUMNS, 'workspace_id']));
  assert.equal(okExtra.pass, true);
  assert.deepEqual(okExtra.extras, ['workspace_id']);
});

test('schema completeness: a required column missing from every dump row FAILS', () => {
  const row = makeRow('s3', 'a3');
  delete row.annotation_data;
  const res = checkSchemaCompleteness([row], openApiText(REQUIRED_COLUMNS));
  assert.equal(res.pass, false);
  assert.deepEqual(res.missingRequired, ['annotation_data']);
});

test('schema completeness: a row key absent from the OpenAPI schema FAILS', () => {
  const rows = [{ ...makeRow('s4', 'a4'), rogue_column: 1 }];
  const res = checkSchemaCompleteness(rows, openApiText(REQUIRED_COLUMNS));
  assert.equal(res.pass, false);
  assert.deepEqual(res.rowKeysNotInSchema, ['rogue_column']);
});

test('schema completeness: an OpenAPI column never observed in the dump FAILS (select=* should return every column)', () => {
  const rows = [makeRow('s5', 'a5')];
  const res = checkSchemaCompleteness(rows, openApiText([...REQUIRED_COLUMNS, 'workspace_id']));
  assert.equal(res.pass, false);
  assert.deepEqual(res.schemaColumnsNotInDump, ['workspace_id']);
});

test('schema completeness: unparseable or table-less OpenAPI schema FAILS', () => {
  const rows = [makeRow('s6', 'a6')];
  assert.equal(checkSchemaCompleteness(rows, '{not-json').pass, false);
  assert.equal(checkSchemaCompleteness(rows, JSON.stringify({ definitions: {} })).pass, false);
});

// ---------------------------------------------------------------------------
// 37 — finding 4: file-integrity reread gate (mocked fs)
// ---------------------------------------------------------------------------

function diskFixture() {
  const rows = [makeRow('f1', 'a1'), makeRow('f2', 'a2')];
  const pageBody = JSON.stringify(rows);
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  const files = new Map([
    ['/out/raw-pages/page-00001.json', pageBody],
    ['/out/document_annotations.jsonl', jsonl],
  ]);
  const readFileImpl = async (p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    return files.get(p);
  };
  const args = {
    rawPages: [{ filename: 'page-00001.json', body: pageBody }],
    expectedRawShas: [sha256Hex(pageBody)],
    rawPagesDir: '/out/raw-pages',
    jsonlPath: '/out/document_annotations.jsonl',
    expectedJsonlSha256: sha256Hex(jsonl),
    expectedRowCount: 2,
    readFileImpl,
  };
  return { files, args, jsonl, pageBody };
}

test('file-integrity reread: matching disk content passes', async () => {
  const { args } = diskFixture();
  const res = await verifyArtifactsOnDisk(args);
  assert.equal(res.pass, true);
  assert.deepEqual(res.problems, []);
});

test('file-integrity reread: corrupted raw page on disk FAILS', async () => {
  const { files, args, pageBody } = diskFixture();
  files.set('/out/raw-pages/page-00001.json', pageBody + ' ');
  const res = await verifyArtifactsOnDisk(args);
  assert.equal(res.pass, false);
  assert.ok(res.problems.some((p) => /raw page page-00001\.json: sha256 mismatch/.test(p)));
});

test('file-integrity reread: corrupted JSONL on disk FAILS (sha and/or parse)', async () => {
  const { files, args, jsonl } = diskFixture();
  files.set('/out/document_annotations.jsonl', jsonl.slice(0, -5) + '!!!');
  const res = await verifyArtifactsOnDisk(args);
  assert.equal(res.pass, false);
  assert.ok(res.problems.length >= 1);
});

test('file-integrity reread: JSONL row-count mismatch on reread FAILS', async () => {
  const { files, args } = diskFixture();
  // valid JSONL but only one row — sha mismatch AND count mismatch
  files.set('/out/document_annotations.jsonl', JSON.stringify(makeRow('f1', 'a1')));
  const res = await verifyArtifactsOnDisk(args);
  assert.equal(res.pass, false);
  assert.ok(res.problems.some((p) => /row count 1 != expected 2/.test(p)));
});

test('file-integrity reread: missing file on disk FAILS', async () => {
  const { files, args } = diskFixture();
  files.delete('/out/raw-pages/page-00001.json');
  const res = await verifyArtifactsOnDisk(args);
  assert.equal(res.pass, false);
  assert.ok(res.problems.some((p) => /reread failed/.test(p)));
});

// ---------------------------------------------------------------------------
// 38 — finding 5: runbook verification wording is honest about the origin pin
// ---------------------------------------------------------------------------

test('restore runbook: verification-after-restore describes keyset export + JSONL comparison and names the origin pin as a manual adaptation step', () => {
  const v = RESTORE_RUNBOOK.verification_after_restore;
  assert.match(v, /keyset/i);
  assert.match(v, /document_annotations\.jsonl/);
  assert.match(v, /hard-pins the production origin/);
  assert.match(v, /deliberate manual step/);
  // it must NOT claim this script can simply be re-run against a restore target
  assert.doesNotMatch(v, /re-run kal260-backup-annotations\.mjs against the restored table/);
  assert.equal(RESTORE_RUNBOOK.target_table, BACKUP_TABLE);
});

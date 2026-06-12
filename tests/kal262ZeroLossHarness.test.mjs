// KAL-262 zero-loss harness — unit tests for the pure helpers (no network).
// Targeted gates from PLAN-KAL262.md (Codex-approved r3): round-trip pass,
// every typed diff fires, drift attribution, integrity gate refusal, pinned
// known-answer hash vector, write-leak gate, allowlist schema, exit precedence.
//
// Conditional-skip guard (KAL-257 §2.5): tests that read the committed baseline
// files (.planning/optimization/migration-baseline/) or the harness source from
// scripts/ are skipped — not failed — when those paths are absent from the
// working tree (e.g. a shallow CI checkout or a stripped-down environment).
// All synthetic-fixture tests run unconditionally.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function missingPrerequisite() {
  const baselineDir = resolve(REPO_ROOT, '.planning/optimization/migration-baseline');
  if (!existsSync(baselineDir)) {
    return `baseline dir absent: ${baselineDir} — run KAL-261 first to generate committed outputs`;
  }
  const scriptPath = resolve(REPO_ROOT, 'scripts/kal262-zero-loss-harness.mjs');
  if (!existsSync(scriptPath)) {
    return `script absent: ${scriptPath}`;
  }
  return false;
}

// Computed once at module load. Falsy means all prerequisites are present.
const ARTIFACT_SKIP = missingPrerequisite();
import {
  HASH_SCHEME,
  canonicalStringify,
  makeRoGet,
  payloadHash,
  sha256Hex,
} from '../scripts/kal261-baseline-dedup-preview.mjs';
import {
  PINNED_BASELINE_SHA256,
  POLICIES,
  aggregateExitCode,
  assertVerdictsAllowlisted,
  buildExpectations,
  classifyContentDiff,
  classifyMissingId,
  extractMaps,
  identityAdapter,
  materializeDoc,
  roundTripDoc,
  runSelfTest,
  verifyCheckpointIntegrity,
  verifyDocument,
} from '../scripts/kal262-zero-loss-harness.mjs';

// ---------------------------------------------------------------------------
// Synthetic fixture: one document with user-drawn (ink + survey-marker +
// callout) and embedded rows including a cross-page duplicate pdfAnnotationId.
// ---------------------------------------------------------------------------

const DOC = 'doc-1';
const CUTOFF = '2026-06-11T14:38:44.892Z';

function row(id, annotationId, type, page, data, extra = {}) {
  return {
    id,
    annotation_id: annotationId,
    document_id: DOC,
    page_number: page,
    annotation_type: type,
    user_id: 'user-1',
    created_at: '2026-06-01T00:00:00+00:00',
    updated_at: '2026-06-02T00:00:00+00:00',
    annotation_data: data,
    ...extra,
  };
}

const ROWS = [
  row('r-ink', 'a-ink', 'ink', 1, { fabricObject: { stroke: '#f00' }, pageNumber: 1 }),
  row('r-sm', 'surveyMarker-1', 'survey-marker', 1, { fabricObject: { label: 'SM' }, pageNumber: 1 }),
  row('r-co', 'a-callout', 'callout', 2, { fabricObject: { text: 'hi' }, pageNumber: 2 }),
  row('r-e1', 'a-e1', 'ink', 4, { fabricObject: { isPdfImported: true, pdfAnnotationId: '6400R' }, pageNumber: 4 }),
  row('r-e2', 'a-e2', 'ink', 11, { fabricObject: { isPdfImported: true, pdfAnnotationId: '6400R' }, pageNumber: 11 }),
];
const FULL_ROWS = new Map(ROWS.map((r) => [r.id, r]));

function fixtureCheckpointFiles() {
  const marks = ROWS.filter((r) => !r.annotation_data.fabricObject.isPdfImported).map((r) => ({
    id: r.id,
    annotation_id: r.annotation_id,
    document_id: DOC,
    page_number: r.page_number,
    effective_page: r.annotation_data.pageNumber,
    annotation_type: r.annotation_type,
    user_id: r.user_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    payload_sha256: payloadHash(r),
  }));
  const survivors = ROWS.filter((r) => r.annotation_data.fabricObject.isPdfImported).map((r) => {
    const pick = { id: r.id, payload_sha256: payloadHash(r, { excludeAnnotationId: true }) };
    return {
      key: [DOC, r.annotation_data.pageNumber, r.annotation_data.fabricObject.pdfAnnotationId],
      candidates: 1,
      app_exact: pick,
      latest_updated_at: pick,
      latest_created_at: pick,
      divergent: false,
    };
  });
  return {
    checkpoint: { task: 'KAL-261', generated_at: CUTOFF, hash_scheme: HASH_SCHEME, count: marks.length, marks },
    survivorsFile: { task: 'KAL-261', generated_at: CUTOFF, hash_scheme: HASH_SCHEME, count: survivors.length, divergent_count: 0, survivors },
  };
}

function fixtureExpectations() {
  const { checkpoint, survivorsFile } = fixtureCheckpointFiles();
  return buildExpectations(checkpoint, survivorsFile).get(DOC);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// 1 — round-trip pass; cross-page keys distinct; callout routed to callouts
// ---------------------------------------------------------------------------

test('round-trip: materialize → encode → apply → extract → verify PASSES; cross-page duplicate pdfAnnotationId stays distinct; callout routed to callouts map', () => {
  const exp = fixtureExpectations();
  const extracted = extractMaps(roundTripDoc(materializeDoc(exp, FULL_ROWS, 'app_exact')));
  assert.equal(Object.keys(extracted.callouts).length, 1);
  assert.ok(extracted.callouts['a-callout']);
  // 2 non-callout user-drawn + 2 embedded keys (same pdfAnnotationId, two pages)
  assert.equal(Object.keys(extracted.annotations).length, 4);
  assert.ok(extracted.annotations[canonicalStringify([DOC, 4, '6400R'])]);
  assert.ok(extracted.annotations[canonicalStringify([DOC, 11, '6400R'])]);
  const verdict = verifyDocument(extracted, identityAdapter, exp, 'app_exact');
  assert.deepEqual(verdict.diffs, []);
  assert.equal(verdict.pass, true);
});

// ---------------------------------------------------------------------------
// 2..7 — every typed diff fires
// ---------------------------------------------------------------------------

function extractedFixture() {
  const exp = fixtureExpectations();
  return { exp, ext: clone(extractMaps(roundTripDoc(materializeDoc(exp, FULL_ROWS, 'app_exact')))) };
}

test('tamper detection: one mutated nested field → exactly one hash_mismatch', () => {
  const { exp, ext } = extractedFixture();
  ext.annotations['surveyMarker-1'].annotation_data.fabricObject.label = 'tampered';
  const verdict = verifyDocument(ext, identityAdapter, exp, 'app_exact');
  assert.equal(verdict.pass, false);
  assert.equal(verdict.diffs.length, 1);
  assert.equal(verdict.diffs[0].type, 'hash_mismatch');
  assert.equal(verdict.diffs[0].key, 'surveyMarker-1');
});

test('missing user-drawn mark → missing_mark with that annotation_id', () => {
  const { exp, ext } = extractedFixture();
  delete ext.annotations['a-ink'];
  const diffs = verifyDocument(ext, identityAdapter, exp, 'app_exact').diffs;
  assert.ok(diffs.some((d) => d.type === 'missing_mark' && d.key === 'a-ink'));
});

test('missing embedded key → missing_embedded_key (+ count_mismatch)', () => {
  const { exp, ext } = extractedFixture();
  const key = canonicalStringify([DOC, 4, '6400R']);
  delete ext.annotations[key];
  const diffs = verifyDocument(ext, identityAdapter, exp, 'app_exact').diffs;
  assert.ok(diffs.some((d) => d.type === 'missing_embedded_key' && d.key === key));
  assert.ok(diffs.some((d) => d.type === 'count_mismatch' && d.expected === 2 && d.observed === 1));
});

test('extra key → extra_key', () => {
  const { exp, ext } = extractedFixture();
  ext.annotations['rogue'] = clone(ext.annotations['a-ink']);
  const diffs = verifyDocument(ext, identityAdapter, exp, 'app_exact').diffs;
  assert.ok(diffs.some((d) => d.type === 'extra_key' && d.key === 'rogue'));
});

test('callout in the wrong map → wrong_map', () => {
  const { exp, ext } = extractedFixture();
  ext.annotations['a-callout'] = ext.callouts['a-callout'];
  delete ext.callouts['a-callout'];
  const diffs = verifyDocument(ext, identityAdapter, exp, 'app_exact').diffs;
  assert.ok(diffs.some((d) => d.type === 'wrong_map' && d.key === 'a-callout' && d.expected === 'callouts'));
});

test('bridge-shaped stub → unreconstructable_entry', () => {
  const { exp, ext } = extractedFixture();
  ext.annotations['a-ink'] = { id: 'a-ink', type: 'path', pageNumber: 1, fabric: {}, meta: {} };
  const diffs = verifyDocument(ext, identityAdapter, exp, 'app_exact').diffs;
  assert.ok(diffs.some((d) => d.type === 'unreconstructable_entry' && d.key === 'a-ink'));
});

// ---------------------------------------------------------------------------
// 8 — wrong survivor on a divergent key
// ---------------------------------------------------------------------------

test('divergent key materialized under the losing policy → hash_mismatch under app_exact naming the key', () => {
  const winner = row('r-w', 'a-w', 'ink', 7, { fabricObject: { isPdfImported: true, pdfAnnotationId: 'DIV', v: 'winner' }, pageNumber: 7 });
  const loser = row('r-l', 'a-l', 'ink', 7, { fabricObject: { isPdfImported: true, pdfAnnotationId: 'DIV', v: 'loser' }, pageNumber: 7 });
  const key = [DOC, 7, 'DIV'];
  const survivorsFile = {
    hash_scheme: HASH_SCHEME,
    count: 1,
    divergent_count: 1,
    survivors: [{
      key,
      candidates: 2,
      app_exact: { id: winner.id, payload_sha256: payloadHash(winner, { excludeAnnotationId: true }) },
      latest_updated_at: { id: loser.id, payload_sha256: payloadHash(loser, { excludeAnnotationId: true }) },
      latest_created_at: { id: loser.id, payload_sha256: payloadHash(loser, { excludeAnnotationId: true }) },
      divergent: true,
    }],
  };
  const checkpoint = { hash_scheme: HASH_SCHEME, count: 0, marks: [] };
  const exp = buildExpectations(checkpoint, survivorsFile).get(DOC);
  const rows = new Map([[winner.id, winner], [loser.id, loser]]);
  const ext = extractMaps(roundTripDoc(materializeDoc(exp, rows, 'latest_updated_at')));
  const verdict = verifyDocument(ext, identityAdapter, exp, 'app_exact');
  assert.equal(verdict.pass, false);
  assert.ok(verdict.diffs.some((d) => d.type === 'hash_mismatch' && d.policy === 'app_exact' && d.key === canonicalStringify(key)));
});

// ---------------------------------------------------------------------------
// 9 — self-test harness detects all seven injections on fixture data
// ---------------------------------------------------------------------------

test('runSelfTest: 7/7 injections detected on fixture materializations', () => {
  const { checkpoint, survivorsFile } = fixtureCheckpointFiles();
  // add a divergent-key doc so the fixture satisfies all four self-test picks
  const winner = row('r-w', 'a-w', 'ink', 7, { fabricObject: { isPdfImported: true, pdfAnnotationId: 'DIV', v: 'winner' }, pageNumber: 7 });
  const loser = row('r-l', 'a-l', 'ink', 7, { fabricObject: { isPdfImported: true, pdfAnnotationId: 'DIV', v: 'loser' }, pageNumber: 7 });
  survivorsFile.survivors.push({
    key: [DOC, 7, 'DIV'],
    candidates: 2,
    app_exact: { id: winner.id, payload_sha256: payloadHash(winner, { excludeAnnotationId: true }) },
    latest_updated_at: { id: loser.id, payload_sha256: payloadHash(loser, { excludeAnnotationId: true }) },
    latest_created_at: { id: loser.id, payload_sha256: payloadHash(loser, { excludeAnnotationId: true }) },
    divergent: true,
  });
  const rows = new Map([...FULL_ROWS, [winner.id, winner], [loser.id, loser]]);
  const result = runSelfTest(buildExpectations(checkpoint, survivorsFile), rows);
  assert.equal(result.detections.length, 7);
  for (const d of result.detections) assert.equal(d.detected, true, `self-test missed: ${d.injection}`);
  assert.equal(result.pass, true);
});

// ---------------------------------------------------------------------------
// 10 — drift attribution
// ---------------------------------------------------------------------------

test('drift classification: post-cutoff updated_at is drift-explained; same-timestamp content change is unexplained; missing-id honors the probe', () => {
  assert.equal(classifyContentDiff({ updated_at: '2026-06-12T00:00:00+00:00' }, CUTOFF), 'drift_explained');
  assert.equal(classifyContentDiff({ updated_at: '2026-06-10T00:00:00+00:00' }, CUTOFF), 'unexplained');
  assert.equal(classifyContentDiff({ updated_at: null }, CUTOFF), 'unexplained');
  // probe found nothing → deleted post-baseline → drift-explained
  assert.equal(classifyMissingId(null, CUTOFF), 'drift_explained');
  // probe found a pre-cutoff row → OUR fetch dropped it → unexplained FAIL
  assert.equal(classifyMissingId({ id: 'x', created_at: '2026-06-01T00:00:00+00:00' }, CUTOFF), 'unexplained');
  // probe found a post-cutoff row (re-created id) → drift-explained
  assert.equal(classifyMissingId({ id: 'x', created_at: '2026-06-12T00:00:00+00:00' }, CUTOFF), 'drift_explained');
});

// ---------------------------------------------------------------------------
// 11 — pinned known-answer hash vector
// ---------------------------------------------------------------------------

test('pinned known-answer hash vector: scheme change in shared code breaks this literal', () => {
  const fixed = {
    id: 'row-id-excluded',
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-02T00:00:00+00:00',
    annotation_id: 'kept-for-user-drawn',
    document_id: 'doc-kav',
    page_number: 3,
    annotation_type: 'ink',
    user_id: 'user-kav',
    annotation_data: { clientSessionId: 'excluded', fabricObject: { stroke: '#00f', pdfAnnotationId: null }, pageNumber: 3 },
  };
  assert.equal(
    payloadHash(fixed),
    '700862f8c0b5230b570c696e8f082b0c568fc2de3eb6290eff9948633bf396fd',
  );
  assert.equal(
    payloadHash(fixed, { excludeAnnotationId: true }),
    '814e6b8c51f5c82bfac6b8e915cb813e91fa03e9531f86f09069d5dc4dcf2e1f',
  );
});

// ---------------------------------------------------------------------------
// 12 — integrity gate
// ---------------------------------------------------------------------------

test('integrity gate: refuses on sha256 mismatch and on hash_scheme drift; passes on exact match', () => {
  const good = JSON.stringify({ hash_scheme: HASH_SCHEME, marks: [] });
  const pins = { 'a.json': sha256Hex(good) };
  assert.throws(
    () => verifyCheckpointIntegrity({ 'a.json': good + ' ' }, pins),
    /sha256 .* != pinned/,
  );
  const wrongScheme = JSON.stringify({ hash_scheme: { ...HASH_SCHEME, algorithm: 'md5' } });
  assert.throws(
    () => verifyCheckpointIntegrity(
      { 'user_drawn_marks_checkpoint.json': wrongScheme },
      { 'user_drawn_marks_checkpoint.json': sha256Hex(wrongScheme) },
    ),
    /hash_scheme differs/,
  );
  assert.throws(() => verifyCheckpointIntegrity({}, pins), /missing baseline file/);
  // the real pins must verify the real committed files
  assert.equal(Object.keys(PINNED_BASELINE_SHA256).length, 3);
});

test('integrity gate verifies the real committed baseline files byte-exactly', { skip: ARTIFACT_SKIP }, async () => {
  const texts = {};
  for (const name of Object.keys(PINNED_BASELINE_SHA256)) {
    texts[name] = await readFile(`.planning/optimization/migration-baseline/${name}`, 'utf8');
  }
  const parsed = verifyCheckpointIntegrity(texts);
  assert.equal(parsed['user_drawn_marks_checkpoint.json'].count, 615);
  assert.equal(parsed['embedded_dedup_survivors.json'].count, 10960);
});

// ---------------------------------------------------------------------------
// 13 — write-leak gate
// ---------------------------------------------------------------------------

test('write-leak gate: every harness request is a body-less GET to a whitelisted /rest/v1/ table', async () => {
  const seen = [];
  const fakeFetch = async (reqUrl, init) => {
    seen.push({ url: String(reqUrl), method: init?.method, body: init?.body });
    return {
      status: 200,
      headers: { get: () => '0-0/0' },
      json: async () => [],
      text: async () => '',
    };
  };
  const roGet = makeRoGet('https://cvamwtpsuvxvjdnotbeg.supabase.co', 'k', fakeFetch);
  await roGet('document_annotations', 'select=id&limit=1');
  await assert.rejects(() => roGet('doc_yjs_state', 'select=*'), /not whitelisted/);
  for (const r of seen) {
    assert.equal(r.method, 'GET');
    assert.equal(r.body, undefined);
    assert.match(r.url, /^https:\/\/cvamwtpsuvxvjdnotbeg\.supabase\.co\/rest\/v1\/document_annotations\?/);
    assert.doesNotMatch(r.url, /\/rpc\//);
  }
});

test('write-leak gate: harness source has no direct fetch, no supabase-js, no /rpc/, no non-GET method', { skip: ARTIFACT_SKIP }, async () => {
  const src = await readFile('scripts/kal262-zero-loss-harness.mjs', 'utf8');
  assert.doesNotMatch(src, /supabase-js|createClient/);
  assert.doesNotMatch(src, /\/rpc\//);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /method:\s*['"](POST|PATCH|PUT|DELETE)/i);
  assert.doesNotMatch(src, /doc_yjs/);
});

// ---------------------------------------------------------------------------
// 14 — allowlist schema
// ---------------------------------------------------------------------------

function minimalVerdicts() {
  return {
    task: 'KAL-262',
    generated_at: 'x',
    baseline_generated_at: CUTOFF,
    cutoff: CUTOFF,
    host: 'h',
    live_snapshot: {
      total: 1, max_updated_at: 'x', baseline_total: 1, baseline_max_updated_at: 'x',
      matches: true, post_cutoff_count: 0, post_cutoff_count_method: 'exact_filtered_count',
    },
    anchoring: {
      user_drawn: { matched: 1, drift_explained_count: 0, unexplained_count: 0, drift_explained: [], unexplained: [] },
      embedded: { matched: 1, drift_explained_count: 0, unexplained_count: 0, drift_explained: [], unexplained: [] },
    },
    self_test: { pass: true, detections: [{ injection: 'x', expected_diff: 'hash_mismatch', detected: true }] },
    documents: [{
      document_id: DOC,
      user_drawn_expected: 1,
      embedded_expected: 1,
      policies: {
        app_exact: { pass: true, diff_count: 0, diffs: [] },
        latest_updated_at: { pass: true, diff_count: 0, diffs: [] },
        latest_created_at: { pass: true, diff_count: 0, diffs: [{ type: 'hash_mismatch', class: 'embedded', key: 'k', policy: 'latest_created_at', expected: 'a', observed: 'b' }] },
      },
    }],
    totals: {
      documents_verified: 1, user_drawn_expected: 1, user_drawn_verified: 1,
      survey_marker_verified: 0, callout_verified: 0, embedded_keys_expected: 1,
      policies_verified: 3, per_doc_count_cross_checks_pass: true,
    },
    exit_code: 0,
    verdict: 'PASS',
  };
}

test('allowlist schema: a conforming verdicts object passes; any out-of-schema key is rejected', () => {
  assert.doesNotThrow(() => assertVerdictsAllowlisted(minimalVerdicts()));
  const rogueTop = { ...minimalVerdicts(), annotation_data: {} };
  assert.throws(() => assertVerdictsAllowlisted(rogueTop), /unexpected key "annotation_data"/);
  const rogueDiff = minimalVerdicts();
  rogueDiff.documents[0].policies.app_exact.diffs.push({ type: 'hash_mismatch', payload: { raw: true } });
  assert.throws(() => assertVerdictsAllowlisted(rogueDiff), /unexpected key "payload"/);
  const roguePolicy = minimalVerdicts();
  roguePolicy.documents[0].policies.sneaky = { pass: true, diff_count: 0, diffs: [] };
  assert.throws(() => assertVerdictsAllowlisted(roguePolicy), /unexpected policy "sneaky"/);
});

// ---------------------------------------------------------------------------
// 15 — exit-code precedence (FAIL beats DRIFT beats PASS) + stale-baseline guard
// ---------------------------------------------------------------------------

test('exit precedence: FAIL(1) beats DRIFT(2) beats PASS(0); any table movement blocks exit 0', () => {
  const base = { selfTestPass: true, anyUnexplained: false, anyVerifyFail: false, tableMoved: false };
  assert.equal(aggregateExitCode(base), 0);
  assert.equal(aggregateExitCode({ ...base, tableMoved: true }), 2);
  assert.equal(aggregateExitCode({ ...base, anyVerifyFail: true }), 1);
  assert.equal(aggregateExitCode({ ...base, anyUnexplained: true }), 1);
  assert.equal(aggregateExitCode({ ...base, selfTestPass: false }), 1);
  // FAIL wins even when the table also moved
  assert.equal(aggregateExitCode({ ...base, tableMoved: true, anyUnexplained: true }), 1);
  assert.equal(aggregateExitCode({ ...base, tableMoved: true, selfTestPass: false }), 1);
});

test('POLICIES covers exactly the three baseline survivor policies', () => {
  assert.deepEqual(POLICIES, ['app_exact', 'latest_updated_at', 'latest_created_at']);
});

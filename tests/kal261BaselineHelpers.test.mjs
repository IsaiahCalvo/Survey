// KAL-261 baseline script — unit tests for the pure helpers.
// These are the targeted gates from PLAN-KAL261.md (Codex-approved r3):
// canonical hash vector, GET/table whitelist, classification truth table,
// effective-page pinning, survivor determinism, drift detection, leak guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_TABLES,
  PROD_HOST,
  assertNoLeaks,
  canonicalStringify,
  classifyImportFlag,
  driftChanged,
  makeRoGet,
  normalizeRowForHash,
  payloadHash,
  pickSurvivors,
  resolveEffectivePage,
  sha256Hex,
} from '../scripts/kal261-baseline-dedup-preview.mjs';

const PROD_URL = `https://${PROD_HOST}`;

test('canonicalStringify sorts keys recursively and omits undefined', () => {
  assert.equal(
    canonicalStringify({ b: 1, a: [1, { d: 2, c: 3 }], skip: undefined }),
    '{"a":[1,{"c":3,"d":2}],"b":1}',
  );
  assert.equal(canonicalStringify(null), 'null');
  assert.equal(canonicalStringify([undefined, 1]), '[null,1]');
});

test('sha256Hex matches the published test vector for "abc"', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('normalizeRowForHash: bookkeeping excluded, nested ids preserved, input not mutated', () => {
  const row = {
    id: 'pk', created_at: 't1', updated_at: 't2', annotation_id: 'a1',
    document_id: 'd1', user_id: 'u1', bounds: { x: 1 }, name: 'n',
    annotation_data: { clientSessionId: 'volatile', pageNumber: 2, fabricObject: { id: 'f1', data: { id: 'nested' } } },
  };
  const norm = normalizeRowForHash(row);
  assert.equal(norm.id, undefined);
  assert.equal(norm.created_at, undefined);
  assert.equal(norm.updated_at, undefined);
  assert.equal(norm.annotation_id, 'a1'); // user-drawn keeps annotation_id
  assert.equal(norm.annotation_data.clientSessionId, undefined);
  assert.equal(norm.annotation_data.fabricObject.data.id, 'nested'); // nested ids inside the hash
  assert.equal(row.annotation_data.clientSessionId, 'volatile'); // no mutation

  const embedded = normalizeRowForHash(row, { excludeAnnotationId: true });
  assert.equal(embedded.annotation_id, undefined);

  // class domains differ -> hashes differ
  assert.notEqual(payloadHash(row), payloadHash(row, { excludeAnnotationId: true }));
  // clientSessionId is outside the hash domain
  const row2 = { ...row, annotation_data: { ...row.annotation_data, clientSessionId: 'other' } };
  assert.equal(payloadHash(row), payloadHash(row2));
});

test('classifyImportFlag truth table (strict booleans only)', () => {
  assert.deepEqual(classifyImportFlag(true), { embedded: true, anomaly: null });
  assert.deepEqual(classifyImportFlag(false), { embedded: false, anomaly: null });
  assert.deepEqual(classifyImportFlag(null), { embedded: false, anomaly: null });
  assert.deepEqual(classifyImportFlag(undefined), { embedded: false, anomaly: null });
  for (const weird of ['true', 'false', 1, 0, 'yes', {}]) {
    const r = classifyImportFlag(weird);
    assert.equal(r.embedded, false);
    assert.equal(r.anomaly, 'import_flag_non_boolean');
  }
});

test('resolveEffectivePage pins to integers, flags mismatches and invalid values', () => {
  assert.deepEqual(resolveEffectivePage(5, 5), { page: 5, flags: [] });
  assert.deepEqual(resolveEffectivePage(5, 3), { page: 5, flags: ['page_mismatch'] }); // data wins (app semantics)
  assert.deepEqual(resolveEffectivePage(null, 3), { page: 3, flags: [] });
  assert.deepEqual(resolveEffectivePage(undefined, 3), { page: 3, flags: [] });
  assert.deepEqual(resolveEffectivePage('5', 3), { page: 3, flags: ['page_invalid'] }); // string number -> anomaly, fallback
  assert.deepEqual(resolveEffectivePage(2.5, 3), { page: 3, flags: ['page_invalid'] });
  assert.deepEqual(resolveEffectivePage(null, null), { page: null, flags: ['page_unresolvable'] });
});

test('pickSurvivors: three policies, app_exact prefers non-survey-marker, deterministic ties', () => {
  const mk = (id, type, created, updated) => ({ id, annotation_type: type, created_at: created, updated_at: updated });

  // Newer survey-marker row loses to older path row under app_exact only.
  const a = mk('a', 'path', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  const b = mk('b', 'survey-marker', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
  const r1 = pickSurvivors([a, b]);
  assert.equal(r1.app_exact, 'a');
  assert.equal(r1.latest_updated_at, 'b');
  assert.equal(r1.latest_created_at, 'b');
  assert.equal(r1.divergent, true);

  // legacy 'highlight' counts as survey-marker
  const r1b = pickSurvivors([a, mk('z', 'highlight', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')]);
  assert.equal(r1b.app_exact, 'a');

  // created_at vs updated_at divergence
  const c = mk('c', 'path', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'); // created latest
  const d = mk('d', 'path', '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'); // updated latest
  const r2 = pickSurvivors([c, d]);
  assert.equal(r2.latest_created_at, 'c');
  assert.equal(r2.latest_updated_at, 'd');
  assert.equal(r2.divergent, true);

  // exact timestamp tie -> deterministic regardless of input order
  const e = mk('e', 'path', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  const f = mk('f', 'path', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  const t1 = pickSurvivors([e, f]);
  const t2 = pickSurvivors([f, e]);
  assert.deepEqual(t1, t2);
  assert.equal(t1.latest_updated_at, 'f'); // PK-desc tie-break
  assert.equal(t1.app_exact, 'f'); // PK-asc fold + >= keeps later candidate

  // missing timestamps don't crash and stay deterministic
  const g = mk('g', 'path', null, null);
  const h = mk('h', 'path', '2026-01-01T00:00:00Z', null);
  assert.equal(pickSurvivors([g, h]).latest_updated_at, 'h');
  assert.deepEqual(pickSurvivors([g, h]), pickSurvivors([h, g]));
});

test('makeRoGet: host pin, table whitelist, GET-only, no body', async () => {
  assert.throws(() => makeRoGet('https://evil.supabase.co', 'k'), /pinned production host/);
  assert.throws(() => makeRoGet('https://zgdkyslxbkusexmkfvgd.supabase.co', 'k'), /pinned production host/); // even the test project

  const calls = [];
  const fakeFetch = async (reqUrl, opts) => {
    calls.push({ reqUrl, opts });
    return { status: 200, headers: { get: () => '0-0/1' }, json: async () => [], text: async () => '' };
  };
  const roGet = makeRoGet(PROD_URL, 'svc-key', fakeFetch);

  await roGet('documents', 'select=id&limit=1');
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].opts.body, undefined);
  assert.match(calls[0].reqUrl, /^https:\/\/cvamwtpsuvxvjdnotbeg\.supabase\.co\/rest\/v1\/documents\?/);

  await assert.rejects(() => roGet('doc_yjs_state', 'select=*'), /not whitelisted/);
  await assert.rejects(() => roGet('rpc/anything', 'x=1'), /not whitelisted/);
  await assert.rejects(() => roGet('document_annotations?x=1#', ''), /not whitelisted/);
  assert.deepEqual([...ALLOWED_TABLES].sort(), ['document_annotations', 'documents']);
});

test('driftChanged detects count and max-updated_at movement', () => {
  const base = { total: 10, maxUpdatedAt: 't1' };
  assert.equal(driftChanged(base, { total: 10, maxUpdatedAt: 't1' }), false);
  assert.equal(driftChanged(base, { total: 11, maxUpdatedAt: 't1' }), true); // insert/delete
  assert.equal(driftChanged(base, { total: 10, maxUpdatedAt: 't2' }), true); // update
});

test('assertNoLeaks: structural key check with hash_scheme exemption + secret scan', () => {
  // clean checkpoint shape passes even though hash_scheme TEXT mentions payload fields
  assert.doesNotThrow(() => assertNoLeaks({
    hash_scheme: { excluded_nested: ['annotation_data.clientSessionId'], note: 'fabricObject ids preserved' },
    marks: [{ id: 'x', payload_sha256: 'deadbeef' }],
  }));
  // raw payload key in an entry fails
  assert.throws(
    () => assertNoLeaks({ marks: [{ id: 'x', annotation_data: { a: 1 } }] }),
    /forbidden key "annotation_data"/,
  );
  assert.throws(
    () => assertNoLeaks({ docs: [{ bounds: {} }] }),
    /forbidden key "bounds"/,
  );
  // secret-shaped strings fail anywhere
  assert.throws(
    () => assertNoLeaks({ run: { key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' } }),
    /secret-shaped string/,
  );
});

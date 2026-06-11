#!/usr/bin/env node
// KAL-262 — Zero-loss verification harness (DRY-RUN, NO WRITES).
// PRE-REBUILD-READINESS.md §2.6 + §4 Step 5, Gate B4.
//
// Consumes the KAL-261 committed checkpoints (sha256-pinned below), re-pulls
// the SAME row universe from production (GET-only, cutoff pinned to the
// baseline's generated_at), recomputes dedup + hashes with the generator's own
// code, materializes per-document Y.Docs purely IN MEMORY (all three survivor
// policies), round-trips them through encodeStateAsUpdate/applyUpdate, and
// verifies the extracted maps against the committed checkpoint hashes.
//
// Safety invariants (Codex-reviewed plan PLAN-KAL262.md, approved r3):
//   - zero writes: every network call goes through KAL-261's GET-only request
//     helper (table whitelist, host pin); this module makes no direct network
//     calls, imports no DB client library, and never touches RPC endpoints or
//     the Yjs state tables. (A source-scan unit test enforces the tokens.)
//   - exit 0 is only possible if the live table still IS the baseline
//     (snapshot match + zero post-cutoff rows + zero diffs). Precedence:
//     FAIL (1) beats DRIFT (2) beats PASS (0).
//   - every baseline-vs-fresh difference must be POSITIVELY attributed
//     (post-cutoff updated_at, or a by-id probe proving deletion) or it is an
//     UNEXPLAINED FAIL — drift can never mask data loss.
//   - the verifier must prove it can fail: a 7-injection negative self-test
//     runs against real materializations every run; any missed detection
//     invalidates the whole run.
//   - committed outputs are allowlist-schema'd, leak-guarded, and written
//     temp-then-rename so a failed run never clobbers prior outputs.
//
// Pure helpers are exported for tests/kal262ZeroLossHarness.test.mjs.

import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Y from 'yjs';
import { loadEnv } from '../agent-cli/lib/env.mjs';
import {
  HASH_SCHEME,
  OUT_DIR,
  PROD_HOST,
  aggregate,
  assertNoLeaks,
  canonicalStringify,
  fetchAllPass1,
  fetchFullRowsByIds,
  makeRoGet,
  normalizeRowForHash,
  payloadHash,
  pickSurvivors,
  sha256Hex,
  snapshotTable,
} from './kal261-baseline-dedup-preview.mjs';

export const POLICIES = ['app_exact', 'latest_updated_at', 'latest_created_at'];

// Pinned integrity anchors for the consumed baseline files (literals from
// KAL-261-BASELINE-REPORT.md "Output integrity"). Reading these from
// migration_baseline.json would let a tampered baseline self-certify.
// If KAL-261 is legitimately re-run, update these three literals deliberately.
export const PINNED_BASELINE_SHA256 = {
  'user_drawn_marks_checkpoint.json': 'f486c4de5adf6e6b938f3b168d7f0a3b06366c33ddb47c3bc748a7256cae8d2f',
  'embedded_dedup_survivors.json': 'b022cf128c7b9e2cad658abd3c67d63d6f107ec57f64bb18a765618b8d782f84',
  'migration_baseline.json': '4673619ca2cd62a0ff62e730639d55d0c7125492e4f74e06b6b63a030a49d57e',
};

// ---------------------------------------------------------------------------
// Phase A — checkpoint integrity gate (pure core)
// ---------------------------------------------------------------------------

export function verifyCheckpointIntegrity(fileTexts, pinned = PINNED_BASELINE_SHA256) {
  for (const [name, expected] of Object.entries(pinned)) {
    const text = fileTexts[name];
    if (typeof text !== 'string') throw new Error(`integrity gate: missing baseline file ${name}`);
    const observed = sha256Hex(text);
    if (observed !== expected) {
      throw new Error(`integrity gate: ${name} sha256 ${observed} != pinned ${expected} — baseline tampered or regenerated; refusing to run (update pins only via a deliberate re-baseline)`);
    }
  }
  const parsed = Object.fromEntries(Object.entries(fileTexts).map(([k, v]) => [k, JSON.parse(v)]));
  for (const name of ['user_drawn_marks_checkpoint.json', 'embedded_dedup_survivors.json']) {
    if (canonicalStringify(parsed[name].hash_scheme) !== canonicalStringify(HASH_SCHEME)) {
      throw new Error(`integrity gate: ${name} hash_scheme differs from the shared HASH_SCHEME constant — scheme drift`);
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Expectations (from the committed checkpoints, the verification authority)
// ---------------------------------------------------------------------------

// Map document_id -> {
//   userDrawn: [{ id, annotation_id, annotation_type, payload_sha256 }],
//   embedded:  Map canonicalKey -> { key_tuple, perPolicy: { policy: { id, payload_sha256 } } },
// }
export function buildExpectations(checkpoint, survivorsFile) {
  const docs = new Map();
  const docOf = (docId) => docs.get(docId) ?? docs.set(docId, { userDrawn: [], embedded: new Map() }).get(docId);
  for (const m of checkpoint.marks) {
    docOf(m.document_id).userDrawn.push({
      id: m.id,
      annotation_id: m.annotation_id,
      annotation_type: m.annotation_type,
      payload_sha256: m.payload_sha256,
    });
  }
  for (const s of survivorsFile.survivors) {
    const docId = s.key[0];
    const perPolicy = {};
    for (const p of POLICIES) perPolicy[p] = { id: s[p].id, payload_sha256: s[p].payload_sha256 };
    docOf(docId).embedded.set(canonicalStringify(s.key), { key_tuple: s.key, perPolicy });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Phases E/F — materialize, round-trip, verify (pure given rows)
// ---------------------------------------------------------------------------

export function isCalloutType(annotationType) {
  return annotationType === 'callout';
}

// Value = the full normalized DB row (the hash domain object). User-drawn keep
// annotation_id inside (default normalization); embedded survivors use the
// scheme's class-specific domain (excludeAnnotationId). PLAN-KAL262 r2: this is
// the only shape that can satisfy zero-loss; the app-bridge shape gap is
// REPORTED, not resolved here.
export function materializeDoc(docExp, fullRowsById, policy) {
  const doc = new Y.Doc();
  const annotations = doc.getMap('annotations');
  const callouts = doc.getMap('callouts');
  for (const m of docExp.userDrawn) {
    const row = fullRowsById.get(m.id);
    if (!row) throw new Error(`materialize: full row missing for user-drawn ${m.id}`);
    const target = isCalloutType(m.annotation_type) ? callouts : annotations;
    target.set(m.annotation_id, normalizeRowForHash(row));
  }
  for (const e of docExp.embedded.values()) {
    const pick = e.perPolicy[policy];
    const row = fullRowsById.get(pick.id);
    if (!row) throw new Error(`materialize: full row missing for embedded survivor ${pick.id}`);
    annotations.set(canonicalStringify(e.key_tuple), normalizeRowForHash(row, { excludeAnnotationId: true }));
  }
  return doc;
}

export function roundTripDoc(doc) {
  const update = Y.encodeStateAsUpdate(doc);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, update);
  return fresh;
}

export function extractMaps(doc) {
  return {
    annotations: doc.getMap('annotations').toJSON(),
    callouts: doc.getMap('callouts').toJSON(),
  };
}

// Entry adapter for THIS dry-run's shape: the stored value IS the hashable
// normalized row. Returns null for anything unreconstructable (e.g. a
// bridge-shaped {id,type,fabric,meta} stub) — Step 5 swaps this adapter for
// whatever shape KAL-266 finalizes.
export function identityAdapter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!('annotation_data' in value) || !('document_id' in value)) return null;
  return value;
}

// The §2.6 verifier core. Shape-agnostic via `adapter`; never throws on a
// mismatch — accumulates typed diffs (ids/keys/hashes only, never payloads).
export function verifyDocument(extracted, adapter, docExp, policy) {
  const diffs = [];
  const consumed = new Set();
  const tag = (mapName, key) => `${mapName}\u0000${key}`;
  const entry = (mapName, key) => (extracted[mapName] ?? {})[key];

  const userDrawnNonCalloutIds = new Set();
  for (const m of docExp.userDrawn) {
    const wantMap = isCalloutType(m.annotation_type) ? 'callouts' : 'annotations';
    if (wantMap === 'annotations') userDrawnNonCalloutIds.add(m.annotation_id);
    const otherMap = wantMap === 'callouts' ? 'annotations' : 'callouts';
    let value = entry(wantMap, m.annotation_id);
    if (value === undefined) {
      if (entry(otherMap, m.annotation_id) !== undefined) {
        diffs.push({ type: 'wrong_map', class: 'user_drawn', key: m.annotation_id, expected: wantMap, observed: otherMap });
        consumed.add(tag(otherMap, m.annotation_id));
      } else {
        diffs.push({ type: 'missing_mark', class: 'user_drawn', key: m.annotation_id });
      }
      continue;
    }
    consumed.add(tag(wantMap, m.annotation_id));
    const row = adapter(value);
    if (row === null) {
      diffs.push({ type: 'unreconstructable_entry', class: 'user_drawn', key: m.annotation_id });
      continue;
    }
    const observed = sha256Hex(canonicalStringify(row));
    if (observed !== m.payload_sha256) {
      diffs.push({ type: 'hash_mismatch', class: 'user_drawn', key: m.annotation_id, expected: m.payload_sha256, observed });
    }
  }

  for (const [canonicalKey, e] of docExp.embedded) {
    const value = entry('annotations', canonicalKey);
    if (value === undefined) {
      diffs.push({ type: 'missing_embedded_key', class: 'embedded', key: canonicalKey });
      continue;
    }
    consumed.add(tag('annotations', canonicalKey));
    const row = adapter(value);
    if (row === null) {
      diffs.push({ type: 'unreconstructable_entry', class: 'embedded', key: canonicalKey });
      continue;
    }
    const pick = e.perPolicy[policy];
    const observed = sha256Hex(canonicalStringify(row));
    if (observed !== pick.payload_sha256) {
      diffs.push({ type: 'hash_mismatch', class: 'embedded', key: canonicalKey, policy, expected: pick.payload_sha256, observed });
    }
  }

  for (const mapName of ['annotations', 'callouts']) {
    for (const key of Object.keys(extracted[mapName] ?? {})) {
      if (!consumed.has(tag(mapName, key))) diffs.push({ type: 'extra_key', map: mapName, key });
    }
  }

  // Explicit count assert (ticket clause b): embedded entries observed in the
  // annotations map = annotations keys that are not expected user-drawn ids.
  const observedEmbedded = Object.keys(extracted.annotations ?? {})
    .filter((k) => !userDrawnNonCalloutIds.has(k)).length;
  if (observedEmbedded !== docExp.embedded.size) {
    diffs.push({ type: 'count_mismatch', class: 'embedded', expected: docExp.embedded.size, observed: observedEmbedded });
  }

  return { pass: diffs.length === 0, diffs };
}

// ---------------------------------------------------------------------------
// Phase G — negative self-test (the verifier must be able to fail)
// ---------------------------------------------------------------------------

const clone = (v) => JSON.parse(JSON.stringify(v));

export function runSelfTest(docExpByDoc, fullRowsById) {
  const detections = [];
  const expect = (label, injected, docExp, policy, wantType) => {
    const verdict = verifyDocument(injected, identityAdapter, docExp, policy);
    const hit = !verdict.pass && verdict.diffs.some((d) => d.type === wantType);
    detections.push({ injection: label, expected_diff: wantType, detected: hit });
  };

  const pickDoc = (pred) => {
    for (const [docId, exp] of docExpByDoc) if (pred(exp)) return [docId, exp];
    return [null, null];
  };
  const [, smDoc] = pickDoc((e) => e.userDrawn.some((m) => m.annotation_type === 'survey-marker'));
  const [, coDoc] = pickDoc((e) => e.userDrawn.some((m) => isCalloutType(m.annotation_type)));
  const [, emDoc] = pickDoc((e) => e.embedded.size > 0);
  const [, dvDoc] = pickDoc((e) => {
    for (const s of e.embedded.values()) {
      if (new Set(POLICIES.map((p) => s.perPolicy[p].id)).size > 1) return true;
    }
    return false;
  });
  if (!smDoc || !coDoc || !emDoc || !dvDoc) {
    throw new Error('self-test: could not find fixture documents (survey-marker / callout / embedded / divergent-key)');
  }

  const extractedOf = (exp, policy) => extractMaps(roundTripDoc(materializeDoc(exp, fullRowsById, policy)));

  // (i) tampered nested payload field — on a survey-marker doc, tamper a
  // survey-marker mark specifically (the type the live fan-out excludes).
  {
    const ext = clone(extractedOf(smDoc, 'app_exact'));
    const sm = smDoc.userDrawn.find((m) => m.annotation_type === 'survey-marker');
    ext.annotations[sm.annotation_id].annotation_data = { ...ext.annotations[sm.annotation_id].annotation_data, __tampered: true };
    expect('tampered survey-marker payload field', ext, smDoc, 'app_exact', 'hash_mismatch');
  }
  // (ii) deleted user-drawn mark
  {
    const ext = clone(extractedOf(smDoc, 'app_exact'));
    delete ext.annotations[smDoc.userDrawn.find((m) => !isCalloutType(m.annotation_type)).annotation_id];
    expect('deleted user-drawn mark', ext, smDoc, 'app_exact', 'missing_mark');
  }
  // (iii) deleted embedded key
  {
    const ext = clone(extractedOf(emDoc, 'app_exact'));
    delete ext.annotations[emDoc.embedded.keys().next().value];
    expect('deleted embedded key', ext, emDoc, 'app_exact', 'missing_embedded_key');
  }
  // (iv) extra embedded key
  {
    const ext = clone(extractedOf(emDoc, 'app_exact'));
    ext.annotations['["injected-extra-key",1,"FAKE"]'] = clone(Object.values(ext.annotations)[0]);
    expect('extra embedded key', ext, emDoc, 'app_exact', 'extra_key');
  }
  // (v) callout moved to the wrong map
  {
    const ext = clone(extractedOf(coDoc, 'app_exact'));
    const co = coDoc.userDrawn.find((m) => isCalloutType(m.annotation_type));
    ext.annotations[co.annotation_id] = ext.callouts[co.annotation_id];
    delete ext.callouts[co.annotation_id];
    expect('callout in wrong map', ext, coDoc, 'app_exact', 'wrong_map');
  }
  // (vi) divergent key carrying a LOSING candidate's payload (wrong survivor)
  {
    let divKey = null;
    let losingPolicy = null;
    for (const [k, s] of dvDoc.embedded) {
      const ids = POLICIES.map((p) => s.perPolicy[p].id);
      if (new Set(ids).size > 1) {
        divKey = k;
        losingPolicy = POLICIES.find((p) => s.perPolicy[p].id !== s.perPolicy.app_exact.id);
        break;
      }
    }
    // materialize under the losing policy, verify under app_exact: the
    // divergent key carries the wrong survivor's payload.
    const ext = extractedOf(dvDoc, losingPolicy);
    const verdict = verifyDocument(ext, identityAdapter, dvDoc, 'app_exact');
    const hit = !verdict.pass && verdict.diffs.some((d) => d.type === 'hash_mismatch' && d.key === divKey);
    detections.push({ injection: 'wrong survivor on divergent key', expected_diff: 'hash_mismatch', detected: hit });
  }
  // (vii) bridge-shaped stub the adapter cannot reconstruct
  {
    const ext = clone(extractedOf(smDoc, 'app_exact'));
    const anyKey = Object.keys(ext.annotations)[0];
    ext.annotations[anyKey] = { id: anyKey, type: 'path', pageNumber: 1, fabric: {}, meta: {} };
    expect('bridge-shaped stub entry', ext, smDoc, 'app_exact', 'unreconstructable_entry');
  }

  return { pass: detections.every((d) => d.detected), detections };
}

// ---------------------------------------------------------------------------
// Phase D — baseline anchoring with positive drift attribution
// ---------------------------------------------------------------------------

// Classify a hash/content difference on a row that exists in both pulls.
export function classifyContentDiff(freshRow, cutoffISO) {
  const u = Date.parse(freshRow?.updated_at ?? '');
  return Number.isFinite(u) && u > Date.parse(cutoffISO) ? 'drift_explained' : 'unexplained';
}

// Classify a baseline id missing from the fresh pull, given the by-id probe
// result (probeRow = row object or null when the GET returned nothing).
export function classifyMissingId(probeRow, cutoffISO) {
  if (!probeRow) return 'drift_explained'; // deleted after the baseline
  const c = Date.parse(probeRow.created_at ?? '');
  if (Number.isFinite(c) && c <= Date.parse(cutoffISO)) return 'unexplained'; // our fetch dropped it
  return 'drift_explained';
}

export async function anchorUserDrawn({ checkpoint, freshUserDrawn, freshHashById, freshRowsById, probeById, cutoff }) {
  const out = { matched: 0, drift_explained: [], unexplained: [] };
  const freshById = new Map(freshUserDrawn.map((r) => [r.id, r]));
  for (const m of checkpoint.marks) {
    const fresh = freshById.get(m.id);
    if (!fresh) {
      const probe = await probeById(m.id);
      const cls = classifyMissingId(probe, cutoff);
      out[cls === 'unexplained' ? 'unexplained' : 'drift_explained'].push({ type: 'missing_from_fresh', class: 'user_drawn', key: m.id });
      continue;
    }
    const observed = freshHashById.get(m.id);
    if (observed !== m.payload_sha256) {
      const cls = classifyContentDiff(freshRowsById.get(m.id), cutoff);
      out[cls === 'unexplained' ? 'unexplained' : 'drift_explained'].push({
        type: 'hash_mismatch', class: 'user_drawn', key: m.id, expected: m.payload_sha256, observed,
      });
      continue;
    }
    out.matched += 1;
  }
  const baselineIds = new Set(checkpoint.marks.map((m) => m.id));
  for (const r of freshUserDrawn) {
    if (!baselineIds.has(r.id)) {
      // In the pinned universe (created_at <= cutoff) a fresh-only user-drawn id
      // means the baseline missed it OR a post-cutoff edit reclassified the row
      // (e.g. import flag changed). Attribute like any content diff.
      const cls = classifyContentDiff(freshRowsById.get(r.id) ?? r, cutoff);
      out[cls === 'unexplained' ? 'unexplained' : 'drift_explained'].push({ type: 'absent_from_baseline', class: 'user_drawn', key: r.id });
    }
  }
  return out;
}

export async function anchorSurvivors({ survivorsFile, freshSurvivors, freshHashById, freshRowsById, probeById, cutoff }) {
  const out = { matched: 0, drift_explained: [], unexplained: [] };
  const freshByKey = new Map(freshSurvivors.map((s) => [canonicalStringify(s.key), s]));
  for (const b of survivorsFile.survivors) {
    const k = canonicalStringify(b.key);
    const fresh = freshByKey.get(k);
    if (!fresh) {
      const probe = await probeById(b.app_exact.id);
      const cls = classifyMissingId(probe, cutoff);
      out[cls === 'unexplained' ? 'unexplained' : 'drift_explained'].push({ type: 'missing_from_fresh', class: 'embedded', key: k });
      continue;
    }
    let keyOk = true;
    for (const p of POLICIES) {
      const bp = b[p];
      const fp = fresh.picks[p];
      const observedHash = freshHashById.get(fp.id);
      if (fp.id === bp.id && observedHash === bp.payload_sha256) continue;
      keyOk = false;
      let cls;
      if (fp.id !== bp.id) {
        // survivor identity changed: post-cutoff touch on the new pick, or the
        // old pick was deleted — both drift; anything else unexplained.
        if (classifyContentDiff(freshRowsById.get(fp.id), cutoff) === 'drift_explained') cls = 'drift_explained';
        else cls = classifyMissingId(await probeById(bp.id), cutoff) === 'drift_explained' ? 'drift_explained' : 'unexplained';
      } else {
        cls = classifyContentDiff(freshRowsById.get(fp.id), cutoff);
      }
      out[cls === 'unexplained' ? 'unexplained' : 'drift_explained'].push({
        type: fp.id !== bp.id ? 'survivor_changed' : 'hash_mismatch',
        class: 'embedded', key: k, policy: p, expected: bp.payload_sha256, observed: observedHash ?? null,
      });
    }
    if (keyOk) out.matched += 1;
  }
  const baselineKeys = new Set(survivorsFile.survivors.map((b) => canonicalStringify(b.key)));
  for (const s of freshSurvivors) {
    const k = canonicalStringify(s.key);
    if (!baselineKeys.has(k)) {
      const cls = classifyContentDiff(freshRowsById.get(s.picks.app_exact.id), cutoff);
      out[cls === 'unexplained' ? 'unexplained' : 'drift_explained'].push({ type: 'absent_from_baseline', class: 'embedded', key: k });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase H — verdict aggregation, allowlist schema, atomic outputs
// ---------------------------------------------------------------------------

// FAIL (1) beats DRIFT (2) beats PASS (0).
export function aggregateExitCode({ selfTestPass, anyUnexplained, anyVerifyFail, tableMoved }) {
  if (!selfTestPass || anyUnexplained || anyVerifyFail) return 1;
  if (tableMoved) return 2;
  return 0;
}

// Strict allowlist schema for the committed verdicts JSON: every object key
// must be declared here; the writer throws on anything else (belt) and the
// KAL-261 structural blacklist guard runs on top (suspenders).
const DIFF_KEYS = new Set(['type', 'class', 'key', 'map', 'policy', 'expected', 'observed']);
export const VERDICTS_SCHEMA = {
  root: new Set(['task', 'generated_at', 'baseline_generated_at', 'cutoff', 'host', 'live_snapshot',
    'anchoring', 'self_test', 'documents', 'totals', 'exit_code', 'verdict']),
  live_snapshot: new Set(['total', 'max_updated_at', 'baseline_total', 'baseline_max_updated_at', 'matches',
    'post_cutoff_count', 'post_cutoff_count_method']),
  anchoring: new Set(['user_drawn', 'embedded']),
  'anchoring.user_drawn': new Set(['matched', 'drift_explained_count', 'unexplained_count', 'drift_explained', 'unexplained']),
  'anchoring.embedded': new Set(['matched', 'drift_explained_count', 'unexplained_count', 'drift_explained', 'unexplained']),
  self_test: new Set(['pass', 'detections']),
  'self_test.detections[]': new Set(['injection', 'expected_diff', 'detected']),
  'documents[]': new Set(['document_id', 'user_drawn_expected', 'embedded_expected', 'policies']),
  'documents[].policies{}': new Set(['pass', 'diff_count', 'diffs']),
  diff: DIFF_KEYS,
  totals: new Set(['documents_verified', 'user_drawn_expected', 'user_drawn_verified',
    'survey_marker_verified', 'callout_verified', 'embedded_keys_expected', 'policies_verified',
    'per_doc_count_cross_checks_pass']),
};

export function assertVerdictsAllowlisted(verdicts) {
  const S = VERDICTS_SCHEMA;
  const checkKeys = (obj, allowed, where) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`verdicts allowlist: expected object at ${where}`);
    }
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k)) throw new Error(`verdicts allowlist: unexpected key "${k}" at ${where}`);
    }
  };
  const checkDiffs = (arr, where) => {
    for (const d of arr) checkKeys(d, DIFF_KEYS, where);
  };
  checkKeys(verdicts, S.root, '$');
  checkKeys(verdicts.live_snapshot, S.live_snapshot, 'live_snapshot');
  checkKeys(verdicts.anchoring, S.anchoring, 'anchoring');
  for (const cls of ['user_drawn', 'embedded']) {
    const a = verdicts.anchoring[cls];
    checkKeys(a, S['anchoring.user_drawn'], `anchoring.${cls}`);
    checkDiffs(a.drift_explained, `anchoring.${cls}.drift_explained`);
    checkDiffs(a.unexplained, `anchoring.${cls}.unexplained`);
  }
  checkKeys(verdicts.self_test, S.self_test, 'self_test');
  for (const d of verdicts.self_test.detections) checkKeys(d, S['self_test.detections[]'], 'self_test.detections[]');
  for (const doc of verdicts.documents) {
    checkKeys(doc, S['documents[]'], 'documents[]');
    for (const [p, v] of Object.entries(doc.policies)) {
      if (!POLICIES.includes(p)) throw new Error(`verdicts allowlist: unexpected policy "${p}"`);
      checkKeys(v, S['documents[].policies{}'], 'documents[].policies');
      checkDiffs(v.diffs, 'documents[].policies.diffs');
    }
  }
  checkKeys(verdicts.totals, S.totals, 'totals');
}

export async function writeAtomically(path, text, validateParsed) {
  const tmp = `${path}.tmp-kal262`;
  await writeFile(tmp, text);
  try {
    validateParsed?.(JSON.parse(await readFile(tmp, 'utf8')));
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

async function fetchPostCutoffCount(roGet, cutoff, liveTotal, pinnedUniverseCount) {
  try {
    const res = await roGet(
      'document_annotations',
      `select=id&created_at=gt.${encodeURIComponent(cutoff)}&limit=1`,
      { prefer: 'count=exact' },
    );
    const total = Number.parseInt(String(res.contentRange).split('/')[1], 10);
    if (Number.isFinite(total)) return { count: total, method: 'exact_filtered_count' };
  } catch (err) {
    console.warn(`[kal262] filtered post-cutoff count failed (${err.message}) — falling back to subtraction`);
  }
  return { count: Math.max(0, liveTotal - pinnedUniverseCount), method: 'live_total_minus_pinned_universe' };
}

async function main() {
  loadEnv();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('missing Supabase URL or service key in .env/.env.local');
  // Exact https origin (host pin alone would admit http://)
  const origin = new URL(url).origin;
  if (origin !== `https://${PROD_HOST}`) {
    throw new Error(`refusing to run: origin "${origin}" is not https://${PROD_HOST}`);
  }
  const roGet = makeRoGet(url, key);
  const probeById = async (id) => {
    const { rows } = await roGet('document_annotations', `select=id,created_at,updated_at&id=eq.${encodeURIComponent(id)}`);
    return rows[0] ?? null;
  };

  // ---- Phase A — integrity gate
  const fileTexts = {};
  for (const name of Object.keys(PINNED_BASELINE_SHA256)) {
    fileTexts[name] = await readFile(join(OUT_DIR, name), 'utf8');
  }
  const baselineFiles = verifyCheckpointIntegrity(fileTexts);
  const checkpoint = baselineFiles['user_drawn_marks_checkpoint.json'];
  const survivorsFile = baselineFiles['embedded_dedup_survivors.json'];
  const migrationBaseline = baselineFiles['migration_baseline.json'];
  const cutoff = migrationBaseline.generated_at;
  console.log(`[kal262] integrity gate PASSED; cutoff pinned to baseline ${cutoff}`);

  // ---- Phase B — fresh read-only pull of the pinned universe
  const liveSnapshot = await snapshotTable(roGet);
  const runStats = { cutoff, attempt: 1, page_batches: [] };
  const pass1 = await fetchAllPass1(roGet, cutoff, runStats);
  console.log(`[kal262] pinned-universe pull: ${pass1.length} rows in ${runStats.page_batches.length} pages; live table ${liveSnapshot.total} rows`);
  const postCutoff = await fetchPostCutoffCount(roGet, cutoff, liveSnapshot.total, pass1.length);
  const baselineSnap = migrationBaseline.run.snapshot_before;
  const snapshotMatches = liveSnapshot.total === baselineSnap.total && liveSnapshot.maxUpdatedAt === baselineSnap.maxUpdatedAt;
  console.log(`[kal262] stale-baseline guard: snapshot ${snapshotMatches ? 'matches' : 'MOVED'}; post-cutoff rows ${postCutoff.count} (${postCutoff.method})`);

  // ---- Phase C — recompute ground truth with the generator's own code
  const { perDoc, anomalies, userDrawn } = aggregate(pass1);
  const freshSurvivors = [];
  const survivorIds = new Set();
  for (const doc of perDoc.values()) {
    for (const candidates of doc.dedup.values()) {
      const picks = pickSurvivors(candidates);
      freshSurvivors.push({
        key: candidates[0].key_tuple,
        picks: {
          app_exact: { id: picks.app_exact },
          latest_updated_at: { id: picks.latest_updated_at },
          latest_created_at: { id: picks.latest_created_at },
        },
      });
      for (const p of POLICIES) survivorIds.add(freshSurvivors[freshSurvivors.length - 1].picks[p].id);
    }
  }
  const pass2Ids = [...new Set([...userDrawn.map((r) => r.id), ...survivorIds])];
  console.log(`[kal262] pass 2: ${pass2Ids.length} full rows (${userDrawn.length} user-drawn, ${survivorIds.size} survivors)`);
  const fullRowsById = await fetchFullRowsByIds(roGet, pass2Ids);
  // The two classes hash under different domains (embedded excludes the
  // top-level annotation_id), so they get separate maps — a row can only be in
  // both if classification drifted, and then each anchor sees its own domain.
  const freshHashById = new Map();
  for (const r of userDrawn) freshHashById.set(r.id, payloadHash(fullRowsById.get(r.id)));
  const freshEmbeddedHashById = new Map();
  for (const id of survivorIds) freshEmbeddedHashById.set(id, payloadHash(fullRowsById.get(id), { excludeAnnotationId: true }));
  const anomalyCount = Object.values(anomalies).reduce((n, b) => n + b.count, 0);

  // ---- Phase D — baseline anchoring with positive attribution
  const anchorUD = await anchorUserDrawn({
    checkpoint, freshUserDrawn: userDrawn, freshHashById, freshRowsById: fullRowsById, probeById, cutoff,
  });
  const anchorEM = await anchorSurvivors({
    survivorsFile, freshSurvivors, freshHashById: freshEmbeddedHashById, freshRowsById: fullRowsById, probeById, cutoff,
  });
  console.log(`[kal262] anchoring: user-drawn ${anchorUD.matched} matched / ${anchorUD.drift_explained.length} drift / ${anchorUD.unexplained.length} UNEXPLAINED; embedded keys ${anchorEM.matched} matched / ${anchorEM.drift_explained.length} drift / ${anchorEM.unexplained.length} UNEXPLAINED`);

  // Per-doc count cross-check vs migration_baseline.documents[]
  const docExpByDoc = buildExpectations(checkpoint, survivorsFile);
  let perDocCountCrossChecksPass = true;
  const baselineDocs = new Map(migrationBaseline.documents.map((d) => [d.document_id, d]));
  for (const [docId, exp] of docExpByDoc) {
    const b = baselineDocs.get(docId);
    if (!b || b.user_drawn !== exp.userDrawn.length || b.embedded_unique !== exp.embedded.size) {
      perDocCountCrossChecksPass = false;
      console.warn(`[kal262] per-doc cross-check FAILED for ${docId}: baseline ${b?.user_drawn}/${b?.embedded_unique} vs checkpoint ${exp.userDrawn.length}/${exp.embedded.size}`);
    }
  }

  // ---- Phases E/F — materialize × 3 policies, round-trip, verify vs checkpoint
  const documents = [];
  let anyVerifyFail = false;
  for (const [docId, exp] of docExpByDoc) {
    const policies = {};
    for (const p of POLICIES) {
      const extracted = extractMaps(roundTripDoc(materializeDoc(exp, fullRowsById, p)));
      const verdict = verifyDocument(extracted, identityAdapter, exp, p);
      if (!verdict.pass) anyVerifyFail = true;
      policies[p] = { pass: verdict.pass, diff_count: verdict.diffs.length, diffs: verdict.diffs.slice(0, 50) };
    }
    documents.push({
      document_id: docId,
      user_drawn_expected: exp.userDrawn.length,
      embedded_expected: exp.embedded.size,
      policies,
    });
  }
  console.log(`[kal262] verified ${documents.length} documents × ${POLICIES.length} policies — ${anyVerifyFail ? 'FAILURES PRESENT' : 'all PASS'}`);

  // ---- Phase G — negative self-test
  const selfTest = runSelfTest(docExpByDoc, fullRowsById);
  console.log(`[kal262] self-test: ${selfTest.detections.filter((d) => d.detected).length}/${selfTest.detections.length} injections detected`);

  // ---- Phase H — outputs + exit
  const tableMoved = !snapshotMatches || postCutoff.count > 0
    || anchorUD.drift_explained.length > 0 || anchorEM.drift_explained.length > 0;
  const anyUnexplained = anchorUD.unexplained.length > 0 || anchorEM.unexplained.length > 0
    || !perDocCountCrossChecksPass || anomalyCount > 0;
  const exitCode = aggregateExitCode({ selfTestPass: selfTest.pass, anyUnexplained, anyVerifyFail, tableMoved });
  const verdictWord = exitCode === 0 ? 'PASS' : exitCode === 2 ? 'DRIFT' : 'FAIL';

  const smCount = checkpoint.marks.filter((m) => m.annotation_type === 'survey-marker').length;
  const coCount = checkpoint.marks.filter((m) => isCalloutType(m.annotation_type)).length;
  const verdicts = {
    task: 'KAL-262',
    generated_at: new Date().toISOString(),
    baseline_generated_at: cutoff,
    cutoff,
    host: PROD_HOST,
    live_snapshot: {
      total: liveSnapshot.total,
      max_updated_at: liveSnapshot.maxUpdatedAt,
      baseline_total: baselineSnap.total,
      baseline_max_updated_at: baselineSnap.maxUpdatedAt,
      matches: snapshotMatches,
      post_cutoff_count: postCutoff.count,
      post_cutoff_count_method: postCutoff.method,
    },
    anchoring: {
      user_drawn: {
        matched: anchorUD.matched,
        drift_explained_count: anchorUD.drift_explained.length,
        unexplained_count: anchorUD.unexplained.length,
        drift_explained: anchorUD.drift_explained.slice(0, 200),
        unexplained: anchorUD.unexplained.slice(0, 200),
      },
      embedded: {
        matched: anchorEM.matched,
        drift_explained_count: anchorEM.drift_explained.length,
        unexplained_count: anchorEM.unexplained.length,
        drift_explained: anchorEM.drift_explained.slice(0, 200),
        unexplained: anchorEM.unexplained.slice(0, 200),
      },
    },
    self_test: selfTest,
    documents,
    totals: {
      documents_verified: documents.length,
      user_drawn_expected: checkpoint.count,
      user_drawn_verified: anchorUD.matched,
      survey_marker_verified: smCount,
      callout_verified: coCount,
      embedded_keys_expected: survivorsFile.count,
      policies_verified: POLICIES.length,
      per_doc_count_cross_checks_pass: perDocCountCrossChecksPass,
    },
    exit_code: exitCode,
    verdict: verdictWord,
  };
  assertVerdictsAllowlisted(verdicts);

  await mkdir(OUT_DIR, { recursive: true });
  const verdictsPath = join(OUT_DIR, 'kal262_dryrun_verdicts.json');
  await writeAtomically(verdictsPath, JSON.stringify(verdicts, null, 1), (parsed) => {
    assertVerdictsAllowlisted(parsed);
    assertNoLeaks(parsed);
  });

  const report = buildReport({ verdicts, anomalies, runStats });
  await writeAtomically(join(OUT_DIR, 'KAL-262-DRYRUN-REPORT.md'), report, null);

  console.log(`[kal262] ${verdictWord} (exit ${exitCode}) — outputs in ${OUT_DIR}/`);
  if (exitCode === 2) console.warn('[kal262] table moved past the baseline: re-baseline (re-run KAL-261, update pinned hashes) before migration');
  process.exitCode = exitCode;
}

function buildReport({ verdicts, anomalies, runStats }) {
  const v = verdicts;
  const failDocs = v.documents.filter((d) => POLICIES.some((p) => !d.policies[p].pass));
  const lines = [];
  lines.push('# KAL-262 — Zero-Loss Verification Harness, DRY-RUN Report (no writes)');
  lines.push('');
  lines.push(`Generated ${v.generated_at} against \`${v.host}\` — GET-only, all Y.Doc work in-memory, zero writes. Verdict: **${v.verdict}** (exit ${v.exit_code}).`);
  lines.push('');
  lines.push('## Acceptance (ticket: passes for every user-drawn mark; dedup counts match Step-1)');
  lines.push('');
  lines.push('| Check | Expected | Observed | Verdict |');
  lines.push('|---|---|---|---|');
  const failedUD = v.anchoring.user_drawn.unexplained_count + v.anchoring.user_drawn.drift_explained_count;
  lines.push(`| user-drawn marks anchored to baseline | ${v.totals.user_drawn_expected} | ${v.totals.user_drawn_verified} | ${failedUD === 0 ? 'PASS' : 'DIFFS'} |`);
  lines.push(`| — of which survey-marker (no Y.Doc path in today's app) | 403 | ${v.totals.survey_marker_verified} | ${v.totals.survey_marker_verified === 403 ? 'PASS' : 'CHECK'} |`);
  lines.push(`| — of which callout (dedicated callouts map) | 11 | ${v.totals.callout_verified} | ${v.totals.callout_verified === 11 ? 'PASS' : 'CHECK'} |`);
  lines.push(`| embedded dedup keys | 10960 | ${v.totals.embedded_keys_expected} | ${v.totals.embedded_keys_expected === 10960 ? 'PASS' : 'CHECK'} |`);
  const heavy = v.documents.find((d) => d.document_id.startsWith('70dadd86'));
  lines.push(`| heavy doc 70dadd86… embedded unique | 3056 | ${heavy?.embedded_expected ?? -1} | ${heavy?.embedded_expected === 3056 ? 'PASS' : 'CHECK'} |`);
  lines.push(`| per-doc count cross-checks vs migration_baseline | pass | ${v.totals.per_doc_count_cross_checks_pass} | ${v.totals.per_doc_count_cross_checks_pass ? 'PASS' : 'FAIL'} |`);
  lines.push(`| documents × policies round-trip verified | ${v.totals.documents_verified} × 3 | ${failDocs.length === 0 ? 'all pass' : `${failDocs.length} doc(s) FAILED`} | ${failDocs.length === 0 ? 'PASS' : 'FAIL'} |`);
  lines.push(`| negative self-test (verifier can fail) | 7/7 | ${v.self_test.detections.filter((d) => d.detected).length}/${v.self_test.detections.length} | ${v.self_test.pass ? 'PASS' : 'INVALID RUN'} |`);
  lines.push('');
  lines.push('## Stale-baseline guard');
  lines.push('');
  lines.push(`Live table: ${v.live_snapshot.total} rows (baseline ${v.live_snapshot.baseline_total}), max updated_at ${v.live_snapshot.max_updated_at} (baseline ${v.live_snapshot.baseline_max_updated_at}) — snapshot ${v.live_snapshot.matches ? 'MATCHES' : 'MOVED'}. Post-cutoff rows: ${v.live_snapshot.post_cutoff_count} (${v.live_snapshot.post_cutoff_count_method}). ${v.live_snapshot.matches && v.live_snapshot.post_cutoff_count === 0 ? 'The live table still IS the baseline.' : '**Re-baseline (re-run KAL-261, update pinned hashes) before any migration write.**'}`);
  lines.push('');
  lines.push('## Baseline anchoring (fresh pull vs committed checkpoints)');
  lines.push('');
  lines.push(`- User-drawn: ${v.anchoring.user_drawn.matched} matched, ${v.anchoring.user_drawn.drift_explained_count} drift-explained, ${v.anchoring.user_drawn.unexplained_count} UNEXPLAINED.`);
  lines.push(`- Embedded keys (all three policies): ${v.anchoring.embedded.matched} matched, ${v.anchoring.embedded.drift_explained_count} drift-explained, ${v.anchoring.embedded.unexplained_count} UNEXPLAINED.`);
  lines.push(`- Anomaly buckets in the fresh pull: ${Object.keys(anomalies).length === 0 ? 'none' : JSON.stringify(Object.fromEntries(Object.entries(anomalies).map(([k, b]) => [k, b.count])))}.`);
  lines.push(`- Pinned-universe pull: ${runStats.page_batches.length} keyset pages.`);
  lines.push('');
  lines.push('## Self-test detections');
  lines.push('');
  for (const d of v.self_test.detections) lines.push(`- ${d.detected ? 'DETECTED' : '**MISSED**'} — ${d.injection} → ${d.expected_diff}`);
  lines.push('');
  lines.push('## Shape compatibility (DECISION INPUT for KAL-266 — verified in code, not decided here)');
  lines.push('');
  lines.push('Two distinct gaps between this dry-run\'s zero-loss payload (the full normalized row) and what the live app reads today:');
  lines.push('');
  lines.push('1. **Hash-domain completeness.** The live bridge shape (`crdtAnnotationBridge.js:249-303`: nested `{id, type, pageNumber, fabric, meta}` Y.Maps; callouts `{id, type, pageNumber, callout, meta}`) carries the fabric JSON plus scalars — NOT `user_id`, `annotation_type`, `page_number`, `document_id`, or non-fabric `annotation_data` siblings. Neither shape can reconstruct the row, so neither can pass zero-loss verification as-is. KAL-266 must either store full-row payloads and adapt the reader, or define a richer bridge shape. The verifier core takes a pluggable entry adapter so Step 5 verifies whichever shape is chosen.');
  lines.push('2. **Representability.** The live fan-out (`useAnnotationCloudSync.js` Pitfall 30-4) deliberately excludes survey-marker and callout types from `getMap(\'annotations\')`. **403 of 615 user-drawn marks are survey-markers with no Y.Doc representation today**; callouts are renderable via their dedicated map but not hash-domain complete. Reader paths for both must exist before cutover.');
  lines.push('');
  lines.push('## Open decisions (restated, not advanced)');
  lines.push('');
  lines.push('- Survivor policy (KAL-266): all three policies verified here; 1,244/10,960 keys divergent — the choice is material.');
  lines.push('- Archived-document policy (§7/B3) and Step-7 dual-write target (00e1cde9 is archived).');
  lines.push('- Step-4 deterministic embedded ID encoding: `import:<page>:<id>` is delimiter-ambiguous; this dry-run keys embedded entries by the canonical JSON tuple. Recommend hash or base64url-encoded components.');
  lines.push('');
  lines.push('## What Step 5 reuses');
  lines.push('');
  lines.push('`verifyDocument(extractedMaps, adapter, expectations, policy)` + `buildExpectations` + the integrity gate are input-agnostic: feed them maps extracted from a deserialized snapshot read back from the Yjs state table instead of the in-memory materialization, swap the adapter for the final payload shape, and the same refusal semantics apply (any diff ⇒ do not promote that document; keep it on the flat-table read path).');
  lines.push('');
  if (failDocs.length > 0) {
    lines.push('## Failing documents');
    lines.push('');
    for (const d of failDocs.slice(0, 20)) {
      const fp = POLICIES.filter((p) => !d.policies[p].pass);
      lines.push(`- ${d.document_id}: failing under ${fp.join(', ')} (${fp.map((p) => `${d.policies[p].diff_count} diffs`).join(', ')})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('[kal262] FAILED:', err.message); process.exit(1); });
}

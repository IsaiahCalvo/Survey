#!/usr/bin/env node
// KAL-261 — Baseline + dedup-preview queries (read-only ground truth).
// PRE-REBUILD-READINESS.md §4 Step 1. Pulls projected slices of production
// document_annotations via PostgREST GETs ONLY, aggregates locally, and writes
// the migration ground-truth checkpoints consumed by KAL-260/262/266:
//
//   .planning/optimization/migration-baseline/migration_baseline.json
//   .planning/optimization/migration-baseline/user_drawn_marks_checkpoint.json
//   .planning/optimization/migration-baseline/embedded_dedup_survivors.json
//   .planning/optimization/migration-baseline/KAL-261-BASELINE-REPORT.md
//
// Safety invariants (Codex-reviewed plan PLAN-KAL261.md, approved r3):
//   - single GET-only request helper, table whitelist {document_annotations,
//     documents}, no /rpc/, no request bodies, no supabase-js
//   - hard host pin to the production project (shell env cannot retarget)
//   - created_at cutoff + before/after drift detection with bounded retries
//   - committed outputs carry hashes/metadata only — a structural leak guard
//     re-reads every JSON and fails the run if raw payloads or secret-shaped
//     strings appear.
//
// Pure helpers are exported for the unit tests in
// tests/kal261BaselineHelpers.test.mjs.

import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../agent-cli/lib/env.mjs';
import { isSurveyMarkerType } from '../src/utils/surveyMarkerType.js';

export const PROD_HOST = 'cvamwtpsuvxvjdnotbeg.supabase.co';
export const ALLOWED_TABLES = new Set(['document_annotations', 'documents']);
export const OUT_DIR = '.planning/optimization/migration-baseline';
// PostgREST max-rows on this project caps responses at 1,000 regardless of
// limit= (verified live: limit=5000 returned content-range 0-999). The keyset
// loop's "short page = last page" exit is only sound if PAGE_SIZE <= that cap.
const PAGE_SIZE = 1000;
const PASS2_BATCH = 100;
const MAX_ATTEMPTS = 3;

export const HASH_SCHEME = {
  algorithm: 'sha256-hex over canonical JSON (recursively key-sorted, no whitespace, undefined-valued keys omitted)',
  domain: 'the full database row, normalized per class as below',
  excluded_top_level: ['id', 'created_at', 'updated_at'],
  excluded_top_level_embedded_only: ['annotation_id'],
  excluded_nested: ['annotation_data.clientSessionId'],
  nested_id_disposition:
    'fabricObject.id, fabricObject.annotationId and fabricObject.data.id are preserved as-stored INSIDE the hash. '
    + 'Only the top-level annotation_id column is excluded, and only for embedded survivors (Step 4 mints '
    + 'deterministic import:<page>:<pdfAnnotationId> ids, so the original random annotation_id will not survive '
    + 'migration by design; it is recorded as plaintext metadata instead).',
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => (v === undefined ? 'null' : canonicalStringify(v))).join(',') + ']';
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeRowForHash(row, { excludeAnnotationId = false } = {}) {
  const clone = { ...row };
  delete clone.id;
  delete clone.created_at;
  delete clone.updated_at;
  if (excludeAnnotationId) delete clone.annotation_id;
  if (clone.annotation_data && typeof clone.annotation_data === 'object' && !Array.isArray(clone.annotation_data)) {
    clone.annotation_data = { ...clone.annotation_data };
    delete clone.annotation_data.clientSessionId;
  }
  return clone;
}

export function payloadHash(row, opts) {
  return sha256Hex(canonicalStringify(normalizeRowForHash(row, opts)));
}

// Strict classification. PostgREST `->` projections keep JSON types, so a
// well-formed flag arrives as boolean true/false. Anything else present is an
// anomaly (the §4 SQL predicate and JS truthiness would disagree on it).
export function classifyImportFlag(isPdfImported) {
  if (isPdfImported === true) return { embedded: true, anomaly: null };
  if (isPdfImported === false || isPdfImported === null || isPdfImported === undefined) {
    return { embedded: false, anomaly: null };
  }
  return { embedded: false, anomaly: 'import_flag_non_boolean' };
}

// Effective page = annotation_data.pageNumber ?? row.page_number (app
// semantics, getPdfImportDedupeKey). Pinned to finite integers; anything else
// is flagged and the row falls back to the other side (or null).
export function resolveEffectivePage(dataPageNumber, rowPageNumber) {
  const flags = [];
  const dataValid = typeof dataPageNumber === 'number' && Number.isInteger(dataPageNumber);
  const rowValid = typeof rowPageNumber === 'number' && Number.isInteger(rowPageNumber);
  if (dataPageNumber !== null && dataPageNumber !== undefined && !dataValid) flags.push('page_invalid');
  if (rowPageNumber !== null && rowPageNumber !== undefined && !rowValid) flags.push('page_invalid');
  if (dataValid && rowValid && dataPageNumber !== rowPageNumber) flags.push('page_mismatch');
  const page = dataValid ? dataPageNumber : (rowValid ? rowPageNumber : null);
  if (page === null) flags.push('page_unresolvable');
  return { page, flags };
}

function tsOf(row, field) {
  const t = Date.parse(field === 'updated_at' ? (row.updated_at || row.created_at || '') : (row.created_at || ''));
  return Number.isFinite(t) ? t : -Infinity;
}

function maxByTs(rows, field) {
  let best = null;
  for (const r of rows) {
    if (!best) { best = r; continue; }
    const a = tsOf(r, field);
    const b = tsOf(best, field);
    if (a > b || (a === b && r.id > best.id)) best = r;
  }
  return best;
}

// Exact clone of the app's preferFabricRow comparator
// (src/services/annotationTypeSerializers.js): non-survey-marker rows beat
// survey-marker rows, then latest updated_at||created_at with >= keeping the
// candidate. Candidates are folded in PK-asc order so the >= behavior is
// deterministic.
function appExactPrefer(candidate, current) {
  if (!current) return candidate;
  if (isSurveyMarkerType(current.annotation_type) && !isSurveyMarkerType(candidate.annotation_type)) return candidate;
  if (isSurveyMarkerType(candidate.annotation_type) && !isSurveyMarkerType(current.annotation_type)) return current;
  const ct = Date.parse(candidate.updated_at || candidate.created_at || '');
  const cu = Date.parse(current.updated_at || current.created_at || '');
  if (Number.isFinite(ct) && Number.isFinite(cu)) return ct >= cu ? candidate : current;
  return current;
}

export function pickSurvivors(candidates) {
  const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let appExact = null;
  for (const c of sorted) appExact = appExactPrefer(c, appExact);
  const latestUpdated = maxByTs(sorted, 'updated_at');
  const latestCreated = maxByTs(sorted, 'created_at');
  const ids = { app_exact: appExact.id, latest_updated_at: latestUpdated.id, latest_created_at: latestCreated.id };
  const divergent = new Set(Object.values(ids)).size > 1;
  return { ...ids, divergent };
}

const FORBIDDEN_OUTPUT_KEYS = new Set(['annotation_data', 'fabricObject', 'bounds', 'checklist_responses', 'notes']);
const SECRET_PATTERNS = [/eyJ[A-Za-z0-9_-]{20,}/, /sb_secret/i, /service_role/i];

// Structural leak guard: walks parsed JSON. Object KEYS named like payload
// containers are forbidden everywhere except under exempt top-level keys
// (hash_scheme documentation). String VALUES are scanned for secret shapes.
export function assertNoLeaks(parsed, { exemptTopLevelKeys = ['hash_scheme'] } = {}) {
  const walk = (value, path) => {
    if (typeof value === 'string') {
      for (const pat of SECRET_PATTERNS) {
        if (pat.test(value)) throw new Error(`leak guard: secret-shaped string at ${path.join('.') || '<root>'}`);
      }
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, [...path, i])); return; }
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_OUTPUT_KEYS.has(k) && !(path.length > 0 && exemptTopLevelKeys.includes(path[0]))) {
        throw new Error(`leak guard: forbidden key "${k}" at ${path.join('.') || '<root>'}`);
      }
      if (!(path.length === 0 && exemptTopLevelKeys.includes(k))) walk(v, [...path, k]);
    }
  };
  walk(parsed, []);
}

export function driftChanged(before, after) {
  return before.total !== after.total || before.maxUpdatedAt !== after.maxUpdatedAt;
}

export function makeRoGet(baseUrl, serviceKey, fetchImpl = fetch) {
  const host = new URL(baseUrl).host;
  if (host !== PROD_HOST) {
    throw new Error(`refusing to run: resolved Supabase host "${host}" is not the pinned production host`);
  }
  const base = baseUrl.replace(/\/+$/, '');
  return async function roGet(table, params, { prefer } = {}) {
    if (!ALLOWED_TABLES.has(table)) throw new Error(`roGet: table not whitelisted: ${table}`);
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    if (prefer) headers.Prefer = prefer;
    const res = await fetchImpl(`${base}/rest/v1/${table}?${params}`, { method: 'GET', headers });
    if (res.status !== 200 && res.status !== 206) {
      throw new Error(`roGet ${table} failed: HTTP ${res.status} ${await res.text()}`);
    }
    return { rows: await res.json(), contentRange: res.headers.get('content-range') };
  };
}

// ---------------------------------------------------------------------------
// Run logic
// ---------------------------------------------------------------------------

// Drift snapshot is deliberately UNFILTERED: the created_at-filtered exact
// count seq-scans the JSONB-heavy heap and hits the 8s statement timeout
// (verified live: 8104ms vs 840ms unfiltered). An unfiltered count means a
// benign post-cutoff insert reads as drift — that just costs a retry, which
// is the safe direction.
export async function snapshotTable(roGet) {
  const head = await roGet('document_annotations', 'select=id&limit=1', { prefer: 'count=exact' });
  const total = Number.parseInt(String(head.contentRange).split('/')[1], 10);
  const top = await roGet(
    'document_annotations',
    'select=updated_at&order=updated_at.desc.nullslast&limit=1',
  );
  return { total, maxUpdatedAt: top.rows[0]?.updated_at ?? null };
}

export async function fetchAllPass1(roGet, cutoff, runStats) {
  const cut = encodeURIComponent(cutoff);
  const select = [
    'id', 'annotation_id', 'document_id', 'page_number', 'annotation_type', 'user_id', 'created_at', 'updated_at',
    'dataPageNumber:annotation_data->pageNumber',
    'isPdfImported:annotation_data->fabricObject->isPdfImported',
    'pdfAnnotationId:annotation_data->fabricObject->pdfAnnotationId',
  ].join(',');
  const rows = [];
  let lastId = null;
  for (;;) {
    const filter = lastId ? `&id=gt.${encodeURIComponent(lastId)}` : '';
    const page = await roGet(
      'document_annotations',
      `select=${select}&created_at=lte.${cut}&order=id.asc&limit=${PAGE_SIZE}${filter}`,
    );
    if (page.rows.length === 0) break;
    rows.push(...page.rows);
    runStats.page_batches.push({
      first_id: page.rows[0].id,
      last_id: page.rows[page.rows.length - 1].id,
      count: page.rows.length,
    });
    lastId = page.rows[page.rows.length - 1].id;
    if (page.rows.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchFullRowsByIds(roGet, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += PASS2_BATCH) {
    const batch = ids.slice(i, i + PASS2_BATCH);
    const { rows } = await roGet('document_annotations', `select=*&id=in.(${batch.join(',')})`);
    for (const r of rows) out.set(r.id, r);
  }
  const requested = new Set(ids);
  const missing = ids.filter((id) => !out.has(id));
  const extra = [...out.keys()].filter((id) => !requested.has(id));
  if (missing.length || extra.length) {
    throw new Error(`pass-2 id-set mismatch: ${missing.length} missing, ${extra.length} unexpected — drift`);
  }
  return out;
}

function bucketAdd(buckets, name, rowId, docId) {
  const b = buckets[name] ?? (buckets[name] = { count: 0, example_ids: [], per_document: {} });
  b.count += 1;
  if (b.example_ids.length < 10) b.example_ids.push(rowId);
  b.per_document[docId] = (b.per_document[docId] ?? 0) + 1;
}

export function aggregate(pass1Rows) {
  const perDoc = new Map();
  const anomalies = {};
  const userDrawn = [];
  for (const row of pass1Rows) {
    const doc = perDoc.get(row.document_id) ?? perDoc.set(row.document_id, {
      total: 0, user_drawn: 0, embedded_raw: 0, by_type: {}, dedup: new Map(),
    }).get(row.document_id);
    doc.total += 1;
    doc.by_type[row.annotation_type] = (doc.by_type[row.annotation_type] ?? 0) + 1;

    const { embedded, anomaly } = classifyImportFlag(row.isPdfImported);
    if (anomaly) bucketAdd(anomalies, anomaly, row.id, row.document_id);

    const { page, flags } = resolveEffectivePage(row.dataPageNumber, row.page_number);
    for (const f of flags) bucketAdd(anomalies, f, row.id, row.document_id);

    const pdfId = row.pdfAnnotationId;
    const hasPdfId = pdfId !== null && pdfId !== undefined && pdfId !== '';

    if (embedded) {
      doc.embedded_raw += 1;
      if (!hasPdfId) {
        bucketAdd(anomalies, 'embedded_missing_pdfAnnotationId', row.id, row.document_id);
      } else if (page === null) {
        bucketAdd(anomalies, 'embedded_unresolvable_page', row.id, row.document_id);
      } else {
        const key = canonicalStringify([row.document_id, page, pdfId]);
        const list = doc.dedup.get(key) ?? doc.dedup.set(key, []).get(key);
        list.push({
          id: row.id, annotation_id: row.annotation_id, annotation_type: row.annotation_type,
          created_at: row.created_at, updated_at: row.updated_at,
          key_tuple: [row.document_id, page, pdfId],
        });
      }
    } else {
      doc.user_drawn += 1;
      if (hasPdfId) bucketAdd(anomalies, 'pdfid_without_import_flag', row.id, row.document_id);
      userDrawn.push({
        id: row.id, annotation_id: row.annotation_id, document_id: row.document_id,
        page_number: row.page_number, effective_page: page, annotation_type: row.annotation_type,
        user_id: row.user_id, created_at: row.created_at, updated_at: row.updated_at,
      });
    }
  }
  return { perDoc, anomalies, userDrawn };
}

async function runOnce(roGet, attempt) {
  const cutoff = new Date().toISOString();
  const runStats = { cutoff, attempt, page_batches: [] };
  console.log(`[kal261] attempt ${attempt}: cutoff ${cutoff}`);

  const before = await snapshotTable(roGet);
  console.log(`[kal261] snapshot before: ${before.total} rows, max updated_at ${before.maxUpdatedAt}`);

  const { rows: documents } = await roGet(
    'documents',
    'select=id,name,archived,file_size,page_count,content_sha256,created_at&order=id.asc&limit=1000',
  );
  console.log(`[kal261] documents: ${documents.length}`);
  if (documents.length >= 1000) throw new Error('documents response hit the 1000-row server cap — add pagination');

  const pass1 = await fetchAllPass1(roGet, cutoff, runStats);
  console.log(`[kal261] pass 1: ${pass1.length} annotation rows in ${runStats.page_batches.length} pages`);
  // With a static table (no drift), every row has created_at <= cutoff, so the
  // filtered pass-1 total must equal the unfiltered snapshot count.
  if (pass1.length !== before.total) {
    throw new DriftError(`pass-1 row count ${pass1.length} != snapshot count ${before.total}`);
  }

  const { perDoc, anomalies, userDrawn } = aggregate(pass1);

  // Survivor selection per dedup key, all three policies.
  const survivorEntries = [];
  const survivorIds = new Set();
  for (const doc of perDoc.values()) {
    for (const candidates of doc.dedup.values()) {
      const picks = pickSurvivors(candidates);
      survivorEntries.push({ key: candidates[0].key_tuple, candidates: candidates.length, picks });
      survivorIds.add(picks.app_exact);
      survivorIds.add(picks.latest_updated_at);
      survivorIds.add(picks.latest_created_at);
    }
  }

  // Pass 2: full payloads for user-drawn + survivors; hash immediately.
  const pass2Ids = [...new Set([...userDrawn.map((r) => r.id), ...survivorIds])];
  console.log(`[kal261] pass 2: fetching ${pass2Ids.length} full rows (${userDrawn.length} user-drawn, ${survivorIds.size} survivors)`);
  const fullRows = await fetchFullRowsByIds(roGet, pass2Ids);
  const userDrawnHash = new Map();
  const embeddedHash = new Map();
  for (const r of userDrawn) userDrawnHash.set(r.id, payloadHash(fullRows.get(r.id)));
  for (const id of survivorIds) embeddedHash.set(id, payloadHash(fullRows.get(id), { excludeAnnotationId: true }));

  const after = await snapshotTable(roGet);
  console.log(`[kal261] snapshot after: ${after.total} rows, max updated_at ${after.maxUpdatedAt}`);
  if (driftChanged(before, after)) {
    throw new DriftError(`table drifted during run (before ${before.total}/${before.maxUpdatedAt}, after ${after.total}/${after.maxUpdatedAt})`);
  }

  return { cutoff, runStats, before, after, documents, perDoc, anomalies, userDrawn, survivorEntries, userDrawnHash, embeddedHash };
}

export class DriftError extends Error {}

// ---------------------------------------------------------------------------
// Output assembly
// ---------------------------------------------------------------------------

const EXPECTED = {
  heavyDocPrefix: '70dadd86',
  heavyDocUnique: 3056,
  heavyDocRaw: 24449,
  userDrawnApprox: 489,
  se011ArchPrefix: '97f95b32',
  se011ArchUserDrawn: 388,
  pkg2ArchPrefix: 'd30ac66b',
  pkg2ArchUserDrawn: 30,
  auditTotal: 53216,
};

function buildOutputs(run) {
  const docsById = new Map(run.documents.map((d) => [d.id, d]));
  const perDocOut = [...run.perDoc.entries()].map(([docId, d]) => {
    const meta = docsById.get(docId);
    let uniqueDivergent = 0;
    for (const e of run.survivorEntries) {
      if (e.key[0] === docId && e.picks.divergent) uniqueDivergent += 1;
    }
    const unique = [...run.perDoc.get(docId).dedup.keys()].length;
    return {
      document_id: docId,
      name: meta?.name ?? null,
      archived: meta?.archived ?? null,
      file_size: meta?.file_size ?? null,
      content_sha256_present: Boolean(meta?.content_sha256),
      total: d.total,
      user_drawn: d.user_drawn,
      embedded_raw: d.embedded_raw,
      embedded_unique: unique,
      embedded_dupe_factor: unique > 0 ? Number((d.embedded_raw / unique).toFixed(2)) : null,
      survivor_policy_divergent_keys: uniqueDivergent,
      by_type: d.by_type,
    };
  }).sort((a, b) => b.total - a.total);

  const heavy = perDocOut.find((d) => d.document_id.startsWith(EXPECTED.heavyDocPrefix));
  const heavyDetail = heavy ? buildHeavyDetail(run, heavy.document_id) : null;

  const survivors = run.survivorEntries.map((e) => ({
    key: e.key,
    candidates: e.candidates,
    app_exact: { id: e.picks.app_exact, payload_sha256: run.embeddedHash.get(e.picks.app_exact) },
    latest_updated_at: { id: e.picks.latest_updated_at, payload_sha256: run.embeddedHash.get(e.picks.latest_updated_at) },
    latest_created_at: { id: e.picks.latest_created_at, payload_sha256: run.embeddedHash.get(e.picks.latest_created_at) },
    divergent: e.picks.divergent,
  }));

  const marks = run.userDrawn
    .map((r) => ({ ...r, payload_sha256: run.userDrawnHash.get(r.id) }))
    .sort((a, b) => (a.document_id + a.id).localeCompare(b.document_id + b.id));

  return { perDocOut, heavy, heavyDetail, survivors, marks };
}

function buildHeavyDetail(run, docId) {
  const doc = run.perDoc.get(docId);
  const pages = new Map();
  for (const candidates of doc.dedup.values()) {
    const page = candidates[0].key_tuple[1];
    const p = pages.get(page) ?? pages.set(page, { unique: 0, raw: 0, top: [] }).get(page);
    p.unique += 1;
    p.raw += candidates.length;
    p.top.push({ pdfAnnotationId: candidates[0].key_tuple[2], count: candidates.length });
  }
  const byPage = [...pages.entries()]
    .map(([page, p]) => ({
      page, unique: p.unique, raw: p.raw,
      top_duplicates: p.top.sort((a, b) => b.count - a.count).slice(0, 3),
    }))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, 10);
  return { document_id: docId, pages_with_most_duplication: byPage };
}

function check(label, expected, observed, exact = true) {
  const pass = exact ? observed === expected : Math.abs(observed - expected) <= expected * 0.1;
  return { label, expected, observed, pass };
}

function buildReport(run, built, checks, outputHashes) {
  const divergentTotal = built.survivors.filter((s) => s.divergent).length;
  const lines = [];
  lines.push('# KAL-261 — Baseline + Dedup-Preview Report (read-only ground truth)');
  lines.push('');
  lines.push(`Generated ${run.cutoff} (attempt ${run.runStats.attempt}) against \`${PROD_HOST}\` — GET-only, zero writes.`);
  lines.push('');
  lines.push('## Validation vs audit expectations');
  lines.push('');
  lines.push('| Claim | Expected | Observed | Verdict |');
  lines.push('|---|---|---|---|');
  for (const c of checks) lines.push(`| ${c.label} | ${c.expected} | ${c.observed} | ${c.pass ? 'CONFIRMED' : 'MISMATCH'} |`);
  lines.push('');
  lines.push('## Snapshot stability');
  lines.push('');
  lines.push(`Cutoff \`created_at <= ${run.cutoff}\`; before/after row count ${run.before.total}/${run.after.total}, `
    + `max updated_at ${run.before.maxUpdatedAt} / ${run.after.maxUpdatedAt} — no drift detected during the run. `
    + `${run.runStats.page_batches.length} keyset pages of ≤${PAGE_SIZE}.`);
  lines.push('');
  lines.push('## Anomaly buckets');
  lines.push('');
  const anomalyNames = Object.keys(run.anomalies);
  if (anomalyNames.length === 0) {
    lines.push('None. Every row classified cleanly (boolean import flags, integer pages, dedupable embedded refs).');
  } else {
    for (const name of anomalyNames) {
      const b = run.anomalies[name];
      lines.push(`- **${name}**: ${b.count} rows (examples: ${b.example_ids.slice(0, 3).join(', ')}); per-doc: ${JSON.stringify(b.per_document)}`);
    }
  }
  lines.push('');
  lines.push('## Survivor-policy divergence (DECISION INPUT for Isaiah / Step 3)');
  lines.push('');
  lines.push(`${divergentTotal} of ${built.survivors.length} dedup keys pick a different survivor under the three candidate policies `
    + '(`app_exact` = shipping preferFabricRow semantics; `latest_updated_at`; `latest_created_at` = readiness-doc Step-3 wording). '
    + 'KAL-266 must pick ONE policy; this baseline records all three so the choice stays data-informed. '
    + 'Note for Step 4: the planned `import:<page>:<pdfAnnotationId>` deterministic ID scheme is delimiter-ambiguous if a '
    + 'pdfAnnotationId ever contains `:`; this baseline keys on JSON tuples — recommend Step 4 hash or base64url-encode components.');
  lines.push('');
  lines.push('## What downstream tasks consume');
  lines.push('');
  lines.push('- **KAL-260 (backup)**: nothing consumed; this report confirms current row counts to verify the backup against.');
  lines.push('- **KAL-262 (zero-loss harness)**: `user_drawn_marks_checkpoint.json` (per-mark payload_sha256, hash_scheme header) '
    + 'and `embedded_dedup_survivors.json` (per-key survivor hashes, all three policies). The harness must reproduce the '
    + 'documented hash scheme byte-exactly.');
  lines.push('- **KAL-266 (snapshot bootstrap)**: per-doc expected counts in `migration_baseline.json` + the survivor-policy decision above.');
  lines.push('');
  lines.push('## Output integrity');
  lines.push('');
  for (const [file, hash] of Object.entries(outputHashes)) lines.push(`- \`${file}\` sha256 \`${hash}\``);
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('missing Supabase URL or service key in .env/.env.local');
  const roGet = makeRoGet(url, key);

  let run = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      run = await runOnce(roGet, attempt);
      break;
    } catch (err) {
      if (err instanceof DriftError && attempt < MAX_ATTEMPTS) {
        console.warn(`[kal261] ${err.message} — retrying`);
        continue;
      }
      throw err;
    }
  }

  const built = buildOutputs(run);

  const totalUserDrawn = run.userDrawn.length;
  const se011Arch = built.perDocOut.find((d) => d.document_id.startsWith(EXPECTED.se011ArchPrefix));
  const pkg2Arch = built.perDocOut.find((d) => d.document_id.startsWith(EXPECTED.pkg2ArchPrefix));
  const checks = [
    check('heavy doc 70dadd86… unique embedded refs', EXPECTED.heavyDocUnique, built.heavy?.embedded_unique ?? -1),
    check('heavy doc 70dadd86… raw embedded rows', EXPECTED.heavyDocRaw, built.heavy?.embedded_raw ?? -1),
    check('total user-drawn marks (~)', EXPECTED.userDrawnApprox, totalUserDrawn, false),
    check('SE-011-ARCH 97f95b32… user-drawn', EXPECTED.se011ArchUserDrawn, se011Arch?.user_drawn ?? -1),
    check('Package2-ARCH d30ac66b… user-drawn', EXPECTED.pkg2ArchUserDrawn, pkg2Arch?.user_drawn ?? -1),
    check('table total at audit time (~, drift expected)', EXPECTED.auditTotal, run.before.total, false),
  ];
  // The expected-side of check() is what buildReport prints; observed mismatches
  // are reported honestly, never fudged. They do not abort the run.

  await mkdir(OUT_DIR, { recursive: true });

  const checkpointPath = join(OUT_DIR, 'user_drawn_marks_checkpoint.json');
  const survivorsPath = join(OUT_DIR, 'embedded_dedup_survivors.json');
  const baselinePath = join(OUT_DIR, 'migration_baseline.json');
  const reportPath = join(OUT_DIR, 'KAL-261-BASELINE-REPORT.md');
  const allPaths = [checkpointPath, survivorsPath, baselinePath];

  const checkpoint = {
    task: 'KAL-261', generated_at: run.cutoff, hash_scheme: HASH_SCHEME,
    count: built.marks.length, marks: built.marks,
  };
  const survivorsOut = {
    task: 'KAL-261', generated_at: run.cutoff, hash_scheme: HASH_SCHEME,
    key_format: '[document_id, effective_page, pdfAnnotationId] (JSON tuple — no delimiter ambiguity)',
    count: built.survivors.length,
    divergent_count: built.survivors.filter((s) => s.divergent).length,
    survivors: built.survivors,
  };
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 1));
  await writeFile(survivorsPath, JSON.stringify(survivorsOut, null, 1));

  const outputHashes = {
    'user_drawn_marks_checkpoint.json': sha256Hex(await readFile(checkpointPath, 'utf8')),
    'embedded_dedup_survivors.json': sha256Hex(await readFile(survivorsPath, 'utf8')),
  };

  const baseline = {
    task: 'KAL-261', generated_at: run.cutoff,
    run: {
      host: PROD_HOST,
      predicates: `created_at=lte.${run.cutoff}; classification: embedded === (fabricObject.isPdfImported === true); effective page = annotation_data.pageNumber ?? page_number (integers only)`,
      attempt: run.runStats.attempt,
      snapshot_before: run.before, snapshot_after: run.after,
      pages_fetched: run.runStats.page_batches.length,
      page_batches: run.runStats.page_batches,
      output_sha256: outputHashes,
    },
    totals: {
      annotation_rows: run.before.total,
      documents_total: run.documents.length,
      documents_with_annotations: built.perDocOut.length,
      user_drawn: totalUserDrawn,
      embedded_raw: run.before.total - totalUserDrawn,
      embedded_unique_keys: built.survivors.length,
      survivor_policy_divergent_keys: survivorsOut.divergent_count,
    },
    validation_checks: checks,
    anomalies: run.anomalies,
    documents: built.perDocOut,
    heavy_doc_detail: built.heavyDetail,
  };
  await writeFile(baselinePath, JSON.stringify(baseline, null, 1));

  // Leak guard: structural walk of every committed JSON.
  try {
    for (const p of allPaths) assertNoLeaks(JSON.parse(await readFile(p, 'utf8')));
  } catch (err) {
    await Promise.all(allPaths.map((p) => unlink(p).catch(() => {})));
    throw new Error(`output leak guard failed, outputs deleted: ${err.message}`);
  }

  await writeFile(reportPath, buildReport(run, built, checks, {
    ...outputHashes,
    'migration_baseline.json': sha256Hex(await readFile(baselinePath, 'utf8')),
  }));

  console.log('[kal261] DONE');
  for (const c of checks) console.log(`  ${c.pass ? 'CONFIRMED' : 'MISMATCH '} ${c.label}: expected ${c.expected}, observed ${c.observed}`);
  console.log(`  outputs in ${OUT_DIR}/`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    console.warn(`[kal261] ${failed.length} expectation(s) MISMATCHED — see report (fail-honest, outputs kept)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('[kal261] FAILED:', err.message); process.exit(1); });
}

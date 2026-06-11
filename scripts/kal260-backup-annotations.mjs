#!/usr/bin/env node
// KAL-260 — Full backup of document_annotations before any migration write.
// PRE-REBUILD-READINESS.md §4 Step 0, Gate B1.
//
// Produces a timestamped directory OUTSIDE the repo:
//   ~/SurveyBackups/kal260/<UTC-timestamp>/
//     raw-pages/page-00001.json …     byte-exact PostgREST response bodies
//     document_annotations.jsonl      derived: one parsed row per line
//     schema.openapi.json             PostgREST OpenAPI introspection (GET /)
//     MANIFEST.json                   counts, sha256s, snapshots, runbook
//
// Plus a committed, payload-free summary:
//   .planning/optimization/migration-baseline/KAL-260-BACKUP-MANIFEST.md
//
// Safety invariants (Codex-reviewed plan PLAN-KAL260.md, approved r2 + result
// review fixes):
//   - single GET-only roGet wrapper, origin hard-pinned to production host,
//     table whitelist {document_annotations} + named allowance for the bare
//     OpenAPI root GET /; no rpc endpoints, no DB client library, no request bodies
//   - every raw page body is persisted to disk the moment it is received,
//     BEFORE parsing — a parse crash never loses captured pages
//   - consistency: before/after snapshot + independent (id, updated_at) sweep;
//     sweep multiset must exactly equal the dump's; bounded 3-attempt re-pull
//     before DRIFT exit; UNSTABLE dir rename on final failure
//   - checkpoint integrity gate FIRST via KAL-262 pinned sha256s
//   - ground-truth cross-check verifies THE DUMP ITSELF (615 user-drawn +
//     10,960 embedded keys, all three policies): anchor inputs are built from
//     rows parsed out of the dump, never from a fresh prod re-pull; only the
//     by-id attribution probes touch prod. A corrupted dump FAILS even when
//     prod is healthy.
//   - schema completeness gate: union of dump row keys must cover the 9
//     required columns AND exactly equal the OpenAPI column set; mismatch = FAIL
//   - file-integrity reread gate: raw pages + JSONL are re-read from disk,
//     re-parsed, recounted, re-hashed; any divergence from the in-memory
//     values = FAIL
//   - exit precedence FAIL(1) > DRIFT(2) > PASS(0); ANY attributed
//     post-baseline change (drift_explained > 0) caps the run at DRIFT —
//     attributed drift can never exit 0
//   - committed MANIFEST.md is allowlist-serialized (no annotation_data content)
//   - buildRestoreBatches is inert data (returns descriptions, never sends)
//   - exactly ONE fetchImpl call site in this file (inside the roGet wrapper)
//   - dump dir lives outside the repo; never committed

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../agent-cli/lib/env.mjs';
import {
  OUT_DIR,
  PROD_HOST,
  aggregate,
  payloadHash,
  pickSurvivors,
  sha256Hex,
  snapshotTable,
} from './kal261-baseline-dedup-preview.mjs';
import {
  PINNED_BASELINE_SHA256,
  POLICIES,
  aggregateExitCode,
  anchorSurvivors,
  anchorUserDrawn,
  verifyCheckpointIntegrity,
  writeAtomically,
} from './kal262-zero-loss-harness.mjs';

export const BACKUP_TABLE = 'document_annotations';
// The single allowed table for the backup dump. The OpenAPI root (GET /)
// is allowed via the ALLOWED_OPENAPI_PATH named constant below.
const BACKUP_ALLOWED = new Set([BACKUP_TABLE]);
const ALLOWED_OPENAPI_PATH = '/rest/v1/'; // bare GET / to PostgREST

const PAGE_SIZE = 1000;   // must be <= the server-side PostgREST cap (1000)
const MAX_ATTEMPTS = 3;

// The 9 columns every dump row must carry (plan §4.3).
export const REQUIRED_COLUMNS = [
  'id', 'document_id', 'user_id', 'annotation_type', 'annotation_id',
  'page_number', 'annotation_data', 'created_at', 'updated_at',
];

// ---------------------------------------------------------------------------
// Fetch layer — single call site, GET-only, origin-pinned
// ---------------------------------------------------------------------------

// makeBackupRoGet returns a fetch wrapper with:
//   roGet(table, params, opts) → { rows, contentRange, rawBody }
//
// rawBody is the byte-exact response text captured BEFORE parsing.  With
// { raw: true } the body is NOT parsed at all (rows is null) so the caller
// can persist it first and parse afterwards.  All network calls in this
// script route through the same closure — there is exactly ONE fetchImpl
// call site in this file.
export function makeBackupRoGet(baseUrl, serviceKey, fetchImpl = fetch) {
  const parsed = new URL(baseUrl);
  if (parsed.origin !== `https://${PROD_HOST}`) {
    throw new Error(
      `refusing to run: origin "${parsed.origin}" is not https://${PROD_HOST}`,
    );
  }
  const base = baseUrl.replace(/\/+$/, '');

  return async function roGet(tableOrPath, params, { prefer, openApi = false, raw = false } = {}) {
    let url;
    let headers;

    if (openApi) {
      // Named allowance for the bare OpenAPI root (GET /) — no table whitelist.
      url = `${base}${ALLOWED_OPENAPI_PATH}`;
      headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      };
    } else {
      // Normal table GET — whitelist + rpc-path guard.
      if (!BACKUP_ALLOWED.has(tableOrPath)) {
        throw new Error(`roGet: table not whitelisted: ${tableOrPath}`);
      }
      if (params && /\/rpc\//.test(params)) {
        throw new Error('roGet: rpc endpoints are not allowed');
      }
      url = `${base}/rest/v1/${tableOrPath}?${params}`;
      headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      };
      if (prefer) headers.Prefer = prefer;
    }

    // The single HTTP call site in this file. fetchImpl defaults to the
    // global fetch; tests inject a fake implementation to avoid network calls.
    const res = await fetchImpl(url, { method: 'GET', headers });

    if (res.status !== 200 && res.status !== 206) {
      throw new Error(
        `roGet ${openApi ? 'OpenAPI' : tableOrPath} failed: HTTP ${res.status}`,
      );
    }
    const rawBody = await res.text();
    if (openApi || raw) {
      return { rows: null, contentRange: res.headers.get('content-range'), rawBody };
    }
    return {
      rows: JSON.parse(rawBody),
      contentRange: res.headers.get('content-range'),
      rawBody,
    };
  };
}

// ---------------------------------------------------------------------------
// Keyset dump — raw page persisted on receipt, THEN parsed
// ---------------------------------------------------------------------------

// fetchDump pulls all rows via keyset pagination.
// Returns { rows, rawPages, jsonlLines } where rawPages is
// [{ filename, body }] and body is the verbatim response text.
// pageSize defaults to PAGE_SIZE (1000); injectable for unit tests.
// onRawPage(filename, body), when provided, is awaited for every page body
// BEFORE the body is parsed — so a malformed page is already safe on disk
// when the parse failure aborts the dump (review finding 6).
export async function fetchDump(roGet, { pageSize = PAGE_SIZE, onRawPage = null } = {}) {
  const rawPages = [];
  const jsonlLines = [];
  const allRows = [];
  const seenIds = new Set();
  let lastId = null;
  let pageNum = 0;

  for (;;) {
    pageNum += 1;
    const filter = lastId ? `&id=gt.${encodeURIComponent(lastId)}` : '';
    const params = `select=*&order=id.asc&limit=${pageSize}${filter}`;

    // raw: true — the body is NOT parsed inside roGet; we persist it first.
    const { rawBody } = await roGet(BACKUP_TABLE, params, { raw: true });

    const filename = `page-${String(pageNum).padStart(5, '0')}.json`;
    if (onRawPage) await onRawPage(filename, rawBody);

    let pageRows;
    try {
      pageRows = JSON.parse(rawBody);
    } catch (err) {
      throw new Error(
        `dump page ${pageNum} (${filename}): body persisted but failed to parse: ${err.message}`,
      );
    }
    if (!Array.isArray(pageRows)) {
      throw new Error(`dump page ${pageNum} (${filename}): body persisted but is not a JSON array`);
    }

    rawPages.push({ filename, body: rawBody });

    if (pageRows.length === 0) break;

    // Cross-page duplicate id detection
    for (const r of pageRows) {
      if (seenIds.has(r.id)) {
        throw new Error(`duplicate id ${r.id} detected across dump pages`);
      }
      seenIds.add(r.id);
    }

    for (const r of pageRows) {
      allRows.push(r);
      jsonlLines.push(JSON.stringify(r));
    }

    lastId = pageRows[pageRows.length - 1].id;
    if (pageRows.length < pageSize) break;
  }

  return { rows: allRows, rawPages, jsonlLines };
}

// ---------------------------------------------------------------------------
// Precision tripwire
// ---------------------------------------------------------------------------

// Scans an array of { filename, body } raw pages and returns any unsafe
// integer-valued number tokens.  These are not expected (uuid ids are strings);
// any findings are recorded in MANIFEST.json for human review.
export function scanPrecisionWarnings(rawPages) {
  const warnings = [];
  // Match bare numeric tokens (not inside quotes, not preceded by letter/digit)
  const intTokenRe = /(?<!["\w])-?\d+(?:\.\d+)?(?!["\w.\d])/g;
  for (const { filename, body } of rawPages) {
    for (const m of body.matchAll(intTokenRe)) {
      const n = Number(m[0]);
      if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
        warnings.push({ page: filename, token: m[0], value: n });
      }
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Sweep comparator — independent (id, updated_at) keyset pass
// ---------------------------------------------------------------------------

// Fetch (id, updated_at) for every row; returns a Map<id, updated_at>.
export async function fetchSweep(roGet) {
  const map = new Map();
  let lastId = null;
  for (;;) {
    const filter = lastId ? `&id=gt.${encodeURIComponent(lastId)}` : '';
    const { rows } = await roGet(
      BACKUP_TABLE,
      `select=id,updated_at&order=id.asc&limit=${PAGE_SIZE}${filter}`,
    );
    if (rows.length === 0) break;
    for (const r of rows) map.set(r.id, r.updated_at);
    lastId = rows[rows.length - 1].id;
    if (rows.length < PAGE_SIZE) break;
  }
  return map;
}

// Compare the dump row set against the sweep multiset.
// Returns { pass: bool, reason: string|null }.
// Detects: count mismatches, same-count id swaps, updated_at drift.
export function compareSweepTodump(dumpRows, sweepMap) {
  if (dumpRows.length !== sweepMap.size) {
    return {
      pass: false,
      reason: `row count mismatch: dump=${dumpRows.length} sweep=${sweepMap.size}`,
    };
  }
  for (const row of dumpRows) {
    if (!sweepMap.has(row.id)) {
      return {
        pass: false,
        reason: `id ${row.id} present in dump but absent in sweep`,
      };
    }
    const sweepUpdatedAt = sweepMap.get(row.id);
    if (sweepUpdatedAt !== row.updated_at) {
      return {
        pass: false,
        reason: `updated_at drift on id ${row.id}: dump=${row.updated_at} sweep=${sweepUpdatedAt}`,
      };
    }
  }
  // Verify sweep has no extra ids (count already equal above, so only need
  // to check that every sweep id is in the dump)
  const dumpIds = new Set(dumpRows.map((r) => r.id));
  for (const id of sweepMap.keys()) {
    if (!dumpIds.has(id)) {
      return {
        pass: false,
        reason: `id ${id} present in sweep but absent in dump`,
      };
    }
  }
  return { pass: true, reason: null };
}

// ---------------------------------------------------------------------------
// Ground-truth inputs — built FROM THE DUMP, never from a fresh prod re-pull
// ---------------------------------------------------------------------------

// The dump (select=* full rows) is the verification subject (review finding 1):
// derive the same projections KAL-261's pass-1 would have produced
// (annotation_data->pageNumber, ->fabricObject->isPdfImported,
// ->fabricObject->pdfAnnotationId), restrict to created_at <= the baseline
// cutoff, then classify + pick survivors + hash with the generator's own code.
// The anchor functions then compare these dump-derived values against the
// committed checkpoints; only their by-id attribution probes touch prod.
export function buildGroundTruthInputs(dumpRows, cutoff) {
  const cutoffMs = Date.parse(cutoff);
  const pinned = dumpRows.filter((r) => {
    const c = Date.parse(r.created_at ?? '');
    return Number.isFinite(c) && c <= cutoffMs;
  });

  // PostgREST `->` projections return null for missing paths; mirror that.
  const pass1Shaped = pinned.map((r) => {
    const data = (r.annotation_data && typeof r.annotation_data === 'object' && !Array.isArray(r.annotation_data))
      ? r.annotation_data
      : {};
    const fab = (data.fabricObject && typeof data.fabricObject === 'object' && !Array.isArray(data.fabricObject))
      ? data.fabricObject
      : {};
    return {
      id: r.id,
      annotation_id: r.annotation_id,
      document_id: r.document_id,
      page_number: r.page_number,
      annotation_type: r.annotation_type,
      user_id: r.user_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      dataPageNumber: data.pageNumber ?? null,
      isPdfImported: fab.isPdfImported ?? null,
      pdfAnnotationId: fab.pdfAnnotationId ?? null,
    };
  });

  const { perDoc, anomalies, userDrawn } = aggregate(pass1Shaped);

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
      for (const p of POLICIES) survivorIds.add(picks[p]);
    }
  }

  // Full rows come from the dump itself — hashing the backup artifact, not prod.
  const fullRowsById = new Map(pinned.map((r) => [r.id, r]));
  const freshHashById = new Map();
  for (const r of userDrawn) {
    freshHashById.set(r.id, payloadHash(fullRowsById.get(r.id)));
  }
  const freshEmbeddedHashById = new Map();
  for (const id of survivorIds) {
    freshEmbeddedHashById.set(
      id,
      payloadHash(fullRowsById.get(id), { excludeAnnotationId: true }),
    );
  }

  const anomalyCount = Object.values(anomalies).reduce((n, b) => n + b.count, 0);
  return {
    userDrawn, freshSurvivors, fullRowsById,
    freshHashById, freshEmbeddedHashById,
    anomalies, anomalyCount,
  };
}

// ---------------------------------------------------------------------------
// Schema completeness gate (review finding 3)
// ---------------------------------------------------------------------------

// Union of top-level row keys across the dump must (a) be a superset of the
// 9 required columns and (b) exactly equal the column set extracted from the
// captured OpenAPI schema for document_annotations.  Extras beyond the 9
// required are recorded verbatim and allowed only when present in the schema;
// any direction of mismatch with the schema is a FAIL.
export function checkSchemaCompleteness(dumpRows, schemaJsonText) {
  const union = new Set();
  for (const r of dumpRows) {
    for (const k of Object.keys(r)) union.add(k);
  }

  let schemaColumns;
  try {
    const parsed = JSON.parse(schemaJsonText);
    const props = parsed?.definitions?.[BACKUP_TABLE]?.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      return {
        pass: false,
        reason: `schema.openapi.json has no definitions.${BACKUP_TABLE}.properties`,
        missingRequired: [], rowKeysNotInSchema: [], schemaColumnsNotInDump: [],
        extras: [], schemaColumns: [],
      };
    }
    schemaColumns = new Set(Object.keys(props));
  } catch (err) {
    return {
      pass: false,
      reason: `schema.openapi.json unparseable: ${err.message}`,
      missingRequired: [], rowKeysNotInSchema: [], schemaColumnsNotInDump: [],
      extras: [], schemaColumns: [],
    };
  }

  const missingRequired = REQUIRED_COLUMNS.filter((c) => !union.has(c));
  const rowKeysNotInSchema = [...union].filter((k) => !schemaColumns.has(k)).sort();
  const schemaColumnsNotInDump = [...schemaColumns].filter((k) => !union.has(k)).sort();
  const extras = [...union].filter((k) => !REQUIRED_COLUMNS.includes(k)).sort();

  const pass = missingRequired.length === 0
    && rowKeysNotInSchema.length === 0
    && schemaColumnsNotInDump.length === 0;
  return {
    pass,
    reason: pass ? null : 'schema completeness mismatch (see fields)',
    missingRequired,
    rowKeysNotInSchema,
    schemaColumnsNotInDump,
    extras,
    schemaColumns: [...schemaColumns].sort(),
  };
}

// ---------------------------------------------------------------------------
// File-integrity reread gate (review finding 4)
// ---------------------------------------------------------------------------

// Re-read raw pages + JSONL FROM DISK, recompute sha256s, re-parse every JSONL
// line, recount rows; any divergence from the in-memory values is a FAIL.
// readFileImpl is injectable for unit tests.
export async function verifyArtifactsOnDisk({
  rawPages,
  expectedRawShas,
  rawPagesDir,
  jsonlPath,
  expectedJsonlSha256,
  expectedRowCount,
  readFileImpl = readFile,
}) {
  const problems = [];

  for (let i = 0; i < rawPages.length; i += 1) {
    const { filename } = rawPages[i];
    try {
      const onDisk = await readFileImpl(join(rawPagesDir, filename), 'utf8');
      if (sha256Hex(onDisk) !== expectedRawShas[i]) {
        problems.push(`raw page ${filename}: sha256 mismatch on reread`);
      }
    } catch (err) {
      problems.push(`raw page ${filename}: reread failed (${err.message})`);
    }
  }

  let jsonlOnDisk = null;
  try {
    jsonlOnDisk = await readFileImpl(jsonlPath, 'utf8');
  } catch (err) {
    problems.push(`jsonl reread failed (${err.message})`);
  }
  if (jsonlOnDisk !== null) {
    if (sha256Hex(jsonlOnDisk) !== expectedJsonlSha256) {
      problems.push('jsonl: sha256 mismatch on reread');
    }
    let parsedCount = 0;
    if (jsonlOnDisk.length > 0) {
      for (const line of jsonlOnDisk.split('\n')) {
        try {
          JSON.parse(line);
          parsedCount += 1;
        } catch {
          problems.push(`jsonl line ${parsedCount + 1}: failed to parse on reread`);
          break;
        }
      }
    }
    if (parsedCount !== expectedRowCount) {
      problems.push(`jsonl reread row count ${parsedCount} != expected ${expectedRowCount}`);
    }
  }

  return { pass: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Exit-code aggregation (review finding 2)
// ---------------------------------------------------------------------------

// FAIL(1) > DRIFT(2) > PASS(0), with the KAL-260 strengthening: ANY attributed
// post-baseline change (drift_explained > 0 from either anchor) counts as
// table movement and caps the run at DRIFT — attributed drift can never
// produce exit 0. Unexplained diffs / verify failures stay FAIL.
export function computeBackupExitCode({
  isDrift,
  driftExplainedCount = 0,
  anyUnexplained = false,
  anyVerifyFail = false,
}) {
  return aggregateExitCode({
    selfTestPass: true, // no self-test stage in the backup script
    anyUnexplained,
    anyVerifyFail,
    tableMoved: isDrift || driftExplainedCount > 0,
  });
}

// ---------------------------------------------------------------------------
// Restore-request builder (inert by construction — never executed here)
// ---------------------------------------------------------------------------

// Returns an array of restore-request DESCRIPTIONS as plain data.  This
// function never executes any request and the script contains no code path
// that can send them.  The method: 'POST' literal is intentionally present
// as string data so the runbook is self-contained; the write-leak source scan
// asserts there is exactly one fetchImpl call site in this file (in roGet
// above) and that the POST literal is merely inert data in the return value.
export function buildRestoreBatches(rows, batchSize = 500) {
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    // PostgREST bulk insert takes a JSON ARRAY body under application/json
    // (it has no NDJSON support) — the runbook replay depends on this shape.
    const body = JSON.stringify(slice);
    batches.push({
      method: 'POST',
      path: `/rest/v1/${BACKUP_TABLE}`,
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      preferResolution: 'merge-duplicates',
      conflictTarget: 'id',
      body,
      rowCount: slice.length,
      offset: i,
    });
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Restore runbook (static data, exported for tests)
// ---------------------------------------------------------------------------

export const RESTORE_RUNBOOK = {
  target_table: BACKUP_TABLE,
  fk_prerequisites:
    'parent documents rows and auth.users must exist, or FK constraints must be '
    + 'temporarily dropped before restore; restore documents table first, then annotations',
  conflict_mode: 'resolution=merge-duplicates on id (upsert); batch size <= 1000 (PostgREST cap)',
  batch_size: 500,
  sequence_note: 'document_annotations.id is a UUID (no sequence); no identity reset needed',
  // Honest wording (review finding 5): this script CANNOT be pointed at a
  // restore target — its origin is hard-pinned to production by design.
  verification_after_restore:
    'export the restored table with an equivalent keyset GET pagination '
    + '(select=*&order=id.asc&limit=1000, id=gt.<last> cursor) and compare '
    + 'per-row content against document_annotations.jsonl from this backup. '
    + 'NOTE: this script hard-pins the production origin '
    + '(https://cvamwtpsuvxvjdnotbeg.supabase.co) and will refuse to run '
    + 'against any restore target — adapting the origin pin for a drill is a '
    + 'deliberate manual step, not something this tool does automatically.',
  residual:
    "restore drill into a scratch schema/project on Isaiah's go; "
    + 'FK parents do not exist in survey-test and seeding that project '
    + 'autonomously is the wrong call',
};

// ---------------------------------------------------------------------------
// Committed manifest serializer (allowlist — no annotation_data content)
// ---------------------------------------------------------------------------

const MANIFEST_MD_ALLOWED_KEYS = new Set([
  'task', 'generated_at', 'host', 'output_dir', 'row_count', 'page_count',
  'jsonl_sha256', 'raw_pages_sha256', 'schema_sha256',
  'snapshot_before', 'snapshot_after', 'sweep_result',
  'checkpoint_integrity', 'ground_truth_result', 'schema_check',
  'file_integrity', 'exit_code', 'verdict',
  'precision_warnings_count', 'restore_runbook',
  // snapshot sub-keys
  'total', 'maxUpdatedAt',
  // restore runbook sub-keys
  'target_table', 'fk_prerequisites', 'conflict_mode', 'batch_size',
  'sequence_note', 'verification_after_restore', 'residual',
]);

export function serializeManifestMd(data) {
  // Walk data; reject any key not in the allowlist (belt: structural guard)
  function walk(obj, path) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) {
      if (!MANIFEST_MD_ALLOWED_KEYS.has(k)) {
        throw new Error(
          `manifest allowlist: forbidden key "${k}" at ${path}.${k}`,
        );
      }
      walk(obj[k], `${path}.${k}`);
    }
  }
  walk(data, '$');

  const lines = [
    '# KAL-260 Backup Manifest',
    '',
    `Generated: ${data.generated_at}`,
    `Host: \`${data.host}\``,
    `Output dir: \`${data.output_dir}\``,
    '',
    '## Counts',
    '',
    `- Rows: ${data.row_count}`,
    `- Raw pages: ${data.page_count}`,
    `- Precision warnings: ${data.precision_warnings_count}`,
    '',
    '## File SHA-256s',
    '',
    `- \`document_annotations.jsonl\`: \`${data.jsonl_sha256}\``,
    `- Raw pages combined: \`${data.raw_pages_sha256}\``,
    `- \`schema.openapi.json\`: \`${data.schema_sha256}\``,
    '',
    '## Snapshots',
    '',
    `Before: ${data.snapshot_before.total} rows, max_updated_at ${data.snapshot_before.maxUpdatedAt}`,
    `After:  ${data.snapshot_after.total} rows, max_updated_at ${data.snapshot_after.maxUpdatedAt}`,
    '',
    '## Sweep',
    '',
    `Result: ${data.sweep_result}`,
    '',
    '## Checkpoint Integrity',
    '',
    `${data.checkpoint_integrity}`,
    '',
    '## Ground-Truth Cross-Check (dump-derived)',
    '',
    `${data.ground_truth_result}`,
    '',
    '## Schema Completeness',
    '',
    `${data.schema_check}`,
    '',
    '## File Integrity (disk reread)',
    '',
    `${data.file_integrity}`,
    '',
    '## Gate B1 Verdict',
    '',
    `Exit code: **${data.exit_code}** — **${data.verdict}**`,
    '',
    (data.exit_code === 0)
      ? 'Gate B1 SATISFIED. Off-database export confirmed complete (count + file-hash + ground-truth verified); restore path documented, schema-grounded, and unit-tested — live restore drill remains a human-gated residual.'
      : 'Gate B1 NOT SATISFIED. See MANIFEST.json for details.',
    '',
    '## Restore Runbook',
    '',
    `Target table: \`${data.restore_runbook.target_table}\``,
    `FK prerequisites: ${data.restore_runbook.fk_prerequisites}`,
    `Conflict mode: ${data.restore_runbook.conflict_mode}`,
    `Batch size: ${data.restore_runbook.batch_size}`,
    `Sequence note: ${data.restore_runbook.sequence_note}`,
    `Verification after restore: ${data.restore_runbook.verification_after_restore}`,
    `Residual: ${data.restore_runbook.residual}`,
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Drift / retry classification
// ---------------------------------------------------------------------------

export class DriftError extends Error {}

// ---------------------------------------------------------------------------
// One full attempt: dump + sweep + snapshot consistency
// ---------------------------------------------------------------------------

async function runBackupAttempt(roGet, attempt, { rawPagesDir }) {
  console.log(`[kal260] attempt ${attempt}: starting dump`);

  // Reset the raw-pages dir so a retry never interleaves stale pages from a
  // previous attempt with the final dump. On total failure the LAST attempt's
  // pages remain on disk for forensics (finding 6).
  await rm(rawPagesDir, { recursive: true, force: true });
  await mkdir(rawPagesDir, { recursive: true });

  const snapshotBefore = await snapshotTable(roGet);
  console.log(
    `[kal260] snapshot before: ${snapshotBefore.total} rows, max_updated_at ${snapshotBefore.maxUpdatedAt}`,
  );

  // Full keyset dump — every raw body hits disk BEFORE it is parsed.
  const dump = await fetchDump(roGet, {
    pageSize: PAGE_SIZE,
    onRawPage: (filename, body) => writeFile(join(rawPagesDir, filename), body),
  });
  console.log(
    `[kal260] dump: ${dump.rows.length} rows in ${dump.rawPages.length} pages`,
  );

  const snapshotAfter = await snapshotTable(roGet);
  console.log(
    `[kal260] snapshot after: ${snapshotAfter.total} rows, max_updated_at ${snapshotAfter.maxUpdatedAt}`,
  );

  // Snapshot consistency check
  if (snapshotBefore.total !== snapshotAfter.total
      || snapshotBefore.maxUpdatedAt !== snapshotAfter.maxUpdatedAt) {
    throw new DriftError(
      `table drifted during dump (before ${snapshotBefore.total}/${snapshotBefore.maxUpdatedAt}, `
      + `after ${snapshotAfter.total}/${snapshotAfter.maxUpdatedAt})`,
    );
  }

  // Row count vs snapshot
  if (dump.rows.length !== snapshotBefore.total) {
    throw new DriftError(
      `dump row count ${dump.rows.length} != snapshot count ${snapshotBefore.total}`,
    );
  }

  // Independent sweep: (id, updated_at) multiset must exactly equal dump's
  console.log(`[kal260] running sweep...`);
  const sweepMap = await fetchSweep(roGet);
  const sweepResult = compareSweepTodump(dump.rows, sweepMap);
  if (!sweepResult.pass) {
    throw new DriftError(`sweep mismatch: ${sweepResult.reason}`);
  }
  console.log(`[kal260] sweep PASS`);

  return { dump, snapshotBefore, snapshotAfter };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('missing Supabase URL or service key in .env/.env.local');
  }

  // Exact https origin pin (host alone would admit http://)
  const origin = new URL(url).origin;
  if (origin !== `https://${PROD_HOST}`) {
    throw new Error(`refusing to run: origin "${origin}" is not https://${PROD_HOST}`);
  }

  const roGet = makeBackupRoGet(url, key);

  // ---- Phase A — checkpoint integrity gate (pinned sha256s; must pass first)
  console.log(`[kal260] verifying checkpoint integrity...`);
  const fileTexts = {};
  for (const name of Object.keys(PINNED_BASELINE_SHA256)) {
    fileTexts[name] = await readFile(join(OUT_DIR, name), 'utf8');
  }
  const baselineFiles = verifyCheckpointIntegrity(fileTexts);
  const checkpoint = baselineFiles['user_drawn_marks_checkpoint.json'];
  const survivorsFile = baselineFiles['embedded_dedup_survivors.json'];
  const migrationBaseline = baselineFiles['migration_baseline.json'];
  const cutoff = migrationBaseline.generated_at;
  console.log(`[kal260] checkpoint integrity PASSED; baseline cutoff ${cutoff}`);

  // ---- Output directory (outside the repo)
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(homedir(), 'SurveyBackups', 'kal260', ts);
  const rawPagesDir = join(outDir, 'raw-pages');
  await mkdir(rawPagesDir, { recursive: true });
  console.log(`[kal260] output dir: ${outDir}`);

  // ---- OpenAPI schema capture (named allowance; same roGet closure)
  console.log(`[kal260] fetching OpenAPI schema...`);
  const { rawBody: schemaText } = await roGet(null, null, { openApi: true });
  const schemaPath = join(outDir, 'schema.openapi.json');
  await writeFile(schemaPath, schemaText);
  const schemaSha256 = sha256Hex(schemaText);
  console.log(`[kal260] schema captured (${schemaText.length} bytes)`);

  // ---- Bounded 3-attempt dump + sweep (raw pages persist inside the attempt)
  let dumpResult = null;
  let driftReason = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      dumpResult = await runBackupAttempt(roGet, attempt, { rawPagesDir });
      break;
    } catch (err) {
      driftReason = err.message;
      if (err instanceof DriftError && attempt < MAX_ATTEMPTS) {
        console.warn(`[kal260] ${err.message} — retrying (attempt ${attempt})`);
        continue;
      }
      // On final attempt or non-drift error, break and fall through to DRIFT handling
      break;
    }
  }

  const isDrift = dumpResult === null;
  const { dump, snapshotBefore, snapshotAfter } = dumpResult ?? {
    dump: { rows: [], rawPages: [], jsonlLines: [] },
    snapshotBefore: { total: 0, maxUpdatedAt: null },
    snapshotAfter: { total: 0, maxUpdatedAt: null },
  };

  // ---- Derived JSONL (raw pages already on disk via onRawPage)
  const rawPageShas = dump.rawPages.map(({ body }) => sha256Hex(body));
  const combinedRawSha = sha256Hex(rawPageShas.join('\n'));

  const jsonlText = dump.jsonlLines.join('\n');
  const jsonlPath = join(outDir, 'document_annotations.jsonl');
  await writeFile(jsonlPath, jsonlText);
  const jsonlSha256 = sha256Hex(jsonlText);

  // ---- Precision warnings
  const precisionWarnings = scanPrecisionWarnings(dump.rawPages);
  if (precisionWarnings.length > 0) {
    console.warn(
      `[kal260] PRECISION WARNING: ${precisionWarnings.length} unsafe integer token(s) in raw pages`,
    );
  }

  let anyUnexplained = false;
  let anyVerifyFail = false;
  let driftExplainedCount = 0;

  // ---- File-integrity reread gate (review finding 4)
  let fileIntegrityResult = 'SKIPPED (dump failed due to DRIFT)';
  if (!isDrift) {
    const fileCheck = await verifyArtifactsOnDisk({
      rawPages: dump.rawPages,
      expectedRawShas: rawPageShas,
      rawPagesDir,
      jsonlPath,
      expectedJsonlSha256: jsonlSha256,
      expectedRowCount: dump.rows.length,
    });
    fileIntegrityResult = fileCheck.pass
      ? `PASS — ${dump.rawPages.length} raw pages + JSONL reread, re-parsed, re-hashed OK`
      : `FAIL — ${fileCheck.problems.join('; ')}`;
    if (!fileCheck.pass) anyVerifyFail = true;
    console.log(`[kal260] file integrity: ${fileIntegrityResult}`);
  }

  // ---- Schema completeness gate (review finding 3)
  let schemaCheckResult = 'SKIPPED (dump failed due to DRIFT)';
  if (!isDrift && dump.rows.length > 0) {
    const schemaCheck = checkSchemaCompleteness(dump.rows, schemaText);
    schemaCheckResult = schemaCheck.pass
      ? `PASS — row-key union covers all ${REQUIRED_COLUMNS.length} required columns and exactly equals the OpenAPI column set (${schemaCheck.schemaColumns.length} columns); extras beyond required: ${JSON.stringify(schemaCheck.extras)}`
      : `FAIL — ${schemaCheck.reason}; missing required: ${JSON.stringify(schemaCheck.missingRequired)}; row keys not in schema: ${JSON.stringify(schemaCheck.rowKeysNotInSchema)}; schema columns not in dump: ${JSON.stringify(schemaCheck.schemaColumnsNotInDump)}`;
    if (!schemaCheck.pass) anyVerifyFail = true;
    console.log(`[kal260] schema completeness: ${schemaCheckResult}`);
  }

  // ---- Ground-truth cross-check, DUMP-DERIVED (review finding 1)
  let groundTruthResult = 'SKIPPED (dump failed due to DRIFT)';
  if (!isDrift && dump.rows.length > 0) {
    console.log(`[kal260] running ground-truth cross-check against the dump...`);
    try {
      // All anchor inputs come from the dump rows; prod is touched only by
      // the by-id attribution probes below.
      const gt = buildGroundTruthInputs(dump.rows, cutoff);

      const probeById = async (id) => {
        const { rows } = await roGet(
          BACKUP_TABLE,
          `select=id,created_at,updated_at&id=eq.${encodeURIComponent(id)}`,
        );
        return rows[0] ?? null;
      };

      const anchorUD = await anchorUserDrawn({
        checkpoint,
        freshUserDrawn: gt.userDrawn,
        freshHashById: gt.freshHashById,
        freshRowsById: gt.fullRowsById,
        probeById,
        cutoff,
      });
      const anchorEM = await anchorSurvivors({
        survivorsFile,
        freshSurvivors: gt.freshSurvivors,
        freshHashById: gt.freshEmbeddedHashById,
        freshRowsById: gt.fullRowsById,
        probeById,
        cutoff,
      });

      driftExplainedCount =
        anchorUD.drift_explained.length + anchorEM.drift_explained.length;
      anyUnexplained =
        anchorUD.unexplained.length > 0
        || anchorEM.unexplained.length > 0
        || gt.anomalyCount > 0;
      groundTruthResult = anyUnexplained
        ? `FAIL — unexplained diffs: UD=${anchorUD.unexplained.length} EM=${anchorEM.unexplained.length} anomalies=${gt.anomalyCount}`
        : `${driftExplainedCount > 0 ? 'DRIFT' : 'PASS'} — UD matched=${anchorUD.matched} drift=${anchorUD.drift_explained.length}; `
          + `EM matched=${anchorEM.matched} drift=${anchorEM.drift_explained.length} (dump-derived inputs)`;
      console.log(`[kal260] ground-truth: ${groundTruthResult}`);
    } catch (err) {
      anyVerifyFail = true;
      groundTruthResult = `FAIL (exception: ${err.message})`;
      console.error(`[kal260] ground-truth FAILED: ${err.message}`);
    }
  }

  // ---- Exit code (FAIL(1) > DRIFT(2) > PASS(0); attributed drift caps at 2)
  const exitCode = computeBackupExitCode({
    isDrift,
    driftExplainedCount,
    anyUnexplained,
    anyVerifyFail,
  });
  const verdictWord = exitCode === 0 ? 'PASS' : exitCode === 2 ? 'DRIFT' : 'FAIL';

  // ---- Restore-request builder (inert data; validates restorability evidence)
  const restoreBatches = buildRestoreBatches(dump.rows);

  // ---- MANIFEST.json
  const manifest = {
    task: 'KAL-260',
    generated_at: new Date().toISOString(),
    host: PROD_HOST,
    output_dir: outDir,
    row_count: dump.rows.length,
    page_count: dump.rawPages.length,
    precision_warnings_count: precisionWarnings.length,
    precision_warnings: precisionWarnings,
    jsonl_sha256: jsonlSha256,
    raw_pages_sha256: combinedRawSha,
    raw_page_shas: rawPageShas,
    schema_sha256: schemaSha256,
    snapshot_before: snapshotBefore,
    snapshot_after: snapshotAfter,
    sweep_result: isDrift ? `UNSTABLE — ${driftReason}` : 'PASS',
    checkpoint_integrity: 'PASSED (pinned sha256s verified)',
    ground_truth_result: groundTruthResult,
    ground_truth_drift_explained_count: driftExplainedCount,
    schema_check: schemaCheckResult,
    file_integrity: fileIntegrityResult,
    restore_runbook: RESTORE_RUNBOOK,
    restore_batch_count: restoreBatches.length,
    exit_code: exitCode,
    verdict: verdictWord,
  };

  const manifestPath = join(outDir, 'MANIFEST.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // ---- Handle UNSTABLE (drift) — rename dir
  if (isDrift) {
    const unstableDir = outDir + '.UNSTABLE';
    await rename(outDir, unstableDir);
    console.warn(`[kal260] DRIFT — dump dir renamed to ${unstableDir}`);
  }

  // ---- Committed MANIFEST.md (payload-free, allowlist-serialized)
  const manifestMdData = {
    task: 'KAL-260',
    generated_at: manifest.generated_at,
    host: PROD_HOST,
    output_dir: outDir,
    row_count: dump.rows.length,
    page_count: dump.rawPages.length,
    precision_warnings_count: precisionWarnings.length,
    jsonl_sha256: jsonlSha256,
    raw_pages_sha256: combinedRawSha,
    schema_sha256: schemaSha256,
    snapshot_before: snapshotBefore,
    snapshot_after: snapshotAfter,
    sweep_result: isDrift ? `UNSTABLE — ${driftReason}` : 'PASS',
    checkpoint_integrity: 'PASSED (pinned sha256s verified)',
    ground_truth_result: groundTruthResult,
    schema_check: schemaCheckResult,
    file_integrity: fileIntegrityResult,
    exit_code: exitCode,
    verdict: verdictWord,
    restore_runbook: RESTORE_RUNBOOK,
  };
  const manifestMdText = serializeManifestMd(manifestMdData);
  const manifestMdPath = join(OUT_DIR, 'KAL-260-BACKUP-MANIFEST.md');
  await writeAtomically(manifestMdPath, manifestMdText, null);
  console.log(`[kal260] committed manifest written: ${manifestMdPath}`);

  console.log(`[kal260] ${verdictWord} (exit ${exitCode})`);
  if (exitCode === 2) {
    console.warn('[kal260] DRIFT: table moved (during dump or vs baseline); Gate B1 NOT satisfied');
  } else if (exitCode === 1) {
    console.error('[kal260] FAIL: verification failed; Gate B1 NOT satisfied');
  } else {
    console.log('[kal260] Gate B1 SATISFIED');
  }

  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[kal260] FAILED:', err.message);
    process.exit(1);
  });
}

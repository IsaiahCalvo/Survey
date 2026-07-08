#!/usr/bin/env node
// content-hash-maintenance — Tier B item 1 (MASTER-PLAN-2026-07-07 §3, decision 6)
// + the held storage re-keying (KAL-281).
//
// Modes (dry-run is the DEFAULT everywhere; nothing is written without --apply):
//
//   node scripts/content-hash-maintenance.mjs audit
//     Read-only inventory: every documents row + every storage object in the
//     `documents` bucket, classified. Reports rows missing content_sha256,
//     rows on legacy time-named storage paths, orphan rows (no object), orphan
//     objects (no row), and sha collisions. Writes debug/content-hash/AUDIT-*.md/.json.
//
//   node scripts/content-hash-maintenance.mjs backfill [--apply]
//     For rows with content_sha256 IS NULL: download the object, hash it, and
//     (with --apply) write content_sha256 onto the row. A hash that would
//     collide with the (user, project, sha) unique index is REPORTED and
//     skipped, never auto-merged — merging rows moves user marks and is a
//     human decision.
//
//   node scripts/content-hash-maintenance.mjs rekey [--apply]
//     For rows that have a sha but still point at a legacy path: copy the
//     object to {user_id}/{sha}.pdf, verify the copy exists, repoint the row
//     (service_role bypasses the file_path-immutable trigger by design), and
//     delete the old object only after every row referencing it moved.
//
// Orphan objects are ONLY ever reported. Deleting them is Trash/GC territory
// (decision 7, Tier B item 2) and needs Isaiah's go regardless.
//
// Credentials: SUPABASE_MAINT_URL + SUPABASE_MAINT_SERVICE_KEY if set, else
// VITE_SUPABASE_URL (.env) + SUPABASE_SERVICE_ROLE_KEY (.env.local) — the
// production project. The target host is printed at startup either way.
//
// Pure planning helpers are exported for tests/contentHashMaintenance.test.mjs.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from '../agent-cli/lib/env.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'debug', 'content-hash');
const BUCKET = 'documents';
const SHA_HEX = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** The canonical content-addressed storage path for a row. */
export function contentPath(userId, sha) {
  return `${userId}/${sha}.pdf`;
}

/** Classify a storage object path within the documents bucket. */
export function classifyObjectPath(path) {
  const parts = String(path).split('/');
  const base = parts[parts.length - 1] || '';
  if (parts.length === 2 && SHA_HEX.test(base.replace(/\.pdf$/, '')) && base.endsWith('.pdf')) {
    return 'content-pdf';
  }
  if (base.endsWith('.pdf')) return 'legacy-pdf';
  if (base.endsWith('.json')) return 'data-json';
  return 'other';
}

/**
 * Plan the backfill: rows that need hashing, plus rows whose already-known sha
 * collides inside the (user, project, sha) unique-index scope.
 */
export function planBackfill(rows) {
  const needHash = rows.filter((r) => !r.content_sha256 && r.file_path);
  const noPath = rows.filter((r) => !r.content_sha256 && !r.file_path);
  return { needHash, noPath };
}

/** Unique-index key for a row (mirrors documents_user_project_sha_uidx). */
export function indexKey(userId, projectId, sha) {
  return `${userId}|${projectId ?? '00000000-0000-0000-0000-000000000000'}|${sha}`;
}

/**
 * Plan the re-key: rows with a sha whose file_path is not the canonical
 * content-addressed path.
 *
 * oldPathRefs counts references from EVERY row (moving or not) so an object
 * shared with a null-sha row still awaiting backfill, or with a row that
 * errors mid-run, is never deleted from under it — the count for such a path
 * can never reach zero in this run.
 *
 * Rows whose file_path does not live under their own user_id prefix are
 * excluded and reported: a pre-immutability-trigger doctored row could
 * otherwise make the script copy/delete ANOTHER user's object (see the
 * 2026-07-03 IDOR migration).
 */
export function planRekey(rows) {
  const moves = [];
  const foreignPrefix = [];
  const oldPathRefs = new Map(); // path -> count of ALL rows referencing it
  for (const r of rows) {
    if (r.file_path) oldPathRefs.set(r.file_path, (oldPathRefs.get(r.file_path) || 0) + 1);
  }
  for (const r of rows) {
    if (!r.content_sha256 || !r.file_path) continue;
    if (!String(r.file_path).startsWith(`${r.user_id}/`)) {
      foreignPrefix.push({ id: r.id, file_path: r.file_path, user_id: r.user_id });
      continue;
    }
    const target = contentPath(r.user_id, r.content_sha256);
    if (r.file_path === target) continue;
    moves.push({ id: r.id, from: r.file_path, to: target, sha: r.content_sha256 });
  }
  return { moves, oldPathRefs, foreignPrefix };
}

/** Orphans in both directions. Only PDF-ish objects can be orphans we care about. */
export function findOrphans(rows, objectPaths) {
  const referenced = new Set(rows.map((r) => r.file_path).filter(Boolean));
  const objects = new Set(objectPaths);
  const orphanRows = rows.filter((r) => r.file_path && !objects.has(r.file_path));
  const orphanObjects = objectPaths.filter(
    (p) => !referenced.has(p) && classifyObjectPath(p) !== 'data-json'
  );
  return { orphanRows, orphanObjects };
}

/** Sha collisions among rows (same user+project+sha appearing on 2+ rows). */
export function findShaCollisions(rows) {
  const byKey = new Map();
  for (const r of rows) {
    if (!r.content_sha256) continue;
    const k = indexKey(r.user_id, r.project_id, r.content_sha256);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r.id);
  }
  return [...byKey.entries()].filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

// ---------------------------------------------------------------------------
// Remote I/O
// ---------------------------------------------------------------------------

function makeClient() {
  loadEnv();
  const url = process.env.SUPABASE_MAINT_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_MAINT_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase URL or service key (SUPABASE_MAINT_URL/SUPABASE_MAINT_SERVICE_KEY or .env/.env.local).');
    process.exit(1);
  }
  const base = url.replace(/\/+$/, '');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    host: new URL(base).host,
    async rest(pathAndQuery, init = {}) {
      const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
        ...init,
        headers: { ...headers, 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
      if (!res.ok) throw new Error(`REST ${init.method || 'GET'} ${pathAndQuery} -> ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    },
    async storageList(prefix, offset) {
      const res = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!res.ok) throw new Error(`storage list ${prefix} -> ${res.status} ${await res.text()}`);
      return res.json();
    },
    async storageDownload(path) {
      const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, { headers });
      if (!res.ok) throw new Error(`storage download ${path} -> ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async storageExists(path) {
      // Cache-busting query param: the object endpoint can serve a stale 206
      // for a few seconds after uploads/deletes (observed on survey-test).
      const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}?cb=${Date.now()}`, {
        headers: { ...headers, Range: 'bytes=0-0', 'Cache-Control': 'no-cache' },
      });
      return res.status === 200 || res.status === 206;
    },
    async storageCopy(from, to) {
      const res = await fetch(`${base}/storage/v1/object/copy`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: BUCKET, sourceKey: from, destinationKey: to }),
      });
      // 409 = destination already exists — caller must verify its BYTES match
      // before trusting it (an existing-but-wrong object would swap contents).
      if (!res.ok && res.status !== 409) throw new Error(`storage copy ${from} -> ${to}: ${res.status} ${await res.text()}`);
      return res.status;
    },
    async storageRemove(paths) {
      const res = await fetch(`${base}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) throw new Error(`storage remove -> ${res.status} ${await res.text()}`);
    },
  };
}

async function fetchAllRows(client) {
  // Step by the RETURNED page size and stop only on an empty page: a
  // PostgREST max-rows cap below our 1000-item Range must not truncate the
  // walk silently.
  const rows = [];
  for (let from = 0; ;) {
    const page = await client.rest(
      `documents?select=id,user_id,project_id,name,file_path,file_size,content_sha256,archived,created_at&order=created_at.asc`,
      { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items', Prefer: 'count=exact' } }
    );
    rows.push(...page);
    if (page.length === 0) break;
    from += page.length;
  }
  return rows;
}

async function listAllObjects(client) {
  // The bucket nests one or two levels ({uid}/x.pdf and {uid}/{project}/x.pdf),
  // so walk folders breadth-first. A storage "folder" entry has id === null.
  const paths = [];
  const queue = [''];
  while (queue.length) {
    const prefix = queue.shift();
    for (let offset = 0; ;) {
      const entries = await client.storageList(prefix, offset);
      for (const e of entries) {
        const full = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) queue.push(full);
        else paths.push(full);
      }
      if (entries.length === 0) break;
      offset += entries.length;
    }
  }
  return paths;
}

const sha256hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');

async function writeReport(name, md, json) {
  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdPath = join(OUT_DIR, `${name}-${stamp}.md`);
  await writeFile(mdPath, md);
  await writeFile(join(OUT_DIR, `${name}-${stamp}.json`), JSON.stringify(json, null, 2));
  return mdPath;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function gather(client) {
  const [rows, objects] = await Promise.all([fetchAllRows(client), listAllObjects(client)]);
  const byClass = { 'content-pdf': [], 'legacy-pdf': [], 'data-json': [], other: [] };
  for (const p of objects) byClass[classifyObjectPath(p)].push(p);
  return { rows, objects, byClass };
}

async function runAudit(client) {
  const { rows, objects, byClass } = await gather(client);
  const { needHash, noPath } = planBackfill(rows);
  const { moves, foreignPrefix } = planRekey(rows);
  const { orphanRows, orphanObjects } = findOrphans(rows, objects);
  const collisions = findShaCollisions(rows);
  const active = rows.filter((r) => !r.archived);

  const md = `# Content-hash audit — ${client.host}

READ-ONLY. Nothing was modified.

## Documents rows
- total: ${rows.length} (active ${active.length}, archived ${rows.length - active.length})
- with content_sha256: ${rows.length - needHash.length - noPath.length} (${pct(rows.length - needHash.length - noPath.length, rows.length)})
- **needing backfill (null sha, has file): ${needHash.length}**
- null sha AND null file_path (unfixable rows): ${noPath.length}
- sha collisions inside the unique-index scope: ${collisions.length}

## Storage objects (bucket "${BUCKET}")
- total: ${objects.length}
- content-addressed PDFs: ${byClass['content-pdf'].length}
- **legacy time-named PDFs: ${byClass['legacy-pdf'].length}**
- data JSON artifacts (never touched): ${byClass['data-json'].length}
- other: ${byClass.other.length}

## Planned work
- backfill writes (after hashing): up to ${needHash.length} rows
- re-key moves: ${moves.length} rows across ${new Set(moves.map((m) => m.from)).size} distinct old objects
- rows with a file_path outside their own user folder (doctored/foreign — rekey will SKIP, manual review): ${foreignPrefix.length}
${foreignPrefix.map((f) => `  - ${f.id} -> ${f.file_path}`).join('\n') || '  - none'}

## Orphans (REPORT ONLY — deletions are decision-7/Trash territory)
- rows whose object is missing: ${orphanRows.length}
${orphanRows.slice(0, 20).map((r) => `  - ${r.id} "${r.name}" -> ${r.file_path}${r.archived ? ' (archived)' : ''}`).join('\n') || '  - none'}
- objects no row references: ${orphanObjects.length}
${orphanObjects.slice(0, 40).map((p) => `  - ${p}`).join('\n') || '  - none'}

## Collisions
${collisions.map((c) => `- ${c.key}: rows ${c.ids.join(', ')}`).join('\n') || '- none'}
`;
  const path = await writeReport('AUDIT', md, {
    host: client.host, rows: rows.length, needHash: needHash.length, noPath: noPath.length,
    objects: objects.length, byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, v.length])),
    rekeyMoves: moves, orphanRows: orphanRows.map((r) => ({ id: r.id, name: r.name, file_path: r.file_path, archived: r.archived })),
    orphanObjects, collisions,
  });
  console.log(md);
  console.log(`Report: ${path}`);
}

async function runBackfill(client, apply) {
  const { rows } = await gather(client);
  const { needHash, noPath } = planBackfill(rows);
  const existingKeys = new Set(
    rows.filter((r) => r.content_sha256).map((r) => indexKey(r.user_id, r.project_id, r.content_sha256))
  );
  const results = { written: [], collisions: [], missingObject: [], errors: [] };

  for (const row of needHash) {
    try {
      let bytes;
      try {
        bytes = await client.storageDownload(row.file_path);
      } catch {
        results.missingObject.push({ id: row.id, name: row.name, file_path: row.file_path });
        continue;
      }
      const sha = sha256hex(bytes);
      const key = indexKey(row.user_id, row.project_id, sha);
      if (existingKeys.has(key)) {
        // Same bytes as another row in the same scope — writing would trip the
        // unique index. Human merge decision; report only.
        results.collisions.push({ id: row.id, name: row.name, sha, key });
        continue;
      }
      existingKeys.add(key);
      if (apply) {
        await client.rest(`documents?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ content_sha256: sha }),
        });
      }
      results.written.push({ id: row.id, name: row.name, sha, applied: apply });
    } catch (err) {
      results.errors.push({ id: row.id, error: String(err.message || err) });
    }
  }

  const md = `# Content-hash backfill ${apply ? '(APPLIED)' : '(DRY-RUN — nothing written)'} — ${client.host}

- rows needing backfill: ${needHash.length}
- ${apply ? 'written' : 'would write'}: ${results.written.length}
- collisions (same bytes as an existing row in scope — MANUAL MERGE, skipped): ${results.collisions.length}
${results.collisions.map((c) => `  - row ${c.id} "${c.name}" sha ${c.sha.slice(0, 12)}…`).join('\n') || '  - none'}
- object missing in storage (orphan rows, skipped): ${results.missingObject.length}
${results.missingObject.map((m) => `  - ${m.id} "${m.name}" -> ${m.file_path}`).join('\n') || '  - none'}
- rows with no file_path at all (skipped): ${noPath.length}
- errors: ${results.errors.length}
${results.errors.map((e) => `  - ${e.id}: ${e.error}`).join('\n') || '  - none'}
`;
  const path = await writeReport(apply ? 'BACKFILL-APPLIED' : 'BACKFILL-DRYRUN', md, results);
  console.log(md);
  console.log(`Report: ${path}`);
  if (results.errors.length) process.exitCode = 1;
}

async function runRekey(client, apply) {
  const { rows } = await gather(client);
  const { moves, oldPathRefs, foreignPrefix } = planRekey(rows);
  const results = { moved: [], deletedOld: [], skippedMissing: [], foreignPrefix, errors: [] };
  // Counts references from ALL rows (planRekey) — a path shared with a
  // non-moving row (e.g. null-sha awaiting backfill) never reaches zero here.
  const remainingRefs = new Map(oldPathRefs);

  for (const move of moves) {
    try {
      if (!(await client.storageExists(move.from))) {
        results.skippedMissing.push(move);
        continue;
      }
      if (apply) {
        const copyStatus = await client.storageCopy(move.from, move.to);
        if (copyStatus === 409) {
          // Destination already existed — verify its BYTES are the row's sha
          // before repointing; an existing-but-wrong object would silently
          // swap the document's contents.
          const destSha = sha256hex(await client.storageDownload(move.to));
          if (destSha !== move.sha) {
            throw new Error(`destination ${move.to} exists with WRONG bytes (sha ${destSha.slice(0, 12)}…) — manual fix required`);
          }
        } else if (!(await client.storageExists(move.to))) {
          throw new Error(`copy verified missing at ${move.to}`);
        }
        // service_role is allowed through the file_path-immutable trigger.
        await client.rest(`documents?id=eq.${move.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ file_path: move.to }),
        });
      }
      results.moved.push({ ...move, applied: apply });
      const left = (remainingRefs.get(move.from) || 1) - 1;
      remainingRefs.set(move.from, left);
      if (apply && left === 0) {
        await client.storageRemove([move.from]);
        results.deletedOld.push(move.from);
      }
    } catch (err) {
      results.errors.push({ ...move, error: String(err.message || err) });
    }
  }

  // An old object is deletable only if EVERY row referencing it is in this
  // run's move list (refcount reaches zero).
  const movesPerPath = new Map();
  for (const m of moves) movesPerPath.set(m.from, (movesPerPath.get(m.from) || 0) + 1);
  const deletablePlanned = [...movesPerPath.entries()]
    .filter(([p, n]) => (oldPathRefs.get(p) || 0) === n).length;

  const md = `# Storage re-key ${apply ? '(APPLIED)' : '(DRY-RUN — nothing written)'} — ${client.host}

- rows on non-canonical paths: ${moves.length}
- ${apply ? 'moved' : 'would move'}: ${results.moved.length}
${results.moved.slice(0, 50).map((m) => `  - ${m.from} -> ${m.to}`).join('\n') || '  - none'}
- old objects ${apply ? 'deleted' : 'deletable once all their rows move'}: ${apply ? results.deletedOld.length : deletablePlanned}
- old objects KEPT because a non-moving row still references them: ${[...movesPerPath.keys()].filter((p) => (oldPathRefs.get(p) || 0) > (movesPerPath.get(p) || 0)).length}
- rows SKIPPED — file_path outside own user folder (doctored/foreign, manual review): ${foreignPrefix.length}
${foreignPrefix.map((f) => `  - ${f.id} -> ${f.file_path}`).join('\n') || '  - none'}
- source object missing (skipped; see audit orphans): ${results.skippedMissing.length}
- errors: ${results.errors.length}
${results.errors.map((e) => `  - ${e.id} ${e.from}: ${e.error}`).join('\n') || '  - none'}

Rows still lacking a sha are untouched — run backfill first.
`;
  const path = await writeReport(apply ? 'REKEY-APPLIED' : 'REKEY-DRYRUN', md, results);
  console.log(md);
  console.log(`Report: ${path}`);
  if (results.errors.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => !a.startsWith('--')) || 'audit';
  const apply = args.includes('--apply');
  const client = makeClient();
  console.log(`Target: ${client.host} | mode: ${mode} | ${apply ? 'APPLY' : 'dry-run'}\n`);
  if (mode === 'audit') return runAudit(client);
  if (mode === 'backfill') return runBackfill(client, apply);
  if (mode === 'rekey') return runRekey(client, apply);
  console.error(`Unknown mode "${mode}" — use audit | backfill | rekey`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

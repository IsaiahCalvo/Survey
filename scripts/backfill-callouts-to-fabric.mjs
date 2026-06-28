#!/usr/bin/env node
// scripts/backfill-callouts-to-fabric.mjs
//
// Phase 6 of the callout-unification plan. One-time, idempotent backfill that
// rewrites every `document_annotations` row of annotation_type='callout' from the
// legacy normalized `annotation_data.callout` shape into the shared page-pixel
// `annotation_data.fabricObject` shape (data.type==='callout', like counter).
//
// Convert-at-load contract (PLAN Phase 6 step 2a, resolved 2026-06-27): there is
// NO document_pages table, so the stored page-pixel children are computed at a
// NOMINAL page size and are advisory only — the runtime LOAD path re-projects
// from `data.legacyNormalizedCoords` (the 0-1 truth) against the measured page
// size. Nothing here bakes a real page dimension into the DB.
//
// LOSSLESS: the entire original callout (including style fields the Fabric child
// shape doesn't carry — fillColor/fillOpacity/borderOpacity/arrowheadStyle — and
// meta.authorId) is stashed at `fabricObject.data.legacyCallout`. isPdfImported /
// pdfAnnotationId are also lifted to the fabricObject root so getPdfImportDedupeKey
// keeps working.
//
// Usage:
//   node scripts/backfill-callouts-to-fabric.mjs --ref <projectRef>            # dry-run (default)
//   node scripts/backfill-callouts-to-fabric.mjs --json <file>                 # dry-run from a saved fixture (offline)
//   node scripts/backfill-callouts-to-fabric.mjs --ref <projectRef> --apply    # WRITE (one prod-mutating step)
// Auth: SUPABASE_ACCESS_TOKEN env (a personal sbp_ token) for the Management API.

import { readFileSync } from 'node:fs';
import {
  calloutToAnnotationObject,
  annotationObjectToCallout,
} from '../src/utils/calloutAnnotationBridge.js';

// Nominal page size for advisory stored children (US-Letter PDF points). The
// load path re-projects from legacyNormalizedCoords, so this scale never renders.
const NOMINAL_PAGE = { width: 612, height: 792 };

/**
 * Pure row-payload transform: legacy `annotation_data` ({callout,...}) → new
 * `annotation_data` ({fabricObject, schemaVersion:2, ...}).
 *
 * @param {object} annotationData - the existing annotation_data JSON of a callout row
 * @param {{ pageSize?: {width:number,height:number} }} [opts]
 * @returns {object|null} the new annotation_data, or null if already migrated
 *   (fabricObject present and no legacy callout key — idempotent skip).
 */
export function buildFabricAnnotationData(annotationData, opts = {}) {
  if (!annotationData || typeof annotationData !== 'object') {
    throw new Error('buildFabricAnnotationData: annotation_data object required');
  }
  const callout = annotationData.callout;
  if (!callout) {
    // Already migrated (or not a legacy callout row) — nothing to do.
    if (annotationData.fabricObject) return null;
    throw new Error('buildFabricAnnotationData: row has neither .callout nor .fabricObject');
  }

  const pageSize = opts.pageSize || NOMINAL_PAGE;
  const fabricObject = calloutToAnnotationObject(callout, pageSize);

  // `getObjects` is a live convenience method on the bridge output — strip it so
  // the persisted JSON is plain data (JSON.stringify would drop it anyway).
  delete fabricObject.getObjects;

  // Lossless recovery: the entire original normalized callout, verbatim.
  fabricObject.data.legacyCallout = JSON.parse(JSON.stringify(callout));
  // Author chain for the shared canModify / history-owner gates.
  const authorId = callout.meta?.authorId ?? callout.authorId ?? null;
  if (authorId) fabricObject.data.authorId = authorId;

  // Preserve PDF-import identity at the fabricObject root (getPdfImportDedupeKey
  // reads fabricObject.isPdfImported / fabricObject.pdfAnnotationId).
  if (callout.isPdfImported) {
    fabricObject.isPdfImported = true;
    if (callout.pdfAnnotationId != null) fabricObject.pdfAnnotationId = callout.pdfAnnotationId;
  }

  return {
    fabricObject,
    pageNumber: annotationData.pageNumber ?? callout.pageNumber ?? 1,
    schemaVersion: 2,
    clientSessionId: annotationData.clientSessionId ?? null,
  };
}

/** Advisory AABB for the bounds column (indexing only). */
export function boundsFromFabric(fabricObject) {
  return {
    x: Number(fabricObject.left) || 0,
    y: Number(fabricObject.top) || 0,
    width: Number(fabricObject.width) || 0,
    height: Number(fabricObject.height) || 0,
  };
}

/**
 * Verify a forward conversion is geometry-lossless by round-tripping the
 * fabricObject back to normalized coords and comparing to the original.
 * @returns {{ ok: boolean, maxFracDelta: number }}
 */
export function verifyRoundTrip(originalCallout, fabricObject, pageSize = NOMINAL_PAGE) {
  const back = annotationObjectToCallout(fabricObject, pageSize);
  const pts = [
    ['arrowTip.x', originalCallout.arrowTip?.x ?? originalCallout.anchor?.x ?? 0, back.arrowTip.x],
    ['arrowTip.y', originalCallout.arrowTip?.y ?? originalCallout.anchor?.y ?? 0, back.arrowTip.y],
    ['knee.x', originalCallout.knee?.x ?? 0, back.knee.x],
    ['knee.y', originalCallout.knee?.y ?? 0, back.knee.y],
    ['tbPos.x', originalCallout.textBoxPosition?.x ?? 0, back.textBoxPosition.x],
    ['tbPos.y', originalCallout.textBoxPosition?.y ?? 0, back.textBoxPosition.y],
    ['tbW', originalCallout.textBoxWidth ?? 0, back.textBoxWidth],
    ['tbH', originalCallout.textBoxHeight ?? 0, back.textBoxHeight],
  ];
  let maxFracDelta = 0;
  for (const [, exp, act] of pts) maxFracDelta = Math.max(maxFracDelta, Math.abs(exp - act));
  // 0.5px / min nominal dim ≈ 0.5/612 ≈ 8.2e-4 as a fraction tolerance.
  return { ok: maxFracDelta < 8.2e-4, maxFracDelta };
}

// --------------------------------------------------------------------------
// CLI (skipped when imported as a module)
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { apply: false, ref: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--ref') out.ref = argv[++i];
    else if (a === '--json') out.json = argv[++i];
  }
  return out;
}

async function mgmtQuery(ref, token, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${txt.slice(0, 400)}`);
  return JSON.parse(txt);
}

async function main() {
  const { apply, ref, json } = parseArgs(process.argv.slice(2));
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  let rows;
  if (json) {
    rows = JSON.parse(readFileSync(json, 'utf8'));
    console.log(`[backfill] loaded ${rows.length} rows from ${json} (offline)`);
  } else {
    if (!ref) throw new Error('--ref <projectRef> required (or --json <file>)');
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN env required');
    rows = await mgmtQuery(ref, token, `
      select annotation_id, document_id, page_number, annotation_type, annotation_data
      from document_annotations where annotation_type='callout' order by created_at;`);
    console.log(`[backfill] fetched ${rows.length} callout rows from ${ref}`);
  }

  let migrated = 0, skipped = 0, failed = 0;
  const updates = [];
  for (const row of rows) {
    const id = row.annotation_id;
    try {
      const newData = buildFabricAnnotationData(row.annotation_data);
      if (newData === null) { skipped++; console.log(`  SKIP  ${id} (already fabricObject)`); continue; }
      const rt = verifyRoundTrip(row.annotation_data.callout, newData.fabricObject);
      const bounds = boundsFromFabric(newData.fabricObject);
      const tag = rt.ok ? 'OK  ' : 'WARN';
      console.log(`  ${tag}  ${id} pg${row.page_number} maxFracDelta=${rt.maxFracDelta.toExponential(2)}${row.annotation_data.callout.isPdfImported ? ' [pdfImported]' : ''}`);
      if (!rt.ok) failed++;
      updates.push({ id, newData, bounds });
      migrated++;
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${id}: ${err.message}`);
    }
  }

  console.log(`\n[backfill] plan: ${migrated} migrate, ${skipped} skip, ${failed} failed/warn`);

  if (!apply) {
    console.log('[backfill] DRY-RUN — no writes. Re-run with --apply to commit.');
    return;
  }
  if (failed > 0) throw new Error(`refusing to --apply with ${failed} failed/warn rows`);
  if (json) throw new Error('--apply requires --ref (cannot write to a --json fixture)');

  // Idempotent UPDATEs, dollar-quoted JSON. Guard `annotation_data ? 'callout'`
  // so a re-run never re-touches an already-migrated row.
  for (const u of updates) {
    const dataLit = `$$${JSON.stringify(u.newData)}$$`;
    const boundsLit = `$$${JSON.stringify(u.bounds)}$$`;
    await mgmtQuery(ref, token, `
      update document_annotations
      set annotation_data = ${dataLit}::jsonb,
          bounds = ${boundsLit}::jsonb,
          updated_at = now()
      where annotation_id = '${u.id}' and annotation_data ? 'callout';`);
    console.log(`  APPLIED ${u.id}`);
  }
  console.log(`[backfill] applied ${updates.length} updates to ${ref}.`);
}

// Run only as a CLI, never on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[backfill] FATAL:', err.message); process.exit(1); });
}

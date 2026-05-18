/**
 * One-time local-to-cloud migration for stranded annotations — Phase 21.
 *
 * On first run after this phase ships, scans localStorage for any
 * non-surveyMarker annotations that don't yet exist in Supabase and pushes
 * them up. Marks the migration complete per (user, document) so subsequent
 * document opens are no-ops.
 *
 * Idempotent: safe to call on every document open. Only pushes the diff.
 */

import { supabase } from '../supabaseClient.js';
import {
  upsertAnnotationsByPage,
  upsertCallouts,
  loadAllNonSurveyMarkerAnnotations
} from './annotationCloudSync.js';

const MIGRATION_KEY_PREFIX = 'cloudSyncMigrated_';

function readLocalAnnotationsByPage(pdfId) {
  if (!pdfId || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`annotationsByPage_${pdfId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readLocalCallouts(pdfId) {
  if (!pdfId || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`callouts_${pdfId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function migrationKey(userId, documentId) {
  return `${MIGRATION_KEY_PREFIX}${userId}_${documentId}`;
}

function alreadyMigrated(userId, documentId) {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(migrationKey(userId, documentId)) === '1';
  } catch {
    return false;
  }
}

function markMigrated(userId, documentId) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(migrationKey(userId, documentId), '1');
  } catch {
    // Best-effort. If localStorage is full, the next open will retry.
  }
}

function getPdfImportKeyForObject(obj, pageNumber) {
  const pdfAnnotationId = obj?.pdfAnnotationId;
  if (!obj?.isPdfImported || !pdfAnnotationId) return null;
  return `${pageNumber}:${pdfAnnotationId}`;
}

function getPdfImportKeyForRow(row) {
  const obj = row?.annotation_data?.fabricObject;
  const pageNumber = row?.annotation_data?.pageNumber ?? row?.page_number;
  return getPdfImportKeyForObject(obj, pageNumber);
}

function ensureLocalObjectId(obj, fallbackId) {
  if (!obj || !fallbackId) return;
  if (!obj.data || typeof obj.data !== 'object') obj.data = {};
  if (!obj.id && !obj.data.id) obj.data.id = fallbackId;
}

/**
 * Run the one-time migration if it hasn't run yet for this (user, document).
 *
 * @param {object} ctx
 * @param {string} ctx.documentId   - Supabase document ID
 * @param {string} ctx.userId       - Supabase user ID
 * @param {string} ctx.pdfId        - Local localStorage key suffix (e.g. "file.pdf-12345")
 * @param {(status: object) => void} [ctx.onStatus] - optional UI callback
 *   Receives { stage: 'idle' | 'scanning' | 'pushing' | 'done' | 'error', ... }
 *
 * @returns {Promise<{ migrated: boolean, pushed: number, skipped: number, error?: object }>}
 */
export async function migrateLocalAnnotationsToCloud(ctx) {
  const { documentId, userId, pdfId, onStatus, existingCloudResult = null } = ctx || {};
  if (!documentId || !userId || !pdfId) {
    return { migrated: false, pushed: 0, skipped: 0, error: new Error('missing ctx fields') };
  }
  if (!supabase) {
    return { migrated: false, pushed: 0, skipped: 0, error: new Error('Supabase unavailable') };
  }
  if (alreadyMigrated(userId, documentId)) {
    return { migrated: true, pushed: 0, skipped: 0 };
  }

  if (onStatus) onStatus({ stage: 'scanning' });

  const localByPage = readLocalAnnotationsByPage(pdfId);
  const localCallouts = readLocalCallouts(pdfId);

  // Fetch existing cloud rows so we only push what's missing. When hydrate
  // already loaded the same snapshot, reuse it instead of running another
  // full-table read during startup.
  const cloudResult = existingCloudResult && !existingCloudResult.error
    ? existingCloudResult
    : await loadAllNonSurveyMarkerAnnotations(documentId);
  if (cloudResult.error) {
    if (onStatus) onStatus({ stage: 'error', error: cloudResult.error });
    return { migrated: false, pushed: 0, skipped: 0, error: cloudResult.error };
  }
  const cloudIds = new Set(
    (cloudResult.rawRows || []).map((r) => r.highlight_id).filter(Boolean)
  );
  const cloudPdfImportKeys = new Set(
    (cloudResult.rawRows || []).map(getPdfImportKeyForRow).filter(Boolean)
  );

  // Filter local objects that aren't in cloud yet. Imported PDF annotations
  // also key by the source PDF annotation id so legacy local snapshots with
  // missing/generated client ids do not reinsert duplicate cloud rows.
  const filteredByPage = {};
  let totalLocal = 0;
  let totalToPush = 0;
  for (const [pageKey, page] of Object.entries(localByPage)) {
    if (!page || !Array.isArray(page.objects)) continue;
    const newObjects = [];
    for (const obj of page.objects) {
      totalLocal += 1;
      const id = obj.id || obj.data?.id;
      const pdfImportKey = getPdfImportKeyForObject(obj, Number.parseInt(pageKey, 10) || 1);
      if (id) ensureLocalObjectId(obj, id);
      if (
        (!id || !cloudIds.has(id)) &&
        (!pdfImportKey || !cloudPdfImportKeys.has(pdfImportKey))
      ) {
        newObjects.push(obj);
        totalToPush += 1;
      }
    }
    if (newObjects.length > 0) {
      filteredByPage[pageKey] = { ...page, objects: newObjects };
    }
  }

  const filteredCallouts = localCallouts.filter((c) => {
    const id = c.id || c.highlightId;
    return !id || !cloudIds.has(id);
  });
  totalToPush += filteredCallouts.length;

  if (totalToPush === 0) {
    markMigrated(userId, documentId);
    if (onStatus) onStatus({ stage: 'done', pushed: 0, skipped: totalLocal + localCallouts.length });
    return { migrated: true, pushed: 0, skipped: totalLocal + localCallouts.length };
  }

  if (onStatus) onStatus({ stage: 'pushing', pushed: 0, total: totalToPush });

  let pushed = 0;
  let lastError = null;

  if (Object.keys(filteredByPage).length > 0) {
    const r = await upsertAnnotationsByPage(filteredByPage, { documentId, userId });
    if (r.error) {
      lastError = r.error;
    } else {
      pushed += r.data?.length || 0;
    }
  }

  if (filteredCallouts.length > 0) {
    const r = await upsertCallouts(filteredCallouts, { documentId, userId });
    if (r.error) {
      lastError = r.error;
    } else {
      pushed += r.data?.length || 0;
    }
  }

  if (lastError) {
    if (onStatus) onStatus({ stage: 'error', error: lastError, pushed });
    return { migrated: false, pushed, skipped: 0, error: lastError };
  }

  markMigrated(userId, documentId);
  if (onStatus) onStatus({ stage: 'done', pushed, total: totalToPush });
  return { migrated: true, pushed, skipped: totalLocal - pushed };
}

/**
 * Has the one-time local→cloud migration already run for this (user, document)
 * pair? Used by the cloud-sync hook to decide whether the cloud snapshot is
 * fully authoritative (replace local with empty cloud) or still in the
 * "first boot, preserve local until migration pushes it up" phase.
 */
export function hasMigrationRun(userId, documentId) {
  return alreadyMigrated(userId, documentId);
}

/**
 * For tests: forget the migration flag for a (user, document) pair.
 */
export function resetMigrationFlag(userId, documentId) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(migrationKey(userId, documentId));
  } catch {
    // best effort
  }
}

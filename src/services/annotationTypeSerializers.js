/**
 * Annotation type serializers — Phase 21 (cloud sync for all annotation types).
 *
 * Pure functions. Translate between in-app Fabric.js objects (the per-page
 * annotation shape live-edited in the canvas) and the cloud row format
 * stored in the document_annotations table.
 *
 * Strategy:
 *   - Pull out a bounding rectangle into the existing `bounds` column for
 *     fast page-scoped indexing.
 *   - Map the Fabric `type` (and `data.type` for groups) to the DB
 *     `annotation_type` enum value.
 *   - Stuff everything else (the full Fabric serialized object) into the new
 *     `annotation_data` JSONB column as `{ fabricObject, pageNumber, ...meta }`.
 *
 * The deserializer rebuilds the Fabric object from `annotation_data.fabricObject`
 * unchanged — round-trip is byte-identical for all fields the app cares about.
 *
 * SurveyMarkers stay on their existing dedicated columns (color, opacity, name,
 * notes, ...) — they are NOT routed through this serializer. That preserves
 * backwards compatibility with every existing surveyMarker row in the database.
 *
 * Author-attribution invariant (2026-04-30 hardening):
 *   The serializer treats `meta.authorId` (canonical) as WRITE-ONCE-ON-CREATE.
 *   It stamps the current user's id ONLY when no field in the Phase 29 canonical
 *   chain (meta.authorId > authorId > data.authorId > data.userId — see
 *   permissionScope.getAnnotationAuthorId) is already populated. On EDITs by a
 *   collaborator, the original author's id survives. `last_modified_by` is the
 *   "edit history" field and is always overwritten with the current user.
 *   Same goes for the row-level `user_id` column — it stays pinned to the
 *   original author so server-side RLS reflects creator-ownership, not last-
 *   editor ownership.
 */

import { getAnnotationAuthorId } from '../lib/collab/permissionScope.js';
import {
  SURVEY_MARKER_TYPE,
  isSurveyMarkerType,
} from '../utils/surveyMarkerType.js';

// ----------------------------------------------------------------------------
// Type mapping: Fabric object kind → DB annotation_type
// ----------------------------------------------------------------------------

const FABRIC_TYPE_TO_DB_TYPE = {
  path: 'ink',
  rect: 'square',
  circle: 'circle',
  ellipse: 'circle',
  line: 'line',
  arrow: 'line', // arrows render as lines with line-end style; same row category
  polyline: 'polyline',
  polygon: 'polygon',
  textbox: 'freetext',
  'i-text': 'freetext',
  text: 'freetext',
  image: 'stamp'
};

const SUPPORTED_DB_TYPES = new Set([
  SURVEY_MARKER_TYPE,
  'ink',
  'freetext',
  'square',
  'circle',
  'line',
  'polyline',
  'polygon',
  'stamp',
  'sticky_note',
  'callout',
  'counter',
  'eraser',
  'form-field'
]);

function hasFabricObjectPayload(row) {
  return !!(row?.annotation_data && row.annotation_data.fabricObject);
}

function isLegacyFabricSurveyMarkerRow(row) {
  return isSurveyMarkerType(row?.annotation_type) && hasFabricObjectPayload(row);
}

function shouldDeserializeAsFabricObject(row) {
  if (!row) return false;
  if (row.annotation_type === 'callout') return false;
  if (isSurveyMarkerType(row.annotation_type)) return isLegacyFabricSurveyMarkerRow(row);
  return true;
}

function getPdfImportDedupeKey(row) {
  const fabricObject = row?.annotation_data?.fabricObject;
  const pdfAnnotationId = fabricObject?.pdfAnnotationId;
  if (!fabricObject?.isPdfImported || !pdfAnnotationId) return null;
  const pageNumber = row?.annotation_data?.pageNumber ?? row?.page_number;
  return `${pageNumber}:${pdfAnnotationId}`;
}

function preferFabricRow(candidate, current) {
  if (!current) return candidate;
  if (isSurveyMarkerType(current.annotation_type) && !isSurveyMarkerType(candidate.annotation_type)) {
    return candidate;
  }
  if (isSurveyMarkerType(candidate.annotation_type) && !isSurveyMarkerType(current.annotation_type)) {
    return current;
  }
  const candidateTime = Date.parse(candidate.updated_at || candidate.created_at || '');
  const currentTime = Date.parse(current.updated_at || current.created_at || '');
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    return candidateTime >= currentTime ? candidate : current;
  }
  return current;
}

export function normalizeFabricAnnotationRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  const pdfImportRowsByKey = new Map();

  for (const row of rows) {
    if (!shouldDeserializeAsFabricObject(row)) continue;
    const dedupeKey = getPdfImportDedupeKey(row);
    if (!dedupeKey) {
      out.push(row);
      continue;
    }
    pdfImportRowsByKey.set(
      dedupeKey,
      preferFabricRow(row, pdfImportRowsByKey.get(dedupeKey))
    );
  }

  out.push(...pdfImportRowsByKey.values());
  return out;
}

/**
 * Map a Fabric object to its DB annotation_type.
 * Group objects use `data.type` to disambiguate (counter, callout, sticky_note).
 */
export function fabricObjectToDbType(fabricObj) {
  if (!fabricObj) return null;

  const dataKind = fabricObj.data?.type;
  if (dataKind === 'counter') return 'counter';
  if (dataKind === 'callout') return 'callout';
  if (dataKind === 'sticky_note' || dataKind === 'sticky-note') return 'sticky_note';
  if (dataKind === 'eraser') return 'eraser';
  if (dataKind === 'form-field') return 'form-field';
  if (dataKind === 'text-markup') return 'square';

  const fabricType = String(fabricObj.type || '').toLowerCase();
  return FABRIC_TYPE_TO_DB_TYPE[fabricType] || null;
}

/**
 * Compute an axis-aligned bounding rectangle from a Fabric object.
 * Honors scaleX/scaleY/angle approximately — for fine-grained geometry the
 * full Fabric object lives in annotation_data.fabricObject anyway. The
 * bounds are only used for indexing and rough spatial queries.
 */
export function computeBounds(fabricObj) {
  if (!fabricObj) return { x: 0, y: 0, width: 0, height: 0 };

  const left = Number.isFinite(fabricObj.left) ? fabricObj.left : 0;
  const top = Number.isFinite(fabricObj.top) ? fabricObj.top : 0;
  const scaleX = Number.isFinite(fabricObj.scaleX) ? fabricObj.scaleX : 1;
  const scaleY = Number.isFinite(fabricObj.scaleY) ? fabricObj.scaleY : 1;
  const width = (Number.isFinite(fabricObj.width) ? fabricObj.width : 0) * scaleX;
  const height = (Number.isFinite(fabricObj.height) ? fabricObj.height : 0) * scaleY;
  const angle = Number.isFinite(fabricObj.angle) ? fabricObj.angle : 0;

  return { x: left, y: top, width, height, rotation: angle };
}

// ----------------------------------------------------------------------------
// Public API: serialize / deserialize Fabric objects to/from DB rows.
// ----------------------------------------------------------------------------

/**
 * Serialize a Fabric object into a DB row payload (suitable for upsert).
 *
 * @param {object} fabricObj - The Fabric serialized object (as stored in
 *   App.jsx's annotationsByPage[pageNumber].objects[i]).
 * @param {object} opts
 * @param {string} opts.documentId - The document this annotation belongs to.
 * @param {string} opts.userId - The user who owns this annotation.
 * @param {number} opts.pageNumber - 1-indexed page number.
 * @param {string} [opts.annotationId] - Stable client-side ID. If not
 *   provided, the function tries fabricObj.id, fabricObj.data.id, then a
 *   generated one.
 * @returns {object} A row matching the document_annotations table shape.
 */
export function serializeFabricObjectToRow(fabricObj, opts = {}) {
  if (!fabricObj || typeof fabricObj !== 'object') {
    throw new Error('serializeFabricObjectToRow: fabricObj is required');
  }
  const { documentId, userId, pageNumber, annotationId, clientSessionId } = opts;
  if (!documentId) throw new Error('documentId required');
  if (!userId) throw new Error('userId required');
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    throw new Error('pageNumber must be a positive integer');
  }

  const dbType = fabricObjectToDbType(fabricObj);
  if (!dbType || !SUPPORTED_DB_TYPES.has(dbType)) {
    throw new Error(`Unsupported Fabric type: ${fabricObj.type} (data.type=${fabricObj.data?.type})`);
  }

  let id = annotationId || fabricObj.id || fabricObj.data?.id;
  if (!id) {
    id = generateClientId(dbType);
    // Stamp the new id back onto the fabric object's data so the SAME
    // local object keeps the same id across future pushes. Without this,
    // every save mints a brand-new id for id-less objects, and Supabase
    // accepts each one as an INSERT — that's the runaway-growth bug
    // where one pen stroke spawned thousands of duplicate counter rows.
    if (!fabricObj.data || typeof fabricObj.data !== 'object') {
      fabricObj.data = {};
    }
    if (!fabricObj.data.id) fabricObj.data.id = id;
  }

  // Author-attribution guard (2026-04-30 hardening):
  // Resolve the existing authorId via the Phase 29 canonical chain. If ANY
  // field in the chain is populated, this annotation already has a creator
  // recorded — preserve it. Only stamp `meta.authorId = current user` when
  // the chain is fully empty (true CREATE: brand-new annotation that has not
  // yet been attributed). Never overwrite a populated chain field — that
  // would flip authorship on every collaborator edit.
  //
  // We write to `meta.authorId` (the canonical field) on CREATE, mirroring
  // crdtAnnotationBridge.js lines 222-245 so the serializer and the CRDT
  // bridge stay in sync. Legacy fields (data.authorId / data.userId / top-
  // level authorId) are never re-stomped — if a row was created pre-Phase-29
  // and only has data.userId, that legacy field stays as-is.
  const existingAuthorId = getAnnotationAuthorId(fabricObj);
  if (!existingAuthorId) {
    if (!fabricObj.meta || typeof fabricObj.meta !== 'object') {
      fabricObj.meta = {};
    }
    if (!fabricObj.meta.authorId) {
      fabricObj.meta.authorId = userId;
    }
  }
  // Resolve the row-level user_id from the (now possibly stamped) chain so
  // the row reflects the ORIGINAL author for RLS / audit, not the current
  // viewer. last_modified_by below carries the "edited by" signal instead.
  const rowUserId = getAnnotationAuthorId(fabricObj) || userId;

  // Attribution-on-reload backstop (R2.2 Slice 0): a projected callout group
  // carries the verbatim normalized callout at data.legacyCallout — the ONLY
  // payload deserializeRowToCallout reloads. If that embedded chain is empty
  // (rows minted before creation-time stamping), a reloaded callout loses its
  // author even though the row's user_id is right: canModify falls open and
  // the next push re-stamps the current viewer. Mirror the group's RESOLVED
  // author into legacyCallout.meta.authorId, mutating IN PLACE (no clone —
  // object identity feeds the callout sync fingerprints). Same never-overwrite
  // guard as above: a populated embedded chain is never touched, so a
  // collaborator's push can never flip the recorded creator.
  if (fabricObj.data?.type === 'callout') {
    const legacyCallout = fabricObj.data.legacyCallout;
    if (
      legacyCallout &&
      typeof legacyCallout === 'object' &&
      rowUserId &&
      !getAnnotationAuthorId(legacyCallout)
    ) {
      if (!legacyCallout.meta || typeof legacyCallout.meta !== 'object') {
        legacyCallout.meta = {};
      }
      if (!legacyCallout.meta.authorId) {
        legacyCallout.meta.authorId = rowUserId;
      }
    }
  }

  const bounds = computeBounds(fabricObj);

  // The full Fabric object goes into annotation_data so deserialization is
  // lossless. We strip nothing — the canvas reads it back as-is.
  // clientSessionId is a per-tab/per-Electron-process UUID generated by the
  // hook on mount. The realtime subscriber uses it for the echo filter so
  // the user's OWN device drops its own writes, but the same user's OTHER
  // device (different session) gets the live update. last_modified_by alone
  // can't tell those two apart.
  const annotation_data = {
    fabricObject: fabricObj,
    pageNumber,
    schemaVersion: 1,
    clientSessionId: clientSessionId || null
  };

  return {
    document_id: documentId,
    user_id: rowUserId,
    annotation_id: id,
    annotation_type: dbType,
    page_number: pageNumber,
    bounds,
    annotation_data,
    color: pickColor(fabricObj),
    opacity: pickOpacity(fabricObj),
    stroke_width: Number.isFinite(fabricObj.strokeWidth) ? fabricObj.strokeWidth : null,
    font_size: Number.isFinite(fabricObj.fontSize) ? fabricObj.fontSize : null,
    last_modified_by: userId
  };
}

/**
 * Deserialize a DB row back into the in-app Fabric object format.
 *
 * @param {object} row - A row from the document_annotations table.
 * @returns {{ fabricObject: object, pageNumber: number, annotationId: string,
 *            annotationType: string }}
 */
export function deserializeRowToFabricObject(row) {
  if (!row) throw new Error('row required');
  if (isSurveyMarkerType(row.annotation_type) && !isLegacyFabricSurveyMarkerRow(row)) {
    throw new Error(
      'deserializeRowToFabricObject: highlight rows are not Fabric objects — '
      + 'use the highlight-specific deserializer instead.'
    );
  }

  const data = row.annotation_data || {};
  const fabricObject = data.fabricObject || null;
  if (!fabricObject) {
    throw new Error(
      `Row ${row.annotation_id} has no annotation_data.fabricObject — `
      + 'cannot reconstruct shape.'
    );
  }
  if (row.annotation_id) {
    if (!fabricObject.data || typeof fabricObject.data !== 'object') {
      fabricObject.data = {};
    }
    if (!fabricObject.id && !fabricObject.data.id) {
      fabricObject.data.id = row.annotation_id;
    }
    // Bug 1 fix (2026-04-30): stamp annotationId onto the fabric object itself
    // when the row IS a legacy survey marker (fabric-carrying survey-marker row).
    // SVGAnnotationLayer.jsx ~line 1248 has a skip-guard `if (obj.annotationId)
    // continue;` that exists to prevent double-render: survey markers are
    // supposed to render ONLY through the dedicated `surveyMarkerElements`
    // memo, NOT through the main fabric annotations loop. The skip-guard
    // depends on `obj.annotationId` being set on the fabric object — which it
    // wasn't, after a cloud-roundtrip deserialization, so the same surveyMarker
    // got rendered TWICE on the second device (once via the survey memo, once
    // via the main loop). Two semi-transparent yellow rects compositing to a
    // darker yellow is exactly what the user reported. Conditional on
    // isLegacyFabricSurveyMarkerRow so we don't accidentally stamp `.annotationId`
    // onto regular fabric annotations (pen, shape, text — they share the
    // `annotation_id` column as their generic annotation ID, but their fabric
    // objects must NOT be skipped by the SVG layer's main loop).
    if (isLegacyFabricSurveyMarkerRow(row)) {
      fabricObject.annotationId = row.annotation_id;
    }
  }

  return {
    fabricObject,
    pageNumber: data.pageNumber ?? row.page_number,
    annotationId: row.annotation_id,
    annotationType: row.annotation_type,
    schemaVersion: data.schemaVersion ?? 1
  };
}

// serializeCalloutToRow was DELETED 2026-07-17 (dead-code pass 2): the legacy
// per-callout push it served was retired, leaving it test-only. Callouts now
// persist exclusively through the shared writer — calloutToAnnotationObject
// (src/utils/calloutAnnotationBridge.js) projects the callout to a fabric
// group and serializeFabricObjectToRow above emits the 'callout' row carrying
// annotation_data.fabricObject.data.legacyCallout, which
// deserializeRowToCallout below reads back. Its private computeCalloutBounds
// helper was deleted with it (live bounds come from computeBounds).

export function deserializeRowToCallout(row) {
  if (!row) throw new Error('row required');
  if (row.annotation_type !== 'callout') {
    throw new Error(`Expected annotation_type=callout, got ${row.annotation_type}`);
  }
  const data = row.annotation_data || {};
  // Backward-read shim (Phase 6 transition): a migrated callout row stores
  // annotation_data.fabricObject with the verbatim original normalized callout at
  // fabricObject.data.legacyCallout. Recover it so migrated rows keep loading via
  // the existing callout path (flag-OFF too) — this decouples the backfill from the
  // flag flip. Legacy `.callout` rows are unchanged.
  const callout = data.callout || data.fabricObject?.data?.legacyCallout;
  if (!callout) {
    throw new Error(`Callout row ${row.annotation_id} has no annotation_data.callout`);
  }
  return { ...callout, id: callout.id || row.annotation_id };
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function generateClientId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function pickColor(fabricObj) {
  // Prefer stroke for strokeable shapes, fill for filled shapes/text.
  if (typeof fabricObj.stroke === 'string') return fabricObj.stroke;
  if (typeof fabricObj.fill === 'string') return fabricObj.fill;
  return null;
}

function pickOpacity(fabricObj) {
  if (Number.isFinite(fabricObj.opacity)) return fabricObj.opacity;
  return null;
}

// ----------------------------------------------------------------------------
// Convenience: serialize an entire annotationsByPage object into rows.
// ----------------------------------------------------------------------------

/**
 * Walk the per-page annotation store and emit one row per Fabric object.
 *
 * @param {Record<string|number, { objects: object[] }>} annotationsByPage
 * @param {object} opts
 * @returns {object[]} array of DB rows
 */
export function serializeAnnotationsByPage(annotationsByPage, opts = {}) {
  if (!annotationsByPage || typeof annotationsByPage !== 'object') return [];
  const rows = [];
  for (const [pageKey, page] of Object.entries(annotationsByPage)) {
    const pageNumber = Number.parseInt(pageKey, 10) || 1;
    if (!page || !Array.isArray(page.objects)) continue;
    for (const obj of page.objects) {
      // Callout-unification keystone (Phase 5) — write-contamination guard.
      // FLAG-OFF: `data.type==='callout'` objects in annotationsByPage are a
      // RENDER-ONLY projection; callouts persisted via their own callout rows
      // (the since-deleted serializeCalloutToRow + legacy callout push). The bulk push must NOT
      // re-serialize them onto the same annotation_id (→ dual-write-queue-jam).
      // FLAG-ON (R2 keystone): annotationsByPage IS the persisted source and the
      // legacy callout push is disabled, so the shared push is the SOLE writer —
      // callout objects MUST serialize here (into `.fabricObject` 'callout' rows
      // carrying data.legacyCallout so they reload via the shim). Serializing
      // callouts here is only safe BECAUSE the legacy push is retired (else
      // dual-write on the same id — the documented BLOCKER 1).
      try {
        rows.push(serializeFabricObjectToRow(obj, { ...opts, pageNumber }));
      } catch (err) {
        // Skip objects whose type the serializer rejects; surface for debug.
        // Production callers should log; tests verify the rejection path.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[serializeAnnotationsByPage] skipped object:', err?.message || err);
        }
      }
    }
  }
  return rows;
}

/**
 * Reverse: take an array of rows and rebuild { [pageNumber]: { objects: [...] } }.
 */
export function deserializeRowsToAnnotationsByPage(rows) {
  if (!Array.isArray(rows)) return {};
  const out = {};
  for (const row of normalizeFabricAnnotationRows(rows)) {
    try {
      const { fabricObject, pageNumber } = deserializeRowToFabricObject(row);
      const key = pageNumber ?? row.page_number;
      if (!out[key]) out[key] = { objects: [] };
      out[key].objects.push(fabricObject);
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

/**
 * Reverse: take an array of rows and pull out callouts into the in-app shape.
 */
export function deserializeRowsToCallouts(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (row.annotation_type !== 'callout') continue;
    try {
      out.push(deserializeRowToCallout(row));
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

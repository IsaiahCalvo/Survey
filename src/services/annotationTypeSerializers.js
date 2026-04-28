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
 * Highlights stay on their existing dedicated columns (color, opacity, name,
 * notes, ...) — they are NOT routed through this serializer. That preserves
 * backwards compatibility with every existing highlight row in the database.
 */

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

const DB_TYPE_TO_FABRIC_DEFAULT = {
  ink: 'path',
  square: 'rect',
  circle: 'circle',
  line: 'line',
  polyline: 'polyline',
  polygon: 'polygon',
  freetext: 'textbox',
  stamp: 'image',
  sticky_note: 'group',
  callout: 'group',
  counter: 'group',
  eraser: 'path'
};

const SUPPORTED_DB_TYPES = new Set([
  'highlight',
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
  'eraser'
]);

function hasFabricObjectPayload(row) {
  return !!(row?.annotation_data && row.annotation_data.fabricObject);
}

function isLegacyFabricHighlightRow(row) {
  return row?.annotation_type === 'highlight' && hasFabricObjectPayload(row);
}

function shouldDeserializeAsFabricObject(row) {
  if (!row) return false;
  if (row.annotation_type === 'callout') return false;
  if (row.annotation_type === 'highlight') return isLegacyFabricHighlightRow(row);
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
  if (current.annotation_type === 'highlight' && candidate.annotation_type !== 'highlight') {
    return candidate;
  }
  if (candidate.annotation_type === 'highlight' && current.annotation_type !== 'highlight') {
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
 * @param {string} [opts.highlightId] - Stable client-side ID. If not
 *   provided, the function tries fabricObj.id, fabricObj.data.id, then a
 *   generated one.
 * @returns {object} A row matching the document_annotations table shape.
 */
export function serializeFabricObjectToRow(fabricObj, opts = {}) {
  if (!fabricObj || typeof fabricObj !== 'object') {
    throw new Error('serializeFabricObjectToRow: fabricObj is required');
  }
  const { documentId, userId, pageNumber, highlightId, clientSessionId } = opts;
  if (!documentId) throw new Error('documentId required');
  if (!userId) throw new Error('userId required');
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    throw new Error('pageNumber must be a positive integer');
  }

  const dbType = fabricObjectToDbType(fabricObj);
  if (!dbType || !SUPPORTED_DB_TYPES.has(dbType)) {
    throw new Error(`Unsupported Fabric type: ${fabricObj.type} (data.type=${fabricObj.data?.type})`);
  }

  let id = highlightId || fabricObj.id || fabricObj.data?.id;
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
    user_id: userId,
    highlight_id: id,
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
 * @returns {{ fabricObject: object, pageNumber: number, highlightId: string,
 *            annotationType: string }}
 */
export function deserializeRowToFabricObject(row) {
  if (!row) throw new Error('row required');
  if (row.annotation_type === 'highlight' && !isLegacyFabricHighlightRow(row)) {
    throw new Error(
      'deserializeRowToFabricObject: highlight rows are not Fabric objects — '
      + 'use the highlight-specific deserializer instead.'
    );
  }

  const data = row.annotation_data || {};
  const fabricObject = data.fabricObject || null;
  if (!fabricObject) {
    throw new Error(
      `Row ${row.highlight_id} has no annotation_data.fabricObject — `
      + 'cannot reconstruct shape.'
    );
  }
  if (row.highlight_id) {
    if (!fabricObject.data || typeof fabricObject.data !== 'object') {
      fabricObject.data = {};
    }
    if (!fabricObject.id && !fabricObject.data.id) {
      fabricObject.data.id = row.highlight_id;
    }
  }

  return {
    fabricObject,
    pageNumber: data.pageNumber ?? row.page_number,
    highlightId: row.highlight_id,
    annotationType: row.annotation_type,
    schemaVersion: data.schemaVersion ?? 1
  };
}

/**
 * Serialize a callout (the in-app callout state lives separately from
 * annotationsByPage in its own `callouts` array).
 *
 * Callout shape (from saveCallouts in App.jsx):
 *   { id, pageNumber, anchor: {x,y}, knee: {x,y}, label: {...}, ... }
 */
export function serializeCalloutToRow(callout, opts = {}) {
  if (!callout || typeof callout !== 'object') {
    throw new Error('serializeCalloutToRow: callout is required');
  }
  const { documentId, userId, clientSessionId } = opts;
  if (!documentId) throw new Error('documentId required');
  if (!userId) throw new Error('userId required');
  const pageNumber = callout.pageNumber ?? callout.page_number ?? 1;

  const id = callout.id || callout.highlightId || generateClientId('callout');

  // Bounds: smallest rect enclosing anchor + knee + label rect.
  const bounds = computeCalloutBounds(callout);

  return {
    document_id: documentId,
    user_id: userId,
    highlight_id: id,
    annotation_type: 'callout',
    page_number: pageNumber,
    bounds,
    annotation_data: {
      callout,
      pageNumber,
      schemaVersion: 1,
      // See serializeFabricObjectToRow header — per-session id, not user id.
      clientSessionId: clientSessionId || null
    },
    last_modified_by: userId
  };
}

export function deserializeRowToCallout(row) {
  if (!row) throw new Error('row required');
  if (row.annotation_type !== 'callout') {
    throw new Error(`Expected annotation_type=callout, got ${row.annotation_type}`);
  }
  const data = row.annotation_data || {};
  const callout = data.callout;
  if (!callout) {
    throw new Error(`Callout row ${row.highlight_id} has no annotation_data.callout`);
  }
  return { ...callout, id: callout.id || row.highlight_id };
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function generateClientId(prefix) {
  const rand = Math.random().toString(36).slice(2, 11);
  return `${prefix}-${Date.now()}-${rand}`;
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

function computeCalloutBounds(callout) {
  const xs = [];
  const ys = [];
  const push = (pt) => {
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
  };
  push(callout.anchor);
  push(callout.knee);
  if (callout.label) {
    push({ x: callout.label.left, y: callout.label.top });
    if (Number.isFinite(callout.label.left) && Number.isFinite(callout.label.width)) {
      push({ x: callout.label.left + callout.label.width, y: callout.label.top });
    }
    if (Number.isFinite(callout.label.top) && Number.isFinite(callout.label.height)) {
      push({ x: callout.label.left, y: callout.label.top + callout.label.height });
    }
  }
  if (xs.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

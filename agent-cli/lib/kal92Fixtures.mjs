// agent-cli/lib/kal92Fixtures.mjs — deterministic fixtures for the KAL-92
// browser regression (PLAN-KAL92-BROWSER.md).
//
// The renderable annotation state is seeded as ONE annotation_updates WAL row
// per document: a Y.js update built with the app's OWN store module
// (src/services/annotationDocStore.js — pure, imports only yjs), so the map
// names and entry shapes can never drift from what useAnnotationDoc reads.
//
// DOC-A (guard case): WAL renders 12 fabric rects + 5 survey markers; its
//   document_annotations rows are ONLY the 5 markers (non-backfillable type) so
//   YDocProvider's backfill leaves the phase30 Y.Map EMPTY — the genuine
//   stale-smaller-CRDT-vs-rendered-truth incident shape.
// DOC-B (growth control): WAL renders 4 rects; document_annotations has 12
//   geometrically-distinct backfillable 'square' rows so the Y.Map (12) is
//   LARGER than rendered (4) and a dedupe-resync legitimately applies.

import * as Y from 'yjs';
import {
  syncByPageToDoc,
  syncSurveyMarkersToDoc,
} from '../../src/services/annotationDocStore.js';

// PostgREST bytea wire format — '\x<hex>' (mirror of annotationDocSync.js
// bytesToPgHex; copied inline to avoid importing its registry/idb chain).
function bytesToPgHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

export const DOC_A_ID = '7a92e000-0000-4000-8000-000000000a0a';
export const DOC_B_ID = '7a92e000-0000-4000-8000-000000000b0b';
export const DOC_A_NAME = 'KAL92 Guard Case.pdf';
export const DOC_B_NAME = 'KAL92 Growth Control.pdf';
export const TEMPLATE_NAME = 'KAL92 Template';
export const MODULE_NAME = 'KAL92 Module';
export const MODULE_ID = 'kal92-module-0001';
const TEMPLATE_ID = '7a92e000-0000-4000-8000-00000000ee01';
const NOW = '2026-06-01T00:00:00.000Z';

function fabricRect(id, i) {
  // Minimal renderable rect per svgAnnotationRenderers.renderRect — geometry +
  // stroke; data.id is the stable id annotationDocStore extracts.
  return {
    type: 'rect',
    left: 40 + (i % 4) * 130,
    top: 60 + Math.floor(i / 4) * 110,
    width: 90,
    height: 60,
    fill: 'transparent',
    stroke: '#cc3333',
    strokeWidth: 2,
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    id,
    data: { id },
  };
}

function surveyMarker(id, i) {
  // Fields per the SVG layer's gates (annotationId/pageNumber/moduleId/x/y/w/h)
  // plus the mapper-shape extras (bounds, categoryId, scope) so every consumer
  // finds what it expects.
  const x = 60 + i * 95;
  const y = 420;
  return {
    annotationId: id,
    pageNumber: 1,
    moduleId: MODULE_ID,
    x,
    y,
    width: 70,
    height: 50,
    bounds: { x, y, width: 70, height: 50 },
    color: '#FFD700',
    opacity: 0.3,
    name: `KAL92 marker ${i + 1}`,
    categoryId: null,
    regionId: null,
    needsEntity: false,
    angle: 0,
    checklistResponses: {},
    visibilityScope: 'survey',
  };
}

function buildWalHex({ rectCount, markerCount }) {
  const doc = new Y.Doc();
  const byPage = { 1: { objects: [] } };
  for (let i = 0; i < rectCount; i += 1) {
    byPage[1].objects.push(fabricRect(`kal92-fab-${String(i + 1).padStart(2, '0')}`, i));
  }
  syncByPageToDoc(doc, byPage, { origin: 'seed' });
  if (markerCount > 0) {
    const markers = {};
    for (let i = 0; i < markerCount; i += 1) {
      const id = `kal92-marker-${String(i + 1).padStart(2, '0')}`;
      markers[id] = surveyMarker(id, i);
    }
    syncSurveyMarkersToDoc(doc, markers, { origin: 'seed' });
  }
  return bytesToPgHex(Y.encodeStateAsUpdate(doc));
}

function markerRow(documentId, id, i) {
  // Marker-only mapper shape (documentSurveyMarkerMapper.buildSurveyMarkerRow)
  // — deliberately NO annotation_data.fabricObject (Codex r2 finding) and a
  // non-backfillable type, so DOC-A's backfill imports nothing.
  const m = surveyMarker(id, i);
  return {
    id: `row-${id}`,
    document_id: documentId,
    user_id: null, // stamped by the mock once the real user id is captured
    annotation_id: id,
    annotation_type: 'survey-marker',
    page_number: 1,
    bounds: m.bounds,
    category_id: null,
    module_id: MODULE_ID,
    space_id: null,
    name: m.name,
    notes: null,
    entity_id: null,
    entity_name: null,
    checklist_responses: {},
    changed_by: null,
    changed_date: null,
    color: m.color,
    opacity: m.opacity,
    last_modified_by: null,
    version: 1,
    annotation_data: { regionId: null, scope: 'survey' },
    created_at: NOW,
    updated_at: NOW,
  };
}

function backfillableRow(documentId, i) {
  const id = `kal92-bf-${String(i + 1).padStart(2, '0')}`;
  return {
    id: `row-${id}`,
    document_id: documentId,
    user_id: null,
    annotation_id: id,
    annotation_type: 'square',
    page_number: 1,
    bounds: {},
    color: '#3333cc',
    opacity: 1,
    annotation_data: { fabricObject: fabricRect(id, i), pageNumber: 1, schemaVersion: 2 },
    created_at: NOW,
    updated_at: NOW,
  };
}

function documentRow(id, name) {
  return {
    id,
    name,
    user_id: null, // stamped by the mock
    project_id: null,
    archived: false,
    file_path: `kal92/${id}.pdf`,
    file_size: 102400,
    page_count: 1,
    created_at: NOW,
    updated_at: NOW,
    last_opened_at: null,
    locked_at: null,
    locked_by: null,
    tool_preferences: null,
    annotations_changed_at: null,
    cutover_completed_at: null,                  // backfill seal gate must SKIP
    embedded_import_completed_at: NOW,           // embedded import must NOT run (Codex r2)
    content_sha256: null,
  };
}

export function buildFixtures() {
  const docA = {
    row: documentRow(DOC_A_ID, DOC_A_NAME),
    walRows: [{ document_id: DOC_A_ID, seq: 1, data: buildWalHex({ rectCount: 12, markerCount: 5 }) }],
    annotationRows: Array.from({ length: 5 }, (_, i) => markerRow(DOC_A_ID, `kal92-marker-${String(i + 1).padStart(2, '0')}`, i)),
  };
  const docB = {
    row: documentRow(DOC_B_ID, DOC_B_NAME),
    walRows: [{ document_id: DOC_B_ID, seq: 1, data: buildWalHex({ rectCount: 4, markerCount: 0 }) }],
    annotationRows: Array.from({ length: 12 }, (_, i) => backfillableRow(DOC_B_ID, i)),
  };
  const template = {
    id: TEMPLATE_ID,
    user_id: null, // stamped by the mock
    name: TEMPLATE_NAME,
    created_at: NOW,
    updated_at: NOW,
    // Belt + suspenders: the selection modal reads template.modules (the
    // Dashboard maps rows through config in some paths) — provide both.
    modules: [{ id: MODULE_ID, name: MODULE_NAME, categories: [] }],
    config: {
      id: TEMPLATE_ID,
      name: TEMPLATE_NAME,
      modules: [{ id: MODULE_ID, name: MODULE_NAME, categories: [] }],
      entities: [],
    },
  };

  return {
    documents: [docA.row, docB.row],
    projects: [],
    templates: [template],
    docsById: { [DOC_A_ID]: docA, [DOC_B_ID]: docB },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Y from 'yjs';

import {
  serializeFabricObjectToRow,
  deserializeRowsToAnnotationsByPage,
  normalizeFabricAnnotationRows,
} from '../src/services/annotationTypeSerializers.js';
import {
  buildFabricSyncDelta,
} from '../src/utils/annotationSyncDelta.js';
import {
  syncByPageToDoc,
  getAnnotationsMap,
  docToByPage,
  setMetaValue,
  getMetaValue,
} from '../src/services/annotationDocStore.js';
import { migrateCalloutsMetaToAnnotationsMap } from '../src/services/calloutMetaMigration.js';
import {
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import {
  isAnnotationVisibleInContext,
} from '../src/utils/annotationVisibilityRules.js';
import {
  convertPdfAnnotationToFabric,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  applyCalloutCommit,
  applyFabricCommit,
  materializeCalloutFromYMap,
} from '../src/lib/collab/crdtAnnotationBridge.js';

const DOC_ID = 'contract-doc';
const USER_ID = 'contract-user';
const RLS_FIX_26_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260513010000_fix_shared_document_annotation_rls_contract.sql',
);
const RLS_FIX_26_RETURNING_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260513013000_fix_document_insert_returning_select_policy.sql',
);

const origin = Object.freeze({
  source: 'local-fabric',
  userId: USER_ID,
  deviceId: 'device-1',
  sessionId: 'session-1',
  clientID: 1,
});

const ctx = {
  userId: USER_ID,
  deviceId: 'device-1',
  sessionId: 'session-1',
  clientID: 1,
};

const page = (objects) => ({ version: '5.3.0', objects });

function makeViewport({ pageHeight = 100 } = {}) {
  return {
    height: pageHeight,
    convertToViewportPoint(x, y) {
      return [x, pageHeight - y];
    },
    convertToViewportRectangle(rect) {
      const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
      return [x1, y1, x2, y2];
    },
  };
}

function fabricFixtures() {
  return [
    ['pen stroke', { type: 'path', left: 1, top: 2, width: 10, height: 10, path: [['M', 0, 0], ['L', 10, 10]], stroke: '#111', strokeWidth: 2 }],
    ['highlighter stroke', { type: 'path', left: 3, top: 4, width: 20, height: 5, path: [['M', 0, 0], ['L', 20, 0]], stroke: 'rgba(255,255,0,0.5)', strokeWidth: 8, globalCompositeOperation: 'multiply' }],
    ['survey annotation', { type: 'rect', left: 5, top: 6, width: 20, height: 10, fill: 'transparent', stroke: '#f59e0b', moduleId: 'module-1' }],
    ['region annotation', { type: 'circle', left: 7, top: 8, width: 16, height: 16, radius: 8, fill: 'transparent', stroke: '#22c55e', regionId: 'region-1' }],
    ['survey-region annotation', { type: 'line', left: 1, top: 1, width: 30, height: 30, x1: 0, y1: 0, x2: 30, y2: 30, stroke: '#0ea5e9', moduleId: 'module-1', regionId: 'region-1' }],
    ['rectangle', { type: 'rect', left: 10, top: 10, width: 30, height: 20, fill: 'transparent', stroke: '#111' }],
    ['circle', { type: 'circle', left: 15, top: 15, width: 20, height: 20, radius: 10, fill: 'transparent', stroke: '#111' }],
    ['line', { type: 'line', left: 0, top: 0, width: 40, height: 0, x1: 0, y1: 0, x2: 40, y2: 0, stroke: '#111' }],
    ['arrow', { type: 'line', left: 0, top: 0, width: 40, height: 20, x1: 0, y1: 0, x2: 40, y2: 20, stroke: '#111', tool: 'arrow', data: { arrowheadStyle: 'solidTriangle' } }],
    ['text box', { type: 'textbox', left: 2, top: 2, width: 80, height: 20, text: 'Note', fontSize: 12, fill: '#111' }],
    ['counter pin', { type: 'circle', left: 20, top: 20, width: 24, height: 24, radius: 12, fill: '#ef4444', stroke: '#fff', data: { type: 'counter', displayNumber: 1, seriesId: 'series-1' } }],
    ['imported squiggle', convertPdfAnnotationToFabric({ id: 'pdf-squiggle', subtype: 'Squiggly', rect: [10, 10, 50, 20], color: [1, 0, 0] }, makeViewport())],
    ['imported polyline', convertPdfAnnotationToFabric({ id: 'pdf-polyline', subtype: 'PolyLine', vertices: [10, 10, 30, 20, 50, 10], color: [0, 0, 1] }, makeViewport())],
    ['imported polygon', convertPdfAnnotationToFabric({ id: 'pdf-polygon', subtype: 'Polygon', vertices: [10, 10, 30, 10, 20, 30], color: [0, 0, 0], interiorColor: [0, 1, 0] }, makeViewport())],
  ];
}

function getContractId(obj) {
  return obj?.data?.id || obj?.id || obj?.pdfAnnotationId || null;
}

test('contract: every generated Fabric annotation type receives and keeps a stable Supabase/Y.Doc id', () => {
  for (const [name, obj] of fabricFixtures()) {
    assert.ok(obj, `${name} fixture must convert`);
    const first = serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 });
    const second = serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 });

    assert.ok(first.annotation_id, `${name} must produce a row id`);
    assert.equal(second.annotation_id, first.annotation_id, `${name} must reuse the stamped id`);
    assert.equal(getContractId(obj), first.annotation_id, `${name} must stamp a local contract id`);
    assert.equal(first.annotation_data.fabricObject, obj, `${name} row stores the same fabric object payload`);
  }
});

test('contract: every generated Fabric annotation type participates in one-object sync delta', () => {
  for (const [name, obj] of fabricFixtures()) {
    serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 });
    const id = getContractId(obj);
    const current = { 1: page([obj]) };
    const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: { 1: page([]) }, actionType: `create:${name}` });

    assert.deepEqual(delta.changedIds, [id], `${name} must be the changed id`);
    assert.equal(delta.changedCount, 1, `${name} must dispatch one upsert`);
    assert.equal(delta.yDocUpdateCount, 1, `${name} must dispatch one Y.Doc update`);
    assert.equal(delta.fullFanOutReason, null, `${name} must not fan out whole page`);
  }
});

test('contract: every generated Fabric annotation type can be represented in local history', () => {
  for (const [name, obj] of fabricFixtures()) {
    serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 });
    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: page([]),
      nextPage: page([obj]),
    });
    const afterCreate = applyAnnotationHistoryAction({}, action);
    const afterUndo = applyAnnotationHistoryAction(afterCreate, invertAnnotationHistoryAction(action));

    assert.equal(action.type, 'fabric:create', `${name} must create a local history action`);
    assert.equal(action.annotationId, getContractId(obj), `${name} history id must match contract id`);
    assert.equal(afterCreate[1].objects.length, 1, `${name} create action must apply`);
    assert.equal(afterUndo[1].objects.length, 0, `${name} inverse action must undo`);
  }
});

test('contract: every generated Fabric annotation type writes to the Y.Doc annotations map', () => {
  const ydoc = new Y.Doc();
  const yMapAnnotations = ydoc.getMap('annotations');

  for (const [name, obj] of fabricFixtures()) {
    serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 });
    obj.pageNumber = 1;
    applyFabricCommit(ydoc, yMapAnnotations, obj, origin, ctx);
    const id = getContractId(obj);
    const annoYMap = yMapAnnotations.get(id);

    assert.ok(annoYMap, `${name} must write an annotation Y.Map`);
    assert.equal(annoYMap.get('id'), id, `${name} Y.Map id must match`);
    assert.equal(annoYMap.get('pageNumber'), 1, `${name} Y.Map page must match`);
    assert.equal(annoYMap.get('fabric').get('type'), obj.type, `${name} Y.Map fabric type must match`);
  }
});

test('contract: imported polyline, polygon, and squiggle normalize duplicates and remain selectable', () => {
  const imported = fabricFixtures()
    .filter(([name]) => name.startsWith('imported '))
    .map(([, obj]) => obj);

  for (const obj of imported) {
    assert.equal(obj.selectable, true, `${obj.pdfAnnotationType} must be selectable`);
    assert.equal(obj.evented, true, `${obj.pdfAnnotationType} must be evented`);
    assert.equal(obj.isPdfImported, true, `${obj.pdfAnnotationType} must retain import provenance`);
  }

  const duplicateRows = imported.flatMap((obj, index) => {
    const row = serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 });
    return [
      { ...row, updated_at: `2026-05-12T00:00:0${index}.000Z` },
      { ...row, annotation_id: `${row.annotation_id}-older`, updated_at: `2026-05-11T00:00:0${index}.000Z` },
    ];
  });

  const normalized = normalizeFabricAnnotationRows(duplicateRows);
  const restored = deserializeRowsToAnnotationsByPage(duplicateRows);

  assert.equal(normalized.length, 3);
  assert.equal(restored[1].objects.length, 3);
  assert.deepEqual(
    restored[1].objects.map((obj) => obj.pdfAnnotationType).sort(),
    ['PolyLine', 'Polygon', 'Squiggly'],
  );
});

test('contract: survey, regular, region, and survey-region visibility do not leak modes', () => {
  const spaces = [{
    id: 'space-1',
    assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-1' }] }],
  }];
  const base = {
    pageNumber: 1,
    selectedSpaceId: 'space-1',
    activeSpaceId: 'space-1',
    activeRegionId: 'region-1',
    spaces,
  };

  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: { moduleId: 'module-1' }, showSurveyPanel: false, selectedModuleId: 'module-1' }), false);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: { moduleId: 'module-1' }, showSurveyPanel: true, selectedModuleId: 'module-1' }), true);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: {}, showSurveyPanel: true, selectedModuleId: 'module-1' }), true);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: {}, showSurveyPanel: false, selectedModuleId: 'module-1' }), true);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: { regionId: 'region-1' }, activeSpaceId: null }), false);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: { moduleId: 'module-1', regionId: 'region-1' }, showSurveyPanel: false, selectedModuleId: 'module-1' }), false);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: { moduleId: 'module-1', regionId: 'region-1' }, showSurveyPanel: true, selectedModuleId: 'module-2' }), false);
  assert.equal(isAnnotationVisibleInContext({ ...base, annotation: { moduleId: 'module-1', regionId: 'region-1' }, showSurveyPanel: true, selectedModuleId: 'module-1' }), true);
});

test('contract: callouts ride the flat annotations Y.Map per-id like every other type (Slice 6)', () => {
  // The historical fork — a separate Supabase callout row + a separate Y.Doc
  // 'callouts' map — is retired. A callout is a projected data.type==='callout'
  // group whose stable id keys the SAME `annotations` map syncByPageToDoc
  // maintains for every other annotation, and its verbatim normalized payload
  // (data.legacyCallout) makes the byPage⇄doc round-trip lossless.
  const callout = {
    id: 'callout-contract-1',
    pageNumber: 1,
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.2 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: 'Callout',
  };

  const group = calloutToAnnotationObject(callout, { width: 612, height: 792 });
  group.pageNumber = 1;
  const ydoc = new Y.Doc();
  const res = syncByPageToDoc(ydoc, { 1: { objects: [group] } });
  assert.equal(res.added, 1, 'the callout group is one per-id map entry');
  assert.equal(res.skipped, 0, 'the old write-contamination skip is gone');
  assert.equal(getAnnotationsMap(ydoc).has(callout.id), true, 'keyed by the callout id in the shared annotations map');
  assert.equal(ydoc.getMap('callouts').size, 0, 'no separate Y.Doc callouts map is written');

  const revived = docToByPage(ydoc)[1].objects.find((o) => o?.data?.type === 'callout');
  assert.deepEqual(revived.data.legacyCallout, callout, 'the normalized payload round-trips verbatim');
  assert.deepEqual(deriveCalloutsFromByPage(docToByPage(ydoc)), [callout], 'derive recovers the exact callout');

  // Legacy docs migrate off the coarse calloutsList META blob exactly once.
  const legacyDoc = new Y.Doc();
  setMetaValue(legacyDoc, 'calloutsList', [callout]);
  const migration = migrateCalloutsMetaToAnnotationsMap(legacyDoc, { pageSizes: {} });
  assert.equal(migration.migrated, true);
  assert.equal(getAnnotationsMap(legacyDoc).has(callout.id), true);
  assert.equal(getMetaValue(legacyDoc, 'calloutsList'), null, 'meta blob tombstoned after migration');
});

test('contract: Lane B legacy-undo can still materialize a callout from its CRDT Y.Map', () => {
  // materializeCalloutFromYMap stays live: PDFViewer's yjs-history pop path
  // (refreshYjsHistoryTargetFromDoc, ~PDFViewer.jsx:10715) reads the legacy
  // CRDT overlay's callout Y.Maps when replaying old history entries. This
  // pins that read until Lane B itself is retired.
  const callout = {
    id: 'callout-laneb-1',
    pageNumber: 1,
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.2 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: 'Callout',
  };
  const ydoc = new Y.Doc();
  const yMapCallouts = ydoc.getMap('callouts');
  applyCalloutCommit(ydoc, yMapCallouts, callout, origin, ctx);
  const materialized = materializeCalloutFromYMap(yMapCallouts.get(callout.id), callout.id);
  assert.equal(yMapCallouts.has(callout.id), true);
  assert.equal(materialized.text, 'Callout');
});

test('contract: shared document RLS remains least-privilege for documents and annotations', () => {
  const sql = readFileSync(RLS_FIX_26_MIGRATION, 'utf8');
  const returningSql = readFileSync(RLS_FIX_26_RETURNING_MIGRATION, 'utf8');

  assert.match(
    sql,
    /CREATE POLICY "Users can upload documents within limits"[\s\S]*auth\.uid\(\) = user_id[\s\S]*COALESCE\(\([\s\S]*storage_used_bytes[\s\S]*\), 0\)/,
    'document INSERT policy must require owner insert and tolerate missing subscription rows as zero storage',
  );
  assert.match(
    sql,
    /CREATE POLICY "Users can insert own annotations on editable documents"[\s\S]*auth\.uid\(\) = user_id[\s\S]*user_can_access_document\(document_id, 'editor'\)/,
    'annotation INSERT must be scoped to the current user on editable documents',
  );
  assert.match(
    sql,
    /CREATE POLICY "Users can update own annotations or owners can update any"[\s\S]*auth\.uid\(\) = user_id[\s\S]*user_can_access_document\(document_id, 'owner'\)/,
    'annotation UPDATE must allow own rows plus explicit owner override only',
  );
  assert.match(
    sql,
    /CREATE POLICY "Users can delete own annotations or owners can delete any"[\s\S]*auth\.uid\(\) = user_id[\s\S]*user_can_access_document\(document_id, 'owner'\)/,
    'annotation DELETE must allow own rows plus explicit owner override only',
  );
  assert.doesNotMatch(
    `${sql}\n${returningSql}`,
    /TO authenticated\s+(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i,
    'Fix 26 must not add broad allow-all-authenticated policies',
  );
  assert.match(
    returningSql,
    /CREATE POLICY "Users can view accessible documents"[\s\S]*auth\.uid\(\) = user_id[\s\S]*user_can_access_document\(id, 'viewer'\)/,
    'document SELECT must keep owner fast path for INSERT RETURNING and collaborator helper access',
  );
});

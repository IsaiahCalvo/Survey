import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

import {
  docToByPage,
  clearEraserOpsForAnnotationIds,
  getEraserOpsMap,
  getAnnotationsMap,
  getMetaValue,
  getSurveyMarkersMap,
  setMetaValue,
  syncByPageToDoc,
  readAnnotationObject,
  writeAnnotationMark,
} from '../src/services/annotationDocStore.js';

// RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
// — marks are nested per-field maps in the `marks` map (store v3); tests seed
// them through the store instead of setting a whole { p, o } value.
function seedMark(doc, key, entry) {
  writeAnnotationMark(doc, key, entry.p, entry.o);
}

import {
  openAnnotationDoc,
  purgeAnnotationDoc,
  __test,
} from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import {
  _evictForTest,
  getOrCreateYDoc,
  releaseYDoc,
} from '../src/lib/collab/ydocRegistry.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  buildEraseIntent,
  buildPageEraseTargets,
  commitEraseIntent,
} from '../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../src/utils/annotationEraseCommitPlan.js';
import { formatEraserMutationId } from '../src/utils/eraserMutationId.js';
import { getAnnotationStorageKey } from '../src/utils/annotationStorageIdentity.js';
import {
  applyAnnotationHistoryAction,
  buildPreciseAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { normalizeCanvasJsonForHistory } from '../src/utils/historyHelpers.js';

const {
  bytesToPgHex,
  emitHistoryQuarantine,
  pgHexToBytes,
  subscribeHistoryQuarantine,
} = __test;
const WAL_CONCURRENCY_SQL = readFileSync(
  new URL('../supabase/migrations/20260727131230_annotation_wal_concurrency.sql', import.meta.url),
  'utf8',
);
const FABRIC_ERASER_SOURCE = readFileSync(
  new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url),
  'utf8',
);

test('history quarantine replay keeps one stable per-open key and generation', () => {
  const makeState = (writerId) => ({
    documentId: 'dedupe-doc',
    actorUserId: 'dedupe-actor',
    documentIncarnation: 0,
    writerId,
    historyQuarantineGeneration: 0,
    historyQuarantineListeners: new Set(),
    lastHistoryQuarantineEvent: null,
  });
  const state = makeState('writer-open-a');
  const firstDeliveries = [];
  const unsubscribe = subscribeHistoryQuarantine(
    state,
    (event) => firstDeliveries.push(event),
  );
  emitHistoryQuarantine(state, {
    reason: 'staging-failure',
    code: 'STAGING_FAILED',
    requiresFullHistoryReset: true,
  });
  unsubscribe();

  const replayDeliveries = [];
  subscribeHistoryQuarantine(
    state,
    (event) => replayDeliveries.push(event),
  )();
  assert.equal(firstDeliveries.length, 1);
  assert.equal(replayDeliveries.length, 1);
  assert.equal(replayDeliveries[0], firstDeliveries[0]);
  assert.equal(replayDeliveries[0].generation, 1);
  assert.equal(replayDeliveries[0].dedupeKey, firstDeliveries[0].dedupeKey);
  assert.match(replayDeliveries[0].dedupeKey, /writer-open-a/);

  const secondOpen = makeState('writer-open-b');
  const secondEvent = emitHistoryQuarantine(secondOpen, {
    reason: 'staging-failure',
    code: 'STAGING_FAILED',
    requiresFullHistoryReset: true,
  });
  assert.notEqual(secondEvent.dedupeKey, firstDeliveries[0].dedupeKey);
});

const nativeInk = (id = 'ink', y = 50) => ({
  type: 'path',
  id,
  annotationId: id,
  path: [['M', 0, y], ['L', 100, y]],
  left: 0,
  top: 0,
  stroke: '#d11b2d',
  strokeWidth: 20,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  data: { id, tool: 'pen' },
});

const curvedInk = (id = 'ink') => ({
  ...nativeInk(id),
  strokeWidth: 5,
  path: [
    ['M', 0, 50],
    ['Q', 5, 58.13878456662534, 10, 57.88359783990768],
    ['Q', 15, 55.97833982287298, 20, 56.905674933190994],
    ['Q', 25, 53.247962844387764, 30, 52.67990520124724],
    ['Q', 35, 50.207948278030926, 40, 47.19373417848304],
    ['Q', 45, 47.148109407549796, 50, 43.0273938206913],
    ['Q', 55, 44.3601494243059, 60, 42.14037909900534],
    ['Q', 65, 42.10985252770469, 70, 44.94986689702143],
    ['Q', 75, 40.61174595726264, 80, 50.134511203874794],
    ['Q', 85, 40.0086484972672, 90, 55.25589278975031],
    ['Q', 95, 40.358055153576345, 100, 57.905345871016],
    ['Q', 105, 41.6266559902612, 110, 56.83679126470625],
    ['Q', 115, 43.69351166107225, 120, 52.552786898794814],
  ],
});

const shortInk = (id, start, end, { idless = false } = {}) => {
  const object = {
    ...nativeInk(id),
    path: [['M', start, 50], ['L', end, 50]],
    strokeWidth: 2,
  };
  if (idless) {
    delete object.id;
    delete object.annotationId;
    object.data = { tool: 'pen' };
  }
  return object;
};

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return (polygons || []).some((polygon) => (
    polygon.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)
  ));
}

function cloneDoc(source) {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

async function snapshotHexToDoc(hex) {
  const compressed = pgHexToBytes(hex);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const update = new Uint8Array(await new Response(stream).arrayBuffer());
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

function serializedAnnotation(doc, id) {
  const annotation = Object.values(docToByPage(doc))
    .flatMap((page) => page?.objects || [])
    .find((object) => String(object?.data?.id ?? object?.id ?? object?.annotationId) === String(id));
  assert.ok(annotation, `annotation ${id} exists`);
  const bytes = JSON.stringify(annotation);
  return {
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

function commitErase(doc, {
  id,
  points,
  radius = 7,
  mode = 'partial',
  writerId = 'local',
}) {
  const current = docToByPage(doc);
  const result = erasePageAnnotations({
    pageAnnotations: current[1],
    eraserPoints: points,
    eraserRadius: radius,
    mode,
  });
  const page = {
    ...result.pageAnnotations,
    eraserMutation: {
      id,
      pageNumber: 1,
      points,
      radius,
      mode,
      touchedIds: result.touchedIds,
      changedIds: result.changedIds,
      deletedIds: result.deletedIds,
      objectMutations: result.objectMutations,
    },
  };
  syncByPageToDoc(doc, { 1: page }, { eraserWriterId: writerId });
}

function prepareAtomicErase(byPage, {
  mutationId,
  points,
  radius = 7,
  mode = 'partial',
  userId = 'test-actor',
  includeDeleteHistory = false,
}) {
  const page = byPage[1] || { objects: [] };
  const erased = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: points,
    eraserRadius: radius,
    mode,
  });
  return prepareEraseIntentForCommit({
    intent: buildEraseIntent({
      mutationId,
      pageNumber: 1,
      renderer: 'svg',
      gesture: { points, radius, mode },
      targets: buildPageEraseTargets({
        pageNumber: 1,
        originalObjects: page.objects,
        objectMutations: erased.objectMutations,
      }),
    }),
    annotationsByPage: byPage,
    userId,
    includeDeleteHistory,
  });
}

async function commitAtomicEraseOnDoc(doc, {
  id,
  points,
  radius = 7,
  mode = 'partial',
  writerId = 'local',
}) {
  const intent = prepareAtomicErase(docToByPage(doc), {
    mutationId: id,
    points,
    radius,
    mode,
  });
  return commitEraseIntent({
    doc,
    intent,
    actorUserId: writerId,
    eraserWriterId: writerId,
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: (target) => (
      Object.values(docToByPage(doc))
        .flatMap((page) => page?.objects || [])
        .find((object) => (
          String(getAnnotationStorageKey(object)) === String(target.storageKey)
        ))
    ),
  });
}

function polygonBounds(polygons) {
  const points = (polygons || []).flat(2);
  return points.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  }), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
}

function exchangeUpdates(a, b, updateA, updateB) {
  Y.applyUpdate(a, updateB);
  Y.applyUpdate(b, updateA);
}

test('an unrelated later erase never reapplies an earlier erase to untouched geometry', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, {
    1: { objects: [curvedInk('ink-a'), nativeInk('ink-b', 100)] },
  });

  const clientA = cloneDoc(seed);
  commitErase(clientA, {
    id: 'erase-a',
    points: [{ x: 5, y: 38 }],
    radius: 11,
  });
  const afterA = serializedAnnotation(clientA, 'ink-a');

  const reloadedAfterA = cloneDoc(clientA);
  assert.deepEqual(serializedAnnotation(reloadedAfterA, 'ink-a'), afterA, 'erase A is reload-stable');

  const clientB = cloneDoc(reloadedAfterA);
  commitErase(clientB, {
    id: 'erase-b',
    points: [{ x: 50, y: 88 }],
  });

  assert.deepEqual(
    serializedAnnotation(clientB, 'ink-a'),
    afterA,
    'client B erasing distinct ink B leaves serialized ink A byte-identical',
  );

  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB));
  assert.deepEqual(
    serializedAnnotation(clientA, 'ink-a'),
    afterA,
    'client A remains byte-identical after receiving client B',
  );
  assert.deepEqual(
    serializedAnnotation(cloneDoc(clientB), 'ink-a'),
    afterA,
    'merged state remains byte-identical after reload',
  );
});

test('writer-scoped eraser ids cannot collide for first same-millisecond gestures in two tabs', () => {
  const timestamp = 1_750_000_000_000;
  const tabA = formatEraserMutationId('writer-a', timestamp, 1);
  const tabB = formatEraserMutationId('writer-b', timestamp, 1);

  assert.notEqual(tabA, tabB);
  assert.match(tabA, /^eraser:writer-a:/);
  assert.match(tabB, /^eraser:writer-b:/);
});

test('two production handles preserve an eraser lane while collaborator move/restyle updates the stable base', async () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [nativeInk('collab-base-edit')] } });
  const docA = cloneDoc(seed);
  const docB = cloneDoc(seed);
  const handleA = await openAnnotationDoc({
    actorUserId: 'owner',
    documentId: 'collab-base-edit-a',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: docA,
  });
  const handleB = await openAnnotationDoc({
    actorUserId: 'collaborator',
    documentId: 'collab-base-edit-b',
    supabase: null,
    clientId: 'client-b',
    writerId: 'writer-b',
    enableLocal: false,
    enableRealtime: false,
    doc: docB,
  });
  try {
    const before = handleA.getByPage();
    const intent = prepareAtomicErase(before, {
      mutationId: 'collab-base-edit-erase',
      points: [{ x: 50, y: 50 }],
    });
    const erased = await handleA.commitEraseIntent(intent, {
      permissionContext: { mode: 'local-only' },
      validateTarget: () => true,
    });
    assert.equal(erased.status, 'committed');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'receive-a-erase');

    const beforeBEdit = handleB.getByPage();
    const erasedObject = beforeBEdit[1].objects[0];
    const desired = {
      ...erasedObject,
      left: 200,
      top: 100,
      scaleX: 1.25,
      scaleY: 0.8,
      angle: 30,
      fill: '#2563eb',
      opacity: 0.35,
      data: {
        ...erasedObject.data,
        collaboratorRevision: 'moved-and-restyled',
      },
    };
    handleB.applyByPage({ 1: { ...beforeBEdit[1], objects: [desired] } });
    assert.equal(getEraserOpsMap(docB).size, 1, 'ordinary edit never creates or retires a lane');
    assert.equal(
      [...getEraserOpsMap(docB).keys()].some((key) => key.startsWith('writer-b\u0000')),
      false,
    );
    const stableBase = readAnnotationObject(docB, 'collab-base-edit'); // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    assert.equal(stableBase.left, 200);
    assert.equal(stableBase.top, 100);
    assert.equal(stableBase.angle, 30);
    assert.equal(stableBase.stroke, '#2563eb');
    assert.equal(stableBase.opacity, 0.35);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'receive-b-base-edit');
    const visibleA = handleA.getByPage()[1].objects[0];
    const visibleB = handleB.getByPage()[1].objects[0];
    assert.deepEqual(visibleA, visibleB);
    assert.equal(visibleA.fill, '#2563eb');
    assert.equal(visibleA.opacity, 0.35);
    assert.equal(visibleA.data.collaboratorRevision, 'moved-and-restyled');
    const movedBounds = polygonBounds(visibleA.polygons);
    assert.ok(movedBounds.minX > 100, `expected moved x geometry, got ${movedBounds.minX}`);
    assert.ok(movedBounds.minY > 50, `expected moved y geometry, got ${movedBounds.minY}`);

    handleB.applyByPage(beforeBEdit);
    assert.equal(getEraserOpsMap(docB).size, 1);
    assert.equal(
      readAnnotationObject(docB, 'collab-base-edit').paperEraserGeometry, // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
      undefined,
      'collaborator edit Undo must not bake the erased survivor into the stable base',
    );
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'receive-b-edit-undo');
    const afterEditUndo = handleA.getByPage()[1].objects[0];
    assert.equal(afterEditUndo.fill, '#d11b2d');
    assert.equal(afterEditUndo.data.collaboratorRevision, undefined);
    assert.equal(
      pointInPolygonSet({ x: 50, y: 50 }, afterEditUndo.polygons),
      false,
    );

    assert.equal(
      handleA.applyEraseHistoryTransition(erased.historyTransition, 'undo').status,
      'applied',
    );
    const restored = handleA.getByPage()[1].objects[0];
    assert.equal(restored.paperEraserGeometry, undefined);
    assert.deepEqual(restored.path, before[1].objects[0].path);
    assert.equal(
      handleA.applyEraseHistoryTransition(erased.historyTransition, 'redo').status,
      'applied',
    );
    assert.equal(
      pointInPolygonSet(
        { x: 50, y: 50 },
        handleA.getByPage()[1].objects[0].polygons,
      ),
      false,
    );
  } finally {
    await handleA.destroy();
    await handleB.destroy();
  }
});

test('same-writer erase then edit Undo leaves the older erase Undo/Redo exact', async () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [nativeInk('same-writer-edit')] } });
  const handle = await openAnnotationDoc({
    actorUserId: 'owner',
    documentId: 'same-writer-edit-history',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  try {
    const original = handle.getByPage();
    const intent = prepareAtomicErase(original, {
      mutationId: 'same-writer-edit-erase',
      points: [{ x: 50, y: 50 }],
    });
    const result = await handle.commitEraseIntent(intent, {
      permissionContext: { mode: 'local-only' },
      validateTarget: () => true,
    });
    const erased = handle.getByPage();
    const editedObject = {
      ...erased[1].objects[0],
      left: 80,
      top: 35,
      fill: '#16a34a',
      data: { ...erased[1].objects[0].data, editRevision: 'later-edit' },
    };
    handle.applyByPage({ 1: { ...erased[1], objects: [editedObject] } });
    assert.equal(getEraserOpsMap(doc).size, 1);
    assert.equal(handle.getByPage()[1].objects[0].fill, '#16a34a');

    handle.applyByPage(erased);
    assert.equal(getEraserOpsMap(doc).size, 1, 'edit Undo preserves older erase lane');
    assert.equal(
      readAnnotationObject(doc, 'same-writer-edit').paperEraserGeometry, // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
      undefined,
      'edit Undo must keep the original stable centerline base',
    );
    assert.equal(handle.getByPage()[1].objects[0].fill, '#d11b2d');
    assert.equal(
      handle.applyEraseHistoryTransition(result.historyTransition, 'undo').status,
      'applied',
    );
    assert.deepEqual(handle.getByPage()[1].objects[0].path, original[1].objects[0].path);
    assert.equal(
      handle.applyEraseHistoryTransition(result.historyTransition, 'redo').status,
      'applied',
    );
    assert.equal(
      pointInPolygonSet(
        { x: 50, y: 50 },
        handle.getByPage()[1].objects[0].polygons,
      ),
      false,
    );
  } finally {
    await handle.destroy();
  }
});

test('accepted ordinary WAL does not close later erase effects and core acceptance precedes execution', async () => {
  const documentId = 'erase-effects-after-ordinary-wal';
  const rows = [];
  let sequence = 0;
  const effects = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        sequence += 1;
        rows.push({
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'owner',
          data: args.p_data,
          seq: sequence,
        });
        return { data: { seq: sequence }, error: null };
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner',
    documentId,
    supabase,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
    eraseEffectConsumer: async (effect, context) => {
      effects.push({ effect, context });
    },
  });
  try {
    const shape = {
      type: 'rect',
      id: 'effect-shape',
      left: 10,
      top: 10,
      width: 40,
      height: 40,
      fill: '#dc2626',
      data: { id: 'effect-shape', tool: 'rectangle', authorId: 'owner' },
    };
    handle.applyByPage({ 1: { objects: [shape] } });
    await handle.drain();
    assert.ok(rows.length >= 1, 'ordinary annotation WAL accepted first');

    const before = handle.getByPage();
    const intent = prepareAtomicErase(before, {
      mutationId: 'effect-after-ordinary',
      points: [{ x: 30, y: 30 }],
      radius: 12,
      includeDeleteHistory: true,
      userId: 'owner',
    });
    const result = await handle.commitEraseIntent(intent, {
      permissionContext: {
        mode: 'registered',
        viewerId: 'owner',
        documentOwnerId: 'owner',
      },
      validateTarget: () => true,
    });
    assert.equal(result.status, 'committed');
    await handle.drain();
    await handle.drainEraseOutbox();

    assert.equal(effects.length, 1);
    assert.equal(effects[0].effect.type, 'annotation-delete-history');
    assert.equal(effects[0].context.mutationId, 'effect-after-ordinary');
    assert.equal(doc.getMap('eraseOutbox').get('effect-after-ordinary').status, 'acknowledged');
  } finally {
    await handle.destroy();
  }
});

test('delayed 42501 rolls back erase core and never executes its unaccepted effect', async () => {
  const documentId = 'erase-effect-denied-before-acceptance';
  const rows = [];
  let sequence = 0;
  let appendAttempt = 0;
  let rejectEraseAppend;
  const effects = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          sequence += 1;
          rows.push({
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: 'owner',
            data: args.p_data,
            seq: sequence,
          });
          return { data: { seq: sequence }, error: null };
        }
        return new Promise((resolve) => {
          rejectEraseAppend = () => resolve({
            data: null,
            error: { code: '42501', message: 'permission revoked' },
          });
        });
      }
      if (name === 'store_annotation_snapshot') {
        return { data: null, error: { code: '42501', message: 'permission revoked' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner',
    documentId,
    supabase,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
    eraseEffectConsumer: async (effect) => effects.push(effect),
  });
  const historyQuarantineEvents = [];
  const unsubscribeHistoryQuarantine = handle.onHistoryQuarantine(
    (event) => historyQuarantineEvents.push(event),
  );
  try {
    const shape = {
      type: 'rect',
      id: 'denied-effect-shape',
      left: 10,
      top: 10,
      width: 40,
      height: 40,
      fill: '#dc2626',
      data: { id: 'denied-effect-shape', tool: 'rectangle', authorId: 'owner' },
    };
    handle.applyByPage({ 1: { objects: [shape] } });
    await handle.drain();

    const intent = prepareAtomicErase(handle.getByPage(), {
      mutationId: 'denied-effect-erase',
      points: [{ x: 30, y: 30 }],
      radius: 12,
      includeDeleteHistory: true,
      userId: 'owner',
    });
    const result = await handle.commitEraseIntent(intent, {
      permissionContext: {
        mode: 'registered',
        viewerId: 'owner',
        documentOwnerId: 'owner',
      },
      validateTarget: () => true,
    });
    assert.equal(result.status, 'committed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(effects.length, 0, 'optimistic outbox entry cannot execute');
    await handle.drainEraseOutbox({ validateEntry: () => true });
    assert.equal(
      effects.length,
      0,
      'manual drain options cannot override acceptedDoc authorization',
    );
    assert.equal(typeof rejectEraseAppend, 'function');

    rejectEraseAppend();
    await handle.drain();
    assert.equal(effects.length, 0);
    assert.equal(handle.getByPage()[1].objects[0].data.id, 'denied-effect-shape');
    assert.equal(doc.getMap('eraseOutbox').has('denied-effect-erase'), false);
    assert.equal(historyQuarantineEvents.length, 1);
    assert.equal(historyQuarantineEvents[0].reason, 'permission-denied');
    assert.equal(historyQuarantineEvents[0].code, '42501');
    assert.deepEqual(
      historyQuarantineEvents[0].mutationIds,
      ['denied-effect-erase'],
    );
    assert.equal(historyQuarantineEvents[0].requiresFullHistoryReset, false);
  } finally {
    unsubscribeHistoryQuarantine();
    await handle.destroy().catch(() => {});
  }
});

test('snapshot-covered erase acceptance wakes effects without an unrelated trigger', async () => {
  const documentId = 'erase-effect-snapshot-acceptance';
  const rows = [];
  let appendAttempt = 0;
  let snapshotAttempts = 0;
  const effects = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          rows.push({
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: 'owner',
            data: args.p_data,
            seq: 1,
          });
          return { data: { seq: 1 }, error: null };
        }
        if (appendAttempt === 2) {
          return { data: null, error: { code: 'XX000', message: 'temporary WAL outage' } };
        }
        const seq = rows.length + 1;
        rows.push({
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'owner',
          data: args.p_data,
          seq,
        });
        return { data: { seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotAttempts += 1;
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner',
    documentId,
    supabase,
    clientId: 'writer',
    writerId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
    eraseOutboxRetryBaseMs: 10_000,
    eraseOutboxRetryMaxMs: 10_000,
    eraseEffectConsumer: async (effect) => effects.push(effect),
  });
  try {
    const shape = {
      type: 'rect',
      id: 'snapshot-effect-shape',
      left: 10,
      top: 10,
      width: 40,
      height: 40,
      fill: '#dc2626',
      data: { id: 'snapshot-effect-shape', tool: 'rectangle', authorId: 'owner' },
    };
    handle.applyByPage({ 1: { objects: [shape] } });
    await handle.drain();

    const intent = prepareAtomicErase(handle.getByPage(), {
      mutationId: 'snapshot-effect-erase',
      points: [{ x: 30, y: 30 }],
      radius: 12,
      includeDeleteHistory: true,
      userId: 'owner',
    });
    const result = await handle.commitEraseIntent(intent, {
      permissionContext: {
        mode: 'registered',
        viewerId: 'owner',
        documentOwnerId: 'owner',
      },
      validateTarget: () => true,
    });
    assert.equal(result.status, 'committed');
    await handle.drain();
    for (let attempt = 0; attempt < 30 && effects.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    assert.equal(snapshotAttempts, 1);
    assert.equal(effects.length, 1, 'accepted snapshot wakes the effect worker immediately');
    assert.equal(effects[0].type, 'annotation-delete-history');
    assert.equal(
      doc.getMap('eraseOutbox').get('snapshot-effect-erase').status,
      'acknowledged',
    );
  } finally {
    await handle.destroy().catch(() => {});
  }
});

test('sequential erases keep one bounded writer lane and constant replay work', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [nativeInk('bounded')] } });

  for (let index = 0; index < 20; index += 1) {
    commitErase(doc, {
      id: `bounded-${index}`,
      points: [{ x: 3 + index * 4.5, y: 42 }],
      radius: 2,
      writerId: 'one-writer',
    });
  }

  const replayStats = {};
  docToByPage(doc, { replayStats });
  assert.equal(getEraserOpsMap(doc).size, 1, 'gesture count does not grow the durable lane map');
  assert.deepEqual(replayStats, {
    laneEntries: 1,
    annotationsWithLanes: 1,
    polygonIntersections: 0,
  });
});

test('undo retires only its own eraser lane and preserves the concurrent writer bite', async () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [nativeInk('shared')] } });
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const updatesA = [];
  const updatesB = [];
  clientA.on('update', (update) => updatesA.push(update));
  clientB.on('update', (update) => updatesB.push(update));
  const erasedA = await commitAtomicEraseOnDoc(clientA, {
    id: 'bite-a',
    points: [{ x: 35, y: 38 }],
    writerId: 'writer-a',
  });
  const erasedB = await commitAtomicEraseOnDoc(clientB, {
    id: 'bite-b',
    points: [{ x: 70, y: 62 }],
    writerId: 'writer-b',
  });
  assert.equal(erasedA.status, 'committed');
  assert.equal(erasedB.status, 'committed');
  exchangeUpdates(clientA, clientB, Y.mergeUpdates(updatesA), Y.mergeUpdates(updatesB));

  const handleA = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-writer-owned-undo',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: clientA,
  });
  handleA.getByPage();
  assert.equal(
    handleA.applyEraseHistoryTransition(erasedA.historyTransition, 'undo').status,
    'applied',
  );

  const survivor = handleA.getByPage()[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true, 'A bite is undone');
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false, 'B bite remains');
  assert.deepEqual(
    [...getEraserOpsMap(clientA).values()].map((lane) => lane.writerId),
    ['writer-b'],
  );
  assert.equal(
    pointInPolygonSet({ x: 70, y: 59 }, docToByPage(cloneDoc(clientA))[1].objects[0].polygons),
    false,
    'B survives cold reload after A undo',
  );
  await handleA.destroy();
});

test('sequential cross-writer Undo restores A while preserving B after cold reload', async () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [nativeInk('sequential-shared')] } });
  const doc = cloneDoc(seed);
  const erasedA = await commitAtomicEraseOnDoc(doc, {
    id: 'sequential-bite-a',
    points: [{ x: 35, y: 38 }],
    writerId: 'writer-a',
  });
  const erasedB = await commitAtomicEraseOnDoc(doc, {
    id: 'sequential-bite-b',
    points: [{ x: 70, y: 62 }],
    writerId: 'writer-b',
  });
  assert.equal(erasedA.status, 'committed');
  assert.equal(erasedB.status, 'committed');
  const handleA = await openAnnotationDoc({
    actorUserId: 'test-actor',
    documentId: 'doc-sequential-writer-undo',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  handleA.getByPage();
  assert.equal(
    handleA.applyEraseHistoryTransition(erasedA.historyTransition, 'undo').status,
    'applied',
  );

  let survivor = handleA.getByPage()[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true, 'A bite is undone');
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false, 'B bite remains');
  assert.deepEqual(
    [...getEraserOpsMap(doc).values()].map((lane) => lane.writerId),
    ['writer-b'],
  );
  survivor = docToByPage(cloneDoc(doc))[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false);
  await handleA.destroy();
});

test('duplicate-id and id-less objects survive two-client merge and cold reload', () => {
  const duplicateA = { type: 'rect', left: 10, top: 10, width: 5, height: 5, data: { id: 'dup' } };
  const duplicateB = { type: 'rect', left: 30, top: 10, width: 5, height: 5, data: { id: 'dup' } };
  const idless = { type: 'ellipse', left: 50, top: 10, rx: 4, ry: 3 };
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [duplicateA, duplicateB, idless] } });
  assert.equal(getAnnotationsMap(seed).size, 3);

  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const updatesA = [];
  const updatesB = [];
  clientA.on('update', (update) => updatesA.push(update));
  clientB.on('update', (update) => updatesB.push(update));
  syncByPageToDoc(clientA, {
    1: { objects: [...docToByPage(clientA)[1].objects, nativeInk('only-a')] },
  });
  syncByPageToDoc(clientB, {
    1: { objects: [...docToByPage(clientB)[1].objects, nativeInk('only-b')] },
  });
  exchangeUpdates(clientA, clientB, Y.mergeUpdates(updatesA), Y.mergeUpdates(updatesB));

  for (const doc of [clientA, clientB, cloneDoc(clientA)]) {
    const objects = docToByPage(doc)[1].objects;
    assert.equal(objects.filter((object) => object?.data?.id === 'dup').length, 1);
    assert.equal(
      objects.filter((object) => object?.data?.legacyDuplicateId === 'dup').length,
      1,
    );
    assert.equal(objects.some((object) => object.type === 'ellipse' && object.data?.id), true);
    assert.equal(new Set(objects.map((object) => object.data.id)).size, 5);
    assert.equal([...getAnnotationsMap(doc).keys()].some((key) => key.startsWith('\u0000')), false);
    assert.equal(objects.length, 5);
  }
});

test('one erase keeps duplicate-id survivor lanes bound to their durable occurrences', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, {
    1: { objects: [shortInk('dup', 0, 10), shortInk('dup', 20, 30)] },
  });
  commitErase(doc, {
    id: 'trim-both-duplicates',
    points: [{ x: 15, y: 50 }],
    radius: 6,
    writerId: 'duplicate-writer',
  });

  const survivors = docToByPage(doc)[1].objects;
  assert.equal(survivors.length, 2);
  const xBounds = survivors.map((object) => {
    const xs = object.polygons.flat(2).map(([x]) => x);
    return [Math.min(...xs), Math.max(...xs)];
  });
  assert.ok(xBounds[0][1] < 15, 'first durable occurrence remains the left survivor');
  assert.ok(xBounds[1][0] > 15, 'second durable occurrence remains the right survivor');
  assert.notDeepEqual(survivors[0].polygons, survivors[1].polygons);
});

test('two clients compose opposite bites on one id-less durable occurrence', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [shortInk('unused', 0, 30, { idless: true })] } });
  const left = cloneDoc(seed);
  const right = cloneDoc(seed);
  const leftUpdates = [];
  const rightUpdates = [];
  left.on('update', (update) => leftUpdates.push(update));
  right.on('update', (update) => rightUpdates.push(update));

  commitErase(left, {
    id: 'idless-left',
    points: [{ x: 0, y: 50 }],
    radius: 3,
    writerId: 'left-writer',
  });
  commitErase(right, {
    id: 'idless-right',
    points: [{ x: 30, y: 50 }],
    radius: 3,
    writerId: 'right-writer',
  });
  exchangeUpdates(left, right, Y.mergeUpdates(leftUpdates), Y.mergeUpdates(rightUpdates));

  for (const doc of [left, right, cloneDoc(left)]) {
    const objects = docToByPage(doc)[1].objects;
    assert.equal(objects.length, 1, 'both lanes bind to one id-less base occurrence');
    const survivor = objects[0];
    assert.equal(pointInPolygonSet({ x: 0, y: 50 }, survivor.polygons), false);
    assert.equal(pointInPolygonSet({ x: 30, y: 50 }, survivor.polygons), false);
    assert.equal(pointInPolygonSet({ x: 15, y: 50 }, survivor.polygons), true);
  }
});

test('id-less erase identity survives JSON clone and z-order reversal', () => {
  const doc = new Y.Doc();
  const first = shortInk('unused-a', 0, 30, { idless: true });
  const second = shortInk('unused-b', 50, 80, { idless: true });
  syncByPageToDoc(doc, { 1: { objects: [first, second] } });
  const baseline = docToByPage(doc);
  const [firstId, secondId] = baseline[1].objects.map((object) => object.data.id);
  assert.ok(firstId);
  assert.ok(secondId);
  assert.notEqual(firstId, secondId);

  commitErase(doc, {
    id: 'idless-clone-reorder',
    points: [{ x: 4, y: 50 }],
    radius: 3,
    writerId: 'writer',
  });
  const erased = docToByPage(doc);
  const erasedFirst = erased[1].objects.find((object) => object.data.id === firstId);
  const untouchedSecond = erased[1].objects.find((object) => object.data.id === secondId);
  assert.ok(erasedFirst);
  assert.ok(untouchedSecond);

  const clonedReordered = JSON.parse(JSON.stringify(erased));
  clonedReordered[1].objects.reverse();
  syncByPageToDoc(doc, clonedReordered);
  const after = docToByPage(doc);

  assert.equal(after[1].objects.length, 2);
  assert.deepEqual(
    after[1].objects.find((object) => object.data.id === firstId),
    erasedFirst,
    'erased survivor stays bound to its promoted stable id',
  );
  assert.deepEqual(
    after[1].objects.find((object) => object.data.id === secondId),
    untouchedSecond,
    'untouched stroke survives clone and reorder',
  );
});

test('legacy duplicate identity survives the real JSON clone and reverse boundary', () => {
  const doc = new Y.Doc();
  const legacyKey = '\u0000duplicate:dup:1:1';
  seedMark(doc, 'dup', {
    p: 1,
    o: shortInk('dup', 0, 20),
  });
  seedMark(doc, legacyKey, {
    p: 1,
    o: shortInk('dup', 30, 50),
  });

  const materialized = docToByPage(doc);
  const left = materialized[1].objects.find((object) => object.path?.[0]?.[1] === 0);
  const right = materialized[1].objects.find((object) => object.path?.[0]?.[1] === 30);
  assert.equal(left.data.id, 'dup');
  assert.notEqual(right.data.id, 'dup');
  assert.equal(right.data.id.startsWith('\u0000'), false);

  const clonedReordered = JSON.parse(JSON.stringify(materialized));
  clonedReordered[1].objects.reverse();
  syncByPageToDoc(doc, clonedReordered);

  const cold = cloneDoc(doc);
  const byId = new Map(
    docToByPage(cold)[1].objects.map((object) => [object.data.id, object]),
  );
  assert.equal(byId.get('dup').path[0][1], 0, 'canonical duplicate keeps its geometry');
  assert.equal(
    byId.get(right.data.id).path[0][1],
    30,
    'legacy occurrence keeps its promoted identity across clone/reorder/reload',
  );
  assert.equal([...getAnnotationsMap(cold).keys()].some((key) => key.startsWith('\u0000')), false);
});

test('authoritative WAL identity settles only the exact actor outbox receipt', async () => {
  const documentId = 'doc-exact-cloud-receipt';
  const actorUserId = 'actor-a';
  const writerId = 'writer-a';
  const updateDoc = new Y.Doc();
  setMetaValue(updateDoc, 'accepted', 'cloud-receipt', 'local');
  const update = Y.encodeStateAsUpdate(updateDoc);
  const outbox = createMemoryAnnotationOutbox();
  await outbox.put({
    key: [documentId, actorUserId, writerId, 1].join('\u0000'),
    documentId,
    actorUserId,
    writerId,
    clientSeq: 1,
    ordinal: 1,
    editEpoch: 1,
    status: 'ambiguous',
    update,
  });
  const rows = [{
    document_id: documentId,
    seq: 1,
    client_id: writerId,
    client_seq: 1,
    actor_user_id: actorUserId,
    data: bytesToPgHex(update),
  }];
  const supabase = {
    async rpc(name) {
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId,
    documentId,
    supabase,
    writerId: 'new-open-writer',
    clientId: 'install',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc,
  });

  assert.equal(getMetaValue(doc, 'accepted'), 'cloud-receipt');
  assert.equal((await outbox.list(documentId, actorUserId)).length, 0);
  const cleanState = await outbox.loadCleanState(documentId, actorUserId);
  assert.ok(cleanState.checkpointUpdate, 'exact receipt is durably compacted into clean state');
  const cleanDoc = new Y.Doc();
  Y.applyUpdate(cleanDoc, cleanState.checkpointUpdate);
  assert.equal(getMetaValue(cleanDoc, 'accepted'), 'cloud-receipt');
  assert.deepEqual(handle.getSyncStatus(), {
    healthy: true,
    error: null,
    stage: 'idle',
    queueSize: 0,
  });
  await handle.destroy();
});

test('authoritative receipt recovers health after accepted-journal settlement fails', async () => {
  const documentId = 'doc-authoritative-receipt-health';
  const actorUserId = 'actor-a';
  const writerId = 'writer-a';
  const rows = [];
  const durableOutbox = createMemoryAnnotationOutbox();
  let settleAttempts = 0;
  const outbox = {
    ...durableOutbox,
    async settleAccepted(record) {
      settleAttempts += 1;
      if (settleAttempts === 1) throw new Error('injected accepted-journal failure');
      return durableOutbox.settleAccepted(record);
    },
  };
  let insertHandler = null;
  let appendAttempts = 0;
  let snapshotAvailable = false;
  const channel = {
    on(_type, _filter, callback) {
      insertHandler = callback;
      return channel;
    },
    subscribe() { return channel; },
  };
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        const row = {
          document_id: documentId,
          seq: 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: actorUserId,
          data: args.p_data,
        };
        rows.push(row);
        return { data: { seq: 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return snapshotAvailable
          ? ({ data: true, error: null })
          : ({ data: null, error: { code: 'XX000', message: 'snapshot unavailable' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel() { return channel; },
    async removeChannel() {},
  };
  const handle = await openAnnotationDoc({
    actorUserId,
    documentId,
    supabase,
    writerId,
    clientId: 'install-a',
    enableLocal: false,
    enableRealtime: true,
    outboxStore: outbox,
    doc: new Y.Doc(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
  });

  handle.setMeta('accepted', 'exact-receipt');
  await handle.drain();
  assert.equal(handle.isSyncHealthy(), false);
  assert.equal(handle.getSyncStatus().queueSize, 1);

  insertHandler({ new: rows[0] });
  for (let attempt = 0; attempt < 20 && handle.getSyncStatus().queueSize > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(appendAttempts, 1, 'receipt settles without another append');
  assert.equal(settleAttempts, 2);
  assert.equal((await durableOutbox.list(documentId, actorUserId)).length, 0);
  assert.deepEqual(handle.getSyncStatus(), {
    healthy: true,
    error: null,
    stage: 'hydrating',
    queueSize: 0,
  }, 'realtime was never confirmed SUBSCRIBED, so status cannot be Up to date');
  snapshotAvailable = true;
  await handle.destroy();
});

test('permission rollback deletes raw pending bytes when quarantine persistence fails', async () => {
  const documentId = 'doc-quarantine-write-fails';
  const actorUserId = 'actor-a';
  const durableOutbox = createMemoryAnnotationOutbox();
  let deleteManyCalls = 0;
  const outbox = {
    ...durableOutbox,
    async markRejected() {
      throw new Error('injected quarantine transaction failure');
    },
    async deleteMany(keys) {
      deleteManyCalls += 1;
      return durableOutbox.deleteMany(keys);
    },
  };
  let allowWrites = false;
  let appendAttempts = 0;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        return allowWrites
          ? ({ data: { seq: 1 }, error: null })
          : ({ data: null, error: { code: '42501', message: 'permission denied' } });
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}: ${JSON.stringify(args)}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let first = null;
  let reopened = null;
  try {
    const firstDoc = new Y.Doc();
    first = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'install-a',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: firstDoc,
    });
    first.setMeta('forbidden', 'must-not-replay');
    await first.drain();

    assert.equal(getMetaValue(firstDoc, 'forbidden'), undefined);
    assert.equal(deleteManyCalls, 1, 'raw pending deletion is attempted independently');
    assert.equal((await durableOutbox.list(documentId, actorUserId)).length, 0);
    assert.equal(first.isSyncHealthy(), false);

    await first.destroy();
    first = null;
    allowWrites = true;
    reopened = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'install-a',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
    });
    assert.equal(reopened.getMeta('forbidden'), undefined);
    assert.equal(appendAttempts, 1, 'permission restoration cannot replay deleted bytes');
  } finally {
    await first?.destroy().catch(() => {});
    await reopened?.destroy().catch(() => {});
  }
});

test('unresolved causal predecessors block later WAL submission', async () => {
  const documentId = 'doc-causal-ambiguous-predecessor';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  let appendAttempts = 0;
  let snapshotAvailable = false;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        return new Promise(() => {});
      }
      if (name === 'store_annotation_snapshot') {
        return snapshotAvailable
          ? ({ data: true, error: null })
          : ({ data: null, error: { code: 'XX000', message: 'snapshot unavailable' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'install-a',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
      requestTimeoutMs: 10,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
    });
    handle.setMeta('A', 'ambiguous');
    handle.setMeta('B', 'dependent');
    await handle.drain();

    const pending = await outbox.list(documentId, actorUserId);
    assert.equal(appendAttempts, 1, 'B cannot overtake unresolved A');
    assert.deepEqual(pending.map((record) => record.status), ['ambiguous', 'pending']);
    assert.equal((await outbox.loadCleanState(documentId, actorUserId)).records.length, 0);
    assert.deepEqual(handle.getSyncStatus(), {
      healthy: false,
      error: handle.getSyncStatus().error,
      stage: 'error',
      queueSize: 2,
    });
  } finally {
    snapshotAvailable = true;
    await handle?.destroy().catch(() => {});
  }
});

test('authoritative predecessor receipt pumps one newly unblocked dependent', async () => {
  const documentId = 'doc-causal-receipt-pump';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const rows = [];
  let insertHandler = null;
  let appendAttempts = 0;
  let snapshotAvailable = false;
  const channel = {
    on(_type, _filter, callback) {
      insertHandler = callback;
      return channel;
    },
    subscribe() { return channel; },
  };
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        const row = {
          document_id: documentId,
          seq: appendAttempts,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: actorUserId,
          data: args.p_data,
        };
        rows.push(row);
        if (appendAttempts === 1) return new Promise(() => {});
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return snapshotAvailable
          ? ({ data: true, error: null })
          : ({ data: null, error: { code: 'XX000', message: 'snapshot unavailable' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel() { return channel; },
    async removeChannel() {},
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'install-a',
      enableLocal: false,
      enableRealtime: true,
      outboxStore: outbox,
      doc: new Y.Doc(),
      requestTimeoutMs: 10,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
    });
    handle.setMeta('A', 'committed-but-timeout');
    handle.setMeta('B', 'held-dependent');
    await handle.drain();
    assert.equal(appendAttempts, 1);
    assert.equal(handle.getSyncStatus().queueSize, 2);

    insertHandler({ new: rows[0] });
    for (let attempt = 0; attempt < 40 && handle.getSyncStatus().queueSize > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(appendAttempts, 2, 'one receipt pump submits B exactly once');
    assert.equal(rows.length, 2);
    assert.equal((await outbox.list(documentId, actorUserId)).length, 0);
    assert.deepEqual(handle.getSyncStatus(), {
      healthy: true,
      error: null,
      stage: 'hydrating',
      queueSize: 0,
    }, 'realtime was never confirmed SUBSCRIBED, so status cannot be Up to date');
  } finally {
    snapshotAvailable = true;
    await handle?.destroy().catch(() => {});
  }
});

test('idempotency collision blocks its causal dependents before WAL submission', async () => {
  const documentId = 'doc-causal-integrity-predecessor';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  let appendAttempts = 0;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        return { data: null, error: { code: '23505', message: 'different bytes' } };
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'install-a',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
    });
    handle.setMeta('A', 'collision');
    handle.setMeta('B', 'dependent');
    await handle.drain();

    const pending = await outbox.list(documentId, actorUserId);
    assert.equal(appendAttempts, 1, 'B never reaches the backend');
    assert.deepEqual(pending.map((record) => record.status), ['integrity-error', 'dependency-error']);
    assert.equal((await outbox.loadCleanState(documentId, actorUserId)).records.length, 0);
    assert.equal(handle.isSyncHealthy(), false);
    assert.equal(handle.getSyncStatus().queueSize, 2);
  } finally {
    await handle?.destroy().catch(() => {});
  }
});

test('ambiguous status persistence failure still leaves sync red and pending', async () => {
  const documentId = 'doc-ambiguous-status-put-fails';
  const actorUserId = 'actor-a';
  const durableOutbox = createMemoryAnnotationOutbox();
  let putCalls = 0;
  const outbox = {
    ...durableOutbox,
    async put(record) {
      putCalls += 1;
      if (putCalls > 1) throw new Error('IDB_WRITE_FAILED');
      return durableOutbox.put(record);
    },
  };
  let snapshotAvailable = false;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') return new Promise(() => {});
      if (name === 'store_annotation_snapshot') {
        return snapshotAvailable
          ? ({ data: true, error: null })
          : ({ data: null, error: { code: 'XX000', message: 'snapshot unavailable' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'install-a',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
      requestTimeoutMs: 10,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
    });
    handle.setMeta('A', 'ambiguous');
    await handle.drain();

    assert.equal(handle.isSyncHealthy(), false);
    assert.equal(handle.getSyncStatus().stage, 'error');
    assert.equal(handle.getSyncStatus().queueSize, 1);
    assert.equal((await durableOutbox.list(documentId, actorUserId)).length, 1);
  } finally {
    snapshotAvailable = true;
    await handle?.destroy().catch(() => {});
  }
});

test('cold replay quarantines a durable dependent whose predecessor has no accepted receipt', async () => {
  const documentId = 'doc-orphan-dependent';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const lineage = new Y.Doc();
  let updateA = null;
  let updateB = null;
  lineage.on('update', (update) => {
    if (!updateA) updateA = update;
    else updateB = update;
  });
  setMetaValue(lineage, 'A', 'missing', 'local');
  setMetaValue(lineage, 'B', 'orphan', 'local');
  const missingKey = [documentId, actorUserId, 'writer-a', 1].join('\u0000');
  await outbox.put({
    key: [documentId, actorUserId, 'writer-a', 2].join('\u0000'),
    documentId,
    actorUserId,
    writerId: 'writer-a',
    clientSeq: 2,
    ordinal: 2,
    editEpoch: 2,
    status: 'pending',
    dependsOn: [missingKey],
    update: updateB,
  });
  let appendAttempts = 0;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        return { data: { seq: 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handle = await openAnnotationDoc({
    actorUserId,
    documentId,
    supabase,
    clientId: 'cold',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc: new Y.Doc(),
  });
  try {
    assert.equal(appendAttempts, 0);
    assert.equal(handle.getMeta('B'), undefined);
    assert.equal(handle.isSyncHealthy(), false);
    assert.equal(handle.getSyncStatus().queueSize, 1);
    assert.equal((await outbox.list(documentId, actorUserId))[0].status, 'dependency-error');
  } finally {
    await handle.destroy().catch(() => {});
  }
});

test('cold reopen terminal outbox records quarantine persisted and legacy local state', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  try {
    for (const status of ['integrity-error', 'dependency-error', 'rejected']) {
      const documentId = `doc-terminal-cold-quarantine-${status}`;
      const actorUserId = 'actor-a';
      const outbox = createMemoryAnnotationOutbox();
      const terminalDoc = new Y.Doc();
      setMetaValue(terminalDoc, 'terminal', status, 'terminal-record');
      await outbox.put({
        key: [documentId, actorUserId, 'old-writer', 1].join('\u0000'),
        documentId,
        actorUserId,
        writerId: 'old-writer',
        clientSeq: 1,
        ordinal: 1,
        editEpoch: 1,
        status,
        dependsOn: [],
        update: Y.encodeStateAsUpdate(terminalDoc),
      });

      const persisted = new Y.Doc();
      setMetaValue(persisted, 'persisted-only', status, 'indexeddb-preload');
      const legacy = new Y.Doc();
      seedMark(legacy, `legacy-${status}`, {
        p: 1,
        o: {
          type: 'rect',
          left: 71,
          data: { id: `legacy-${status}`, authorId: actorUserId },
        },
      });
      let appendAttempts = 0;
      let legacyCleared = false;
      const supabase = {
        async rpc(name) {
          if (name === 'append_annotation_update') {
            appendAttempts += 1;
            return { data: { seq: appendAttempts }, error: null };
          }
          if (name === 'store_annotation_snapshot') {
            return { data: { accepted: true }, error: null };
          }
          throw new Error(`unexpected RPC ${name}`);
        },
        from(table) {
          if (table === 'annotation_updates') return makeWalReadBuilder([]);
          if (table === 'annotation_snapshots') {
            return { select: () => makeEmptyBuilder({ data: null, error: null }) };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };

      const handle = await openAnnotationDoc({
        actorUserId,
        documentId,
        supabase,
        clientId: `cold-${status}`,
        writerId: `cold-${status}`,
        enableLocal: true,
        enableRealtime: false,
        outboxStore: outbox,
        doc: new Y.Doc(),
        localPersistenceFactory: async (_name, target) => {
          Y.applyUpdate(target, Y.encodeStateAsUpdate(persisted));
          return { synced: true, destroy() {} };
        },
        legacyPersistenceFactory: async (_name, target) => {
          Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
          return {
            synced: true,
            destroy() {},
            async clearDocument() { legacyCleared = true; },
          };
        },
      });
      const historyQuarantineEvents = [];
      const unsubscribeHistoryQuarantine = handle.onHistoryQuarantine(
        (event) => historyQuarantineEvents.push(event),
      );
      try {
        await handle.drain();
        assert.equal(
          appendAttempts,
          0,
          `${status} terminal state must prevent fresh WAL reauthoring`,
        );
        assert.equal(
          handle.getMeta('persisted-only'),
          undefined,
          `${status} terminal state keeps persisted-only bytes hidden`,
        );
        assert.deepEqual(
          handle.getByPage(),
          {},
          `${status} terminal state keeps legacy bytes hidden`,
        );
        assert.deepEqual(handle.getLegacyRecoveryStatus(), {
          pending: true,
          unresolvedEntries: 1,
        });
        assert.equal(legacyCleared, false, 'quarantined legacy storage remains recoverable');
        assert.equal(handle.isSyncHealthy(), false);
        assert.deepEqual(
          (await outbox.list(documentId, actorUserId)).map((record) => record.status),
          [status],
          'the original terminal evidence remains durable',
        );
        assert.equal(historyQuarantineEvents.length, 1);
        assert.equal(
          historyQuarantineEvents[0].code,
          status === 'rejected' ? '42501' : '23505',
        );
        assert.equal(historyQuarantineEvents[0].requiresFullHistoryReset, true);
        assert.deepEqual(historyQuarantineEvents[0].mutationIds, []);
        assert.ok(historyQuarantineEvents[0].dedupeKey);
      } finally {
        unsubscribeHistoryQuarantine();
        await handle.destroy().catch(() => {});
        terminalDoc.destroy();
        persisted.destroy();
        legacy.destroy();
      }
    }
  } finally {
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('cold reopen reuses exact persisted coverage for an ordinary pending outbox update', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const documentId = 'doc-pending-persisted-cold-dedupe';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const pendingDoc = new Y.Doc();
  setMetaValue(pendingDoc, 'K', 'pending-offline', 'pending-record');
  const update = Y.encodeStateAsUpdate(pendingDoc);
  await outbox.put({
    key: [documentId, actorUserId, 'old-writer', 1].join('\u0000'),
    documentId,
    actorUserId,
    writerId: 'old-writer',
    clientSeq: 1,
    ordinal: 1,
    editEpoch: 1,
    status: 'pending',
    dependsOn: [],
    update,
  });
  const supabase = makeLegacyRecoveryBackend(documentId, [], { offline: true });
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'cold',
      writerId: 'cold',
      enableLocal: true,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
      localPersistenceFactory: async (_name, target) => {
        Y.applyUpdate(target, update);
        return { synced: true, destroy() {} };
      },
      legacyPersistenceFactory: async () => ({
        synced: true,
        destroy() {},
        async clearDocument() {},
      }),
    });
    await handle.drain();
    assert.equal(handle.getMeta('K'), 'pending-offline');
    assert.equal(
      (await outbox.list(documentId, actorUserId)).length,
      1,
      'the same exact persisted update is already covered by its pending record',
    );
  } finally {
    await handle?.destroy().catch(() => {});
    pendingDoc.destroy();
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('cold reopen keeps an ordinary pending outbox update visible with empty local persistence', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const documentId = 'doc-pending-empty-persistence-visible';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const pendingDoc = new Y.Doc();
  setMetaValue(pendingDoc, 'K', 'pending-offline', 'pending-record');
  await outbox.put({
    key: [documentId, actorUserId, 'old-writer', 1].join('\u0000'),
    documentId,
    actorUserId,
    writerId: 'old-writer',
    clientSeq: 1,
    ordinal: 1,
    editEpoch: 1,
    status: 'pending',
    dependsOn: [],
    update: Y.encodeStateAsUpdate(pendingDoc),
  });
  const supabase = makeLegacyRecoveryBackend(documentId, [], { offline: true });
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'cold',
      writerId: 'cold',
      enableLocal: true,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
      localPersistenceFactory: async () => ({ synced: true, destroy() {} }),
      legacyPersistenceFactory: async () => ({
        synced: true,
        destroy() {},
        async clearDocument() {},
      }),
    });
    await handle.drain();
    assert.equal(
      handle.getMeta('K'),
      'pending-offline',
      'accepted-state cleanup preserves trusted ordinary pending projection',
    );
    assert.equal((await outbox.list(documentId, actorUserId)).length, 1);
  } finally {
    await handle?.destroy().catch(() => {});
    pendingDoc.destroy();
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('actor-scoped persisted offline deletion reaches authorized WAL and cold replay', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const documentId = 'doc-persisted-offline-delete';
  const actorUserId = 'actor-a';
  const cloud = new Y.Doc();
  seedMark(cloud, 'offline-delete', {
    p: 1,
    o: {
      type: 'rect',
      left: 29,
      data: { id: 'offline-delete', authorId: actorUserId },
    },
  });
  const rows = [{
    document_id: documentId,
    seq: 1,
    client_id: 'seed',
    client_seq: 1,
    actor_user_id: actorUserId,
    data: bytesToPgHex(Y.encodeStateAsUpdate(cloud)),
  }];
  const persisted = cloneDoc(cloud);
  getAnnotationsMap(persisted).delete('offline-delete');
  const supabase = makeLegacyRecoveryBackend(documentId, rows);
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'cold',
      writerId: 'cold',
      enableLocal: true,
      enableRealtime: false,
      doc: new Y.Doc(),
      localPersistenceFactory: async (_name, target) => {
        Y.applyUpdate(target, Y.encodeStateAsUpdate(persisted));
        return { synced: true, destroy() {} };
      },
      legacyPersistenceFactory: async () => ({
        synced: true,
        destroy() {},
        async clearDocument() {},
      }),
    });
    await handle.drain();
    assert.deepEqual(handle.getByPage(), {}, 'authorized offline tombstone removes the object');
    assert.equal(rows.length, 2, 'DeleteSet-only recovery receives an exact WAL row');

    const cloudReplay = new Y.Doc();
    for (const row of rows) Y.applyUpdate(cloudReplay, pgHexToBytes(row.data));
    assert.deepEqual(
      docToByPage(cloudReplay),
      {},
      'cloud-only replay reconstructs the persisted offline deletion',
    );
    cloudReplay.destroy();
  } finally {
    await handle?.destroy().catch(() => {});
    cloud.destroy();
    persisted.destroy();
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('actor-scoped persisted offline update reaches authorized WAL and cold replay', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const documentId = 'doc-persisted-offline-update';
  const actorUserId = 'actor-a';
  const cloud = new Y.Doc();
  seedMark(cloud, 'offline-update', {
    p: 1,
    o: {
      type: 'rect',
      left: 1,
      data: { id: 'offline-update', authorId: actorUserId },
    },
  });
  const rows = [{
    document_id: documentId,
    seq: 1,
    client_id: 'seed',
    client_seq: 1,
    actor_user_id: actorUserId,
    data: bytesToPgHex(Y.encodeStateAsUpdate(cloud)),
  }];
  const persisted = cloneDoc(cloud);
  seedMark(persisted, 'offline-update', {
    p: 1,
    o: {
      type: 'rect',
      left: 99,
      data: { id: 'offline-update', authorId: actorUserId },
    },
  });
  const supabase = makeLegacyRecoveryBackend(documentId, rows);
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'cold',
      writerId: 'cold',
      enableLocal: true,
      enableRealtime: false,
      doc: new Y.Doc(),
      localPersistenceFactory: async (_name, target) => {
        Y.applyUpdate(target, Y.encodeStateAsUpdate(persisted));
        return { synced: true, destroy() {} };
      },
      legacyPersistenceFactory: async () => ({
        synced: true,
        destroy() {},
        async clearDocument() {},
      }),
    });
    await handle.drain();
    assert.equal(handle.getByPage()[1].objects[0].left, 99);
    assert.equal(rows.length, 2, 'trusted actor-scoped update receives an exact WAL row');

    const cloudReplay = new Y.Doc();
    for (const row of rows) Y.applyUpdate(cloudReplay, pgHexToBytes(row.data));
    assert.equal(docToByPage(cloudReplay)[1].objects[0].left, 99);
    cloudReplay.destroy();
  } finally {
    await handle?.destroy().catch(() => {});
    cloud.destroy();
    persisted.destroy();
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('live edits mirror to actor persistence before cloud acceptance and denial rotates clean', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const documentId = 'doc-live-persistence-mirror';
  const targets = [];
  let resolveDeniedAppend;
  let markAppendEntered;
  const appendEntered = new Promise((resolve) => { markAppendEntered = resolve; });
  const deniedAppend = new Promise((resolve) => { resolveDeniedAppend = resolve; });
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        markAppendEntered();
        return deniedAppend;
      }
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId: 'actor-a',
      documentId,
      supabase,
      clientId: 'writer',
      writerId: 'writer',
      enableLocal: true,
      enableRealtime: false,
      doc: new Y.Doc(),
      localPersistenceFactory: async (_name, target) => {
        targets.push(target);
        return { synced: true, destroy() {} };
      },
      legacyPersistenceFactory: async () => ({
        synced: true,
        destroy() {},
        async clearDocument() {},
      }),
    });

    handle.setMeta('K', 'pending-denial');
    handle.applyByPage({
      1: {
        objects: [{
          type: 'rect',
          left: 44,
          data: { id: 'pending-shape', authorId: 'actor-a' },
        }],
      },
    });
    await appendEntered;
    assert.equal(
      getMetaValue(targets[0], 'K'),
      'pending-denial',
      'local persistence sees metadata before the cloud responds',
    );
    assert.equal(
      docToByPage(targets[0])[1].objects[0].left,
      44,
      'local persistence sees annotation edits before the cloud responds',
    );

    resolveDeniedAppend({
      data: null,
      error: { code: '42501', message: 'permission revoked' },
    });
    await handle.drain();
    assert.equal(targets.length, 2, 'permission denial rotates to a clean persistence generation');
    assert.equal(getMetaValue(targets[1], 'K'), undefined);
    assert.deepEqual(docToByPage(targets[1]), {});
    assert.equal(handle.getMeta('K'), undefined);
    assert.deepEqual(handle.getByPage(), {});
  } finally {
    resolveDeniedAppend?.({
      data: null,
      error: { code: '42501', message: 'permission revoked' },
    });
    await handle?.destroy().catch(() => {});
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('remote conflict mirrors original authoritative bytes and cannot upload a false tombstone on reopen', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const documentId = 'doc-remote-derived-persistence';
  const actorUserId = 'actor-a';
  const rows = [];
  const targets = [];
  let insertHandler = null;
  let appendAttempts = 0;
  const channel = {
    on(_type, _filter, callback) {
      insertHandler = callback;
      return channel;
    },
    subscribe() { return channel; },
  };
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        const row = {
          document_id: documentId,
          seq: rows.length + 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: actorUserId,
          data: args.p_data,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel() { return channel; },
    async removeChannel() {},
  };
  const active = new Y.Doc();
  active.clientID = 0xfffffffe;
  let injectPreAttachLocal = true;
  const localPersistenceFactory = async (_name, target) => {
    targets.push(target);
    return { synced: true, destroy() {} };
  };
  const legacyPersistenceFactory = async () => ({
    synced: true,
    destroy() {},
    async clearDocument() {
      if (!injectPreAttachLocal) return;
      injectPreAttachLocal = false;
      setMetaValue(active, 'K', 'optimistic-local', 'pre-attach-boundary');
    },
  });
  let first = null;
  let second = null;
  try {
    first = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'first',
      writerId: 'first',
      enableLocal: true,
      enableRealtime: true,
      doc: active,
      localPersistenceFactory,
      legacyPersistenceFactory,
    });
    assert.equal(first.getMeta('K'), 'optimistic-local');
    assert.equal(getMetaValue(targets[0], 'K'), undefined);

    const remote = new Y.Doc();
    remote.clientID = 1;
    setMetaValue(remote, 'K', 'authoritative-remote', 'remote');
    rows.push({
      document_id: documentId,
      seq: 1,
      client_id: 'remote-writer',
      client_seq: 1,
      actor_user_id: 'actor-b',
      data: bytesToPgHex(Y.encodeStateAsUpdate(remote)),
    });
    insertHandler({ new: rows[0] });
    await first.drain();
    assert.equal(first.getMeta('K'), 'optimistic-local', 'high-client optimistic value wins live conflict');
    assert.equal(
      getMetaValue(targets[0], 'K'),
      'authoritative-remote',
      'clean persistence receives original server bytes, not the derived live tombstone',
    );
    const persistedBytes = Y.encodeStateAsUpdate(targets[0]);
    remote.destroy();
    await first.destroy();
    first = null;

    second = await openAnnotationDoc({
      actorUserId,
      documentId,
      supabase,
      clientId: 'second',
      writerId: 'second',
      enableLocal: true,
      enableRealtime: false,
      doc: new Y.Doc(),
      localPersistenceFactory: async (_name, target) => {
        Y.applyUpdate(target, persistedBytes);
        targets.push(target);
        return { synced: true, destroy() {} };
      },
      legacyPersistenceFactory: async () => ({
        synced: true,
        destroy() {},
        async clearDocument() {},
      }),
    });
    await second.drain();
    assert.equal(second.getMeta('K'), 'authoritative-remote');
    assert.equal(appendAttempts, 0, 'reopen emits no false tombstone WAL');
    assert.equal(rows.length, 1);
  } finally {
    await first?.destroy().catch(() => {});
    await second?.destroy().catch(() => {});
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('actorless legacy recovery cannot override an ordinary pending same-key value', async () => {
  const documentId = 'doc-legacy-stale-vs-pending';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const pendingDoc = new Y.Doc();
  seedMark(pendingDoc, 'same-key', {
    p: 1,
    o: {
      type: 'rect',
      left: 100,
      data: { id: 'same-key', authorId: actorUserId },
    },
  });
  await outbox.put({
    key: [documentId, actorUserId, 'old-writer', 1].join('\u0000'),
    documentId,
    actorUserId,
    writerId: 'old-writer',
    clientSeq: 1,
    ordinal: 1,
    editEpoch: 1,
    status: 'pending',
    dependsOn: [],
    update: Y.encodeStateAsUpdate(pendingDoc),
  });
  const legacy = new Y.Doc();
  seedMark(legacy, 'same-key', {
    p: 1,
    o: {
      type: 'rect',
      left: 10,
      data: { id: 'same-key', authorId: actorUserId },
    },
  });
  const supabase = makeLegacyRecoveryBackend(documentId, [], { offline: true });
  const handle = await openAnnotationDoc({
    actorUserId,
    documentId,
    supabase,
    clientId: 'cold',
    writerId: 'cold',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc: new Y.Doc(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    legacyPersistenceFactory: async (_name, target) => {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
      return { synced: true, destroy() {}, async clearDocument() {} };
    },
  });
  try {
    await handle.drain();
    assert.equal(handle.getByPage()[1].objects[0].left, 100);
    assert.equal(
      (await outbox.list(documentId, actorUserId)).length,
      1,
      'stale actorless bytes remain a conflict instead of becoming fresh WAL',
    );
    assert.deepEqual(handle.getLegacyRecoveryStatus(), {
      pending: true,
      unresolvedEntries: 1,
    });
  } finally {
    await handle.destroy().catch(() => {});
    pendingDoc.destroy();
    legacy.destroy();
  }
});

test('actorless legacy recovery defers behind a pending net-zero tombstone', async () => {
  const documentId = 'doc-legacy-stale-vs-pending-tombstone';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const pendingDoc = new Y.Doc();
  seedMark(pendingDoc, 'same-key', {
    p: 1,
    o: {
      type: 'rect',
      left: 100,
      data: { id: 'same-key', authorId: actorUserId },
    },
  });
  getAnnotationsMap(pendingDoc).delete('same-key');
  const pendingUpdate = Y.encodeStateAsUpdate(pendingDoc);
  const decodedPending = Y.decodeUpdate(pendingUpdate);
  assert.ok(decodedPending.structs.length > 0);
  assert.ok(decodedPending.ds.clients.size > 0);
  await outbox.put({
    key: [documentId, actorUserId, 'old-writer', 1].join('\u0000'),
    documentId,
    actorUserId,
    writerId: 'old-writer',
    clientSeq: 1,
    ordinal: 1,
    editEpoch: 1,
    status: 'pending',
    dependsOn: [],
    update: pendingUpdate,
  });
  const legacy = new Y.Doc();
  seedMark(legacy, 'same-key', {
    p: 1,
    o: {
      type: 'rect',
      left: 10,
      data: { id: 'same-key', authorId: actorUserId },
    },
  });
  const supabase = makeLegacyRecoveryBackend(documentId, [], { offline: true });
  const handle = await openAnnotationDoc({
    actorUserId,
    documentId,
    supabase,
    clientId: 'cold',
    writerId: 'cold',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc: new Y.Doc(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    legacyPersistenceFactory: async (_name, target) => {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
      return { synced: true, destroy() {}, async clearDocument() {} };
    },
  });
  try {
    await handle.drain();
    assert.deepEqual(handle.getByPage(), {});
    assert.equal(
      (await outbox.list(documentId, actorUserId)).length,
      1,
      'actorless stale bytes cannot become fresh WAL while any exact outbox row is unresolved',
    );
    assert.deepEqual(handle.getLegacyRecoveryStatus(), {
      pending: true,
      unresolvedEntries: 1,
    });
  } finally {
    await handle.destroy().catch(() => {});
    pendingDoc.destroy();
    legacy.destroy();
  }
});

test('accepted settlement never returns to pending through redundant cleanup', async () => {
  const documentId = 'doc-no-accepted-to-pending';
  const durableOutbox = createMemoryAnnotationOutbox();
  let deleteCalls = 0;
  const outbox = {
    ...durableOutbox,
    async delete() {
      deleteCalls += 1;
      throw new Error('redundant delete must not run');
    },
  };
  const rows = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        rows.push({
          document_id: documentId,
          seq: 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'actor-a',
          data: args.p_data,
        });
        return { data: { seq: 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handle = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc: new Y.Doc(),
  });
  try {
    handle.setMeta('K', 'accepted');
    await handle.drain();
    assert.equal(deleteCalls, 0);
    assert.equal((await durableOutbox.list(documentId, 'actor-a')).length, 0);
    assert.equal(handle.isSyncHealthy(), true);
    assert.equal(handle.getSyncStatus().queueSize, 0);
  } finally {
    await handle.destroy().catch(() => {});
  }
});

test('settlement retry is delayed, bounded, and recovers without Realtime', async () => {
  const documentId = 'doc-settlement-backoff';
  const durableOutbox = createMemoryAnnotationOutbox();
  let settleAttempts = 0;
  const outbox = {
    ...durableOutbox,
    async settleAccepted(record) {
      settleAttempts += 1;
      if (settleAttempts === 1) throw new Error('transient settlement failure');
      return durableOutbox.settleAccepted(record);
    },
  };
  let appendAttempts = 0;
  let snapshotAvailable = false;
  let storedRow = null;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        storedRow ??= {
          document_id: documentId,
          seq: 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'actor-a',
          data: args.p_data,
        };
        return { data: { seq: 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return snapshotAvailable
          ? ({ data: true, error: null })
          : ({ data: null, error: { code: 'XX000', message: 'snapshot unavailable' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(storedRow ? [storedRow] : []);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId: 'actor-a',
      documentId,
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 10,
    });
    handle.setMeta('K', 'accepted');
    await handle.drain();
    assert.equal(handle.isSyncHealthy(), false);
    for (let attempt = 0; attempt < 30 && !handle.isSyncHealthy(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await handle.drain();
    }
    assert.equal(appendAttempts, 2, 'one delayed exact replay settles the receipt');
    assert.equal(settleAttempts, 2);
    assert.deepEqual(handle.getSyncStatus(), {
      healthy: true,
      error: null,
      stage: 'idle',
      queueSize: 0,
    });
  } finally {
    snapshotAvailable = true;
    await handle?.destroy().catch(() => {});
  }
});

test('persistent settlement failure uses bounded backoff without a microtask hot loop', async () => {
  const documentId = 'doc-settlement-bounded-backoff';
  const durableOutbox = createMemoryAnnotationOutbox();
  const outbox = {
    ...durableOutbox,
    async settleAccepted() {
      throw new Error('persistent settlement failure');
    },
  };
  let appendAttempts = 0;
  let snapshotAvailable = false;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        return { data: { seq: 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return snapshotAvailable
          ? ({ data: true, error: null })
          : ({ data: null, error: { code: 'XX000', message: 'snapshot unavailable' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let handle = null;
  try {
    handle = await openAnnotationDoc({
      actorUserId: 'actor-a',
      documentId,
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      outboxStore: outbox,
      doc: new Y.Doc(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 10,
    });
    handle.setMeta('K', 'pending');
    await handle.drain();
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.ok(appendAttempts >= 2);
    assert.ok(appendAttempts <= 5, `backoff bounded attempts, got ${appendAttempts}`);
    assert.equal(handle.isSyncHealthy(), false);
    assert.equal(handle.getSyncStatus().queueSize, 1);
  } finally {
    snapshotAvailable = true;
    await handle?.destroy().catch(() => {});
  }
});

test('account switch cannot expose or delete another actor outbox', async () => {
  const documentId = 'doc-account-switch-outbox';
  const outbox = createMemoryAnnotationOutbox();
  const updateDoc = new Y.Doc();
  setMetaValue(updateDoc, 'secret', 'actor-a-only', 'local');
  await outbox.put({
    key: [documentId, 'actor-a', 'writer-a', 1].join('\u0000'),
    documentId,
    actorUserId: 'actor-a',
    writerId: 'writer-a',
    clientSeq: 1,
    ordinal: 1,
    editEpoch: 1,
    status: 'pending',
    update: Y.encodeStateAsUpdate(updateDoc),
  });
  const supabase = {
    async rpc(name) {
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'actor-b',
    documentId,
    supabase,
    clientId: 'install',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc,
  });
  assert.equal(getMetaValue(doc, 'secret'), undefined);
  assert.equal((await outbox.list(documentId, 'actor-a')).length, 1);
  assert.equal((await outbox.list(documentId, 'actor-b')).length, 0);
  await handle.destroy();
});

test('two clients deterministically converge when promoting one legacy sentinel identity', () => {
  const seed = new Y.Doc();
  seedMark(seed, '\u0000idless:1:0', {
    p: 1,
    o: shortInk('legacy', 0, 30, { idless: true }),
  });
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const updatesA = [];
  const updatesB = [];
  clientA.on('update', (update) => updatesA.push(update));
  clientB.on('update', (update) => updatesB.push(update));

  syncByPageToDoc(clientA, docToByPage(clientA));
  syncByPageToDoc(clientB, docToByPage(clientB));
  exchangeUpdates(clientA, clientB, Y.mergeUpdates(updatesA), Y.mergeUpdates(updatesB));

  for (const doc of [clientA, clientB, cloneDoc(clientA)]) {
    const keys = [...getAnnotationsMap(doc).keys()];
    assert.equal(keys.length, 1);
    assert.equal(keys[0].startsWith('\u0000'), false);
    assert.equal(docToByPage(doc)[1].objects.length, 1);
  }
});

test('lane-owned stable base survives clone/reorder and lane clear restores it', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, {
    1: { objects: [shortInk('a', 0, 30), shortInk('b', 50, 80)] },
  });
  const originalBase = structuredClone(readAnnotationObject(doc, 'a')); // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)

  commitErase(doc, {
    id: 'stable-clone-reorder',
    points: [{ x: 4, y: 50 }],
    radius: 3,
    writerId: 'writer',
  });
  const materialized = docToByPage(doc);
  assert.notDeepEqual(
    materialized[1].objects.find((object) => object.data.id === 'a'),
    originalBase,
  );

  const clonedReordered = JSON.parse(JSON.stringify(materialized));
  clonedReordered[1].objects.reverse();
  syncByPageToDoc(doc, clonedReordered);
  assert.deepEqual(
    readAnnotationObject(doc, 'a'), // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    originalBase,
    'materialized survivor never replaces the stable base',
  );

  clearEraserOpsForAnnotationIds(doc, ['a'], {
    origin: 'history',
    writerId: 'writer',
  });
  assert.deepEqual(
    docToByPage(doc)[1].objects.find((object) => object.data.id === 'a'),
    originalBase,
    'clearing the writer lane restores exact original geometry',
  );
});

test('id-less Undo and Redo use the durable occurrence key and preserve the other writer', async () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [shortInk('unused', 0, 30, { idless: true })] } });
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const updatesA = [];
  const updatesB = [];
  clientA.on('update', (update) => updatesA.push(update));
  clientB.on('update', (update) => updatesB.push(update));
  const erasedA = await commitAtomicEraseOnDoc(clientA, {
    id: 'history-idless-left',
    points: [{ x: 0, y: 50 }],
    radius: 3,
    writerId: 'writer-a',
  });
  const erasedB = await commitAtomicEraseOnDoc(clientB, {
    id: 'history-idless-right',
    points: [{ x: 30, y: 50 }],
    radius: 3,
    writerId: 'writer-b',
  });
  assert.equal(erasedA.status, 'committed');
  assert.equal(erasedB.status, 'committed');
  exchangeUpdates(clientA, clientB, Y.mergeUpdates(updatesA), Y.mergeUpdates(updatesB));

  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-idless-history',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: clientA,
  });
  assert.equal(
    handle.applyEraseHistoryTransition(erasedA.historyTransition, 'undo').status,
    'applied',
  );
  let survivor = handle.getByPage()[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 0, y: 50 }, survivor.polygons), true, 'own bite is undone');
  assert.equal(pointInPolygonSet({ x: 30, y: 50 }, survivor.polygons), false, 'other writer remains');
  survivor = docToByPage(cloneDoc(clientA))[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 0, y: 50 }, survivor.polygons), true, 'undo survives cold materialization');
  assert.equal(pointInPolygonSet({ x: 30, y: 50 }, survivor.polygons), false);

  assert.equal(
    handle.applyEraseHistoryTransition(erasedA.historyTransition, 'redo').status,
    'applied',
  );
  survivor = handle.getByPage()[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 0, y: 50 }, survivor.polygons), false, 'redo restores own bite');
  assert.equal(pointInPolygonSet({ x: 30, y: 50 }, survivor.polygons), false, 'redo keeps other bite');
  assert.deepEqual(
    [...getEraserOpsMap(clientA).values()].map((lane) => lane.writerId).sort(),
    ['writer-a', 'writer-b'],
  );
  await handle.destroy();
});

test('duplicate occurrence zero Undo and Redo never collapse into the unchanged duplicate', async () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, {
    1: { objects: [shortInk('dup', 0, 10), shortInk('dup', 20, 30)] },
  });
  const doc = cloneDoc(seed);
  const erased = await commitAtomicEraseOnDoc(doc, {
    id: 'duplicate-history',
    points: [{ x: 0, y: 50 }],
    radius: 3,
    writerId: 'writer-a',
  });
  assert.equal(erased.status, 'committed');
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-duplicate-history',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  assert.equal(
    handle.applyEraseHistoryTransition(erased.historyTransition, 'undo').status,
    'applied',
  );
  let objects = handle.getByPage()[1].objects;
  assert.equal(objects[0].paperEraserGeometry, undefined);
  assert.deepEqual(objects[0].path, [['M', 0, 50], ['L', 10, 50]]);
  assert.deepEqual(objects[1].path, [['M', 20, 50], ['L', 30, 50]]);

  assert.equal(
    handle.applyEraseHistoryTransition(erased.historyTransition, 'redo').status,
    'applied',
  );
  objects = docToByPage(cloneDoc(doc))[1].objects;
  assert.equal(objects[0].paperEraserGeometry, 'v1', 'occurrence zero redo survives reload');
  assert.equal(objects[1].paperEraserGeometry, undefined, 'unchanged duplicate remains untouched');
  assert.deepEqual(objects[1].path, [['M', 20, 50], ['L', 30, 50]]);
  await handle.destroy();
});

test('duplicate occurrence one edit, Undo, Redo, and cold reload preserve both occurrences', async () => {
  const seed = new Y.Doc();
  const first = { ...shortInk('dup', 0, 10), left: 10 };
  const second = { ...shortInk('dup', 20, 30), left: 30 };
  syncByPageToDoc(seed, { 1: { objects: [first, second] } });
  const doc = cloneDoc(seed);
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-duplicate-occurrence-one-history',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  const undoState = handle.getByPage();
  const durableKeys = undoState[1].objects.map(getAnnotationStorageKey);
  assert.equal(durableKeys[0], 'dup');
  assert.notEqual(durableKeys[1], 'dup');
  assert.equal(durableKeys[1].startsWith('\u0000'), false);
  const editedSecond = { ...undoState[1].objects[1], left: 31 };
  const redoState = {
    1: { ...undoState[1], objects: [undoState[1].objects[0], editedSecond] },
  };

  handle.applyByPage(redoState);
  assert.deepEqual(handle.getByPage()[1].objects.map((object) => object.left), [10, 31]);
  assert.deepEqual([...getAnnotationsMap(doc).keys()].sort(), [...durableKeys].sort());

  handle.applyByPage(undoState);
  assert.deepEqual(handle.getByPage()[1].objects.map((object) => object.left), [10, 30]);

  handle.applyByPage(redoState);
  const reloaded = docToByPage(cloneDoc(doc))[1].objects;
  assert.deepEqual(reloaded.map((object) => object.left), [10, 31]);
  assert.deepEqual(reloaded.map(getAnnotationStorageKey), durableKeys);
  await handle.destroy();
});

test('id-less occurrence one edit, Undo, Redo, and cold reload preserve both occurrences', async () => {
  const seed = new Y.Doc();
  const first = { ...shortInk('unused', 0, 10, { idless: true }), left: 10 };
  const second = { ...shortInk('unused', 20, 30, { idless: true }), left: 30 };
  syncByPageToDoc(seed, { 1: { objects: [first, second] } });
  const doc = cloneDoc(seed);
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-idless-occurrence-one-history',
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  const undoState = handle.getByPage();
  const durableKeys = undoState[1].objects.map(getAnnotationStorageKey);
  assert.equal(new Set(durableKeys).size, 2);
  assert.equal(durableKeys.every((key) => key && !key.startsWith('\u0000')), true);
  const editedSecond = { ...undoState[1].objects[1], left: 31 };
  const redoState = {
    1: { ...undoState[1], objects: [undoState[1].objects[0], editedSecond] },
  };

  handle.applyByPage(redoState);
  assert.deepEqual(handle.getByPage()[1].objects.map((object) => object.left), [10, 31]);
  assert.deepEqual([...getAnnotationsMap(doc).keys()].sort(), [...durableKeys].sort());

  handle.applyByPage(undoState);
  assert.deepEqual(handle.getByPage()[1].objects.map((object) => object.left), [10, 30]);

  handle.applyByPage(redoState);
  const reloaded = docToByPage(cloneDoc(doc))[1].objects;
  assert.deepEqual(reloaded.map((object) => object.left), [10, 31]);
  assert.deepEqual(reloaded.map(getAnnotationStorageKey), durableKeys);
  await handle.destroy();
});

test('history normalization preserves serialized duplicate identity through reorder', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, {
    1: { objects: [shortInk('dup', 0, 10), shortInk('dup', 20, 30)] },
  });
  const materialized = docToByPage(doc);
  const durableKeys = materialized[1].objects.map(getAnnotationStorageKey);
  const reordered = {
    1: {
      ...materialized[1],
      objects: [materialized[1].objects[1], materialized[1].objects[0]],
    },
  };
  const normalized = normalizeCanvasJsonForHistory(reordered);
  assert.deepEqual(
    normalized[1].objects.map((object) => object.data.id),
    [durableKeys[1], durableKeys[0]],
  );
  syncByPageToDoc(doc, normalized);
  assert.equal(getAnnotationsMap(doc).size, 2);
  assert.deepEqual(
    docToByPage(cloneDoc(doc))[1].objects.map((object) => object.path),
    [[['M', 0, 50], ['L', 10, 50]], [['M', 20, 50], ['L', 30, 50]]],
  );
});

test('partial erase keeps canonical id through JSON clone, reorder, Undo, Redo, and cold reload', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, {
    1: {
      objects: [
        shortInk('unused-a', 0, 10, { idless: true }),
        shortInk('unused-b', 20, 50, { idless: true }),
      ],
    },
  });
  const before = docToByPage(doc);
  const beforeObjects = before[1].objects;
  const canonicalIds = beforeObjects.map((object) => object.data.id);
  assert.equal(new Set(canonicalIds).size, 2);
  assert.equal(canonicalIds.every(Boolean), true);

  const eraseResult = erasePageAnnotations({
    pageAnnotations: before[1],
    eraserPoints: [{ x: 25, y: 50 }],
    eraserRadius: 2,
    mode: 'partial',
  });
  const targetStorageKey = canonicalIds[1];
  assert.equal(eraseResult.didChange, true);
  assert.deepEqual(
    eraseResult.objectMutations.map((mutation) => mutation.storageKey),
    [targetStorageKey],
  );

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: before[1],
    nextPage: eraseResult.pageAnnotations,
    changedIds: eraseResult.changedIds,
    deletedIds: eraseResult.deletedIds,
    changedStorageKeys: eraseResult.objectMutations
      .filter((mutation) => !mutation.deleted)
      .map((mutation) => mutation.storageKey),
    deletedStorageKeys: eraseResult.objectMutations
      .filter((mutation) => mutation.deleted)
      .map((mutation) => mutation.storageKey),
  });
  assert.equal(action?.storageKey, targetStorageKey);

  const reorderedAfter = JSON.parse(JSON.stringify({
    1: {
      ...eraseResult.pageAnnotations,
      objects: [...eraseResult.pageAnnotations.objects].reverse(),
    },
  }));
  const expectedAfter = JSON.parse(JSON.stringify(reorderedAfter));
  const undone = applyAnnotationHistoryAction(
    reorderedAfter,
    invertAnnotationHistoryAction(action),
  );
  assert.deepEqual(
    undone[1].objects.map((object) => object.data.id),
    [canonicalIds[1], canonicalIds[0]],
  );
  assert.deepEqual(undone[1].objects[0], beforeObjects[1]);
  assert.deepEqual(undone[1].objects[1], beforeObjects[0]);

  const redone = applyAnnotationHistoryAction(
    JSON.parse(JSON.stringify(undone)),
    action,
  );
  assert.deepEqual(redone, expectedAfter);

  syncByPageToDoc(doc, redone);
  const reloaded = docToByPage(cloneDoc(doc));
  assert.equal(reloaded[1].objects.length, 2);
  assert.deepEqual(
    new Set(reloaded[1].objects.map((object) => object.data.id)),
    new Set(canonicalIds),
  );
  for (const expectedObject of expectedAfter[1].objects) {
    const reloadedObject = reloaded[1].objects.find(
      (object) => object.data.id === expectedObject.data.id,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(reloadedObject)), expectedObject);
  }
});

async function assertOccurrenceOneConcurrentHistory({ idless }) {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, {
    1: {
      objects: [
        shortInk(idless ? 'unused-a' : 'dup', 0, 10, { idless }),
        shortInk(idless ? 'unused-b' : 'dup', 20, 50, { idless }),
      ],
    },
  });
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const beforeA = docToByPage(clientA);
  const storageKey = getAnnotationStorageKey(beforeA[1].objects[1]);
  assert.ok(storageKey);
  assert.equal(storageKey.startsWith('\u0000'), false);

  const erasedA = await commitAtomicEraseOnDoc(clientA, {
    id: `occurrence-one-${idless ? 'idless' : 'duplicate'}-a`,
    points: [{ x: 20, y: 50 }],
    radius: 3,
    writerId: 'writer-a',
  });
  assert.equal(erasedA.status, 'committed');
  assert.equal(
    erasedA.historyTransition.lanes[0]?.nextLane?.storageKey,
    storageKey,
  );

  const erasedB = await commitAtomicEraseOnDoc(clientB, {
    id: `occurrence-one-${idless ? 'idless' : 'duplicate'}-b`,
    points: [{ x: 50, y: 50 }],
    radius: 3,
    writerId: 'writer-b',
  });
  assert.equal(erasedB.status, 'committed');
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB));
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: `doc-occurrence-one-${idless ? 'idless' : 'duplicate'}-composed-history`,
    supabase: null,
    clientId: 'client-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: clientA,
  });

  let occurrence = handle.getByPage()[1].objects[1];
  assert.equal(pointInPolygonSet({ x: 20, y: 50 }, occurrence.polygons), false);
  assert.equal(pointInPolygonSet({ x: 50, y: 50 }, occurrence.polygons), false);

  assert.equal(
    handle.applyEraseHistoryTransition(erasedA.historyTransition, 'undo').status,
    'applied',
  );
  occurrence = docToByPage(cloneDoc(clientA))[1].objects[1];
  assert.equal(pointInPolygonSet({ x: 20, y: 50 }, occurrence.polygons), true, 'Undo A restores only A bite');
  assert.equal(pointInPolygonSet({ x: 50, y: 50 }, occurrence.polygons), false, 'Undo A preserves B bite');

  assert.equal(
    handle.applyEraseHistoryTransition(erasedA.historyTransition, 'redo').status,
    'applied',
  );
  occurrence = docToByPage(cloneDoc(clientA))[1].objects[1];
  assert.equal(pointInPolygonSet({ x: 20, y: 50 }, occurrence.polygons), false, 'Redo A restores A bite');
  assert.equal(pointInPolygonSet({ x: 50, y: 50 }, occurrence.polygons), false, 'Redo A preserves B bite');
  assert.equal(docToByPage(clientA)[1].objects.length, 2, 'history never collapses the sibling occurrence');
  await handle.destroy();
}

test('duplicate occurrence one A+B erase, A Undo/Redo, and cold reload use durable identity', async () => {
  await assertOccurrenceOneConcurrentHistory({ idless: false });
});

test('id-less occurrence one A+B erase, A Undo/Redo, and cold reload use durable identity', async () => {
  await assertOccurrenceOneConcurrentHistory({ idless: true });
});

test('durable eraser metadata uses the pointer-down mode and radius', () => {
  assert.match(
    FABRIC_ERASER_SOURCE,
    /gestureConfig:\s*\{\s*mode: eraserModeRef\.current,\s*radius: getPageRadius\(\)/,
  );
  assert.match(
    FABRIC_ERASER_SOURCE,
    /applyEraserAndCommit\(pointer\?\.points, pointer\?\.gestureConfig\)/,
  );
  assert.match(FABRIC_ERASER_SOURCE, /eraserRadius: radius,\s*eraserMode: mode,/);
});

test('mixed erase pointer-up has one atomic coordinator plus explicitly scoped legacy fallbacks', () => {
  const calloutCommit = FABRIC_ERASER_SOURCE.indexOf('onEraseCalloutRef.current?.');
  const markerCommit = FABRIC_ERASER_SOURCE.indexOf('onEraseSurveyMarkerRef.current?.');
  const markupCommit = FABRIC_ERASER_SOURCE.indexOf('onEraseTextMarkupRef.current?.');
  assert.equal(calloutCommit, -1);
  assert.equal(markupCommit, -1);
  assert.notEqual(markerCommit, -1, 'survey markers deliberately retain their existing delete path');
  assert.match(
    FABRIC_ERASER_SOURCE,
    /if \(typeof onEraseIntentRef\.current !== 'function'\) \{[\s\S]*?await onEraseCommitRef\.current\?\.\(updatedJSON, diagnostics\)/,
    'local-only documents deliberately retain their existing page save path',
  );
  assert.match(
    FABRIC_ERASER_SOURCE,
    /const commitResult = await onEraseIntentRef\.current\?\.\(intent\)/,
    'registered documents route page/callout/text-markup/counter mutations through one coordinator',
  );
  assert.doesNotMatch(
    FABRIC_ERASER_SOURCE,
    /targets\.push\(\{\s*domain: 'survey-marker'/,
    'survey markers are not advertised as part of the atomic coordinator',
  );
});

test('purge clears eraser lanes and every durable annotation map before same-id reseed', async () => {
  const documentId = 'doc-purge-all-annotation-maps';
  const registryKey = `annoflat:${documentId}`;
  _evictForTest(registryKey);
  const doc = getOrCreateYDoc(registryKey);
  syncByPageToDoc(doc, { 1: { objects: [nativeInk('same-id')] } });
  commitErase(doc, {
    id: 'old-bite',
    points: [{ x: 50, y: 38 }],
    writerId: 'old-writer',
  });
  doc.getMap('annoMeta').set('old', true);
  getSurveyMarkersMap(doc).set('old-marker', { id: 'old-marker' });

  await purgeAnnotationDoc(documentId);

  assert.equal(getAnnotationsMap(doc).size, 0);
  assert.equal(getEraserOpsMap(doc).size, 0);
  assert.equal(doc.getMap('annoMeta').size, 0);
  assert.equal(getSurveyMarkersMap(doc).size, 0);

  syncByPageToDoc(doc, { 1: { objects: [nativeInk('same-id')] } });
  const reseeded = docToByPage(doc)[1].objects[0];
  assert.equal(reseeded.paperEraserGeometry, undefined, 'old bite is not replayed into same-id seed');

  releaseYDoc(registryKey);
  _evictForTest(registryKey);
});

test('purge invalidates mounted handles and uses exact registry-key boundaries', async () => {
  const documentId = 'doc-purge-exact';
  const siblingId = `${documentId}0`;
  const rawDoc = getOrCreateYDoc(documentId);
  const siblingKey = `annoflat:${siblingId}:actor-a`;
  const siblingDoc = getOrCreateYDoc(siblingKey);
  setMetaValue(rawDoc, 'old', 'raw-registry', 'seed');
  setMetaValue(siblingDoc, 'keep', 'sibling', 'seed');

  const handle = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase: null,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
  });
  handle.setMeta('mounted', 'must-clear');

  await purgeAnnotationDoc(documentId);

  assert.equal(getMetaValue(rawDoc, 'old'), undefined, 'exact raw Phase-27 registry key is purged');
  assert.equal(getMetaValue(siblingDoc, 'keep'), 'sibling', 'doc1 purge cannot match doc10');
  assert.equal(handle.getMeta('mounted'), undefined);
  assert.deepEqual(handle.getByPage(), {});
  assert.throws(
    () => handle.setMeta('after-delete', 'must-not-write'),
    (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
  );
  assert.throws(
    () => handle.applyByPage({ 1: { objects: [nativeInk('after-delete')] } }),
    (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
  );

  await handle.destroy();
  releaseYDoc(siblingKey);
  _evictForTest(siblingKey);
  _evictForTest(documentId);
});

test('an opening handle fails closed when purge advances its outbox incarnation', async () => {
  const documentId = 'doc-purge-during-open';
  const actorUserId = 'actor-a';
  const durableOutbox = createMemoryAnnotationOutbox();
  let reads = 0;
  let releaseFinalRead;
  let markFinalRead;
  const finalReadEntered = new Promise((resolve) => { markFinalRead = resolve; });
  const finalReadGate = new Promise((resolve) => { releaseFinalRead = resolve; });
  const outbox = {
    ...durableOutbox,
    async getDocumentIncarnation(id) {
      reads += 1;
      if (reads === 2) {
        markFinalRead();
        await finalReadGate;
      }
      return durableOutbox.getDocumentIncarnation(id);
    },
  };

  const opening = openAnnotationDoc({
    actorUserId,
    documentId,
    supabase: null,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc: new Y.Doc(),
  });
  await finalReadEntered;
  await durableOutbox.deleteDocument(documentId);
  releaseFinalRead();

  await assert.rejects(
    opening,
    (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
  );
});

test('a stale cross-tab handle rolls back its edit when outbox incarnation rejects it', async () => {
  const documentId = 'doc-stale-handle-incarnation';
  const actorUserId = 'actor-a';
  const outbox = createMemoryAnnotationOutbox();
  const supabase = {
    async rpc(name) {
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handle = await openAnnotationDoc({
    actorUserId,
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc: new Y.Doc(),
  });
  try {
    await outbox.deleteDocument(documentId);
    handle.setMeta('after-delete', 'must-not-survive');
    await assert.rejects(
      handle.drain(),
      (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
    );

    assert.equal(handle.getMeta('after-delete'), undefined);
    assert.equal(handle.isSyncHealthy(), false);
    assert.equal(handle.getSyncStatus().stage, 'error');
    assert.equal(handle.getSyncStatus().queueSize, 0);
    assert.equal((await outbox.list(documentId, actorUserId)).length, 0);
  } finally {
    await handle.destroy().catch(() => {});
  }
});

test('concurrent full-delete and partial erase converge with delete-wins semantics', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [nativeInk()] } });
  const fullDelete = cloneDoc(seed);
  const partialErase = cloneDoc(seed);
  const fullUpdates = [];
  const partialUpdates = [];
  fullDelete.on('update', (update, origin) => { if (origin !== 'remote-test') fullUpdates.push(update); });
  partialErase.on('update', (update, origin) => { if (origin !== 'remote-test') partialUpdates.push(update); });

  commitErase(fullDelete, {
    id: 'erase-full',
    points: [{ x: 50, y: 50 }],
    radius: 12,
    mode: 'full',
    writerId: 'full-writer',
  });
  commitErase(partialErase, {
    id: 'erase-partial',
    points: [{ x: 50, y: 38 }],
    writerId: 'partial-writer',
  });

  exchangeUpdates(
    fullDelete,
    partialErase,
    Y.mergeUpdates(fullUpdates),
    Y.mergeUpdates(partialUpdates),
  );

  assert.equal(docToByPage(fullDelete)[1]?.objects?.length || 0, 0);
  assert.equal(docToByPage(partialErase)[1]?.objects?.length || 0, 0);
});

test('two simultaneous partial erases preserve both bites after merge and reload', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [nativeInk()] } });
  const left = cloneDoc(seed);
  const right = cloneDoc(seed);
  const leftUpdates = [];
  const rightUpdates = [];
  left.on('update', (update, origin) => { if (origin !== 'remote-test') leftUpdates.push(update); });
  right.on('update', (update, origin) => { if (origin !== 'remote-test') rightUpdates.push(update); });

  commitErase(left, {
    id: 'erase-left',
    points: [{ x: 35, y: 38 }],
    writerId: 'left-writer',
  });
  commitErase(right, {
    id: 'erase-right',
    points: [{ x: 70, y: 62 }],
    writerId: 'right-writer',
  });

  exchangeUpdates(left, right, Y.mergeUpdates(leftUpdates), Y.mergeUpdates(rightUpdates));
  const reloaded = cloneDoc(left);
  const survivor = docToByPage(reloaded)[1].objects[0];

  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), false, 'left bite persists');
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false, 'right bite persists');
  assert.equal(pointInPolygonSet({ x: 35, y: 50 }, survivor.polygons), true, 'left center survives');
  assert.equal(pointInPolygonSet({ x: 70, y: 50 }, survivor.polygons), true, 'right center survives');
});

test('sequential erase, Undo, Redo, reload, and empty-page cycles remain stable', async () => {
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-eraser-history',
    supabase: null,
    clientId: 'history',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  const original = { 1: { objects: [nativeInk()] } };
  handle.applyByPage(original);
  const baseline = handle.getByPage();

  const result = await handle.commitEraseIntent(prepareAtomicErase(baseline, {
    mutationId: 'history-bite',
    points: [{ x: 35, y: 38 }],
    radius: 7,
    mode: 'partial',
  }), {
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
  });
  assert.equal(result.status, 'committed');
  const erased = handle.getByPage();
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, erased[1].objects[0].polygons), false);

  assert.equal(
    handle.applyEraseHistoryTransition(result.historyTransition, 'undo').status,
    'applied',
  );
  assert.equal(handle.getByPage()[1].objects[0].strokeWidth, 20);
  assert.equal(
    handle.applyEraseHistoryTransition(result.historyTransition, 'redo').status,
    'applied',
  );
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, handle.getByPage()[1].objects[0].polygons), false);
  assert.equal(
    pointInPolygonSet({ x: 35, y: 41 }, docToByPage(cloneDoc(doc))[1].objects[0].polygons),
    false,
    'redo survives reload',
  );

  handle.applyByPage({}); // full-page empty cycle
  assert.equal(Object.keys(handle.getByPage()).length, 0);
  handle.applyByPage(erased);
  assert.equal(handle.getByPage()[1].objects.length, 1);
  handle.applyByPage({});
  assert.equal(Object.keys(docToByPage(cloneDoc(doc))).length, 0, 'empty redo survives reload');
  await handle.destroy();
});

function makeEmptyBuilder(result) {
  const builder = {};
  const chain = () => builder;
  for (const method of ['select', 'eq', 'gt', 'order', 'limit']) builder[method] = chain;
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (resolve) => resolve(result);
  return builder;
}

function makeWalReadBuilder(rows) {
  let selected = '';
  let gtSeq = null;
  const filters = new Map();
  const builder = {
    select(columns) { selected = columns; return builder; },
    eq(column, value) { filters.set(column, value); return builder; },
    gt(_column, value) { gtSeq = Number(value); return builder; },
    order() { return builder; },
    limit() { return builder; },
    then(resolve) {
      let data = rows.filter((row) => (
        [...filters].every(([column, value]) => row[column] === value)
        && (gtSeq == null || row.seq > gtSeq)
      ));
      if (selected === 'client_seq') {
        data = data.map((row) => ({ client_seq: row.client_seq }));
      } else {
        data = data.map((row) => ({
          seq: row.seq,
          data: row.data,
          client_id: row.client_id,
          client_seq: row.client_seq,
          actor_user_id: row.actor_user_id,
        }));
      }
      return resolve({ data, error: null });
    },
  };
  return builder;
}

function makeLegacyRecoveryBackend(documentId, rows, { offline = false } = {}) {
  return {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (offline) {
          return { data: null, error: { code: 'XX000', message: 'offline' } };
        }
        const row = {
          document_id: documentId,
          seq: rows.length + 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'actor-a',
          data: args.p_data,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        if (offline) {
          return { data: null, error: { code: 'XX000', message: 'offline' } };
        }
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function makeSharedSequenceBackend() {
  const rows = [];
  let nextSeq = 1;
  return {
    rows,
    from(table) {
      if (table === 'annotation_updates') {
        return {
          select: () => makeEmptyBuilder({ data: rows }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const duplicate = rows.find((candidate) => (
                  candidate.document_id === row.document_id
                  && candidate.client_id === row.client_id
                  && candidate.client_seq === row.client_seq
                ));
                if (duplicate) {
                  return { data: null, error: { code: '23505', message: 'duplicate client sequence' } };
                }
                const committed = { ...row, seq: nextSeq++ };
                rows.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({ data: null }),
          upsert: async () => ({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('same-install tabs never reuse the same WAL writer sequence', async () => {
  const supabase = makeSharedSequenceBackend();
  const handleA = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-tabs',
    supabase,
    clientId: 'same-install',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });
  const handleB = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-tabs',
    supabase,
    clientId: 'same-install',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });

  handleA.applyByPage({ 1: { objects: [nativeInk('a')] } });
  handleB.applyByPage({ 1: { objects: [nativeInk('b')] } });
  await Promise.all([handleA.drain(), handleB.drain()]);

  assert.equal(supabase.rows.length, 2, 'both distinct tab mutations commit');
  assert.notEqual(supabase.rows[0].client_id, supabase.rows[1].client_id, 'each open has a unique WAL writer id');

  await Promise.all([handleA.destroy(), handleB.destroy()]);
});

test('database WAL and snapshot RPCs share the per-document transaction lock', () => {
  assert.match(WAL_CONCURRENCY_SQL, /FUNCTION public\.append_annotation_update/);
  assert.match(WAL_CONCURRENCY_SQL, /FUNCTION public\.store_annotation_snapshot/);
  assert.ok(
    (WAL_CONCURRENCY_SQL.match(/pg_advisory_xact_lock\(hashtextextended\(p_document_id::text, 0\)\)/g) || []).length >= 2,
    'append and snapshot RPCs serialize on the same document lock',
  );
  assert.match(WAL_CONCURRENCY_SQL, /annotation_updates_serialize_insert/);
  assert.match(WAL_CONCURRENCY_SQL, /annotation_snapshots_guard_write/);
  assert.match(WAL_CONCURRENCY_SQL, /ALTER COLUMN seq DROP IDENTITY IF EXISTS/);
  assert.match(WAL_CONCURRENCY_SQL, /MAX\(au\.seq\), 0\) \+ 1/);
  assert.match(WAL_CONCURRENCY_SQL, /p_expected_writer_id/);
  assert.match(WAL_CONCURRENCY_SQL, /p_expected_at_seq BIGINT/);
  assert.match(WAL_CONCURRENCY_SQL, /wal_head <> p_at_seq/);
  assert.match(
    WAL_CONCURRENCY_SQL,
    /kal49_lock_document[\s\S]*pg_advisory_xact_lock\(hashtextextended\(doc_id::text, 0\)\)/,
  );
});

test('a stale fallback snapshot cannot overwrite a newer WAL checkpoint', async () => {
  let snapshot = null;
  let rejectAppends = false;
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        return {
          select: () => makeEmptyBuilder({ data: [] }),
          insert: () => ({
            select: () => ({
              single: async () => rejectAppends
                ? ({ data: null, error: { code: '42501', message: 'RLS rejected' } })
                : ({ data: { seq: 1 }, error: null }),
            }),
          }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({ data: snapshot }),
          upsert: async (row) => { snapshot = row; return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-stale-fallback',
    supabase,
    clientId: 'stale-install',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });

  snapshot = { document_id: 'doc-stale-fallback', at_seq: 9, snapshot: '\\xnewer' };
  rejectAppends = true;
  handle.applyByPage({ 1: { objects: [nativeInk('local')] } });
  await handle.drain();

  assert.equal(snapshot.at_seq, 9, 'the newer checkpoint is not replaced by stale fallback bytes');
  await handle.destroy();
});

test('snapshot CAS conflict reloads snapshot plus WAL and cold-opens both writers', async () => {
  const rows = [];
  let snapshot = null;
  const snapshotCalls = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (args.p_client_id === 'writer-a') {
          return { data: null, error: { code: 'XX000', message: 'forced append miss' } };
        }
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotCalls.push(args);
        const walHead = rows.at(-1)?.seq ?? 0;
        if (args.p_at_seq !== walHead) return { data: false, error: null };
        if (snapshot) {
          const exactRetry = (
            snapshot.at_seq === args.p_at_seq
            && snapshot.snapshot === args.p_snapshot
            && snapshot.encoding_version === args.p_encoding_version
            && snapshot.writer_id === args.p_writer_id
            && snapshot.writer_epoch === args.p_writer_epoch
          );
          if (!exactRetry && (
            snapshot.at_seq !== args.p_expected_at_seq
            || snapshot.writer_id !== args.p_expected_writer_id
            || snapshot.writer_epoch !== args.p_expected_writer_epoch
            || snapshot.writer_epoch >= args.p_writer_epoch
          )) {
            return { data: false, error: null };
          }
        } else if (
          args.p_expected_at_seq != null
          || args.p_expected_writer_id != null
          || args.p_expected_writer_epoch !== 0
        ) {
          return { data: false, error: null };
        }
        snapshot = {
          document_id: args.p_document_id,
          at_seq: args.p_at_seq,
          snapshot: args.p_snapshot,
          encoding_version: args.p_encoding_version,
          writer_id: args.p_writer_id,
          writer_epoch: args.p_writer_epoch,
        };
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: snapshot, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  // Both writers load the same empty snapshot base.
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const handleA = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-snapshot-cas-reload',
    supabase,
    clientId: 'install-a',
    writerId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: docA,
  });
  const handleB = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-snapshot-cas-reload',
    supabase,
    clientId: 'install-b',
    writerId: 'writer-b',
    enableLocal: false,
    enableRealtime: false,
    doc: docB,
  });

  handleA.setMeta('A', 'snapshot-only');
  await handleA.drain();
  assert.equal(snapshot?.at_seq, 0, 'A recovers its missed append through snapshot at frontier zero');

  handleB.setMeta('B', 'wal');
  await handleB.drain();
  assert.equal(await handleB.flushSnapshot(), true, 'B reloads and retries after stale snapshot CAS');

  const bCalls = snapshotCalls.filter((call) => call.p_writer_id === 'writer-b');
  assert.equal(bCalls.length, 2, 'B performs one rejected CAS and one merged retry');
  assert.equal(bCalls[0].p_expected_at_seq, null);
  assert.equal(bCalls[0].p_expected_writer_id, null);
  assert.equal(bCalls[1].p_expected_at_seq, 0);
  assert.equal(bCalls[1].p_expected_writer_id, 'writer-a');
  assert.equal(bCalls[1].p_at_seq, 1);
  assert.ok(
    bCalls[1].p_writer_epoch > bCalls[0].p_writer_epoch,
    'CAS refresh consumes a newer document-wide snapshot generation',
  );

  assert.equal(
    await handleA.flushSnapshot(),
    true,
    'A can return after B only by consuming a generation newer than B',
  );
  const aCalls = snapshotCalls.filter((call) => call.p_writer_id === 'writer-a');
  assert.ok(aCalls.length >= 3, 'A performs its original write plus conflict/retry after B');
  assert.ok(
    aCalls.at(-1).p_writer_epoch > bCalls.at(-1).p_writer_epoch,
    'A→B→A never reuses A’s original snapshot token',
  );

  const coldDoc = new Y.Doc();
  const coldHandle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-snapshot-cas-reload',
    supabase,
    clientId: 'cold',
    writerId: 'writer-cold',
    enableLocal: false,
    enableRealtime: false,
    doc: coldDoc,
  });
  assert.equal(coldHandle.getMeta('A'), 'snapshot-only', 'cold open retains A snapshot-only recovery');
  assert.equal(coldHandle.getMeta('B'), 'wal', 'cold open retains B WAL mutation');

  await coldHandle.destroy();
  await handleB.destroy();
  await handleA.destroy();
});

test('catch-up replays a late lower sequence after legal database commit inversion', async () => {
  const log = [];
  let subscribed = null;
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        let gtSeq = null;
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_column, value) => { gtSeq = Number(value); return builder; },
          order: () => builder,
          limit: () => builder,
          insert: () => ({ select: () => ({ single: async () => ({ data: { seq: 3 }, error: null }) }) }),
          then: (resolve) => resolve({
            data: gtSeq == null ? [] : log.filter((row) => row.seq > gtSeq),
            error: null,
          }),
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({ data: null }),
          upsert: async () => ({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on() { return this; },
      subscribe(callback) { subscribed = callback; return this; },
    }),
  };
  const remote = new Y.Doc();
  let lateLower;
  let earlyHigher;
  remote.on('update', (update) => {
    if (!earlyHigher) earlyHigher = bytesToPgHex(update);
    else lateLower = bytesToPgHex(update);
  });
  seedMark(remote, 'seq-2', { p: 1, o: nativeInk('seq-2') });
  seedMark(remote, 'seq-1', { p: 1, o: nativeInk('seq-1') });

  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-inversion',
    supabase,
    clientId: 'reader',
    enableLocal: false,
    enableRealtime: true,
    doc,
  });

  log.push({ seq: 2, data: earlyHigher, client_id: 'writer' });
  subscribed?.('SUBSCRIBED');
  await new Promise((resolve) => setTimeout(resolve, 5));
  log.unshift({ seq: 1, data: lateLower, client_id: 'writer' });
  subscribed?.('SUBSCRIBED');
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(getAnnotationsMap(doc).has('seq-1'), true, 'late lower sequence is not skipped');
  assert.equal(getAnnotationsMap(doc).has('seq-2'), true);
  await handle.destroy();
});

test('RLS rejection quarantines a missed-revocation erase across reconnect, reload, and later recovery', async () => {
  const authoritative = new Y.Doc();
  syncByPageToDoc(authoritative, { 1: { objects: [nativeInk()] } }, { origin: 'hydrate' });
  const authoritativeInk = serializedAnnotation(authoritative, 'ink');
  const rows = [{
    document_id: 'doc-revoked',
    seq: 1,
    client_id: 'seed',
    client_seq: 1,
    data: bytesToPgHex(Y.encodeStateAsUpdate(authoritative)),
  }];
  let authorized = true;
  let onSubscribe = null;
  let snapshotWrites = 0;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (!authorized) {
          // Outlast the 1.2s debounce to prove a slow 42501 cannot race a
          // forbidden optimistic snapshot into durable storage.
          await new Promise((resolve) => setTimeout(resolve, 1250));
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const committed = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(committed);
        return { data: { seq: committed.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotWrites += 1;
        return authorized
          ? ({ data: { accepted: true }, error: null })
          : ({ data: null, error: { code: '42501', message: 'permission revoked' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') {
        let selected = '';
        let gtSeq = null;
        const filters = new Map();
        const builder = {
          select(columns) { selected = columns; return builder; },
          eq(column, value) { filters.set(column, value); return builder; },
          gt(_column, value) { gtSeq = Number(value); return builder; },
          order() { return builder; },
          limit() { return builder; },
          then(resolve) {
            let data = rows.filter((row) => (
              [...filters].every(([column, value]) => row[column] === value)
              && (gtSeq == null || row.seq > gtSeq)
            ));
            if (selected === 'client_seq') {
              data = data.map((row) => ({ client_seq: row.client_seq }));
            } else {
              data = data.map((row) => ({ seq: row.seq, data: row.data, client_id: row.client_id }));
            }
            return resolve({ data, error: null });
          },
          insert: (row) => ({
            select: () => ({
              single: async () => {
                if (!authorized) {
                  return { data: null, error: { code: '42501', message: 'permission revoked' } };
                }
                const committed = { ...row, seq: rows.length + 1 };
                rows.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({ data: null }),
          upsert: async () => authorized
            ? ({ error: null })
            : ({ error: { code: '42501', message: 'permission revoked' } }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on() { return this; },
      subscribe(callback) { onSubscribe = callback; return this; },
    }),
    removeChannel: async () => {},
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-revoked',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: true,
    doc,
  });

  authorized = false; // Realtime role/lock notification was missed.
  commitErase(doc, {
    id: 'revoked-erase',
    points: [{ x: 50, y: 38 }],
    writerId: handle.writerId,
  });
  await handle.drain();

  assert.deepEqual(
    serializedAnnotation(doc, 'ink'),
    authoritativeInk,
    'the rejected gesture is removed from the local projection',
  );
  assert.equal(handle.isSyncHealthy(), false, 'RLS rejection is surfaced');
  assert.equal(rows.length, 1, 'the forbidden update never reaches durable WAL');
  assert.equal(snapshotWrites, 0, 'permission denial never falls back to a forbidden full snapshot');
  assert.equal(getEraserOpsMap(doc).size, 0, 'the forbidden eraser lane is removed locally');

  onSubscribe?.('SUBSCRIBED');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(serializedAnnotation(doc, 'ink'), authoritativeInk, 'reconnect cannot replay the quarantined gesture');

  const coldDoc = new Y.Doc();
  const coldHandle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-revoked',
    supabase,
    clientId: 'cold-reader',
    enableLocal: false,
    enableRealtime: false,
    doc: coldDoc,
  });
  assert.deepEqual(
    serializedAnnotation(coldDoc, 'ink'),
    authoritativeInk,
    'cold reload remains at server-authoritative geometry',
  );

  authorized = true;
  onSubscribe?.('SUBSCRIBED');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(rows.length, 1, 'restoring access does not flush the forbidden erase');
  assert.deepEqual(
    serializedAnnotation(doc, 'ink'),
    authoritativeInk,
    'restoring access leaves the rejected geometry unchanged',
  );

  commitErase(doc, {
    id: 'authorized-erase',
    points: [{ x: 75, y: 38 }],
    writerId: handle.writerId,
  });
  await handle.drain();
  assert.equal(handle.isSyncHealthy(), true, 'a fresh authorized gesture restores sync health');
  assert.equal(rows.length, 2, 'only the fresh authorized gesture reaches WAL');

  const recoveredDoc = new Y.Doc();
  const recoveredHandle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-revoked',
    supabase,
    clientId: 'recovered-reader',
    enableLocal: false,
    enableRealtime: false,
    doc: recoveredDoc,
  });
  const recovered = recoveredHandle.getByPage()[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 50, y: 41 }, recovered.polygons), true, 'forbidden bite stays absent');
  assert.equal(pointInPolygonSet({ x: 75, y: 41 }, recovered.polygons), false, 'fresh authorized bite reloads');

  await recoveredHandle.destroy();
  await coldHandle.destroy();
  await handle.destroy();
});

test('authorized reopen uploads legitimate IndexedDB-only state for a cold cloud reopen', async () => {
  const cloud = new Y.Doc();
  setMetaValue(cloud, 'A', 'cloud', 'hydrate');
  const rows = [{
    document_id: 'doc-idb-authorized',
    seq: 1,
    client_id: 'seed',
    client_seq: 1,
    data: bytesToPgHex(Y.encodeStateAsUpdate(cloud)),
  }];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') return { select: () => makeEmptyBuilder({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const active = new Y.Doc();
  setMetaValue(active, 'B', 'legitimate-offline', 'indexeddb-preload');
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-idb-authorized',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: active,
  });
  await handle.drain();

  assert.equal(rows.length, 2, 'the offline-only difference receives its own authorized WAL row');
  assert.equal(getMetaValue(active, 'A'), 'cloud');
  assert.equal(getMetaValue(active, 'B'), 'legitimate-offline');
  const directReplay = new Y.Doc();
  for (const row of rows) Y.applyUpdate(directReplay, pgHexToBytes(row.data));
  assert.equal(
    getMetaValue(directReplay, 'B'),
    'legitimate-offline',
    'the accepted exact WAL bytes independently reconstruct offline B',
  );

  const cold = new Y.Doc();
  const coldHandle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-idb-authorized',
    supabase,
    clientId: 'cold-reader',
    enableLocal: false,
    enableRealtime: false,
    doc: cold,
  });
  assert.equal(getMetaValue(cold, 'A'), 'cloud');
  assert.equal(getMetaValue(cold, 'B'), 'legitimate-offline', 'cloud-only reopen reconstructs offline B');

  await coldHandle.destroy();
  await handle.destroy();
});

test('exact WAL bytes prevent an accepted IndexedDB edit from stale reupload after collaborator overwrite', async () => {
  const rows = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const firstDoc = new Y.Doc();
  firstDoc.clientID = 0xfffffff0;
  const first = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-exact-live-structs',
    supabase,
    clientId: 'session-one',
    enableLocal: false,
    enableRealtime: false,
    doc: firstDoc,
  });
  first.setMeta('K', 'old');
  await first.drain();
  const idbReplay = cloneDoc(firstDoc);
  await first.destroy();

  const collaboratorDoc = new Y.Doc();
  const collaborator = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-exact-live-structs',
    supabase,
    clientId: 'collaborator',
    enableLocal: false,
    enableRealtime: false,
    doc: collaboratorDoc,
  });
  collaborator.setMeta('K', 'new');
  await collaborator.drain();
  await collaborator.destroy();
  assert.equal(rows.length, 2);

  const reopened = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-exact-live-structs',
    supabase,
    clientId: 'session-one-reopen',
    enableLocal: false,
    enableRealtime: false,
    doc: idbReplay,
  });
  await reopened.drain();
  assert.equal(reopened.getMeta('K'), 'new');
  assert.equal(rows.length, 2, 'already-accepted original live structs produce no stale outbox row');

  const cold = new Y.Doc();
  for (const row of rows) Y.applyUpdate(cold, pgHexToBytes(row.data));
  assert.equal(getMetaValue(cold, 'K'), 'new', 'cold replay preserves the collaborator overwrite');

  await reopened.destroy();
});

test('42501 rollback excludes an IndexedDB-only preload from accepted truth and reopen', async () => {
  const cloud = new Y.Doc();
  setMetaValue(cloud, 'cloud', 'authoritative', 'hydrate');
  const rows = [{
    document_id: 'doc-idb-rejected',
    seq: 1,
    client_id: 'seed',
    client_seq: 1,
    data: bytesToPgHex(Y.encodeStateAsUpdate(cloud)),
  }];
  let snapshotWrites = 0;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        return { data: null, error: { code: '42501', message: 'permission revoked' } };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotWrites += 1;
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const active = new Y.Doc();
  setMetaValue(active, 'forbidden-idb-only', 'must-disappear', 'indexeddb-preload');
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-idb-rejected',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: active,
  });
  assert.equal(
    getMetaValue(active, 'forbidden-idb-only'),
    undefined,
    'open does not expose the preload before its authorization denial is resolved',
  );
  assert.equal(getMetaValue(active, 'cloud'), 'authoritative');

  await handle.drain();

  assert.equal(getMetaValue(active, 'forbidden-idb-only'), undefined, 'rollback trusts cloud, not IDB preload');
  assert.equal(getMetaValue(active, 'cloud'), 'authoritative');
  const reopened = cloneDoc(active);
  assert.equal(getMetaValue(reopened, 'forbidden-idb-only'), undefined, 'reopen cannot revive the IDB-only value');
  assert.equal(snapshotWrites, 0, 'no optimistic bytes were checkpointed before the denial');

  await handle.destroy();
});

test('an authorized recovery Y never carries later denied Z in its WAL or accepted prefix', async () => {
  const rows = [];
  let appendAttempt = 0;
  let snapshotWrites = 0;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1 || appendAttempt === 3) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotWrites += 1;
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-staged-prefix',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  handle.setMeta('X', 'rejected');
  await handle.drain();
  assert.equal(getMetaValue(doc, 'X'), undefined);

  handle.setMeta('Y', 'authorized');
  handle.setMeta('Z', 'denied');
  await handle.drain();

  assert.equal(rows.length, 1, 'only Y receives a WAL row');
  assert.equal(getMetaValue(doc, 'Y'), 'authorized');
  assert.equal(getMetaValue(doc, 'Z'), undefined, 'Z is rolled back locally');
  assert.equal(snapshotWrites, 0, 'neither denied mutation reaches a fallback snapshot');

  const cold = new Y.Doc();
  Y.applyUpdate(cold, pgHexToBytes(rows[0].data));
  assert.equal(getMetaValue(cold, 'Y'), 'authorized', 'Y is independently reconstructible');
  assert.equal(getMetaValue(cold, 'Z'), undefined, 'Y WAL bytes never smuggle later Z');

  await handle.destroy();
});

test('42501 drains skipped causal dependents and a fresh authorized edit returns idle', async () => {
  const rows = [];
  let authorized = false;
  let snapshotWrites = 0;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (!authorized) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotWrites += 1;
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') return { select: () => makeEmptyBuilder({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-cutoff-drain',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  handle.setMeta('X', 'rejected');
  handle.setMeta('Y', 'skipped-dependent');
  handle.setMeta('Z', 'skipped-dependent');
  await handle.drain();

  assert.equal(handle.getSyncStatus().queueSize, 0, 'all cutoff-skipped queue entries decrement');
  assert.equal(handle.getSyncStatus().stage, 'error');
  assert.equal(getMetaValue(doc, 'X'), undefined);
  assert.equal(getMetaValue(doc, 'Y'), undefined);
  assert.equal(getMetaValue(doc, 'Z'), undefined);
  assert.equal(snapshotWrites, 0);

  authorized = true;
  handle.setMeta('fresh', 'authorized');
  await handle.drain();
  assert.deepEqual(
    handle.getSyncStatus(),
    { healthy: true, error: null, stage: 'idle', queueSize: 0 },
  );

  await new Promise((resolve) => setTimeout(resolve, 1350));
  assert.equal(snapshotWrites, 1, 'fresh edit produces one settled debounce snapshot');
  await new Promise((resolve) => setTimeout(resolve, 1350));
  assert.equal(snapshotWrites, 1, 'no pending-accounting loop reschedules snapshots');

  await handle.destroy();
});

test('an eager transient-failure snapshot includes Y but never later denied Z', async () => {
  let appendAttempt = 0;
  const snapshots = [];
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        return appendAttempt === 1
          ? ({ data: null, error: { code: 'XX000', message: 'temporary WAL failure' } })
          : ({ data: null, error: { code: '42501', message: 'permission revoked' } });
      }
      if (name === 'store_annotation_snapshot') {
        snapshots.push(args.p_snapshot);
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') return { select: () => makeEmptyBuilder({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-eager-prefix',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  handle.setMeta('Y', 'snapshot-authorized');
  handle.setMeta('Z', 'denied');
  await handle.drain();

  assert.equal(snapshots.length, 1);
  const checkpoint = await snapshotHexToDoc(snapshots[0]);
  assert.equal(getMetaValue(checkpoint, 'Y'), 'snapshot-authorized');
  assert.equal(getMetaValue(checkpoint, 'Z'), undefined, 'Y checkpoint excludes later queued Z');
  assert.equal(getMetaValue(doc, 'Y'), 'snapshot-authorized');
  assert.equal(getMetaValue(doc, 'Z'), undefined);

  await handle.destroy();
});

test('a delayed 42501 staged-checkpoint denial rolls back a transiently failed append', async () => {
  const cloud = new Y.Doc();
  setMetaValue(cloud, 'A', 'cloud', 'hydrate');
  const rows = [{
    document_id: 'doc-checkpoint-denied',
    seq: 1,
    client_id: 'seed',
    client_seq: 1,
    data: bytesToPgHex(Y.encodeStateAsUpdate(cloud)),
  }];
  let snapshotAttempts = 0;
  let allowCleanupSnapshot = false;
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        return { data: null, error: { code: 'XX000', message: 'transient WAL outage' } };
      }
      if (name === 'store_annotation_snapshot') {
        snapshotAttempts += 1;
        if (!allowCleanupSnapshot) {
          if (snapshotAttempts === 1) {
            await new Promise((resolve) => setTimeout(resolve, 1250));
          }
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') return { select: () => makeEmptyBuilder({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-checkpoint-denied',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  handle.setMeta('B', 'must-not-survive');
  await handle.drain();

  assert.equal(snapshotAttempts, 1, 'permission denial is typed and not retried as transport failure');
  assert.equal(getMetaValue(doc, 'A'), 'cloud');
  assert.equal(getMetaValue(doc, 'B'), undefined, 'same-session state rolls back to accepted A');
  assert.equal(handle.getSyncStatus().queueSize, 0);
  assert.equal(handle.isSyncHealthy(), false);

  const cold = new Y.Doc();
  for (const row of rows) Y.applyUpdate(cold, pgHexToBytes(row.data));
  assert.equal(getMetaValue(cold, 'A'), 'cloud');
  assert.equal(getMetaValue(cold, 'B'), undefined, 'cloud-only reopen never sees denied B');

  allowCleanupSnapshot = true;
  await handle.destroy();
});

test('the 40-op accepted-prefix snapshot excludes a concurrently queued denied op', async () => {
  const rows = [];
  const snapshots = [];
  let appendAttempt = 0;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 41) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        snapshots.push(args.p_snapshot);
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') return { select: () => makeEmptyBuilder({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-forty-prefix',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  for (let index = 0; index < 39; index += 1) handle.setMeta(`pre-${index}`, index);
  await handle.drain();

  handle.setMeta('Y', 'fortieth-authorized');
  handle.setMeta('Z', 'forty-first-denied');
  await handle.drain();

  assert.equal(rows.length, 40);
  assert.equal(snapshots.length, 1, 'the automatic 40-op checkpoint ran once');
  const checkpoint = await snapshotHexToDoc(snapshots[0]);
  assert.equal(getMetaValue(checkpoint, 'Y'), 'fortieth-authorized');
  assert.equal(getMetaValue(checkpoint, 'Z'), undefined, 'accepted-prefix checkpoint excludes pending Z');
  assert.equal(getMetaValue(doc, 'Z'), undefined);

  await handle.destroy();
});

function makeGapRepairBackend(documentId) {
  const rows = [];
  const snapshots = [];
  let appendAttempt = 0;
  let snapshotMode = 'fail';
  let subscribeCallback = null;
  return {
    rows,
    snapshots,
    allowRepair() { snapshotMode = 'success'; },
    denyRepair() { snapshotMode = 'deny'; },
    fireSubscribed() { return subscribeCallback?.('SUBSCRIBED'); },
    supabase: {
      async rpc(name, args) {
        if (name === 'append_annotation_update') {
          appendAttempt += 1;
          if (snapshotMode === 'deny' && Number(args.p_client_seq) === 1) {
            return { data: null, error: { code: '42501', message: 'append denied' } };
          }
          if (appendAttempt === 1) {
            return { data: null, error: { code: 'XX000', message: 'first WAL miss' } };
          }
          const row = {
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            data: args.p_data,
            seq: rows.length + 1,
          };
          rows.push(row);
          return { data: { seq: row.seq }, error: null };
        }
        if (name === 'store_annotation_snapshot') {
          if (snapshotMode === 'deny') {
            return { data: null, error: { code: '42501', message: 'snapshot denied' } };
          }
          if (snapshotMode !== 'success') {
            return { data: null, error: { code: 'XX000', message: 'checkpoint unavailable' } };
          }
          snapshots.push(args.p_snapshot);
          return { data: true, error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
      from(table) {
        if (table === 'annotation_updates') return makeWalReadBuilder(rows);
        if (table === 'annotation_snapshots') {
          return { select: () => makeEmptyBuilder({ data: null, error: null }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
      channel: () => ({
        on() { return this; },
        subscribe(callback) { subscribeCallback = callback; return this; },
      }),
      removeChannel: async () => {},
    },
  };
}

test('scheduled staged-prefix repair returns sync health to idle', async () => {
  const backend = makeGapRepairBackend('doc-scheduled-gap-repair');
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-scheduled-gap-repair',
    supabase: backend.supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });

  handle.setMeta('A', 'missed-predecessor');
  await handle.drain();
  assert.equal(handle.isSyncHealthy(), false);

  handle.setMeta('B', 'later-wal');
  await handle.drain();
  backend.allowRepair();
  await new Promise((resolve) => setTimeout(resolve, 1350));

  assert.deepEqual(
    handle.getSyncStatus(),
    { healthy: true, error: null, stage: 'idle', queueSize: 0 },
    'debounced staged checkpoint explicitly repairs the gap',
  );
  const cold = await snapshotHexToDoc(backend.snapshots.at(-1));
  assert.equal(getMetaValue(cold, 'A'), 'missed-predecessor');
  assert.equal(getMetaValue(cold, 'B'), 'later-wal');

  await handle.destroy();
});

test('gap repair settles the missing predecessor before pumping 40 dependents', async () => {
  const backend = makeGapRepairBackend('doc-forty-gap-repair');
  let handle = null;
  try {
    handle = await openAnnotationDoc({ actorUserId: 'test-actor',
      documentId: 'doc-forty-gap-repair',
      supabase: backend.supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      doc: new Y.Doc(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 1,
    });

    handle.setMeta('A', 'missed-predecessor');
    await handle.drain();
    backend.allowRepair();
    for (let index = 0; index < 40; index += 1) {
      handle.setMeta(`later-${index}`, index);
    }
    await handle.drain();
    for (let attempt = 0; attempt < 100 && !handle.isSyncHealthy(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await handle.drain();
    }

    assert.equal(handle.isSyncHealthy(), true, 'repair then serialized replay closes the gap');
    assert.equal(
      backend.rows.length,
      41,
      'the exact A retry plus all 40 dependents append in causal order',
    );
    const cold = backend.snapshots.length
      ? await snapshotHexToDoc(backend.snapshots.at(-1))
      : new Y.Doc();
    for (const row of backend.rows) Y.applyUpdate(cold, pgHexToBytes(row.data));
    assert.equal(getMetaValue(cold, 'A'), 'missed-predecessor');
    assert.equal(getMetaValue(cold, 'later-39'), 39);
  } finally {
    backend.allowRepair();
    await handle?.destroy().catch(() => {});
  }
});

test('repaired gap pumps 40 accepted dependents but excludes the later denied mutation', async () => {
  const documentId = 'doc-forty-gap-repair-prefix';
  const rows = [];
  const snapshots = [];
  let appendAttempt = 0;
  let allowSnapshots = false;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          return { data: null, error: { code: 'XX000', message: 'first WAL miss' } };
        }
        const candidate = new Y.Doc();
        for (const row of rows) Y.applyUpdate(candidate, pgHexToBytes(row.data));
        Y.applyUpdate(candidate, pgHexToBytes(args.p_data));
        const targetsDeniedMutation = getMetaValue(candidate, 'later-40') === 40;
        candidate.destroy();
        if (targetsDeniedMutation) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        if (!allowSnapshots) {
          return { data: null, error: { code: 'XX000', message: 'checkpoint unavailable' } };
        }
        snapshots.push(args.p_snapshot);
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  let handle = null;
  try {
    handle = await openAnnotationDoc({ actorUserId: 'test-actor',
      documentId,
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      doc,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 1,
    });

    handle.setMeta('gap', 'missed-predecessor');
    await handle.drain();
    assert.equal(handle.isSyncHealthy(), false);

    allowSnapshots = true;
    for (let index = 0; index < 41; index += 1) {
      handle.setMeta(`later-${index}`, index);
    }
    await handle.drain();
    for (let attempt = 0; attempt < 100 && getMetaValue(doc, 'later-40') !== undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await handle.drain();
    }

    assert.equal(rows.length, 41);
    assert.ok(snapshots.length >= 1);
    const checkpoint = await snapshotHexToDoc(snapshots.at(-1));
    assert.equal(
      getMetaValue(checkpoint, 'later-40'),
      undefined,
      'the immutable checkpoint itself excludes the future denied edit',
    );
    for (const row of rows) Y.applyUpdate(checkpoint, pgHexToBytes(row.data));
    assert.equal(getMetaValue(checkpoint, 'gap'), 'missed-predecessor');
    assert.equal(getMetaValue(checkpoint, 'later-39'), 39);
    assert.equal(
      getMetaValue(checkpoint, 'later-40'),
      undefined,
      'no repair or compaction captures the future denied edit',
    );
    assert.equal(getMetaValue(doc, 'later-40'), undefined, 'rollback removes the denied edit');
    assert.equal(handle.isSyncHealthy(), false);
  } finally {
    allowSnapshots = true;
    await handle?.destroy().catch(() => {});
  }
});

test('reconnect gap repair excludes a pending mutation that is later denied', async () => {
  const documentId = 'doc-reconnect-gap-repair-prefix';
  const rows = [];
  const snapshots = [];
  let appendAttempt = 0;
  const liveResends = [];
  let firstAppendArgs = null;
  let allowSnapshots = false;
  let subscribeCallback = null;
  let resolveDeniedAppend;
  let markDeniedAppendEntered;
  let markSnapshotStored;
  const deniedAppendEntered = new Promise((resolve) => { markDeniedAppendEntered = resolve; });
  const snapshotStored = new Promise((resolve) => { markSnapshotStored = resolve; });
  const pendingDeniedAppend = new Promise((resolve) => { resolveDeniedAppend = resolve; });
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          firstAppendArgs = args;
          return { data: null, error: { code: 'XX000', message: 'first WAL miss' } };
        }
        if (appendAttempt === 2) {
          markDeniedAppendEntered();
          return pendingDeniedAppend;
        }
        // RULED 2026-09-24 (per-field sync task: an update only a snapshot
        // carried is re-sent through the WAL so already-open peers get it).
        if (args.p_client_seq === firstAppendArgs?.p_client_seq) {
          liveResends.push(args);
          return { data: [{ seq: 1 }], error: null };
        }
        throw new Error(`unexpected append attempt ${appendAttempt}`);
      }
      if (name === 'store_annotation_snapshot') {
        if (!allowSnapshots) {
          return { data: null, error: { code: 'XX000', message: 'checkpoint unavailable' } };
        }
        snapshots.push(args.p_snapshot);
        markSnapshotStored();
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on() { return this; },
      subscribe(callback) { subscribeCallback = callback; return this; },
    }),
    removeChannel: async () => {},
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: true,
    doc,
  });

  handle.setMeta('gap', 'missed-predecessor');
  await handle.drain();
  assert.equal(handle.isSyncHealthy(), false);

  allowSnapshots = true;
  handle.setMeta('denied', 'must-not-survive');
  await deniedAppendEntered;
  subscribeCallback?.('SUBSCRIBED');
  await snapshotStored;

  assert.equal(snapshots.length, 1);
  const checkpoint = await snapshotHexToDoc(snapshots[0]);
  resolveDeniedAppend({
    data: null,
    error: { code: '42501', message: 'permission revoked' },
  });
  await handle.drain();

  assert.equal(getMetaValue(checkpoint, 'gap'), 'missed-predecessor');
  assert.equal(
    getMetaValue(checkpoint, 'denied'),
    undefined,
    'reconnect repair excludes the still-pending authorization result',
  );
  // RULED 2026-09-24 (per-field sync task): the third submission is the live
  // re-send of the snapshot-covered 'gap' update — exact bytes, same writer
  // and sequence — never the denied one.
  assert.equal(appendAttempt, 3);
  assert.equal(liveResends.length, 1);
  assert.equal(liveResends[0].p_client_id, firstAppendArgs.p_client_id);
  assert.equal(liveResends[0].p_data, firstAppendArgs.p_data);
  assert.equal(getMetaValue(doc, 'gap'), 'missed-predecessor');
  assert.equal(getMetaValue(doc, 'denied'), undefined);
  assert.equal(handle.isSyncHealthy(), false);

  allowSnapshots = false;
  await handle.destroy();
});

test('a cold reopen after permission rollback emits reconstructible authorized WAL bytes', async () => {
  const documentId = 'doc-denial-cold-lineage';
  const rows = [];
  let denyWrites = true;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (denyWrites) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return denyWrites
          ? ({ data: null, error: { code: '42501', message: 'permission revoked' } })
          : ({ data: true, error: null });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const firstDoc = new Y.Doc();
  const first = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: firstDoc,
  });
  first.setMeta('K', 'forbidden');
  await first.drain();
  assert.equal(getMetaValue(firstDoc, 'K'), undefined);
  const rolledBackBytes = Y.encodeStateAsUpdate(firstDoc);
  await first.destroy();

  denyWrites = false;
  const reopenedDoc = new Y.Doc();
  Y.applyUpdate(reopenedDoc, rolledBackBytes);
  const reopened = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: reopenedDoc,
  });
  reopened.setMeta('K', 'authorized');
  await reopened.drain();

  assert.equal(rows.length, 1);
  assert.equal(getMetaValue(reopenedDoc, 'K'), 'authorized');
  const cloudOnly = new Y.Doc();
  Y.applyUpdate(cloudOnly, pgHexToBytes(rows[0].data));
  assert.equal(
    getMetaValue(cloudOnly, 'K'),
    'authorized',
    'the authorized WAL update has no dependency on rejected local structs',
  );

  await reopened.destroy();
});

test('quarantined rejected history cannot stale-overwrite a later collaborator value', async () => {
  const documentId = 'doc-rejected-history-quarantine';
  const rows = [];
  let denyWrites = false;
  const baseDoc = new Y.Doc();
  setMetaValue(baseDoc, 'K', 'base', 'seed');
  rows.push({
    document_id: documentId,
    client_id: 'seed',
    client_seq: 1,
    data: bytesToPgHex(Y.encodeStateAsUpdate(baseDoc)),
    seq: 1,
  });
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (denyWrites) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  denyWrites = true;
  const rejectedDoc = new Y.Doc();
  rejectedDoc.clientID = 0xffffffff - 1;
  const first = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: rejectedDoc,
  });
  first.setMeta('K', 'forbidden');
  await first.drain();
  assert.equal(getMetaValue(rejectedDoc, 'K'), 'base');
  const rejectedHistory = Y.encodeStateAsUpdate(rejectedDoc);
  await first.destroy();

  const collaborator = new Y.Doc();
  for (const row of rows) Y.applyUpdate(collaborator, pgHexToBytes(row.data));
  let collaboratorUpdate = null;
  collaborator.on('update', (update) => { collaboratorUpdate = update; });
  setMetaValue(collaborator, 'K', 'collaborator-new', 'remote');
  rows.push({
    document_id: documentId,
    client_id: 'collaborator',
    client_seq: 1,
    data: bytesToPgHex(collaboratorUpdate),
    seq: rows.length + 1,
  });
  const rowsBeforeReopen = rows.length;

  denyWrites = false;
  const reopenedDoc = new Y.Doc();
  Y.applyUpdate(reopenedDoc, rejectedHistory);
  const reopened = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: reopenedDoc,
  });

  assert.equal(getMetaValue(reopenedDoc, 'K'), 'collaborator-new');
  assert.equal(rows.length, rowsBeforeReopen, 'quarantined structs emit no stale outbox WAL');
  await reopened.destroy();
});

test('shipped actorless IndexedDB recovers only matching-author entries and never crosses accounts', async () => {
  const documentId = 'doc-legacy-actor-isolation';
  const rows = [];
  let legacyCleared = false;
  const legacySeed = new Y.Doc();
  seedMark(legacySeed, 'legacy-a', {
    p: 1,
    o: {
      type: 'rect',
      left: 17,
      data: { id: 'legacy-a', authorId: 'actor-a' },
    },
  });
  const legacyFactory = async (name, target) => {
    assert.equal(name, `anno-${documentId}`);
    if (!legacyCleared) Y.applyUpdate(target, Y.encodeStateAsUpdate(legacySeed));
    return {
      synced: true,
      destroy() {},
      async clearDocument() { legacyCleared = true; },
    };
  };
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        const row = {
          document_id: documentId,
          seq: rows.length + 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'actor-a',
          data: args.p_data,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const actorBDoc = new Y.Doc();
  const actorB = await openAnnotationDoc({
    actorUserId: 'actor-b',
    documentId,
    supabase,
    clientId: 'writer-b',
    enableLocal: false,
    enableRealtime: false,
    doc: actorBDoc,
    legacyPersistenceFactory: legacyFactory,
  });
  assert.deepEqual(docToByPage(actorBDoc), {});
  assert.equal(rows.length, 0, 'account B cannot re-author account A legacy bytes');
  assert.equal(actorB.getLegacyRecoveryStatus().pending, true);
  assert.equal(legacyCleared, false);
  await actorB.destroy();

  const actorADoc = new Y.Doc();
  const actorA = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: actorADoc,
    legacyPersistenceFactory: legacyFactory,
  });
  assert.equal(docToByPage(actorADoc)[1].objects[0].left, 17);
  assert.equal(rows.length, 1, 'matching author recovers exactly once');
  assert.equal(actorA.getLegacyRecoveryStatus().pending, false);
  assert.equal(legacyCleared, true, 'fully disposed legacy storage retires only after acceptance');
  await actorA.destroy();

  const reopenedDoc = new Y.Doc();
  const reopened = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: 'writer-a-cold',
    enableLocal: false,
    enableRealtime: false,
    doc: reopenedDoc,
    legacyPersistenceFactory: legacyFactory,
  });
  assert.equal(docToByPage(reopenedDoc)[1].objects[0].left, 17);
  assert.equal(rows.length, 1, 'retired legacy data is not imported twice');
  await reopened.destroy();
  legacySeed.destroy();
});

test('actorless legacy deletion stays quarantined because the deleting account is unknowable', async () => {
  const documentId = 'doc-legacy-owned-delete';
  const cloud = new Y.Doc();
  seedMark(cloud, 'owned', {
    p: 1,
    o: {
      type: 'rect',
      left: 31,
      data: { id: 'owned', authorId: 'actor-a' },
    },
  });
  const cloudUpdate = Y.encodeStateAsUpdate(cloud);
  const rows = [{
    document_id: documentId,
    seq: 1,
    client_id: 'cloud-writer',
    client_seq: 1,
    actor_user_id: 'actor-a',
    data: bytesToPgHex(cloudUpdate),
  }];
  const legacy = new Y.Doc();
  Y.applyUpdate(legacy, cloudUpdate);
  getAnnotationsMap(legacy).delete('owned');
  let cleared = false;
  const legacyFactory = async (_name, target) => {
    if (!cleared) Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
    return {
      synced: true,
      destroy() {},
      async clearDocument() { cleared = true; },
    };
  };
  const supabase = makeLegacyRecoveryBackend(documentId, rows);

  const recoveredDoc = new Y.Doc();
  const recovered = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: 'legacy-delete',
    writerId: 'legacy-delete-open',
    enableLocal: false,
    enableRealtime: false,
    doc: recoveredDoc,
    legacyPersistenceFactory: legacyFactory,
  });
  assert.equal(
    docToByPage(recoveredDoc)[1].objects[0].left,
    31,
    'cloud truth remains visible until the unprovable legacy delete is explicitly recovered',
  );
  assert.equal(rows.length, 1, 'opening account cannot re-author an actorless tombstone');
  assert.deepEqual(recovered.getLegacyRecoveryStatus(), {
    pending: true,
    unresolvedEntries: 1,
  });
  assert.equal(cleared, false, 'unresolved tombstone storage remains available for explicit recovery');
  await recovered.destroy();
  cloud.destroy();
  legacy.destroy();
});

test('a permission-rejected legacy recovery never auto-resubmits on a later open', async () => {
  const documentId = 'doc-legacy-rejected-reopen';
  const rows = [];
  let denyWrites = true;
  let cleared = false;
  const legacy = new Y.Doc();
  seedMark(legacy, 'rejected-owned', {
    p: 1,
    o: {
      type: 'rect',
      left: 37,
      data: { id: 'rejected-owned', authorId: 'actor-a' },
    },
  });
  const outbox = createMemoryAnnotationOutbox();
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (denyWrites) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: documentId,
          seq: rows.length + 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'actor-a',
          data: args.p_data,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const legacyFactory = async (_name, target) => {
    if (!cleared) Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
    return {
      synced: true,
      destroy() {},
      async clearDocument() { cleared = true; },
    };
  };
  const open = (writerId) => openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: writerId,
    writerId,
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore: outbox,
    snapshotRetryDelayMs: 0,
    legacyPersistenceFactory: legacyFactory,
  });

  const first = await open('legacy-rejected-1');
  assert.deepEqual(first.getByPage(), {});
  assert.equal(rows.length, 0);
  assert.equal((await outbox.listQuarantined(documentId, 'actor-a')).length, 1);
  assert.equal(cleared, false);
  await first.destroy();

  denyWrites = false;
  const second = await open('legacy-rejected-2');
  assert.deepEqual(second.getByPage(), {}, 'quarantined bytes stay hidden after access returns');
  assert.equal(rows.length, 0, 'reopen does not silently resubmit a rejected recovery');
  assert.equal((await outbox.listQuarantined(documentId, 'actor-a')).length, 1);
  assert.deepEqual(second.getLegacyRecoveryStatus(), {
    pending: true,
    unresolvedEntries: 1,
  });
  assert.equal(cleared, false, 'explicit recovery remains possible');
  await second.destroy();
  legacy.destroy();
});

test('offline legacy recovery transitioning to 42501 quarantines only one semantic update', async () => {
  const documentId = 'doc-legacy-offline-then-denied';
  const rows = [];
  let mode = 'offline';
  let appendAttempts = 0;
  const legacy = new Y.Doc();
  seedMark(legacy, 'offline-then-denied', {
    p: 1,
    o: {
      type: 'rect',
      left: 48,
      data: { id: 'offline-then-denied', authorId: 'actor-a' },
    },
  });
  const outbox = createMemoryAnnotationOutbox();
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        if (mode === 'offline') {
          return { data: null, error: { code: 'XX000', message: 'offline' } };
        }
        if (mode === 'denied') {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        const row = {
          document_id: documentId,
          seq: rows.length + 1,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'actor-a',
          data: args.p_data,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        if (mode === 'offline') {
          return { data: null, error: { code: 'XX000', message: 'offline' } };
        }
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const legacyFactory = async (_name, target) => {
    Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
    return {
      synced: true,
      destroy() {},
      async clearDocument() {},
    };
  };
  const open = (writerId) => openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: writerId,
    writerId,
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore: outbox,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    legacyPersistenceFactory: legacyFactory,
  });

  const first = await open('legacy-transition-1');
  assert.equal(appendAttempts, 1);
  assert.equal((await outbox.list(documentId, 'actor-a')).length, 1);
  await first.destroy();

  mode = 'denied';
  const attemptsBeforeReopen = appendAttempts;
  const second = await open('legacy-transition-2');
  assert.equal(
    appendAttempts,
    attemptsBeforeReopen + 1,
    'the replay denial must suppress a second same-open legacy enqueue',
  );
  assert.equal((await outbox.list(documentId, 'actor-a')).length, 0);
  assert.equal((await outbox.listQuarantined(documentId, 'actor-a')).length, 1);
  assert.deepEqual(second.getByPage(), {});
  assert.deepEqual(second.getLegacyRecoveryStatus(), {
    pending: true,
    unresolvedEntries: 1,
  });
  await second.destroy();
  legacy.destroy();
});

test('repeated offline legacy opens keep one bounded pending recovery', async () => {
  const documentId = 'doc-legacy-offline-dedupe';
  const rows = [];
  const legacy = new Y.Doc();
  seedMark(legacy, 'offline-owned', {
    p: 1,
    o: {
      type: 'rect',
      left: 42,
      data: { id: 'offline-owned', authorId: 'actor-a' },
    },
  });
  const outbox = createMemoryAnnotationOutbox();
  const supabase = makeLegacyRecoveryBackend(documentId, rows, { offline: true });
  const legacyFactory = async (_name, target) => {
    Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
    return {
      synced: true,
      destroy() {},
      async clearDocument() {},
    };
  };
  const openOffline = (writerId) => openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: writerId,
    writerId,
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore: outbox,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    legacyPersistenceFactory: legacyFactory,
  });

  const first = await openOffline('legacy-offline-open-1');
  assert.equal((await outbox.list(documentId, 'actor-a')).length, 1);
  assert.deepEqual(first.getByPage(), {}, 'unaccepted legacy bytes remain hidden');
  await first.destroy();

  const second = await openOffline('legacy-offline-open-2');
  assert.equal(
    (await outbox.list(documentId, 'actor-a')).length,
    1,
    'a cold reopen reuses semantic pending coverage instead of adding another record',
  );
  assert.deepEqual(second.getByPage(), {});
  assert.equal(second.getLegacyRecoveryStatus().pending, true);
  await second.destroy();
  legacy.destroy();
});

test('cloud-identical collaborator annotations and metadata retire without reauthoring', async () => {
  const documentId = 'doc-legacy-identical-retirement';
  const cloud = new Y.Doc();
  seedMark(cloud, 'collaborator', {
    p: 1,
    o: {
      type: 'circle',
      left: 64,
      data: { id: 'collaborator', authorId: 'actor-b' },
    },
  });
  cloud.getMap('annoMeta').set('shared-setting', { enabled: true });
  const cloudUpdate = Y.encodeStateAsUpdate(cloud);
  const rows = [{
    document_id: documentId,
    seq: 1,
    client_id: 'cloud-writer',
    client_seq: 1,
    actor_user_id: 'actor-b',
    data: bytesToPgHex(cloudUpdate),
  }];
  const legacy = new Y.Doc();
  Y.applyUpdate(legacy, cloudUpdate);
  let cleared = false;
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase: makeLegacyRecoveryBackend(documentId, rows),
    clientId: 'legacy-identical',
    writerId: 'legacy-identical-open',
    enableLocal: false,
    enableRealtime: false,
    doc,
    legacyPersistenceFactory: async (_name, target) => {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
      return {
        synced: true,
        destroy() {},
        async clearDocument() { cleared = true; },
      };
    },
  });
  assert.equal(docToByPage(doc)[1].objects[0].left, 64);
  assert.deepEqual(getMetaValue(doc, 'shared-setting'), { enabled: true });
  assert.equal(rows.length, 1, 'identical collaborator bytes emit no actor-a WAL');
  assert.deepEqual(handle.getLegacyRecoveryStatus(), {
    pending: false,
    unresolvedEntries: 0,
  });
  assert.equal(cleared, true, 'semantically covered legacy storage is safe to retire');
  await handle.destroy();
  cloud.destroy();
  legacy.destroy();
});

test('missing-author and same-key legacy conflicts remain detached and quarantined', async () => {
  const documentId = 'doc-legacy-quarantine';
  const rows = [];
  const cloud = new Y.Doc();
  seedMark(cloud, 'conflict', {
    p: 1,
    o: {
      type: 'rect',
      left: 50,
      data: { id: 'conflict', authorId: 'actor-a' },
    },
  });
  rows.push({
    document_id: documentId,
    seq: 1,
    client_id: 'cloud-writer',
    client_seq: 1,
    actor_user_id: 'actor-a',
    data: bytesToPgHex(Y.encodeStateAsUpdate(cloud)),
  });
  const legacy = new Y.Doc();
  seedMark(legacy, 'conflict', {
    p: 1,
    o: {
      type: 'rect',
      left: 5,
      data: { id: 'conflict', authorId: 'actor-a' },
    },
  });
  seedMark(legacy, 'missing-author', {
    p: 1,
    o: { type: 'circle', left: 9, data: { id: 'missing-author' } },
  });
  let cleared = false;
  const supabase = {
    async rpc(name) {
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId,
    supabase,
    clientId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc,
    legacyPersistenceFactory: async (_name, target) => {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(legacy));
      return {
        synced: true,
        destroy() {},
        async clearDocument() { cleared = true; },
      };
    },
  });
  const materialized = docToByPage(doc);
  assert.deepEqual(
    materialized[1].objects.map((object) => [object.data.id, object.left]),
    [['conflict', 50]],
  );
  assert.deepEqual(
    handle.getLegacyRecoveryStatus(),
    { pending: true, unresolvedEntries: 2 },
  );
  assert.equal(rows.length, 1, 'quarantined entries emit no WAL');
  assert.equal(cleared, false, 'unresolved legacy storage remains recoverable');
  await handle.destroy();
  cloud.destroy();
  legacy.destroy();
});

test('failed or timed-out legacy recovery stays hidden and leaves shipped storage untouched', async () => {
  const makeLegacySeed = () => {
    const legacy = new Y.Doc();
    seedMark(legacy, 'offline-a', {
      p: 1,
      o: {
        type: 'rect',
        left: 23,
        data: { id: 'offline-a', authorId: 'actor-a' },
      },
    });
    return legacy;
  };

  const failedLegacy = makeLegacySeed();
  let failedClear = false;
  let appendAttempts = 0;
  const failingSupabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        appendAttempts += 1;
        return { data: null, error: { code: 'XX000', message: 'offline' } };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: null, error: { code: 'XX000', message: 'offline' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const failedDoc = new Y.Doc();
  const failed = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId: 'doc-legacy-failed-recovery',
    supabase: failingSupabase,
    clientId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: failedDoc,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    legacyPersistenceFactory: async (_name, target) => {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(failedLegacy));
      return {
        synced: true,
        destroy() {},
        async clearDocument() { failedClear = true; },
      };
    },
  });
  assert.equal(appendAttempts, 1);
  assert.deepEqual(docToByPage(failedDoc), {}, 'unaccepted legacy bytes never become visible');
  assert.equal(failedClear, false);
  assert.equal(failed.getLegacyRecoveryStatus().pending, true);
  await failed.destroy();
  failedLegacy.destroy();

  const timedLegacy = makeLegacySeed();
  let timedClear = false;
  const timedDoc = new Y.Doc();
  const timed = await openAnnotationDoc({
    actorUserId: 'actor-a',
    documentId: 'doc-legacy-timeout',
    supabase: {
      from(table) {
        if (table === 'annotation_updates') return makeWalReadBuilder([]);
        if (table === 'annotation_snapshots') {
          return { select: () => makeEmptyBuilder({ data: null, error: null }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
    clientId: 'writer-a',
    enableLocal: false,
    enableRealtime: false,
    doc: timedDoc,
    localSyncTimeoutMs: 5,
    legacyPersistenceFactory: async () => ({
      synced: false,
      once() {},
      destroy() {},
      async clearDocument() { timedClear = true; },
    }),
  });
  assert.deepEqual(docToByPage(timedDoc), {});
  assert.equal(timedClear, false);
  assert.equal(timed.getLegacyRecoveryStatus().pending, true);
  await timed.destroy();
  timedLegacy.destroy();
});

test('a timed-out local persistence load cannot replay into the exposed document later', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  let persistenceDoc = null;
  let syncCallback = null;
  let destroyed = false;
  try {
    const doc = new Y.Doc();
    const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
      documentId: 'doc-late-local-replay',
      supabase: null,
      clientId: 'writer',
      enableLocal: true,
      enableRealtime: false,
      doc,
      localSyncTimeoutMs: 5,
      localPersistenceFactory: async (_name, providerDoc) => {
        persistenceDoc = providerDoc;
        return {
          synced: false,
          once(_event, callback) { syncCallback = callback; },
          destroy() { destroyed = true; },
        };
      },
    });

    assert.ok(persistenceDoc);
    assert.equal(destroyed, true, 'timed-out provider is detached before the handle is exposed');
    setMetaValue(persistenceDoc, 'late', 'must-not-enter-live', 'late-idb');
    syncCallback?.();
    assert.equal(handle.getMeta('late'), undefined);

    await handle.destroy();
  } finally {
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('never-settling append and snapshot transports do not hold drain forever', async () => {
  const rows = [];
  let releaseTransport = false;
  let resolveAppend;
  const pendingAppend = new Promise((resolve) => { resolveAppend = resolve; });
  const neverSnapshot = new Promise(() => {});
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') return pendingAppend;
      if (name === 'store_annotation_snapshot') {
        return releaseTransport
          ? ({ data: true, error: null })
          : neverSnapshot;
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-bounded-transport',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
    requestTimeoutMs: 10,
    snapshotRetryDelayMs: 0,
  });

  handle.setMeta('offline', 'outbox');
  const drainPromise = handle.drain();
  const settledBeforeRelease = await Promise.race([
    drainPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  const boundedStatus = handle.getSyncStatus();

  releaseTransport = true;
  resolveAppend({ data: null, error: { code: 'XX000', message: 'offline' } });
  await drainPromise;
  await handle.destroy();

  assert.equal(settledBeforeRelease, true);
  assert.equal(
    boundedStatus.queueSize,
    1,
    'timed-out exact append remains durable and ambiguous until a positive receipt',
  );
  assert.equal(boundedStatus.healthy, false);
  assert.equal(getMetaValue(doc, 'offline'), 'outbox');
});

test('an ambiguous timed-out append is reconciled before snapshot denial rollback', async () => {
  const documentId = 'doc-ambiguous-append';
  const rows = [];
  let appendAttempt = 0;
  const neverRespond = new Promise(() => {});
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          rows.push({
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: 'test-actor',
            data: args.p_data,
            seq: 1,
          });
          return neverRespond;
        }
        if (
          appendAttempt === 2
          && args.p_client_id === rows[0].client_id
          && args.p_client_seq === rows[0].client_seq
          && args.p_data === rows[0].data
        ) {
          return { data: { seq: 1 }, error: null };
        }
        return { data: null, error: { code: '42501', message: 'permission revoked' } };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: null, error: { code: '42501', message: 'permission revoked' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  let handle = null;
  let unsubscribeHistoryQuarantine = null;
  const historyQuarantineEvents = [];
  try {
    handle = await openAnnotationDoc({ actorUserId: 'test-actor',
      documentId,
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      doc,
      requestTimeoutMs: 10,
      snapshotRetryDelayMs: 0,
    });
    const generationBefore = handle.getHistoryQuarantineGeneration();
    unsubscribeHistoryQuarantine = handle.onHistoryQuarantine(
      (event) => historyQuarantineEvents.push(event),
    );

    handle.setMeta('K', 'must-remain');
    await handle.drain();
    assert.equal(getMetaValue(doc, 'K'), 'must-remain');
    assert.equal(handle.getHistoryQuarantineGeneration(), generationBefore);
    assert.equal(
      historyQuarantineEvents.length,
      0,
      'an exact accepted replay must not invalidate accepted history',
    );

    handle.setMeta('denied', 'must-not-survive');
    await handle.drain();
    assert.equal(getMetaValue(doc, 'K'), 'must-remain');
    assert.equal(getMetaValue(doc, 'denied'), undefined);

    const cold = new Y.Doc();
    for (const row of rows) Y.applyUpdate(cold, pgHexToBytes(row.data));
    assert.equal(getMetaValue(cold, 'K'), 'must-remain');
    assert.equal(getMetaValue(cold, 'denied'), undefined);
    assert.equal(handle.isSyncHealthy(), false);
  } finally {
    unsubscribeHistoryQuarantine?.();
    await handle?.destroy().catch(() => {});
  }
});

test('ambiguous replay collision restores accepted truth and emits exact integrity quarantine', async () => {
  const documentId = 'doc-ambiguous-append-collision';
  const outbox = createMemoryAnnotationOutbox();
  let appendAttempt = 0;
  const neverRespond = new Promise(() => {});
  const supabase = {
    async rpc(name) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) return neverRespond;
        return {
          data: null,
          error: { code: '23505', message: 'idempotency key reused with different bytes' },
        };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: null, error: { code: '42501', message: 'permission revoked' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    writerId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc,
    requestTimeoutMs: 10,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 1,
  });
  const events = [];
  const unsubscribe = handle.onHistoryQuarantine((event) => events.push(event));
  try {
    setMetaValue(doc, 'denied', 'must-not-survive', {
      source: 'erase-local',
      historyTag: {
        historyKind: 'erase-commit',
        mutationId: 'ambiguous-collision-erase',
      },
    });
    await handle.drain();

    assert.equal(getMetaValue(doc, 'denied'), undefined);
    assert.equal(handle.getSyncStatus().queueSize, 1);
    assert.match(handle.getSyncStatus().error, /collision/i);
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'wal-integrity-collision');
    assert.equal(events[0].code, '23505');
    assert.deepEqual(events[0].mutationIds, ['ambiguous-collision-erase']);
    assert.equal(events[0].requiresFullHistoryReset, false);
    assert.deepEqual(
      (await outbox.list(documentId, 'test-actor')).map((record) => record.status),
      ['integrity-error'],
    );
  } finally {
    unsubscribe();
    await handle.destroy().catch(() => {});
  }
});

test('ambiguous replay transient failure schedules bounded exact reconciliation', async () => {
  const documentId = 'doc-ambiguous-replay-transient';
  const rows = [];
  let appendAttempt = 0;
  const neverRespond = new Promise(() => {});
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) return neverRespond;
        if (appendAttempt === 2) {
          return { data: null, error: { code: 'XX000', message: 'temporary replay outage' } };
        }
        rows.push({
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'test-actor',
          data: args.p_data,
          seq: 1,
        });
        return { data: { seq: 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: null, error: { code: '42501', message: 'snapshot permission revoked' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    writerId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
    requestTimeoutMs: 10,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 1,
  });
  const events = [];
  const unsubscribe = handle.onHistoryQuarantine((event) => events.push(event));
  try {
    setMetaValue(doc, 'pending', 'eventually-accepted', {
      source: 'erase-local',
      historyTag: {
        historyKind: 'erase-commit',
        mutationId: 'ambiguous-transient-erase',
      },
    });
    await handle.drain();

    for (let attempt = 0; attempt < 30 && handle.getSyncStatus().queueSize > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await handle.drain();
    }

    assert.ok(appendAttempt >= 3, 'a bounded retry replays the exact idempotency key');
    assert.equal(handle.getSyncStatus().queueSize, 0);
    assert.equal(getMetaValue(doc, 'pending'), 'eventually-accepted');
    assert.equal(events.length, 0, 'an accepted exact replay does not invalidate history');
    assert.equal(rows.length, 1);
  } finally {
    unsubscribe();
    await handle.destroy().catch(() => {});
  }
});

test('unresolved ambiguity retains every queued dependent until bounded recovery', async () => {
  const documentId = 'doc-ambiguous-prefix-retains-dependents';
  const outbox = createMemoryAnnotationOutbox();
  const rows = [];
  let appendAttempt = 0;
  let sequence = 0;
  let allowRecovery = false;
  const neverRespond = new Promise(() => {});
  const appendAcceptedRow = (args) => {
    const existing = rows.find((row) => (
      row.client_id === args.p_client_id
      && row.client_seq === args.p_client_seq
    ));
    if (existing) return existing;
    const row = {
      document_id: documentId,
      client_id: args.p_client_id,
      client_seq: args.p_client_seq,
      actor_user_id: 'test-actor',
      data: args.p_data,
      seq: ++sequence,
    };
    rows.push(row);
    return row;
  };
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) return neverRespond;
        if (appendAttempt === 2) {
          return { data: null, error: { code: 'XX000', message: 'temporary replay outage' } };
        }
        if (!allowRecovery) {
          return { data: null, error: { code: 'XX000', message: 'recovery not enabled' } };
        }
        const row = appendAcceptedRow(args);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return allowRecovery
          ? ({ data: { accepted: true }, error: null })
          : ({ data: null, error: { code: '42501', message: 'snapshot permission revoked' } });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    writerId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc,
    requestTimeoutMs: 50,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 100,
  });
  try {
    setMetaValue(doc, 'A', 'a', {
      source: 'erase-local',
      historyTag: { historyKind: 'erase-commit', mutationId: 'erase-A' },
    });
    setMetaValue(doc, 'B', 'b', {
      source: 'erase-local',
      historyTag: { historyKind: 'erase-commit', mutationId: 'erase-B' },
    });

    for (let attempt = 0; attempt < 100 && appendAttempt < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(appendAttempt, 2, 'dependent B cannot overtake unresolved A');
    assert.equal(getMetaValue(doc, 'A'), 'a');
    assert.equal(getMetaValue(doc, 'B'), 'b');
    assert.equal(handle.getSyncStatus().queueSize, 2);
    const pendingRecords = await outbox.list(documentId, 'test-actor');
    assert.deepEqual(pendingRecords.map((record) => record.clientSeq), [1, 2]);
    assert.deepEqual(
      pendingRecords.map((record) => record.status),
      ['ambiguous', 'pending'],
      'the unresolved prefix retains both exact durable records',
    );

    allowRecovery = true;
    for (let attempt = 0; attempt < 60 && handle.getSyncStatus().queueSize > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await handle.drain();
    }
    assert.equal(handle.getSyncStatus().queueSize, 0);
    const cold = new Y.Doc();
    for (const row of [...rows].sort((left, right) => left.seq - right.seq)) {
      Y.applyUpdate(cold, pgHexToBytes(row.data));
    }
    assert.equal(getMetaValue(cold, 'A'), 'a');
    assert.equal(getMetaValue(cold, 'B'), 'b');
    cold.destroy();
  } finally {
    await handle.destroy().catch(() => {});
  }
});

test('accepted ambiguous A preserves its history while pending B is exactly quarantined', async () => {
  const documentId = 'doc-ambiguous-accepted-a-denied-b';
  const outbox = createMemoryAnnotationOutbox();
  const rows = [];
  let appendAttempt = 0;
  const neverRespond = new Promise(() => {});
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) return neverRespond;
        if (appendAttempt === 2) {
          rows.push({
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: 'test-actor',
            data: args.p_data,
            seq: 1,
          });
          return { data: { seq: 1 }, error: null };
        }
        throw new Error('pending B must be closed before WAL submission');
      }
      if (name === 'store_annotation_snapshot') {
        return { data: null, error: { code: '42501', message: 'snapshot permission revoked' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    writerId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: outbox,
    doc,
    requestTimeoutMs: 10,
    snapshotRetryDelayMs: 0,
  });
  const events = [];
  const unsubscribe = handle.onHistoryQuarantine((event) => events.push(event));
  try {
    setMetaValue(doc, 'A', 'accepted', {
      source: 'erase-local',
      historyTag: { historyKind: 'erase-commit', mutationId: 'erase-A' },
    });
    setMetaValue(doc, 'B', 'denied', {
      source: 'erase-local',
      historyTag: { historyKind: 'erase-commit', mutationId: 'erase-B' },
    });
    await handle.drain();

    assert.equal(appendAttempt, 2);
    assert.equal(getMetaValue(doc, 'A'), 'accepted');
    assert.equal(getMetaValue(doc, 'B'), undefined);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].mutationIds, ['erase-B']);
    assert.equal(events[0].requiresFullHistoryReset, false);
    assert.equal(handle.getHistoryQuarantineGeneration(), 1);
    const cold = new Y.Doc();
    Y.applyUpdate(cold, pgHexToBytes(rows[0].data));
    assert.equal(getMetaValue(cold, 'A'), 'accepted');
    assert.equal(getMetaValue(cold, 'B'), undefined);
    cold.destroy();
  } finally {
    unsubscribe();
    await handle.destroy().catch(() => {});
  }
});

test('a non-durable rebase no-op never hides an earlier pending WAL mutation', async () => {
  const documentId = 'doc-rebase-noop-preserves-pending';
  const rows = [];
  let appendAttempt = 0;
  let releasePendingAppend;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          return { data: null, error: { code: '42501', message: 'permission revoked' } };
        }
        if (appendAttempt === 2) {
          return new Promise((resolve) => {
            releasePendingAppend = () => {
              rows.push({
                document_id: documentId,
                client_id: args.p_client_id,
                client_seq: args.p_client_seq,
                actor_user_id: 'test-actor',
                data: args.p_data,
                seq: 1,
              });
              resolve({ data: { seq: 1 }, error: null });
            };
          });
        }
        return { data: { seq: rows.length || 1 }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor',
    documentId,
    supabase,
    clientId: 'writer',
    writerId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  const events = [];
  const unsubscribe = handle.onHistoryQuarantine((event) => events.push(event));
  try {
    handle.setMeta('denied-seed', 'x');
    await handle.drain();
    assert.equal(events.length, 1, 'first denial establishes rebased staging');

    handle.setMeta('pending', 'value');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(typeof releasePendingAppend, 'function');
    assert.equal(handle.getMeta('pending'), 'value');
    assert.equal(handle.getSyncStatus().queueSize, 1);

    doc.transact(() => {
      doc.getMap('nondurable').set('x', 1);
    }, {
      source: 'audit',
      historyTag: {
        historyKind: 'erase-commit',
        mutationId: 'tagged-stage-noop',
      },
    });

    assert.equal(handle.getMeta('pending'), 'value');
    assert.equal(handle.getSyncStatus().queueSize, 1);
    assert.equal(events.length, 1, 'non-durable no-op emits no rollback event');

    releasePendingAppend();
    await handle.drain();
    assert.equal(handle.getMeta('pending'), 'value');
    assert.equal(handle.getSyncStatus().queueSize, 0);
  } finally {
    unsubscribe();
    await handle.destroy().catch(() => {});
  }
});

test('snapshot read errors abort open instead of accepting an empty document', async () => {
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({
            data: null,
            error: { code: 'XX000', message: 'snapshot read unavailable' },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  await assert.rejects(
    openAnnotationDoc({ actorUserId: 'test-actor',
      documentId: 'doc-snapshot-read-error',
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      doc: new Y.Doc(),
    }),
    /snapshot read unavailable/,
  );
});

test('corrupted snapshot bytes abort open instead of accepting an incomplete document', async () => {
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder([]);
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({
            data: {
              snapshot: '\\x00010203',
              at_seq: 0,
              encoding_version: 2,
              writer_id: 'writer',
              writer_epoch: 1,
            },
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  await assert.rejects(
    openAnnotationDoc({ actorUserId: 'test-actor',
      documentId: 'doc-corrupt-snapshot',
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: false,
      doc: new Y.Doc(),
    }),
    /snapshot decode failed/i,
  );
});

test('a failed eager checkpoint repairs autonomously after HTTP recovery', async () => {
  const backend = makeGapRepairBackend('doc-autonomous-gap-repair');
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-autonomous-gap-repair',
    supabase: backend.supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 10,
  });

  handle.setMeta('A', 'missed-predecessor');
  await handle.drain();
  assert.equal(handle.isSyncHealthy(), false);
  backend.allowRepair();

  for (let attempt = 0; attempt < 50 && !handle.isSyncHealthy(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(
    handle.getSyncStatus(),
    { healthy: true, error: null, stage: 'idle', queueSize: 0 },
  );
  assert.ok(
    backend.rows.length > 0 || backend.snapshots.length > 0,
    'autonomous recovery durably records the missing predecessor',
  );
  const cold = backend.snapshots.length
    ? await snapshotHexToDoc(backend.snapshots.at(-1))
    : new Y.Doc();
  for (const row of backend.rows) Y.applyUpdate(cold, pgHexToBytes(row.data));
  assert.equal(getMetaValue(cold, 'A'), 'missed-predecessor');

  await handle.destroy();
});

test('a CAS gap repair cannot let a later dependent overtake its predecessor', async () => {
  const documentId = 'doc-gap-generation-cas';
  const rows = [];
  const acceptedSnapshots = [];
  let appendAttempt = 0;
  let storeAttempt = 0;
  let snapshotRead = 0;
  let subscribeCallback = null;
  let markRefreshPaused;
  let resumeRefresh;
  const refreshPaused = new Promise((resolve) => { markRefreshPaused = resolve; });
  const refreshGate = new Promise((resolve) => { resumeRefresh = resolve; });
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        appendAttempt += 1;
        if (appendAttempt <= 2) {
          return { data: null, error: { code: 'XX000', message: `WAL miss ${appendAttempt}` } };
        }
        const row = {
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        storeAttempt += 1;
        if (storeAttempt <= 4 || storeAttempt >= 7) {
          return { data: null, error: { code: 'XX000', message: 'checkpoint unavailable' } };
        }
        if (storeAttempt === 5) {
          return { data: null, error: { code: '40001', message: 'stale annotation snapshot replacement' } };
        }
        acceptedSnapshots.push(args.p_snapshot);
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        snapshotRead += 1;
        if (snapshotRead === 2) {
          return {
            select: () => ({
              eq() { return this; },
              async maybeSingle() {
                markRefreshPaused();
                await refreshGate;
                return { data: null, error: null };
              },
            }),
          };
        }
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on() { return this; },
      subscribe(callback) { subscribeCallback = callback; return this; },
    }),
    removeChannel: async () => {},
  };
  const doc = new Y.Doc();
  let handle = null;
  try {
    handle = await openAnnotationDoc({ actorUserId: 'test-actor',
      documentId,
      supabase,
      clientId: 'writer',
      enableLocal: false,
      enableRealtime: true,
      doc,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
    });

    handle.setMeta('A', 'gap-one');
    await handle.drain();
    subscribeCallback?.('SUBSCRIBED');
    await refreshPaused;

    handle.setMeta('B', 'gap-two');
    await handle.drain();
    assert.equal(appendAttempt, 1, 'B waits while A CAS repair is unresolved');

    resumeRefresh();
    for (let attempt = 0; attempt < 40 && appendAttempt < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await handle.drain();
    }
    handle.setMeta('C', 'later-success');
    await handle.drain();

    // RULED 2026-09-24 (per-field sync task: an update only a snapshot
    // carried is re-sent through the WAL so already-open peers receive it).
    // A's live re-send is the one extra submission; B still lands before C.
    assert.equal(
      appendAttempt,
      5,
      'A repair, A live re-send, exact B retry, then C are the only submissions',
    );
    assert.equal(rows.length, 3, 'A (re-sent live), B and C reach the WAL');
    const rowMeta = rows.map((row) => (
      Y.decodeUpdate(pgHexToBytes(row.data)).structs
        .map((struct) => struct.parentSub)
        .filter(Boolean)
        .join(',')
    ));
    assert.ok(rowMeta.includes('A'), `A's exact bytes were re-sent live (${rowMeta})`);
    assert.ok(rowMeta.indexOf('B') < rowMeta.indexOf('C'), 'B is positively accepted before C');
    assert.equal(acceptedSnapshots.length, 1);
    assert.equal(handle.isSyncHealthy(), true);
    const cold = await snapshotHexToDoc(acceptedSnapshots[0]);
    for (const row of rows) Y.applyUpdate(cold, pgHexToBytes(row.data));
    assert.equal(getMetaValue(cold, 'A'), 'gap-one');
    assert.equal(getMetaValue(cold, 'B'), 'gap-two');
    assert.equal(getMetaValue(cold, 'C'), 'later-success');
  } finally {
    resumeRefresh?.();
    await handle?.destroy().catch(() => {});
  }
});

for (const caller of ['scheduled', 'manual', 'reconnect', 'destroy', 'pagehide']) {
  test(`${caller} staged-gap snapshot denial rolls back unaccepted bytes`, async () => {
    const backend = makeGapRepairBackend(`doc-gap-denial-${caller}`);
    let handle = null;
    let pagehide = null;
    const previousWindow = globalThis.window;
    if (caller === 'pagehide') {
      globalThis.window = {
        addEventListener(event, callback) {
          if (event === 'pagehide') pagehide = callback;
        },
        removeEventListener() {},
      };
    }
    try {
      const doc = new Y.Doc();
      handle = await openAnnotationDoc({ actorUserId: 'test-actor',
        documentId: `doc-gap-denial-${caller}`,
        supabase: backend.supabase,
        clientId: 'writer',
        enableLocal: false,
        enableRealtime: caller === 'reconnect',
        doc,
      });
      handle.setMeta('forbidden-gap', caller);
      await handle.drain();
      if (caller === 'scheduled') {
        handle.setMeta('later-dependent', 'wal');
        await handle.drain();
      }
      backend.denyRepair();

      if (caller === 'scheduled') {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          if (getMetaValue(doc, 'forbidden-gap') === undefined) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } else if (caller === 'manual') {
        assert.equal(await handle.flushSnapshot(), false);
      } else if (caller === 'reconnect') {
        await backend.fireSubscribed();
      } else if (caller === 'pagehide') {
        pagehide();
        await new Promise((resolve) => setTimeout(resolve, 20));
      } else {
        await handle.destroy();
      }

      assert.equal(
        getMetaValue(doc, 'forbidden-gap'),
        undefined,
        `${caller} denial restores accepted cloud state`,
      );
      assert.equal(
        backend.rows.length,
        0,
        'no dependent WAL can overtake the denied missing predecessor',
      );
      assert.equal(handle.isSyncHealthy(), false);
      if (caller !== 'destroy') await handle.destroy();
      handle = null;
    } finally {
      await handle?.destroy().catch(() => {});
      if (caller === 'pagehide') globalThis.window = previousWindow;
    }
  });
}

test('accepted-only snapshot denial marks unhealthy without rolling back WAL state', async () => {
  const rows = [];
  let denySnapshot = false;
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        const row = {
          document_id: args.p_document_id,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: { seq: row.seq }, error: null };
      }
      if (name === 'store_annotation_snapshot') {
        return denySnapshot
          ? ({ data: null, error: { code: '42501', message: 'snapshot denied' } })
          : ({ data: true, error: null });
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'annotation_updates') return makeWalReadBuilder(rows);
      if (table === 'annotation_snapshots') {
        return { select: () => makeEmptyBuilder({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-accepted-only-denial',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });
  handle.setMeta('accepted', 'wal');
  await handle.drain();
  denySnapshot = true;

  assert.equal(await handle.flushSnapshot(), false);
  assert.equal(getMetaValue(doc, 'accepted'), 'wal', 'WAL-accepted value is not rolled back');
  assert.equal(handle.isSyncHealthy(), false);
  denySnapshot = false;
  await handle.destroy();
});

test('a successful manual snapshot restores sync health after a transient WAL failure', async () => {
  let rejectAppend = true;
  let rejectSnapshot = true;
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        return {
          select: () => makeEmptyBuilder({ data: [] }),
          insert: () => ({
            select: () => ({
              single: async () => rejectAppend
                ? ({ data: null, error: { code: 'XX000', message: 'WAL unavailable' } })
                : ({ data: { seq: 1 }, error: null }),
            }),
          }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => makeEmptyBuilder({ data: null }),
          upsert: async () => rejectSnapshot
            ? ({ error: { code: 'XX000', message: 'snapshot unavailable' } })
            : ({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-manual-health',
    supabase,
    clientId: 'writer',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });
  handle.applyByPage({ 1: { objects: [nativeInk()] } });
  await handle.drain();
  assert.equal(handle.isSyncHealthy(), false);

  assert.equal(
    await handle.flushSnapshot(),
    false,
    'a failed snapshot result object is normalized to the public boolean API',
  );
  assert.equal(handle.isSyncHealthy(), false, 'manual snapshot failure cannot report healthy');

  rejectAppend = false;
  rejectSnapshot = false;
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(handle.isSyncHealthy(), true, 'manual durable checkpoint clears the transient error');
  await handle.destroy();
});

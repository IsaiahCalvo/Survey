import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  ERASE_OUTBOX_MAP,
  MAX_ACKNOWLEDGED_ERASE_TOMBSTONES,
  applyLocalCalloutEraseTargets,
  applyEraseHistoryTransitionOnDoc,
  buildEraseIntent,
  buildEraseHistoryBeforeSnapshot,
  buildLocalCalloutEraseMutations,
  buildPageEraseTargets,
  commitEraseIntent,
  drainEraseOutbox,
  restoreEraseDeletionOnDoc,
} from '../src/utils/annotationEraseTransaction.js';
import {
  MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES,
  buildAnnotationEraseDeleteHistoryRestoreActions,
  prepareEraseIntentForCommit,
} from '../src/utils/annotationEraseCommitPlan.js';
import {
  openAnnotationDoc,
  purgeAnnotationDoc,
} from '../src/services/annotationDocSync.js';
import {
  DELETED_PDF_ANNOTATIONS_MAP,
  clearEraserOpsForAnnotationIds,
  docToDeletedPdfAnnotations,
  docToByPage,
  getEraserOpsMap,
  getAnnotationsMap,
  readRawAnnotationEntry,
  syncByPageToDoc,
  writeAnnotationMark,
} from '../src/services/annotationDocStore.js';

// RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
// — marks are nested per-field maps; tests read and write them through the
// store instead of the old whole { p, o } value.
function storedValues(doc) {
  return [...getAnnotationsMap(doc).keys()]
    .map((key) => [key, readRawAnnotationEntry(doc, key)]);
}
function replaceStored(doc, key, update) {
  const current = readRawAnnotationEntry(doc, key);
  const next = update(current);
  writeAnnotationMark(doc, key, next.p, next.o);
}
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { applyAnnotationHistoryAction } from '../src/utils/annotationLocalHistory.js';
import { setAnnotationStorageKey } from '../src/utils/annotationStorageIdentity.js';
import { buildAnnotationEraseDeleteHistoryRow } from '../src/services/annotationTrashHistory.js';

const clone = (value) => structuredClone(value);

function nativeInk(id = 'shared-ink') {
  return {
    type: 'path',
    id,
    annotationId: id,
    path: [['M', 0, 50], ['L', 100, 50]],
    left: 0,
    top: 0,
    stroke: '#d11b2d',
    strokeWidth: 20,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    data: { id, tool: 'pen', authorId: 'owner' },
  };
}

function outlineOnlyInk(id, geometryKind) {
  const commands = [
    ['M', 0, 40],
    ['L', 100, 40],
    ['L', 100, 60],
    ['L', 0, 60],
    ['Z'],
  ];
  const polygons = [[[
    [0, 40],
    [100, 40],
    [100, 60],
    [0, 60],
    [0, 40],
  ]]];
  return {
    type: 'path',
    id,
    annotationId: id,
    ...(geometryKind === 'polygons' ? { polygons } : { cmds: commands }),
    left: 0,
    top: 0,
    width: 100,
    height: 20,
    fill: '#d11b2d',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 20,
    paperInkGeometry: 'v1',
    data: { id, tool: 'pen', authorId: 'owner' },
  };
}

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

function pageObject(id, kind, extra = {}) {
  const isInk = kind === 'pen' || kind === 'highlighter';
  return {
    type: isInk ? 'path' : 'rect',
    ...(id == null ? {} : { id }),
    data: {
      ...(id == null ? {} : { id }),
      tool: kind,
      authorId: 'owner',
    },
    left: 10,
    top: 10,
    width: 20,
    height: 20,
    ...(isInk
      ? { polygons: [[[[0, 0], [40, 0], [40, 8], [0, 8]]]] }
      : {}),
    ...extra,
  };
}

function counter(id, displayNumber, createdAt, pageNumber = 1) {
  return {
    type: 'group',
    id,
    left: 40 + displayNumber * 50,
    top: 100,
    width: 32,
    height: 32,
    data: {
      id,
      type: 'counter',
      annotationType: 'counter',
      displayNumber,
      seriesId: 'series-a',
      seriesStart: 1,
      createdAt,
      authorId: 'owner',
    },
    meta: { authorId: 'owner' },
    pageNumber,
  };
}

function eraseTarget({
  domain,
  storageKey,
  kind,
  operation,
  before,
  after,
}) {
  return {
    domain,
    storageKey,
    kind,
    operation,
    before: clone(before),
    ...(after === undefined ? {} : { after: clone(after) }),
  };
}

function mixedTargets() {
  const pen = pageObject('pen-a', 'pen');
  const shape = pageObject('shape-a', 'rect');
  const callout = pageObject('callout-a', 'callout', {
    type: 'group',
    data: { id: 'callout-a', type: 'callout', authorId: 'owner' },
  });
  const markup = pageObject('markup-a', 'text-markup', {
    pdfAnnotationType: 'Highlight',
  });
  const highlighter = pageObject('highlighter-a', 'highlighter', { left: 80 });
  return [
    eraseTarget({
      domain: 'page-object',
      storageKey: 'pen-a',
      kind: 'pen',
      operation: 'replace',
      before: pen,
      after: { ...pen, carved: 'pen' },
    }),
    eraseTarget({
      domain: 'page-object',
      storageKey: 'shape-a',
      kind: 'shape',
      operation: 'delete',
      before: shape,
    }),
    eraseTarget({
      domain: 'callout',
      storageKey: 'callout-a',
      kind: 'callout',
      operation: 'delete',
      before: callout,
    }),
    eraseTarget({
      domain: 'text-markup',
      storageKey: 'markup-a',
      kind: 'text-markup',
      operation: 'delete',
      before: markup,
    }),
    eraseTarget({
      domain: 'page-object',
      storageKey: 'highlighter-a',
      kind: 'highlighter',
      operation: 'replace',
      before: highlighter,
      after: { ...highlighter, carved: 'highlighter' },
    }),
  ];
}

test('local eraser applies atomic callout deletion to page JSON', () => {
  const shape = pageObject('shape-local', 'rect');
  const callout = pageObject('callout-local', 'callout', {
    type: 'group',
    data: { id: 'callout-local', type: 'callout', authorId: 'owner' },
  });
  const page = { objects: [shape, callout] };

  const result = applyLocalCalloutEraseTargets(page, [{
    domain: 'callout',
    storageKey: 'callout-local',
    kind: 'callout',
    operation: 'delete',
    before: callout,
  }]);

  assert.deepEqual(result.objects, [shape]);
  assert.deepEqual(page.objects, [shape, callout], 'source page remains immutable');
  assert.deepEqual(buildLocalCalloutEraseMutations([{
    domain: 'callout',
    storageKey: 'callout-local',
    kind: 'callout',
    operation: 'delete',
    before: callout,
    index: 1,
  }]), [{
    index: 1,
    storageKey: 'callout-local',
    annotationId: 'callout-local',
    base: callout,
    deleted: true,
    survivor: null,
  }]);
});

function buildIntent({
  mutationId = `erase:${crypto.randomUUID()}`,
  renderer = 'svg',
  targets = mixedTargets(),
  sideEffects = [],
  gesture = {
    mode: 'partial',
    radius: 10,
    points: [{ x: 0, y: 10 }, { x: 120, y: 10 }],
  },
} = {}) {
  return buildEraseIntent({
    mutationId,
    pageNumber: 1,
    renderer,
    gesture,
    targets,
    sideEffects,
  });
}

function seedDoc(targets = mixedTargets()) {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const target of targets) {
      writeAnnotationMark(doc, target.storageKey, target.pageNumber ?? 1, clone(target.before)); // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    }
  }, 'seed');
  return doc;
}

function localCommit(doc, intent, overrides = {}) {
  return commitEraseIntent({
    doc,
    intent,
    actorUserId: 'local-owner',
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    ...overrides,
  });
}

async function commitAtomicWriterBite(doc, writerId, mutationId, point) {
  const current = docToByPage(doc);
  const erased = erasePageAnnotations({
    pageAnnotations: current[1],
    eraserPoints: [point],
    eraserRadius: 7,
    mode: 'partial',
  });
  const targets = buildPageEraseTargets({
    pageNumber: 1,
    originalObjects: current[1].objects,
    objectMutations: erased.objectMutations,
  });
  const intent = buildIntent({
    mutationId,
    targets,
    gesture: {
      mode: 'partial',
      radius: 7,
      points: [point],
    },
  });
  return commitEraseIntent({
    doc,
    intent,
    actorUserId: writerId,
    eraserWriterId: writerId,
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  });
}

async function commitFullDeleteWithHistory(
  doc,
  {
    writerId,
    mutationId,
    storageKey,
    before,
    pageNumber = 1,
    kind = 'shape',
  },
) {
  const rawIntent = buildEraseIntent({
    mutationId,
    pageNumber,
    renderer: 'svg',
    gesture: {
      mode: 'full',
      radius: 20,
      points: [{ x: 20, y: 20 }],
    },
    targets: [{
      domain: 'page-object',
      storageKey,
      kind,
      operation: 'delete',
      pageNumber,
      index: 0,
      before,
    }],
  });
  const intent = prepareEraseIntentForCommit({
    intent: rawIntent,
    annotationsByPage: docToByPage(doc),
    userId: writerId,
    includeDeleteHistory: true,
  });
  const result = await commitEraseIntent({
    doc,
    intent,
    actorUserId: writerId,
    eraserWriterId: writerId,
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => (
      docToByPage(doc)[pageNumber]?.objects
        ?.find((object) => (
          object?.data?.id === storageKey
          || object?.id === storageKey
        ))
    ),
  });
  const effect = doc.getMap(ERASE_OUTBOX_MAP)
    .get(mutationId)
    ?.effects
    ?.find((candidate) => candidate.type === 'annotation-delete-history');
  return {
    result,
    effect,
    restoreAction: buildAnnotationEraseDeleteHistoryRestoreActions(effect)[0]?.restoreAction,
  };
}

test('duplicate and id-less delete+carve pairs with the exact indexed survivor', async () => {
  const originals = [
    pageObject('duplicate', 'pen', { left: 10 }),
    pageObject('duplicate', 'pen', { left: 40 }),
    pageObject(null, 'highlighter', { left: 70 }),
    pageObject(null, 'highlighter', { left: 100 }),
  ];
  const mutations = [
    { index: 0, deleted: true, survivor: null },
    { index: 1, survivor: { ...originals[1], carvedOccurrence: 'duplicate-second' } },
    { index: 2, deleted: true, survivor: null },
    { index: 3, survivor: { ...originals[3], carvedOccurrence: 'idless-second' } },
  ];

  const targets = buildPageEraseTargets({
    pageNumber: 1,
    originalObjects: originals,
    objectMutations: mutations,
  });

  assert.deepEqual(
    targets.map((target) => [
      target.before.left,
      target.operation,
      target.after?.carvedOccurrence ?? null,
    ]),
    [
      [10, 'delete', null],
      [40, 'replace', 'duplicate-second'],
      [70, 'delete', null],
      [100, 'replace', 'idless-second'],
    ],
  );
  assert.equal(new Set(targets.map((target) => target.storageKey)).size, 4);

  const doc = seedDoc(targets);
  const result = await localCommit(doc, buildIntent({ targets }));
  assert.equal(result.status, 'committed');
  assert.deepEqual(
    storedValues(doc).map(([, value]) => value) // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
      .map((value) => [value.o.left, value.o.carvedOccurrence])
      .sort((left, right) => left[0] - right[0]),
    [
      [40, 'duplicate-second'],
      [100, 'idless-second'],
    ],
  );
});

test('SVG and legacy renderer gestures commit every page annotation domain atomically', async (t) => {
  for (const renderer of ['svg', 'legacy-canvas']) {
    await t.test(renderer, async () => {
      const targets = mixedTargets();
      const doc = seedDoc(targets);
      let updates = 0;
      doc.on('update', (_update, origin) => {
        if (origin !== 'seed') updates += 1;
      });

      const result = await localCommit(doc, buildIntent({ renderer, targets }));

      assert.equal(result.status, 'committed');
      assert.equal(updates, 1, 'core mutation and outbox share one Y transaction');
      assert.deepEqual(
        storedValues(doc) // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
          .map(([key, value]) => [key, value.o.carved])
          .sort(),
        [
          ['highlighter-a', 'highlighter'],
          ['pen-a', 'pen'],
        ],
      );
      assert.equal(doc.getMap('surveyMarkers').size, 0);
    });
  }
});

test('atomic intent rejects Survey Markers because they use the established marker pipeline', () => {
  assert.throws(
    () => buildIntent({
      targets: [{
        domain: 'survey-marker',
        storageKey: 'marker-1',
        kind: 'survey-marker',
        operation: 'delete',
        before: { id: 'marker-1', pageNumber: 1 },
      }],
    }),
    /unsupported erase domain: survey-marker/,
  );
});

test('held gesture cancels when its exact target changed or permission context is incomplete', async (t) => {
  await t.test('same-target edit', async () => {
    const targets = mixedTargets();
    const doc = seedDoc(targets);
    const intent = buildIntent({ targets });
    replaceStored(doc, 'pen-a', (current) => ({ // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
      ...current,
      o: { ...current.o, collaboratorEdit: true },
    }));
    const before = Y.encodeStateAsUpdate(doc);

    const result = await localCommit(doc, intent);

    assert.equal(result.status, 'cancelled');
    assert.equal(result.reason, 'conflict');
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
    assert.equal(doc.getMap(ERASE_OUTBOX_MAP).size, 0);
  });

  await t.test('registered missing owner', async () => {
    const targets = mixedTargets();
    const doc = seedDoc(targets);
    const before = Y.encodeStateAsUpdate(doc);
    const result = await commitEraseIntent({
      doc,
      intent: buildIntent({ targets }),
      permissionContext: {
        mode: 'registered',
        viewerId: 'viewer',
        documentOwnerId: null,
      },
      validateTarget: () => true,
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(result.reason, 'permission-context');
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  });

  await t.test('registered actor does not match viewer', async () => {
    const targets = mixedTargets();
    const doc = seedDoc(targets);
    const before = Y.encodeStateAsUpdate(doc);
    const result = await commitEraseIntent({
      doc,
      intent: buildIntent({ targets }),
      actorUserId: 'other-user',
      permissionContext: {
        mode: 'registered',
        viewerId: 'viewer',
        documentOwnerId: 'owner',
      },
      validateTarget: () => true,
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(result.reason, 'permission-context');
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  });
});

test('held erase commits target keys only and preserves a concurrently edited neighbor', async () => {
  const ink = nativeInk('held-target');
  const neighbor = pageObject('held-neighbor', 'shape', { fill: '#999' });
  const gesture = {
    mode: 'partial',
    radius: 7,
    points: [{ x: 50, y: 50 }],
  };
  const survivor = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: gesture.points,
    eraserRadius: gesture.radius,
    mode: gesture.mode,
  }).objectMutations[0]?.survivor;
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [ink, neighbor] } });
  const intent = buildIntent({
    mutationId: 'held-target-neighbor',
    gesture,
    targets: [{
      domain: 'page-object',
      storageKey: 'held-target',
      kind: 'pen',
      operation: 'replace',
      pageNumber: 1,
      index: 0,
      before: ink,
      after: survivor,
    }],
  });
  const remoteNeighbor = {
    ...neighbor,
    fill: '#2563eb',
    collaboratorRevision: 'remote-during-drag',
  };
  writeAnnotationMark(doc, 'held-neighbor', 1, remoteNeighbor); // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)

  assert.equal((await localCommit(doc, intent, {
    eraserWriterId: 'writer-a',
    materializePageTarget: (target) => docToByPage(doc)[1].objects.find(
      (object) => object.data.id === target.storageKey,
    ),
  })).status, 'committed');
  const after = docToByPage(doc)[1].objects;
  assert.deepEqual(
    after.find((object) => object.data.id === 'held-neighbor'),
    remoteNeighbor,
  );
  assert.equal(
    pointInPolygonSet(
      gesture.points[0],
      after.find((object) => object.data.id === 'held-target').polygons,
    ),
    false,
  );
});

test('lane-only Undo and Redo preserve a collaborator restyle of the same erased ink', async () => {
  const ink = nativeInk('restyled-ink');
  const gesture = {
    mode: 'partial',
    radius: 7,
    points: [{ x: 50, y: 50 }],
  };
  const survivor = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: gesture.points,
    eraserRadius: gesture.radius,
    mode: gesture.mode,
  }).objectMutations[0]?.survivor;
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [ink] } });
  const result = await localCommit(doc, buildIntent({
    mutationId: 'restyle-lane-transition',
    gesture,
    targets: [{
      domain: 'page-object',
      storageKey: 'restyled-ink',
      kind: 'pen',
      operation: 'replace',
      pageNumber: 1,
      index: 0,
      before: ink,
      after: survivor,
    }],
  }), {
    eraserWriterId: 'writer-a',
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  });
  assert.equal(result.status, 'committed');
  assert.equal(result.historyTransition.lanes.length, 1);

  const stored = readRawAnnotationEntry(doc, 'restyled-ink'); // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
  const remoteBase = {
    ...stored.o,
    stroke: '#2563eb',
    opacity: 0.35,
    collaboratorRevision: 'remote-restyle',
  };
  writeAnnotationMark(doc, 'restyled-ink', stored.p, remoteBase);
  let visible = docToByPage(doc)[1].objects[0];
  assert.equal(visible.fill, '#2563eb');
  assert.equal(visible.opacity, 0.35);
  assert.equal(visible.collaboratorRevision, 'remote-restyle');
  assert.equal(pointInPolygonSet(gesture.points[0], visible.polygons), false);

  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc,
    transition: result.historyTransition,
    direction: 'undo',
  }).status, 'applied');
  visible = docToByPage(doc)[1].objects[0];
  assert.equal(visible.stroke, '#2563eb');
  assert.equal(visible.opacity, 0.35);
  assert.equal(visible.collaboratorRevision, 'remote-restyle');
  assert.equal(visible.paperEraserGeometry, undefined);

  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc,
    transition: result.historyTransition,
    direction: 'redo',
  }).status, 'applied');
  visible = docToByPage(doc)[1].objects[0];
  assert.equal(visible.fill, '#2563eb');
  assert.equal(visible.opacity, 0.35);
  assert.equal(visible.collaboratorRevision, 'remote-restyle');
  assert.equal(pointInPolygonSet(gesture.points[0], visible.polygons), false);
});

test('failure before the atomic boundary leaves every domain and outbox unchanged', async () => {
  const targets = mixedTargets();
  const doc = seedDoc(targets);
  const before = Y.encodeStateAsUpdate(doc);

  await assert.rejects(
    () => localCommit(doc, buildIntent({ targets }), {
      injectFailure: (stage) => {
        if (stage === 'before-core-commit') throw new Error('injected failure');
      },
    }),
    /injected failure/,
  );

  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.equal(doc.getMap(ERASE_OUTBOX_MAP).size, 0);
});

test('queued erase history uses the page-target predecessor instead of stale React state', () => {
  const original = pageObject('history-ink', 'pen');
  const afterFirst = { ...original, geometryRevision: 'after-first' };
  const afterSecond = { ...afterFirst, geometryRevision: 'after-second' };
  const staleSnapshot = {
    annotationsByPage: { 1: { objects: [original] } },
    surveyMarkers: { untouched: { id: 'untouched' } },
    spaces: [],
    callouts: [],
  };
  const intent = buildIntent({
    targets: [eraseTarget({
      domain: 'page-object',
      storageKey: 'history-ink',
      kind: 'pen',
      operation: 'replace',
      before: afterFirst,
      after: afterSecond,
    })],
  });

  const predecessor = buildEraseHistoryBeforeSnapshot(staleSnapshot, intent);

  assert.deepEqual(predecessor.annotationsByPage[1].objects, [afterFirst]);
  assert.deepEqual(predecessor.surveyMarkers, staleSnapshot.surveyMarkers);
  assert.deepEqual(staleSnapshot.annotationsByPage[1].objects, [original]);
});

test('counter erase atomically renumbers 1/2/3 and Undo/Redo stay exact in both modes', async (t) => {
  for (const mode of ['partial', 'full']) {
    await t.test(mode, async () => {
      const first = counter('counter-1', 1, 100, 1);
      const second = counter('counter-2', 2, 200, 1);
      const third = counter('counter-3', 3, 300, 2);
      const byPage = {
        1: { objects: [first, second] },
        2: { objects: [third] },
      };
      const intent = buildIntent({
        mutationId: `counter-${mode}`,
        gesture: {
          mode,
          radius: 12,
          points: [{ x: second.left + 16, y: second.top + 16 }],
        },
        targets: [{
          domain: 'page-object',
          storageKey: 'counter-2',
          kind: 'counter',
          operation: 'delete',
          pageNumber: 1,
          index: 1,
          before: second,
        }],
      });
      const prepared = prepareEraseIntentForCommit({
        intent,
        annotationsByPage: byPage,
        userId: 'owner',
        includeDeleteHistory: true,
      });

      assert.deepEqual(
        prepared.targets.map((target) => [
          target.storageKey,
          target.operation,
          target.cause || null,
          target.pageNumber,
          target.after?.data?.displayNumber ?? null,
        ]),
        [
          ['counter-2', 'delete', null, 1, null],
          ['counter-3', 'replace', 'counter-renumber', 2, 2],
        ],
      );
      assert.equal(
        prepared.sideEffects.some(
          (effect) => (
            effect.type === 'annotation-delete-history'
            && effect.payload.mutationId === `counter-${mode}`
            && effect.targetKey === `counter-${mode}:delete-history:1-of-1`
          ),
        ),
        true,
      );
      assert.deepEqual(
        prepared.sideEffects[0].payload.mutations.map((mutation) => [
          mutation.storageKey,
          mutation.operation,
        ]),
        [['counter-2', 'delete']],
      );

      const doc = new Y.Doc();
      syncByPageToDoc(doc, byPage);
      const undoManager = new Y.UndoManager([
        getAnnotationsMap(doc),
        doc.getMap('annotationEraserOps'),
        doc.getMap(ERASE_OUTBOX_MAP),
      ], {
        trackedOrigins: new Set(['erase-local']),
        captureTimeout: 0,
      });
      const materializeTarget = (target) => Object.values(docToByPage(doc))
        .flatMap((page) => page.objects || [])
        .find((object) => object?.data?.id === target.storageKey);
      const result = await commitEraseIntent({
        doc,
        intent: prepared,
        origin: 'erase-local',
        undoManager,
        actorUserId: 'owner',
        eraserWriterId: 'owner-writer',
        permissionContext: { mode: 'local-only' },
        validateTarget: () => true,
        materializePageTarget: materializeTarget,
      });
      assert.equal(result.status, 'committed');
      const numbers = () => Object.values(docToByPage(doc))
        .flatMap((page) => page.objects || [])
        .filter((object) => object?.data?.type === 'counter')
        .sort((left, right) => left.data.createdAt - right.data.createdAt)
        .map((object) => [object.data.id, object.data.displayNumber]);
      assert.deepEqual(numbers(), [
        ['counter-1', 1],
        ['counter-3', 2],
      ]);

      undoManager.undo();
      assert.deepEqual(numbers(), [
        ['counter-1', 1],
        ['counter-2', 2],
        ['counter-3', 3],
      ]);
      undoManager.redo();
      assert.deepEqual(numbers(), [
        ['counter-1', 1],
        ['counter-3', 2],
      ]);
      undoManager.destroy();
    });
  }
});

test('partial erase stamps imported ink for native export and preserves attribution', async () => {
  const original = {
    ...nativeInk('imported-ink'),
    isPdfImported: true,
    pdfAnnotationId: '42R',
    meta: { authorId: 'original-author', createdAt: 100 },
  };
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [original] },
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const intent = buildIntent({
    mutationId: 'imported-ink-erase',
    targets: buildPageEraseTargets({
      pageNumber: 1,
      originalObjects: [original],
      objectMutations: erased.objectMutations,
    }),
    gesture: {
      mode: 'partial',
      radius: 7,
      points: [{ x: 50, y: 50 }],
    },
  });
  const prepared = prepareEraseIntentForCommit({
    intent,
    annotationsByPage: { 1: { objects: [original] } },
    userId: 'editing-user',
  });
  const survivor = prepared.targets[0].after;
  assert.equal(survivor.pdfImportedEditState, 'edited');
  assert.equal(survivor.pdfImportedEditedBy, 'editing-user');
  assert.equal(survivor.pdfImportedEditSource, 'eraser:commit');
  assert.equal(survivor.data.pdfImportedEditState, 'edited');
  assert.equal(survivor.meta.authorId, 'original-author');
  assert.equal(buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: 200, height: 200 } },
    annotationsByPage: { 1: { objects: [survivor] } },
  }).diagnostics.editedImportedCopiesExported, 1);

  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [original] } });
  const result = await commitEraseIntent({
    doc,
    intent: prepared,
    actorUserId: 'editing-user',
    eraserWriterId: 'editing-writer',
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  });
  assert.equal(result.status, 'committed');
  const committed = docToByPage(doc)[1].objects[0];
  assert.equal(committed.pdfImportedEditState, 'edited');
  assert.equal(committed.pdfImportedEditedBy, 'editing-user');
  assert.equal(committed.pdfImportedEditSource, 'eraser:commit');
  assert.equal(committed.data.pdfImportedEditState, 'edited');
  assert.equal(committed.meta.authorId, 'original-author');
  assert.deepEqual(docToDeletedPdfAnnotations(doc), []);
  assert.equal(buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: 200, height: 200 } },
    annotationsByPage: { 1: { objects: [committed] } },
  }).diagnostics.editedImportedCopiesExported, 1);
});

test('pdfAnnotationId-only native ink survives two rapid bites as one edited export copy', async () => {
  const seeded = nativeInk();
  delete seeded.id;
  delete seeded.annotationId;
  delete seeded.data.id;
  const original = {
    ...seeded,
    pdfAnnotationId: '51R',
    isPdfImported: true,
    meta: { authorId: 'native-author', createdAt: 100 },
  };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [original] } });

  const bite = async (mutationId, point) => {
    const before = docToByPage(doc);
    assert.equal(before[1].objects.length, 1);
    const erased = erasePageAnnotations({
      pageAnnotations: before[1],
      eraserPoints: [point],
      eraserRadius: 7,
      mode: 'partial',
    });
    assert.equal(erased.objectMutations.length, 1);
    assert.equal(erased.objectMutations[0].deleted, false);
    const intent = buildIntent({
      mutationId,
      targets: buildPageEraseTargets({
        pageNumber: 1,
        originalObjects: before[1].objects,
        objectMutations: erased.objectMutations,
      }),
      gesture: {
        mode: 'partial',
        radius: 7,
        points: [point],
      },
    });
    const prepared = prepareEraseIntentForCommit({
      intent,
      annotationsByPage: before,
      userId: 'editing-user',
    });
    return commitEraseIntent({
      doc,
      intent: prepared,
      actorUserId: 'editing-user',
      eraserWriterId: 'editing-writer',
      permissionContext: { mode: 'local-only' },
      validateTarget: () => true,
      materializePageTarget: () => docToByPage(doc)[1].objects[0],
    });
  };

  assert.equal((await bite('native-only-first', { x: 30, y: 50 })).status, 'committed');
  const afterFirst = clone(docToByPage(doc)[1].objects[0]);
  assert.equal((await bite('native-only-second', { x: 70, y: 50 })).status, 'committed');
  const afterSecond = docToByPage(doc)[1].objects[0];

  assert.equal(afterSecond.pdfAnnotationId, '51R');
  assert.equal(afterSecond.pdfImportedEditState, 'edited');
  assert.notDeepEqual(afterFirst.polygons || afterFirst.path, original.path);
  assert.notDeepEqual(afterSecond.polygons || afterSecond.path, afterFirst.polygons || afterFirst.path);
  const exportPlan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: 200, height: 200 } },
    annotationsByPage: { 1: { objects: [afterSecond] } },
  });
  assert.equal(exportPlan.diagnostics.editedImportedCopiesExported, 1);
  assert.equal(exportPlan.diagnostics.importedNativeCopiesSkipped, 0);
  assert.equal(exportPlan.items.length, 1);
  assert.equal(exportPlan.items[0].object.pdfAnnotationId, '51R');
  assert.notDeepEqual(exportPlan.items[0].object.path, original.path);
});

test('partial imported highlighter becomes an edited copy without a native-delete tombstone', async () => {
  const original = {
    ...nativeInk('imported-highlighter'),
    pdfAnnotationId: '52R',
    isPdfImported: true,
    data: {
      tool: 'highlighter',
      authorId: 'owner',
      id: 'imported-highlighter',
    },
    stroke: '#ffe066',
    opacity: 0.45,
  };
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [original] },
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const prepared = prepareEraseIntentForCommit({
    intent: buildIntent({
      mutationId: 'imported-highlighter-partial',
      targets: buildPageEraseTargets({
        pageNumber: 1,
        originalObjects: [original],
        objectMutations: erased.objectMutations,
      }),
      gesture: {
        mode: 'partial',
        radius: 7,
        points: [{ x: 50, y: 50 }],
      },
    }),
    annotationsByPage: { 1: { objects: [original] } },
    userId: 'editing-user',
  });
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [original] } });
  assert.equal((await commitEraseIntent({
    doc,
    intent: prepared,
    actorUserId: 'editing-user',
    eraserWriterId: 'editing-writer',
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  })).status, 'committed');
  assert.equal(docToByPage(doc)[1].objects[0].pdfImportedEditState, 'edited');
  assert.deepEqual(docToDeletedPdfAnnotations(doc), []);
});

test('full erase tombstones imported shape and text markup atomically across Undo/Redo/reload', async () => {
  const importedShape = {
    ...pageObject('imported-shape', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: '61R',
    pdfAnnotationType: 'Square',
  };
  const importedTextMarkup = {
    ...pageObject('imported-highlight', 'text-markup'),
    isPdfImported: true,
    pdfAnnotationId: '62R',
    pdfAnnotationType: 'Highlight',
  };
  const byPage = { 1: { objects: [importedShape, importedTextMarkup] } };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, byPage);
  const undoManager = new Y.UndoManager([
    getAnnotationsMap(doc),
    doc.getMap('annotationEraserOps'),
    doc.getMap(DELETED_PDF_ANNOTATIONS_MAP),
    doc.getMap(ERASE_OUTBOX_MAP),
  ], {
    trackedOrigins: new Set(['erase-local']),
    captureTimeout: 0,
  });
  const intent = buildIntent({
    mutationId: 'delete-imported-native-pair',
    targets: [
      {
        domain: 'page-object',
        storageKey: 'imported-shape',
        kind: 'shape',
        operation: 'delete',
        pageNumber: 1,
        index: 0,
        before: importedShape,
      },
      {
        domain: 'text-markup',
        storageKey: 'imported-highlight',
        kind: 'text-markup',
        operation: 'delete',
        pageNumber: 1,
        index: 1,
        before: importedTextMarkup,
      },
    ],
    gesture: {
      mode: 'partial',
      radius: 20,
      points: [{ x: 10, y: 10 }],
    },
  });
  assert.equal((await commitEraseIntent({
    doc,
    intent,
    origin: 'erase-local',
    undoManager,
    actorUserId: 'owner',
    eraserWriterId: 'owner-writer',
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: (target) => (
      docToByPage(doc)[1].objects.find(
        (object) => (
          object?.id === target.storageKey
          || object?.data?.id === target.storageKey
        ),
      )
    ),
  })).status, 'committed');
  assert.deepEqual(docToByPage(doc)[1].objects, []);
  assert.deepEqual(
    docToDeletedPdfAnnotations(doc).map((entry) => [
      entry.pdfAnnotationId,
      entry.pageNumber,
      entry.pdfAnnotationType,
    ]),
    [
      ['61R', 1, 'Square'],
      ['62R', 1, 'Highlight'],
    ],
  );

  undoManager.undo();
  assert.deepEqual(
    docToByPage(doc)[1].objects.map((object) => object.id),
    ['imported-shape', 'imported-highlight'],
  );
  assert.deepEqual(docToDeletedPdfAnnotations(doc), []);
  undoManager.redo();
  assert.deepEqual(docToByPage(doc)[1].objects, []);
  assert.deepEqual(
    docToDeletedPdfAnnotations(doc).map((entry) => entry.pdfAnnotationId),
    ['61R', '62R'],
  );

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(docToByPage(reopened)[1].objects, []);
  assert.deepEqual(
    docToDeletedPdfAnnotations(reopened).map((entry) => entry.pdfAnnotationId),
    ['61R', '62R'],
  );
  undoManager.destroy();
});

test('eraser tombstone removes the imported native annotation on export', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([200, 200]);
  const nativeRef = source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [20, 160, 40, 180],
    Border: [0, 0, 1], F: 4, P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([nativeRef]));
  const sourceBytes = await source.save();
  const imported = {
    ...pageObject('eraser-export-shape', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: `${nativeRef.objectNumber}R`,
    pdfAnnotationType: 'Square',
  };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [imported] } });
  const intent = buildIntent({
    mutationId: 'eraser-export-delete',
    targets: [{
      domain: 'page-object', storageKey: 'eraser-export-shape', kind: 'shape',
      operation: 'delete', pageNumber: 1, index: 0, before: imported,
    }],
    gesture: { mode: 'full', radius: 20, points: [{ x: 20, y: 20 }] },
  });
  assert.equal((await commitEraseIntent({
    doc,
    intent,
    actorUserId: 'owner',
    eraserWriterId: 'owner-writer',
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  })).status, 'committed');

  const exportedBytes = await savePDFWithAnnotationsPdfLib(
    {
      name: 'eraser-export.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    docToByPage(doc),
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, deletedPdfAnnotations: docToDeletedPdfAnnotations(doc) },
  );
  const exported = await PDFDocument.load(exportedBytes);
  assert.equal(exported.getPage(0).node.lookup(PDFName.of('Annots'))?.size?.() || 0, 0);
});

test('writer-scoped native deletion survives one writer Undo until every delete lane is gone', async () => {
  const original = {
    ...pageObject('shared-native-shape', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: '71R',
    pdfAnnotationType: 'Square',
  };
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects: [original] } });
  const seedUpdate = Y.encodeStateAsUpdate(seed);
  const writerA = new Y.Doc();
  const writerB = new Y.Doc();
  Y.applyUpdate(writerA, seedUpdate);
  Y.applyUpdate(writerB, seedUpdate);
  const deleteIntent = (mutationId) => buildIntent({
    mutationId,
    targets: [{
      domain: 'page-object',
      storageKey: 'shared-native-shape',
      kind: 'shape',
      operation: 'delete',
      pageNumber: 1,
      index: 0,
      before: original,
    }],
    gesture: {
      mode: 'full',
      radius: 20,
      points: [{ x: 20, y: 20 }],
    },
  });
  const commitWriter = (doc, writerId, mutationId) => commitEraseIntent({
    doc,
    intent: deleteIntent(mutationId),
    actorUserId: writerId,
    eraserWriterId: writerId,
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  });
  assert.equal((await commitWriter(writerA, 'writer-a', 'native-delete-a')).status, 'committed');
  assert.equal((await commitWriter(writerB, 'writer-b', 'native-delete-b')).status, 'committed');

  const merged = new Y.Doc();
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(writerA));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(writerB));
  assert.deepEqual(docToByPage(merged)[1].objects, []);
  assert.deepEqual(
    docToDeletedPdfAnnotations(merged).map((entry) => entry.pdfAnnotationId),
    ['71R'],
  );

  clearEraserOpsForAnnotationIds(merged, ['shared-native-shape'], {
    origin: 'history',
    writerId: 'writer-a',
  });
  assert.deepEqual(docToByPage(merged)[1].objects, []);
  assert.deepEqual(
    docToDeletedPdfAnnotations(merged).map((entry) => entry.pdfAnnotationId),
    ['71R'],
  );
  clearEraserOpsForAnnotationIds(merged, ['shared-native-shape'], {
    origin: 'history',
    writerId: 'writer-b',
  });
  assert.deepEqual(
    docToByPage(merged)[1].objects.map((object) => object.id),
    ['shared-native-shape'],
  );
  assert.deepEqual(docToDeletedPdfAnnotations(merged), []);
});

test('native deletion identity is page-scoped when two pages reuse one PDF annotation id', async () => {
  const pageOne = {
    ...pageObject('page-one-native', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: 'shared-native-name',
    pdfAnnotationType: 'Square',
  };
  const pageTwo = {
    ...pageObject('page-two-native', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: 'shared-native-name',
    pdfAnnotationType: 'Square',
  };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, {
    1: { objects: [pageOne] },
    2: { objects: [pageTwo] },
  });
  const commitPage = (pageNumber, object, writerId) => commitEraseIntent({
    doc,
    intent: buildEraseIntent({
      mutationId: `delete-native-page-${pageNumber}`,
      pageNumber,
      renderer: 'svg',
      gesture: {
        mode: 'full',
        radius: 20,
        points: [{ x: 20, y: 20 }],
      },
      targets: [{
        domain: 'page-object',
        storageKey: object.id,
        kind: 'shape',
        operation: 'delete',
        pageNumber,
        index: 0,
        before: object,
      }],
    }),
    actorUserId: writerId,
    eraserWriterId: writerId,
    permissionContext: { mode: 'local-only' },
    validateTarget: () => true,
    materializePageTarget: () => (
      docToByPage(doc)[pageNumber].objects.find((candidate) => candidate.id === object.id)
    ),
  });
  assert.equal((await commitPage(1, pageOne, 'writer-page-one')).status, 'committed');
  assert.equal((await commitPage(2, pageTwo, 'writer-page-two')).status, 'committed');
  assert.deepEqual(
    docToDeletedPdfAnnotations(doc).map((entry) => [
      entry.pageNumber,
      entry.pdfAnnotationId,
    ]),
    [
      [1, 'shared-native-name'],
      [2, 'shared-native-name'],
    ],
  );

  clearEraserOpsForAnnotationIds(doc, ['page-one-native'], {
    origin: 'history',
    writerId: 'writer-page-one',
  });
  assert.deepEqual(
    docToDeletedPdfAnnotations(doc).map((entry) => [
      entry.pageNumber,
      entry.pdfAnnotationId,
    ]),
    [[2, 'shared-native-name']],
  );
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(
    docToDeletedPdfAnnotations(reopened).map((entry) => entry.pageNumber),
    [2],
  );
});

test('Revisions restores only its exact native delete lane and is idempotent', async () => {
  const pdfNativeAnnotationIdentity = {
    v: 1,
    pageNumber: 1,
    annotsIndex: 4,
    fingerprint: {
      subtype: 'Square',
      rect: [10, 10, 30, 30],
      flags: 0,
    },
  };
  const imported = {
    ...pageObject('history-native', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: '91R',
    pdfAnnotationType: 'Square',
    data: {
      ...pageObject('history-native', 'shape').data,
      pdfNativeAnnotationIdentity,
    },
  };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [imported] } });
  const committed = await commitFullDeleteWithHistory(doc, {
    writerId: 'writer-a',
    mutationId: 'history-native-delete',
    storageKey: 'history-native',
    before: imported,
  });
  assert.equal(committed.result.status, 'committed');
  assert.ok(committed.restoreAction?.eraseDeleteLane);
  const serializedEffect = JSON.stringify(committed.effect);
  assert.equal(serializedEffect.includes('\u0000'), false);
  assert.equal(serializedEffect.includes('\\u0000'), false);
  assert.equal(
    Object.hasOwn(committed.restoreAction.eraseDeleteLane, 'laneKey'),
    false,
  );
  assert.deepEqual(
    docToDeletedPdfAnnotations(doc)[0].pdfNativeAnnotationIdentity,
    pdfNativeAnnotationIdentity,
  );

  let validatedAuthor = null;
  const restored = restoreEraseDeletionOnDoc({
    doc,
    restoreActions: [committed.restoreAction],
    validateTarget: ({ annotation }) => {
      validatedAuthor = annotation.data.authorId;
      return true;
    },
  });
  assert.equal(restored.status, 'applied');
  assert.equal(restored.restored, 1);
  assert.equal(validatedAuthor, 'owner');
  assert.deepEqual(
    docToByPage(doc)[1].objects.map((object) => object.id),
    ['history-native'],
  );
  assert.deepEqual(docToDeletedPdfAnnotations(doc), []);
  assert.deepEqual(
    readRawAnnotationEntry(doc, 'history-native').o.data.pdfNativeAnnotationIdentity, // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    pdfNativeAnnotationIdentity,
  );

  assert.deepEqual(
    restoreEraseDeletionOnDoc({
      doc,
      restoreActions: [committed.restoreAction],
    }),
    { status: 'noop', restored: 0 },
  );
});

test('Revisions delete-lane restore fails closed for newer same-writer state and missing base', async () => {
  const original = pageObject('stale-history-shape', 'shape');
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [original] } });
  const first = await commitFullDeleteWithHistory(doc, {
    writerId: 'writer-a',
    mutationId: 'history-delete-old',
    storageKey: 'stale-history-shape',
    before: original,
  });
  assert.equal(first.result.status, 'committed');
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc,
    transition: first.result.historyTransition,
    direction: 'undo',
  }).status, 'applied');
  const second = await commitFullDeleteWithHistory(doc, {
    writerId: 'writer-a',
    mutationId: 'history-delete-new',
    storageKey: 'stale-history-shape',
    before: docToByPage(doc)[1].objects[0],
  });
  assert.equal(second.result.status, 'committed');
  assert.deepEqual(
    restoreEraseDeletionOnDoc({
      doc,
      restoreActions: [first.restoreAction],
    }),
    { status: 'conflict', reason: 'lane-conflict' },
  );
  assert.deepEqual(docToByPage(doc)[1].objects, []);

  getAnnotationsMap(doc).delete('stale-history-shape');
  assert.deepEqual(
    restoreEraseDeletionOnDoc({
      doc,
      restoreActions: [second.restoreAction],
    }),
    { status: 'conflict', reason: 'stable-base-missing' },
  );
  assert.equal(getAnnotationsMap(doc).has('stale-history-shape'), false);
});

test('Revisions restore preserves other writers, current ownership, and unrelated tombstones', async () => {
  const original = {
    ...pageObject('shared-history-shape', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: '92R',
    pdfAnnotationType: 'Square',
  };
  const base = new Y.Doc();
  syncByPageToDoc(base, { 1: { objects: [original] } });
  const baseUpdate = Y.encodeStateAsUpdate(base);
  const writerA = new Y.Doc();
  const writerB = new Y.Doc();
  Y.applyUpdate(writerA, baseUpdate);
  Y.applyUpdate(writerB, baseUpdate);
  const deletedA = await commitFullDeleteWithHistory(writerA, {
    writerId: 'writer-a',
    mutationId: 'history-delete-a',
    storageKey: 'shared-history-shape',
    before: original,
  });
  const deletedB = await commitFullDeleteWithHistory(writerB, {
    writerId: 'writer-b',
    mutationId: 'history-delete-b',
    storageKey: 'shared-history-shape',
    before: original,
  });
  assert.equal(deletedA.result.status, 'committed');
  assert.equal(deletedB.result.status, 'committed');

  const merged = new Y.Doc();
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(writerA));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(writerB));
  replaceStored(merged, 'shared-history-shape', (baseRecord) => ({ // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    ...baseRecord,
    o: {
      ...baseRecord.o,
      data: {
        ...baseRecord.o.data,
        authorId: 'new-owner',
      },
    },
  }));
  let permissionSawCurrentOwner = false;
  assert.deepEqual(
    restoreEraseDeletionOnDoc({
      doc: merged,
      restoreActions: [deletedA.restoreAction],
      validateTarget: ({ annotation }) => {
        permissionSawCurrentOwner = annotation.data.authorId === 'new-owner';
        return permissionSawCurrentOwner;
      },
    }),
    { status: 'applied', restored: 1 },
  );
  assert.equal(permissionSawCurrentOwner, true);
  assert.deepEqual(docToByPage(merged)[1].objects, []);
  assert.equal(getEraserOpsMap(merged).size, 1);

  merged.getMap(DELETED_PDF_ANNOTATIONS_MAP).set('1\u000092R', {
    pdfAnnotationId: '92R',
    pageNumber: 1,
    pdfAnnotationType: 'Square',
    reason: 'later-selection-delete',
  });
  assert.deepEqual(
    restoreEraseDeletionOnDoc({
      doc: merged,
      restoreActions: [deletedA.restoreAction],
      validateTarget: () => true,
    }),
    { status: 'noop', restored: 0 },
  );
  assert.equal(
    merged.getMap(DELETED_PDF_ANNOTATIONS_MAP).get('1\u000092R').reason,
    'later-selection-delete',
  );
});

test('restoring A full delete preserves B partial bite and B Undo restores the base', async () => {
  const original = nativeInk('partial-then-delete');
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [original] } });
  const bitePoint = { x: 50, y: 50 };
  const bite = await commitAtomicWriterBite(
    doc,
    'writer-b',
    'partial-before-full-delete',
    bitePoint,
  );
  assert.equal(bite.status, 'committed');
  const visibleBite = docToByPage(doc)[1].objects[0];
  assert.equal(pointInPolygonSet(bitePoint, visibleBite.polygons), false);

  const deletedA = await commitFullDeleteWithHistory(doc, {
    writerId: 'writer-a',
    mutationId: 'full-delete-after-partial',
    storageKey: 'partial-then-delete',
    before: visibleBite,
    kind: 'pen',
  });
  assert.equal(deletedA.result.status, 'committed');
  assert.deepEqual(docToByPage(doc)[1].objects, []);
  assert.equal(restoreEraseDeletionOnDoc({
    doc,
    restoreActions: [deletedA.restoreAction],
  }).status, 'applied');
  assert.equal(
    pointInPolygonSet(bitePoint, docToByPage(doc)[1].objects[0].polygons),
    false,
  );
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc,
    transition: bite.historyTransition,
    direction: 'undo',
  }).status, 'applied');
  assert.equal(docToByPage(doc)[1].objects[0].paperEraserGeometry, undefined);
});

test('ordinary selection delete and restore update the durable native tombstone immediately', () => {
  const imported = {
    ...pageObject('selected-native', 'shape'),
    isPdfImported: true,
    pdfAnnotationId: '81R',
    pdfAnnotationType: 'Square',
  };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [imported] } });
  syncByPageToDoc(doc, { 1: { objects: [] } });
  assert.deepEqual(
    docToDeletedPdfAnnotations(doc).map((entry) => entry.pdfAnnotationId),
    ['81R'],
  );
  const reopenedDeleted = new Y.Doc();
  Y.applyUpdate(reopenedDeleted, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(
    docToDeletedPdfAnnotations(reopenedDeleted).map((entry) => entry.pdfAnnotationId),
    ['81R'],
  );

  syncByPageToDoc(doc, { 1: { objects: [imported] } });
  assert.deepEqual(docToDeletedPdfAnnotations(doc), []);
  const reopenedRestored = new Y.Doc();
  Y.applyUpdate(reopenedRestored, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(docToDeletedPdfAnnotations(reopenedRestored), []);
});

test('mixed erase keeps full local Undo but Revisions restores deletions only', async () => {
  const first = pageObject('shape-1', 'shape');
  const second = pageObject('shape-2', 'shape');
  const beforeInk = nativeInk('ink-1');
  const gesture = {
    mode: 'partial',
    radius: 7,
    points: [{ x: 50, y: 50 }],
  };
  const afterInk = erasePageAnnotations({
    pageAnnotations: { objects: [beforeInk] },
    eraserPoints: gesture.points,
    eraserRadius: gesture.radius,
    mode: gesture.mode,
  }).objectMutations[0]?.survivor;
  assert.ok(afterInk);
  const intent = buildIntent({
    mutationId: 'history-grouping',
    gesture,
    targets: [
      {
        domain: 'page-object',
        storageKey: 'shape-1',
        kind: 'shape',
        operation: 'delete',
        before: first,
        index: 0,
      },
      {
        domain: 'page-object',
        storageKey: 'shape-2',
        kind: 'shape',
        operation: 'delete',
        before: second,
        index: 1,
      },
      {
        domain: 'page-object',
        storageKey: 'ink-1',
        kind: 'pen',
        operation: 'replace',
        before: beforeInk,
        after: afterInk,
        index: 2,
      },
    ],
  });
  const prepared = prepareEraseIntentForCommit({
    intent,
    annotationsByPage: { 1: { objects: [first, second, beforeInk] } },
    userId: 'owner',
    includeDeleteHistory: true,
  });

  const historyEffects = prepared.sideEffects.filter(
    (effect) => effect.type === 'annotation-delete-history',
  );
  assert.equal(historyEffects.length, 1);
  const historyEffect = historyEffects[0];
  assert.deepEqual(
    historyEffect.payload.mutations.map((entry) => [
      entry.storageKey,
      entry.operation,
    ]),
    [
      ['shape-1', 'delete'],
      ['shape-2', 'delete'],
    ],
  );
  const objectRestoreActions = buildAnnotationEraseDeleteHistoryRestoreActions(historyEffect);
  assert.deepEqual(
    objectRestoreActions.map((entry) => [
      entry.restoreAction.type,
      entry.restoreAction.storageKey,
    ]),
    [
      ['fabric:create', 'shape-1'],
      ['fabric:create', 'shape-2'],
    ],
  );

  const historyRow = buildAnnotationEraseDeleteHistoryRow({
    objectRestoreActions,
    totalCount: objectRestoreActions.length,
    mutationId: intent.mutationId,
    documentId: 'document-1',
    userId: 'owner',
    actorName: 'Owner',
    deletedAt: '2026-07-23T00:00:00.000Z',
  });
  assert.equal(historyRow.client_event_id, 'annotations-erase-delete:history-grouping');
  assert.equal(historyRow.payload.objects.length, 2);

  let revisionRestored = {
    1: {
      objects: [
        setAnnotationStorageKey(clone(afterInk), 'ink-1'),
      ],
    },
  };
  for (const entry of historyRow.payload.objects) {
    revisionRestored = applyAnnotationHistoryAction(
      revisionRestored,
      entry.restoreAction,
    );
  }
  assert.deepEqual(
    revisionRestored[1].objects,
    [first, second, afterInk],
    'Revisions Restore does not pretend to reverse partial geometry',
  );

  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [first, second, beforeInk] } });
  const undoManager = new Y.UndoManager([
    getAnnotationsMap(doc),
    doc.getMap('annotationEraserOps'),
    doc.getMap(ERASE_OUTBOX_MAP),
  ], {
    trackedOrigins: new Set(['erase-local']),
    captureTimeout: 0,
  });
  assert.equal((await localCommit(doc, prepared, {
    origin: 'erase-local',
    undoManager,
    eraserWriterId: 'owner-writer',
  })).status, 'committed');
  assert.deepEqual(
    docToByPage(doc)[1].objects.map((object) => object.data.id),
    ['ink-1'],
  );
  undoManager.undo();
  assert.deepEqual(
    docToByPage(doc)[1].objects,
    [first, second, beforeInk],
    'local Cmd+Z restores the entire mixed gesture in one transaction',
  );
});

test('120 full deletes produce three bounded unique Revisions effects and restore exactly', async () => {
  const objects = Array.from({ length: 120 }, (_value, index) => (
    pageObject(`batch-shape-${String(index).padStart(3, '0')}`, 'shape', {
      left: index * 2,
    })
  ));
  const rawIntent = buildEraseIntent({
    mutationId: 'history-batch-120',
    pageNumber: 1,
    renderer: 'svg',
    gesture: {
      mode: 'full',
      radius: 300,
      points: [{ x: 120, y: 20 }],
    },
    targets: objects.map((object, index) => ({
      domain: 'page-object',
      storageKey: object.id,
      kind: 'shape',
      operation: 'delete',
      pageNumber: 1,
      index,
      before: object,
    })),
  });
  const prepared = prepareEraseIntentForCommit({
    intent: rawIntent,
    annotationsByPage: { 1: { objects } },
    userId: 'owner',
    includeDeleteHistory: true,
  });
  const preparedEffects = prepared.sideEffects.filter(
    (effect) => effect.type === 'annotation-delete-history',
  );
  assert.deepEqual(
    preparedEffects.map((effect) => effect.payload.mutations.length),
    [50, 50, 20],
  );
  assert.equal(
    new Set(preparedEffects.map((effect) => effect.targetKey)).size,
    3,
  );

  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects } });
  const committed = await localCommit(doc, prepared, {
    eraserWriterId: 'owner-writer',
    materializePageTarget: (target) => (
      docToByPage(doc)[1]?.objects.find((object) => object.id === target.storageKey)
    ),
  });
  assert.equal(committed.status, 'committed');
  assert.deepEqual(docToByPage(doc)[1].objects, []);
  const outboxEffects = doc.getMap(ERASE_OUTBOX_MAP)
    .get('history-batch-120')
    .effects
    .filter((effect) => effect.type === 'annotation-delete-history');
  assert.equal(
    new Set(outboxEffects.map((effect) => effect.idempotencyKey)).size,
    3,
  );
  assert.equal(
    outboxEffects.every(
      (effect) => (
        new TextEncoder().encode(JSON.stringify(effect.payload)).byteLength
        <= MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES
      ),
    ),
    true,
  );

  const rows = outboxEffects.map((effect) => {
    const objectRestoreActions = buildAnnotationEraseDeleteHistoryRestoreActions(effect);
    return buildAnnotationEraseDeleteHistoryRow({
      objectRestoreActions,
      totalCount: objectRestoreActions.length,
      mutationId: 'history-batch-120',
      documentId: 'document-1',
      userId: 'owner',
      actorName: 'Owner',
      deletedAt: '2026-07-23T00:00:00.000Z',
      batchIndex: effect.payload.batchIndex,
      batchTotal: effect.payload.batchTotal,
      gestureTotalCount: effect.payload.gestureTotalCount,
    });
  });
  assert.equal(new Set(rows.map((row) => row.client_event_id)).size, 3);
  assert.deepEqual(rows.map((row) => row.payload.objects.length), [50, 50, 20]);
  const restoreActions = rows.flatMap(
    (row) => row.payload.objects.map((entry) => entry.restoreAction),
  );
  assert.deepEqual(
    restoreEraseDeletionOnDoc({ doc, restoreActions }),
    { status: 'applied', restored: 120 },
  );
  assert.deepEqual(docToByPage(doc)[1].objects, objects);

});

test('lane-only History keeps a huge full delete bounded and exactly restorable', async () => {
  const object = {
    type: 'rect',
    id: 'history-boundary',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    data: {
      id: 'history-boundary',
      tool: 'shape',
      authorId: 'owner',
      payload: 'x'.repeat(600_000),
    },
  };
  const rawIntent = buildEraseIntent({
    mutationId: 'history-boundary',
    pageNumber: 1,
    renderer: 'svg',
    gesture: { mode: 'full', radius: 2, points: [{ x: 0, y: 0 }] },
    targets: [{
      domain: 'page-object',
      storageKey: 'history-boundary',
      kind: 'shape',
      operation: 'delete',
      pageNumber: 1,
      index: 0,
      before: object,
    }],
  });
  const prepared = prepareEraseIntentForCommit({
    intent: rawIntent,
    annotationsByPage: { 1: { objects: [object] } },
    userId: 'owner',
    includeDeleteHistory: true,
  });
  const preparedBytes = new TextEncoder().encode(
    JSON.stringify(prepared.sideEffects[0].payload),
  ).byteLength;
  assert.ok(preparedBytes > MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES);

  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [object] } });
  const result = await localCommit(doc, prepared, {
    eraserWriterId: 'writer-a',
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  });
  assert.equal(result.status, 'committed');
  assert.deepEqual(docToByPage(doc)[1].objects, []);
  const effect = doc.getMap(ERASE_OUTBOX_MAP)
    .get('history-boundary')
    .effects
    .find((candidate) => candidate.type === 'annotation-delete-history');
  const persistedBytes = new TextEncoder().encode(
    JSON.stringify(effect.payload),
  ).byteLength;
  assert.ok(persistedBytes <= MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES);
  assert.equal(Object.hasOwn(effect.payload.mutations[0], 'before'), false);
  const restoreAction = buildAnnotationEraseDeleteHistoryRestoreActions(effect)[0]
    .restoreAction;
  assert.equal(Object.hasOwn(restoreAction, 'annotation'), false);
  assert.deepEqual(
    restoreEraseDeletionOnDoc({ doc, restoreActions: [restoreAction] }),
    { status: 'applied', restored: 1 },
  );
  assert.equal(
    docToByPage(doc)[1].objects[0].data.payload.length,
    600_000,
  );
});

test('partial-only erase creates no delete History payload', () => {
  const beforeInk = nativeInk('partial-history-free');
  const intent = buildIntent({
    mutationId: 'partial-history-free',
    targets: [{
      domain: 'page-object',
      storageKey: 'partial-history-free',
      kind: 'pen',
      operation: 'replace',
      before: beforeInk,
      after: { ...beforeInk, path: [['M', 0, 0], ['L', 25, 0]] },
      index: 0,
    }],
  });
  const prepared = prepareEraseIntentForCommit({
    intent,
    annotationsByPage: { 1: { objects: [beforeInk] } },
    userId: 'owner',
    includeDeleteHistory: true,
  });
  assert.deepEqual(prepared.sideEffects, []);
});

test('one failed outbox destination does not block independent effects in the gesture', async () => {
  const shape = pageObject('effect-shape', 'shape');
  const targets = [eraseTarget({
    domain: 'page-object',
    storageKey: 'effect-shape',
    kind: 'shape',
    operation: 'delete',
    before: shape,
  })];
  const doc = seedDoc(targets);
  await localCommit(doc, buildIntent({
    mutationId: 'effect-isolation',
    targets,
    sideEffects: [
      { type: 'destination-a', targetKey: 'effect-shape' },
      { type: 'destination-b', targetKey: 'effect-shape' },
      { type: 'destination-c', targetKey: 'effect-shape' },
    ],
  }));
  const attempted = [];
  await assert.rejects(
    () => drainEraseOutbox({
      doc,
      actorUserId: 'local-owner',
      executeEffect: async (effect) => {
        attempted.push(effect.type);
        if (effect.type === 'destination-a') throw new Error('destination unavailable');
      },
    }),
    /erase outbox effect/,
  );
  assert.deepEqual(attempted, ['destination-a', 'destination-b', 'destination-c']);
  const entry = doc.getMap(ERASE_OUTBOX_MAP).get('effect-isolation');
  assert.equal(entry.status, 'pending');
  assert.deepEqual(
    entry.acknowledgedEffectKeys.sort(),
    [
      'effect-isolation:destination-b:effect-shape',
      'effect-isolation:destination-c:effect-shape',
    ],
  );
});

test('hundreds of large partial-erase effects compact current state while measuring append-only WAL cost', async (t) => {
  const longInk = nativeInk('stress-ink');
  longInk.path = [
    ['M', 0, 50],
    ...Array.from({ length: 1_500 }, (_, index) => ['L', index + 1, 50]),
  ];
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [longInk] } });
  let cumulativeUpdateBytes = 0;
  let persistedUpdateCount = 0;
  doc.on('update', (update, origin) => {
    if (origin !== 'erase-local' && origin !== 'erase-outbox') return;
    cumulativeUpdateBytes += update.byteLength;
    persistedUpdateCount += 1;
  });

  const buildStressIntent = (mutationId, before, revision, sideEffects = []) => {
    const after = {
      ...clone(before),
      geometryRevision: revision,
      path: [
        ...before.path.slice(0, -1),
        ['L', 1_500, 50 + ((revision % 7) + 1) / 100],
      ],
    };
    return buildIntent({
      mutationId,
      targets: [{
        domain: 'page-object',
        storageKey: 'stress-ink',
        kind: 'pen',
        operation: 'replace',
        pageNumber: 1,
        index: 0,
        before,
        after,
      }],
      gesture: {
        mode: 'partial',
        radius: 7,
        points: [{ x: revision % 1_500, y: 50 }],
      },
      sideEffects,
    });
  };

  for (
    let revision = 1;
    revision <= MAX_ACKNOWLEDGED_ERASE_TOMBSTONES + 64;
    revision += 1
  ) {
    const before = docToByPage(doc)[1].objects[0];
    const intent = buildStressIntent(
      `stress-erase-${String(revision).padStart(4, '0')}`,
      before,
      revision,
    );
    assert.equal((await localCommit(doc, intent)).status, 'committed');
    await drainEraseOutbox({
      doc,
      actorUserId: 'local-owner',
      executeEffect: async () => {},
    });
  }

  const outbox = doc.getMap(ERASE_OUTBOX_MAP);
  assert.equal(outbox.size, MAX_ACKNOWLEDGED_ERASE_TOMBSTONES);
  for (const entry of outbox.values()) {
    assert.equal(entry.status, 'acknowledged');
    assert.deepEqual(entry.effects, []);
    assert.deepEqual(entry.acknowledgedEffectKeys, []);
    assert.ok(JSON.stringify(entry).length < 300);
  }
  const currentSnapshotBytes = Y.encodeStateAsUpdate(doc).byteLength;
  assert.ok(
    currentSnapshotBytes < 500_000,
    'compacted Y.Doc snapshot must not retain historical geometry payloads',
  );
  assert.ok(
    cumulativeUpdateBytes > currentSnapshotBytes,
    'append-only persisted updates include historical payloads even when current state is compact',
  );
  assert.ok(
    cumulativeUpdateBytes < 10_000_000,
    '320 partial gestures must stay within the explicit append-only WAL budget',
  );
  t.diagnostic(JSON.stringify({
    eraseOperations: MAX_ACKNOWLEDGED_ERASE_TOMBSTONES + 64,
    persistedUpdateCount,
    cumulativeUpdateBytes,
    currentSnapshotBytes,
  }));

  const pendingBefore = docToByPage(doc)[1].objects[0];
  const pendingIntent = buildStressIntent(
    'stress-pending-recovery',
    pendingBefore,
    10_000,
    [{
      type: 'destination',
      targetKey: 'stress-ink',
      payload: { revision: 10_000 },
    }],
  );
  assert.equal((await localCommit(doc, pendingIntent)).status, 'committed');
  await assert.rejects(
    () => drainEraseOutbox({
      doc,
      actorUserId: 'local-owner',
      executeEffect: async () => {
        throw new Error('offline history');
      },
    }),
    /erase outbox effect/,
  );
  const pendingEntry = outbox.get('stress-pending-recovery');
  assert.equal(pendingEntry.status, 'pending');
  assert.ok(
    JSON.stringify(pendingEntry).length < 1_000,
    'pending delete-side metadata must not retain partial geometry',
  );

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  await drainEraseOutbox({
    doc: reopened,
    actorUserId: 'local-owner',
    executeEffect: async () => {},
  });
  const recoveredEntry = reopened.getMap(ERASE_OUTBOX_MAP).get('stress-pending-recovery');
  assert.equal(recoveredEntry.status, 'acknowledged');
  assert.deepEqual(recoveredEntry.effects, []);
  assert.ok(reopened.getMap(ERASE_OUTBOX_MAP).size <= MAX_ACKNOWLEDGED_ERASE_TOMBSTONES);
  assert.ok(
    Y.encodeStateAsUpdate(reopened).byteLength < 500_000,
    'recovery compaction must remove the pending geometry payload',
  );
  assert.equal((await localCommit(reopened, pendingIntent)).status, 'noop');
});

test('legacy sync validates every lane before mutation when a later target cannot replay', () => {
  const first = nativeInk('lane-a');
  const second = {
    ...nativeInk('lane-b'),
    path: [['M', 0, 250], ['L', 100, 250]],
  };
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [first, second] } });
  const before = Y.encodeStateAsUpdate(doc);
  const beforeOps = [...doc.getMap('annotationEraserOps').entries()];

  assert.throws(
    () => syncByPageToDoc(doc, {
      1: {
        objects: [first, second],
        eraserMutation: {
          id: 'two-target-replay-failure',
          pageNumber: 1,
          points: [{ x: 50, y: 50 }],
          radius: 7,
          mode: 'partial',
          touchedIds: ['lane-a', 'lane-b'],
          changedIds: ['lane-a', 'lane-b'],
          deletedIds: [],
          objectMutations: [
            {
              index: 0,
              storageKey: 'lane-a',
              annotationId: 'lane-a',
              deleted: false,
              survivor: first,
            },
            {
              index: 1,
              storageKey: 'lane-b',
              annotationId: 'lane-b',
              deleted: false,
              survivor: second,
            },
          ],
        },
      },
    }, { eraserWriterId: 'writer-a' }),
    /partial eraser lane could not be replayed for lane-b/,
  );

  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.deepEqual([...doc.getMap('annotationEraserOps').entries()], beforeOps);
});

test('sequential cross-writer partial erase keeps independent lanes so Undo restores only A', async () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [nativeInk()] } });

  assert.equal(
    (await commitAtomicWriterBite(
      doc,
      'writer-a',
      'sequential-a',
      { x: 35, y: 38 },
    )).status,
    'committed',
  );
  assert.equal(
    (await commitAtomicWriterBite(
      doc,
      'writer-b',
      'sequential-b',
      { x: 70, y: 62 },
    )).status,
    'committed',
  );
  clearEraserOpsForAnnotationIds(doc, ['shared-ink'], {
    origin: 'history',
    writerId: 'writer-a',
  });

  let survivor = docToByPage(doc)[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true, 'A bite is undone');
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false, 'B bite remains');
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  survivor = docToByPage(reopened)[1].objects[0];
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false);
});

test('outline-only writer lanes stay independent across sequential erase, Undo, and reload', async (t) => {
  for (const geometryKind of ['polygons', 'cmds']) {
    await t.test(geometryKind, async () => {
      const annotationId = `${geometryKind}-only-ink`;
      const doc = new Y.Doc();
      syncByPageToDoc(doc, {
        1: { objects: [outlineOnlyInk(annotationId, geometryKind)] },
      });

      assert.equal(
        (await commitAtomicWriterBite(
          doc,
          'writer-a',
          `${geometryKind}-a`,
          { x: 35, y: 38 },
        )).status,
        'committed',
      );
      assert.equal(
        (await commitAtomicWriterBite(
          doc,
          'writer-b',
          `${geometryKind}-b`,
          { x: 70, y: 62 },
        )).status,
        'committed',
      );
      clearEraserOpsForAnnotationIds(doc, [annotationId], {
        origin: 'history',
        writerId: 'writer-a',
      });

      let survivor = docToByPage(doc)[1].objects[0];
      assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true);
      assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false);
      const reopened = new Y.Doc();
      Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
      survivor = docToByPage(reopened)[1].objects[0];
      assert.equal(pointInPolygonSet({ x: 35, y: 41 }, survivor.polygons), true);
      assert.equal(pointInPolygonSet({ x: 70, y: 59 }, survivor.polygons), false);
    });
  }
});

test('zero-effect erase is acknowledged immediately and never enters retry', async () => {
  const shape = pageObject('shape-only', 'rect');
  const targets = [eraseTarget({
    domain: 'page-object',
    storageKey: 'shape-only',
    kind: 'shape',
    operation: 'delete',
    before: shape,
  })];
  const doc = seedDoc(targets);
  let executions = 0;
  const handle = await openAnnotationDoc({
    documentId: `zero-effect-${crypto.randomUUID()}`,
    actorUserId: 'owner',
    doc,
    supabase: null,
    enableLocal: false,
    enableRealtime: false,
    eraseOutboxRetryBaseMs: 5,
    eraseEffectConsumer: async () => {
      executions += 1;
    },
  });

  const intent = buildIntent({
    mutationId: 'zero-effect-erase',
    targets,
    sideEffects: [],
  });
  const result = await handle.commitEraseIntent(intent, {
    permissionContext: { mode: 'local-only' },
  });
  const drained = await handle.drainEraseOutbox();

  assert.equal(result.status, 'committed');
  assert.equal(
    doc.getMap(ERASE_OUTBOX_MAP).get('zero-effect-erase').status,
    'acknowledged',
  );
  assert.equal(drained.pending, 0);
  assert.equal(drained.acknowledged, 0);
  assert.equal(executions, 0);
  await handle.destroy();
});

test('pending erase effects can only be recovered by the initiating actor', async () => {
  const shape = pageObject('actor-shape', 'shape');
  const targets = [eraseTarget({
    domain: 'page-object',
    storageKey: 'actor-shape',
    kind: 'shape',
    operation: 'delete',
    before: shape,
  })];
  const committed = seedDoc(targets);
  await localCommit(
    committed,
    buildIntent({
      mutationId: 'actor-a-erase',
      targets,
      sideEffects: [{ type: 'destination', targetKey: 'actor-shape' }],
    }),
    { actorUserId: 'actor-a' },
  );
  assert.equal(
    committed.getMap(ERASE_OUTBOX_MAP).get('actor-a-erase').actorUserId,
    'actor-a',
  );

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(committed));
  const actorBEffects = [];
  const actorB = await openAnnotationDoc({
    documentId: `actor-outbox-${crypto.randomUUID()}`,
    actorUserId: 'actor-b',
    doc: reopened,
    supabase: null,
    enableLocal: false,
    enableRealtime: false,
    eraseEffectConsumer: async (effect) => actorBEffects.push(effect.idempotencyKey),
  });
  const actorBDrain = await actorB.drainEraseOutbox();
  assert.deepEqual(actorBEffects, []);
  assert.equal(actorBDrain.pending, 0, 'foreign work does not create a retry loop');
  assert.equal(reopened.getMap(ERASE_OUTBOX_MAP).get('actor-a-erase').status, 'pending');
  await actorB.destroy();

  const actorAEffects = [];
  const actorA = await openAnnotationDoc({
    documentId: `actor-outbox-recovery-${crypto.randomUUID()}`,
    actorUserId: 'actor-a',
    doc: reopened,
    supabase: null,
    enableLocal: false,
    enableRealtime: false,
    eraseEffectConsumer: async (effect, context) => {
      actorAEffects.push([effect.idempotencyKey, context.actorUserId]);
    },
  });
  await actorA.drainEraseOutbox();
  assert.deepEqual(actorAEffects, [[
    'actor-a-erase:destination:actor-shape',
    'actor-a',
  ]]);
  assert.equal(reopened.getMap(ERASE_OUTBOX_MAP).get('actor-a-erase').status, 'acknowledged');
  await actorA.destroy();
});

test('fake IndexedDB survives destroy/reopen with geometry and pending outbox', async () => {
  const documentId = `idb-erase-${crypto.randomUUID()}`;
  const actorUserId = 'local-owner';
  let first = null;
  let reopened = null;
  try {
    const firstDoc = new Y.Doc();
    first = await openAnnotationDoc({
      documentId,
      actorUserId,
      doc: firstDoc,
      supabase: null,
      enableLocal: true,
      enableRealtime: false,
      localSyncTimeoutMs: 1_000,
      eraseOutboxRetryBaseMs: 60_000,
      eraseEffectConsumer: async () => {
        throw new Error('offline sink');
      },
    });
    const ink = nativeInk('persisted-ink');
    const shape = pageObject('persisted-shape', 'rect', { left: 80 });
    const deletedShape = pageObject('persisted-deleted-shape', 'rect', { left: 140 });
    first.applyByPage({ 1: { objects: [ink, shape, deletedShape] } });
    const storedInk = first.getByPage()[1].objects.find(
      (object) => object.data.id === 'persisted-ink',
    );
    const persistedGesture = {
      mode: 'partial',
      radius: 7,
      points: [{ x: 35, y: 38 }],
    };
    const erasedInk = erasePageAnnotations({
      pageAnnotations: { objects: [storedInk] },
      eraserPoints: persistedGesture.points,
      eraserRadius: persistedGesture.radius,
      mode: persistedGesture.mode,
    }).objectMutations[0]?.survivor;
    assert.ok(erasedInk, 'fixture produces a real persisted partial-erase survivor');
    const intent = buildIntent({
      mutationId: 'persisted-erase',
      gesture: persistedGesture,
      targets: [
        eraseTarget({
          domain: 'page-object',
          storageKey: 'persisted-ink',
          kind: 'pen',
          operation: 'replace',
          before: storedInk,
          after: erasedInk,
        }),
        eraseTarget({
          domain: 'page-object',
          storageKey: 'persisted-deleted-shape',
          kind: 'shape',
          operation: 'delete',
          before: deletedShape,
        }),
      ],
      sideEffects: [{
        type: 'destination',
        targetKey: 'persisted-deleted-shape',
        payload: { before: deletedShape },
      }],
    });

    await first.commitEraseIntent(intent, {
      permissionContext: { mode: 'local-only' },
    });
    await first.drainEraseOutbox();
    assert.equal(
      firstDoc.getMap(ERASE_OUTBOX_MAP).get('persisted-erase').status,
      'pending',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    await first.destroy();
    first = null;

    const effects = [];
    const reopenedDoc = new Y.Doc();
    reopened = await openAnnotationDoc({
      documentId,
      actorUserId,
      doc: reopenedDoc,
      supabase: null,
      enableLocal: true,
      enableRealtime: false,
      localSyncTimeoutMs: 1_000,
      eraseEffectConsumer: async (effect) => {
        effects.push(effect.idempotencyKey);
      },
    });
    await reopened.drainEraseOutbox();

    const reopenedObjects = reopened.getByPage()[1].objects;
    const reopenedInk = reopenedObjects.find(
      (object) => object.data.id === 'persisted-ink',
    );
    assert.equal(pointInPolygonSet({ x: 35, y: 41 }, reopenedInk.polygons), false);
    assert.equal(pointInPolygonSet({ x: 35, y: 50 }, reopenedInk.polygons), true);
    assert.ok(
      reopenedObjects.some((object) => object.data.id === 'persisted-shape'),
      'untouched geometry also survives the fresh Y.Doc',
    );
    assert.equal(
      reopenedObjects.some((object) => object.data.id === 'persisted-deleted-shape'),
      false,
    );
    assert.deepEqual(effects, ['persisted-erase:destination:persisted-deleted-shape']);
    assert.equal(
      reopenedDoc.getMap(ERASE_OUTBOX_MAP).get('persisted-erase').status,
      'acknowledged',
    );
  } finally {
    await first?.destroy().catch(() => {});
    await reopened?.destroy().catch(() => {});
    await purgeAnnotationDoc(documentId).catch(() => {});
  }
});

test('outbox crash window retries the same idempotency key after a fresh Y.Doc', async () => {
  const shape = pageObject('crash-shape', 'shape');
  const targets = [eraseTarget({
    domain: 'page-object',
    storageKey: 'crash-shape',
    kind: 'shape',
    operation: 'delete',
    before: shape,
  })];
  const original = seedDoc(targets);
  const intent = buildIntent({
    mutationId: 'crash-window',
    targets,
    sideEffects: [{ type: 'destination', targetKey: 'crash-shape' }],
  });
  await localCommit(original, intent);
  const seen = [];

  await assert.rejects(
    () => drainEraseOutbox({
      doc: original,
      actorUserId: 'local-owner',
      executeEffect: async (effect) => {
        seen.push(effect.idempotencyKey);
      },
      injectFailure: () => {
        throw new Error('crash before ack');
      },
    }),
    /crash before ack/,
  );

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(original));
  await drainEraseOutbox({
    doc: reopened,
    actorUserId: 'local-owner',
    executeEffect: async (effect) => {
      seen.push(effect.idempotencyKey);
    },
  });

  assert.deepEqual(seen, [
    'crash-window:destination:crash-shape',
    'crash-window:destination:crash-shape',
  ]);
  assert.equal(
    reopened.getMap(ERASE_OUTBOX_MAP).get('crash-window').status,
    'acknowledged',
  );
});

// Owner ruling 2026-09-28 (open editing + lock): an Undo / Redo of an erase
// never changes a mark someone has user-locked since the erase.
test('erase Undo / Redo stops at a mark that was user-locked after the erase', async () => {
  const ink = nativeInk('locked-after-erase');
  const gesture = { mode: 'partial', radius: 7, points: [{ x: 50, y: 50 }] };
  const survivor = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: gesture.points,
    eraserRadius: gesture.radius,
    mode: gesture.mode,
  }).objectMutations[0]?.survivor;
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [ink] } });
  const result = await localCommit(doc, buildIntent({
    mutationId: 'lock-after-erase',
    gesture,
    targets: [{
      domain: 'page-object',
      storageKey: 'locked-after-erase',
      kind: 'pen',
      operation: 'replace',
      pageNumber: 1,
      index: 0,
      before: ink,
      after: survivor,
    }],
  }), {
    eraserWriterId: 'writer-a',
    materializePageTarget: () => docToByPage(doc)[1].objects[0],
  });
  assert.equal(result.status, 'committed');
  const stored = readRawAnnotationEntry(doc, 'locked-after-erase');
  writeAnnotationMark(doc, 'locked-after-erase', stored.p, {
    ...stored.o,
    data: { ...(stored.o.data || {}), lockedBy: 'user-author' },
  });
  const undo = applyEraseHistoryTransitionOnDoc({ doc, transition: result.historyTransition, direction: 'undo' });
  assert.equal(undo.status, 'conflict');
  assert.equal(undo.reason, 'locked');
  const visible = docToByPage(doc)[1].objects[0];
  assert.equal(pointInPolygonSet(gesture.points[0], visible.polygons), false, 'the erased bite stays');
});

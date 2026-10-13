import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

import {
  getAnnotationRenderIdentity,
  stampAnnotationCreationIdentity,
} from '../src/utils/annotationStorageIdentity.js';
import {
  buildAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
} from '../src/utils/annotationLocalHistory.js';
import {
  deserializeRowToFabricObject,
  serializeFabricObjectToRow,
} from '../src/services/annotationTypeSerializers.js';
import {
  docToByPage,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';
import { buildBulkDeletePlan } from '../src/lib/collab/bulkDeletePlan.js';
import { getAnnotationAuthorId } from '../src/lib/collab/permissionScope.js';

const OWNER_ID = 'owner-user';
const COLLABORATOR_ID = 'collaborator-user';

function newText() {
  return {
    type: 'Textbox',
    text: 'KAL-435 collaborator text',
    left: 10,
    top: 20,
    width: 180,
    height: 32,
    data: { id: 'kal435-text' },
  };
}

function newCircle() {
  return {
    type: 'ellipse',
    id: 'kal435-circle',
    left: 50,
    top: 60,
    rx: 20,
    ry: 15,
    data: { id: 'kal435-circle' },
  };
}

test('KAL-435 local create stamps canonical id and write-once collaborator author', () => {
  const committed = {
    objects: [newText(), newCircle()].map((annotation) => (
      stampAnnotationCreationIdentity(annotation, { authorId: COLLABORATOR_ID })
    )),
  };

  assert.equal(committed.objects[0].id, 'kal435-text');
  assert.equal(committed.objects[0].data.id, 'kal435-text');
  assert.equal(committed.objects[0].meta.authorId, COLLABORATOR_ID);
  assert.equal(committed.objects[1].id, 'kal435-circle');
  assert.equal(committed.objects[1].meta.authorId, COLLABORATOR_ID);

  assert.deepEqual(getAnnotationRenderIdentity(committed.objects[0]), {
    annotationId: 'kal435-text',
    authorId: COLLABORATOR_ID,
  });
  assert.deepEqual(getAnnotationRenderIdentity(committed.objects[1]), {
    annotationId: 'kal435-circle',
    authorId: COLLABORATOR_ID,
  });
});

test('KAL-435 serialization and Y.Doc hydration preserve collaborator identity', () => {
  const committed = {
    objects: [newText(), newCircle()].map((annotation) => (
      stampAnnotationCreationIdentity(annotation, { authorId: COLLABORATOR_ID })
    )),
  };

  for (const annotation of committed.objects) {
    const row = serializeFabricObjectToRow(structuredClone(annotation), {
      documentId: 'kal435-document',
      userId: COLLABORATOR_ID,
      pageNumber: 1,
    });
    const deserialized = deserializeRowToFabricObject(row).fabricObject;
    assert.equal(
      getAnnotationRenderIdentity(deserialized).annotationId,
      annotation.id,
    );
    assert.equal(getAnnotationAuthorId(deserialized), COLLABORATOR_ID);
  }

  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: committed });
  const hydrated = docToByPage(doc)[1].objects;
  assert.deepEqual(
    hydrated.map((annotation) => getAnnotationRenderIdentity(annotation)),
    [
      { annotationId: 'kal435-text', authorId: COLLABORATOR_ID },
      { annotationId: 'kal435-circle', authorId: COLLABORATOR_ID },
    ],
  );
});

test('KAL-435 two replicas replay the same create exactly once with stable identity', () => {
  const created = stampAnnotationCreationIdentity(newCircle(), {
    authorId: COLLABORATOR_ID,
  });
  const replicaA = new Y.Doc();
  const replicaB = new Y.Doc();

  syncByPageToDoc(replicaA, { 1: { objects: [created] } });
  Y.applyUpdate(replicaB, Y.encodeStateAsUpdate(replicaA));

  // Replica B replays the hydrated object through the normal save boundary
  // while A independently replays the original create. Both writes address
  // the same canonical storage key and must converge to one object.
  syncByPageToDoc(replicaB, docToByPage(replicaB));
  syncByPageToDoc(replicaA, { 1: { objects: [structuredClone(created)] } });
  Y.applyUpdate(replicaA, Y.encodeStateAsUpdate(replicaB));
  Y.applyUpdate(replicaB, Y.encodeStateAsUpdate(replicaA));

  const coldReload = new Y.Doc();
  Y.applyUpdate(coldReload, Y.encodeStateAsUpdate(replicaA));
  const objects = docToByPage(coldReload)[1].objects;
  assert.equal(objects.length, 1, 'replay and merge cannot duplicate the annotation');
  assert.deepEqual(getAnnotationRenderIdentity(objects[0]), {
    annotationId: 'kal435-circle',
    authorId: COLLABORATOR_ID,
  });
  assert.equal(getAnnotationAuthorId(objects[0]), COLLABORATOR_ID);
});

test('KAL-435 collaborator history and delete authority recognize own creates', () => {
  const currentPage = { objects: [] };
  const committed = {
    objects: [
      stampAnnotationCreationIdentity(newText(), { authorId: COLLABORATOR_ID }),
      stampAnnotationCreationIdentity(newCircle(), { authorId: COLLABORATOR_ID }),
    ],
  };
  for (const annotation of committed.objects) {
    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: currentPage,
      nextPage: { objects: [annotation] },
    });
    assert.equal(action.type, 'fabric:create');
    assert.equal(
      filterAnnotationHistoryActionByOwner(action, COLLABORATOR_ID, OWNER_ID),
      action,
    );
  }

  const plan = buildBulkDeletePlan({
    candidateIds: ['kal435-text', 'kal435-circle'],
    annotations: committed.objects,
    viewerId: COLLABORATOR_ID,
    documentOwnerId: OWNER_ID,
  });
  // RULED 2026-09-28 owner: open editing + lock — 'collaborator-all-mine' collapsed into 'direct' (no modal).
  assert.equal(plan.mode, 'direct');
  assert.deepEqual(plan.ownIds, ['kal435-text', 'kal435-circle']);
  assert.deepEqual(plan.foreignIds, []);
});

test('KAL-435 edit cannot erase or overwrite the original author', () => {
  const original = {
    ...newCircle(),
    meta: { authorId: OWNER_ID },
  };
  const committedEdit = stampAnnotationCreationIdentity({
    ...original,
    left: 75,
  }, {
    authorId: COLLABORATOR_ID,
  });

  assert.equal(committedEdit.left, 75);
  assert.equal(getAnnotationAuthorId(committedEdit), OWNER_ID);
  const editAction = buildAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: { objects: [original] },
    nextPage: { objects: [committedEdit] },
  });
  // RULED 2026-09-28 owner: open editing + lock — the collaborator's edit of the owner's mark is the collaborator's own undo step (author still unchanged above).
  assert.equal(
    filterAnnotationHistoryActionByOwner(editAction, COLLABORATOR_ID, OWNER_ID),
    editAction,
  );
  assert.equal(getAnnotationAuthorId(editAction.after), OWNER_ID);
});

test('KAL-435 legacy render author is promoted without reauthoring delete authority', () => {
  const committed = stampAnnotationCreationIdentity({
    ...newCircle(),
    __meta: { authorId: OWNER_ID },
  }, {
    authorId: COLLABORATOR_ID,
  });

  assert.equal(committed.meta.authorId, OWNER_ID);
  assert.equal(getAnnotationRenderIdentity(committed).authorId, OWNER_ID);
  assert.equal(getAnnotationAuthorId(committed), OWNER_ID);
});

test('KAL-435 production text/shape commits and SVG DOM consume canonical identity', () => {
  const svgSource = readFileSync(
    new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
    'utf8',
  );
  const textSource = readFileSync(
    new URL('../src/components/TextEditOverlay.jsx', import.meta.url),
    'utf8',
  );
  const viewerSource = readFileSync(
    new URL('../src/PDFViewer.jsx', import.meta.url),
    'utf8',
  );

  assert.match(
    svgSource,
    /const json = stampAnnotationCreationIdentity\(rawJson, \{ authorId: viewerId \}\);/,
  );
  assert.match(svgSource, /data-annotation-id=\{renderIdentity\.annotationId\}/);
  assert.match(svgSource, /data-anno-id=\{renderIdentity\.annotationId\}/);
  assert.match(svgSource, /data-author-id=\{renderIdentity\.authorId\}/);
  assert.match(
    textSource,
    /json = stampAnnotationCreationIdentity\(json, \{ authorId \}\);/,
  );
  assert.match(viewerSource, /authorId=\{user\?\.id \?\? null\}/);
});

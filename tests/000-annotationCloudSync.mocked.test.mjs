/**
 * annotationCloudSync coverage with a mocked supabase client.
 * Requires --experimental-test-module-mocks (enabled in scripts/run-coverage.mjs).
 */
import { mock, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function makeSupabaseMock(state) {
  const calls = [];
  const chain = {};
  const methods = [
    'from', 'upsert', 'select', 'delete', 'eq', 'in', 'or', 'order', 'limit', 'gt', 'lt', 'gte', 'lte', 'neq', 'is', 'not', 'filter', 'match',
  ];
  for (const name of methods) {
    chain[name] = (...args) => {
      calls.push([name, ...args]);
      return chain;
    };
  }
  chain.single = async () => {
    calls.push(['single']);
    if (state.throwOnQuery) throw state.throwOnQuery;
    return {
      data: state.upsertError ? null : { annotation_id: 'a1', updated_at: 't' },
      error: state.upsertError,
    };
  };
  chain.maybeSingle = chain.single;
  chain.then = (onFulfilled, onRejected) => {
    if (state.throwOnQuery) {
      return Promise.reject(state.throwOnQuery).then(onFulfilled, onRejected);
    }
    return Promise.resolve({
      data: state.upsertError ? null : (state.rows || []),
      error: state.upsertError || state.deleteError || null,
      count: state.count || 0,
    }).then(onFulfilled, onRejected);
  };

  const channels = [];
  chain.channel = (name) => {
    calls.push(['channel', name]);
    const handlers = [];
    let statusCb = null;
    const ch = {
      on(event, filter, cb) {
        handlers.push({ event, filter, cb });
        return ch;
      },
      subscribe(cb) {
        statusCb = cb;
        queueMicrotask(() => cb && cb('SUBSCRIBED', null));
        return ch;
      },
      __handlers: handlers,
      __fire(event, payload) {
        for (const h of handlers) {
          if (h.filter?.event === event) h.cb(payload);
        }
      },
      __status(status, err) {
        if (statusCb) statusCb(status, err);
      },
    };
    channels.push(ch);
    return ch;
  };
  chain.removeChannel = (ch) => {
    calls.push(['removeChannel', ch]);
  };

  return { client: chain, calls, channels };
}

const supabaseUrl = pathToFileURL(resolve('src/supabaseClient.js')).href;
const state = { upsertError: null, deleteError: null, rows: [], count: 0 };
let fake;

before(() => {
  fake = makeSupabaseMock(state);
  mock.module(supabaseUrl, {
    namedExports: {
      supabase: fake.client,
      isSupabaseAvailable: () => true,
      isAuthRefreshTokenError: () => false,
      clearSupabaseAuthStorage: () => {},
      recoverSupabaseAuthSession: async () => null,
      getSupabaseSession: async () => null,
      getAuthSnapshot: async () => ({ session: null, user: null }),
      isSchemaError: () => false,
      isConnectedServicesAvailable: () => false,
      setConnectedServicesAvailable: () => {},
    },
  });
});

test('upsertFabricAnnotation / upsertAnnotationsByPage succeed with mocked supabase', async () => {
  const {
    upsertFabricAnnotation,
    upsertAnnotationsByPage,
    upsertCallouts,
    deleteAnnotation,
    deleteAnnotations,
    loadAllNonSurveyMarkerAnnotations,
    loadAllTypesOwnedWatermark,
  } = await import('../src/services/annotationCloudSync.js');

  const fabric = {
    type: 'path',
    left: 1,
    top: 2,
    path: [['M', 0, 0], ['L', 10, 0]],
    data: { id: 'anno-live-1' },
  };
  const opts = { documentId: 'd1', userId: 'u1', pageNumber: 1 };
  const up = await upsertFabricAnnotation(fabric, opts);
  assert.equal(up.error, null);
  assert.ok(up.data);

  const page = await upsertAnnotationsByPage(
    {
      1: {
        objects: [
          fabric,
          { type: 'path', left: null, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'imp-1' } },
        ],
      },
    },
    opts,
  );
  assert.equal(page.error, null);

  const empty = await upsertAnnotationsByPage({}, { documentId: 'd1', userId: 'u1' });
  assert.equal(empty.error, null);

  const callouts = await upsertCallouts(
    [{
      id: 'c1',
      pageNumber: 1,
      text: 'hi',
      arrowTip: { x: 0, y: 0 },
      knee: { x: 1, y: 1 },
      textBoxPosition: { x: 2, y: 2 },
      textBoxWidth: 10,
      textBoxHeight: 10,
    }],
    opts,
  );
  assert.ok(callouts);

  const del = await deleteAnnotation('d1', 'anno-live-1');
  assert.equal(del.error, null);

  const delMany = await deleteAnnotations('d1', ['a', 'b', null]);
  assert.ok(delMany);

  const emptyDel = await deleteAnnotations('d1', []);
  assert.equal(emptyDel.success, true);

  globalThis.window = { __crdtForceLegacyFail: true, __CLOUD_SYNC_DEBUG: true };
  try {
    const forced = await upsertAnnotationsByPage({ 1: { objects: [fabric] } }, opts);
    assert.ok(forced.error);
  } finally {
    delete globalThis.window;
  }

  const loaded = await loadAllNonSurveyMarkerAnnotations('d1');
  assert.ok(loaded);
  assert.equal(loaded.error, null);

  const watermark = await loadAllTypesOwnedWatermark('d1');
  assert.ok(watermark);
  assert.equal(watermark.error, null);
});

test('subscribeToAllNonSurveyMarkerAnnotations routes insert/update/delete', async () => {
  const { subscribeToAllNonSurveyMarkerAnnotations } = await import('../src/services/annotationCloudSync.js');

  const seen = {
    fabricInsert: 0,
    fabricUpdate: 0,
    fabricDelete: 0,
    calloutInsert: 0,
    calloutUpdate: 0,
    calloutDelete: 0,
    deleteFallback: 0,
    subscribed: 0,
    errors: 0,
  };

  globalThis.window = { __CLOUD_SYNC_DEBUG: true };
  try {
    const unsub = subscribeToAllNonSurveyMarkerAnnotations(
      'doc-rt',
      {
        onFabricInsert: () => { seen.fabricInsert += 1; },
        onFabricUpdate: () => { seen.fabricUpdate += 1; },
        onFabricDelete: () => { seen.fabricDelete += 1; },
        onCalloutInsert: () => { seen.calloutInsert += 1; },
        onCalloutUpdate: () => { seen.calloutUpdate += 1; },
        onCalloutDelete: () => { seen.calloutDelete += 1; },
        onDeleteFallback: () => { seen.deleteFallback += 1; },
        onSubscribed: () => { seen.subscribed += 1; },
        onError: () => { seen.errors += 1; },
      },
      { currentUserId: 'u1', currentSessionId: 'sess-local' },
    );

    await new Promise((r) => setTimeout(r, 5));
    assert.equal(seen.subscribed, 1);

    const ch = fake.channels.at(-1);
    assert.ok(ch);

    // Echo filter: same session → dropped
    ch.__fire('INSERT', {
      new: {
        annotation_id: 'e1',
        annotation_type: 'ink',
        annotation_data: { clientSessionId: 'sess-local', fabricObject: { type: 'path' } },
        page_number: 1,
      },
    });
    assert.equal(seen.fabricInsert, 0);

    // Remote fabric insert
    ch.__fire('INSERT', {
      new: {
        annotation_id: 'f1',
        annotation_type: 'ink',
        annotation_data: {
          clientSessionId: 'other',
          fabricObject: { type: 'path', path: [['M', 0, 0], ['L', 1, 0]], left: 0, top: 0 },
          pageNumber: 1,
        },
        page_number: 1,
        last_modified_by: 'u2',
      },
    });
    assert.ok(seen.fabricInsert >= 1);

    ch.__fire('UPDATE', {
      new: {
        annotation_id: 'f1',
        annotation_type: 'ink',
        annotation_data: {
          clientSessionId: 'other',
          fabricObject: { type: 'path', path: [['M', 0, 0], ['L', 2, 0]], left: 0, top: 0 },
          pageNumber: 1,
        },
        page_number: 1,
        last_modified_by: 'u2',
      },
    });
    assert.ok(seen.fabricUpdate >= 1);

    // Callout insert
    ch.__fire('INSERT', {
      new: {
        annotation_id: 'c1',
        annotation_type: 'callout',
        annotation_data: {
          clientSessionId: 'other',
          callout: {
            id: 'c1',
            pageNumber: 1,
            arrowTip: { x: 0, y: 0 },
            knee: { x: 1, y: 1 },
            textBoxPosition: { x: 2, y: 2 },
            textBoxWidth: 10,
            textBoxHeight: 10,
            text: 'x',
          },
        },
        page_number: 1,
        last_modified_by: 'u2',
      },
    });

    // Callout update success path (line ~708)
    ch.__fire('UPDATE', {
      new: {
        annotation_id: 'c1',
        annotation_type: 'callout',
        annotation_data: {
          clientSessionId: 'other',
          callout: {
            id: 'c1',
            pageNumber: 1,
            arrowTip: { x: 0, y: 0 },
            knee: { x: 1, y: 1 },
            textBoxPosition: { x: 2, y: 2 },
            textBoxWidth: 10,
            textBoxHeight: 10,
            text: 'updated',
          },
        },
        page_number: 1,
        last_modified_by: 'u2',
      },
    });

    // Callout update with corrupt payload → deserialize catch
    ch.__fire('UPDATE', {
      new: {
        annotation_id: 'c-bad',
        annotation_type: 'callout',
        annotation_data: { clientSessionId: 'other' },
        page_number: 1,
        last_modified_by: 'u2',
      },
    });

    // DELETE with incomplete payload → fallback
    ch.__fire('DELETE', { old: {} });
    assert.ok(seen.deleteFallback >= 1);

    // DELETE callout
    ch.__fire('DELETE', { old: { annotation_id: 'c1', annotation_type: 'callout' } });
    assert.ok(seen.calloutDelete >= 1);

    // DELETE fabric
    ch.__fire('DELETE', { old: { annotation_id: 'f1', annotation_type: 'ink' } });
    assert.ok(seen.fabricDelete >= 1);

    // Survey marker delete ignored
    ch.__fire('DELETE', { old: { annotation_id: 'sm', annotation_type: 'surveyMarker' } });

    // Subscribe error path
    ch.__status('CHANNEL_ERROR', new Error('rt-fail'));
    assert.ok(seen.errors >= 1);

    // onSubscribed throw
    const unsub2 = subscribeToAllNonSurveyMarkerAnnotations('doc-rt-2', {
      onSubscribed: () => { throw new Error('sub-cb'); },
    });
    await new Promise((r) => setTimeout(r, 5));
    unsub2();
    unsub();
  } finally {
    delete globalThis.window;
  }
});

test('dualWriteFabricCommit/Delete fire CRDT when ydoc present', async () => {
  const Y = await import('yjs');
  const { dualWriteFabricCommit, dualWriteFabricDelete } = await import('../src/services/annotationCloudSync.js');

  const fabric = {
    type: 'path',
    left: 0,
    top: 0,
    path: [['M', 0, 0], ['L', 5, 0]],
    data: { id: 'dw-1' },
    pageNumber: 1,
  };
  const ydoc = new Y.Doc();
  const yMapAnnotations = ydoc.getMap('annotations');

  const commit = await dualWriteFabricCommit(fabric, {
    documentId: 'd1',
    userId: 'u1',
    pageNumber: 1,
    ydoc,
    yMapAnnotations,
  });
  assert.ok(commit.legacy);
  assert.equal(commit.crdt?.ok, true);
  assert.ok(yMapAnnotations.has('dw-1'));

  const del = await dualWriteFabricDelete('d1', 'dw-1', {
    userId: 'u1',
    ydoc,
    yMapAnnotations,
  });
  assert.equal(del.crdt?.ok, true);
  assert.equal(yMapAnnotations.has('dw-1'), false);

  // Legacy upsert error enqueues dual-write retry
  state.upsertError = new Error('legacy-upsert-fail');
  const failCommit = await dualWriteFabricCommit(
    { ...fabric, data: { id: 'dw-fail' } },
    { documentId: 'd1', userId: 'u1', pageNumber: 1, ydoc, yMapAnnotations },
  );
  assert.ok(failCommit.legacy?.error);
  state.upsertError = null;

  // Survey marker skips CRDT
  const sm = await dualWriteFabricCommit(
    { type: 'rect', data: { id: 'sm-1', annotationType: 'survey-marker' }, left: 0, top: 0, width: 1, height: 1 },
    { documentId: 'd1', userId: 'u1', pageNumber: 1, annotation_type: 'survey-marker', ydoc, yMapAnnotations },
  );
  assert.equal(sm.crdt, null);

  // CRDT kill switch
  globalThis.window = {
    localStorage: {
      getItem: (k) => (k === 'CRDT_LAYER_DISABLED' ? '1' : null),
      setItem() {},
      removeItem() {},
    },
  };
  try {
    const off = await dualWriteFabricCommit(fabric, {
      documentId: 'd1', userId: 'u1', pageNumber: 1, ydoc, yMapAnnotations,
    });
    assert.equal(off.crdt, null);
  } finally {
    delete globalThis.window;
  }

  const skip = await dualWriteFabricCommit(fabric, {
    documentId: 'd1',
    userId: 'u1',
    pageNumber: 1,
    skipLegacy: true,
    ydoc,
    yMapAnnotations,
  });
  assert.equal(skip.legacy, null);
  assert.equal(skip.crdt?.ok, true);
});

test('upsertAnnotationsByPage surfaces batch errors; legacy echo filter', async () => {
  const {
    upsertAnnotationsByPage,
    subscribeToAllNonSurveyMarkerAnnotations,
  } = await import('../src/services/annotationCloudSync.js');

  state.upsertError = new Error('batch-fail');
  const failed = await upsertAnnotationsByPage(
    { 1: { objects: [{ type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'bf-1' } }] } },
    { documentId: 'd1', userId: 'u1', pageNumber: 1 },
  );
  assert.ok(failed.error);
  state.upsertError = null;

  let inserts = 0;
  const unsub = subscribeToAllNonSurveyMarkerAnnotations(
    'doc-echo',
    { onFabricInsert: () => { inserts += 1; } },
    { currentUserId: 'u1', currentSessionId: null },
  );
  await new Promise((r) => setTimeout(r, 5));
  const ch = fake.channels.at(-1);
  // Legacy echo: no session id, same last_modified_by
  ch.__fire('INSERT', {
    new: {
      annotation_id: 'echo-1',
      annotation_type: 'ink',
      annotation_data: { fabricObject: { type: 'path', path: [['M', 0, 0], ['L', 1, 0]], left: 0, top: 0 } },
      page_number: 1,
      last_modified_by: 'u1',
    },
  });
  assert.equal(inserts, 0);
  unsub();
});

test('callouts/delete errors + dualWrite catch/enqueue paths', async () => {
  const {
    upsertCallouts,
    deleteAnnotation,
    deleteAnnotations,
    dualWriteFabricCommit,
    dualWriteFabricDelete,
    loadDocumentAnnotationsChangedAt,
  } = await import('../src/services/annotationCloudSync.js');

  // Debug logger branch
  globalThis.window = { __CLOUD_SYNC_DEBUG: true };
  try {
    const empty = await upsertCallouts([], { documentId: 'd1' });
    assert.equal(empty.error, null);

    state.upsertError = new Error('callout-fail');
    const callFail = await upsertCallouts(
      [{
        id: 'c-fail',
        pageNumber: 1,
        text: 'x',
        arrowTip: { x: 0, y: 0 },
        knee: { x: 1, y: 1 },
        textBoxPosition: { x: 2, y: 2 },
        textBoxWidth: 10,
        textBoxHeight: 10,
      }],
      { documentId: 'd1', userId: 'u1' },
    );
    assert.ok(callFail.error);
    state.upsertError = null;

    state.deleteError = new Error('del-fail');
    const del1 = await deleteAnnotation('d1', 'a1');
    assert.ok(del1.error);
    const delMany = await deleteAnnotations('d1', ['a1', 'a2']);
    assert.ok(delMany.error);
    state.deleteError = null;
    assert.equal((await deleteAnnotations('d1', [])).success, true);

    // Legacy throw → dualWrite catch + enqueue
    state.throwOnQuery = new Error('legacy-throw');
    const boom = await dualWriteFabricCommit(
      { type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'throw-1' }, pageNumber: 1 },
      { documentId: 'd1', userId: 'u1', pageNumber: 1 },
    );
    assert.ok(boom.legacy?.error);
    state.throwOnQuery = null;

    // CRDT side throw → enqueue crdt
    const fakeYdoc = {
      clientID: 9,
      transact() { throw new Error('crdt-throw'); },
      getMap() { return { set() {} }; },
    };
    const crdtBoom = await dualWriteFabricCommit(
      { type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'crdt-boom' }, pageNumber: 1 },
      {
        documentId: 'd1',
        userId: 'u1',
        pageNumber: 1,
        skipLegacy: true,
        ydoc: fakeYdoc,
        yMapAnnotations: { get() { return null; }, set() {} },
      },
    );
    assert.ok(crdtBoom.crdt?.error);

    // Delete legacy throw + survey-marker skip on delete
    state.throwOnQuery = new Error('del-throw');
    const delThrow = await dualWriteFabricDelete('d1', 'del-throw-id', { userId: 'u1' });
    assert.ok(delThrow.legacy?.error);
    state.throwOnQuery = null;

    const smDel = await dualWriteFabricDelete('d1', 'sm-del', {
      userId: 'u1',
      annotation_type: 'survey-marker',
      ydoc: fakeYdoc,
      yMapAnnotations: { delete() {}, get() {} },
    });
    assert.equal(smDel.crdt, null);

    // CRDT delete throw
    const delCrdt = await dualWriteFabricDelete('d1', 'del-crdt', {
      userId: 'u1',
      skipLegacy: true,
      ydoc: fakeYdoc,
      yMapAnnotations: { delete() { throw new Error('ymap-del'); } },
    });
    assert.ok(delCrdt.crdt?.error);

    // loadDocumentAnnotationsChangedAt missing args / catch
    assert.equal(await loadDocumentAnnotationsChangedAt(null), null);
    assert.equal(await loadDocumentAnnotationsChangedAt('d1'), null);
    // Resolver rejects when the documents query throws → catch at 191-192
    state.throwOnQuery = new Error('meta-throw');
    assert.equal(await loadDocumentAnnotationsChangedAt('d-throw'), null);
    state.throwOnQuery = null;
  } finally {
    delete globalThis.window;
    state.throwOnQuery = null;
    state.upsertError = null;
    state.deleteError = null;
  }
});

test('realtime deserialize failures + delete-fallback throw + empty hydrate id', async () => {
  const {
    subscribeToAllNonSurveyMarkerAnnotations,
    loadAllNonSurveyMarkerAnnotations,
  } = await import('../src/services/annotationCloudSync.js');

  let fallbackHits = 0;
  const unsub = subscribeToAllNonSurveyMarkerAnnotations(
    'doc-bad',
    {
      onFabricInsert: () => {},
      onCalloutInsert: () => {},
      onCalloutUpdate: () => {},
      onDeleteFallback: () => {
        fallbackHits += 1;
        throw new Error('fallback-boom');
      },
    },
    { currentUserId: 'u1', currentSessionId: 'sess-x' },
  );
  await new Promise((r) => setTimeout(r, 5));
  const ch = fake.channels.at(-1);

  // Bad fabric payload → deserialize catch
  ch.__fire('INSERT', {
    new: {
      annotation_id: 'bad-fab',
      annotation_type: 'ink',
      annotation_data: { clientSessionId: 'other', fabricObject: null },
      page_number: 1,
      last_modified_by: 'u2',
    },
  });

  // Bad callout payload → deserialize catch
  ch.__fire('UPDATE', {
    new: {
      annotation_id: 'bad-call',
      annotation_type: 'callout',
      annotation_data: { clientSessionId: 'other', callout: null },
      page_number: 1,
      last_modified_by: 'u2',
    },
  });

  // Empty DELETE → fallback throws (caught)
  ch.__fire('DELETE', { old: {} });
  assert.equal(fallbackHits, 1);

  unsub();

  const emptyId = await loadAllNonSurveyMarkerAnnotations('');
  assert.equal(emptyId.error, null);

  // Owned survey-marker fabric row filter via hydrate
  state.rows = [{
    annotation_id: 'sm-fab',
    annotation_type: 'survey-marker',
    annotation_data: { fabricObject: { type: 'rect', left: 0, top: 0, width: 1, height: 1 } },
    page_number: 1,
  }, {
    annotation_id: 'plain',
    annotation_type: 'ink',
    annotation_data: { fabricObject: { type: 'path', path: [['M', 0, 0], ['L', 1, 0]], left: 0, top: 0 } },
    page_number: 1,
  }];
  const loaded = await loadAllNonSurveyMarkerAnnotations('doc-owned');
  assert.equal(loaded.error, null);
  state.rows = [];
});

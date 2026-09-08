import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { docToByPage, getMetaValue, docToSurveyMarkers } from '../src/services/annotationDocStore.js';
import { purgeYDoc } from '../src/lib/collab/ydocRegistry.js';

const require = createRequire(import.meta.url);
const hookUrl = new URL('../src/hooks/useAnnotationDoc.js', import.meta.url);
const mark = (id, left) => ({ type: 'rect', left, top: 2, width: 3, height: 4, data: { id } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Only the external cloud transport is replaced. The hook imports the actual
// sync service, which creates its real IndexedDB outbox and y-indexeddb stores.
function cloudTransport() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cloud = { hold: true, release, writes: 0, reads: 0, rows: [], snapshot: null };
  cloud.from = (table) => {
    let after = null;
    const query = {};
    for (const method of ['select', 'eq', 'order', 'limit']) query[method] = () => query;
    query.gt = (_column, value) => { after = value; return query; };
    const result = () => {
      cloud.reads++;
      return { data: table === 'annotation_snapshots' ? cloud.snapshot
        : after == null ? [] : cloud.rows.filter((row) => row.seq > after), error: null };
    };
    query.maybeSingle = async () => result();
    query.then = (resolve) => resolve(result());
    return query;
  };
  cloud.rpc = async (name, args) => {
    cloud.writes++;
    if (cloud.hold) await gate;
    if (name === 'append_annotation_update') {
      const seq = cloud.rows.length + 1;
      cloud.rows.push({ document_id: args.p_document_id, client_id: args.p_client_id,
        client_seq: args.p_client_seq, data: args.p_data, seq });
      return { data: { seq }, error: null };
    }
    assert.equal(name, 'store_annotation_snapshot');
    cloud.snapshot = { document_id: args.p_document_id, at_seq: args.p_at_seq,
      snapshot: args.p_snapshot, encoding_version: args.p_encoding_version,
      writer_id: args.p_writer_id, writer_epoch: args.p_writer_epoch };
    return { data: { accepted: true }, error: null };
  };
  return cloud;
}

async function mount(t) {
  const documentId = `hook-idb-${crypto.randomUUID()}`;
  const actorUserId = 'hook-idb-actor';
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const indexedDb = new IDBFactory();
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, indexedDB: indexedDb, IDBKeyRange, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const cloud = cloudTransport();
  const key = `__hookIdbTransport${documentId}`;
  globalThis[key] = cloud;
  let source = await readFile(hookUrl, 'utf8');
  source = source.replace(/import\s+\{\s*supabase\s*\}\s+from\s+['"]\.\.\/supabaseClient\.js['"];?/,
    `const supabase = globalThis[${JSON.stringify(key)}];`);
  assert.ok(source.includes(`const supabase = globalThis[${JSON.stringify(key)}];`));
  source = source.replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) =>
    `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, hookUrl).href : pathToFileURL(require.resolve(specifier)).href)}`);
  const { useAnnotationDoc } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let latest, edit;
  function Probe({ enabled }) {
    const [byPage, setAnnotationsByPage] = useState({});
    const [spaces, setSpaces] = useState([]);
    const [markers, setSurveyMarkers] = useState({});
    latest = useAnnotationDoc({ documentId, userId: actorUserId, enabled,
      annotationsByPage: byPage, setAnnotationsByPage, spaces, setSpaces,
      surveyMarkers: markers, setSurveyMarkers, docRole: null });
    edit = (next) => {
      setAnnotationsByPage(next.byPage);
      setSpaces(next.spaces);
      setSurveyMarkers(next.markers);
    };
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = async (enabled) => act(async () => root.render(React.createElement(Probe, { enabled })));
  t.after(async () => {
    cloud.hold = false;
    cloud.release();
    await act(async () => { await latest?.forceFlush(); });
    await act(async () => root.unmount());
    // Let the real close path finish its queued IDB transactions before globals
    // are restored. Nothing is replaced inside the handle or outbox.
    for (let i = 0; i < 30; i++) await tick();
    purgeYDoc(`annoflat:${documentId}:${actorUserId}`);
    delete globalThis[key];
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await render(true);
  for (let i = 0; i < 200 && !latest.initialHydration.ready; i++) await act(tick);
  assert.equal(latest.initialHydration.ready, true, 'actual service finishes local/cloud hydration');
  return { documentId, actorUserId, indexedDb, cloud, render, latest: () => latest,
    edit: (next) => act(async () => edit(next)),
    save: async () => { let receipt; await act(async () => { receipt = await latest.ensureLocalDurability(); }); return receipt; },
  };
}

async function recoveredView(h, receipt) {
  const second = await createAnnotationOutbox({ indexedDb: h.indexedDb });
  const doc = new Y.Doc();
  try {
    const saved = await second.readLocalState(h.documentId, h.actorUserId, receipt.incarnation);
    for (const update of [saved.checkpointUpdate, ...saved.accepted.map((row) => row.update),
      ...saved.pending.filter((row) => !row.publishAfterAcceptance).map((row) => row.update)].filter(Boolean)) Y.applyUpdate(doc, update);
    return { byPage: docToByPage(doc), spaces: getMetaValue(doc, 'spaces'), markers: docToSurveyMarkers(doc) };
  } finally { doc.destroy(); await second.close(); }
}

test('real mounted hook saves changed and deleted data locally, then revalidates its sealed inactive receipt', { timeout: 10000 }, async (t) => {
  const h = await mount(t);
  await h.edit({ byPage: { 1: { objects: [mark('keep', 5), mark('delete', 10)] } },
    spaces: [{ id: 'room', name: 'Old room' }], markers: { door: { id: 'door', label: 'Old door' } } });
  await h.save();
  assert.equal(h.cloud.hold, true, 'the local save completed while cloud transport was blocked');
  await h.edit({ byPage: { 1: { objects: [mark('keep', 50)] } },
    spaces: [{ id: 'room', name: 'New room' }], markers: { window: { id: 'window', label: 'New window' } } });
  const changed = await h.save();
  const recovered = await recoveredView(h, changed);
  assert.deepEqual(recovered.byPage[1].objects.map((item) => [item.data.id, item.left]), [['keep', 50]]);
  assert.deepEqual(recovered.spaces, [{ id: 'room', name: 'New room' }]);
  assert.deepEqual(recovered.markers, { window: { id: 'window', label: 'New window' } });
  await h.edit({ byPage: {}, spaces: [], markers: {} });
  const empty = await h.save();
  assert.deepEqual(await recoveredView(h, empty), { byPage: {}, spaces: [], markers: {} });
  h.cloud.hold = false;
  h.cloud.release();
  await act(async () => { await h.latest().forceFlush(); });
  await h.render(false);
  const closed = await h.save();
  assert.equal(closed.locallyDurable, true);
  assert.equal(h.latest().isLocalDurabilityCurrent(closed), true);
  assert.deepEqual(await recoveredView(h, closed), { byPage: {}, spaces: [], markers: {} });
});

test('a second IndexedDB connection purge vetoes inactive Save despite an unchanged cached receipt', { timeout: 10000 }, async (t) => {
  const h = await mount(t);
  await h.save();
  h.cloud.hold = false;
  h.cloud.release();
  await act(async () => { await h.latest().forceFlush(); });
  await h.render(false);
  const receipt = await h.save();
  const second = await createAnnotationOutbox({ indexedDb: h.indexedDb });
  try { await second.deleteDocument(h.documentId); }
  finally { await second.close(); }
  assert.equal(h.latest().isLocalDurabilityCurrent(receipt), true, 'external deletion has not changed this renderer cache');
  const callsBefore = h.cloud.reads + h.cloud.writes;
  await assert.rejects(h.save());
  assert.equal(h.cloud.reads + h.cloud.writes, callsBefore, 'purge validation performs no cloud work');
});

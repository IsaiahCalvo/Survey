import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { useAnnotationDoc } from '../src/hooks/useAnnotationDoc.js';
import { purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createAnnotationGenerationAggregateAppRequest }
  from '../src/services/annotationGenerationAggregateAppRequest.js';

const shellSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const shellTree = parse(shellSource, { sourceType: 'module', plugins: ['jsx'] });
const viewerTree = parse(viewerSource, { sourceType: 'module', plugins: ['jsx'] });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = find(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function memoCallback(source, tree, name) {
  const declaration = find(tree, node => node.type === 'VariableDeclarator'
    && node.id?.name === name && node.init?.type === 'CallExpression');
  assert.ok(declaration, `missing production ${name}`);
  return source.slice(declaration.init.arguments[0].start, declaration.init.arguments[0].end);
}

const rawAppFactory = memoCallback(shellSource, shellTree,
  'createAnnotationGenerationAggregateRequest')
  .replace('import.meta.env.VITE_SUPABASE_URL', JSON.stringify('https://survey.supabase.co'))
  .replace('import.meta.env.VITE_SUPABASE_ANON_KEY', JSON.stringify('public-anon-key'));
const makeAppFactory = client => Function('createAnnotationGenerationAggregateAppRequest',
  'resolvedAnnotationDocClient', `return (${rawAppFactory});`)(
  createAnnotationGenerationAggregateAppRequest, client,
);
const makeViewerResolver = Function('annotationGenerationAggregateEnabled', 'checkedBundle',
  'createAnnotationGenerationAggregateRequest', 'user', 'pdfFile',
  `return (${memoCallback(viewerSource, viewerTree,
    'annotationGenerationAggregateRequest')});`);
const viewerResolver = (...args) => makeViewerResolver(...args)();

async function until(predicate, message) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  }
  assert.fail(message);
}

test('aggregate stays off and page replacement uses the guarded route resolver', () => {
  assert.match(shellSource, /VITE_SURVEY_ANNOTATION_GENERATION_AGGREGATE === 'mode-v1'/);
  assert.match(shellSource, /annotationGenerationAggregateEnabled = ANNOTATION_GENERATION_AGGREGATE_ENABLED/);
  assert.match(viewerSource, /annotationGenerationAggregateEnabled = false/);
  assert.doesNotMatch(shellSource, /createDocumentPageReplacementTransport/);
  assert.match(shellSource, /resolveDocumentPageReplacementTransport/);
  assert.match(shellSource, /transport: resolvedDocumentReplacementTransport/);
  assert.match(shellSource, /typeof resolvedDocumentReplacementTransport !== 'function'/);
  assert.match(shellSource, /documentDefinitionRevisionsEnabled !== true/);
  assert.match(viewerSource, /aggregateRequest: annotationGenerationAggregateRequest/);
});

test('actual viewer resolver keeps disabled and model-1 paths null but model-2 setup fails closed', async () => {
  const scope = { user: { id: 'actor' }, pdfFile: { id: 'document' } };
  let calls = 0;
  const factory = value => { calls += 1; assert.deepEqual(value,
    { actorUserId: 'actor', documentId: 'document' }); return async () => 'ok'; };
  assert.equal(viewerResolver(false, { contentModelVersion: 2 }, factory,
    scope.user, scope.pdfFile), null);
  assert.equal(viewerResolver(true, { contentModelVersion: 1 }, factory,
    scope.user, scope.pdfFile), null);
  assert.equal(calls, 0);
  assert.equal(await viewerResolver(true, { contentModelVersion: 2 }, factory,
    scope.user, scope.pdfFile)(), 'ok');
  assert.equal(calls, 1);
  for (const malformed of [null, () => null, () => { throw new Error('private setup'); }]) {
    const request = viewerResolver(true, { contentModelVersion: 2 }, malformed,
      scope.user, scope.pdfFile);
    assert.equal(typeof request, 'function');
    await assert.rejects(request(), error => error.code === 'ANNOTATION_AGGREGATE_UNCONFIRMED'
      && !error.message.includes('private setup'));
  }
});

test('mounted app factory sends one model-2 edit to Edge with no app append or snapshot', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({
    pdfBlob: new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }),
  });
  const checkedBundle = await backend.read();
  const appCalls = [];
  let sessionActor = backend.ids.actorUserId;
  const client = {
    rpc(name, params) { appCalls.push(name); return backend.client.rpc(name, params); },
    auth: { getSession: async () => ({ data: { session: {
      user: { id: sessionActor }, access_token: `token-${sessionActor}`,
    } }, error: null }) },
  };
  const edgeCalls = [];
  const edgeFetch = async (url, options) => {
    const parsed = new URL(url);
    const body = new Uint8Array(await options.body.arrayBuffer());
    edgeCalls.push({ url: parsed, options, body });
    assert.equal(options.headers.Authorization, `Bearer token-${backend.ids.actorUserId}`);
    const writerId = parsed.searchParams.get('client_id');
    const clientSeq = parsed.searchParams.get('client_seq');
    const result = await backend.client.rpc('append_annotation_update_v3', {
      p_document_id: backend.ids.documentId,
      p_generation_id: backend.ids.generationId,
      p_content_model_version: 2,
      p_client_id: writerId,
      p_client_seq: clientSeq,
      p_data: `\\x${Buffer.from(body).toString('hex')}`,
    });
    return Response.json({ result: { version: 2, status: 'accepted',
      actor_user_id: backend.ids.actorUserId, document_id: backend.ids.documentId,
      generation_id: backend.ids.generationId, content_model_version: 2,
      client_id: writerId, client_seq: clientSeq, seq: result.data.seq,
      data_sha256: sha(body), current_generation_id: backend.ids.generationId,
      is_current: true } });
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = edgeFetch;
  const appFactory = makeAppFactory(client);
  const aggregateRequest = viewerResolver(true, checkedBundle, appFactory,
    { id: backend.ids.actorUserId }, { id: backend.ids.documentId });
  globalThis.fetch = oldFetch;

  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const prior = new Map();
  for (const [name, value] of Object.entries({ window: dom.window,
    document: dom.window.document, localStorage: dom.window.localStorage,
    indexedDB: new IDBFactory(), IDBKeyRange, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let latest;
  function Probe() {
    const [annotationsByPage, setAnnotationsByPage] = useState({});
    const [spaces, setSpaces] = useState([]);
    const [surveyMarkers, setSurveyMarkers] = useState({});
    latest = useAnnotationDoc({ documentId: backend.ids.documentId,
      userId: backend.ids.actorUserId, checkedBundle, enabled: true,
      annotationDocClient: client, aggregateRequest, docRole: 'owner',
      pageSizesRef: { current: {} }, annotationsByPage, setAnnotationsByPage,
      spaces, setSpaces, surveyMarkers, setSurveyMarkers });
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    await act(async () => root.unmount());
    await purgeAnnotationDoc(backend.ids.documentId).catch(() => {});
    backend.destroy(); dom.window.close();
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await until(() => latest?.initialHydration?.ready, 'app aggregate hook did not hydrate');
  await act(async () => latest.updateSurveyMarkers(markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'app-wired' } })));
  await act(async () => { await latest.forceFlush(); });
  assert.equal(edgeCalls.length, 1);
  assert.equal(edgeCalls[0].url.pathname, '/functions/v1/annotation-generation-aggregate');
  assert.strictEqual(edgeCalls[0].options.signal instanceof AbortSignal, true);
  assert.equal(appCalls.includes('append_annotation_update_v3'), false);
  assert.equal(appCalls.includes('store_annotation_snapshot_v3'), false);
  assert.equal(backend.inspect().snapshotWrites, 0);

  sessionActor = 'aa000000-0000-4000-8000-000000000099';
  await assert.rejects(aggregateRequest({}), { code: 'ANNOTATION_AGGREGATE_APP_REQUEST_INPUT' });
  assert.equal(edgeCalls.length, 1);
});

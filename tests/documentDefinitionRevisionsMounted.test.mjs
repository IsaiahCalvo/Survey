import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';
import { canCommitDocumentDefinitionMutation, getDefinitionHistoryReference,
  isDocumentDefinitionSourceLoadCurrent,
  needsDefinitionHistoryReview,
  loadDocumentDefinitionRevisionSources, resolveDocumentDefinitionReadOnlyTool,
  stampDefinitionHistoryReference,
  useDocumentDefinitionRevisions } from '../src/hooks/useDocumentDefinitionRevisions.js';

const require = createRequire(import.meta.url);
const componentUrl = new URL('../src/components/DocumentDefinitionRevisionReview.jsx', import.meta.url);
const portalUrl = new URL('../src/components/BodyPortal.js', import.meta.url);
const portalSource = (await transformWithOxc(await readFile(portalUrl, 'utf8'), portalUrl.pathname)).code
  .replace('"react-dom"', JSON.stringify(pathToFileURL(require.resolve('react-dom')).href));
const portalDataUrl = `data:text/javascript;base64,${Buffer.from(portalSource).toString('base64')}`;
const componentSource = (await transformWithOxc(await readFile(componentUrl, 'utf8'), componentUrl.pathname,
  { lang: 'jsx' })).code
  .replace('"react"', JSON.stringify(pathToFileURL(require.resolve('react')).href))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
  .replace('"./BodyPortal.js"', JSON.stringify(portalDataUrl));
const DocumentDefinitionRevisionReview = (await import(
  `data:text/javascript;base64,${Buffer.from(componentSource).toString('base64')}`
)).default;

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const GENERATION_ID = '44444444-4444-4444-8444-444444444444';
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';
const OPERATION_ID = '66666666-6666-4666-8666-666666666666';
const FILE = Object.freeze({ id: DOCUMENT_ID });
const CHECKED_BUNDLE = Object.freeze({ pdfGenerationId: GENERATION_ID });

const receipt = (revision, label, operationId = null) => Object.freeze({
  status: 'accepted', version: 1, documentId: DOCUMENT_ID,
  definitionRevision: revision, definitionDigest: String(revision).repeat(64),
  surveyDefinition: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }),
    modules: Object.freeze([{ id: 'module', name: label, categories: [] }]) }),
  entityCatalog: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }),
    entities: Object.freeze([{ id: 'entity', name: label }]) }),
  archivedSemanticIds: Object.freeze([]),
  review: Object.freeze({ reviewedAt: '2026-09-15T12:00:00Z', operationId,
    requestSha256: operationId ? 'a'.repeat(64) : null }),
});

const installDom = () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
};
const waitFor = async check => {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    if (check()) return;
  }
  assert.fail('timed out');
};

test('collaborators load one combined current revision but cannot preview or apply', async t => {
  const restore = installDom();
  const calls = [];
  const current = receipt(1, 'Shared current');
  const cache = {
    getIntent: async () => null,
    getCurrentReceipt: async () => null,
    putCurrentReceipt: async (_actor, _document, value) => { calls.push(['cache', value.definitionRevision]); return value; },
  };
  const client = {
    readCurrent: async () => { calls.push(['read']); return current; },
    preview: async () => { calls.push(['preview']); throw new Error('must not preview'); },
    apply: async () => { calls.push(['apply']); throw new Error('must not apply'); },
  };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled: true,
      file: FILE, checkedBundle: CHECKED_BUNDLE,
      actorUserId: ACTOR_A, owner: false, client, cache,
      isCurrent: value => value.actorUserId === ACTOR_A && value.documentId === DOCUMENT_ID });
    return React.createElement('output', null, `${latest.mode}:${latest.currentReceipt?.definitionRevision || 0}`);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest.mode === 'accepted');
  assert.equal(document.querySelector('output').textContent, 'accepted:1');
  assert.deepEqual(calls, [['read'], ['cache', 1]], 'verified current is durable before it is shown');
  await assert.rejects(latest.requestReview({ id: TEMPLATE_ID }), /owner/i);
  await assert.rejects(latest.applyReview(), /owner/i);
  assert.equal(calls.some(([name]) => name === 'preview' || name === 'apply'), false);
});

test('the off gate does not schedule state work when a legacy file object changes each render', async t => {
  const restore = installDom();
  let renders = 0;
  function Probe() {
    const [tick, setTick] = React.useState(0);
    renders++;
    useDocumentDefinitionRevisions({ enabled: false,
      file: { id: DOCUMENT_ID }, actorUserId: ACTOR_A, active: true });
    React.useEffect(() => { if (tick < 5) setTick(value => value + 1); }, [tick]);
    return React.createElement('output', null, tick);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => document.querySelector('output')?.textContent === '5');
  assert.equal(renders, 6, 'the disabled definition hook adds no render of its own');
});

test('template sources load only on owner request and stale actor results are discarded', async t => {
  const restore = installDom();
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  let loads = 0;
  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    available: false, templates: [], onLoadSources: () => { loads++; },
  })));
  assert.equal(document.querySelector('[data-document-definition-revision-offer]'), null);
  assert.equal(loads, 0, 'a collaborator cannot start a private-template read');

  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    available: false, templates: [], error: 'Showing last verified definition. Editing is paused.',
    onLoadSources: () => { loads++; },
  })));
  assert.match(document.querySelector('[role="status"]').textContent, /Editing is paused/i);
  assert.equal(document.querySelector('button'), null, 'the role-neutral status exposes no owner action');

  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    available: true, templates: [], error: 'Template source read failed.',
    onLoadSources: () => { loads++; },
  })));
  assert.match(document.querySelector('[role="alert"]').textContent, /read failed/i);
  await act(async () => [...document.querySelectorAll('button')]
    .find(button => /Load template sources/.test(button.textContent)).click());
  assert.equal(loads, 1);

  let resolveRows;
  let current = true;
  const published = [];
  const pending = loadDocumentDefinitionRevisionSources({
    load: () => new Promise(resolve => { resolveRows = resolve; }),
    isCurrent: () => current,
    publish: rows => published.push(rows),
  });
  current = false;
  resolveRows([{ id: TEMPLATE_ID, name: 'Private', config: { id: 'local-template', modules: [] } }]);
  await assert.rejects(pending, /document or account changed/i);
  assert.deepEqual(published, [], 'a delayed prior-actor read never reaches app template state');
  const normalized = await loadDocumentDefinitionRevisionSources({
    load: async () => [{ id: TEMPLATE_ID, name: 'Private row',
      config: { id: 'local-template', name: 'Updated source', modules: [], ballInCourtEntities: [] } }],
    publish: rows => published.push(rows),
  });
  assert.equal(normalized[0].id, 'local-template');
  assert.equal(normalized[0].supabaseId, TEMPLATE_ID);
  assert.deepEqual(normalized[0].entities, []);
  assert.equal(published.length, 1);

  const capturedAuthorization = { enabled: true, owner: true, canReview: true,
    load: async () => [], publish: () => {} };
  for (const field of ['enabled', 'owner', 'canReview']) {
    let resolveAuthorizationRows;
    let liveAuthorization = capturedAuthorization;
    const authorizationPublished = [];
    const delayed = loadDocumentDefinitionRevisionSources({
      load: () => new Promise(resolve => { resolveAuthorizationRows = resolve; }),
      isCurrent: () => isDocumentDefinitionSourceLoadCurrent(
        true, liveAuthorization, capturedAuthorization),
      publish: rows => authorizationPublished.push(rows),
    });
    liveAuthorization = { ...capturedAuthorization, [field]: false };
    resolveAuthorizationRows([]);
    await assert.rejects(delayed, /document or account changed/i);
    assert.deepEqual(authorizationPublished, [],
      `a delayed source read is discarded when live ${field} is revoked`);
  }
});

test('paused definition editing blocks renderer creation and marker commit work', async () => {
  for (const tool of ['rect', 'survey-marker', 'pen', 'callout', 'eraser', 'select']) {
    assert.equal(resolveDocumentDefinitionReadOnlyTool(tool, true), 'pan');
  }
  assert.equal(resolveDocumentDefinitionReadOnlyTool('pan', true), 'pan');
  assert.equal(resolveDocumentDefinitionReadOnlyTool('text-select', true), 'text-select');
  assert.equal(resolveDocumentDefinitionReadOnlyTool('rect', false), 'rect');
  const history = [];
  const store = [];
  const commitMarker = () => {
    if (!canCommitDocumentDefinitionMutation(true)) return false;
    history.push('checkpoint');
    store.push('marker');
    return true;
  };
  assert.equal(commitMarker(), false);
  assert.deepEqual(history, []);
  assert.deepEqual(store, []);

  const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const markerStart = source.indexOf('const handleSurveyMarkerCreated = useCallback');
  const markerGuard = source.indexOf('canCommitDocumentDefinitionMutation(effectiveDocumentLockedRef.current)', markerStart);
  const markerCheckpoint = source.indexOf("addHistoryCheckpoint('highlight:create'", markerStart);
  assert.ok(markerStart >= 0 && markerGuard > markerStart && markerGuard < markerCheckpoint,
    'desktop marker lock guard runs before its history or store path');
  const mobileStart = source.indexOf('const commitMobileSurveyMarker = useCallback');
  const mobileGuard = source.indexOf('canCommitDocumentDefinitionMutation(effectiveDocumentLockedRef.current)', mobileStart);
  const mobileWrite = source.indexOf('setSurveyMarkers(prev =>', mobileStart);
  assert.ok(mobileStart >= 0 && mobileGuard > mobileStart && mobileGuard < mobileWrite,
    'mobile marker lock guard runs before its store path');
  assert.match(source, /!effectiveDocumentLocked && pendingSurveyMarker &&/);
  assert.match(source, /!effectiveDocumentLocked && pendingEntitySelection &&/);
  assert.match(source, /!effectiveDocumentLocked && pendingSurveyMarkerName &&/);
  const modalStart = source.indexOf('{/* Category Selection Modal');
  const modalEnd = source.indexOf('{/* Region Overlay Toggle */', modalStart);
  const guardedPendingCallbacks = source.slice(modalStart, modalEnd)
    .match(/canCommitDocumentDefinitionMutation\(effectiveDocumentLockedRef\.current\)/g) || [];
  assert.ok(guardedPendingCallbacks.length >= 9,
    'category, entity, name, keyboard, and mobile completion callbacks recheck the live lock');
  for (const [startText, writeText, label] of [
    ['const handleUndo = useCallback', 'deferUntilEraseCommitsFinish(handleUndo)', 'undo'],
    ['const handleRedo = useCallback', 'deferUntilEraseCommitsFinish(handleRedo)', 'redo'],
    ['const handleNativeTextMarkupDelete = (event)', 'deleteSelectedTextMarkupAnnotation?.()', 'native delete'],
    ['onConfirm={() => {\n          if (effectiveDocumentLockedRef.current) return;',
      'const runner = pendingDeleteRunnerRef.current', 'pending delete confirm'],
  ]) {
    const start = source.indexOf(startText);
    const guard = source.indexOf('effectiveDocumentLockedRef.current', start);
    const write = source.indexOf(writeText, start);
    assert.ok(start >= 0 && guard >= start && guard < write, `${label} rechecks the live lock before mutation`);
  }
  assert.match(source, /toast=\{effectiveDocumentLocked \? null : guardedUndoToast\}/);
  assert.match(source, /if \(!effectiveDocumentLockedRef\.current\) dismissUndoToast\(\)/);
});

test('offline uses only the last verified head with edits blocked, while forbidden never falls back', async t => {
  for (const code of ['DOCUMENT_DEFINITION_REVISION_UNAVAILABLE', 'DOCUMENT_DEFINITION_REVISION_FORBIDDEN']) {
    await t.test(code, async () => {
      const restore = installDom();
      const cached = receipt(1, 'Cached');
      const cache = { getIntent: async () => null, getCurrentReceipt: async () => cached };
      const client = { readCurrent: async () => { throw Object.assign(new Error('private'), { code }); } };
      let latest;
      function Probe() {
        latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE,
          checkedBundle: CHECKED_BUNDLE, actorUserId: ACTOR_A, owner: false, client, cache });
        return null;
      }
      const root = createRoot(document.getElementById('root'));
      try {
        await act(async () => root.render(React.createElement(Probe)));
        await waitFor(() => latest?.recoveryBlocked === (code.includes('FORBIDDEN'))
          && latest?.mutationsBlocked === true);
        assert.equal(latest.currentReceipt?.definitionRevision || null,
          code.includes('UNAVAILABLE') ? 1 : null);
        assert.equal(latest.online, false);
      } finally { await act(async () => root.unmount()); restore(); }
    });
  }
});

test('owner review is durable before apply and a lost reply reconciles the exact operation', async t => {
  const restore = installDom();
  const calls = [];
  const current = receipt(1, 'Before');
  const accepted = receipt(2, 'After', OPERATION_ID);
  let serverCurrent = current;
  let intent = null;
  const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR_A,
    documentId: DOCUMENT_ID, currentReceipt: current,
    wire: Object.freeze({ surveyDefinition: accepted.surveyDefinition,
      entityCatalog: accepted.entityCatalog,
      review: Object.freeze({ operationId: OPERATION_ID, requestSha256: 'a'.repeat(64),
        archivedSemanticIds: Object.freeze([]) }) }),
    expectedArchivedSemanticIds: Object.freeze([]) });
  const cache = {
    getIntent: async () => intent,
    getCurrentReceipt: async () => null,
    putReceipt: async (_actor, _document, value) => { calls.push(['cache', value.definitionRevision]); return value; },
    putCurrentReceipt: async (_actor, _document, value) => { calls.push(['cache', value.definitionRevision]); return value; },
    reserveIntent: async (_actor, _document, value) => {
      calls.push(['reserve', value.wire.review.operationId]);
      intent ||= { phase: 'pending', revision: 1, operationId: OPERATION_ID,
        requestSha256: 'a'.repeat(64), review: value };
      return { row: intent, created: true };
    },
    markDispatched: async () => { calls.push(['dispatch']); intent = { ...intent, phase: 'dispatched', revision: 2 }; return intent; },
    finishIntent: async () => { calls.push(['finish']); intent = null; return true; },
    cancelIntent: async () => true,
    getReceipt: async () => null,
  };
  const client = {
    readCurrent: async () => { calls.push(['read']); return serverCurrent; },
    preview: async ({ operationId }) => { calls.push(['preview', operationId]); return review; },
    apply: async () => { calls.push(['apply']); serverCurrent = accepted; throw new Error('lost reply'); },
    readRevision: async () => assert.fail('not needed'),
  };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled: true,
      file: FILE, checkedBundle: CHECKED_BUNDLE,
      actorUserId: ACTOR_A, owner: true, client, cache, createOperationId: () => OPERATION_ID,
      isCurrent: value => value.actorUserId === ACTOR_A && value.documentId === DOCUMENT_ID });
    return React.createElement('output', null, `${latest.mode}:${latest.currentReceipt?.definitionRevision || 0}`);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest.mode === 'accepted');
  await act(async () => latest.requestReview({ id: TEMPLATE_ID, modules: [], entities: [] }));
  assert.equal(latest.review, review);
  assert.deepEqual(calls.slice(-3), [['preview', OPERATION_ID], ['cache', 1], ['reserve', OPERATION_ID]]);

  await act(async () => latest.applyReview());
  assert.equal(latest.currentReceipt.definitionRevision, 2);
  assert.equal(intent, null);
  assert.deepEqual(calls.slice(-8), [
    ['reserve', OPERATION_ID], ['dispatch'], ['apply'], ['read'], ['cache', 2], ['read'], ['cache', 2], ['finish'],
  ]);
});

test('reactivation retries a discarded current read and survey-only review keeps the entity source', async t => {
  const restore = installDom();
  const otherTemplateId = '77777777-7777-4777-8777-777777777777';
  const mixed = Object.freeze({ ...receipt(1, 'Mixed'),
    surveyDefinition: Object.freeze({ source: Object.freeze({ templateId: TEMPLATE_ID }), modules: Object.freeze([]) }),
    entityCatalog: Object.freeze({ source: Object.freeze({ templateId: otherTemplateId }), entities: Object.freeze([]) }),
  });
  let resolveFirst;
  let reads = 0;
  let previewArgs = null;
  const cache = { getIntent: async () => null, getCurrentReceipt: async () => null,
    putCurrentReceipt: async (_actor, _document, value) => value,
    reserveIntent: async () => ({ row: { phase: 'pending' }, created: true }) };
  const client = {
    readCurrent: async () => { reads++; return reads === 1
      ? new Promise(resolve => { resolveFirst = resolve; }) : mixed; },
    preview: async args => { previewArgs = args; return Object.freeze({ currentReceipt: mixed }); },
  };
  let latest;
  const StableProbe = ({ active }) => {
    latest = useDocumentDefinitionRevisions({ enabled: true, active,
      file: FILE, checkedBundle: CHECKED_BUNDLE, actorUserId: ACTOR_A, owner: true,
      client, cache, createOperationId: () => OPERATION_ID,
      isCurrent: value => active && value.documentId === DOCUMENT_ID });
    return null;
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(StableProbe, { active: true })));
  await waitFor(() => typeof resolveFirst === 'function');
  await act(async () => root.render(React.createElement(StableProbe, { active: false })));
  resolveFirst(mixed);
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  assert.notEqual(latest.mode, 'accepted');
  await act(async () => root.render(React.createElement(StableProbe, { active: true })));
  await waitFor(() => latest.mode === 'accepted');
  assert.equal(reads, 2);
  await act(async () => latest.requestReview({ id: TEMPLATE_ID, modules: [] }));
  assert.equal(previewArgs.surveyTemplateId, TEMPLATE_ID);
  assert.equal(previewArgs.entityTemplateId, otherTemplateId);
});

test('an accepted apply stays recovery-blocked when receipt, current head, or finish durability fails', async t => {
  for (const failure of ['receipt', 'current', 'finish']) await t.test(failure, async () => {
    const restore = installDom();
    const current = receipt(1, 'Before');
    const accepted = receipt(2, 'After', OPERATION_ID);
    const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR_A,
      documentId: DOCUMENT_ID, currentReceipt: current,
      wire: Object.freeze({ surveyDefinition: accepted.surveyDefinition, entityCatalog: accepted.entityCatalog,
        review: Object.freeze({ operationId: OPERATION_ID, requestSha256: 'a'.repeat(64), archivedSemanticIds: Object.freeze([]) }) }),
      expectedArchivedSemanticIds: Object.freeze([]) });
    let intent = null;
    let serverCurrent = current;
    const cache = { getIntent: async () => null, getCurrentReceipt: async () => null,
      putCurrentReceipt: async (_a, _d, value) => {
        if (failure === 'current' && value.definitionRevision === 2) {
          throw Object.assign(new Error('quota'), { code: 'DOCUMENT_DEFINITION_REVISION_CACHE_FULL' });
        }
        return value;
      },
      reserveIntent: async (_a, _d, value) => {
        intent ||= { phase: 'pending', revision: 1, operationId: OPERATION_ID,
          requestSha256: 'a'.repeat(64), review: value };
        return { row: intent, created: true };
      },
      markDispatched: async () => (intent = { ...intent, phase: 'dispatched', revision: 2 }),
      putReceipt: async () => { if (failure === 'receipt') throw Object.assign(new Error('quota'), { code: 'DOCUMENT_DEFINITION_REVISION_CACHE_FULL' }); },
      finishIntent: async () => { if (failure === 'finish') throw new Error('finish failed'); intent = null; },
      cancelIntent: async () => true, getReceipt: async () => null };
    const client = { readCurrent: async () => serverCurrent, preview: async () => review,
      apply: async () => { serverCurrent = accepted; return accepted; } };
    let latest;
    function Probe() {
      latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE,
        checkedBundle: CHECKED_BUNDLE, actorUserId: ACTOR_A, owner: true, client, cache,
        createOperationId: () => OPERATION_ID });
      return null;
    }
    const root = createRoot(document.getElementById('root'));
    try {
      await act(async () => root.render(React.createElement(Probe)));
      await waitFor(() => latest?.mode === 'accepted');
      await act(async () => latest.requestReview({ id: TEMPLATE_ID, modules: [], entities: [] }));
      await assert.rejects(async () => {
        await act(async () => { await latest.applyReview(); });
      });
      await waitFor(() => latest?.recoveryBlocked === true);
      assert.equal(latest.recoveryBlocked, true);
      assert.equal(latest.mutationsBlocked, true);
      assert.equal(latest.currentReceipt.definitionRevision, 1);
      assert.equal(intent.phase, 'dispatched');
    } finally { await act(async () => root.unmount()); restore(); }
  });
});

test('restart retries the exact dispatched operation but exposes the later verified head', async t => {
  const restore = installDom();
  const revision1 = receipt(1, 'One');
  const revision2 = receipt(2, 'Two', OPERATION_ID);
  const revision3 = receipt(3, 'Three', '88888888-8888-4888-8888-888888888888');
  const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR_A,
    documentId: DOCUMENT_ID, currentReceipt: revision1,
    wire: Object.freeze({ surveyDefinition: revision2.surveyDefinition, entityCatalog: revision2.entityCatalog,
      review: Object.freeze({ operationId: OPERATION_ID, requestSha256: 'a'.repeat(64), archivedSemanticIds: Object.freeze([]) }) }),
    expectedArchivedSemanticIds: Object.freeze([]) });
  const intent = { phase: 'dispatched', revision: 2, operationId: OPERATION_ID,
    requestSha256: 'a'.repeat(64), review };
  const cached = [];
  const cache = { getIntent: async () => intent, getCurrentReceipt: async () => revision1,
    putReceipt: async (_a, _d, value) => { cached.push(['receipt', value.definitionRevision]); },
    putCurrentReceipt: async (_a, _d, value) => { cached.push(['current', value.definitionRevision]); },
    finishIntent: async () => { cached.push(['finish']); } };
  let reads = 0;
  const client = { readCurrent: async () => { reads++; return revision3; },
    apply: async ({ review: exact }) => { assert.equal(exact, review); return revision2; } };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE,
      checkedBundle: CHECKED_BUNDLE, actorUserId: ACTOR_A, owner: true, client, cache });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest?.mode === 'accepted' && latest.currentReceipt.definitionRevision === 3);
  assert.equal(reads, 2);
  assert.deepEqual(cached, [['current', 3], ['receipt', 2], ['current', 3], ['finish']]);
});

test('review UI requires explicit apply and historical restore keeps current shared labels', async t => {
  const restore = installDom();
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  const current = receipt(2, 'Current labels', OPERATION_ID);
  const old = receipt(1, 'Old labels');
  let applied = 0;
  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    review: { currentReceipt: old, wire: current }, onApply: () => { applied++; },
  })));
  assert.match(document.body.textContent, /survey structure and entity list together/i);
  assert.match(document.body.textContent, /Old labels/);
  assert.match(document.body.textContent, /Current labels/);
  assert.equal(applied, 0, 'render never applies a private or shared template on its own');
  await act(async () => [...document.querySelectorAll('button')]
    .find(button => /Apply shared update/.test(button.textContent)).click());
  assert.equal(applied, 1);

  let restored = 0;
  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    historicalReview: { historicalReceipt: old, currentReceipt: current },
    onConfirmHistorical: () => { restored++; },
  })));
  assert.match(document.body.textContent, /Restored marks keep their stable IDs and will use the current shared labels/);
  assert.match(document.body.textContent, /old values remain available/i);
  assert.match(document.body.textContent, /Old labels/);
  assert.match(document.body.textContent, /Current labels/);
  assert.equal(restored, 0);
  await act(async () => [...document.querySelectorAll('button')]
    .find(button => /Restore with current labels/.test(button.textContent)).click());
  assert.equal(restored, 1);
});

test('owner picker sends a same-source refresh through the real hook and keeps the other source', async t => {
  const restore = installDom();
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  const current = receipt(1, 'Old shared labels');
  const refreshedTemplate = { id: TEMPLATE_ID, name: 'Updated private source',
    modules: [{ id: 'module', name: 'Updated survey labels', categories: [] }] };
  let previewArgs = null;
  const review = Object.freeze({ status: 'reviewed', version: 1, actorUserId: ACTOR_A,
    documentId: DOCUMENT_ID, currentReceipt: current,
    wire: Object.freeze({ surveyDefinition: current.surveyDefinition,
      entityCatalog: current.entityCatalog,
      review: Object.freeze({ operationId: OPERATION_ID, requestSha256: 'a'.repeat(64),
        archivedSemanticIds: Object.freeze([]) }) }),
    expectedArchivedSemanticIds: Object.freeze([]) });
  const cache = { getIntent: async () => null, getCurrentReceipt: async () => null,
    putCurrentReceipt: async (_actor, _document, value) => value,
    reserveIntent: async () => ({ row: { phase: 'pending' }, created: true }) };
  const client = { readCurrent: async () => current,
    preview: async args => { previewArgs = args; return review; } };
  let latest;
  function Probe() {
    latest = useDocumentDefinitionRevisions({ enabled: true, file: FILE,
      checkedBundle: CHECKED_BUNDLE, actorUserId: ACTOR_A, owner: true, client, cache,
      createOperationId: () => OPERATION_ID });
    return React.createElement(DocumentDefinitionRevisionReview, {
      available: latest.canReview, currentReceipt: latest.currentReceipt,
      review: latest.review, templates: [refreshedTemplate],
      onRequest: selection => latest.requestReview(selection),
    });
  }
  await act(async () => root.render(React.createElement(Probe)));
  await waitFor(() => latest?.mode === 'accepted');
  const surveySelect = document.querySelectorAll('select')[0];
  await act(async () => {
    surveySelect.value = TEMPLATE_ID;
    surveySelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const button = [...document.querySelectorAll('button')]
    .find(value => /Review document update/.test(value.textContent));
  assert.equal(button.disabled, false, 'an explicit same-source selection can review newer server content');
  await act(async () => button.click());
  await waitFor(() => previewArgs !== null);
  assert.equal(previewArgs.surveyTemplateId, TEMPLATE_ID);
  assert.equal(previewArgs.entityTemplateId, TEMPLATE_ID);
  assert.equal(latest.review, review);
});

test('owner can reach a survey-only review from accepted shared mode and keeps the entity source', async t => {
  const restore = installDom();
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  const current = receipt(1, 'Current');
  const nextTemplateId = '99999999-9999-4999-8999-999999999999';
  const surveyOnly = { id: nextTemplateId, name: 'Updated survey', modules: [] };
  let selection = null;
  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    available: true, currentReceipt: current, templates: [surveyOnly],
    onRequest: value => { selection = value; },
  })));
  const selects = document.querySelectorAll('select');
  assert.equal(selects.length, 2);
  assert.equal([...document.querySelectorAll('button')]
    .find(button => /Review document update/.test(button.textContent)).disabled, true);
  await act(async () => {
    selects[0].value = nextTemplateId;
    selects[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const button = [...document.querySelectorAll('button')]
    .find(value => /Review document update/.test(value.textContent));
  assert.equal(button.disabled, false);
  await act(async () => button.click());
  assert.equal(selection.surveyTemplate, surveyOnly);
  assert.equal(selection.entityTemplate, null);
});

test('model-2 Yjs history pins one revision and PDF gates undo and redo before stack changes', async () => {
  const oldReference = Object.freeze({ version: 1, documentId: DOCUMENT_ID,
    definitionRevision: 1, definitionDigest: '1'.repeat(64) });
  const currentReference = Object.freeze({ version: 1, documentId: DOCUMENT_ID,
    definitionRevision: 2, definitionDigest: '2'.repeat(64) });
  const stackItem = { meta: new Map() };
  assert.equal(stampDefinitionHistoryReference(stackItem, oldReference), true);
  assert.equal(stampDefinitionHistoryReference(stackItem, currentReference), false,
    'moving the same item between Yjs stacks cannot replace its source revision');
  assert.deepEqual(getDefinitionHistoryReference(stackItem), oldReference);
  assert.equal(needsDefinitionHistoryReview(stackItem, currentReference), true);

  const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const undoStart = source.indexOf("const yjsUndoStackItem =");
  const undoGate = source.indexOf("requestDefinitionHistoryRestore(yjsUndoStackItem, 'undo', 'yjs')", undoStart);
  const undoWrite = source.indexOf('userUndo(yjsDoc', undoStart);
  const redoStart = source.indexOf("const yjsRedoStackItem =");
  const redoGate = source.indexOf("requestDefinitionHistoryRestore(yjsRedoStackItem, 'redo', 'yjs')", redoStart);
  const redoWrite = source.indexOf('userRedo(yjsDoc', redoStart);
  assert.ok(undoStart >= 0 && undoGate > undoStart && undoWrite > undoGate);
  assert.ok(redoStart >= 0 && redoGate > redoStart && redoWrite > redoGate);
  const legacyUndoGate = source.indexOf("requestDefinitionHistoryRestore(stateToRestore, 'undo')");
  const legacyUndoPop = source.indexOf('undoHistoryRef.current = undoHistoryRef.current.slice(0, -1)', legacyUndoGate);
  const legacyRedoGate = source.indexOf("requestDefinitionHistoryRestore(legacyRedoState, 'redo')");
  const legacyRedoPop = source.indexOf('redoHistoryRef.current = redoHistoryRef.current.slice(1)', legacyRedoGate);
  assert.ok(legacyUndoGate >= 0 && legacyUndoPop > legacyUndoGate);
  assert.ok(legacyRedoGate >= 0 && legacyRedoPop > legacyRedoGate);
  assert.equal((source.match(/definitionReference: deepClone\(currentDefinitionRevisionReferenceRef\.current\)/g) || []).length, 2);
  assert.match(source, /stampDefinitionHistoryReference\(stackItem, currentDefinitionRevisionReferenceRef\.current\)/);
  assert.match(source, /definitionRevision: definitionRevisions\.currentReceipt\.definitionRevision/);
  assert.match(source, /catalogRevision: definitionRevisions\.currentReceipt\.definitionRevision/);
  assert.match(source, /modules: definitionRevisions\.modules/);
  assert.match(source, /entities: definitionRevisions\.entities/);
  assert.match(source, /const effectiveDocumentLocked = documentLocked \|\| definitionRevisionMutationBlocked/);
  const appSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(appSource, /documentDefinitionRevisionsEnabled = false/);
  assert.match(appSource, /createDocumentDefinitionRevisionAppClient\(\{ client: supabase, enabled: true/);
  assert.match(appSource, /documentDefinitionRevisionClient=\{resolvedDocumentDefinitionRevisionClient\}/);
  assert.match(appSource, /documentDefinitionRevisionCache=\{documentDefinitionRevisionCache\}/);
});

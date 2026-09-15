import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isManagedLocalDocument } from '../src/services/localDocumentState.js';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const baselineMarker = viewerSource.indexOf('// Seed the local-save baseline from one clean checked-generation hydration.');
const baselineStart = viewerSource.indexOf('useEffect(', baselineMarker);
const baselineEnd = viewerSource.indexOf('\n  }, [annotationsByPage, checkedBundle', baselineStart);
const baselineEffectSource = baselineMarker >= 0 && baselineStart > baselineMarker && baselineEnd > baselineStart
  ? viewerSource.slice(baselineStart + 'useEffect('.length, baselineEnd + '\n  }'.length)
  : null;

const dirtyMarker = viewerSource.indexOf('// Mark annotations as dirty when they change');
const dirtyStart = viewerSource.indexOf('useEffect(', dirtyMarker);
const dirtyEnd = viewerSource.indexOf('\n  }, [pdfId, annotationsByPage', dirtyStart);
assert.ok(dirtyMarker >= 0 && dirtyStart > dirtyMarker && dirtyEnd > dirtyStart,
  'test the real viewer dirty effect');
const dirtyEffectSource = viewerSource.slice(dirtyStart + 'useEffect('.length, dirtyEnd + '\n  }'.length);

function installDom() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

test('mounted checked hydration starts clean but later local edits stay dirty after cloud drain', async (t) => {
  const restoreDom = installDom();
  const notifications = [];
  const onUnsavedAnnotationsChange = (...args) => notifications.push(args);
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    restoreDom();
  });

  function Probe({ actorUserId, annotationsByPage, generationId, queueSize, status }) {
    const [dirty, setDirty] = useState(false);
    const checkedAnnotationBaselineScopeRef = useRef(null);
    const savedAnnotationsByPageRef = useRef({});
    const pdfFile = { id: 'checked-doc' };
    const pdfId = 'checked-doc';
    const tabId = 'checked-tab';
    const user = { id: actorUserId };
    const checkedBundle = { pdfGenerationId: generationId };
    const normalAnnotationHydration = {
      ready: true,
      source: 'checked-generation',
      documentId: pdfFile.id,
      pdfGenerationId: generationId,
    };
    const cloudSyncQueueSize = queueSize;
    const cloudSyncStatus = status;
    const managedLocalSaveTracking = { ready: false, dirty: false };
    const scope = {
      annotationsByPage,
      checkedAnnotationBaselineScopeRef,
      checkedBundle,
      cloudSyncQueueSize,
      cloudSyncStatus,
      normalAnnotationHydration,
      onUnsavedAnnotationsChange,
      pdfFile,
      savedAnnotationsByPageRef,
      user,
    };
    const baselineEffect = baselineEffectSource
      ? new Function(...Object.keys(scope), `return (${baselineEffectSource});`)(...Object.values(scope))
      : () => {};
    useEffect(baselineEffect, [actorUserId, annotationsByPage, generationId, queueSize, status]);

    const dirtyScope = {
      pdfId,
      annotationsByPage,
      pdfFile,
      isManagedLocalDocument,
      managedLocalSaveTracking,
      onUnsavedAnnotationsChange,
      savedAnnotationsByPageRef,
      setHasUnsavedAnnotations: setDirty,
      tabId,
    };
    const dirtyEffect = new Function(...Object.keys(dirtyScope), `return (${dirtyEffectSource});`)(...Object.values(dirtyScope));
    useEffect(dirtyEffect, [annotationsByPage]);
    return React.createElement('output', null, String(dirty));
  }

  const clean = { 1: { objects: [{ id: 'server-restored' }] } };
  const edited = { 1: { objects: [{ id: 'server-restored' }, { id: 'local-new' }] } };
  const render = async (props) => act(async () => root.render(React.createElement(Probe, props)));

  await render({ actorUserId: 'actor-a', annotationsByPage: clean, generationId: 'gen-1', queueSize: 0,
    status: { stage: 'idle', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'false',
    'the accepted server-restored snapshot is the initial local-save baseline');
  assert.deepEqual(notifications.at(-1), [false, 'checked-tab']);

  await render({ actorUserId: 'actor-a', annotationsByPage: edited, generationId: 'gen-1', queueSize: 1,
    status: { stage: 'pending', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'true', 'a local edit is still unsaved');

  await render({ actorUserId: 'actor-a', annotationsByPage: edited, generationId: 'gen-1', queueSize: 0,
    status: { stage: 'idle', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'true',
    'a cloud acknowledgement does not stand in for the user local-save action');

  const recovered = { 1: { objects: [{ id: 'recovered-queued-gen' }] } };
  await render({ actorUserId: 'actor-a', annotationsByPage: recovered, generationId: 'queued-gen', queueSize: 1,
    status: { stage: 'pending', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'true', 'a recovered queued write stays unsaved');
  await render({ actorUserId: 'actor-a', annotationsByPage: recovered, generationId: 'queued-gen', queueSize: 0,
    status: { stage: 'idle', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'true', 'draining that queue cannot reset its baseline');

  const failed = { 1: { objects: [{ id: 'recovered-failed-gen' }] } };
  await render({ actorUserId: 'actor-b', annotationsByPage: failed, generationId: 'failed-gen', queueSize: 0,
    status: { stage: 'error', healthy: false, error: 'offline' } });
  assert.equal(document.querySelector('output').textContent, 'true', 'a failed actor scope stays unsaved');
  await render({ actorUserId: 'actor-b', annotationsByPage: failed, generationId: 'failed-gen', queueSize: 0,
    status: { stage: 'idle', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'true', 'reconnect cannot clean the failed scope');

  const nextClean = { 1: { objects: [{ id: 'server-next-gen' }] } };
  await render({ actorUserId: 'actor-b', annotationsByPage: nextClean, generationId: 'clean-gen', queueSize: 0,
    status: { stage: 'idle', healthy: true, error: null } });
  assert.equal(document.querySelector('output').textContent, 'false',
    'a distinct clean generation may seed its own baseline');
});

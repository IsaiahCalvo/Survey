import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function loadDocumentLockBanner() {
  // Transform JSX without creating a Vite dev server. Repeated middleware
  // server teardown can leave V8 cleanup handles live under Node 26.
  const componentPath = path.join(repoRoot, 'src/components/DocumentLockBanner.jsx');
  const readOnlyReasonsUrl = pathToFileURL(
    path.join(repoRoot, 'src/utils/readOnlyBodyReasons.js'),
  ).href;
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');

  source = source
    .replace(
      "import { useEffect, useLayoutEffect, useRef, useState } from 'react';",
      `import { useEffect, useLayoutEffect, useRef, useState } from ${JSON.stringify(reactUrl)};`,
    )
    .replace(
      /import \{\s*createDocumentLockStateSequence,\s*fetchDocumentLockState,\s*subscribeDocumentLockState,\s*\} from '\.\.\/services\/documentLockService\.js';/,
      `const {
        createDocumentLockStateSequence,
        fetchDocumentLockState,
        subscribeDocumentLockState,
      } = globalThis.__documentLockTestService;`,
    )
    .replace(
      "import { claimBodyReadOnly } from '../utils/readOnlyBodyReasons.js';",
      `import { claimBodyReadOnly } from ${JSON.stringify(readOnlyReasonsUrl)};`,
    )
    .replaceAll('import.meta.env.DEV', 'false');

  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(jsxRuntimeUrl),
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), 'document-lock-banner-test-'));
  const modulePath = path.join(tempDir, 'DocumentLockBanner.mjs');
  await writeFile(modulePath, executable);
  return {
    DocumentLockBanner: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

test('inactive locked tab retains lock state without disabling active unlocked tab', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__documentLockTestSubscriptions = new Map();
  globalThis.__documentLockTestService = {
    createDocumentLockStateSequence(onChange) {
      let generation = 0;
      return {
        snapshot: () => generation,
        applyInitial(value, state) {
          if (value !== generation) return false;
          onChange(state);
          return true;
        },
        applyRealtime(state) {
          generation += 1;
          onChange(state);
        },
      };
    },
    async fetchDocumentLockState() {
      return { lockedAt: null, lockedBy: null, lockedLabel: null };
    },
    subscribeDocumentLockState(documentId, onChange) {
      globalThis.__documentLockTestSubscriptions.set(documentId, onChange);
      return () => globalThis.__documentLockTestSubscriptions.delete(documentId);
    },
  };
  const { DocumentLockBanner, cleanup } = await loadDocumentLockBanner();

  try {
    const lockByDocument = new Map();
    const host = document.getElementById('root');
    const root = createRoot(host);
    const renderTabs = async (activeDocumentId) => {
      await act(async () => root.render(React.createElement(
        React.Fragment,
        null,
        ['doc-active', 'doc-hidden'].map((documentId) => React.createElement(
          DocumentLockBanner,
          {
            key: documentId,
            documentId,
            viewerUserId: 'viewer',
            isActive: activeDocumentId === documentId,
            onLockStateChange: (locked) => lockByDocument.set(documentId, locked),
          },
        )),
      )));
    };

    await renderTabs('doc-active');
    await act(async () => {
      globalThis.__documentLockTestSubscriptions.get('doc-hidden')({
        lockedAt: '2026-07-23T12:00:00.000Z',
        lockedBy: 'owner',
        lockedLabel: 'IFC',
      });
    });

    assert.equal(lockByDocument.get('doc-hidden'), true, 'hidden tab keeps its lock truth');
    assert.equal(document.body.getAttribute('data-readonly'), null);
    assert.equal(document.querySelector('[data-testid="kal49-lock-banner"]'), null);

    await renderTabs('doc-hidden');
    assert.equal(document.body.getAttribute('data-readonly'), 'true');
    assert.ok(document.querySelector('[data-testid="kal49-lock-banner"]'));

    await act(async () => root.unmount());
    assert.equal(document.body.getAttribute('data-readonly'), null);
  } finally {
    await cleanup();
    dom.window.close();
    delete globalThis.__documentLockTestService;
    delete globalThis.__documentLockTestSubscriptions;
  }

  const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(appShell, /isActive=\{isVisible\}/);
  assert.match(appShell, /documentLocked=\{documentLockedByTab\[tab\.id\] === true\}/);
});

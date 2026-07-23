import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

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

  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    plugins: [{
      name: 'document-lock-service-test-double',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/services/documentLockService.js')
          || source === '../services/documentLockService.js') {
          return '\0document-lock-service-test-double';
        }
        return null;
      },
      load(id) {
        if (id !== '\0document-lock-service-test-double') return null;
        return `
          export function createDocumentLockStateSequence(onChange) {
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
          }
          export async function fetchDocumentLockState() {
            return { lockedAt: null, lockedBy: null, lockedLabel: null };
          }
          export function subscribeDocumentLockState(documentId, onChange) {
            globalThis.__documentLockTestSubscriptions.set(documentId, onChange);
            return () => globalThis.__documentLockTestSubscriptions.delete(documentId);
          }
        `;
      },
    }],
  });

  try {
    const { default: DocumentLockBanner } = await vite.ssrLoadModule(
      '/src/components/DocumentLockBanner.jsx',
    );
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
    await vite.close();
    dom.window.close();
    delete globalThis.__documentLockTestSubscriptions;
  }

  const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(appShell, /isActive=\{isVisible\}/);
  assert.match(appShell, /documentLocked=\{documentLockedByTab\[tab\.id\] === true\}/);
});

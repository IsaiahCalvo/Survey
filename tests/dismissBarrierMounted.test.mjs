import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function loadDismissBarrier() {
  const componentPath = path.join(repoRoot, 'src/components/DismissBarrier.jsx');
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const source = (await readFile(componentPath, 'utf8')).replace(
    "import { useEffect } from 'react';",
    `import { useEffect } from ${JSON.stringify(reactUrl)};`,
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), 'dismiss-barrier-test-'));
  const modulePath = path.join(tempDir, 'DismissBarrier.mjs');
  await writeFile(modulePath, source);
  return {
    DismissBarrier: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

async function mountBarrier(insideRefs) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM('<!doctype html><div id="root"></div><button id="outside">Outside</button>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { DismissBarrier, cleanup } = await loadDismissBarrier();
  const root = createRoot(document.getElementById('root'));
  const dismissals = [];
  await act(async () => root.render(React.createElement(DismissBarrier, {
    insideRefs,
    onDismiss: (event) => dismissals.push(event.type),
  })));

  return {
    dismissals,
    errors,
    outside: document.getElementById('outside'),
    teardown: async () => {
      await act(async () => root.unmount());
      await cleanup();
      dom.window.close();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.Element;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

for (const eventType of ['click', 'pointerdown']) {
  test(`${eventType} ignores null and non-DOM inside refs, then dismisses`, async () => {
    const mounted = await mountBarrier([
      null,
      { current: null },
      { current: {} },
      {},
      'not-a-node',
    ]);
    try {
      const event = new window.Event(eventType, { bubbles: true, cancelable: true });
      mounted.outside.dispatchEvent(event);

      assert.deepEqual(mounted.errors, []);
      assert.deepEqual(mounted.dismissals, [eventType]);
      assert.equal(event.defaultPrevented, true);
    } finally {
      await mounted.teardown();
    }
  });
}

for (const eventType of ['click', 'pointerdown']) {
  test(`${eventType} within a DOM inside ref does not dismiss`, async () => {
    const inside = { current: null };
    const mounted = await mountBarrier([inside]);
    try {
      inside.current = mounted.outside;
      const event = new window.Event(eventType, { bubbles: true, cancelable: true });
      mounted.outside.dispatchEvent(event);

      assert.deepEqual(mounted.errors, []);
      assert.deepEqual(mounted.dismissals, []);
      assert.equal(event.defaultPrevented, false);
    } finally {
      await mounted.teardown();
    }
  });
}

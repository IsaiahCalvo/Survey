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

async function loadNotice() {
  const componentPath = path.join(repoRoot, 'src/components/UnsupportedAnnotationsNotice.jsx');
  const formatterUrl = pathToFileURL(
    path.join(repoRoot, 'src/utils/unsupportedAnnotationNotice.js'),
  ).href;
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');

  source = source
    .replace(
      "import { useCallback, useEffect, useRef, useState } from 'react';",
      `import { useCallback, useEffect, useRef, useState } from ${JSON.stringify(reactUrl)};`,
    )
    .replace(
      "import { formatUnsupportedAnnotationNotice } from '../utils/unsupportedAnnotationNotice';",
      `import { formatUnsupportedAnnotationNotice } from ${JSON.stringify(formatterUrl)};`,
    )
    .replace(
      "import Icon from '../Icons';",
      'const Icon = ({ name, size }) => <svg data-icon={name} width={size} height={size} />;',
    );

  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(jsxRuntimeUrl),
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), 'unsupported-notice-test-'));
  const modulePath = path.join(tempDir, 'UnsupportedAnnotationsNotice.mjs');
  await writeFile(modulePath, executable);
  return {
    Notice: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

async function mountNotice(t, initialCounts = { Redact: 1 }) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { Notice, cleanup } = await loadNotice();
  const host = document.getElementById('root');
  const root = createRoot(host);
  const dismissals = [];
  const render = async (unsupportedCounts = initialCounts) => {
    await act(async () => root.render(React.createElement(Notice, {
      unsupportedCounts,
      onDismiss: () => dismissals.push('dismissed'),
    })));
  };
  await render();

  return {
    dom,
    root,
    host,
    dismissals,
    render,
    advance: async (milliseconds) => {
      await act(async () => t.mock.timers.tick(milliseconds));
    },
    teardown: async () => {
      await act(async () => root.unmount());
      await cleanup();
      dom.window.close();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLElement;
      delete globalThis.Node;
      delete globalThis.MouseEvent;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function notice(host) {
  return host.querySelector('[aria-expanded]');
}

test('collapsed warning stays visible until dismissed', async (t) => {
  const mounted = await mountNotice(t);
  try {
    await mounted.advance(60_000);
    assert.equal(notice(mounted.host)?.style.opacity, '1');
    assert.equal(mounted.dismissals.length, 0);
  } finally {
    await mounted.teardown();
  }
});

test('a notice without redactions keeps its prior auto-dismiss timing', async (t) => {
  const mounted = await mountNotice(t, { Stamp: 1 });
  try {
    await mounted.advance(3000);
    assert.equal(notice(mounted.host)?.style.opacity, '0');
  } finally {
    await mounted.teardown();
  }
});

test('each notice tap toggles detail without starting a dismiss timer', async (t) => {
  const mounted = await mountNotice(t);
  try {
    await act(async () => notice(mounted.host).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(notice(mounted.host).getAttribute('aria-expanded'), 'true');
    await mounted.advance(60_000);
    assert.equal(notice(mounted.host).style.opacity, '1');
    await act(async () => notice(mounted.host).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(notice(mounted.host).getAttribute('aria-expanded'), 'false');
  } finally {
    await mounted.teardown();
  }
});

test('dismiss button exits immediately without toggling the notice', async (t) => {
  const mounted = await mountNotice(t);
  try {
    const dismiss = mounted.host.querySelector('button[aria-label="Dismiss"]');
    await act(async () => dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(notice(mounted.host).getAttribute('aria-expanded'), 'false');
    assert.equal(notice(mounted.host).style.opacity, '0');
  } finally {
    await mounted.teardown();
  }
});

test('document replacement keeps the new warning visible', async (t) => {
  const mounted = await mountNotice(t);
  try {
    await mounted.render({ Redact: 2 });
    await mounted.advance(60_000);
    assert.equal(notice(mounted.host)?.style.opacity, '1');
    assert.equal(mounted.dismissals.length, 0);
    await mounted.teardown();
    assert.equal(mounted.dismissals.length, 0);
  } finally {
    if (mounted.host.isConnected) await mounted.teardown();
  }
});

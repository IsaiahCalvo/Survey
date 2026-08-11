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

async function loadSyncStatusChip() {
  const componentPath = path.join(repoRoot, 'src/components/SyncStatusChip.jsx');
  const viewModelUrl = pathToFileURL(path.join(repoRoot, 'src/utils/syncStatusViewModel.js')).href;
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source
    .replace(
      "import { useMemo, useState, useRef } from 'react';",
      `import { useMemo, useState, useRef } from ${JSON.stringify(reactUrl)};`,
    )
    .replace(
      "import { getCompactSyncStatusMessage, getSyncStatusViewModel } from '../utils/syncStatusViewModel.js';",
      `import { getCompactSyncStatusMessage, getSyncStatusViewModel } from ${JSON.stringify(viewModelUrl)};`,
    )
    .replace(
      "import Spinner from './Spinner';",
      'const Spinner = ({ size }) => <span data-testid="spinner" data-size={size} />;',
    )
    .replace(
      "import Icon from '../Icons';",
      'const Icon = ({ name }) => <svg data-icon={name} />;',
    )
    .replace(
      "import DismissBarrier from './DismissBarrier';",
      'const DismissBarrier = () => null;',
    );
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sync-status-chip-test-'));
  const modulePath = path.join(tempDir, 'SyncStatusChip.mjs');
  await writeFile(modulePath, executable);
  return {
    SyncStatusChip: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

async function mountChip(status, queueSize = 0) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { SyncStatusChip, cleanup } = await loadSyncStatusChip();
  const root = createRoot(document.getElementById('root'));
  const retries = [];
  await act(async () => root.render(React.createElement(SyncStatusChip, {
    status,
    queueSize,
    enabled: true,
    onRetry: () => retries.push('retry'),
  })));
  return {
    root,
    retries,
    host: document.getElementById('root'),
    teardown: async () => {
      await act(async () => root.unmount());
      await cleanup();
      dom.window.close();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLElement;
      delete globalThis.Node;
      delete globalThis.MouseEvent;
      delete globalThis.CustomEvent;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test('green sync status retries immediately without opening details', async () => {
  const mounted = await mountChip({ stage: 'idle' });
  try {
    const control = mounted.host.querySelector('[role="button"]');
    await act(async () => control.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(mounted.retries.length, 1);
    assert.equal(mounted.host.querySelector('#sync-status-details'), null);
  } finally {
    await mounted.teardown();
  }
});

test('red sync status opens one sentence with an icon-only retry control', async () => {
  const mounted = await mountChip({ stage: 'error', error: 'network offline' }, 2);
  try {
    const control = mounted.host.querySelector('[role="button"]');
    await act(async () => control.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const dialog = mounted.host.querySelector('#sync-status-details');
    assert.ok(dialog);
    const message = dialog.querySelector('[data-sync-message]');
    assert.ok(message);
    assert.equal(message.textContent.split(/[.!?]+/).filter(Boolean).length, 1);
    const retry = dialog.querySelector('button[aria-label="Retry now"]');
    assert.ok(retry);
    assert.equal(retry.textContent.trim(), '');
  } finally {
    await mounted.teardown();
  }
});

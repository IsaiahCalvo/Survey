import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);

async function mount(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'survey-usage-indicator-'));
  const state = {
    user: { id: 'owned-fixture' }, usage: { projects: 1, documents: 2, storage: 50 },
    limits: { projects: 1, documents: 5, storage: 100 }, loading: false,
    tier: 'free', error: null, refreshes: 0,
    formatBytes: value => `${value} bytes`, getUsagePercentage: () => 50,
    refetch: async () => { state.refreshes++; }, ...overrides,
  };
  const key = `__usageIndicator_${Date.now()}_${Math.random()}`;
  globalThis[key] = state;
  const file = new URL('../src/components/UsageIndicator.jsx', import.meta.url);
  let source = await readFile(file, 'utf8');
  for (const [needle, replacement] of [
    ["import { useSubscriptionLimits } from '../hooks/useSubscriptionLimits';", `const useSubscriptionLimits = () => globalThis[${JSON.stringify(key)}];`],
    ["import { useAuth } from '../contexts/AuthContext';", `const useAuth = () => globalThis[${JSON.stringify(key)}];`],
  ]) {
    assert.ok(source.includes(needle)); source = source.replace(needle, replacement);
  }
  const result = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
  const moduleFile = path.join(dir, 'indicator.mjs');
  await writeFile(moduleFile, result.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)));
  const Indicator = (await import(pathToFileURL(moduleFile))).default;
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.getElementById('root');
  const root = createRoot(node);
  const render = async () => act(async () => root.render(React.createElement(Indicator)));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close(); delete globalThis[key];
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    await rm(dir, { recursive: true, force: true });
  });
  await render();
  return { state, node, render };
}

test('failed usage hides stale metrics and exposes an explicit retry', async t => {
  const { state, node, render } = await mount(t, { error: 'private backend detail' });
  assert.match(node.textContent, /Could not load usage/);
  assert.ok(node.querySelector('[role="alert"]'));
  assert.doesNotMatch(node.textContent, /Storage|50 bytes|private backend detail/);
  await act(async () => node.querySelector('button').click());
  assert.equal(state.refreshes, 1);
  state.error = null; await render();
  assert.match(node.textContent, /Storage/);
  assert.match(node.textContent, /50 bytes/);
  assert.equal(node.querySelector('[role="alert"]'), null);
});

test('loading and signed-out users do not display another account totals or retry', async t => {
  const { state, node, render } = await mount(t, { loading: true, error: 'offline' });
  assert.equal(node.textContent, '');
  state.loading = false; state.user = null; await render();
  assert.equal(node.textContent, '');
});

test('enterprise storage keeps its real finite cap while project limits stay unlimited', async t => {
  const { node } = await mount(t, {
    tier: 'enterprise', limits: { projects: 999999, documents: 999999, storage: 1024 ** 4 },
    usage: { projects: 2, documents: 3, storage: 1024 ** 3 },
  });
  assert.match(node.textContent, new RegExp(`${1024 ** 4} bytes`));
  assert.match(node.textContent, /∞/);
});

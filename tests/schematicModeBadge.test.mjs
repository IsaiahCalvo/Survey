// KAL-402 (F12 Schematic Mode): the page badge, mounted in jsdom.
// A drawing page shows "Schematic Mode"; a text page shows nothing; the
// panel arms Callout / Arrow / Cloud; "turn off" leaves a small chip that
// turns it back on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const url = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;
const storeUrl = url('src/utils/schematicPageStore.js');

async function loadBadge() {
  const file = path.join(repoRoot, 'src/components/SchematicModeBadge.jsx');
  let source = await readFile(file, 'utf8');
  const swap = (from, to) => {
    assert.ok(source.includes(from), `SchematicModeBadge.jsx still has: ${from}`);
    source = source.replace(from, to);
  };
  swap("from 'react';", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};`);
  swap("import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';",
    'const pdfjsLib = { OPS: { save: 1, restore: 2, transform: 3, constructPath: 4, paintImageXObject: 5 } };');
  swap("import Icon from '../Icons.jsx';", 'const Icon = () => null;');
  swap("from '../utils/pdfjsTextContent.js';", `from ${JSON.stringify(url('src/utils/pdfjsTextContent.js'))};`);
  swap("from '../utils/schematicPageStore.js';", `from ${JSON.stringify(storeUrl)};`);
  swap("from './dismissRules.js';", `from ${JSON.stringify(url('src/components/dismissRules.js'))};`);
  const out = await transformWithOxc(source, file, { lang: 'jsx' });
  const code = out.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const dir = await mkdtemp(path.join(tmpdir(), 'kal402-badge-'));
  const modulePath = path.join(dir, 'SchematicModeBadge.mjs');
  await writeFile(modulePath, code);
  return { mod: await import(pathToFileURL(modulePath).href), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// Page 1 is a full-page picture (a drawing); page 2 has body text.
const fakeDoc = {
  async getPage(n) {
    const words = n === 2 ? Array.from({ length: 80 }, () => ({ str: 'word word', width: 60, height: 12 })) : [];
    return {
      getViewport: () => ({ width: 200, height: 200 }),
      // The badge reads text the way the viewer does (pdfjsTextContent.js).
      streamTextContent: () => {
        let sent = false;
        return { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: { items: words, styles: {} } })) }) };
      },
      getOperatorList: async () => ({ fnArray: [3, 5], argsArray: [[200, 0, 0, 200, 0, 0], []] }),
    };
  },
};

test('badge: drawing page shows it, text page does not; tools arm; turn off and back on', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
  const { createRoot } = await import('react-dom/client');
  const { mod, cleanup } = await loadBadge();
  t.after(cleanup);
  const store = await import(storeUrl);
  const picked = [];
  const root = createRoot(document.getElementById('root'));
  const render = (pageNumber) => React.createElement(mod.default, {
    pdfDoc: fakeDoc, pageNumber, fingerprint: 'fp-test', activeTool: 'pan', lineBorderStyle: 'solid',
    onPickTool: (tool) => picked.push(tool),
  });
  const settle = async () => { await act(async () => { await store.waitForSchematicQueue(); }); };

  // Flag off (the default): no badge and no detection, even on a drawing page.
  assert.equal(mod.SCHEMATIC_MODE_ENABLED, false);
  assert.equal(mod.isSchematicModeEnabled(), false);
  await act(async () => { root.render(React.createElement('div', null, render(1), render(2))); });
  await settle();
  assert.equal(document.querySelectorAll('[data-schematic-badge]').length, 0, 'flag off renders nothing');
  assert.equal(store.getSchematicResult(fakeDoc, 1), undefined, 'flag off runs no detection');

  // Flag on (localStorage opt-in).
  window.localStorage.setItem(mod.SCHEMATIC_MODE_OPT_IN_KEY, '1');
  assert.equal(mod.isSchematicModeEnabled(), true);
  await act(async () => { root.render(React.createElement('div', { key: 'on' }, render(1), render(2))); });
  await settle();
  const badges = document.querySelectorAll('[data-schematic-badge]');
  assert.equal(badges.length, 1, 'only the drawing page has a badge');
  assert.equal(badges[0].getAttribute('data-schematic-badge'), 'on');
  assert.match(badges[0].textContent, /Schematic Mode/);
  assert.equal(document.querySelector('[data-schematic-kind]').getAttribute('data-schematic-kind'), 'raster');

  await act(async () => { badges[0].click(); });
  assert.ok(document.querySelector('[data-schematic-panel]'), 'panel opens');
  await act(async () => { document.querySelector('[data-schematic-tool="cloud"]').click(); });
  assert.deepEqual(picked, ['cloud']);
  assert.equal(document.querySelector('[data-schematic-panel]'), null, 'panel closes after a pick');

  await act(async () => { document.querySelector('[data-schematic-badge]').click(); });
  // The viewer's own Escape (drop the armed tool) must not also fire.
  let viewerSawEscape = false;
  const viewerEscape = (event) => { if (event.key === 'Escape') viewerSawEscape = true; };
  window.addEventListener('keydown', viewerEscape, true);
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  window.removeEventListener('keydown', viewerEscape, true);
  assert.equal(document.querySelector('[data-schematic-panel]'), null, 'Escape closes the panel');
  assert.equal(viewerSawEscape, false, 'Escape closes only the panel');

  await act(async () => { document.querySelector('[data-schematic-badge]').click(); });
  await act(async () => { document.querySelector('[data-schematic-turn-off]').click(); });
  assert.equal(document.querySelector('[data-schematic-badge]').getAttribute('data-schematic-badge'), 'off');
  assert.equal(store.isSchematicTurnedOff('fp-test', 1), true);
  await act(async () => { document.querySelector('[data-schematic-badge]').click(); });
  assert.equal(document.querySelector('[data-schematic-badge]').getAttribute('data-schematic-badge'), 'on');

  await act(async () => { root.unmount(); });
});

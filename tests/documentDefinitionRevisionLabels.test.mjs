import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

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

const entity = (id, name) => ({ id, name });
const receipt = entities => ({
  definitionRevision: 1,
  definitionDigest: 'a'.repeat(64),
  surveyDefinition: { modules: [] },
  entityCatalog: { entities },
});

test('label review pages every stable-ID change without hiding added, removed, or renamed labels', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const original = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const before = receipt([
    entity('01', 'Old 01'), entity('02', 'Removed 02'),
    ...Array.from({ length: 21 }, (_, index) => entity(String(index + 3).padStart(2, '0'), `Old ${index + 3}`)),
  ]);
  const after = receipt([
    entity('00', 'Added zero'), entity('01', 'New 01'),
    ...Array.from({ length: 21 }, (_, index) => entity(String(index + 3).padStart(2, '0'), `New ${index + 3}`)),
  ]);
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, {
    review: { currentReceipt: before, wire: after },
  })));
  assert.match(document.body.textContent, /Label changes \(24\)/);
  assert.match(document.body.textContent, /Added “Added zero”/);
  assert.match(document.body.textContent, /“Old 01” → “New 01”/);
  assert.match(document.body.textContent, /Removed “Removed 02”/);
  assert.doesNotMatch(document.body.textContent, /New 23/);
  const more = [...document.querySelectorAll('button')]
    .find(button => /Show 4 more \(4 remaining\)/.test(button.textContent));
  assert.ok(more, 'the unshown stable-ID rows have an explicit final-page action');
  await act(async () => more.click());
  assert.match(document.body.textContent, /“Old 23” → “New 23”/);
  assert.equal([...document.querySelectorAll('button')]
    .some(button => /Show .* more/.test(button.textContent)), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { preloadedComponent } from '../src/utils/preloadedComponent.js';

const Real = ({ label }) => createElement('b', null, label);

test('renders nothing before its chunk arrives, then renders synchronously once loaded', async () => {
  let imports = 0;
  const chunk = preloadedComponent(async () => { imports += 1; return { default: Real }; });

  assert.equal(renderToStaticMarkup(createElement(chunk.Component, { label: 'x' })), '');

  const [a, b] = await Promise.all([chunk.load(), chunk.load()]);
  assert.equal(a, Real);
  assert.equal(b, Real);
  assert.equal(imports, 1, 'one fetch however many callers ask');

  assert.equal(renderToStaticMarkup(createElement(chunk.Component, { label: 'ready' })), '<b>ready</b>');
});

test('a failed fetch can be retried', async () => {
  let attempts = 0;
  const chunk = preloadedComponent(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { default: Real };
  });
  await assert.rejects(chunk.load(), /offline/);
  assert.equal(await chunk.load(), Real);
  assert.equal(attempts, 2);
});

test('pick selects a named export', async () => {
  const chunk = preloadedComponent(async () => ({ Named: Real }), (m) => m.Named);
  assert.equal(await chunk.load(), Real);
});

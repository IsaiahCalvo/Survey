import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

let vite;
let Editor;
before(async () => {
  vite = await createServer({ configFile: false, envDir: false, appType: 'custom', server: { middlewareMode: true, hmr: false } });
  ({ default: Editor } = await vite.ssrLoadModule('/src/home/TemplatesEditor.jsx'));
});
after(async () => { await vite?.close(); });

async function mount(t, usage) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle, localStorage: dom.window.localStorage,
    requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const state = { usage, saves: [] };
  const props = {
    templates: [{ id: 'template-a', name: 'Checklist safety', modules: [{ id: 'module-a', name: 'Survey', categories: [{ id: 'category-a', name: 'Checks', checklist: [{ id: 'item-a', text: 'Keep historical answer' }] }] }], entities: [] }],
    initialMobileOpen: true,
    user: { id: 'fixture-user', email: 'fixture@example.test' },
    onSaveTemplates: async rows => state.saves.push(rows),
    getChecklistItemUsageCount: usage === undefined ? undefined : async () => {
      if (state.usage instanceof Error) throw state.usage;
      return state.usage;
    },
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Editor, props)));
  const click = async selector => {
    const button = typeof selector === 'string' ? document.querySelector(selector) : selector;
    assert.ok(button, `control exists: ${selector}`);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  };
  if (!document.querySelector('[aria-label="Delete item"]')) await click('button[title="Expand"]');
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
    }
  });
  return {
    state, click,
    render: async next => { Object.assign(props, next); await act(async () => root.render(React.createElement(Editor, props))); },
    save: () => click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')),
  };
}

test('failed usage check shows an error and keeps the item without saving', async t => {
  const h = await mount(t, new Error('offline'));
  await h.click('[aria-label="Delete item"]');
  assert.match(document.querySelector('[role="alert"]')?.textContent || '', /could not check/i);
  assert.ok(document.querySelector('input[value="Keep historical answer"]'));
  assert.equal(document.querySelector('[data-testid="archive-confirm-modal"]'), null);
  assert.deepEqual(h.state.saves, []);
  assert.ok(![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save'));
});

test('retry with positive usage archives the item and preserves its saved label', async t => {
  const h = await mount(t, new Error('offline'));
  await h.click('[aria-label="Delete item"]');
  h.state.usage = 2;
  await h.click('[aria-label="Delete item"]');
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok(document.querySelector('[data-testid="archive-confirm-modal"]'));
  assert.deepEqual(h.state.saves, []);
  await h.click('[data-testid="archive-confirm-archive"]');
  await h.save();
  const item = h.state.saves[0][0].modules[0].categories[0].checklist[0];
  assert.equal(item.id, 'item-a');
  assert.equal(item.archived, true);
  assert.equal(item.lastKnownLabel, 'Keep historical answer');
});

test('confirmed zero usage permits item removal and explicit Save', async t => {
  const h = await mount(t, 0);
  await h.click('[aria-label="Delete item"]');
  assert.equal(document.querySelector('[data-testid="archive-confirm-modal"]'), null);
  assert.equal(document.querySelector('input[value="Keep historical answer"]'), null);
  assert.deepEqual(h.state.saves, []);
  await h.save();
  assert.deepEqual(h.state.saves[0][0].modules[0].categories[0].checklist, []);
});

for (const value of [undefined, null, '0', -1, NaN]) {
  test(`unknown usage (${String(value)}) does not permit deletion`, async t => {
    const h = await mount(t, value);
    await h.click('[aria-label="Delete item"]');
    assert.match(document.querySelector('[role="alert"]')?.textContent || '', /nothing was deleted/i);
    assert.ok(document.querySelector('input[value="Keep historical answer"]'));
    assert.deepEqual(h.state.saves, []);
  });
}

test('a late usage count cannot delete the same item id in a different template', async t => {
  let finish;
  const h = await mount(t, new Promise(resolve => { finish = resolve; }));
  await h.click('[aria-label="Delete item"]');
  await h.render({ templates: [{ id: 'template-b', name: 'Other template', modules: [{ id: 'module-a', name: 'Survey', categories: [{ id: 'category-a', name: 'Checks', checklist: [{ id: 'item-a', text: 'Other retained answer' }] }] }], entities: [] }] });
  await act(async () => finish(0));
  assert.match(document.querySelector('[role="alert"]')?.textContent || '', /template changed/i);
  assert.deepEqual(h.state.saves, []);
  if (!document.querySelector('input[value="Other retained answer"]')) await h.click('button[title="Expand"]');
  assert.ok(document.querySelector('input[value="Other retained answer"]'));
});

test('an old archive confirmation cannot change a different template', async t => {
  const h = await mount(t, 2);
  await h.click('[aria-label="Delete item"]');
  await h.render({ templates: [{ id: 'template-b', name: 'Other template', modules: [{ id: 'module-a', name: 'Survey', categories: [{ id: 'category-a', name: 'Checks', checklist: [{ id: 'item-a', text: 'Other retained answer' }] }] }], entities: [] }] });
  await h.click('[data-testid="archive-confirm-archive"]');
  assert.match(document.querySelector('[role="alert"]')?.textContent || '', /template changed/i);
  assert.deepEqual(h.state.saves, []);
  if (!document.querySelector('input[value="Other retained answer"]')) await h.click('button[title="Expand"]');
  assert.ok(document.querySelector('input[value="Other retained answer"]'));
  assert.equal(document.querySelector('[data-testid="archived-items-category-a"]'), null);
});

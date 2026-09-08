import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import * as storageService from '../src/services/localStorageStatus.js';

const require = createRequire(import.meta.url);
const events = ['focus', 'local-document-store-changed', 'local-document-draft-changed', 'survey-offline-assets-status'];
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function mount(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' });
  const restore = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const calls = { estimate: 0, persisted: 0, persist: 0, timers: [] };
  let granted = false;
  Object.defineProperty(window, 'isSecureContext', { value: true });
  Object.defineProperty(window.navigator, 'storage', { value: {
    estimate: () => { calls.estimate++; return options.estimate ? options.estimate(calls.estimate) : { usage: 1024, quota: 10240 }; },
    persisted: () => { calls.persisted++; return options.persisted ? options.persisted(calls.persisted) : granted; },
    persist: () => { calls.persist++; return options.persist ? options.persist(calls.persist) : granted; },
  } });
  const tracked = new Map(events.map(name => [name, new Set()]));
  const add = window.addEventListener.bind(window); const remove = window.removeEventListener.bind(window);
  t.mock.method(window, 'addEventListener', (name, callback, ...args) => { tracked.get(name)?.add(callback); return add(name, callback, ...args); });
  t.mock.method(window, 'removeEventListener', (name, callback, ...args) => { tracked.get(name)?.delete(callback); return remove(name, callback, ...args); });
  const set = globalThis.setTimeout; const clear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay !== 1500) return set(callback, delay, ...args);
    const timer = { callback, canceled: false }; calls.timers.push(timer); return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', timer => {
    if (calls.timers.includes(timer)) timer.canceled = true; else clear(timer);
  });
  const key = `__storageStatus${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = { react: React, localStorageStatus: storageService };
  const file = new URL('../src/home/LocalStorageStatus.jsx', import.meta.url);
  const source = (await readFile(file, 'utf8')).replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_all, bindings, specifier) => {
    const name = specifier.split('/').at(-1).replace(/\.js$/, '');
    assert.ok(globalThis[key][name], `unmocked import ${specifier}`);
    return `const ${bindings} = globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}];`;
  });
  const output = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
  const code = output.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)) + '\n//# sourceURL=mounted-LocalStorageStatus.jsx';
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  delete globalThis[key];
  const root = createRoot(document.getElementById('root'));
  let active = options.active ?? true; let mounted = true;
  const render = async next => { if (next !== undefined) active = next; await act(async () => root.render(React.createElement(Component, { active }))); };
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => { await unmount(); dom.window.close(); restore.reverse().forEach(fn => fn()); });
  await render();
  return { calls, tracked, render, unmount, setGranted: value => { granted = value; },
    get text() { return document.body.textContent; },
    button: label => [...document.querySelectorAll('button')].find(button => button.textContent === label),
    async click(label) { const button = [...document.querySelectorAll('button')].find(button => button.textContent === label); assert.ok(button, label); await act(async () => button.click()); },
    async event(name) { await act(async () => window.dispatchEvent(new window.Event(name))); },
    async tick() { const timer = calls.timers.findLast(timer => !timer.canceled); assert.ok(timer, 'scheduled refresh'); timer.canceled = true; await act(async () => timer.callback()); },
  };
}

test('persistence is requested only by explicit clicks; denial and grant are shown accurately', async t => {
  let result = false;
  const h = await mount(t, { persist: () => result });
  assert.equal(h.calls.persist, 0);
  assert.match(h.text, /best-effort/);
  await h.click('Request persistent storage');
  assert.equal(h.calls.persist, 1);
  assert.match(h.text, /did not grant persistence/);
  result = true; h.setGranted(true);
  await h.click('Request persistent storage');
  assert.equal(h.calls.persist, 2);
  assert.match(h.text, /Persistent browser storage granted/);
  assert.doesNotMatch(h.text, /did not grant persistence/);
});

test('hidden panel has no reads/listeners; event bursts debounce and pending reads coalesce', async t => {
  const estimate = deferred();
  const h = await mount(t, { active: false, estimate: count => count === 2 ? estimate.promise : { usage: 1024, quota: 10000 } });
  assert.equal(h.calls.estimate, 0);
  assert.ok([...h.tracked.values()].every(set => set.size === 0));
  for (const event of events) await h.event(event);
  assert.equal(h.calls.timers.length, 0);
  await h.render(true);
  assert.ok([...h.tracked.values()].every(set => set.size === 1));
  assert.equal(h.calls.estimate, 1);
  for (const event of events) await h.event(event);
  assert.equal(h.calls.timers.filter(timer => !timer.canceled).length, 1);
  await h.tick();
  await h.click('Check storage');
  assert.equal(h.calls.estimate, 2);
  await h.render(false);
  assert.ok([...h.tracked.values()].every(set => set.size === 0));
  await act(async () => estimate.resolve({ usage: 2000, quota: 10000 }));
  assert.equal(h.calls.estimate, 2);
  assert.equal(h.calls.persist, 0);
});

test('reactivation waits for an old read then starts a fresh read without publishing stale results', async t => {
  const old = deferred(); const fresh = deferred();
  const h = await mount(t, { estimate: count => count === 1 ? old.promise : fresh.promise });
  await h.render(false); await h.render(true);
  assert.equal(h.calls.estimate, 1);
  await act(async () => old.resolve({ usage: 999 * 1024, quota: 10000000 }));
  assert.equal(h.calls.estimate, 2);
  assert.doesNotMatch(h.text, /999 KB/);
  await act(async () => fresh.resolve({ usage: 4 * 1024, quota: 10000000 }));
  assert.match(h.text, /4 KB/);
});

test('request completed while hidden does not leave a disabled busy button on reactivation', async t => {
  const request = deferred();
  const h = await mount(t, { persist: () => request.promise });
  await h.click('Request persistent storage');
  assert.equal(h.button('Requesting…').disabled, true);
  await h.render(false);
  await act(async () => request.resolve(false));
  await h.render(true);
  assert.ok(h.button('Request persistent storage'));
  assert.equal(h.button('Request persistent storage').disabled, false);
  assert.equal(h.calls.persist, 1);
});

test('a grant triggers a fresh read rather than joining an estimate captured before permission changed', async t => {
  const old = deferred();
  const h = await mount(t, { estimate: count => count === 2 ? old.promise : { usage: 1024, quota: 10000 }, persist: () => true });
  await h.click('Check storage');
  assert.equal(h.calls.estimate, 2);
  h.setGranted(true);
  await h.click('Request persistent storage');
  await act(async () => old.resolve({ usage: 2048, quota: 10000 }));
  assert.equal(h.calls.estimate, 3, 'permission completion requires a post-request read');
  assert.match(h.text, /Persistent browser storage granted/);
});

test('a pending permission request can finish after hide/reactivate and still refresh the visible scope', async t => {
  const request = deferred();
  const h = await mount(t, { persist: () => request.promise });
  await h.click('Request persistent storage');
  await h.render(false); await h.render(true);
  assert.equal(h.calls.estimate, 2);
  h.setGranted(true);
  await act(async () => request.resolve(true));
  assert.equal(h.calls.estimate, 3);
  assert.match(h.text, /Persistent browser storage granted/);
  assert.equal(h.calls.persist, 1);
});

test('unmount removes listeners and late read/request completion starts no new work', async t => {
  const estimate = deferred(); const request = deferred();
  const h = await mount(t, { estimate: count => count === 2 ? estimate.promise : { usage: 1024, quota: 10000 }, persist: () => request.promise });
  await h.click('Check storage'); await h.click('Request persistent storage');
  await h.unmount();
  await act(async () => { request.resolve(true); estimate.resolve({ usage: 5000, quota: 10000 }); });
  assert.equal(h.calls.estimate, 2);
  assert.equal(h.calls.persist, 1);
  assert.ok([...h.tracked.values()].every(set => set.size === 0));
});

test('old denial text is not published into a reactivated scope with current granted status', async t => {
  const request = deferred();
  const h = await mount(t, { persist: () => request.promise });
  const button = h.button('Request persistent storage');
  await act(async () => { button.click(); button.click(); });
  assert.equal(h.calls.persist, 1, 'one user request remains in flight');
  await h.render(false); h.setGranted(true); await h.render(true);
  await act(async () => request.resolve(false));
  assert.match(h.text, /Persistent browser storage granted/);
  assert.doesNotMatch(h.text, /did not grant persistence/);
  assert.equal(h.calls.persist, 1);
});

test('an unconfirmed explicit request remains advisory and can be retried', async t => {
  const h = await mount(t, { persist: () => { throw new Error('Browser denied access'); } });
  await h.click('Request persistent storage');
  assert.match(h.text, /request could not be confirmed/);
  assert.equal(h.button('Request persistent storage').disabled, false);
  assert.equal(h.calls.persist, 1);
  await h.event('focus'); await h.tick();
  assert.equal(h.calls.persist, 1, 'refresh must not automatically request permission');
});

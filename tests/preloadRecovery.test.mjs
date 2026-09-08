import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createPreloadRecovery } from '../src/utils/preloadRecovery.js';

function host() {
  const window = new EventTarget(); const values = new Map();
  window.navigator = { onLine: true }; window.reloads = 0;
  window.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  window.location = { reload() { window.reloads++; } };
  return window;
}
const emit = window => { const event = new Event('vite:preloadError', { cancelable: true }); window.dispatchEvent(event); return event; };

test('safe online startup retries once and respects persisted reload cooldown', () => {
  const window = host(); let time = 100_000;
  const recovery = createPreloadRecovery({ now: () => time }); recovery.install(window);
  assert.equal(emit(window).defaultPrevented, true); assert.equal(window.reloads, 1);
  assert.equal(emit(window).defaultPrevented, false); assert.equal(window.reloads, 1);
  time += 20_001;
  assert.equal(emit(window).defaultPrevented, true); assert.equal(window.reloads, 2);
});

test('offline or unknown network state blocks reload without consuming the online retry', () => {
  const window = host(); const recovery = createPreloadRecovery({ now: () => 100_000 });
  const notices = []; recovery.registerGuard(() => true, reason => notices.push(reason)); recovery.install(window);
  for (const state of [false, undefined]) { window.navigator.onLine = state; assert.equal(emit(window).defaultPrevented, false); }
  assert.equal(window.reloads, 0); assert.deepEqual(notices, ['offline', 'offline']);
  window.navigator.onLine = true;
  assert.equal(emit(window).defaultPrevented, true); assert.equal(window.reloads, 1);
});

test('every guard must prove safety; throwing readers and post-shell missing guards cannot authorize reload', () => {
  const window = host(); const recovery = createPreloadRecovery({ now: () => 100_000 }); recovery.install(window);
  const safe = recovery.registerGuard(() => true);
  const dirty = recovery.registerGuard(() => false);
  emit(window); assert.equal(window.reloads, 0);
  dirty();
  const unknown = recovery.registerGuard(() => { throw new Error('not available'); });
  emit(window); assert.equal(window.reloads, 0);
  safe(); unknown();
  emit(window); assert.equal(window.reloads, 0, 'an error-boundary teardown is not clean startup');
  recovery.registerGuard(() => true);
  emit(window); assert.equal(window.reloads, 1);
});

test('restricted session storage blocks reload; persisted cooldown survives a new controller and cleanup detaches', () => {
  for (const method of ['getItem', 'setItem']) {
    const window = host(); window.sessionStorage[method] = () => { throw new Error('restricted'); };
    createPreloadRecovery({ now: () => 100_000 }).install(window);
    assert.equal(emit(window).defaultPrevented, false); assert.equal(window.reloads, 0);
  }
  const window = host(); const first = createPreloadRecovery({ now: () => 100_000 }); const remove = first.install(window);
  emit(window); remove(); emit(window); assert.equal(window.reloads, 1);
  createPreloadRecovery({ now: () => 100_010 }).install(window);
  emit(window); assert.equal(window.reloads, 1);
});

test('real AppShell layout guard reads current active/inactive local and cloud tabs and surfaces a retry notice', async t => {
  const source = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('useLayoutEffect(() => registerPreloadRecoveryGuard(');
  const end = source.indexOf('\n  ), []);', start);
  assert.ok(start > 0 && end > start);
  const effectSource = source.slice(start + 'useLayoutEffect('.length, end + '\n  )'.length);
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /installPreloadRecovery\(window\)/);
  assert.doesNotMatch(main.slice(0, main.indexOf('// Console log capture')), /location\.reload/);
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const window = host(); const recovery = createPreloadRecovery({ now: () => 100_000 }); recovery.install(window);
  const notices = [];
  function ShellGuard({ tabs }) {
    const closeViewRef = useRef(null); closeViewRef.current = { tabs, activeTabId: 'home' };
    const effect = new Function('closeViewRef', 'registerPreloadRecoveryGuard', 'showToast', `return (${effectSource});`)(
      closeViewRef, recovery.registerGuard, (...args) => notices.push(args));
    useLayoutEffect(effect, []);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const home = { id: 'home', isHome: true, file: null };
  for (const file of [{ name: 'local.pdf' }, { id: 'cloud-doc' }]) {
    await act(async () => root.render(React.createElement(ShellGuard, { tabs: [home, { file, hasUnsavedAnnotations: false }] })));
    emit(window); assert.equal(window.reloads, 0);
    assert.match(notices.at(-1)[0], /Save and close/);
  }
  await act(async () => root.render(React.createElement(ShellGuard, { tabs: [home] })));
  window.navigator.onLine = false; emit(window); assert.equal(window.reloads, 0);
  assert.match(notices.at(-1)[0], /Reconnect/);
  window.navigator.onLine = true; emit(window); assert.equal(window.reloads, 1, 'same registered callback reads latest home-only tabs');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLAG_CACHE_KEY, waitForFirstFlags } from '../src/featureFlags.js';

// Features read their flag once at load, so a brand-new browser (no saved
// answers) waits for the server's first answer before the first render, or a
// feature turned on for everyone stays hidden for the whole first visit
// (audit 2026-11-10). Later loads must not wait at all.
const memory = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};

test('saved answers: renders at once, without waiting for the server', async () => {
  let timers = 0;
  const never = new Promise(() => {});
  await waitForFirstFlags(never, { storage: memory({ [FLAG_CACHE_KEY]: '{}' }), setTimer: () => { timers += 1; } });
  assert.equal(timers, 0);
});

test('no storage at all: renders at once (nothing could be saved or read)', async () => {
  await waitForFirstFlags(new Promise(() => {}), { storage: null, setTimer: () => assert.fail('no timer') });
});

test('a new browser waits for the first answer', async () => {
  const order = [];
  let answer;
  const first = new Promise((resolve) => { answer = resolve; });
  const wait = waitForFirstFlags(first, { storage: memory(), setTimer: () => {} }).then(() => order.push('render'));
  await Promise.resolve();
  order.push('answer');
  answer(true);
  await wait;
  assert.deepEqual(order, ['answer', 'render']);
});

test('a new browser stops waiting at the time limit, and a failed answer does not block', async () => {
  let fire;
  const wait = waitForFirstFlags(new Promise(() => {}), { storage: memory(), maxMs: 1500, setTimer: (fn, ms) => { assert.equal(ms, 1500); fire = fn; } });
  fire();
  await wait;
  await waitForFirstFlags(Promise.reject(new Error('offline')), { storage: memory(), setTimer: () => {} });
});

test('main.jsx holds the app\'s first render on the first flag answer', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /firstFlagsAnswer = Promise\.all\(\[import\('\.\/featureFlags'\), import\('\.\/supabaseClient'\)\]\)/);
  assert.match(main, /return refresh\(\);/);
  assert.match(main, /if \(!devRouteActive\) waitForFirstFlags\(firstFlagsAnswer\)\.then\(\(\) => \{\s*createRoot/);
});

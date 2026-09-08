import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function mount(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'survey-project-recovery-mounted-'));
  const state = { actorId: 'A', active: true, rows: new Map(), lists: [], clouds: [], runs: [], stages: [], saved: [], locks: [], discarded: [] };
  state.list = async actor => state.rows.get(actor) || [];
  state.run = async args => { state.runs.push(args); return { complete: true }; };
  const journal = { list: actor => { state.lists.push(actor); return state.list(actor); },
    get: async (actor, id) => (state.rows.get(actor) || []).find(row => row.id === id),
    discard: async (actor, id) => { state.discarded.push([actor, id]); } };
  const engine = {
    stageProjectUpload: async args => { state.stages.push(args); return 'attempt'; },
    resumeStaging: async args => { state.resumed = args; return args.attemptId; },
    runProjectUpload: args => state.run(args),
    withProjectUploadLock: async (args, work) => { state.locks.push(args); return work(); },
  };
  const key = `__projectRecovery${Math.random()}`;
  globalThis[key] = { engine };
  let source = await readFile(new URL('../src/home/useProjectUploadRecovery.js', import.meta.url), 'utf8');
  source = source.replace(/import \{ ([^}]+) \} from '([^']+)';/g, (line, names, file) => {
    if (file === 'react') return `import { ${names} } from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};`;
    if (file === './projectUploadRecovery.js') return `const { ${names} } = globalThis[${JSON.stringify(key)}].engine;`;
    return `const { ${names} } = {};`;
  });
  const modulePath = path.join(dir, 'hook.mjs'); await writeFile(modulePath, source);
  const { useProjectUploadRecovery } = await import(pathToFileURL(modulePath));
  const panelSource = await readFile(new URL('../src/home/ProjectUploadRecoveryPanel.jsx', import.meta.url), 'utf8');
  const panelJs = await transformWithOxc(panelSource, 'panel.jsx', { lang: 'jsx' });
  const panelPath = path.join(dir, 'panel.mjs');
  await writeFile(panelPath, panelJs.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)));
  const Panel = (await import(pathToFileURL(panelPath))).default;
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.getElementById('root'); const root = createRoot(node);
  const getJournal = () => journal;
  const makeCloud = async args => { state.clouds.push(args); return {}; };
  function App() {
    state.api = useProjectUploadRecovery({ actorId: state.actorId, active: state.active, getJournal, makeCloud,
      onSaved: () => { state.saved.push(state.actorId); return state.afterSaved?.(); } });
    return React.createElement(Panel, { recovery: state.api, onDiscard: row => state.api.discard(row.id) });
  }
  const render = () => act(async () => { root.render(React.createElement(App)); });
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close(); delete globalThis[key];
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await rm(dir, { recursive: true, force: true });
  });
  await render(); return { state, node, render };
}

test('metadata lists never auto-replay; hidden homes defer scans and current account masks old rows', async t => {
  const { state, node, render } = await mount(t);
  state.rows.set('A', [{ id: 'a', name: 'Only A', phase: 'running', files: [] }]);
  await act(async () => state.api.refresh());
  assert.match(node.textContent, /Only A/); assert.equal(state.clouds.length, 0);
  state.actorId = 'B'; state.active = false; await render();
  assert.doesNotMatch(node.textContent, /Only A/); assert.deepEqual(state.lists, ['A', 'A']);
  state.active = true; await render(); assert.deepEqual(state.lists, ['A', 'A', 'B']);
  assert.equal(state.runs.length, 0);
});

test('late A list cannot replace B or a fresh A list after A to B to A', async t => {
  const { state, node, render } = await mount(t); const old = defer();
  state.list = actor => actor === 'A' ? old.promise : [];
  let pending; await act(async () => { pending = state.api.refresh(); });
  state.actorId = 'B'; await render();
  state.list = async () => [{ id: 'fresh', name: 'Fresh A', phase: 'ready', files: [] }];
  state.actorId = 'A'; await render();
  await act(async () => { old.resolve([{ id: 'old', name: 'Old A', phase: 'ready', files: [] }]); await pending; });
  assert.match(node.textContent, /Fresh A/); assert.doesNotMatch(node.textContent, /Old A/);
});

test('same-turn duplicate submissions stop and retired account completion cannot update the new account', async t => {
  const { state, node, render } = await mount(t); const held = defer();
  state.run = args => { state.runs.push(args); return held.promise; };
  let pending; await act(async () => { pending = state.api.start('Test', []); });
  await act(async () => { await assert.rejects(state.api.start('Duplicate', []), /already running/); });
  assert.equal(state.stages.length, 1);
  state.actorId = 'B'; await render(); assert.doesNotMatch(node.textContent, /Saving upload/);
  assert.equal(state.runs[0].isCurrent(), false);
  await act(async () => { held.resolve({ complete: true }); await assert.rejects(pending, /account changed/); });
  assert.deepEqual(state.saved, []); assert.equal(node.textContent, '');
});

test('pending save error exposes explicit retry using existing attempt; cleanup needs no cloud client', async t => {
  const { state, node } = await mount(t);
  state.rows.set('A', [{ id: 'attempt', name: 'Queued project', phase: 'running', files: [{ state: 'staged' }] }]);
  state.run = async args => { state.runs.push(args); throw new Error('private transport detail'); };
  await act(async () => { await assert.rejects(state.api.start('Queued project', [])); });
  assert.match(node.textContent, /cloud work may already be saved/);
  assert.doesNotMatch(node.textContent, /private transport detail/);
  state.run = async args => { state.runs.push(args); return { complete: true }; };
  await act(async () => { node.querySelector('button[aria-label="Retry Queued project"]').click(); });
  assert.equal(state.stages.length, 1); assert.equal(state.runs.at(-1).attemptId, 'attempt');
  state.rows.set('A', [{ id: 'attempt', name: 'Queued project', phase: 'complete', files: [] }]);
  const before = state.clouds.length;
  await act(async () => state.api.retry('attempt'));
  assert.equal(state.clouds.length, before);
});

test('discard uses actor scoped lock and only the exact local journal entry', async t => {
  const { state, node } = await mount(t);
  await act(async () => state.api.discard('attempt'));
  assert.equal(state.locks.length, 1); assert.equal(state.locks[0].actorId, 'A'); assert.equal(state.locks[0].attemptId, 'attempt');
  assert.deepEqual(state.discarded, [['A', 'attempt']]); assert.equal(state.clouds.length, 0); assert.deepEqual(state.saved, []);
  assert.equal(node.querySelector('details').open, true, 'completion notice remains visible');
});

test('list failures keep known metadata and offer a read retry without cloud calls', async t => {
  const { state, node } = await mount(t);
  state.rows.set('A', [{ id: 'a', name: 'Keep this copy', phase: 'preparing', files: [{ state: 'pending' }] }]);
  await act(async () => state.api.refresh()); state.list = async () => { throw new Error('Quota detail'); };
  await act(async () => state.api.refresh());
  assert.match(node.textContent, /Keep this copy/); assert.match(node.textContent, /Could not read upload recovery/);
  assert.ok(node.querySelector('input[type=file]')); assert.equal(state.clouds.length, 0);
});

test('completion stays busy through held library and metadata reads before showing its receipt', async t => {
  const { state, node } = await mount(t); const saved = defer(); const listed = defer();
  state.afterSaved = () => saved.promise;
  let pending; await act(async () => { pending = state.api.start('Queued project', []); });
  assert.equal(state.api.busy, true); assert.doesNotMatch(node.textContent, /Project saved to the cloud/);
  state.list = () => listed.promise;
  await act(async () => { saved.resolve(); });
  assert.equal(state.api.busy, true); assert.doesNotMatch(node.textContent, /Project saved to the cloud/);
  await act(async () => { listed.resolve([]); await pending; });
  assert.equal(state.api.busy, false); assert.match(node.textContent, /Project saved to the cloud/);
  assert.equal(node.querySelector('details').open, true);
});

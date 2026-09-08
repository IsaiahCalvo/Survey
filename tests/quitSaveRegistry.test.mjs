import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuitSaveRegistry } from '../src/services/quitSaveRegistry.js';

test('all tabs save locally, including inactive tabs; home-only windows acknowledge empty work', async () => {
  const tabs = [{ id: 'a', file: {} }, { id: 'b', file: {} }];
  const registry = createQuitSaveRegistry(() => tabs);
  const calls = [];
  for (const id of ['a', 'b']) registry.register(id, {
    saveLocal: async () => { calls.push(id); return { saved: true, revision: id }; },
    getRevision: () => id,
  });
  assert.deepEqual(await registry.prepare(), { saved: true, tabIds: ['a', 'b'] });
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(registry.confirm(), { saved: true, tabIds: ['a', 'b'] });
  const empty = createQuitSaveRegistry(() => []);
  assert.deepEqual(await empty.prepare(), { saved: true, tabIds: [] });
  assert.deepEqual(empty.confirm(), { saved: true, tabIds: [] });
});

test('pending or failed local save never produces a positive window acknowledgment', async () => {
  let finish;
  const registry = createQuitSaveRegistry(() => [{ id: 'a', file: null }]);
  registry.register('a', { saveLocal: () => new Promise((resolve) => { finish = resolve; }), getRevision: () => 'a' });
  let settled = false;
  const preparing = registry.prepare().then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(registry.confirm().saved, false);
  finish({ saved: false });
  assert.equal((await preparing).saved, false);
});

test('new edits, changed tabs, missing callbacks and canceled saves fail closed', async () => {
  for (const mode of ['revision', 'tab', 'missing', 'cancel']) {
    let revision = 'saved';
    let tabs = [{ id: 'a', file: {} }];
    const registry = createQuitSaveRegistry(() => tabs);
    if (mode !== 'missing') registry.register('a', {
      saveLocal: async () => ({ saved: true, revision }), getRevision: () => revision,
    });
    const result = await registry.prepare();
    if (mode === 'missing') assert.equal(result.saved, false);
    if (mode === 'revision') revision = 'new edit';
    if (mode === 'tab') tabs = [{ id: 'a', file: {} }];
    if (mode === 'cancel') registry.cancel();
    assert.equal(registry.confirm().saved, false);
  }
});

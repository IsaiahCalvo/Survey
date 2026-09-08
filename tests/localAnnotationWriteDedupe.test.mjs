import test from 'node:test';
import assert from 'node:assert/strict';
import { saveAnnotationsByPage } from '../src/viewerShared.js';

function storage(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const state = { values: new Map(), writes: 0, readError: null, writeError: null };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) {
        if (state.readError) throw state.readError;
        return state.values.get(key) ?? null;
      },
      setItem(key, value) {
        state.writes += 1;
        if (state.writeError) throw state.writeError;
        state.values.set(key, value);
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  return state;
}

const snapshot = () => ({ 1: { objects: [{ id: 'mark', left: 1 }] } });
const key = 'annotationsByPage_current';

test('an automatic mirror followed by identical saves writes local storage only once', (t) => {
  const state = storage(t);
  const pages = snapshot();
  assert.equal(saveAnnotationsByPage('current', pages), true);
  assert.equal(saveAnnotationsByPage('current', pages), true);
  assert.equal(saveAnnotationsByPage('current', structuredClone(pages)), true);
  assert.equal(state.writes, 1);
  assert.deepEqual(JSON.parse(state.values.get(key)), pages);
});

test('an empty last-page deletion is saved once and remains durable', (t) => {
  const state = storage(t);
  assert.equal(saveAnnotationsByPage('current', snapshot()), true);
  assert.equal(saveAnnotationsByPage('current', {}), true);
  assert.equal(saveAnnotationsByPage('current', {}), true);
  assert.equal(state.writes, 2);
  assert.equal(state.values.get(key), '{}');
});

test('mutating a nested value on the same object still saves the new bytes', (t) => {
  const state = storage(t);
  const pages = snapshot();
  assert.equal(saveAnnotationsByPage('current', pages), true);
  pages[1].objects[0].left = 42;
  assert.equal(saveAnnotationsByPage('current', pages), true);
  assert.equal(state.writes, 2);
  assert.equal(JSON.parse(state.values.get(key))[1].objects[0].left, 42);
});

for (const externalChange of ['replacement', 'removal']) {
  test(`a storage ${externalChange} cannot make an identical save skip the needed write`, (t) => {
    const state = storage(t);
    const pages = snapshot();
    assert.equal(saveAnnotationsByPage('current', pages), true);
    if (externalChange === 'replacement') state.values.set(key, '{"older":"snapshot"}');
    else state.values.delete(key);
    assert.equal(saveAnnotationsByPage('current', pages), true);
    assert.equal(state.writes, 2);
    assert.deepEqual(JSON.parse(state.values.get(key)), pages);
  });
}

test('a failed changed write preserves saved data and a later retry writes the change', (t) => {
  const state = storage(t);
  const neighbor = 'annotationsByPage_other-local-doc';
  state.values.set(neighbor, '{"offline":"only copy"}');
  const pages = snapshot();
  assert.equal(saveAnnotationsByPage('current', pages), true);
  const saved = state.values.get(key);
  pages[1].objects[0].left = 42;
  state.writeError = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  assert.equal(saveAnnotationsByPage('current', pages), false);
  assert.equal(state.values.get(key), saved);
  assert.equal(state.values.get(neighbor), '{"offline":"only copy"}');
  state.writeError = null;
  assert.equal(saveAnnotationsByPage('current', pages), true);
  assert.equal(state.writes, 3, 'the failed write is not cached as a successful save');
  assert.equal(JSON.parse(state.values.get(key))[1].objects[0].left, 42);
});

test('already-saved bytes remain a successful backup when a redundant write would exceed quota', (t) => {
  const state = storage(t);
  const pages = snapshot();
  assert.equal(saveAnnotationsByPage('current', pages), true);
  state.writeError = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  assert.equal(saveAnnotationsByPage('current', pages), true);
  assert.equal(state.writes, 1, 'existing exact bytes need no new storage write');
});

for (const writeFails of [false, true]) {
  test(`a failed storage read still attempts the write and reports ${writeFails ? 'failure' : 'success'} truthfully`, (t) => {
    const state = storage(t);
    state.values.set(key, '{"previous":"copy"}');
    state.readError = new Error('read unavailable');
    state.writeError = writeFails ? new Error('write unavailable') : null;
    const pages = snapshot();
    assert.equal(saveAnnotationsByPage('current', pages), !writeFails);
    assert.equal(state.writes, 1);
    if (writeFails) assert.equal(state.values.get(key), '{"previous":"copy"}');
    else assert.deepEqual(JSON.parse(state.values.get(key)), pages);
  });
}

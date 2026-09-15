import test from 'node:test';
import assert from 'node:assert/strict';
import { readCheckedDocumentViewState, writeCheckedDocumentViewState } from '../src/services/checkedDocumentViewStateStore.js';

const id = n => `aa000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = (storage, patch = {}) => ({ storage,actorUserId:id(1),documentId:id(2),pdfGenerationId:id(3),...patch });
const state = patch => ({ pageNum:2,scale:1.234567,zoomMode:'manual',scrollMode:'continuous',
  scrollLeft:-25,scrollTop:900,...patch });

class MemoryStorage {
  constructor() { this.values = new Map(); this.gets = []; this.sets = []; }
  getItem(key) { this.gets.push(key); return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.sets.push(key); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('one exact generation key round-trips a frozen normalized six-field state', () => {
  const storage = new MemoryStorage();
  const written = writeCheckedDocumentViewState(scope(storage), state());
  assert.deepEqual(written, { pageNum:2,scale:1.2346,zoomMode:'manual',scrollMode:'continuous',scrollLeft:-25,scrollTop:900 });
  assert.equal(Object.isFrozen(written), true);
  const read = readCheckedDocumentViewState(scope(storage));
  assert.deepEqual(read, written); assert.equal(Object.isFrozen(read), true);
  assert.equal(storage.values.size, 1);
  const [key, raw] = [...storage.values.entries()][0];
  assert.match(key, /^checkedDocumentViewStateV1:/);
  assert.deepEqual(JSON.parse(raw), { version:1,actorUserId:id(1),documentId:id(2),pdfGenerationId:id(3),state:written });
});

test('actor, document and generation scopes are isolated without scans or fallback keys', () => {
  const storage = new MemoryStorage();
  writeCheckedDocumentViewState(scope(storage), state({ pageNum:7 }));
  for (const patch of [{ actorUserId:id(4) },{ documentId:id(5) },{ pdfGenerationId:id(6) }]) {
    assert.equal(readCheckedDocumentViewState(scope(storage, patch)), null);
  }
  assert.equal(storage.values.size, 1);
  assert.equal(new Set(storage.gets).size, 4);
});

test('state validation rejects every unsupported value before storage changes', () => {
  const invalid = [
    state({ pageNum:0 }),state({ pageNum:1.5 }),state({ scale:0.009 }),state({ scale:41 }),state({ scale:NaN }),
    state({ zoomMode:'auto' }),state({ scrollMode:'paged' }),state({ scrollLeft:1.5 }),
    state({ scrollTop:Number.MAX_SAFE_INTEGER + 1 }),{ ...state(), extra:true },
  ];
  for (const value of invalid) {
    const storage = new MemoryStorage();
    assert.throws(() => writeCheckedDocumentViewState(scope(storage), value), { code:'CHECKED_DOCUMENT_VIEW_STATE_INPUT' });
    assert.equal(storage.values.size, 0);
  }
  for (const zoomMode of ['fitPage','fitWidth','fitHeight','manual']) {
    const storage = new MemoryStorage();
    assert.equal(writeCheckedDocumentViewState(scope(storage), state({ zoomMode })).zoomMode, zoomMode);
  }
});

test('unavailable storage and quota failures use explicit codes and retain the prior raw value', () => {
  assert.throws(() => readCheckedDocumentViewState(scope(null)), { code:'CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED' });
  assert.throws(() => writeCheckedDocumentViewState(scope(null), state()), { code:'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED' });
  const storage = new MemoryStorage();
  writeCheckedDocumentViewState(scope(storage), state({ pageNum:3 }));
  const [key, before] = [...storage.values.entries()][0];
  storage.setItem = () => { throw Object.assign(new Error('quota'), { name:'QuotaExceededError' }); };
  assert.throws(() => writeCheckedDocumentViewState(scope(storage), state({ pageNum:4 })),
    { code:'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED' });
  assert.equal(storage.values.get(key), before);
  assert.equal(readCheckedDocumentViewState(scope(storage)).pageNum, 3);
});

test('corrupt, oversized and cross-scope envelopes stay raw and block reads and writes', () => {
  for (const raw of ['{bad', 'x'.repeat(2049), JSON.stringify({ version:1,actorUserId:id(9),documentId:id(2),
    pdfGenerationId:id(3),state:state() })]) {
    const storage = new MemoryStorage();
    const key = `checkedDocumentViewStateV1:${JSON.stringify([id(1),id(2),id(3)])}`;
    storage.values.set(key, raw);
    assert.throws(() => readCheckedDocumentViewState(scope(storage)), { code:'CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED' });
    assert.throws(() => writeCheckedDocumentViewState(scope(storage), state()), { code:'CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED' });
    assert.equal(storage.values.get(key), raw);
  }
});

test('prototype and accessor inputs fail without invoking accessors or touching storage', () => {
  const storage = new MemoryStorage(), accessed = [];
  const badState = state(); Object.defineProperty(badState, 'pageNum', { enumerable:true, get() { accessed.push('state'); return 1; } });
  assert.throws(() => writeCheckedDocumentViewState(scope(storage), badState), { code:'CHECKED_DOCUMENT_VIEW_STATE_INPUT' });
  const badScope = scope(storage); Object.defineProperty(badScope, 'documentId', {
    enumerable:true, get() { accessed.push('scope'); return id(2); },
  });
  assert.throws(() => readCheckedDocumentViewState(badScope), { code:'CHECKED_DOCUMENT_VIEW_STATE_INPUT' });
  assert.deepEqual(accessed, []); assert.equal(storage.gets.length + storage.sets.length, 0);
  const inherited = Object.assign(Object.create({ pageNum:2 }), state());
  assert.throws(() => writeCheckedDocumentViewState(scope(storage), inherited), { code:'CHECKED_DOCUMENT_VIEW_STATE_INPUT' });
});

test('scope UUIDs reject objects without coercion or storage access', () => {
  const storage = new MemoryStorage(), coerced = [];
  const boxed = { toString() { coerced.push(true); throw new Error('must not coerce'); } };
  assert.throws(() => readCheckedDocumentViewState(scope(storage, { actorUserId:boxed })),
    { code:'CHECKED_DOCUMENT_VIEW_STATE_INPUT' });
  assert.deepEqual(coerced, []);
  assert.equal(storage.gets.length + storage.sets.length, 0);
});

test('a hostile verification mismatch cannot report a successful write', () => {
  const storage = new MemoryStorage();
  storage.getItem = key => storage.values.has(key) ? `${storage.values.get(key)} ` : null;
  assert.throws(() => writeCheckedDocumentViewState(scope(storage), state()),
    { code:'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED' });
});

test('a peer write between set and verification is preserved while this write fails', () => {
  const storage = new MemoryStorage(), scoped = scope(storage);
  const peerState = state({ pageNum:9,scale:2 });
  const peerRaw = JSON.stringify({ version:1,actorUserId:id(1),documentId:id(2),pdfGenerationId:id(3),state:peerState });
  let reads = 0;
  storage.getItem = key => {
    reads += 1;
    if (reads === 1) return null;
    storage.values.set(key, peerRaw);
    return peerRaw;
  };
  assert.throws(() => writeCheckedDocumentViewState(scoped, state({ pageNum:4 })),
    { code:'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED' });
  assert.equal([...storage.values.values()][0], peerRaw);
  assert.equal(storage.sets.length, 1, 'the failed writer must not restore or remove after a peer wins');
});

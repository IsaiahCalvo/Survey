import test from 'node:test';
import assert from 'node:assert/strict';
import {
  libraryListCacheKey, readLibraryListCache, writeLibraryListCache,
  clearLibraryListCache, bindLibraryListCacheToAuth, LIBRARY_LIST_CACHE_PREFIX,
} from '../src/hooks/libraryListCache.js';

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}

test('entries are keyed per user and kind; another user never reads them', () => {
  const storage = memoryStorage();
  assert.equal(libraryListCacheKey(null, 'projects'), null);
  writeLibraryListCache('u1', 'documents:all', [{ id: 'd1' }], { storage });
  assert.deepEqual(readLibraryListCache('u1', 'documents:all', { storage }), [{ id: 'd1' }]);
  assert.equal(readLibraryListCache('u2', 'documents:all', { storage }), null);
  assert.equal(readLibraryListCache('u1', 'projects', { storage }), null);
  // A tampered entry whose stored owner differs is ignored.
  storage.setItem(libraryListCacheKey('u2', 'projects'), JSON.stringify({ userId: 'u1', rows: [{ id: 'p' }] }));
  assert.equal(readLibraryListCache('u2', 'projects', { storage }), null);
});

test('file bytes and data URLs are never written', () => {
  const storage = memoryStorage();
  writeLibraryListCache('u1', 'documents:all', [{
    id: 'd1', name: 'a.pdf', thumb: 'data:image/png;base64,AAAA', bytes: new Uint8Array([1, 2]), meta: { buf: new ArrayBuffer(4), ok: 1 },
  }], { storage });
  assert.deepEqual(readLibraryListCache('u1', 'documents:all', { storage }), [{ id: 'd1', name: 'a.pdf', meta: { ok: 1 } }]);
});

test('clear removes everything, or everything except the kept user', () => {
  const storage = memoryStorage();
  storage.setItem('unrelated', 'x');
  writeLibraryListCache('u1', 'projects', [], { storage });
  writeLibraryListCache('u2', 'projects', [], { storage });
  clearLibraryListCache({ keepUserId: 'u1', storage });
  assert.ok(readLibraryListCache('u1', 'projects', { storage }));
  assert.equal(readLibraryListCache('u2', 'projects', { storage }), null);
  clearLibraryListCache({ storage });
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith(LIBRARY_LIST_CACHE_PREFIX)).length, 0);
  assert.equal(storage.getItem('unrelated'), 'x');
});

test('auth binding clears on sign-out and drops other accounts on sign-in', () => {
  const storage = memoryStorage();
  let listener;
  bindLibraryListCacheToAuth({ auth: { onAuthStateChange: (fn) => { listener = fn; } } }, { storage });
  writeLibraryListCache('u1', 'projects', [{ id: 1 }], { storage });
  writeLibraryListCache('u2', 'projects', [{ id: 2 }], { storage });
  listener('SIGNED_IN', { user: { id: 'u2' } });
  assert.equal(readLibraryListCache('u1', 'projects', { storage }), null);
  assert.ok(readLibraryListCache('u2', 'projects', { storage }));
  listener('SIGNED_OUT', null);
  assert.equal(readLibraryListCache('u2', 'projects', { storage }), null);
  writeLibraryListCache('u3', 'templates', [], { storage });
  listener('INITIAL_SESSION', null);
  assert.equal(readLibraryListCache('u3', 'templates', { storage }), null);
});

test('INITIAL_SESSION with a stored refresh token keeps the list cache', () => {
  const storage = memoryStorage();
  storage.setItem('sb-cvam-auth-token', '{"refresh_token":"r"}');
  let listener;
  bindLibraryListCacheToAuth({
    auth: { onAuthStateChange: (fn) => { listener = fn; }, storageKey: 'sb-cvam-auth-token' },
  }, { storage });
  writeLibraryListCache('u1', 'projects', [{ id: 1 }], { storage });
  listener('INITIAL_SESSION', null);
  assert.deepEqual(readLibraryListCache('u1', 'projects', { storage }), [{ id: 1 }]);
  listener('SIGNED_OUT', null);
  assert.equal(readLibraryListCache('u1', 'projects', { storage }), null);
});

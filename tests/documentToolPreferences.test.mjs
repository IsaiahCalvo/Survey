import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocumentToolPreferencesClient,
  documentToolPreferenceScopeKey,
  resolveDocumentToolPreferenceScope,
  validateDocumentToolPreferences,
} from '../src/services/documentToolPreferences.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function makeLockManager() {
  const queues = new Map();
  return {
    request(name, _options, work) {
      const prior = queues.get(name) || Promise.resolve();
      const next = prior.catch(() => {}).then(work);
      const tracked = next.catch(() => {}).finally(() => { if (queues.get(name) === tracked) queues.delete(name); });
      queues.set(name, tracked);
      return next;
    },
  };
}

function makeCloud(actorId = 'actor-a') {
  const calls = [];
  const listeners = new Set();
  let currentActor = actorId;
  let responder = () => ({ data: null, error: null });
  const cloud = {
    calls,
    auth: {
      getSession: async () => ({ data: { session: currentActor
        ? { user: { id: currentActor }, access_token: `token-${currentActor}` } : null }, error: null }),
      onAuthStateChange(callback) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      },
    },
    rpc(name, args) {
      const call = { name, args, headers: {} };
      calls.push(call);
      const builder = {
        setHeader(key, value) { call.headers[key] = value; return builder; },
        abortSignal(signal) { call.signal = signal; return builder; },
        retry() { return builder; },
        then(resolve, reject) { Promise.resolve().then(() => responder(call)).then(resolve, reject); },
      };
      return builder;
    },
    respondWith(fn) { responder = fn; },
    setActor(nextActor, event = 'SIGNED_IN') {
      currentActor = nextActor;
      const session = nextActor ? { user: { id: nextActor }, access_token: `token-${nextActor}` } : null;
      for (const listener of [...listeners]) listener(event, session);
    },
    listenerCount() { return listeners.size; },
  };
  return cloud;
}

const prefs = (color = '#ff0000', width = 3) => ({ pen: { strokeColor: color, strokeWidth: width, strokeOpacity: 100 } });
const cloudScope = actorUserId => resolveDocumentToolPreferenceScope({ actorUserId, documentId: 'local-doc', supabaseDocId: 'cloud-doc' });
const written = (call, revision) => ({ data: { status: 'written', version: 1, documentId: 'cloud-doc', revision,
  clientRevision: call.args.p_client_revision, preferences: call.args.p_preferences, updatedAt: '2026-09-14T12:00:00Z' }, error: null });

test('scope rules keep cloud, signed local, guest local, and unavailable cloud distinct', () => {
  const cloud = cloudScope('actor-a');
  const signed = resolveDocumentToolPreferenceScope({ actorUserId: 'actor-a', documentId: 'local-doc' });
  const guest = resolveDocumentToolPreferenceScope({ documentId: 'local-doc' });
  assert.equal(cloud.kind, 'account-cloud');
  assert.equal(signed.kind, 'account-local');
  assert.equal(guest.kind, 'device-local');
  assert.equal(documentToolPreferenceScopeKey(cloud), JSON.stringify(['account-cloud','actor-a','local-doc','cloud-doc']));
  assert.equal(documentToolPreferenceScopeKey(signed), JSON.stringify(['account-local','actor-a','local-doc']));
  assert.equal(documentToolPreferenceScopeKey(guest), JSON.stringify(['device-local','device-local','local-doc']));
  assert.equal(resolveDocumentToolPreferenceScope({ documentId: 'local-doc', supabaseDocId: 'cloud-doc' }), null);
});

test('validator accepts only the 16 tools and five style fields', () => {
  assert.deepEqual(validateDocumentToolPreferences(prefs()), prefs());
  assert.deepEqual(validateDocumentToolPreferences({ pen:{ strokeColor:'#abcd',fillColor:'rgb(1,2,3,0.5)' },
    rect:{ strokeColor:'rgba(1,2,3)' }, text:{ strokeColor:'blue' } }),
  { pen:{ fillColor:'rgb(1,2,3,0.5)',strokeColor:'#abcd' },rect:{ strokeColor:'rgba(1,2,3)' },text:{ strokeColor:'blue' } });
  assert.throws(() => validateDocumentToolPreferences({ favorite: { strokeColor: '#fff' } }), { code: 'DOCUMENT_TOOL_PREFERENCES_INVALID' });
  assert.throws(() => validateDocumentToolPreferences({ pen: { entityId: 'shared' } }), { code: 'DOCUMENT_TOOL_PREFERENCES_INVALID' });
  assert.throws(() => validateDocumentToolPreferences({ pen: { strokeOpacity: 101 } }), { code: 'DOCUMENT_TOOL_PREFERENCES_INVALID' });
  assert.throws(() => validateDocumentToolPreferences({ pen:{ strokeColor:'#abcde' } }), { code:'DOCUMENT_TOOL_PREFERENCES_INVALID' });
  assert.throws(() => validateDocumentToolPreferences({ pen:{ strokeColor:'url(javascript:x)' } }), { code:'DOCUMENT_TOOL_PREFERENCES_INVALID' });
});

test('signed and guest local documents stay device-side and account keys do not collide', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const service = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: makeLockManager(), makeRevision: () => 'local-revision' });
  const signed = resolveDocumentToolPreferenceScope({ actorUserId: 'actor-a', documentId: 'local-doc' });
  const guest = resolveDocumentToolPreferenceScope({ documentId: 'local-doc' });
  service.admit(signed, prefs('#00ff00'));
  service.admit(guest, prefs('#0000ff'));
  assert.equal(service.snapshot(signed).preferences.pen.strokeColor, '#00ff00');
  assert.equal(service.snapshot(guest).preferences.pen.strokeColor, '#0000ff');
  await service.flush(signed);
  await service.refresh(guest);
  assert.equal(cloud.calls.length, 0);
});

test('cloud admission is durable before RPC and exact receipt alone clears it', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  cloud.respondWith(call => written(call, 1));
  const scope = cloudScope('actor-a');
  const service = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: makeLockManager(), makeRevision: () => 'client-one' });
  service.admit(scope, prefs('#00ff00'));
  assert.equal(cloud.calls.length, 0);
  assert.equal(service.snapshot(scope).pending, true);
  const result = await service.flush(scope, { isCurrent: () => true });
  assert.equal(cloud.calls.length, 1);
  assert.equal(cloud.calls[0].name, 'write_document_tool_preferences');
  assert.equal(cloud.calls[0].headers.Authorization, 'Bearer token-actor-a');
  assert.equal(result.pending, false);
  assert.equal(result.revision, 1);
});

test('bad receipt and stale CAS keep the exact durable draft', async () => {
  for (const response of [
    { data: { status: 'written', version: 1, documentId: 'other', revision: 1 }, error: null },
    { data: null, error: { code: '40001' } },
  ]) {
    const storage = new MemoryStorage();
    const cloud = makeCloud();
    cloud.respondWith(() => response);
    const scope = cloudScope('actor-a');
    const service = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: makeLockManager(), makeRevision: () => 'client-one' });
    service.admit(scope, prefs('#00ff00'));
    const before = [...storage.values.values()].find(value => value.includes('client-one'));
    await assert.rejects(service.flush(scope, { isCurrent: () => true }));
    assert.equal(service.snapshot(scope).pending, true);
    assert.ok([...storage.values.values()].includes(before));
  }
});

test('an offline send keeps one exact draft and retry sends the same CAS request', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  let attempt = 0;
  cloud.respondWith(call => {
    attempt += 1;
    if (attempt === 1) throw new Error('offline');
    return written(call, 1);
  });
  const scope = cloudScope('actor-a');
  const service = createDocumentToolPreferencesClient({ client: cloud, storage,
    lockManager: makeLockManager(), makeRevision: () => 'offline-client' });
  service.admit(scope, prefs('#00ff00'));
  const raw = [...storage.values.values()].find(value => value.includes('offline-client'));
  await assert.rejects(service.flush(scope, { isCurrent: () => true }));
  assert.equal(service.snapshot(scope).pending, true);
  assert.ok([...storage.values.values()].includes(raw));
  const result = await service.flush(scope, { isCurrent: () => true });
  assert.equal(result.pending, false);
  assert.equal(cloud.calls.length, 2);
  assert.deepEqual(cloud.calls[1].args, cloud.calls[0].args);
});

test('an exact receipt cannot clear a newer unrelated local draft', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  let release;
  cloud.respondWith(call => new Promise(resolve => { release = () => resolve(written(call, 1)); }));
  let revision = 0;
  const service = createDocumentToolPreferencesClient({ client: cloud, storage,
    lockManager: makeLockManager(), makeRevision: () => `exact-${++revision}` });
  const scope = cloudScope('actor-a');
  service.admit(scope, prefs('#00ff00', 3));
  const flushing = service.flush(scope, { isCurrent: () => true });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  service.admit(scope, prefs('#0000ff', 9));
  release();
  const result = await flushing;
  assert.equal(cloud.calls.length, 1);
  assert.equal(result.pending, true);
  assert.equal(result.preferences.pen.strokeColor, '#0000ff');
  assert.match([...storage.values.values()].find(value => value.includes('exact-2')), /"expectedRevision":0/);
});

test('an older in-flight conflict marks the hook-linked successor without overwriting its intent', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  let releaseWrite;
  cloud.respondWith(call => call.name === 'write_document_tool_preferences'
    ? new Promise(resolve => { releaseWrite = () => resolve({ data:null,error:{ code:'40001' } }); })
    : { data:{ status:'present',version:1,documentId:'cloud-doc',revision:2,
      clientRevision:'remote-client',preferences:prefs('blue'),updatedAt:'2026-09-14T12:00:00Z' },error:null });
  let revision = 0;
  const service = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:makeLockManager(),
    tabId:'same-tab', makeRevision:() => `same-client-${++revision}` });
  const firstPreferences = prefs('red', 3);
  service.admit(scope, firstPreferences, { basePreferences:{} });
  const flushing = service.flush(scope, { isCurrent:() => true });
  while (!releaseWrite) await new Promise(resolve => setImmediate(resolve));
  service.admit(scope, prefs('green', 9), { basePreferences:firstPreferences });
  const newerRaw = [...storage.values.values()].find(value => value.includes('same-client-2'));
  releaseWrite();
  await assert.rejects(flushing, { code:'40001' });
  const conflictedRaw = [...storage.values.values()].find(value => value.includes('same-client-2'));
  assert.notEqual(conflictedRaw, newerRaw);
  const conflicted = JSON.parse(conflictedRaw);
  assert.equal(conflicted.clientRevision, 'same-client-2');
  assert.deepEqual(conflicted.preferences, prefs('green', 9));
  assert.equal(conflicted.predecessorClientRevision, 'same-client-1');
  assert.equal(conflicted.conflictRevision, 2);
  assert.equal(service.snapshot(scope).preferences.pen.strokeColor, 'green');
  assert.equal(service.snapshot(scope).conflict, true);
  service.resolveConflict(scope, 'keep');
  cloud.respondWith(call => written(call, 3));
  const result = await service.flush(scope, { isCurrent:() => true });
  assert.equal(result.pending, false);
  assert.equal(cloud.calls.at(-1).args.p_client_revision, 'same-client-3');
  assert.deepEqual(cloud.calls.at(-1).args.p_preferences, prefs('green', 9));
});

test('a newer admitted draft rebases only after its exact predecessor receipt', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  let releaseFirst;
  let count = 0;
  cloud.respondWith(call => {
    count += 1;
    if (count === 1) return new Promise(resolve => { releaseFirst = () => resolve(written(call, 1)); });
    return written(call, 2);
  });
  let sequence = 0;
  const service = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: makeLockManager(), makeRevision: () => `client-${++sequence}` });
  const scope = cloudScope('actor-a');
  const firstPreferences = prefs('#00ff00', 3);
  service.admit(scope, firstPreferences);
  const flushing = service.flush(scope, { isCurrent: () => true });
  while (!releaseFirst) await new Promise(resolve => setImmediate(resolve));
  service.admit(scope, prefs('#00ff00', 7), { basePreferences: firstPreferences });
  releaseFirst();
  const result = await flushing;
  assert.equal(cloud.calls.length, 2);
  assert.equal(cloud.calls[1].args.p_expected_revision, 1);
  assert.equal(cloud.calls[1].args.p_preferences.pen.strokeWidth, 7);
  assert.equal(result.pending, false);
  assert.equal(result.revision, 2);
});

test('two tabs keep two drafts and disjoint stale work rebases after the first exact receipt', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  const first = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:makeLockManager(),
    tabId:'tab-a', makeRevision:() => 'client-a' });
  const second = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:makeLockManager(),
    tabId:'tab-b', makeRevision:() => 'client-b' });
  first.admit(scope, { pen:{ strokeColor:'red' } });
  second.admit(scope, { rect:{ strokeWidth:4 } });
  const pendingKeys = () => [...storage.values.keys()].filter(key => key.includes(':pending:'));
  assert.equal(pendingKeys().length, 2);

  let releaseFirst;
  let releaseSecond;
  let remote = null;
  cloud.respondWith(call => {
    if (call.name === 'read_document_tool_preferences') {
      return { data:{ status:'present',version:1,documentId:'cloud-doc',revision:1,
        clientRevision:'client-a',preferences:remote,updatedAt:'2026-09-14T12:00:00Z' },error:null };
    }
    if (call.args.p_client_revision === 'client-a') {
      return new Promise(resolve => { releaseFirst = () => {
        remote = call.args.p_preferences;
        resolve(written(call, 1));
      }; });
    }
    if (call.args.p_expected_revision === 0) return { data:null,error:{ code:'40001' } };
    return new Promise(resolve => { releaseSecond = () => {
      remote = call.args.p_preferences;
      resolve(written(call, 2));
    }; });
  });
  const flushing = first.flush(scope, { isCurrent:() => true });
  while (!releaseFirst) await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingKeys().length, 2);
  releaseFirst();
  while (!releaseSecond) await new Promise(resolve => setImmediate(resolve));
  const pendingAfterFirstReceipt = pendingKeys();
  releaseSecond();
  const result = await flushing;
  assert.equal(pendingAfterFirstReceipt.length, 1, 'the first receipt must remove only its exact draft');
  assert.match(pendingAfterFirstReceipt[0], /tab-b/);
  assert.equal(result.pending, false);
  assert.deepEqual(remote, { pen:{ strokeColor:'red' },rect:{ strokeWidth:4 } });
  assert.deepEqual(cloud.calls.map(call => [call.name,call.args.p_expected_revision]), [
    ['write_document_tool_preferences',0],
    ['write_document_tool_preferences',0],
    ['read_document_tool_preferences',undefined],
    ['write_document_tool_preferences',1],
  ]);
});

test('an overlapping tab draft stays exact and a new tab discovers it without retrying', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const locks = makeLockManager();
  const scope = cloudScope('actor-a');
  const first = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:locks,
    tabId:'tab-a', makeRevision:() => 'client-a' });
  const second = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:locks,
    tabId:'tab-b', makeRevision:() => 'client-b' });
  first.admit(scope, { pen:{ strokeColor:'red' } });
  second.admit(scope, { pen:{ strokeColor:'blue' } });
  let current = null;
  cloud.respondWith(call => {
    if (call.name === 'read_document_tool_preferences') return { data:{ status:'present',version:1,
      documentId:'cloud-doc',revision:1,clientRevision:'client-a',preferences:current,
      updatedAt:'2026-09-14T12:00:00Z' },error:null };
    if (!current) { current = call.args.p_preferences; return written(call, 1); }
    return { data:null,error:{ code:'40001' } };
  });
  await assert.rejects(first.flush(scope, { isCurrent:() => true }), { code:'40001' });
  const orphanKey = [...storage.values.keys()].find(key => key.includes(':pending:'));
  const orphanRaw = storage.getItem(orphanKey);
  assert.match(orphanKey, /tab-b/);
  assert.match(orphanRaw, /client-b/);
  assert.equal(first.snapshot(scope).preferences.pen.strokeColor, 'blue');

  const callsBeforeRetry = cloud.calls.length;
  const recovery = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:locks, tabId:'tab-c' });
  assert.equal(recovery.snapshot(scope).conflict, true);
  await assert.rejects(recovery.flush(scope, { isCurrent:() => true }),
    { code:'DOCUMENT_TOOL_PREFERENCES_CONFLICT_ACTION_REQUIRED' });
  assert.equal(cloud.calls.length, callsBeforeRetry);
  assert.equal(storage.getItem(orphanKey), orphanRaw);
});

test('the seventeenth tab draft fails without evicting any of the first sixteen', () => {
  const storage = new MemoryStorage();
  const scope = cloudScope('actor-a');
  for (let index = 0; index < 16; index += 1) {
    createDocumentToolPreferencesClient({ storage, tabId:`tab-${String(index).padStart(2,'0')}`,
      makeRevision:() => `client-${index}` }).admit(scope, prefs('#ff0000', index));
  }
  const before = new Map(storage.values);
  const overflow = createDocumentToolPreferencesClient({ storage, tabId:'tab-16', makeRevision:() => 'client-16' });
  assert.throws(() => overflow.admit(scope, prefs('#00ff00')), { code:'DOCUMENT_TOOL_PREFERENCES_PENDING_LIMIT' });
  assert.deepEqual(storage.values, before);
  assert.equal([...storage.values.keys()].filter(key => key.includes(':pending:')).length, 16);
});

test('an overlapping other-tab CAS conflict keeps the draft and caches remote truth', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  cloud.respondWith(call => call.name === 'write_document_tool_preferences'
    ? { data:null, error:{ code:'40001' } }
    : { data:{ status:'present',version:1,documentId:'cloud-doc',revision:1,
      clientRevision:'other-tab',preferences:prefs('#0000ff'),updatedAt:'2026-09-14T12:00:00Z' },error:null });
  const scope = cloudScope('actor-a');
  const service = createDocumentToolPreferencesClient({ client:cloud, storage,
    lockManager:makeLockManager(), makeRevision:() => 'local-conflict' });
  service.admit(scope, prefs('#00ff00'));
  const raw = [...storage.values.values()].find(value => value.includes('local-conflict'));
  await assert.rejects(service.flush(scope, { isCurrent:() => true }), { code:'40001' });
  const state = service.snapshot(scope);
  assert.equal(state.pending, true);
  assert.equal(state.conflict, true);
  assert.equal(state.preferences.pen.strokeColor, '#00ff00');
  assert.equal(state.revision, 1);
  const conflicted = [...storage.values.values()].find(value => value.includes('local-conflict'));
  assert.notEqual(conflicted, raw);
  assert.equal(JSON.parse(conflicted).clientRevision, 'local-conflict');
  assert.deepEqual(JSON.parse(conflicted).preferences, prefs('#00ff00'));
  assert.equal(JSON.parse(conflicted).conflictRevision, 1);
  assert.deepEqual(cloud.calls.map(call => call.name),
    ['write_document_tool_preferences','read_document_tool_preferences']);
});

test('conflict blocks later edits until keep explicitly rebases the exact draft', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  let revision = 0;
  const service = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:makeLockManager(),
    tabId:'keep-tab', makeRevision:() => `keep-client-${++revision}` });
  cloud.respondWith(call => call.name === 'write_document_tool_preferences'
    ? { data:null,error:{ code:'40001' } }
    : { data:{ status:'present',version:1,documentId:'cloud-doc',revision:3,
      clientRevision:'saved-client',preferences:prefs('blue'),updatedAt:'2026-09-14T12:00:00Z' },error:null });
  service.admit(scope, prefs('red'));
  await assert.rejects(service.flush(scope, { isCurrent:() => true }), { code:'40001' });
  assert.equal(service.snapshot(scope).conflict, true);
  const conflicted = new Map(storage.values);
  const callsBeforeChoice = cloud.calls.length;
  assert.throws(() => service.admit(scope, prefs('green')),
    { code:'DOCUMENT_TOOL_PREFERENCES_CONFLICT_ACTION_REQUIRED' });
  assert.deepEqual(storage.values, conflicted);
  assert.equal(cloud.calls.length, callsBeforeChoice);

  const chosen = service.resolveConflict(scope, 'keep');
  assert.equal(chosen.conflict, false);
  assert.equal(chosen.pending, true);
  assert.equal(chosen.preferences.pen.strokeColor, 'red');
  const pending = JSON.parse([...storage.values.values()].find(value => value.includes('keep-client-2')));
  assert.equal(pending.expectedRevision, 3);
  assert.equal(pending.basePreferences.pen.strokeColor, 'blue');
  cloud.respondWith(call => written(call, 4));
  assert.equal((await service.flush(scope, { isCurrent:() => true })).pending, false);
});

test('use-saved conflict choice backs up the exact raw draft and removes only that pending row', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  const service = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:makeLockManager(),
    tabId:'saved-tab', makeRevision:() => 'saved-local-client' });
  cloud.respondWith(call => call.name === 'write_document_tool_preferences'
    ? { data:null,error:{ code:'40001' } }
    : { data:{ status:'present',version:1,documentId:'cloud-doc',revision:5,
      clientRevision:'remote-client',preferences:prefs('blue'),updatedAt:'2026-09-14T12:00:00Z' },error:null });
  service.admit(scope, prefs('red'));
  await assert.rejects(service.flush(scope, { isCurrent:() => true }), { code:'40001' });
  const pendingKey = [...storage.values.keys()].find(key => key.includes(':pending:'));
  const exactConflictRaw = storage.getItem(pendingKey);
  const callsBeforeChoice = cloud.calls.length;
  const chosen = service.resolveConflict(scope, 'saved');
  assert.equal(chosen.conflict, false);
  assert.equal(chosen.pending, false);
  assert.equal(chosen.revision, 5);
  assert.equal(chosen.preferences.pen.strokeColor, 'blue');
  assert.equal(storage.getItem(pendingKey), null);
  const backupKey = [...storage.values.keys()].find(key => key.includes(':conflictBackup:'));
  assert.ok(backupKey);
  assert.equal(JSON.parse(storage.getItem(backupKey)).rawDraft, exactConflictRaw);
  assert.equal(cloud.calls.length, callsBeforeChoice);
});

test('a cross-key envelope never renders or uploads under another account', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud('actor-b');
  const locks = makeLockManager();
  const source = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: locks, makeRevision: () => 'client-a' });
  const scopeA = cloudScope('actor-a');
  source.admit(scopeA, prefs('#00ff00'));
  const scopeB = cloudScope('actor-b');
  const keyB = `documentToolPreferencesV2:pending:${documentToolPreferenceScopeKey(scopeB)}:${JSON.stringify('foreign-tab')}`;
  const rawA = [...storage.values.entries()].find(([key]) => key.includes('pending'))[1];
  storage.setItem(keyB, rawA);
  const serviceB = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: locks });
  assert.equal(serviceB.snapshot(scopeB).errorCode, 'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED');
  const result = await serviceB.refresh(scopeB, { isCurrent: () => true });
  assert.equal(result.errorCode, 'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED');
  assert.equal(cloud.calls.length, 0);
});

test('a cross-key cache fails closed before any cloud read', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud('actor-b');
  const scopeA = cloudScope('actor-a');
  const scopeB = cloudScope('actor-b');
  storage.setItem(`documentToolPreferencesV2:cache:${documentToolPreferenceScopeKey(scopeB)}`, JSON.stringify({
    version:1,status:'present',scopeKey:documentToolPreferenceScopeKey(scopeA),documentId:'cloud-doc',
    revision:1,clientRevision:'actor-a-write',preferences:prefs('#00ff00'),updatedAt:'2026-09-14T12:00:00Z',
  }));
  const service = createDocumentToolPreferencesClient({ client:cloud, storage, lockManager:makeLockManager() });
  assert.equal(service.snapshot(scopeB).errorCode, 'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED');
  const result = await service.refresh(scopeB, { isCurrent:() => true });
  assert.equal(result.errorCode, 'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED');
  assert.equal(cloud.calls.length, 0);
});

test('corrupt or quota-failed storage blocks all cloud work', async () => {
  const scope = cloudScope('actor-a');
  const cloud = makeCloud();
  const corrupt = new MemoryStorage();
  corrupt.setItem(`documentToolPreferencesV2:pending:${documentToolPreferenceScopeKey(scope)}:${JSON.stringify('corrupt-tab')}`, '{bad-json');
  const corruptService = createDocumentToolPreferencesClient({ client:cloud, storage:corrupt, lockManager:makeLockManager() });
  assert.equal((await corruptService.refresh(scope, { isCurrent:() => true })).errorCode,
    'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED');
  assert.equal(cloud.calls.length, 0);

  const quotaStorage = new MemoryStorage();
  quotaStorage.setItem = () => { throw Object.assign(new Error('quota'), { name:'QuotaExceededError' }); };
  const quotaService = createDocumentToolPreferencesClient({ client:cloud, storage:quotaStorage, lockManager:makeLockManager() });
  assert.throws(() => quotaService.admit(scope, prefs('#00ff00')),
    { code:'DOCUMENT_TOOL_PREFERENCES_LOCAL_WRITE_FAILED' });
  assert.equal(cloud.calls.length, 0);
});

test('auth switch aborts the send, keeps the draft, and releases the actor lock', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  let release;
  cloud.respondWith(call => new Promise(resolve => { release = () => resolve(written(call, 1)); }));
  const scope = cloudScope('actor-a');
  const service = createDocumentToolPreferencesClient({ client:cloud, storage,
    lockManager:makeLockManager(), makeRevision:() => 'auth-switch' });
  service.admit(scope, prefs('#00ff00'));
  const first = service.flush(scope, { isCurrent:() => true });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  cloud.setActor('actor-b');
  release();
  await assert.rejects(first, { code:'DATABASE_MUTATION_SCOPE_CHANGED' });
  assert.equal(service.snapshot(scope).pending, true);
  assert.equal(cloud.listenerCount(), 0);
  cloud.setActor('actor-a');
  cloud.respondWith(call => written(call, 1));
  assert.equal((await service.flush(scope, { isCurrent:() => true })).pending, false);
  assert.equal(cloud.listenerCount(), 0);
});

test('the lock deadline abort signal reaches an RPC already running after lock grant', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  let release;
  cloud.respondWith(call => new Promise(resolve => { release = () => resolve(written(call, 1)); }));
  const service = createDocumentToolPreferencesClient({ client:cloud, storage,
    lockManager:makeLockManager(), tabId:'deadline-tab', makeRevision:() => 'deadline-client' });
  service.admit(scope, prefs('red'));
  const pendingRaw = [...storage.values.values()].find(value => value.includes('deadline-client'));
  const nativeSetTimeout = globalThis.setTimeout;
  let shortenedAcquireTimer = false;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 60000 && !shortenedAcquireTimer) {
      shortenedAcquireTimer = true;
      return nativeSetTimeout(callback, 0, ...args);
    }
    return nativeSetTimeout(callback, delay, ...args);
  };
  try {
    const flushing = service.flush(scope, { isCurrent:() => true });
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(flushing, { code:'DATABASE_MUTATION_ABORTED' });
    assert.equal(cloud.calls.length, 1);
    assert.equal(cloud.calls[0].signal.aborted, true);
    assert.ok([...storage.values.values()].includes(pendingRaw));
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    release?.();
  }
});

test('verified legacy actor draft is shown offline and migrates only after a missing read', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  const legacyKey = `toolPrefsPending_${JSON.stringify(['actor-a', 'local-doc', 'cloud-doc'])}`;
  const legacyRaw = JSON.stringify({ version: 1, revision: 'legacy-client', preferences: prefs('#00ff00') });
  storage.setItem(legacyKey, legacyRaw);
  const service = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: makeLockManager() });
  assert.equal(service.snapshot(scope).preferences.pen.strokeColor, '#00ff00');
  cloud.respondWith(call => call.name === 'read_document_tool_preferences'
    ? { data: { status: 'missing', version: 1, documentId: 'cloud-doc', revision: 0, clientRevision: null, preferences: null, updatedAt: null }, error: null }
    : written(call, 1));
  const result = await service.flush(scope, { isCurrent: () => true });
  assert.equal(result.pending, false);
  assert.equal(storage.getItem(legacyKey), null);
  assert.deepEqual(cloud.calls.map(call => call.name), ['read_document_tool_preferences', 'write_document_tool_preferences']);
  assert.equal(cloud.calls[1].args.p_expected_revision, 0);
});

test('existing private row quarantines the exact legacy draft', async () => {
  const storage = new MemoryStorage();
  const cloud = makeCloud();
  const scope = cloudScope('actor-a');
  const legacyKey = `toolPrefsPending_${JSON.stringify(['actor-a', 'local-doc', 'cloud-doc'])}`;
  const raw = JSON.stringify({ version: 1, revision: 'legacy-client', preferences: prefs('#00ff00') });
  storage.setItem(legacyKey, raw);
  cloud.respondWith(() => ({ data: { status: 'present', version: 1, documentId: 'cloud-doc', revision: 4,
    clientRevision: 'other', preferences: prefs('#0000ff'), updatedAt: '2026-09-14T12:00:00Z' }, error: null }));
  const service = createDocumentToolPreferencesClient({ client: cloud, storage, lockManager: makeLockManager() });
  await assert.rejects(service.flush(scope, { isCurrent: () => true }), { code: 'DOCUMENT_TOOL_PREFERENCES_LEGACY_CONFLICT' });
  assert.equal(storage.getItem(legacyKey), raw);
  assert.equal(cloud.calls.length, 1);
});

test('ambiguous old device key is left unread and unchanged', () => {
  const storage = new MemoryStorage();
  storage.setItem('toolPrefs_local-doc', JSON.stringify(prefs('#00ff00')));
  const service = createDocumentToolPreferencesClient({ storage });
  const guest = resolveDocumentToolPreferenceScope({ documentId: 'local-doc' });
  assert.equal(service.snapshot(guest).preferences, null);
  assert.ok(storage.getItem('toolPrefs_local-doc'));
});

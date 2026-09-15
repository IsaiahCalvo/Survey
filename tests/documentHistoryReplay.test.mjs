import test from 'node:test';
import assert from 'node:assert/strict';
import {
  replayDocumentHistoryRow,
  startDocumentHistoryReplay,
} from '../src/services/documentHistoryReplay.js';

const row = (id, changes = {}) => ({ document_id: 'doc-1', user_id: 'actor-a', client_event_id: id,
  event_type: 'edit', source: 'local', page_number: 1, annotation_id: id, summary: id,
  payload: {}, is_undoable: true, is_checkpoint: false, occurred_at: '2026-09-14T12:00:00Z', ...changes });
const item = (id, changes = {}) => ({ row: row(id, changes), token: { scopeKey: 'account:actor-a',
  documentId: 'doc-1', clientEventId: id, revision: 1, rowDigest: `digest-${id}` }, attemptCount: 0 });

function cloudHarness({ write = value => ({ data: [value], error: null }),
  read = value => ({ data: [value], error: null }) } = {}) {
  const calls = [];
  let authListener = null;
  let activeRow = null;
  const query = (kind, result) => {
    const q = {
      setHeader(name, value) { calls.push(['header', kind, name, value]); return q; },
      abortSignal() { return q; }, retry(value) { calls.push(['retry', kind, value]); return q; },
      then(resolve, reject) { calls.push(['dispatch', kind]); return Promise.resolve()
        .then(() => result()).then(resolve, reject); },
    };
    return q;
  };
  const cloud = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'actor-a' }, access_token: 'token-a' } }, error: null }),
      onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from() {
      return {
        upsert(value) { activeRow = value; calls.push(['upsert', value]);
          return { select: () => query('write', () => write(value)) }; },
        select() {
          const q = { eq() { return q; }, limit() { return q; },
            setHeader: (...args) => { calls.push(['header', 'read', ...args]); return q; },
            abortSignal() { return q; }, retry(value) { calls.push(['retry', 'read', value]); return q; },
            then(resolve, reject) { calls.push(['dispatch', 'read']); return Promise.resolve()
              .then(() => read(activeRow)).then(resolve, reject); } };
          return q;
        },
      };
    },
  };
  return { cloud, calls, auth: (...args) => authListener?.(...args) };
}

const lock = { request(_name, _options, callback) { return callback({ name: 'held' }); } };
function pendingStore(entry, { confirm = true } = {}) {
  let pending = entry;
  const calls = [];
  return {
    calls,
    async getPending(token) { calls.push(['getPending', token]); return pending; },
    async confirm(token, cloudRow) { calls.push(['confirm', token, cloudRow]); if (confirm) pending = null; return confirm; },
    async setScopeError(scope, code) { calls.push(['scopeError', scope, code]); return true; },
  };
}

test('new writes confirm from one actor-bound request; ignored duplicates require exact readback', async () => {
  for (const duplicate of [false, true]) {
    const entry = item(duplicate ? 'duplicate' : 'new');
    const store = pendingStore(entry);
    const cloud = cloudHarness({ write: value => ({ data: duplicate ? [] : [value], error: null }) });
    const result = await replayDocumentHistoryRow({ actorUserId: 'actor-a', isCurrent: () => true,
      cloud: cloud.cloud, localStore: store, item: entry, lockManager: lock });
    assert.equal(result.status, 'confirmed');
    assert.equal(cloud.calls.filter(call => call[0] === 'dispatch').length, duplicate ? 2 : 1);
    assert.equal(cloud.calls.filter(call => call[0] === 'header').every(call => call.at(-1) === 'Bearer token-a'), true);
  }
});

test('two lock contenders re-read the exact token and send only once', async () => {
  let tail = Promise.resolve();
  const serialLock = { request(_name, _options, callback) {
    const next = tail.then(() => callback({ name: 'held' })); tail = next.catch(() => {}); return next;
  } };
  const entry = item('once');
  const store = pendingStore(entry);
  const cloud = cloudHarness();
  const args = { actorUserId: 'actor-a', isCurrent: () => true, cloud: cloud.cloud,
    localStore: store, item: entry, lockManager: serialLock };
  const results = await Promise.all([replayDocumentHistoryRow(args), replayDocumentHistoryRow(args)]);
  assert.deepEqual(results.map(result => result.status), ['confirmed', 'stale']);
  assert.equal(cloud.calls.filter(call => call[0] === 'upsert').length, 1);
});

test('actor change while waiting for the lock aborts before any cloud query', async () => {
  let enter;
  const waitingLock = { request(_name, _options, callback) { return new Promise(resolve => { enter = () => resolve(callback({})); }); } };
  let current = true;
  const entry = item('switch');
  const store = pendingStore(entry);
  const cloud = cloudHarness();
  const resultPromise = replayDocumentHistoryRow({ actorUserId: 'actor-a', isCurrent: () => current,
    cloud: cloud.cloud, localStore: store, item: entry, lockManager: waitingLock });
  current = false; enter();
  assert.equal((await resultPromise).status, 'aborted');
  assert.equal(cloud.calls.some(call => call[0] === 'upsert'), false);
});

function manualTimers() {
  const pending = [];
  return { pending,
    setTimeoutFn(fn, delay) { const task = { fn, delay, cancelled: false }; pending.push(task); return task; },
    clearTimeoutFn(task) { if (task) task.cancelled = true; },
    async runNext() { const task = pending.shift(); assert.ok(task); if (!task.cancelled) await task.fn(); return task; },
  };
}

test('scheduler processes one bounded page, continues past poison, and does not poll when idle', async () => {
  const timers = manualTimers();
  const poison = item('poison'); const good = item('good');
  let page = 0; const deferred = []; const confirmed = [];
  const store = {
    subscribe() { return () => {}; }, async setScopeError() {},
    async getPending(token) { return token.clientEventId === 'poison' ? poison : good; },
    async listPending() { page += 1; return page === 1
      ? { items: [poison], nextCursor: 'next', nextRetryAt: null }
      : { items: [good], nextCursor: null, nextRetryAt: null }; },
    async confirm(token) { if (token.clientEventId === 'poison') return false; confirmed.push(token.clientEventId); return true; },
    async deferPending(token, options) { deferred.push([token.clientEventId, options]); return 'updated'; },
  };
  const cloud = cloudHarness();
  const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
    cloud: cloud.cloud, localStore: store, lockManager: lock,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await timers.runNext();
  assert.equal(page, 1); assert.equal(timers.pending[0].delay, 0);
  await timers.runNext();
  assert.equal(page, 2); assert.deepEqual(confirmed, ['good']);
  assert.equal(deferred[0][0], 'poison'); assert.equal(deferred[0][1].permanent, true);
  assert.equal(timers.pending.length, 0, 'idle actors are event driven, not polled');
  stop();
});

test('scheduler re-reads each listed token and skips a row confirmed during an earlier send', async () => {
  const timers = manualTimers(); const first = item('first'); const second = item('second');
  let secondPending = true;
  const cloud = cloudHarness({ write: value => {
    if (value.client_event_id === 'first') secondPending = false;
    return { data: [value], error: null };
  } });
  const store = { subscribe() { return () => {}; }, async setScopeError() {},
    async listPending() { return { items: [first, second], nextCursor: null, nextRetryAt: null }; },
    async getPending(token) { return token.clientEventId === 'first' ? first : (secondPending ? second : null); },
    async confirm() { return true; }, async deferPending() { return 'updated'; } };
  const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
    cloud: cloud.cloud, localStore: store, lockManager: lock,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await timers.runNext();
  assert.equal(cloud.calls.filter(call => call[0] === 'upsert').length, 1);
  stop();
});

test('scheduler coalesces a wake during a run and schedules a durable future retry', async () => {
  const timers = manualTimers(); let listener; let calls = 0;
  const due = Date.now() + 5000;
  const store = { subscribe(_scope, fn) { listener = fn; return () => { listener = null; }; },
    async setScopeError() {}, async listPending() { calls += 1; if (calls === 1) listener?.();
      return { items: [], nextCursor: null, nextRetryAt: calls === 1 ? due : null }; } };
  const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
    cloud: cloudHarness().cloud, localStore: store, lockManager: lock,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await timers.runNext();
  assert.equal(timers.pending[0].delay, 0, 'one coalesced wake follows the active run');
  await timers.runNext();
  assert.ok(timers.pending[0].delay > 0 && timers.pending[0].delay <= 5000);
  stop(); assert.equal(listener, null);
});

test('missing Web Locks reports scoped status and sends nothing', async () => {
  const timers = manualTimers(); const errors = [];
  const store = { subscribe() { throw new Error('must not subscribe'); },
    async setScopeError(scope, code) { errors.push([scope, code]); } };
  startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
    cloud: cloudHarness().cloud, localStore: store, lockManager: null,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await Promise.resolve();
  assert.deepEqual(errors, [['account:actor-a', 'DOCUMENT_HISTORY_SAFE_LOCK_UNAVAILABLE']]);
  assert.equal(timers.pending.length, 0);
});

test('scheduled nonblocking locks omit the forbidden signal option', async () => {
  const timers = manualTimers(); let optionsSeen;
  const specLock = { request(_name, options, callback) {
    optionsSeen = options;
    if (options.ifAvailable && Object.hasOwn(options, 'signal')) {
      throw Object.assign(new Error('signal and ifAvailable cannot be combined'), { name: 'NotSupportedError' });
    }
    return callback({ name: 'held' });
  } };
  const store = { subscribe() { return () => {}; }, async setScopeError() {},
    async listPending() { return { items: [], nextCursor: null, nextRetryAt: null }; } };
  const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
    cloud: cloudHarness().cloud, localStore: store, lockManager: specLock,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await timers.runNext();
  assert.deepEqual(optionsSeen, { mode: 'exclusive', ifAvailable: true });
  assert.equal(timers.pending.length, 0);
  stop();
});

test('permanent rows replay only through the explicit recovery option', async () => {
  for (const retryPermanent of [false, true]) {
    const timers = manualTimers(); let optionSeen; const permanent = item('permanent');
    const store = { subscribe() { return () => {}; }, async setScopeError() {},
      async listPending(_scope, options) { optionSeen = options.includePermanent;
        return { items: retryPermanent ? [permanent] : [], nextCursor: null, nextRetryAt: null }; },
      async getPending(_token, options) { assert.equal(options.includePermanent, true); return permanent; },
      async confirm() { return true; }, async deferPending() { return 'updated'; } };
    const cloud = cloudHarness();
    const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
      cloud: cloud.cloud, localStore: store, lockManager: lock, retryPermanent,
      setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    await timers.runNext();
    assert.equal(optionSeen, retryPermanent);
    assert.equal(cloud.calls.filter(call => call[0] === 'upsert').length, retryPermanent ? 1 : 0);
    stop();
  }
});

test('list and confirm failures stay protected, surface status, and get a bounded retry', async () => {
  for (const failure of ['list', 'confirm']) {
    const timers = manualTimers(); const errors = [];
    const entry = item(failure);
    const store = { subscribe() { return () => {}; },
      async setScopeError(_scope, code) { if (code) errors.push(code); },
      async listPending() {
        if (failure === 'list') throw new Error('idb read failed');
        return { items: [entry], nextCursor: null, nextRetryAt: null };
      },
      async getPending() { return entry; },
      async confirm() { throw new Error('idb confirm failed'); },
      async deferPending() { throw new Error('must remain pending'); },
    };
    const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
      cloud: cloudHarness().cloud, localStore: store, lockManager: lock,
      baseDelayMs: 25, maxDelayMs: 100,
      setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    await timers.runNext();
    assert.deepEqual(errors, ['DOCUMENT_HISTORY_REPLAY_FAILED']);
    assert.equal(timers.pending[0].delay, 25);
    stop();
  }
});

test('retry metadata quota failure reports full and does not timer-spin', async () => {
  const timers = manualTimers(); const errors = []; let sends = 0;
  const entry = item('quota');
  const cloud = cloudHarness({ write: () => { sends += 1; return {
    data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0,
  }; } });
  const store = { subscribe() { return () => {}; },
    async setScopeError(_scope, code) { if (code) errors.push(code); },
    async listPending() { return { items: [entry], nextCursor: null, nextRetryAt: null }; },
    async getPending() { return entry; },
    async deferPending() { throw Object.assign(new Error('full'),
      { code: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' }); },
  };
  const stop = startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => true,
    cloud: cloud.cloud, localStore: store, lockManager: lock,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await timers.runNext();
  assert.equal(sends, 1);
  assert.deepEqual(errors, ['DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED']);
  assert.equal(timers.pending.length, 0, 'quota failure waits for an external/store wake');
  stop();
});

test('throwing current-account checks stop safely and clean listeners', async () => {
  const timers = manualTimers(); let unsubscribed = 0; let removed = 0;
  const store = { subscribe() { return () => { unsubscribed += 1; }; }, async setScopeError() {} };
  const target = { addEventListener() {}, removeEventListener() { removed += 1; } };
  startDocumentHistoryReplay({ actorUserId: 'actor-a', isCurrent: () => { throw new Error('stale'); },
    cloud: cloudHarness().cloud, localStore: store, lockManager: lock, eventTarget: target,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  await timers.runNext();
  assert.equal(unsubscribed, 1); assert.equal(removed, 1);
});

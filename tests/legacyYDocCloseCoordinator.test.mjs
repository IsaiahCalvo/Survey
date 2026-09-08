import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createLegacyYDocCloseCoordinator } from '../src/lib/collab/legacyYDocCloseCoordinator.js';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(check(), 'expected protocol event did not arrive');
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(t, { deferAppend = false, verifySnapshot } = {}) {
  const scopeKey = getLegacyYDocScopeKey('doc', 'actor');
  const frames = [];
  const peers = new Map();
  const appends = [];
  const seed = new Y.Doc();
  seed.getMap('annotations').set('saved', 'exact shared snapshot');
  const initial = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  function deliver(frame) {
    for (const peer of peers.values()) {
      if (peer.senderId === frame.senderId) continue;
      queueMicrotask(() => peer.coordinator.receive(structuredClone(frame)));
    }
  }
  function open(senderId, role) {
    const ydoc = new Y.Doc({ guid: scopeKey });
    Y.applyUpdate(ydoc, initial);
    const db = Object.assign(new EventTarget(), { name: scopeKey });
    const peer = { senderId, ydoc, db, current: true, sequence: 0 };
    const send = (type, fields, control = false) => {
      if (!peer.current && !control) return null;
      const frame = { ...fields, protocol: 'legacy-yjs', version: 1, documentId: 'doc', actorUserId: 'actor',
        senderId, sequence: ++peer.sequence, type };
      frames.push(structuredClone(frame));
      deliver(frame);
      return frame.sequence;
    };
    peer.coordinator = createLegacyYDocCloseCoordinator({
      ydoc, documentId: 'doc', actorUserId: 'actor', senderId,
      send: (type, fields) => send(type, fields),
      sendCancellation: fields => send('close-cancel', fields, true),
      getRole: () => role, getDatabase: () => role === 'leader' ? db : null,
      isCurrent: () => peer.current,
      ...(verifySnapshot ? { verifySnapshot } : {}),
      appendSnapshot: options => {
        // Match the real append boundary: merge exact Yjs bytes before awaiting
        // transaction completion, and expose cancellation of queued storage.
        Y.applyUpdate(options.ydoc, options.snapshot);
        const pending = deferred();
        const append = { ...options, resolve: pending.resolve, aborted: 0 };
        options.signal.addEventListener('abort', () => { append.aborted++; }, { once: true });
        appends.push(append);
        return deferAppend ? pending.promise : Promise.resolve();
      },
    });
    peers.set(senderId, peer);
    peer.coordinator.onReady();
    return peer;
  }
  t.after(() => {
    for (const peer of peers.values()) { peer.current = false; peer.coordinator.dispose(); peer.ydoc.destroy(); }
    for (const append of appends) append.resolve();
  });
  return { open, frames, appends, deliver };
}

test('sealed follower disposal sends cancellation that aborts queued remote append', async t => {
  const h = setup(t, { deferAppend: true });
  h.open('leader', 'leader');
  const follower = h.open('follower', 'follower');
  const result = follower.coordinator.prepareLocalClose();
  const rejected = assert.rejects(result, { code: 'LOCAL_CLOSE_CANCELLED' });
  await until(() => h.appends.length === 1);
  const request = h.frames.find(frame => frame.type === 'close-request');
  follower.current = false;
  follower.coordinator.dispose();
  await rejected;
  await until(() => h.appends[0].signal.aborted);
  assert.equal(h.appends[0].aborted, 1);
  assert.ok(h.frames.some(frame => frame.type === 'close-cancel' && frame.requestId === request.requestId));
  h.deliver({ ...request, sequence: request.sequence + 50 });
  await tick();
  assert.equal(h.appends.length, 1, 'canceled work stays deduplicated before its old append settles');
  h.appends[0].resolve();
  await tick();
  h.deliver({ ...request, sequence: request.sequence + 100 });
  await tick();
  assert.equal(h.appends.length, 1, 'a duplicate canceled request cannot append again');
  assert.equal(h.frames.some(frame => frame.type === 'close-ack'), false, 'late storage completion cannot acknowledge cancellation');
});

test('duplicate request frames during and after completion append only once', async t => {
  const h = setup(t, { deferAppend: true });
  h.open('leader', 'leader');
  const follower = h.open('follower', 'follower');
  const result = follower.coordinator.prepareLocalClose();
  await until(() => h.appends.length === 1);
  const request = h.frames.find(frame => frame.type === 'close-request');
  h.deliver(structuredClone(request));
  h.deliver({ ...request, sequence: request.sequence + 100 });
  await tick();
  assert.equal(h.appends.length, 1);
  h.appends[0].resolve();
  const receipt = await result;
  assert.equal(follower.coordinator.isLocalCloseReceiptCurrent(receipt), true);
  h.deliver(structuredClone(request));
  h.deliver({ ...request, sequence: request.sequence + 200 });
  await tick();
  assert.equal(h.appends.length, 1, 'terminal request IDs stay deduplicated beyond frame sequence');
  assert.equal(h.frames.filter(frame => frame.type === 'close-ack').length, 1);
});

test('wrong-scope, wrong-hash, wrong-recipient and old-request ACKs cannot complete a close', async t => {
  const h = setup(t);
  const follower = h.open('follower', 'follower');
  let settled = false;
  const result = follower.coordinator.prepareLocalClose();
  result.then(() => { settled = true; }, () => { settled = true; });
  await until(() => h.frames.some(frame => frame.type === 'close-request'));
  const request = h.frames.find(frame => frame.type === 'close-request');
  const ack = { ...request, type: 'close-ack', senderId: 'leader', recipientId: 'follower' };
  for (const patch of [
    { documentId: 'other-doc' }, { actorUserId: 'other-actor' }, { recipientId: 'other-peer' },
    { snapshotHash: '0'.repeat(64) }, { requestId: 'expired-request' }, { protocol: 'other' }, { version: 2 },
  ]) h.deliver({ ...ack, ...patch });
  await tick();
  assert.equal(settled, false);
  h.deliver(ack);
  const receipt = await result;
  assert.equal(follower.coordinator.isLocalCloseReceiptCurrent(receipt), true);

  let nextSettled = false;
  const next = follower.coordinator.prepareLocalClose();
  next.then(() => { nextSettled = true; }, () => { nextSettled = true; });
  await until(() => h.frames.filter(frame => frame.type === 'close-request').length === 2);
  h.deliver({ ...ack, sequence: ack.sequence + 100 });
  await tick();
  assert.equal(nextSettled, false, 'an earlier receipt cannot settle a later identical snapshot request');
  const latest = h.frames.filter(frame => frame.type === 'close-request').at(-1);
  follower.ydoc.getMap('annotations').set('edited-after-snapshot', true);
  const stale = assert.rejects(next, { code: 'LOCAL_CLOSE_STALE' });
  h.deliver({ ...ack, requestId: latest.requestId, snapshotHash: latest.snapshotHash, sequence: ack.sequence + 101 });
  await stale;
  assert.equal(follower.coordinator.isLocalCloseReceiptCurrent(receipt), false);
});

for (const event of ['versionchange', 'close']) {
  test(`external database ${event} invalidates both leader and follower receipts`, async t => {
    const h = setup(t);
    const leader = h.open('leader', 'leader');
    const follower = h.open('follower', 'follower');
    const leaderReceipt = await leader.coordinator.prepareLocalClose();
    const followerReceipt = await follower.coordinator.prepareLocalClose();
    assert.equal(leader.coordinator.isLocalCloseReceiptCurrent(leaderReceipt), true);
    assert.equal(follower.coordinator.isLocalCloseReceiptCurrent(followerReceipt), true);
    leader.db.dispatchEvent(new Event(event));
    assert.equal(leader.coordinator.isLocalCloseReceiptCurrent(leaderReceipt), false);
    await tick();
    assert.equal(follower.coordinator.isLocalCloseReceiptCurrent(followerReceipt), false);
    assert.equal(h.frames.filter(frame => frame.type === 'close-storage-changed').length, 1, 'storage invalidation broadcasts once without an echo loop');
  });
}

test('storage invalidation rejects pending close and cancels remote storage before late completion', async t => {
  const h = setup(t, { deferAppend: true });
  const leader = h.open('leader', 'leader');
  const follower = h.open('follower', 'follower');
  const result = follower.coordinator.prepareLocalClose();
  const rejected = assert.rejects(result, { code: 'LOCAL_CLOSE_STORAGE_CHANGED' });
  await until(() => h.appends.length === 1);
  leader.db.dispatchEvent(new Event('versionchange'));
  await rejected;
  assert.equal(h.appends[0].signal.aborted, true);
  h.appends[0].resolve();
  await tick();
  assert.equal(h.frames.some(frame => frame.type === 'close-ack'), false);
});

test('receipt validation freshly verifies an owned copy of the exact captured snapshot each time', async t => {
  const calls = [];
  const h = setup(t, { verifySnapshot: async options => {
    calls.push({ ...options, snapshotBefore: new Uint8Array(options.snapshot) });
    assert.equal(options.isCurrent(), true);
    // A verifier cannot mutate the coordinator's private receipt snapshot.
    options.snapshot.fill(0);
  } });
  const peer = h.open('leader', 'leader');
  const expected = Y.encodeStateAsUpdate(peer.ydoc);
  const receipt = await peer.coordinator.prepareLocalClose();
  const controller = new AbortController();
  assert.equal(await peer.coordinator.validateLocalCloseReceipt(receipt, { timeoutMs: 1234, signal: controller.signal }), true);
  assert.equal(await peer.coordinator.validateLocalCloseReceipt(receipt, { timeoutMs: 2345 }), true);
  assert.equal(calls.length, 2, 'receipt validation never substitutes cached success for fresh storage verification');
  for (const call of calls) {
    assert.equal(call.documentId, 'doc');
    assert.equal(call.actorUserId, 'actor');
    assert.deepEqual(call.snapshotBefore, expected);
  }
  assert.strictEqual(calls[0].signal, controller.signal);
  assert.equal(calls[0].timeoutMs, 1234);
  assert.equal(calls[1].timeoutMs, 2345);
  assert.notStrictEqual(calls[0].snapshot, calls[1].snapshot);
  assert.equal(peer.coordinator.isLocalCloseReceiptCurrent(receipt), true);
});

test('validation rejects forged, another coordinator\'s, and stale receipts before storage reads', async t => {
  let reads = 0;
  const h = setup(t, { verifySnapshot: async () => { reads++; } });
  const leader = h.open('leader', 'leader');
  const follower = h.open('follower', 'follower');
  const receipt = await leader.coordinator.prepareLocalClose();
  const otherReceipt = await follower.coordinator.prepareLocalClose();
  for (const invalid of [null, {}, { ...receipt }, otherReceipt]) {
    await assert.rejects(leader.coordinator.validateLocalCloseReceipt(invalid), { code: 'LOCAL_CLOSE_STALE' });
  }
  leader.ydoc.getMap('annotations').set('post-receipt-edit', true);
  await assert.rejects(leader.coordinator.validateLocalCloseReceipt(receipt), { code: 'LOCAL_CLOSE_STALE' });
  assert.equal(reads, 0);
});

test('fresh verification failures pass through and never become receipt success', async t => {
  const incomplete = Object.assign(new Error('stored updates do not include the snapshot'), { code: 'LEGACY_CLOSE_INCOMPLETE' });
  let reads = 0;
  const h = setup(t, { verifySnapshot: async () => { reads++; throw incomplete; } });
  const peer = h.open('leader', 'leader');
  const receipt = await peer.coordinator.prepareLocalClose();
  assert.equal(peer.coordinator.isLocalCloseReceiptCurrent(receipt), true, 'a live-state match alone is insufficient');
  await assert.rejects(peer.coordinator.validateLocalCloseReceipt(receipt), error => error === incomplete);
  assert.equal(reads, 1);
});

for (const change of ['edit', 'dispose', 'storage-invalidation']) {
  test(`validation rejects ${change} during an awaited verifier that ignores its current guard`, async t => {
    const pending = deferred();
    let options;
    const h = setup(t, { verifySnapshot: args => { options = args; return pending.promise; } });
    const peer = h.open('leader', 'leader');
    const receipt = await peer.coordinator.prepareLocalClose();
    const checking = peer.coordinator.validateLocalCloseReceipt(receipt);
    assert.ok(options);
    assert.equal(options.isCurrent(), true);
    if (change === 'edit') peer.ydoc.getMap('annotations').set('late-edit', true);
    else if (change === 'dispose') peer.coordinator.dispose();
    else peer.db.dispatchEvent(new Event('versionchange'));
    assert.equal(options.isCurrent(), change === 'edit', 'row checks are cheap; full bytes are checked after the awaited read');
    const rejected = assert.rejects(checking, { code: 'LOCAL_CLOSE_STALE' });
    pending.resolve(true);
    await rejected;
  });
}

test('already aborted validation skips storage and late cancellation wins over verifier success', async t => {
  const pending = deferred();
  let reads = 0;
  let options;
  const h = setup(t, { verifySnapshot: args => { reads++; options = args; return pending.promise; } });
  const peer = h.open('leader', 'leader');
  const receipt = await peer.coordinator.prepareLocalClose();
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(peer.coordinator.validateLocalCloseReceipt(receipt, { signal: canceled.signal }), { code: 'LOCAL_CLOSE_CANCELLED' });
  assert.equal(reads, 0);
  const controller = new AbortController();
  const checking = peer.coordinator.validateLocalCloseReceipt(receipt, { signal: controller.signal });
  assert.equal(reads, 1);
  assert.strictEqual(options.signal, controller.signal);
  controller.abort();
  assert.equal(options.signal.aborted, true);
  const rejected = assert.rejects(checking, { code: 'LOCAL_CLOSE_CANCELLED' });
  pending.resolve(true);
  await rejected;
});

test('invalid validation deadlines reject before invoking storage verification', async t => {
  let reads = 0;
  const h = setup(t, { verifySnapshot: async () => { reads++; } });
  const peer = h.open('leader', 'leader');
  const receipt = await peer.coordinator.prepareLocalClose();
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(peer.coordinator.validateLocalCloseReceipt(receipt, { timeoutMs }), TypeError);
  }
  assert.equal(reads, 0);
});

test('locked close prepares by reading existing storage without local or peer writes', async t => {
  let reads = 0;
  const h = setup(t, { verifySnapshot: async () => { reads++; } });
  h.open('leader', 'leader');
  const follower = h.open('follower', 'follower');
  const receipt = await follower.coordinator.prepareLocalClose({ readOnly: true });
  assert.equal(follower.coordinator.isLocalCloseReceiptCurrent(receipt), true);
  assert.equal(await follower.coordinator.validateLocalCloseReceipt(receipt), true);
  assert.equal(reads, 2);
  assert.equal(h.appends.length, 0);
  assert.equal(h.frames.length, 0);
});

test('locked close does not repair missing data with a write and rejects late edits', async t => {
  const missing = Object.assign(new Error('missing'), { code: 'LEGACY_CLOSE_INCOMPLETE' });
  const pending = deferred();
  let reads = 0;
  const h = setup(t, { verifySnapshot: () => { if (++reads === 1) throw missing; return pending.promise; } });
  const leader = h.open('leader', 'leader');
  await assert.rejects(leader.coordinator.prepareLocalClose({ readOnly: true }), error => error === missing);
  const preparing = leader.coordinator.prepareLocalClose({ readOnly: true });
  const rejected = assert.rejects(preparing, { code: 'LOCAL_CLOSE_STALE' });
  leader.ydoc.getMap('annotations').set('later', 1);
  pending.resolve();
  await rejected;
  assert.equal(h.appends.length, 0);
  assert.equal(h.frames.some(frame => frame.type === 'close-request'), false);
});

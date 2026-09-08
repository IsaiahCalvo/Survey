import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDocumentCollaborationStatus } from '../src/lib/collab/documentCollaborationStatus.js';

const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(t, { active = true, hidden = false, rows = [], role = 'owner' } = {}) {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.hidden = hidden;
  const timers = new Map();
  t.mock.method(globalThis, 'setInterval', callback => { const id = Symbol(); timers.set(id, callback); return id; });
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  const abort = new AbortController();
  const state = { rows, role, selects: 0, roles: 0, shared: [], docRoles: [], removed: 0,
    actor: 'actor-a', current: true, events: [], denied: 0, channelStatus: null,
    rowGate: null, roleGate: null, sessionGate: null };
  const client = {
    from(table) {
      assert.equal(table, 'document_collaborators');
      state.selects++;
      const result = state.rowGate?.promise || Promise.resolve({ data: state.rows, error: null });
      const query = {
        select(columns) { assert.equal(columns, 'user_id'); return query; },
        eq() { return query; }, abortSignal() { return query; },
        then(resolve, reject) { return result.then(resolve, reject); },
      };
      return query;
    },
    rpc(name, args) {
      assert.equal(name, 'get_my_document_role'); assert.equal(args.doc_id, 'doc-a');
      state.roles++;
      return state.roleGate?.promise || Promise.resolve({ data: state.role, error: null });
    },
    channel() {
      const channel = { on(_type, filter, callback) {
        assert.equal(filter.table, 'document_collaborators'); state.events.push(callback); return channel;
      }, subscribe(callback) { state.channelStatus = callback; return channel; } };
      return channel;
    },
    removeChannel() { state.removed++; return Promise.resolve(); },
  };
  const handle = attachDocumentCollaborationStatus({
    client, documentId: 'doc-a', actorUserId: 'actor-a', isActive: active,
    isCurrent: () => state.current, signal: abort.signal,
    getSession: () => state.sessionGate?.promise || Promise.resolve({ user: { id: state.actor } }),
    onSharedState: value => state.shared.push(value), onRole: value => state.docRoles.push(value),
    onAccessDenied: () => { state.denied++; },
    windowTarget, documentTarget,
  });
  t.after(() => handle.dispose());
  return { ...state, state, handle, timers, abort, windowTarget, documentTarget,
    tick: () => { for (const callback of timers.values()) callback(); },
    event: () => state.events[0](),
  };
}

test('one initial role serves private-document startup; hidden tabs do not poll', async t => {
  const h = setup(t, { active: false });
  await settle();
  assert.equal(h.state.selects, 1);
  assert.equal(h.state.roles, 1);
  assert.deepEqual(h.state.shared, [false]);
  assert.deepEqual(h.state.docRoles, ['owner']);
  h.tick(); await settle();
  assert.equal(h.state.selects, 1);
  assert.equal(h.timers.size, 0);
  h.handle.setActive(true); await settle();
  assert.equal(h.state.selects, 2);
  assert.equal(h.state.roles, 2, 'activation refreshes authority even without a collaborator row');
  h.tick(); await settle();
  assert.equal(h.state.roles, 2, 'ordinary private-document polls still skip needless role RPCs');
  assert.equal(h.timers.size, 1);
});

test('document visibility, focus and activation refresh status without hidden polling', async t => {
  const h = setup(t, { hidden: true }); await settle();
  assert.equal(h.timers.size, 0);
  h.windowTarget.dispatchEvent(new Event('focus')); h.tick(); await settle();
  assert.equal(h.state.selects, 1);
  h.documentTarget.hidden = false;
  h.documentTarget.dispatchEvent(new Event('visibilitychange')); await settle();
  assert.equal(h.state.selects, 2); assert.equal(h.timers.size, 1);
  h.windowTarget.dispatchEvent(new Event('focus')); await settle();
  assert.equal(h.state.selects, 3);
  h.handle.setActive(false);
  h.windowTarget.dispatchEvent(new Event('online')); h.event(); await settle();
  assert.equal(h.state.selects, 3); assert.equal(h.timers.size, 0);
  h.handle.setActive(true); await settle();
  assert.equal(h.state.selects, 4);
  h.documentTarget.hidden = true;
  h.documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.timers.size, 0);
});

test('an event storm coalesces with one trailing read and discards the invalidated result', async t => {
  const h = setup(t); await settle();
  const gate = deferred(); h.state.rowGate = gate;
  h.event(); await settle();
  const published = h.state.shared.length;
  for (let i = 0; i < 30; i++) { h.event(); h.tick(); }
  await settle(); assert.equal(h.state.selects, 2);
  h.state.rowGate = null; h.state.rows = [{ user_id: 'actor-b' }];
  gate.resolve({ data: [], error: null }); await settle();
  assert.equal(h.state.selects, 3);
  assert.deepEqual(h.state.shared.slice(published), [true]);
  assert.equal(h.state.roles, 3, 'one event role read plus one trailing read, not thirty role RPCs');
});

for (const [role, expected] of [['owner', false], ['editor', true], ['viewer', true]]) {
  test(`own-only ${role} shares one initial role request and refreshes it without a settled cache`, async t => {
    const h = setup(t, { role, rows: [{ user_id: 'actor-a' }] });
    await settle();
    assert.deepEqual(h.state.shared, [expected]);
    assert.deepEqual(h.state.docRoles, [role]);
    assert.equal(h.state.roles, 1);
    h.tick(); await settle();
    assert.equal(h.state.roles, 2);
    assert.deepEqual(h.state.shared, [expected, expected]);
  });
}

test('retirement during a collaborator query blocks follow-up role work and all late results', async t => {
  const h = setup(t); await settle();
  const gate = deferred(); h.state.rowGate = gate;
  h.event(); await settle();
  const before = [...h.state.shared];
  h.state.current = false; h.abort.abort();
  gate.resolve({ data: [{ user_id: 'actor-a' }], error: null }); await settle();
  assert.equal(h.state.roles, 2, 'the event started one role read before retirement, never a follow-up');
  assert.deepEqual(h.state.shared, before);
  h.state.current = true; h.handle.setActive(true); h.event(); h.tick();
  h.windowTarget.dispatchEvent(new Event('focus')); await settle();
  assert.equal(h.state.selects, 2);
  assert.equal(h.timers.size, 0); assert.equal(h.state.removed, 1);
  h.handle.dispose(); assert.equal(h.state.removed, 1);
});

test('late session identity cannot start either query after retirement', async t => {
  const h = setup(t); const gate = deferred(); h.state.sessionGate = gate;
  await settle(); h.state.current = false; h.abort.abort();
  gate.resolve({ user: { id: 'actor-a' } }); await settle();
  assert.equal(h.state.selects, 0); assert.equal(h.state.roles, 0);
  assert.deepEqual(h.state.shared, []); assert.deepEqual(h.state.docRoles, []);
});

test('wrong session actor returns unknown without querying under another account', async t => {
  const h = setup(t); h.state.actor = 'actor-b'; await settle();
  assert.equal(h.state.selects, 0); assert.equal(h.state.roles, 0);
  assert.deepEqual(h.state.shared, [null]); assert.deepEqual(h.state.docRoles, [null]);
});

test('role and row failures stay unknown, settle pending work and retry on the next visible trigger', async t => {
  const h = setup(t, { rows: [{ user_id: 'actor-a' }] });
  const roleGate = deferred(); h.state.roleGate = roleGate;
  roleGate.resolve({ data: null, error: { message: 'offline' } }); await settle();
  assert.deepEqual(h.state.shared, [null]); assert.deepEqual(h.state.docRoles, [null]);
  h.state.roleGate = null; h.tick(); await settle();
  assert.equal(h.state.shared.at(-1), false); assert.equal(h.state.roles, 2);
  const rows = deferred(); h.state.rowGate = rows; h.event();
  rows.resolve({ data: null, error: { message: 'offline' } }); await settle();
  assert.equal(h.state.shared.at(-1), null);
  h.state.rowGate = null; h.event(); await settle();
  assert.equal(h.state.shared.at(-1), false);
});

test('a role request started before a sharing event cannot satisfy the new sharing decision', async t => {
  const h = setup(t);
  const gate = deferred(); h.state.roleGate = gate;
  await settle();
  h.state.roleGate = null; h.state.role = 'viewer'; h.state.rows = [{ user_id: 'actor-a' }];
  h.event(); await settle();
  gate.resolve({ data: 'owner', error: null }); await settle();
  assert.equal(h.state.shared.at(-1), true);
  assert.equal(h.state.roles, 2, 'the new decision gets a post-event role without parallel duplicate requests');
  assert.deepEqual(h.state.docRoles, ['viewer'], 'the invalidated initial owner result never reaches the gate');
});

test('a poll waiting for session state does not start a new status query after becoming inactive', async t => {
  const h = setup(t); await settle();
  const gate = deferred(); h.state.sessionGate = gate;
  h.tick(); await settle();
  h.handle.setActive(false);
  gate.resolve({ user: { id: 'actor-a' } }); await settle();
  assert.equal(h.state.selects, 1);
  h.state.sessionGate = null; h.handle.setActive(true); await settle();
  assert.equal(h.state.selects, 2);
});

test('access events refresh editor downgrade and upgrade even while remote collaborators remain', async t => {
  const h = setup(t, { role: 'editor', rows: [{ user_id: 'actor-b' }] });
  await settle();
  h.state.role = 'viewer'; h.event(); await settle();
  assert.deepEqual(h.state.docRoles, ['editor', 'viewer']);
  h.state.role = 'editor'; h.event(); await settle();
  assert.deepEqual(h.state.docRoles, ['editor', 'viewer', 'editor']);
  assert.equal(h.state.roles, 3);
  assert.deepEqual(h.state.shared, [true, true, true]);
});

test('confirmed denial uses revoked access, not a made-up viewer role', async t => {
  const h = setup(t, { role: 'editor', rows: [{ user_id: 'actor-b' }] });
  await settle();
  h.state.role = null; h.event(); await settle();
  assert.equal(h.state.denied, 1);
  assert.deepEqual(h.state.docRoles, ['editor', null]);
  h.state.role = 'editor'; h.event(); await settle();
  assert.equal(h.state.denied, 1, 'later success does not emit any clear-revocation operation');
  assert.equal(h.state.docRoles.at(-1), 'editor');
});

test('transient errors and malformed roles cannot clear a confirmed viewer gate', async t => {
  const h = setup(t, { role: 'viewer', rows: [{ user_id: 'actor-b' }] });
  await settle();
  for (const result of [{ error: { message: 'offline' } }, { data: 'unknown-role', error: null }]) {
    h.state.roleGate = deferred(); h.state.roleGate.resolve(result);
    h.event(); await settle();
    assert.deepEqual(h.state.docRoles, ['viewer']);
    assert.equal(h.state.denied, 0);
  }
  h.state.roleGate = null; h.state.role = 'editor'; h.tick(); await settle();
  assert.equal(h.state.docRoles.at(-1), 'editor', 'next visible poll retries the unknown authority');
});

test('a delayed denial invalidated by a newer access event is never published', async t => {
  const h = setup(t, { role: 'editor', rows: [{ user_id: 'actor-b' }] });
  await settle();
  const gate = deferred(); h.state.roleGate = gate;
  h.event(); await settle();
  for (let i = 0; i < 20; i++) h.event();
  assert.equal(h.state.roles, 2, 'role reads are single-flight through an event storm');
  h.state.roleGate = null; h.state.role = 'viewer';
  gate.resolve({ data: null, error: null }); await settle();
  assert.equal(h.state.roles, 3, 'one post-event trailing role read');
  assert.equal(h.state.denied, 0);
  assert.deepEqual(h.state.docRoles, ['editor', 'viewer']);
});

test('dispose discards a delayed denial and role result and stops wake work', async t => {
  const h = setup(t, { rows: [{ user_id: 'actor-b' }] });
  const gate = deferred(); h.state.roleGate = gate;
  await settle(); h.handle.dispose();
  gate.resolve({ data: null, error: null }); await settle();
  h.windowTarget.dispatchEvent(new Event('focus'));
  h.windowTarget.dispatchEvent(new Event('online'));
  h.state.channelStatus('SUBSCRIBED'); await settle();
  assert.deepEqual(h.state.docRoles, []);
  assert.equal(h.state.denied, 0);
  assert.equal(h.state.roles, 1);
  assert.equal(h.state.removed, 1);
});

test('wake, network reconnect and channel rejoin refresh authority without hidden polling', async t => {
  const h = setup(t, { role: 'editor', rows: [{ user_id: 'actor-b' }] });
  await settle();
  h.state.channelStatus('SUBSCRIBED'); await settle();
  assert.equal(h.state.roles, 1, 'the first channel join borrows startup authority');
  h.state.role = 'viewer'; h.windowTarget.dispatchEvent(new Event('focus')); await settle();
  assert.equal(h.state.docRoles.at(-1), 'viewer');
  h.state.role = 'editor'; h.windowTarget.dispatchEvent(new Event('online')); await settle();
  assert.equal(h.state.docRoles.at(-1), 'editor');
  h.handle.setActive(false); h.state.role = 'viewer';
  h.state.channelStatus('CHANNEL_ERROR'); h.state.channelStatus('SUBSCRIBED'); await settle();
  assert.equal(h.state.roles, 3, 'hidden rejoin only marks authority dirty');
  assert.equal(h.timers.size, 0);
  h.handle.setActive(true); await settle();
  assert.equal(h.state.roles, 4); assert.equal(h.state.docRoles.at(-1), 'viewer');
  h.state.role = 'editor'; h.state.channelStatus('SUBSCRIBED'); await settle();
  assert.equal(h.state.roles, 5); assert.equal(h.state.docRoles.at(-1), 'editor');
});

test('visible fallback detects a revoked collaborator after its row disappears without an event', async t => {
  const h = setup(t, { role: 'editor', rows: [{ user_id: 'actor-a' }] });
  await settle();
  h.state.rows = []; h.state.role = null;
  h.tick(); await settle();
  assert.equal(h.state.roles, 2, 'one fallback authority read despite the missing own row');
  assert.equal(h.state.selects, 2);
  assert.equal(h.state.denied, 1);
  assert.deepEqual(h.state.docRoles, ['editor', null]);
});

test('visible non-owner fallback catches missed downgrades with remote rows; hidden polling stays off', async t => {
  const h = setup(t, { role: 'editor', rows: [{ user_id: 'actor-b' }] });
  await settle();
  h.state.role = 'viewer'; h.tick(); await settle();
  assert.deepEqual(h.state.docRoles, ['editor', 'viewer']);
  assert.equal(h.state.roles, 2);
  h.state.roleGate = deferred(); h.state.roleGate.resolve({ error: { message: 'offline' } });
  h.tick(); await settle();
  assert.equal(h.state.roles, 3);
  assert.equal(h.state.docRoles.at(-1), 'viewer');
  assert.equal(h.state.denied, 0);
  h.handle.setActive(false);
  for (let i = 0; i < 10; i++) h.tick();
  await settle(); assert.equal(h.state.roles, 3);
});

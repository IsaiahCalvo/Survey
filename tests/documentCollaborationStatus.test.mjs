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
    actor: 'actor-a', current: true, events: [], rowGate: null, roleGate: null, sessionGate: null };
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
      }, subscribe() { return channel; } };
      return channel;
    },
    removeChannel() { state.removed++; return Promise.resolve(); },
  };
  const handle = attachDocumentCollaborationStatus({
    client, documentId: 'doc-a', actorUserId: 'actor-a', isActive: active,
    isCurrent: () => state.current, signal: abort.signal,
    getSession: () => state.sessionGate?.promise || Promise.resolve({ user: { id: state.actor } }),
    onSharedState: value => state.shared.push(value), onRole: value => state.docRoles.push(value),
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
  assert.equal(h.state.roles, 1, 'no own row means shared status does not need a role RPC');
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
  assert.equal(h.state.roles, 1, 'no extra role needed for a remote collaborator');
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
  assert.equal(h.state.roles, 1);
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

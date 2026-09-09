import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClient } from '@supabase/realtime-js';
import { createGenerationPresence, GENERATION_PRESENCE_LIMITS as LIMITS } from '../src/lib/collab/generationPresence.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const PEER = '33333333-3333-4333-8333-333333333333';
const GEN = '44444444-4444-4444-8444-444444444444';
const GEN2 = '55555555-5555-4555-8555-555555555555';
const REMOTE = '66666666-6666-4666-8666-666666666666';
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t, options = {}) {
  const timers = new Map();
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  const state = { time: 100_000, current: true, allowed: true, authCalls: 0, channels: [], removed: [], statuses: [], changes: [],
    authorizeGate: null, removeGate: null, trackGate: null, trackResult: 'ok', untrackResult: 'ok', removeResult: 'ok', ...options };
  const client = {
    getChannels: () => state.channels.filter(channel => !channel.removed),
    channel(topic, params) {
      const channel = { topic: `realtime:${topic}`, subTopic: topic, params,
        private: state.privateFlag ?? params.config.private, handlers: [], roster: {}, tracks: [], untracks: 0, removed: false,
        on(type, filter, callback) { assert.equal(type, 'presence'); channel.handlers.push({ event: filter.event, callback }); return channel; },
        subscribe(callback, timeout) { assert.equal(timeout, LIMITS.timeoutMs); channel.status = callback; return channel; },
        presenceState() { return channel.roster; },
        track(payload, opts) { assert.equal(opts.timeout, LIMITS.timeoutMs); channel.tracks.push(structuredClone(payload)); return state.trackGate?.promise ?? Promise.resolve(state.trackResult); },
        untrack(opts) { assert.equal(opts.timeout, LIMITS.timeoutMs); channel.untracks++; return Promise.resolve(state.untrackResult); },
        event(event = 'sync') { for (const handler of channel.handlers) if (handler.event === event) handler.callback(); },
      };
      state.channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      state.removed.push(channel);
      const result = await (state.removeGate?.promise ?? Promise.resolve(state.removeResult));
      if (result === 'ok') channel.removed = true;
      return result;
    },
  };
  const args = { client, documentId: DOC, actorUserId: ACTOR, pdfGenerationId: GEN,
    isCurrent: () => state.current, authorize: () => { state.authCalls++; return state.authorizeGate?.promise ?? Promise.resolve(state.allowed); },
    onStatus: value => state.statuses.push(value), onChange: value => state.changes.push(value), now: () => state.time };
  const handle = createGenerationPresence({ ...args, isActive: state.active ?? true });
  t.after(async () => { handle.dispose(); await settle(); });
  const peer = (overrides = {}) => ({ version: 1, documentId: DOC, pdfGenerationId: GEN, clientID: REMOTE,
    updatedAt: state.time, user: { id: PEER, name: 'Peer', colorSlot: 2 }, editingAnnotationId: 'annotation-1', ...overrides });
  return { handle, state, client, args, timers, peer,
    tick() { for (const timer of [...timers.values()]) timer.callback(); },
    async join() { await settle(); const channel = state.channels.at(-1); channel.status('SUBSCRIBED'); await settle(); return channel; } };
}

test('private presence is scoped and uses the installed SDK configuration contract', async t => {
  const h = setup(t);
  const channel = await h.join();
  assert.equal(channel.subTopic, `generation-presence:${DOC}:${GEN}`);
  assert.equal(channel.params.config.private, true);
  assert.equal(channel.params.config.presence.enabled, true);
  assert.equal(channel.params.config.presence.key, `${ACTOR}:${h.handle.getAwareness().clientID}`);
  assert.equal(h.state.authCalls, 1);
  assert.equal(channel.tracks.length, 1);
  assert.equal(h.state.statuses.at(-1), 'online');
  // Construct the actual installed SDK channel without subscribing or opening
  // a socket. Its real parser must retain private/key/enabled configuration.
  const sdk = new RealtimeClient('https://presence.invalid/realtime/v1', { params: { apikey: 'local-test-only' } });
  const actual = sdk.channel(channel.subTopic, channel.params);
  assert.equal(actual.private, true);
  assert.equal(actual.params.config.presence.key, channel.params.config.presence.key);
  assert.equal(sdk.channel(channel.subTopic), actual, 'SDK really reuses a topic');
});

test('different generations use different channels and reject cross-scope presence', async t => {
  const h = setup(t);
  const first = await h.join();
  const secondHandle = createGenerationPresence({ ...h.args, pdfGenerationId: GEN2 });
  t.after(() => secondHandle.dispose());
  await settle();
  const second = h.state.channels[1]; second.status('SUBSCRIBED'); await settle();
  first.roster = { [`${PEER}:${REMOTE}`]: [h.peer()] }; first.event();
  second.roster = first.roster; second.event();
  assert.equal(h.handle.getAwareness().getStates().get(REMOTE).editingAnnotationId, 'annotation-1');
  assert.equal(secondHandle.getAwareness().getStates().has(REMOTE), false);
  first.roster = { [`${PEER}:${REMOTE}`]: [h.peer({ documentId: GEN2 })] }; first.event();
  assert.equal(h.handle.getAwareness().getStates().has(REMOTE), false);
});

test('a duplicate live client/topic throws without touching its owner', async t => {
  const h = setup(t); const channel = await h.join();
  assert.throws(() => createGenerationPresence(h.args), { code: 'GENERATION_PRESENCE_SCOPE_IN_USE' });
  assert.equal(channel.untracks, 0); assert.equal(h.state.removed.length, 0);
  assert.equal(h.state.channels.length, 1);
  assert.equal(h.handle.getAwareness().getStates().size, 1);
});

test('a remount waits for old removal and ignores late old join/auth callbacks', async t => {
  const h = setup(t); const channel = await h.join();
  h.state.removeGate = deferred();
  h.handle.dispose(); await settle();
  const replacement = createGenerationPresence(h.args); t.after(() => replacement.dispose());
  await settle(); assert.equal(h.state.channels.length, 1);
  channel.status('SUBSCRIBED'); await settle(); assert.equal(channel.tracks.length, 1);
  h.state.removeGate.resolve('ok'); await settle();
  assert.equal(h.state.channels.length, 2);
  assert.notEqual(h.state.channels[1], channel);
  h.state.channels[1].status('SUBSCRIBED'); await settle();
  assert.equal(h.state.channels[1].tracks.length, 1);
});

test('failed old removal prevents reuse and unknown SDK topic is never adopted or removed', async t => {
  const h = setup(t, { removeResult: 'error' }); await h.join();
  h.handle.dispose(); await settle();
  const replacement = createGenerationPresence(h.args); t.after(() => replacement.dispose());
  await settle(); assert.equal(h.state.channels.length, 1);
  assert.equal(h.state.statuses.at(-1), 'offline');
  const unknown = { topic: `realtime:generation-presence:${DOC}:${GEN2}` };
  const ownGet = h.client.getChannels;
  h.client.getChannels = () => [...ownGet(), unknown];
  const another = createGenerationPresence({ ...h.args, pdfGenerationId: GEN2 }); t.after(() => another.dispose());
  await settle(); assert.equal(h.state.channels.length, 1);
  assert.equal(h.state.removed.includes(unknown), false);
});

test('identity cannot be overwritten; local fields and returned snapshots are bounded copies', async t => {
  const h = setup(t); const channel = await h.join(); const a = h.handle.getAwareness();
  assert.equal(a.setLocalStateField('user', { id: PEER, name: 'Other' }), false);
  assert.equal(a.setLocalStateField('documentId', GEN2), false);
  assert.equal(a.setLocalStateField('clientID', REMOTE), false);
  a.setLocalStateField('user', { id: ACTOR, name: '\u0000\u202e' + 'A'.repeat(200), colorSlot: 900, extra: { dangerous: true } });
  a.setLocalStateField('editingAnnotationId', 'x'.repeat(1000)); await settle();
  const payload = channel.tracks.at(-1);
  assert.equal(payload.user.id, ACTOR); assert.equal(payload.user.name.length, LIMITS.name);
  assert.equal(payload.user.colorSlot, 1); assert.equal(payload.editingAnnotationId.length, LIMITS.annotationId);
  assert.equal(payload.user.extra, undefined);
  const first = a.getStates(); first.get(a.clientID).user.id = PEER; first.clear();
  assert.equal(a.getStates().get(a.clientID).user.id, ACTOR);
  assert.equal(a.clientID, channel.tracks[0].clientID);
});

test('remote metadata is sanitized; wrong keys, stale/future frames and self spoof are dropped', async t => {
  const h = setup(t); const channel = await h.join(); const a = h.handle.getAwareness();
  const incoming = h.peer({ user: { id: PEER, name: '\u0000' + 'B'.repeat(100), colorSlot: -2, role: 'owner' }, role: 'owner' });
  channel.roster = { [`${PEER}:${REMOTE}`]: [incoming] }; channel.event();
  const remote = a.getStates().get(REMOTE);
  assert.equal(remote.user.name.length, LIMITS.name); assert.equal(remote.user.colorSlot, 1);
  assert.equal(remote.user.role, undefined); assert.equal(remote.role, undefined);
  for (const payload of [h.peer({ updatedAt: h.state.time - LIMITS.ttlMs }), h.peer({ updatedAt: h.state.time + LIMITS.heartbeatMs + 1 }),
    h.peer({ clientID: a.clientID }), h.peer({ version: 2 }), h.peer({ user: { id: ACTOR } })]) {
    channel.roster = { [`${PEER}:${REMOTE}`]: [payload] }; channel.event();
    assert.equal(a.getStates().size, 1);
  }
});

test('an older duplicate presence meta cannot replace the newest editor state', async t => {
  const h = setup(t); const channel = await h.join();
  channel.roster = { [`${PEER}:${REMOTE}`]: [h.peer({ editingAnnotationId: 'new' }),
    h.peer({ editingAnnotationId: 'old', updatedAt: h.state.time - 1 })] };
  channel.event();
  assert.equal(h.handle.getAwareness().getStates().get(REMOTE).editingAnnotationId, 'new');
});

test('scope retirement hides an already-published roster before any timer fires', async t => {
  const h = setup(t); await h.join();
  const awareness = h.handle.getAwareness();
  assert.equal(awareness.getStates().size, 1);
  h.state.current = false;
  assert.equal(awareness.getStates().size, 0);
  assert.equal(awareness.setLocalStateField('editingAnnotationId', 'late'), false);
});

test('peer leave and TTL remove outlines; heartbeat renews only the active local peer', async t => {
  const h = setup(t); const channel = await h.join(); const a = h.handle.getAwareness();
  let changes = 0; const listener = () => { changes++; };
  a.on('change', listener);
  channel.roster = { [`${PEER}:${REMOTE}`]: [h.peer()] }; channel.event('join');
  assert.equal(a.getStates().size, 2);
  channel.roster = {}; channel.event('leave'); assert.equal(a.getStates().size, 1);
  channel.roster = { [`${PEER}:${REMOTE}`]: [h.peer()] }; channel.event();
  h.state.time += LIMITS.ttlMs; h.tick(); await settle();
  assert.equal(a.getStates().size, 1); assert.equal(channel.tracks.length, 2);
  assert.ok(changes >= 3); a.off('change', listener);
  const prior = changes; channel.roster = {}; channel.event(); assert.equal(changes, prior);
});

test('presence collection has bounded capacity', async t => {
  const h = setup(t); const channel = await h.join();
  for (let index = 0; index < 900; index++) {
    const id = `${String(index).padStart(8, '0')}-6666-4666-8666-666666666666`;
    channel.roster[`${PEER}:${id}`] = [h.peer({ clientID: id })];
  }
  channel.event(); assert.equal(h.handle.getAwareness().getStates().size, LIMITS.peers);
  channel.roster = {};
  for (let index = 0; index < LIMITS.scannedKeys; index++) channel.roster[`invalid-${index}`] = [];
  channel.roster[`${PEER}:${REMOTE}`] = [h.peer()]; channel.event();
  assert.equal(h.handle.getAwareness().getStates().size, 1, 'scanning stops even when every earlier key is invalid');
});

test('hidden instances do no I/O; hide during authorization cannot publish or track', async t => {
  const h = setup(t, { active: false }); await settle();
  assert.equal(h.state.channels.length, 0); assert.equal(h.timers.size, 0);
  h.state.authorizeGate = deferred(); h.handle.setActive(true); await settle();
  const channel = h.state.channels[0]; channel.status('SUBSCRIBED'); await settle();
  h.handle.setActive(false); h.state.authorizeGate.resolve(true); await settle();
  assert.equal(channel.tracks.length, 0); assert.equal(channel.untracks, 1);
  assert.equal(h.state.removed.length, 1); assert.equal(h.handle.getAwareness().getStates().size, 0);
  assert.equal(h.timers.size, 0);
  h.state.authorizeGate = null; h.handle.setActive(true); const next = await h.join();
  assert.notEqual(next, channel); assert.equal(next.tracks.length, 1); assert.equal(h.state.authCalls, 2);
});

test('each reconnect reauthorizes and a late prior check cannot unlock it', async t => {
  const h = setup(t); const channel = await h.join();
  const prior = deferred(); h.state.authorizeGate = prior;
  channel.status('CHANNEL_ERROR'); channel.status('SUBSCRIBED'); await settle();
  const current = deferred(); h.state.authorizeGate = current;
  channel.status('TIMED_OUT'); channel.status('SUBSCRIBED'); await settle();
  prior.resolve(true); await settle(); assert.equal(channel.tracks.length, 1);
  assert.equal(h.handle.getAwareness().getStates().size, 0);
  current.resolve(true); await settle(); assert.equal(channel.tracks.length, 2);
  assert.equal(h.state.authCalls, 3);
});

test('denied or failed authority, private downgrade, and track errors never fall back to public presence', async t => {
  const h = setup(t, { allowed: false }); const channel = await h.join();
  assert.equal(channel.tracks.length, 0); assert.equal(h.state.statuses.at(-1), 'unauthorized');
  assert.equal(h.state.channels.length, 1); assert.equal(channel.params.config.private, true);
  h.handle.dispose(); await settle();
  h.state.allowed = true; h.state.privateFlag = false;
  const downgraded = createGenerationPresence(h.args); t.after(() => downgraded.dispose()); await settle();
  assert.equal(h.state.channels[1].tracks.length, 0); assert.equal(h.state.statuses.at(-1), 'offline');
  downgraded.dispose(); await settle(); h.state.privateFlag = true; h.state.trackResult = 'error';
  const failed = createGenerationPresence(h.args); t.after(() => failed.dispose()); await settle();
  h.state.channels[2].status('SUBSCRIBED'); await settle();
  assert.equal(h.state.statuses.at(-1), 'offline'); assert.equal(failed.getAwareness().getStates().size, 0);
});

test('disposal or actor retirement blocks deferred auth and track completions', async t => {
  const h = setup(t); h.state.authorizeGate = deferred();
  await settle(); const channel = h.state.channels[0]; channel.status('SUBSCRIBED'); await settle();
  h.handle.dispose(); h.state.authorizeGate.resolve(true); await settle();
  assert.equal(channel.tracks.length, 0); assert.equal(h.state.statuses.at(-1), 'disposed');
  h.state.authorizeGate = null; h.state.trackGate = deferred();
  const next = createGenerationPresence(h.args); t.after(() => next.dispose()); await settle();
  const second = h.state.channels[1]; second.status('SUBSCRIBED'); await settle();
  assert.equal(second.tracks.length, 1);
  h.state.current = false; h.state.trackGate.resolve('ok'); h.tick(); await settle();
  assert.equal(next.getAwareness().getStates().size, 0);
  assert.equal(h.state.statuses.at(-1), 'unauthorized');
});

test('burst editing updates coalesce behind one pending track', async t => {
  const h = setup(t); const channel = await h.join(); const a = h.handle.getAwareness();
  h.state.trackGate = deferred();
  a.setLocalStateField('editingAnnotationId', 'one'); await settle();
  a.setLocalStateField('editingAnnotationId', 'two'); a.setLocalStateField('editingAnnotationId', 'three');
  assert.equal(channel.tracks.length, 2);
  h.state.trackGate.resolve('ok'); h.state.trackGate = null; await settle();
  assert.equal(channel.tracks.length, 3); assert.equal(channel.tracks.at(-1).editingAnnotationId, 'three');
});

test('authority rejection is observed and never tracks', async t => {
  const h = setup(t); h.state.authorizeGate = deferred();
  await settle(); const channel = h.state.channels[0]; channel.status('SUBSCRIBED'); await settle();
  h.state.authorizeGate.reject(new Error('Denied')); await settle();
  assert.equal(h.state.statuses.at(-1), 'unauthorized');
  assert.equal(channel.tracks.length, 0);
  assert.equal(h.state.removed.length, 1);
});

test('hide during a pending track prevents late online state and waits for removal before reopening', async t => {
  const h = setup(t); const channel = await h.join();
  h.state.trackGate = deferred(); h.state.removeGate = deferred();
  h.handle.getAwareness().setLocalStateField('editingAnnotationId', 'old'); await settle();
  h.handle.setActive(false); h.handle.setActive(true); await settle();
  assert.equal(h.state.channels.length, 1);
  h.state.trackGate.resolve('ok'); h.state.trackGate = null; await settle();
  assert.equal(h.handle.getAwareness().getStates().size, 0);
  assert.equal(h.state.statuses.at(-1), 'connecting');
  h.state.removeGate.resolve('ok'); await settle();
  assert.equal(h.state.channels.length, 2);
  h.state.channels[1].status('SUBSCRIBED'); await settle();
  assert.equal(h.state.statuses.at(-1), 'online');
});

test('a hung authority check times out; its later success cannot track', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(t); h.state.authorizeGate = deferred();
  await settle(); const channel = h.state.channels[0]; channel.status('SUBSCRIBED'); await settle();
  t.mock.timers.tick(LIMITS.timeoutMs + 1); await settle();
  assert.equal(h.state.statuses.at(-1), 'unauthorized');
  h.state.authorizeGate.resolve(true); await settle();
  assert.equal(channel.tracks.length, 0); assert.equal(h.state.removed.length, 1);
});

test('a hung track times out and removes its private channel without claiming online', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(t); h.state.trackGate = deferred();
  await settle(); const channel = h.state.channels[0]; channel.status('SUBSCRIBED'); await settle();
  t.mock.timers.tick(LIMITS.timeoutMs + 1); await settle();
  assert.equal(h.state.statuses.at(-1), 'offline');
  h.state.trackGate.resolve('ok'); await settle();
  assert.equal(h.state.statuses.includes('online'), false);
  assert.equal(h.state.removed.length, 1);
});

test('untrack failure still removes only the owned channel', async t => {
  const h = setup(t, { untrackResult: 'error' }); const channel = await h.join();
  h.handle.setActive(false); await settle();
  assert.equal(channel.untracks, 1);
  assert.deepEqual(h.state.removed, [channel]);
  assert.equal(channel.removed, true);
});

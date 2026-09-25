// w32 (2026-09-25): a screen alone in a document sends no live messages.
//
// Company is known from either Realtime Presence (needs the presence policy
// migration) or a tiny hello on the channel itself (works without any
// policy: a joining screen says hello, each screen that hears a NEW hello
// answers once, a leaving screen says bye). Pins: alone → hasCompany()
// false; a second screen (by presence OR by hello) → true; presence refused
// → the hellos still work, and the join is never refused because of
// presence; gating off (tests, older callers) → always true, as before w32.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireLiveBus } from '../src/services/annotationLiveBus.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// One topic shared by several fake clients (each its own supabase object).
function fakeRealtime() {
  const joined = new Set();
  const makeClient = ({ trackAnswer = 'ok' } = {}) => {
    const client = { channels: [], sent: [] };
    client.supabase = {
      channel(topic, options) {
        const handlers = new Map();
        let state = {};
        const channel = {
          topic,
          options,
          tracked: 0,
          on(type, filter, callback) { handlers.set(`${type}:${filter?.event}`, callback); return channel; },
          subscribe(callback) {
            queueMicrotask(() => { joined.add(channel); callback('SUBSCRIBED'); });
            return channel;
          },
          async track() {
            channel.tracked += 1;
            if (trackAnswer === 'never') return new Promise(() => {});
            if (trackAnswer === 'ok') {
              state = { ...state, [options.config.presence.key]: [{}] };
              queueMicrotask(() => handlers.get('presence:sync')?.());
            }
            return trackAnswer;
          },
          presenceState() { return state; },
          setPeers(keys) {
            state = Object.fromEntries([options.config.presence.key, ...keys].map((key) => [key, [{}]]));
            handlers.get('presence:sync')?.();
          },
          deliver(payload) { handlers.get('broadcast:u')?.({ payload }); },
          send(message) {
            client.sent.push(message.payload);
            for (const other of joined) {
              if (other !== channel && other.topic === topic) queueMicrotask(() => other.deliver(message.payload));
            }
            return Promise.resolve('ok');
          },
        };
        client.channels.push(channel);
        return channel;
      },
      async removeChannel(channel) { joined.delete(channel); },
    };
    return client;
  };
  return { makeClient };
}

test('alone in the document: no company, so nothing live is sent; a second screen (presence) restores it', async () => {
  const realtime = fakeRealtime();
  const one = realtime.makeClient();
  const bus = await acquireLiveBus(one.supabase, 'doc-alone', () => {}, { presence: true });
  await tick();
  assert.equal(one.channels[0].options.config.presence.enabled, true);
  assert.equal(one.channels[0].tracked, 1, 'one presence entry per screen');
  assert.equal(bus.hasCompany(), false, 'alone');
  one.channels[0].setPeers(['other-screen']);
  assert.equal(bus.hasCompany(), true, 'someone else opened it');
  one.channels[0].setPeers([]);
  assert.equal(bus.hasCompany(), false, 'they left');
  bus.release();
});

test('without the presence policy the hellos find each other; bye ends it; hellos never reach the listeners', async () => {
  const realtime = fakeRealtime();
  const first = realtime.makeClient({ trackAnswer: 'error' });
  const second = realtime.makeClient({ trackAnswer: 'error' });
  const heard = [];
  const a = await acquireLiveBus(first.supabase, 'doc-hello', (payload) => heard.push(payload), { presence: true });
  await tick();
  assert.equal(a.isJoined(), true, 'the join itself is not refused');
  assert.equal(a.hasCompany(), false, 'alone');
  const b = await acquireLiveBus(second.supabase, 'doc-hello', () => {}, { presence: true });
  await tick();
  await tick();
  assert.equal(a.hasCompany(), true, 'the first screen heard the newcomer');
  assert.equal(b.hasCompany(), true, 'the newcomer heard the answer');
  const settled = first.sent.length + second.sent.length;
  assert.ok(settled <= 5, `a handful of hellos (${settled}), no ping-pong`);
  await tick();
  await tick();
  assert.equal(first.sent.length + second.sent.length, settled, 'and then silence');
  assert.deepEqual(heard, [], 'hellos are not live messages');
  b.release();
  await tick();
  assert.equal(a.hasCompany(), false, 'bye');
  a.release();
});

test('gating off (tests, older callers): always company, no presence, no hellos', async () => {
  const realtime = fakeRealtime();
  const client = realtime.makeClient();
  const plain = await acquireLiveBus(client.supabase, 'doc-off', () => {});
  await tick();
  assert.equal(client.channels[0].options.config.presence, undefined);
  assert.equal(client.channels[0].tracked, 0);
  assert.equal(client.sent.length, 0);
  assert.equal(plain.hasCompany(), true);
  plain.release();
});

test('presence not answered yet: company assumed (a viewer never misses live changes); presence answered: trusted alone', async () => {
  const realtime = fakeRealtime();
  const silent = realtime.makeClient({ trackAnswer: 'never' });
  const bus = await acquireLiveBus(silent.supabase, 'doc-unknown', () => {}, { presence: true });
  await tick();
  assert.equal(bus.presenceState().state, 'unknown');
  assert.equal(bus.hasCompany(), true, 'unknown = assume company');
  bus.release();

  // Presence on, nobody else: alone even if a hello was heard earlier.
  const onClient = realtime.makeClient();
  const on = await acquireLiveBus(onClient.supabase, 'doc-on', () => {}, { presence: true });
  await tick();
  onClient.channels[0].deliver({ v: 0, h: 'old-screen' });
  assert.equal(on.presenceState().state, 'on');
  assert.equal(on.hasCompany(), false, 'presence is trusted alone');
  on.release();
});

test('without presence, a screen that finds nobody asks at most every 30 s, and a quiet present peer answers', async () => {
  const realtime = fakeRealtime();
  const first = realtime.makeClient({ trackAnswer: 'error' });
  const a = await acquireLiveBus(first.supabase, 'doc-ask', () => {}, { presence: true });
  await tick();
  const before = first.sent.length;
  for (let i = 0; i < 20; i += 1) a.hasCompany();
  assert.equal(first.sent.length - before, 1, 'one "who is here?" however often it sends');
  // A viewer that joined while its hello was lost: it answers the next ask.
  const viewer = realtime.makeClient({ trackAnswer: 'error' });
  const v = await acquireLiveBus(viewer.supabase, 'doc-ask', () => {}, { presence: true });
  await tick();
  await tick();
  assert.equal(a.hasCompany(), true);
  v.release();
  a.release();
});

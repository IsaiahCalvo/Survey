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
  assert.equal(first.sent.length + second.sent.length, 3, 'two hellos and one answer (no ping-pong)');
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

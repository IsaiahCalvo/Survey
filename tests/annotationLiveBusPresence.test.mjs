// w32 (2026-09-25): a screen alone in a document sends no live messages.
//
// The live channel also carries Realtime Presence (one entry per screen).
// Pins: alone (presence answered, no other key) → hasCompany() false; a
// second screen → true; presence refused (no presence policy yet) or not
// answered → true, i.e. exactly the w30 behaviour; a join is never refused
// because of presence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireLiveBus } from '../src/services/annotationLiveBus.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fakeSupabase({ trackAnswer = 'ok' } = {}) {
  const channels = [];
  return {
    channels,
    channel(topic, options) {
      const handlers = new Map();
      let state = {};
      const channel = {
        topic,
        options,
        tracked: 0,
        on(type, filter, callback) { handlers.set(`${type}:${filter?.event}`, callback); return channel; },
        subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return channel; },
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
        send() { return Promise.resolve('ok'); },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel() {},
  };
}

test('alone in the document: no company, so nothing live is sent; a second screen restores it', async () => {
  const supabase = fakeSupabase();
  const bus = await acquireLiveBus(supabase, 'doc-alone', () => {}, { presence: true });
  await tick();
  assert.equal(supabase.channels[0].options.config.presence.enabled, true);
  assert.equal(supabase.channels[0].tracked, 1, 'one presence entry per screen');
  assert.equal(bus.hasCompany(), false, 'alone');
  supabase.channels[0].setPeers(['other-screen']);
  assert.equal(bus.hasCompany(), true, 'someone else opened it');
  supabase.channels[0].setPeers([]);
  assert.equal(bus.hasCompany(), false, 'they left');
  bus.release();
});

test('presence refused (no policy) or off: every screen is assumed to have company, as before', async () => {
  const refused = fakeSupabase({ trackAnswer: 'error' });
  const bus = await acquireLiveBus(refused, 'doc-refused', () => {}, { presence: true });
  await tick();
  assert.equal(bus.isJoined(), true, 'the join itself is not refused');
  assert.equal(bus.hasCompany(), true);
  bus.release();
  const off = fakeSupabase();
  const plain = await acquireLiveBus(off, 'doc-off', () => {});
  await tick();
  assert.equal(off.channels[0].options.config.presence, undefined, 'no presence unless asked');
  assert.equal(off.channels[0].tracked, 0);
  assert.equal(plain.hasCompany(), true);
  plain.release();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RealtimeClient } from '@supabase/realtime-js';

const source = await readFile(new URL('../../src/services/documentAnnotationService.js', import.meta.url), 'utf8');
const start = source.indexOf('export function subscribeToDocumentPresence(');
const end = source.indexOf('// ============================================', start);
const load = client => new Function('supabase', `${source.slice(start, end).replace('export function', 'function')}\nreturn subscribeToDocumentPresence;`)(client);

test('immediate presence reopen owns a new SDK channel while old unsubscribe is pending', async () => {
  const client = new RealtimeClient('ws://127.0.0.1:1/socket', { timeout: 1000, params: { apikey: 'offline-fixture' } });
  client.connect = () => { throw new Error('Network is forbidden in this test'); };
  client.isConnected = () => true;
  const subscribe = load(client);
  const closeFirst = subscribe('same-document', () => {});
  await new Promise(setImmediate);
  const first = client.getChannels()[0];
  first.state = 'joined';
  let finish;
  first.unsubscribe = () => {
    first.state = 'leaving';
    return new Promise(resolve => { finish = () => { first.channelAdapter.channel.trigger('phx_close'); resolve('ok'); }; });
  };
  closeFirst();
  const closeSecond = subscribe('same-document', () => {});
  const second = client.getChannels().at(-1);
  try {
    assert.notEqual(first, second, 'a new subscriber must not borrow the closing channel');
    assert.equal(second.state, 'joining');
    finish();
    await new Promise(setImmediate);
    assert.equal(second.state, 'joining', 'old cleanup cannot close the replacement');
    assert.equal(client.getChannels().length, 1);
    assert.equal(client.getChannels()[0], second);
  } finally {
    finish?.();
    await new Promise(setImmediate);
    first.teardown();
    second.unsubscribe = async () => { second.channelAdapter.channel.trigger('phx_close'); return 'ok'; };
    closeSecond();
    await new Promise(setImmediate);
    client.disconnect();
  }
});

function transport(remove = () => Promise.resolve('ok')) {
  const channels = [];
  const client = {
    channel(topic) {
      const channel = { topic,
        on(type, filter, callback) { Object.assign(channel, { type, filter, event: callback }); return channel; },
        subscribe(callback) { channel.status = callback; return channel; },
      };
      channels.push(channel); return channel;
    },
    removeChannel: remove,
  };
  return { client, channels, subscribe: load(client) };
}

test('presence forwards incremental deltas and reconnect seeds without any query', () => {
  const h = transport(); const events = []; let seeds = 0;
  const close = h.subscribe('document-a', event => events.push(event), { onSubscribed: () => seeds++ });
  const channel = h.channels[0];
  assert.deepEqual(channel.filter, { event: '*', schema: 'public', table: 'document_presence', filter: 'document_id=eq.document-a' });
  channel.status('SUBSCRIBED'); channel.status('CHANNEL_ERROR'); channel.status('SUBSCRIBED');
  channel.event({ eventType: 'INSERT', new: { id: 'one' }, old: {} });
  channel.event({ eventType: 'DELETE', new: {}, old: { id: 'one' } });
  assert.equal(seeds, 2);
  assert.deepEqual(events, [
    { type: 'INSERT', row: { id: 'one' }, prevRow: null },
    { type: 'DELETE', row: null, prevRow: { id: 'one' } },
  ]);
  close();
});

test('cleanup is idempotent and suppresses late events while another subscriber stays live', async () => {
  const removed = []; let finish;
  const h = transport(channel => { removed.push(channel); return new Promise(resolve => { finish = resolve; }); });
  const events = []; const seeds = [];
  const closeA = h.subscribe('same-document', () => events.push('a'), { onSubscribed: () => seeds.push('a') });
  const closeB = h.subscribe('same-document', () => events.push('b'), { onSubscribed: () => seeds.push('b') });
  closeA(); closeA();
  for (const channel of h.channels) { channel.event({ eventType: 'UPDATE' }); channel.status('SUBSCRIBED'); }
  assert.equal(removed.length, 1); assert.equal(removed[0], h.channels[0]);
  assert.notEqual(h.channels[0].topic, h.channels[1].topic);
  assert.deepEqual(events, ['b']); assert.deepEqual(seeds, ['b']);
  finish('ok'); await new Promise(setImmediate);
  closeB(); finish('ok');
});

for (const mode of ['throw', 'reject']) {
  test(`presence cleanup tolerates ${mode} without reactivating callbacks`, async () => {
    let callbacks = 0;
    const h = transport(() => { if (mode === 'throw') throw new Error('gone'); return Promise.reject(new Error('gone')); });
    const close = h.subscribe('doc', () => callbacks++, { onSubscribed: () => callbacks++ });
    assert.doesNotThrow(close);
    h.channels[0].event({}); h.channels[0].status('SUBSCRIBED');
    await new Promise(setImmediate);
    assert.equal(callbacks, 0);
  });
}

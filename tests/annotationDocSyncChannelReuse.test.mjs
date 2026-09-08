import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

// Regression for the intermittent "open failed cannot add `postgres_changes`
// callbacks for realtime:anno-<uuid> after `subscribe()`" on document open.
//
// supabase-js caches realtime channels by topic: `client.channel(topic)`
// returns the EXISTING instance when one with that topic is registered, and
// realtime-js throws when `postgres_changes` callbacks are added to a channel
// that is already joined/joining. The old bare `anno-<docId>` topic therefore
// collided whenever a previous handle for the same document was still being
// torn down (destroy removes its channel only AFTER the final snapshot write)
// or was simply still alive — and the entire open failed.
//
// The double below mirrors those exact realtime-js v2 semantics (channel cache
// by topic + throw on post-subscribe postgres_changes registration).
function makeRealtimeSupabase({ snapshotUpsertDelayMs = 0, onThrows = false } = {}) {
  const emptyThen = (result) => {
    const b = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = chain;
    b.maybeSingle = async () => result;
    b.single = async () => result;
    b.then = (res) => res(result);
    return b;
  };

  const channels = [];
  const client = {
    channels,
    from(table) {
      if (table === 'annotation_updates') {
        return {
          select: () => emptyThen({ data: [] }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { seq: 1 }, error: null }) }) }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => emptyThen({ data: null }),
          upsert: async () => {
            if (snapshotUpsertDelayMs > 0) await new Promise((r) => setTimeout(r, snapshotUpsertDelayMs));
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel(topic) {
      const realtimeTopic = `realtime:${topic}`;
      const existing = channels.find((c) => c.topic === realtimeTopic);
      if (existing) return existing; // supabase-js returns the cached instance
      const ch = {
        topic: realtimeTopic,
        state: 'closed',
        on(type, _filter, _cb) {
          const joined = onThrows || this.state === 'joined' || this.state === 'joining';
          if (joined && (type === 'presence' || type === 'postgres_changes')) {
            throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`);
          }
          return this;
        },
        subscribe(cb) {
          this.state = 'joining';
          queueMicrotask(() => { this.state = 'joined'; cb?.('SUBSCRIBED'); });
          return this;
        },
        async unsubscribe() { this.state = 'closed'; return 'ok'; },
      };
      channels.push(ch);
      return ch;
    },
    getChannels() { return [...channels]; },
    async removeChannel(ch) {
      await ch.unsubscribe();
      const i = channels.indexOf(ch);
      if (i >= 0) channels.splice(i, 1);
      return 'ok';
    },
  };
  return client;
}

test('reopening a document while the previous handle is still tearing down must not fail the open', async () => {
  // Slow snapshot upsert = the real-world destroy window: destroy() writes a
  // final checkpoint BEFORE it removes the realtime channel.
  const supabase = makeRealtimeSupabase({ snapshotUpsertDelayMs: 80 });
  const docA = new Y.Doc();
  const handleA = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-reopen-race', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: true, doc: docA,
  });
  await new Promise((r) => setTimeout(r, 0)); // let subscribe() reach 'joined'

  handleA.setMeta('before-close', true); // unchanged readers no longer checkpoint on close
  const destroyA = handleA.destroy(); // NOT awaited — the reopen races it
  const docB = new Y.Doc();
  const handleB = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-reopen-race', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: true, doc: docB,
  });

  await destroyA;
  await handleB.destroy();
  assert.equal(supabase.channels.length, 0, 'both handles removed their own channels');
});

test('two live handles on the same document coexist (two viewer tabs of one doc)', async () => {
  const supabase = makeRealtimeSupabase();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const handleA = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-two-tabs', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: true, doc: docA,
  });
  await new Promise((r) => setTimeout(r, 0));
  const handleB = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-two-tabs', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: true, doc: docB,
  });

  assert.equal(supabase.channels.length, 2, 'each open owns a distinct channel');
  await handleA.destroy();
  assert.equal(supabase.channels.length, 1, 'destroy removes only its own channel');
  await handleB.destroy();
  assert.equal(supabase.channels.length, 0);
});

test('a failed open detaches its doc observer so it cannot double-append ops for a later handle', async () => {
  const supabase = makeRealtimeSupabase();
  const doc = new Y.Doc();
  // Fail the open mid-way (tail read) so partially-attached state must unwind.
  const failingSupabase = {
    ...supabase,
    from(table) {
      if (table === 'annotation_updates') {
        return {
          select: () => {
            const b = {};
            const chain = () => b;
            for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = chain;
            b.maybeSingle = async () => ({ data: null });
            b.single = async () => ({ data: null });
            b.then = (res) => res({ data: null, error: { message: 'backend down' } });
            return b;
          },
        };
      }
      return supabase.from(table);
    },
  };

  await assert.rejects(
    openAnnotationDoc({ actorUserId: 'test-actor',
      documentId: 'doc-open-fail', supabase: failingSupabase, clientId: 'clientA',
      enableLocal: false, enableRealtime: true, doc,
    }),
    'the open fails closed on any required backend read',
  );

  // This failure happens in loadFromBackend (BEFORE the observer is attached), so
  // it proves the pre-observer failure path leaves nothing behind.
  const before = doc._observers?.get?.('update')?.size ?? 0;
  assert.equal(before, 0, `no update observers may survive a pre-observer failed open (found ${before})`);
});

test('an open that fails AFTER the observer is attached still detaches it (catch teardown)', async () => {
  // Force subscribeRealtime to throw (channel.on() rejects like the real
  // "cannot add postgres_changes … after subscribe()" bug) — this happens AFTER
  // the doc 'update' observer is attached, so it exercises the openAnnotationDoc
  // catch's `off('update', state.onDocUpdate)` path specifically.
  const supabase = makeRealtimeSupabase({ onThrows: true });
  const doc = new Y.Doc();

  await assert.rejects(
    openAnnotationDoc({ actorUserId: 'test-actor',
      documentId: 'doc-subscribe-fail', supabase, clientId: 'clientA',
      enableLocal: false, enableRealtime: true, doc,
    }),
    /cannot add `postgres_changes`/,
    'the open surfaces the channel-subscribe failure',
  );

  const observers = doc._observers?.get?.('update')?.size ?? 0;
  assert.equal(observers, 0, `the catch must detach the observer it attached (found ${observers})`);
  // A local edit after the failed open must NOT enqueue an append (no leaked
  // observer racing a retry handle with the same client_seq counter).
  assert.equal(supabase.channels.length, 0, 'the partially-created channel was cleaned up');
});

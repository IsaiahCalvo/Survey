// w32: the fake Supabase backend of tests/annotationLivePreview.test.mjs (a WAL
// table with Postgres-Changes delivery, a snapshot row, a Broadcast topic per
// document), shared by the live-edit tests.
import * as Y from 'yjs';
import { openAnnotationDoc } from '../../src/services/annotationDocSync.js';

export const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(predicate, { timeoutMs = 3_000, stepMs = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await settle(stepMs);
  }
  return false;
}

export function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// One fake backend: a WAL table with Postgres-Changes delivery, a snapshot
// row, and a Broadcast topic per document. Each client has its own socket, so
// a broadcast reaches every OTHER client joined to the topic.
export function createCloud(documentId) {
  const rows = [];
  const sent = [];
  let snapshot = null;
  const pgChannels = new Set();
  const liveChannels = new Set();
  const cloud = {
    rows,
    sent,
    get snapshot() { return snapshot; },
    snapshotGate: null,
    snapshotCalls: 0,
  };
  const deliverRow = (row) => {
    for (const channel of pgChannels) {
      if (channel.client.online) queueMicrotask(() => channel.insert?.({ new: row }));
    }
  };
  const readBuilder = (client) => {
    let gtSeq = null;
    let selected = '';
    const filters = new Map();
    const builder = {
      select(columns) { selected = columns; return builder; },
      eq(column, value) { filters.set(column, value); return builder; },
      gt(_column, value) { gtSeq = Number(value); return builder; },
      order() { return builder; },
      limit() { return builder; },
      abortSignal() { return builder; },
      then(resolve, reject) {
        if (gtSeq != null) client.tailReads += 1;
        let data = rows.filter((row) => (
          [...filters].every(([column, value]) => row[column] === value)
          && (gtSeq == null || row.seq > gtSeq)
        ));
        if (selected === 'client_seq') {
          data = data.map((row) => ({ client_seq: row.client_seq }))
            .sort((l, r) => r.client_seq - l.client_seq);
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  // A message from outside any client (a forged or broken sender).
  cloud.inject = (payload) => {
    for (const live of liveChannels) {
      if (live.joined) queueMicrotask(() => live.handler?.({ payload }));
    }
  };
  cloud.makeClient = (actor) => {
    const client = {
      actor,
      online: true,
      appendCalls: 0,
      tailReads: 0,
      appendGate: null,     // a promise: appends wait for it
      appendError: null,    // { code, message }: appends fail with it
      liveTopics: [],
    };
    client.supabase = {
      async rpc(name, args) {
        if (name === 'append_annotation_update') {
          client.appendCalls += 1;
          if (client.appendGate) await client.appendGate;
          if (client.appendError) return { data: null, error: client.appendError };
          const existing = rows.find((row) => row.client_id === args.p_client_id && row.client_seq === args.p_client_seq);
          if (existing) return { data: [{ seq: existing.seq }], error: null };
          const row = {
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: actor,
            data: args.p_data,
            seq: rows.length + 1,
          };
          rows.push(row);
          deliverRow(row);
          return { data: [{ seq: row.seq }], error: null };
        }
        if (name === 'store_annotation_snapshot') {
          cloud.snapshotCalls += 1;
          if (cloud.snapshotGate) await cloud.snapshotGate;
          snapshot = {
            snapshot: args.p_snapshot,
            at_seq: args.p_at_seq,
            encoding_version: args.p_encoding_version,
            writer_id: args.p_writer_id,
            writer_epoch: args.p_writer_epoch,
          };
          return { data: true, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      from(table) {
        if (table === 'annotation_updates') return readBuilder(client);
        if (table === 'annotation_snapshots') {
          return {
            select() {
              const b = { eq() { return b; }, async maybeSingle() { return { data: snapshot, error: null }; } };
              return b;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      channel(topic) {
        if (String(topic).startsWith('anno-live:')) {
          client.liveTopics.push(topic);
          const live = { client, topic, handler: null, joined: false };
          liveChannels.add(live);
          const api = {
            on(_type, _filter, callback) { live.handler = callback; return api; },
            subscribe(callback) {
              client.liveJoins = (client.liveJoins || 0) + 1;
              if (cloud.refuseLive) {
                // No channel policy: Realtime refuses the private join.
                queueMicrotask(() => callback('CHANNEL_ERROR', new Error('Unauthorized')));
                return api;
              }
              queueMicrotask(() => { live.joined = true; callback('SUBSCRIBED'); });
              return api;
            },
            send(message) {
              sent.push({ from: actor, at: Date.now(), rowsAtSend: rows.length, payload: message.payload });
              for (const other of liveChannels) {
                if (other === live || other.topic !== topic || !other.joined) continue;
                queueMicrotask(() => other.handler?.({ payload: message.payload }));
              }
              return Promise.resolve('ok');
            },
          };
          live.api = api;
          return api;
        }
        const channel = { client, insert: null };
        pgChannels.add(channel);
        client.pgChannel = channel;
        return {
          on(_event, _filter, callback) { channel.insert = callback; return this; },
          subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return this; },
        };
      },
      async removeChannel(channel) {
        for (const live of liveChannels) if (live.api === channel) liveChannels.delete(live);
        if (client.pgChannel) pgChannels.delete(client.pgChannel);
      },
    };
    return client;
  };
  return cloud;
}

export const openFor = (client, documentId, extra = {}) => openAnnotationDoc({
  documentId,
  supabase: client.supabase,
  clientId: `${client.actor}-install`,
  actorUserId: client.actor,
  enableLocal: false,
  enableRealtime: true,
  doc: new Y.Doc(),
  livePreview: true,
  repairRetryDelayMs: 60_000,
  snapshotRetryDelayMs: 0,
  requestTimeoutMs: 2_000,
  ...extra,
});

export const hasMark = (handle, id) => (handle.getByPage()?.[1]?.objects || [])
  .some((object) => object?.data?.id === id);

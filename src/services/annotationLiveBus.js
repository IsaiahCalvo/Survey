// src/services/annotationLiveBus.js
//
// w30 (2026-09-24): the fast lane for live annotation sync. One Supabase
// Realtime Broadcast channel per document (`anno-live:<documentId>`), shared by
// every open handle of that document in this tab (supabase-js keeps one channel
// per topic, and a socket can join a topic once), reference counted.
//
// Why it exists: a stroke used to reach another screen only as its WAL row
// came back through Postgres Changes: the insert (~100-300 ms), then the
// database's change feed (~200-600 ms), after the sender's own render work.
// A broadcast leaves the sender the moment the edit is made and arrives in
// ~50-150 ms. The WAL row is still written and still delivered: it stays the
// only thing that makes an edit durable or accepted (annotationDocSync treats a
// broadcast as a preview until its row arrives).
//
// This module is transport only: no Yjs, no document state.

export const LIVE_PREVIEW_EVENT = 'u';

const REGISTRY = (globalThis.__annotationLiveBusRegistry__ ??= new WeakMap());

function registryFor(supabase) {
  let byDocument = REGISTRY.get(supabase);
  if (!byDocument) {
    byDocument = new Map();
    REGISTRY.set(supabase, byDocument);
  }
  return byDocument;
}

function createBus(supabase, documentId) {
  const bus = {
    refs: 0,
    listeners: new Set(),
    joined: false,
    closing: null,
    channel: null,
  };
  const channel = supabase.channel(`anno-live:${documentId}`, {
    // self:false — the sender already holds its own edit. ack:false — a
    // preview that is lost costs nothing: the WAL row still arrives.
    config: { broadcast: { self: false, ack: false } },
  });
  bus.channel = channel;
  channel.on('broadcast', { event: LIVE_PREVIEW_EVENT }, (message) => {
    for (const listener of [...bus.listeners]) {
      try { listener(message?.payload); } catch (error) {
        console.warn('[annotationLiveBus] listener threw', error?.message);
      }
    }
  });
  channel.subscribe((status) => {
    bus.joined = status === 'SUBSCRIBED';
  });
  return bus;
}

/**
 * Join the document's live channel (or share the one this tab already has).
 * Resolves to { send(payload) → boolean, release() }.
 */
export async function acquireLiveBus(supabase, documentId, listener) {
  if (!supabase || typeof supabase.channel !== 'function' || !documentId) return null;
  const byDocument = registryFor(supabase);
  // A bus whose last user left is removing its channel; a new channel for the
  // same topic can only be made once that removal is done.
  for (let guard = 0; guard < 5; guard += 1) {
    const existing = byDocument.get(documentId);
    if (!existing?.closing) break;
    await existing.closing.catch(() => {});
    if (byDocument.get(documentId) === existing) byDocument.delete(documentId);
  }
  let bus = byDocument.get(documentId);
  if (!bus || bus.closing) {
    bus = createBus(supabase, documentId);
    byDocument.set(documentId, bus);
  }
  bus.refs += 1;
  if (typeof listener === 'function') bus.listeners.add(listener);
  let released = false;
  return {
    send(payload) {
      if (released || !bus.joined || bus.closing) return false;
      try {
        const result = bus.channel.send({ type: 'broadcast', event: LIVE_PREVIEW_EVENT, payload });
        if (result && typeof result.catch === 'function') result.catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    isJoined() { return !released && bus.joined && !bus.closing; },
    release() {
      if (released) return;
      released = true;
      bus.listeners.delete(listener);
      bus.refs = Math.max(0, bus.refs - 1);
      if (bus.refs > 0 || bus.closing) return;
      bus.joined = false;
      bus.closing = Promise.resolve()
        .then(() => supabase.removeChannel?.(bus.channel))
        .catch(() => {})
        .finally(() => {
          if (byDocument.get(documentId) === bus) byDocument.delete(documentId);
        });
    },
  };
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

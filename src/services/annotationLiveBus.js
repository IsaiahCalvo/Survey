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
// The channel is PRIVATE: Realtime lets a screen join only when the
// realtime.messages policies say its user can open the document (receive) or
// edit it (send); see supabase/migrations/*_live_preview_channel_policies.sql.
// Without those policies the join is refused: this module then gives up for a
// while (no retry storm against the database) and edits arrive through the
// log only, exactly as before w30.
//
// This module is transport only: no Yjs, no document state.

export const LIVE_PREVIEW_EVENT = 'u';

const REGISTRY = (globalThis.__annotationLiveBusRegistry__ ??= new WeakMap());
// documentId -> time a join was refused; no new attempt for this long.
const REFUSED = (globalThis.__annotationLiveBusRefused__ ??= new Map());
const REFUSED_BACKOFF_MS = 60_000; // one join a minute at most, per document

function registryFor(supabase) {
  let byDocument = REGISTRY.get(supabase);
  if (!byDocument) {
    byDocument = new Map();
    REGISTRY.set(supabase, byDocument);
  }
  return byDocument;
}

function closeBus(supabase, byDocument, documentId, bus) {
  if (bus.closing) return;
  if (bus.gating && bus.joined) sendHello(bus, { b: 1 });
  bus.joined = false;
  bus.closing = Promise.resolve()
    .then(() => supabase.removeChannel?.(bus.channel))
    .catch(() => {})
    .finally(() => {
      if (byDocument.get(documentId) === bus) byDocument.delete(documentId);
    });
}

// w32 company hellos: { v: 0, h: busKey, r?: 1 (an answer), b?: 1 (bye) }.
const HELLO_VERSION = 0;
const HELLO_MAX_PEERS = 64;

function sendHello(bus, extra) {
  if (!bus.channel || bus.closing) return;
  try {
    const result = bus.channel.send({
      type: 'broadcast',
      event: LIVE_PREVIEW_EVENT,
      payload: { v: HELLO_VERSION, h: bus.presence.key, ...extra },
    });
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch { /* the hello is best effort */ }
}

function onHello(bus, payload) {
  const key = typeof payload.h === 'string' ? payload.h : '';
  if (!key || key.length > 64 || key === bus.presence.key || !bus.gating) return;
  if (payload.b === 1) {
    bus.helloPeers.delete(key);
    return;
  }
  const isNew = !bus.helloPeers.has(key);
  if (isNew && bus.helloPeers.size < HELLO_MAX_PEERS) bus.helloPeers.add(key);
  // Answer a newcomer once so it learns this screen is here; never answer
  // an answer (no ping-pong).
  if (isNew && payload.r !== 1) sendHello(bus, { r: 1 });
}

function createBus(supabase, byDocument, documentId, { isPrivate, presence }) {
  const presenceKey = `s-${Math.random().toString(36).slice(2, 12)}`;
  const bus = {
    refs: 0,
    listeners: new Set(),
    joined: false,
    everJoined: false,
    closing: null,
    channel: null,
    // w32: who else has this document open on the channel, so a screen
    // alone sends nothing live (w34 review: Realtime messages are capped per
    // project and billed). Two independent signals, either one is enough:
    //   * Realtime Presence (needs the presence policy migration; 'off' once
    //     the server refuses a track, 'unknown' until it answers);
    //   * a tiny hello on the channel itself (works without any policy): a
    //     screen says hello when it joins, every screen that hears a NEW
    //     hello answers once, and says bye when it leaves.
    // With company gating off (tests, older callers) every screen is assumed
    // to have company, exactly as before.
    gating: Boolean(presence),
    presence: { key: presenceKey, state: presence ? 'unknown' : 'off', peers: 0 },
    helloPeers: new Set(),
  };
  const channel = supabase.channel(`anno-live:${documentId}`, {
    // self:false — the sender already holds its own edit. ack:false — a
    // preview that is lost costs nothing: the WAL row still arrives.
    config: {
      private: isPrivate,
      broadcast: { self: false, ack: false },
      ...(presence ? { presence: { key: presenceKey, enabled: true } } : {}),
    },
  });
  bus.channel = channel;
  channel.on('broadcast', { event: LIVE_PREVIEW_EVENT }, (message) => {
    const payload = message?.payload;
    if (payload?.v === HELLO_VERSION) {
      onHello(bus, payload);
      return;
    }
    for (const listener of [...bus.listeners]) {
      try { listener(message?.payload); } catch (error) {
        console.warn('[annotationLiveBus] listener threw', error?.message);
      }
    }
  });
  if (presence) {
    channel.on('presence', { event: 'sync' }, () => {
      if (bus.presence.state === 'off') return;
      let keys = [];
      try { keys = Object.keys(channel.presenceState?.() || {}); } catch { keys = []; }
      bus.presence.peers = keys.filter((key) => key !== presenceKey).length;
      bus.presence.state = 'on';
    });
  }
  channel.subscribe((status, error) => {
    bus.joined = status === 'SUBSCRIBED';
    if (bus.joined) {
      bus.everJoined = true;
      REFUSED.delete(documentId);
      if (presence) {
        sendHello(bus, {});
        if (bus.presence.state !== 'off') {
          // One presence entry per open screen; only joins and leaves are
          // messages (no heartbeat traffic). Refused (no presence policy):
          // 'off' for good, the hellos carry it. Anything else (a timeout)
          // is tried again at the next join (review B).
          Promise.resolve()
            .then(() => channel.track({ at: Date.now() }))
            .then((result) => { if (result === 'error') bus.presence.state = 'off'; })
            .catch(() => {});
        }
      }
      return;
    }
    // Never joined and the server said no (no channel policy, or no access):
    // stop here instead of letting the client retry every few seconds; the
    // log path carries every edit anyway. Any other error (a network blip)
    // is left to the client's own rejoin.
    const refused = /unauthori|permission|forbidden|denied|not allowed/i
      .test(String(error?.message || error || ''));
    if (status === 'CHANNEL_ERROR' && !bus.everJoined && refused) {
      REFUSED.set(documentId, Date.now());
      console.info('[annotationLiveBus] live channel refused; edits arrive through the log only');
      closeBus(supabase, byDocument, documentId, bus);
    }
  });
  return bus;
}

/**
 * Join the document's live channel (or share the one this tab already has).
 * Resolves to { send(payload) → boolean, release() }.
 */
export async function acquireLiveBus(supabase, documentId, listener, { isPrivate = true, presence = false } = {}) {
  if (!supabase || typeof supabase.channel !== 'function' || !documentId) return null;
  const refusedAt = REFUSED.get(documentId);
  if (refusedAt && Date.now() - refusedAt < REFUSED_BACKOFF_MS) return null;
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
    bus = createBus(supabase, byDocument, documentId, { isPrivate, presence });
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
    // w32: false only when Presence says no other screen has the document
    // open on the channel (so nothing live would be delivered to anyone).
    hasCompany() {
      if (!bus.gating) return true;
      if (bus.presence.state === 'on' && bus.presence.peers > 0) return true;
      return bus.helloPeers.size > 0;
    },
    presenceState() { return { ...bus.presence, helloPeers: bus.helloPeers.size }; },
    isClosed() { return released || Boolean(bus.closing); },
    release() {
      if (released) return;
      released = true;
      bus.listeners.delete(listener);
      bus.refs = Math.max(0, bus.refs - 1);
      if (bus.refs > 0) return;
      closeBus(supabase, byDocument, documentId, bus);
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

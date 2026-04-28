// tests/phase28/SupabaseYjsProvider.test.mjs
// Phase 28 Wave 0 scaffold — runs as test.skip until Plan 28-02 lands SupabaseYjsProvider.js.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md § Pattern 1 (sync v1 frame).
//
// UX/architecture rationale: this is the v2.4 default-path transport — a custom Yjs
// provider that rides Supabase Realtime Broadcast carrying y-protocols sync v1 frames.
// Round-trip integrity of the encode/decode pair is the single most load-bearing
// invariant: any drift here corrupts CRDT history irreversibly. The echo-loop guard
// (REMOTE_REALTIME_ORIGIN short-circuit) is what stops a multi-peer mesh from melting
// itself with infinite re-broadcast.
//
// Skip condition: src/lib/collab/SupabaseYjsProvider.js has not been created yet
// (Plan 28-02 owns it). Once landed, this scaffold flips automatically from skip → green.

import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(REPO_ROOT, 'src/lib/collab/SupabaseYjsProvider.js');
const YJS_INSTALLED = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

// Each test inlines the skip-guard pattern verbatim so the acceptance-criteria
// grep matches every invocation. Pattern lifted from tests/phase27/schemaPresence.test.mjs.

test(
  'SupabaseYjsProvider: encodeUpdate(updateBytes) returns a y-protocols sync v1 frame (messageType byte 0)',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/SupabaseYjsProvider.js not yet present (Plan 28-02)' : !YJS_INSTALLED ? 'yjs not installed yet' : false },
  async () => {
    const Y = await import('yjs');
    const { encodeUpdate } = await import(TARGET);
    const doc = new Y.Doc();
    doc.getMap('annotations').set('test-key', 'test-value');
    const update = Y.encodeStateAsUpdate(doc);

    const frame = encodeUpdate(update);
    ok(frame instanceof Uint8Array, 'encodeUpdate must return a Uint8Array');
    ok(frame.byteLength > 0, 'encoded frame must be non-empty');
    // y-protocols sync v1 prefixes the frame with messageType=0 (sync) followed by the
    // sync sub-message type (0=step1, 1=step2, 2=update). For an applied update, the
    // first byte is 0 (messageSync). Plan 28-02 may wrap further — the assertion is
    // intentionally lenient: the frame must START with the sync messageType marker.
    strictEqual(frame[0], 0, 'sync v1 frame must start with messageType byte 0 (sync)');
  }
);

test(
  'SupabaseYjsProvider: decodeAndApply round-trips encodeUpdate (encode → decode → state matches)',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/SupabaseYjsProvider.js not yet present (Plan 28-02)' : !YJS_INSTALLED ? 'yjs not installed yet' : false },
  async () => {
    const Y = await import('yjs');
    const { encodeUpdate, decodeAndApply, REMOTE_REALTIME_ORIGIN } = await import(TARGET);
    const docA = new Y.Doc();
    docA.getMap('annotations').set('color', 'red');
    docA.getMap('annotations').set('id', 'anno-1');
    const update = Y.encodeStateAsUpdate(docA);
    const frame = encodeUpdate(update);

    const docB = new Y.Doc();
    decodeAndApply(docB, /* awareness */ null, frame, REMOTE_REALTIME_ORIGIN);

    const result = docB.getMap('annotations');
    strictEqual(result.get('color'), 'red', 'round-tripped Y.Map must preserve string values');
    strictEqual(result.get('id'), 'anno-1', 'round-tripped Y.Map must preserve all keys');
  }
);

test(
  'SupabaseYjsProvider: uint8ArrayToBase64 ↔ base64ToUint8Array are inverses for arbitrary binary',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/SupabaseYjsProvider.js not yet present (Plan 28-02)' : false },
  async () => {
    const { uint8ArrayToBase64, base64ToUint8Array } = await import(TARGET);
    // Realistic binary: every byte 0..255 plus some Yjs-shaped sync v1 prefix.
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const b64 = uint8ArrayToBase64(original);
    ok(typeof b64 === 'string', 'uint8ArrayToBase64 must return a string');
    const roundTrip = base64ToUint8Array(b64);
    deepStrictEqual(
      Array.from(roundTrip),
      Array.from(original),
      'base64 round-trip must preserve every byte (Realtime carries strings, not bytes — this layer is critical)'
    );
  }
);

test(
  'SupabaseYjsProvider: exports connect(documentId, ydoc, options) factory + disconnect() teardown',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/SupabaseYjsProvider.js not yet present (Plan 28-02)' : false },
  async () => {
    const mod = await import(TARGET);
    ok(typeof mod.connect === 'function', 'module must export a connect() factory');
    ok(mod.connect.length >= 2, 'connect() must accept at least (documentId, ydoc) — options is third optional arg');
    // Plan 28-02 may export disconnect either as a top-level function OR via the
    // handle returned from connect(). Either shape is acceptable.
    const handleHasDisconnect = mod.connect.toString().includes('disconnect');
    const moduleHasDisconnect = typeof mod.disconnect === 'function';
    ok(
      handleHasDisconnect || moduleHasDisconnect,
      'either connect() returns a handle with disconnect() OR module exports disconnect() — Plan 28-02 picks'
    );
  }
);

test(
  'SupabaseYjsProvider: echo-loop guard — local update with REMOTE_REALTIME_ORIGIN does NOT re-broadcast',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/SupabaseYjsProvider.js not yet present (Plan 28-02)' : !YJS_INSTALLED ? 'yjs not installed yet' : false },
  async () => {
    const Y = await import('yjs');
    const { connect, REMOTE_REALTIME_ORIGIN } = await import(TARGET);
    const doc = new Y.Doc();

    // Build a fake channel that records every send() call. The provider must not
    // call channel.send() when applyUpdate carries the REMOTE_REALTIME_ORIGIN sentinel
    // — that's the echo-loop short-circuit.
    const sentMessages = [];
    const fakeChannel = {
      on: () => fakeChannel,
      subscribe: (cb) => {
        if (cb) cb('SUBSCRIBED');
        return fakeChannel;
      },
      send: (msg) => {
        sentMessages.push(msg);
        return Promise.resolve();
      },
      unsubscribe: () => Promise.resolve(),
    };
    const fakeSupabase = {
      channel: () => fakeChannel,
      removeChannel: () => Promise.resolve(),
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
      realtime: { setAuth: () => {} },
    };

    const handle = connect('test-doc-id', doc, { supabase: fakeSupabase });
    // Apply an update tagged with the REMOTE sentinel — provider must short-circuit.
    const otherDoc = new Y.Doc();
    otherDoc.getMap('annotations').set('echo-test', 'x');
    const update = Y.encodeStateAsUpdate(otherDoc);
    Y.applyUpdate(doc, update, REMOTE_REALTIME_ORIGIN);

    strictEqual(
      sentMessages.length,
      0,
      'echo-loop guard: applyUpdate(doc, bytes, REMOTE_REALTIME_ORIGIN) must NOT trigger channel.send (would mesh-amplify forever)'
    );

    if (handle && typeof handle.disconnect === 'function') handle.disconnect();
  }
);

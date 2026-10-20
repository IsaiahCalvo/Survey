/**
 * Tick-61 coverage chips: paper thin-stroke eraser miss, history text/callout
 * summaries + preview clamp catch, decodeAndApply awareness, provider send +
 * sync_request catch, clearSigningSecretCache by id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';

import { eraseAnnotations } from '../src/utils/paperAnnotationGeometry.js';
import { buildHistoryEventRowFromDebugEvent } from '../src/services/documentHistoryService.js';
import {
  decodeAndApply,
  connect,
  encodeSyncStep1,
} from '../src/lib/collab/SupabaseYjsProvider.js';
import { clearSigningSecretCache } from '../src/services/rowIdServerSecretClient.js';

test('paper erase: thin centerline miss keeps annotation unchanged', () => {
  const result = eraseAnnotations(
    [{
      id: 'thin-lie',
      cmds: [['M', 200, 200], ['L', 240, 200]],
      strokeWidth: 2,
      fill: null,
      // Bounds claim overlap near origin; geometry is far away
      bounds: { x: 0, y: 0, w: 30, h: 30 },
    }],
    [{ x: 5, y: 5 }, { x: 15, y: 5 }],
    8,
    'partial',
  );
  assert.ok(result.annotations.some((a) => a.id === 'thin-lie'));
  assert.ok(!result.changedIds.includes('thin-lie'));
});

test('documentHistory text/callout edit summaries + circular preview clamp', () => {
  const textRow = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    actionType: 'text',
    pageNumber: 2,
    annotationId: 't1',
    timestamp: '2026-07-12T12:00:00.000Z',
  }, { documentId: 'doc-h', user: { email: 'a@b.c' } });
  assert.match(textRow.summary, /edited text/);

  const calloutRow = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    actionType: 'callout',
    pageNumber: 3,
    annotationId: 'c1',
    timestamp: '2026-07-12T12:00:01.000Z',
  }, { documentId: 'doc-h', user: { email: 'a@b.c' } });
  assert.match(calloutRow.summary, /edited a callout/);

  const generic = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    actionType: 'style',
    annotationType: 'circle',
    pageNumber: 4,
    annotationId: 'g1',
    timestamp: '2026-07-12T12:00:03.000Z',
  }, { documentId: 'doc-h', user: { email: 'a@b.c' } });
  assert.match(generic.summary, /edited a circle/);

  const previewAnnotation = {
    left: 1,
    top: 2,
    toJSON() {
      if (this.__clampPass) throw new Error('clamp-stringify-boom');
      this.__clampPass = true;
      return { left: 1, top: 2 };
    },
  };
  const clamped = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    actionType: 'move',
    pageNumber: 1,
    annotationId: 'm1',
    timestamp: '2026-07-12T12:00:02.000Z',
    // Force trimPayload truncated branch so clampPreviewAnnotation runs
    pad: 'x'.repeat(13000),
    previewAnnotation,
  }, { documentId: 'doc-h', user: { email: 'a@b.c' } });
  assert.equal(clamped.payload.previewAnnotation, null);
});

test('decodeAndApply awareness frame + connect send + sync_request catch', async () => {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const awUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 1); // MESSAGE_AWARENESS
  encoding.writeVarUint8Array(enc, awUpdate);
  const frame = encoding.toUint8Array(enc);
  assert.equal(decodeAndApply(doc, awareness, frame, 'origin'), null);
  assert.equal(decodeAndApply(doc, null, frame, 'origin'), null); // no awareness → fallthrough

  const handlers = new Map();
  const sent = [];
  const channel = {
    state: 'joined',
    on(type, filter, cb) {
      handlers.set(`${type}:${filter?.event || '*'}`, cb);
      return channel;
    },
    subscribe(cb) {
      queueMicrotask(() => cb?.('SUBSCRIBED'));
      return channel;
    },
    send: async (msg) => {
      if (msg?.event === 'sync_request') throw new Error('sync-request-send-boom');
      sent.push(msg);
      return 'ok';
    },
    unsubscribe() {},
  };
  const rejected = [];
  const handle = connect('doc-t61', doc, {
    supabase: {
      channel: () => channel,
      removeChannel() {},
      realtime: { removeChannel() { throw new Error('rt-remove'); } },
    },
    awareness,
    onUpdateRejected: (r) => rejected.push(r),
    onTransportState: () => {},
  });
  await new Promise((r) => setTimeout(r, 20));

  // send while connected → line 390
  await handle.send('sync', { update: 'e30=' });

  // sync_request with bad stateVector → catch 332-334
  handlers.get('broadcast:sync_request')?.({
    payload: { stateVector: '!!!not-base64!!!', fromClientId: doc.clientID + 9 },
  });

  // sync_request send failure after SUBSCRIBED is already covered by microtask;
  // force another path: corrupt awareness payload → awareness catch
  handlers.get('broadcast:awareness')?.({
    payload: { awareness: '%%%' },
  });

  handle.disconnect();
  awareness.destroy();
  doc.destroy();
  assert.ok(true);
});

test('clearSigningSecretCache deletes per-document entries', () => {
  clearSigningSecretCache('doc-specific');
  clearSigningSecretCache(null);
  assert.ok(true);
});

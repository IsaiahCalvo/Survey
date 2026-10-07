// A History row must never carry another screen's live-edit token.
//
// Found in the real two-account run (TEST-PLAN 61, 2026-10-06): A recoloured a
// rectangle while B was dragging it, so A's copy on screen was B's live
// overlay, which carries `__surveyLiveEdit` = "writer\u0000seq\u0000key". That
// object went into the History row's previewAnnotation, and Postgres refused
// the whole row ("22P05 \u0000 cannot be converted to text"), so the colour
// change had no History line. The token is screen-only state and NUL can
// never be stored, so rows are cleaned before they are cached, shown or sent.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHistoryEventRowFromDebugEvent,
  historyRowForStorage,
  recordAndNotifyDocumentHistoryEvent,
} from '../src/services/documentHistoryService.js';
import { LIVE_EDIT_FLAG, LIVE_PREVIEW_FLAG, liveEditToken } from '../src/services/annotationLiveOverlay.js';

const user = { id: 'user-a', email: 'a@example.com' };
const hasNul = (value) => JSON.stringify(value).includes('\\u0000');

test('colour change on a mark another screen is moving: row has no live token and no NUL', () => {
  const token = liveEditToken('writer-b', 1, 'rect-61');
  assert.ok(token.includes('\u0000'), 'the token uses NUL as its separator');
  const rect = { id: 'rect-61', type: 'rect', left: 61, top: 610, width: 80, height: 60, stroke: '#0000FF', [LIVE_EDIT_FLAG]: token };
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 7,
    actionType: 'color',
    annotationType: 'rect',
    annotationId: 'rect-61',
    pageNumber: 1,
    previewAnnotation: rect,
    previewBefore: { ...rect, stroke: '#FF0000' },
  }, { documentId: 'doc-1', user });
  assert.equal(hasNul(row), false);
  assert.equal(LIVE_EDIT_FLAG in row.payload.previewAnnotation, false);
  assert.equal(LIVE_EDIT_FLAG in row.payload.previewBefore, false);
  // Everything else about the preview is kept.
  assert.equal(row.payload.previewAnnotation.stroke, '#0000FF');
  assert.equal(row.payload.previewAnnotation.left, 61);
  assert.equal(row.summary.includes('rectangle'), true);
});

test('historyRowForStorage: drops live flags anywhere, strips NUL from strings, keeps clean rows as they are', () => {
  const clean = { document_id: 'd', client_event_id: 'e', payload: { previewAnnotation: { id: 'x', path: [['M', 1, 2], ['L', 3, 4]] } } };
  assert.equal(historyRowForStorage(clean), clean, 'nothing to clean: same object');
  const dirty = {
    document_id: 'd',
    client_event_id: 'e',
    summary: 'bad\u0000text',
    payload: {
      restoreAction: { annotation: { id: 'x', [LIVE_EDIT_FLAG]: 'w\u00001\u0000x', [LIVE_PREVIEW_FLAG]: true } },
      list: [{ note: 'a\u0000b' }, 3, null],
    },
  };
  const out = historyRowForStorage(dirty);
  assert.equal(hasNul(out), false);
  assert.deepEqual(out, {
    document_id: 'd',
    client_event_id: 'e',
    summary: 'badtext',
    payload: { restoreAction: { annotation: { id: 'x' } }, list: [{ note: 'ab' }, 3, null] },
  });
  assert.equal(dirty.payload.restoreAction.annotation[LIVE_EDIT_FLAG], 'w\u00001\u0000x', 'input not mutated');
});

test('recordAndNotify shows and keeps the cleaned row', async () => {
  const events = [];
  const prevWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent: (e) => { events.push(e); return true; },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  globalThis.CustomEvent ??= class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  try {
    await recordAndNotifyDocumentHistoryEvent({
      document_id: 'doc-live-flag',
      client_event_id: 'evt-live-flag-1',
      event_type: 'annotation_deleted',
      payload: { restoreAction: { annotation: { id: 'r', [LIVE_EDIT_FLAG]: 'w\u00001\u0000r' } } },
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].detail.row.payload.restoreAction.annotation, { id: 'r' });
  } finally {
    globalThis.window = prevWindow;
  }
});

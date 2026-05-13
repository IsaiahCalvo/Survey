import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCalloutSyncFingerprint,
  normalizeCalloutsForSync,
} from '../src/utils/calloutSyncPayload.js';

const baseCallout = {
  id: 'callout-1',
  pageNumber: 1,
  arrowTip: { x: 0.1, y: 0.2 },
  knee: { x: 0.2, y: 0.3 },
  textBoxPosition: { x: 0.25, y: 0.3 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.08,
  text: 'Room note',
  style: { color: '#111', lineWidth: 2 },
  meta: { authorId: 'u1' },
};

test('callout sync fingerprint ignores transient selection fields', () => {
  const selected = [{ ...baseCallout, isSelected: true }];
  const deselected = [{ ...baseCallout, isSelected: false, hovered: true, __preview: { dx: 1 } }];

  assert.equal(getCalloutSyncFingerprint(selected), getCalloutSyncFingerprint(deselected));
});

test('callout sync fingerprint changes when persisted geometry changes', () => {
  const before = [{ ...baseCallout }];
  const after = [{ ...baseCallout, knee: { x: 0.31, y: 0.4 } }];

  assert.notEqual(getCalloutSyncFingerprint(before), getCalloutSyncFingerprint(after));
});

test('callout sync fingerprint ignores sub-pixel numeric jitter', () => {
  const before = [{ ...baseCallout, textBoxPosition: { x: 0.2500000001, y: 0.3 } }];
  const after = [{ ...baseCallout, textBoxPosition: { x: 0.2500000002, y: 0.3000000001 } }];

  assert.equal(getCalloutSyncFingerprint(before), getCalloutSyncFingerprint(after));
});

test('callout sync fingerprint ignores text cursor state', () => {
  const before = [{ ...baseCallout, selectionStart: 2, selectionEnd: 2, cursor: { line: 0, column: 2 } }];
  const after = [{ ...baseCallout, selectionStart: 8, selectionEnd: 8, dirty: true }];

  assert.equal(getCalloutSyncFingerprint(before), getCalloutSyncFingerprint(after));
});

test('normalizeCalloutsForSync returns stable id ordering for equivalent payloads', () => {
  const a = { ...baseCallout, id: 'a' };
  const b = { ...baseCallout, id: 'b' };

  assert.deepEqual(
    normalizeCalloutsForSync([b, a]).map((c) => c.id),
    ['a', 'b'],
  );
  assert.equal(getCalloutSyncFingerprint([b, a]), getCalloutSyncFingerprint([a, b]));
});

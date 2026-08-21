import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickActiveClipboard,
  resolveSelectedCalloutId,
} from '../src/utils/pickActiveClipboard.js';

test('empty clipboards → null (Paste stays gray / no-op)', () => {
  assert.equal(pickActiveClipboard({}), null);
  assert.equal(pickActiveClipboard({ clipboardAnnotation: null, clipboardCallout: null }), null);
});

test('shape-only clipboard → annotation (rect/ellipse/pen/text keep working)', () => {
  assert.equal(pickActiveClipboard({
    clipboardAnnotation: { object: { type: 'rect' }, mode: 'copy' },
  }), 'annotation');
});

test('callout-only clipboard → callout', () => {
  assert.equal(pickActiveClipboard({
    clipboardCallout: { id: 'callout-1', text: 'xp-call' },
  }), 'callout');
});

test('copy shape THEN copy callout → callout (lastKind)', () => {
  assert.equal(pickActiveClipboard({
    clipboardAnnotation: { object: { type: 'rect' }, mode: 'copy' },
    clipboardCallout: { id: 'callout-1' },
    lastKind: 'callout',
  }), 'callout');
});

test('copy callout THEN copy rect → annotation (lastKind)', () => {
  assert.equal(pickActiveClipboard({
    clipboardAnnotation: { object: { type: 'rect' }, mode: 'copy' },
    clipboardCallout: { id: 'callout-1' },
    lastKind: 'annotation',
  }), 'annotation');
});

test('both populated, newer callout copiedAt wins without lastKind', () => {
  assert.equal(pickActiveClipboard({
    clipboardAnnotation: { object: { type: 'rect' }, copiedAt: 10 },
    clipboardCallout: { id: 'callout-1', copiedAt: 20 },
  }), 'callout');
});

test('both populated, newer shape copiedAt wins without lastKind', () => {
  assert.equal(pickActiveClipboard({
    clipboardAnnotation: { object: { type: 'rect' }, copiedAt: 30 },
    clipboardCallout: { id: 'callout-1', copiedAt: 20 },
  }), 'annotation');
});

test('both populated, no recency signal → callout (do not prefer leftover shape)', () => {
  assert.equal(pickActiveClipboard({
    clipboardAnnotation: { object: { type: 'rect' }, mode: 'copy' },
    clipboardCallout: { id: 'callout-1' },
  }), 'callout');
});

test('resolveSelectedCalloutId reads the live SVG set when the PAL cell is null', () => {
  assert.equal(resolveSelectedCalloutId(null, null), null);
  assert.equal(resolveSelectedCalloutId('legacy-id', new Set(['live-a'])), 'legacy-id');
  assert.equal(resolveSelectedCalloutId(null, new Set(['live-a'])), 'live-a');
  assert.equal(resolveSelectedCalloutId(null, new Set(['first', 'second'])), 'second');
  assert.equal(resolveSelectedCalloutId(null, ['arr-a', 'arr-b']), 'arr-b');
});

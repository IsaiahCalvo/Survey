import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectLocalInteractionIds,
  isLocallyInteractingWith,
} from '../src/components/collab/remoteDeleteInteraction.js';

const providerSrc = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/collab/YDocProvider.jsx'),
  'utf8',
);

test('P1-30/P2-16 intended: Phase-29 selectedId gates the toast', () => {
  const windowLike = {
    __phase29InteractionState: { selectedId: 'anno-1', draggingId: null },
  };
  assert.equal(isLocallyInteractingWith('anno-1', windowLike), true);
  assert.deepEqual([...collectLocalInteractionIds(windowLike)], ['anno-1']);
});

test('P1-30/P2-16 intended: live SVG selection mirror also gates the toast', () => {
  const windowLike = { __selectedAnnotationIds: ['anno-2'] };
  assert.equal(isLocallyInteractingWith('anno-2', windowLike), true);
});

test('P1-30/P2-16 intended: selected SVG node (cursor:move) also gates the toast', () => {
  const windowLike = {
    document: {
      querySelectorAll: () => [
        { style: { cursor: 'move' }, getAttribute: () => 'anno-3' },
        { style: { cursor: 'pointer' }, getAttribute: () => 'anno-4' },
      ],
    },
  };
  assert.equal(isLocallyInteractingWith('anno-3', windowLike), true);
  assert.equal(isLocallyInteractingWith('anno-4', windowLike), false);
});

test('P1-30/P2-16 break: no binding means silent apply, not a toast', () => {
  assert.equal(isLocallyInteractingWith('anno-1', {}), false);
  assert.equal(isLocallyInteractingWith('anno-1', { __phase29InteractionState: {} }), false);
  assert.equal(isLocallyInteractingWith('anno-1', null), false);
});

test('P1-30/P2-16 break: a different selected id does not match', () => {
  const windowLike = {
    __phase29InteractionState: { selectedId: 'anno-other' },
    __selectedAnnotationIds: ['also-other'],
  };
  assert.equal(isLocallyInteractingWith('anno-1', windowLike), false);
});

test('P1-30/P2-16 edge: empty / missing annoId never matches', () => {
  const windowLike = { __phase29InteractionState: { selectedId: 'anno-1' } };
  assert.equal(isLocallyInteractingWith('', windowLike), false);
  assert.equal(isLocallyInteractingWith(null, windowLike), false);
});

test('P1-30/P2-16 wiring: YDocProvider uses the live interaction helper', () => {
  assert.match(providerSrc, /isLocallyInteractingWith/);
  assert.doesNotMatch(
    providerSrc,
    /interactionState\.selectedId === annoId/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  applyCalloutCommit,
  applyCalloutDelete,
  materializeCalloutFromYMap,
} from '../src/lib/collab/crdtAnnotationBridge.js';

const origin = Object.freeze({
  source: 'local-fabric',
  userId: 'user-1',
  deviceId: 'device-1',
  sessionId: 'session-1',
  clientID: 1,
});

const ctx = {
  userId: 'user-1',
  deviceId: 'device-1',
  sessionId: 'session-1',
  clientID: 1,
};

function makeCallout(overrides = {}) {
  return {
    id: 'callout-1',
    pageNumber: 3,
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.2, y: 0.3 },
    textBoxPosition: { x: 0.25, y: 0.3 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.08,
    text: 'Initial note',
    style: { color: '#111111', lineWidth: 2 },
    meta: { authorId: 'author-1' },
    ...overrides,
  };
}

test('creating a callout writes a materializable Y.Doc callout record', () => {
  const ydoc = new Y.Doc();
  const yMapCallouts = ydoc.getMap('callouts');

  applyCalloutCommit(ydoc, yMapCallouts, makeCallout(), origin, ctx);

  const calloutYMap = yMapCallouts.get('callout-1');
  assert.ok(calloutYMap);
  assert.equal(calloutYMap.get('type'), 'callout');
  assert.equal(calloutYMap.get('pageNumber'), 3);
  assert.equal(calloutYMap.get('meta').get('authorId'), 'author-1');

  const materialized = materializeCalloutFromYMap(calloutYMap, 'callout-1');
  assert.equal(materialized.id, 'callout-1');
  assert.equal(materialized.text, 'Initial note');
  assert.deepEqual(materialized.arrowTip, { x: 0.1, y: 0.2 });
});

test('editing a callout updates the same Y.Doc record and preserves author identity', () => {
  const ydoc = new Y.Doc();
  const yMapCallouts = ydoc.getMap('callouts');

  applyCalloutCommit(ydoc, yMapCallouts, makeCallout(), origin, ctx);
  applyCalloutCommit(
    ydoc,
    yMapCallouts,
    makeCallout({ text: 'Edited note', meta: { authorId: 'different-user' } }),
    origin,
    { ...ctx, userId: 'editor-1' },
  );

  assert.equal(yMapCallouts.size, 1);
  const calloutYMap = yMapCallouts.get('callout-1');
  assert.equal(calloutYMap.get('meta').get('authorId'), 'author-1');
  assert.equal(calloutYMap.get('meta').get('lastEditorId'), 'editor-1');
  assert.equal(materializeCalloutFromYMap(calloutYMap).text, 'Edited note');
});

test('deleting a callout removes it from the Y.Doc callouts map', () => {
  const ydoc = new Y.Doc();
  const yMapCallouts = ydoc.getMap('callouts');

  applyCalloutCommit(ydoc, yMapCallouts, makeCallout(), origin, ctx);
  applyCalloutDelete(ydoc, yMapCallouts, 'callout-1', origin);

  assert.equal(yMapCallouts.has('callout-1'), false);
});

test('reload materialization includes callouts from the Y.Doc callouts map', () => {
  const ydoc = new Y.Doc();
  const yMapCallouts = ydoc.getMap('callouts');

  applyCalloutCommit(ydoc, yMapCallouts, makeCallout({ id: 'callout-a', text: 'A' }), origin, ctx);
  applyCalloutCommit(ydoc, yMapCallouts, makeCallout({ id: 'callout-b', text: 'B', pageNumber: 4 }), origin, ctx);

  const materialized = [];
  yMapCallouts.forEach((calloutYMap, id) => {
    materialized.push(materializeCalloutFromYMap(calloutYMap, id));
  });

  assert.deepEqual(
    materialized
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((callout) => ({ id: callout.id, text: callout.text, pageNumber: callout.pageNumber })),
    [
      { id: 'callout-a', text: 'A', pageNumber: 3 },
      { id: 'callout-b', text: 'B', pageNumber: 4 },
    ],
  );
});

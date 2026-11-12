// "Pages with marks" in Export PDF and callouts (Linear KAL-537 study,
// "Callouts are omitted from the marked-page handler inputs"). The study fed
// the handler a callout list kept apart from the page marks and saw a
// callout-only page left out. In the app a callout is stored as a mark on its
// page (data.type 'callout', R2.2: the callout list is derived from the page
// marks), so the page marks the handler already passes include it. This pins
// that, so a callout-only page keeps counting as marked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesWithMarks } from '../src/utils/exportPdfModes.js';
import { deriveCalloutsFromByPage } from '../src/utils/calloutAnnotationBridge.js';
import { withoutHiddenLayers } from '../src/utils/layers.js';

const calloutMark = (id) => ({
  type: 'group', id,
  data: { type: 'callout', id, legacyCallout: { id, pageNumber: 3, text: 'Check this', box: { x: 10, y: 10, width: 80, height: 30 }, anchor: { x: 5, y: 5 } } },
});

test('a page whose only mark is a callout counts as marked', () => {
  const byPage = { 1: { objects: [] }, 3: { objects: [calloutMark('c1')] } };
  assert.equal(deriveCalloutsFromByPage(byPage).length, 1, 'the fixture is a real callout to the app');
  assert.deepEqual(pagesWithMarks({ annotationsByPage: byPage }), [3]);
  // The viewer filters hidden layers first; a callout on a shown layer stays.
  assert.deepEqual(pagesWithMarks({ annotationsByPage: withoutHiddenLayers(byPage, new Set(['other-layer'])) }), [3]);
});

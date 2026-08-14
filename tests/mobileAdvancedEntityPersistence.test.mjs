import assert from 'node:assert/strict';
import test from 'node:test';

import { assertAdvancedFinalPersistence } from '../agent-cli/mobile-annotations/advanced.mjs';

const storageKeys = Object.freeze({
  annotations: 'annotations',
  markers: 'markers',
  sidebar: 'sidebar',
  callouts: 'callouts',
});

function pageWithStorage(values) {
  return {
    evaluate: async (_callback, exactKeys) => Object.fromEntries(
      Object.entries(exactKeys).map(([name, key]) => [
        name,
        Object.hasOwn(values, key) ? JSON.stringify(values[key]) : null,
      ]),
    ),
  };
}

test('advanced final persistence resolves Survey Markers from their exact marker store', async () => {
  const page = pageWithStorage({
    markers: { 'marker-1': { annotationId: 'marker-1', bounds: { x: 1, y: 2, width: 3, height: 4 } } },
  });

  await assertAdvancedFinalPersistence(page, storageKeys, [{
    tool: 'survey-marker-advanced',
    baseTool: 'survey-marker',
    persistenceStore: 'markers',
    id: 'marker-1',
  }]);

  await assert.rejects(
    assertAdvancedFinalPersistence(page, storageKeys, [{
      tool: 'survey-marker-advanced',
      baseTool: 'survey-marker',
      persistenceStore: 'markers',
      id: 'missing-marker',
    }]),
    /exact-key marker snapshot lost missing-marker/,
  );
});

test('advanced final persistence resolves Regions from the owning Space sidebar store', async () => {
  const page = pageWithStorage({
    sidebar: {
      spaces: [{
        id: 'space-1',
        assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-1', coordinates: [1, 2, 3, 4] }] }],
      }],
    },
  });

  await assertAdvancedFinalPersistence(page, storageKeys, [{
    tool: 'region-advanced',
    baseTool: 'region',
    persistenceStore: 'sidebar',
    spaceId: 'space-1',
    id: 'region-1',
  }]);

  await assert.rejects(
    assertAdvancedFinalPersistence(page, storageKeys, [{
      tool: 'region-advanced',
      baseTool: 'region',
      persistenceStore: 'sidebar',
      spaceId: 'wrong-space',
      id: 'region-1',
    }]),
    /exact-key sidebar snapshot lost region-1/,
  );
});

import test from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert/strict';

import {
  resolveHistoryEntryContext,
  findSpaceIdForRegion,
} from '../src/utils/historyContextRestore.js';

// Decision 10 (KAL-90): clicking a history entry restores the exact context —
// page (panel), survey/region mode (space), and selected template/module/category.

const SPACES = [
  {
    id: 'space-1',
    name: 'Space 1',
    assignedPages: [
      { pageId: 1, regions: [{ regionId: 'region-1' }] },
      { pageId: 2, regions: [{ regionId: 'region-2' }] },
    ],
  },
  { id: 'space-2', name: 'Space 2', assignedPages: [{ pageId: 3, regions: [{ regionId: 'region-3' }] }] },
];

test('findSpaceIdForRegion maps a regionId to its owning space', () => {
  strictEqual(findSpaceIdForRegion(SPACES, 'region-2'), 'space-1');
  strictEqual(findSpaceIdForRegion(SPACES, 'region-3'), 'space-2');
  strictEqual(findSpaceIdForRegion(SPACES, 'region-nope'), null);
  strictEqual(findSpaceIdForRegion([], 'region-1'), null);
  strictEqual(findSpaceIdForRegion(SPACES, null), null);
});

test('stamped uiContext is authoritative: space + survey mode + module + category', () => {
  const event = {
    payload: {
      uiContext: {
        spaceId: 'space-2',
        selectedSpaceId: 'space-2',
        surveyPanelOpen: true,
        templateId: 'tpl-9',
        moduleId: 'mod-4',
        categoryId: 'cat-7',
      },
    },
  };
  deepStrictEqual(resolveHistoryEntryContext(event, { spaces: SPACES }), {
    hasSpaceTarget: true,
    spaceId: 'space-2',
    hasSurveyPanel: true,
    surveyPanelOpen: true,
    hasTemplate: true,
    templateId: 'tpl-9',
    hasModule: true,
    moduleId: 'mod-4',
    hasCategory: true,
    categoryId: 'cat-7',
  });
});

test('stamped uiContext with explicit null spaceId means "exit space mode"', () => {
  const resolved = resolveHistoryEntryContext(
    { payload: { uiContext: { spaceId: null, surveyPanelOpen: false } } },
    { spaces: SPACES },
  );
  strictEqual(resolved.hasSpaceTarget, true);
  strictEqual(resolved.spaceId, null);
  strictEqual(resolved.hasSurveyPanel, true);
  strictEqual(resolved.surveyPanelOpen, false);
});

test('legacy survey-marker delete row: context derived from restoreAction.surveyMarker', () => {
  const event = {
    payload: {
      restoreAction: {
        type: 'surveyMarker',
        markerId: 'm-1',
        pageNumber: 2,
        surveyMarker: {
          pageNumber: 2,
          spaceId: 'space-1',
          regionId: 'region-2',
          moduleId: 'mod-1',
          categoryId: 'cat-1',
        },
      },
    },
  };
  const resolved = resolveHistoryEntryContext(event, { spaces: SPACES });
  strictEqual(resolved.hasSpaceTarget, true);
  strictEqual(resolved.spaceId, 'space-1');
  strictEqual(resolved.surveyPanelOpen, true, 'a survey-marker row implies survey mode');
  strictEqual(resolved.moduleId, 'mod-1');
  strictEqual(resolved.categoryId, 'cat-1');
});

test('legacy row without marker spaceId falls back to regionId → owning space', () => {
  const event = {
    payload: {
      previewAnnotation: { regionId: 'region-3', moduleId: 'mod-2' },
    },
  };
  const resolved = resolveHistoryEntryContext(event, { spaces: SPACES });
  strictEqual(resolved.hasSpaceTarget, true);
  strictEqual(resolved.spaceId, 'space-2');
  strictEqual(resolved.hasModule, true);
  strictEqual(resolved.moduleId, 'mod-2');
});

test('legacy checkpoint row: selectedCategoryId from checkpoint context', () => {
  const event = {
    payload: {
      context: { pageNumber: 1, selectedCategoryId: 'cat-cam' },
    },
  };
  const resolved = resolveHistoryEntryContext(event, { spaces: SPACES });
  strictEqual(resolved.hasCategory, true);
  strictEqual(resolved.categoryId, 'cat-cam');
  strictEqual(resolved.hasSpaceTarget, undefined, 'no space info at all — leave space mode alone');
});

test('rows with no restorable context resolve to null (page-jump-only fallback)', () => {
  strictEqual(resolveHistoryEntryContext({ payload: {} }, { spaces: SPACES }), null);
  strictEqual(resolveHistoryEntryContext(null, { spaces: SPACES }), null);
  strictEqual(resolveHistoryEntryContext({ payload: { context: { pageNumber: 3 } } }, { spaces: SPACES }), null);
});

test('uiContext survives documentHistoryService payload trimming', async () => {
  const { buildHistoryEventRowFromDebugEvent } = await import('../src/services/documentHistoryService.js');
  const bigBlob = 'x'.repeat(20000); // force the trim branch (MAX_PAYLOAD_CHARS = 12000)
  const event = {
    type: 'checkpoint_added',
    order: 42,
    pageNumber: 2,
    reason: 'highlight:create',
    uiContext: { spaceId: 'space-1', surveyPanelOpen: true, moduleId: 'mod-1', categoryId: 'cat-1' },
    hugeField: bigBlob,
  };
  const row = buildHistoryEventRowFromDebugEvent(event, {
    documentId: 'doc-1',
    user: { id: 'user-1', email: 'test@example.com' },
  });
  strictEqual(row.payload.truncated, true, 'payload should have been trimmed');
  deepStrictEqual(row.payload.uiContext, event.uiContext, 'uiContext must survive trimming');
});

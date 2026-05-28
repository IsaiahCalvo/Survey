import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldRunSurveyMarkerSync } from '../surveyMarkerSyncSafety.js';

test('blocks empty survey-marker sync while cloud hydration is still pending', () => {
  const decision = shouldRunSurveyMarkerSync({
    documentSyncEnabled: true,
    hasDocumentId: true,
    hasUserId: true,
    syncBlocked: false,
    currentCount: 0,
    priorCount: 2,
    hydrationReady: false,
  });

  assert.equal(decision.run, false);
  assert.equal(decision.reason, 'hydrate-empty-delete-guard');
});

test('allows real survey-marker deletes after hydration is ready', () => {
  const decision = shouldRunSurveyMarkerSync({
    documentSyncEnabled: true,
    hasDocumentId: true,
    hasUserId: true,
    syncBlocked: false,
    currentCount: 0,
    priorCount: 2,
    hydrationReady: true,
  });

  assert.equal(decision.run, true);
});

test('App survey marker sync is protected from pending-hydration empty deletes', () => {
  const appSource = readFileSync(resolve('src/App.jsx'), 'utf8');
  const decisionIndex = appSource.indexOf('shouldRunSurveyMarkerSync({');
  const syncIndex = appSource.indexOf('syncAnnotationsToSupabase(documentId, user.id, surveyMarkers, {');

  assert.notEqual(decisionIndex, -1);
  assert.notEqual(syncIndex, -1);
  assert.ok(decisionIndex < syncIndex);
  assert.match(appSource, /hydrationReady:\s*surveyAnnotationHydration\?\.ready === true/);
  assert.match(appSource, /survey-marker sync skipped unsafe hydrate-empty delete/);
});

test('Locate preserves the survey sub-toolbar while selecting a marker', () => {
  const appSource = readFileSync(resolve('src/App.jsx'), 'utf8');

  assert.match(appSource, /setActiveTool\('select'\);\s*setActiveCategoryDropdown\('survey'\);/);
  assert.match(appSource, /!\(showSurveyPanel && activeCategoryDropdown === 'survey'\)/);
});

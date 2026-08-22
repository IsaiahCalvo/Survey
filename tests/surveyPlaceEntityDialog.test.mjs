import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Place-time Entity dialog leftover after rail Entity picker.
// Live proof: debug/scenarios/e2e-survey-place-entity-dialog.spec.mjs
// Not rail survey-marker-entity-trigger. Not Jump / Set location.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('place-time Entity dialog opens only when the template has entities', () => {
  const viewer = read('src/PDFViewer.jsx');
  const dialogStart = viewer.indexOf('{/* Entity Selection Dialog */}');
  const dialogEnd = viewer.indexOf('{/* Name Prompt Modal', dialogStart);
  assert.ok(dialogStart > 0, 'Entity Selection Dialog marker');
  assert.ok(dialogEnd > dialogStart, 'Name Prompt follows Entity dialog');
  const dialog = viewer.slice(dialogStart, dialogEnd);

  assert.match(dialog, /pendingEntitySelection && selectedTemplate && selectedModuleId/);
  assert.match(dialog, /Select the entity responsible for this highlight:/);
  assert.match(dialog, /entities\.map\(entity =>/);
  assert.match(dialog, /entityId: entity\.id/);
  assert.match(dialog, /entityName: entity\.name/);
  assert.match(dialog, /entityColor: entityColor/);
  assert.match(dialog, /Cancel - proceed without entity selection/);
  assert.doesNotMatch(dialog, /\{ id: '', name: 'None'/);
  assert.doesNotMatch(dialog, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(dialog, /data-counter-nubbin-handle/);

  const create = viewer.slice(
    viewer.indexOf('// If a category is already selected, show Entity dialog first'),
    viewer.indexOf('if (!surveyKeepCategoryActive)'),
  );
  assert.match(create, /else if \(entities\.length > 0\) \{/);
  assert.match(create, /setPendingEntitySelection\(\{/);
  assert.match(create, /\/\/ No Entities, go directly to name prompt/);
  assert.match(create, /setPendingSurveyMarkerName\(\{/);
  assert.match(create, /commitMobileSurveyMarker\(\{/);
});

test('mobile place skips the desktop Entity dialog; zero-entity templates skip it', () => {
  const viewer = read('src/PDFViewer.jsx');
  const create = viewer.slice(
    viewer.indexOf('const handleSurveyMarkerCreated = useCallback'),
    viewer.indexOf('if (!surveyKeepCategoryActive)'),
  );
  assert.match(create, /if \(mobileMode\) \{/);
  assert.match(create, /commitMobileSurveyMarker\(/);
  assert.match(create, /\/\/ Show Entity selection dialog/);
  assert.match(create, /else if \(entities\.length > 0\) \{/);

  const category = viewer.slice(
    viewer.indexOf('// Check if template has Entities'),
    viewer.indexOf('// Clear pending surveyMarker modal'),
  );
  assert.match(category, /else if \(entities\.length > 0\) \{/);
  assert.match(category, /setPendingEntitySelection\(\{/);
  assert.match(category, /\/\/ No Entities, go directly to name prompt/);
});

test('Survey Entities Template seeds local entities; KAL-436 stays empty', () => {
  const route = read('src/DevTestRoute.jsx');
  assert.match(route, /name: 'KAL-436 Preservation Template'/);
  assert.match(route, /name: 'Survey Entities Template'/);
  assert.match(route, /id: 'kal436-entity-gc'/);
  assert.match(route, /id: 'kal436-entity-sub'/);
  assert.match(route, /id: 'kal436-entity-complete'/);
  const kal436 = route.slice(
    route.indexOf("id: 'kal436-template'"),
    route.indexOf("id: 'kal436-entities-template'"),
  );
  assert.doesNotMatch(kal436, /entities:/);
  assert.match(route, /KAL-436 stays entity-less so existing place-marker E2E still skip the/);
});

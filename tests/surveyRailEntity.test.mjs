import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-rail Entity leftover after Jump / Set location.
// Live proof: debug/scenarios/e2e-survey-rail-entity.spec.mjs
// Not Jump, not Create category, not category Delete, not item Delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Entity trigger is a single-select listbox with None clear', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /className="survey-marker-entity-trigger"/);
  assert.match(rail, /aria-label="Entity"/);
  assert.match(rail, /applyEntitySelectionForMarker\(annotationId, selectedModuleId, category, entityId\)/);
  const picker = rail.slice(
    rail.indexOf('{/* Entity selector */}'),
    rail.indexOf('{/* Expanded checklist items'),
  );
  assert.match(picker, /\{ id: '', name: 'None', color: null \}/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /role="option"/);
  assert.match(picker, /handleEntitySelection\(optionValue\)/);
  assert.match(picker, /setOpenEntityDropdownId\(null\)/);
  assert.doesNotMatch(picker, /multiple/);
  assert.doesNotMatch(picker, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(picker, /data-counter-nubbin-handle/);
});

test('applyEntitySelectionForMarker writes entity fields, clears on empty, and checkpoints', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const helperStart = rail.indexOf('const applyEntitySelectionForMarker = (annotationId, markerModuleId, category, entityId) => {');
  assert.ok(helperStart > 0, 'applyEntitySelectionForMarker');
  const helper = rail.slice(helperStart, rail.indexOf('const applyChecklistResponseSelection'));
  assert.match(helper, /entityId: entity\?\.id/);
  assert.match(helper, /entityName: entity\?\.name/);
  assert.match(helper, /entityColor: entity\?\.color/);
  assert.match(helper, /entityId: entity \? entity\.id : undefined/);
  assert.match(helper, /if \(previousEntityId === nextEntityId\) return;/);
  assert.match(helper, /addHistoryCheckpoint\('survey-marker:entity'/);
  assert.doesNotMatch(helper, /data-handle=\{`vertex-\$\{/);
});

test('390 detail uses the same helper; KAL-436 fixture stays empty and Entities template seeds local entities', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const mobile = rail.slice(
    rail.indexOf('aria-label="Choose Survey Marker entity"'),
    rail.indexOf('aria-label="Jump to this Survey Marker"'),
  );
  assert.match(mobile, /setMobileDetailDropdown\(prev => \(prev === 'entity' \? null : 'entity'\)\)/);
  assert.match(rail, /applyEntitySelectionForMarker\(annotationId, detailModuleId, detailCategory, option\.id\)/);
  assert.match(rail, /className="mobile-survey-detail-menu mobile-survey-detail-entity-menu" role="listbox" aria-label="Entity"/);

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
});

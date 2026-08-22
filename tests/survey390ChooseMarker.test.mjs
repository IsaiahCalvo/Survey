import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// 390 detail Choose Survey Marker sibling switcher leftover after
// Choose survey template re-pick.
// Live proof: debug/scenarios/e2e-survey-390-choose-marker.spec.mjs
// Distinct from Entity ("Choose Survey Marker entity"). Not checklist.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('390 detail Choose Survey Marker lists same-category siblings and switches expanded id', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const detail = rail.slice(
    rail.indexOf('const siblingMarkers = Object.entries(surveyMarkers)'),
    rail.indexOf('aria-label="Jump to this Survey Marker"'),
  );
  assert.match(detail, /aria-label="Choose Survey Marker"/);
  assert.match(detail, /aria-label="Survey Markers in this category"/);
  assert.match(detail, /canSwitchSibling = siblingMarkers.length > 1/);
  assert.match(detail, /marker.moduleId === detailModuleId && marker.categoryId === mobileDetailMarker.categoryId/);
  assert.match(detail, /setExpandedSurveyMarkers\(\{ \[sibling.id\]: true \}\)/);
  assert.match(detail, /if \(sibling.id !== annotationId\)/);
  assert.doesNotMatch(detail, /applyChecklistResponseSelection/);
  assert.doesNotMatch(detail, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(detail, /data-counter-nubbin-handle/);
  assert.equal(
    (detail.match(/aria-label="Choose Survey Marker"/g) || []).length,
    1,
    'sibling switcher is not the Entity swatch',
  );
  assert.match(rail, /aria-label="Choose Survey Marker entity"/);
});

test('one sibling disables the switcher; Escape / outside cancel the list', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const detail = rail.slice(
    rail.indexOf('const siblingMarkers = Object.entries(surveyMarkers)'),
    rail.indexOf('aria-label="Jump to this Survey Marker"'),
  );
  assert.match(detail, /aria-disabled=\{!canSwitchSibling\}/);
  assert.match(detail, /disabled=\{!canSwitchSibling\}/);
  assert.match(detail, /if \(!canSwitchSibling\) return;/);
  assert.match(detail, /canSwitchSibling && mobileDetailDropdown === 'markerItem'/);

  const effect = rail.slice(
    rail.indexOf('Outside-tap / Escape close the detail view'),
    rail.indexOf('if (typeof onCollapseChange === \'function\')'),
  );
  assert.match(effect, /setMobileDetailDropdown\(null\)/);
  assert.match(effect, /event.key !== 'Escape'/);
  assert.match(effect, /addEventListener\('keydown', handleKeyDown, true\)/);
  assert.match(effect, /stopPropagation\(\)/);
  assert.doesNotMatch(effect, /addHistoryCheckpoint\(/);
});

test('390 Jump stays on the current detail marker; leftover-18 unplaced-rows are not this leftover', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const jump = rail.slice(
    rail.indexOf('aria-label="Jump to this Survey Marker"'),
    rail.indexOf('aria-label={hasNoteText ? \'Edit Survey Marker notes\''),
  );
  assert.match(jump, /locateOrSetSurveyMarker\(mobileDetailMarker\)/);
  assert.doesNotMatch(jump, /setCopyModeActive\(true\)/);

  const unplaced = rail.slice(
    rail.indexOf('{/* KAL-292 — rows the linked Excel sent'),
    rail.indexOf('{/* Panel Content */}'),
  );
  assert.match(unplaced, /ExcelUnplacedRows/);
  assert.match(unplaced, /surveyUnplacedRows/);
  assert.doesNotMatch(unplaced, /aria-label="Choose Survey Marker"/);
});

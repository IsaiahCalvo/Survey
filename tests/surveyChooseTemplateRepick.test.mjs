import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Choose survey template re-pick leftover after Excel actions fail-closed.
// Live proof: debug/scenarios/e2e-survey-choose-template-repick.spec.mjs
// Distinct from first-entry KAL-436 pick. Not leftover-18 unplaced-rows.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('in-session Choose survey template exists on desktop and mobile after a template is selected', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const header = rail.slice(
    rail.indexOf('Template title lives below the rail tabs'),
    rail.indexOf('mobile-survey-sheet-header-actions'),
  );
  assert.match(header, /aria-label="Choose survey template"/);
  assert.match(header, /ref=\{templateSelectorRef\}/);
  assert.match(header, /pickSurveyTemplate\(template\)/);
  assert.equal(
    (header.match(/aria-label="Choose survey template"/g) || []).length,
    3,
    'desktop button + mobile button + listbox',
  );
  assert.match(header, /className="mobile-survey-template-button"/);
  assert.match(header, /No templates available/);
  assert.doesNotMatch(header, /mobileMode \? templateSelectorRef/);
  assert.doesNotMatch(header, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(header, /data-counter-nubbin-handle/);
});

test('same-template re-pick is a no-op; Escape / click-outside cancel the picker', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const pickStart = rail.indexOf('const pickSurveyTemplate = (template) => {');
  assert.ok(pickStart > 0, 'pickSurveyTemplate');
  const pick = rail.slice(pickStart, rail.indexOf('const surveyModuleOptions'));
  assert.match(pick, /setIsTemplateSelectorOpen\(false\)/);
  assert.match(pick, /if \(!template \|\| template\.id === selectedTemplate\?\.id\) return;/);
  assert.match(pick, /onSelectSurveyTemplate\?\.\(template\)/);

  const effect = rail.slice(
    rail.indexOf('if (!isTemplateSelectorOpen) return undefined;'),
    rail.indexOf('if (!isMobileExportMenuOpen) return undefined;'),
  );
  assert.match(effect, /templateSelectorRef\.current\?\.contains\(event\.target\)/);
  assert.match(effect, /setIsTemplateSelectorOpen\(false\)/);
  assert.match(effect, /event\.key !== 'Escape'/);
  assert.match(effect, /addEventListener\('keydown', handleKeyDown, true\)/);
  assert.doesNotMatch(effect, /addHistoryCheckpoint\(/);
});

test('first-entry empty picker stays compiled-in; templates are local seeds not leftover-18 import', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const firstEntry = rail.slice(
    rail.indexOf('Choose survey template'),
    rail.indexOf('{/* Microsoft Reconnect Banner */}'),
  );
  assert.match(firstEntry, /availableSurveyTemplates\.length === 0/);
  assert.match(firstEntry, /No templates available/);
  assert.match(firstEntry, /onSelectSurveyTemplate\?\.\(template\)/);

  const route = read('src/DevTestRoute.jsx');
  assert.match(route, /name: 'KAL-436 Preservation Template'/);
  assert.match(route, /name: 'Survey Entities Template'/);
  assert.match(route, /name: 'Two Category Template'/);
  assert.match(route, /name: 'Empty Module Template'/);
  assert.doesNotMatch(route, /checklistItems:/);
  assert.doesNotMatch(firstEntry, /setCopyModeActive\(true\)/);

  const viewer = read('src/PDFViewer.jsx');
  const select = viewer.slice(
    viewer.indexOf('const handleSelectSurveyTemplate = useCallback'),
    viewer.indexOf('// Restore scroll position when PDF loads'),
  );
  assert.match(select, /setSelectedTemplate\(template\)/);
  assert.match(select, /setSelectedCategoryId\(null\)/);
  assert.doesNotMatch(select, /addHistoryCheckpoint\(/);
  assert.doesNotMatch(select, /setSurveyMarkers\(/);
});

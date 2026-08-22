import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSurveyKeepAfterPlace,
  resolveSurveyKeepChromeVisible,
  resolveSurveyKeepOnModuleChange,
} from '../src/utils/surveyKeepActive.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Keep active after-place keeps the category only when the flag is on', () => {
  assert.deepEqual(
    resolveSurveyKeepAfterPlace({ keepCategoryActive: true, mobileMode: false }),
    { clearCategory: false, nextTool: 'survey-marker' },
  );
  assert.deepEqual(
    resolveSurveyKeepAfterPlace({ keepCategoryActive: true, mobileMode: true }),
    { clearCategory: false, nextTool: 'survey-marker' },
  );
  assert.deepEqual(
    resolveSurveyKeepAfterPlace({ keepCategoryActive: false, mobileMode: false }),
    { clearCategory: true, nextTool: 'survey-marker' },
  );
  assert.deepEqual(
    resolveSurveyKeepAfterPlace({ keepCategoryActive: false, mobileMode: true }),
    { clearCategory: true, nextTool: 'pan' },
  );
});

test('Next module always clears the category; Keep active itself stays', () => {
  assert.deepEqual(
    resolveSurveyKeepOnModuleChange({ keepCategoryActive: true }),
    { clearCategory: true, keepCategoryActive: true, nextTool: 'survey-marker' },
  );
  assert.deepEqual(
    resolveSurveyKeepOnModuleChange({ keepCategoryActive: false }),
    { clearCategory: true, keepCategoryActive: false, nextTool: 'survey-marker' },
  );
});

test('Keep active chrome is hidden while Pen is armed', () => {
  assert.equal(
    resolveSurveyKeepChromeVisible({
      surface: 'desktop',
      activeCategoryDropdown: 'survey',
      activeTool: 'survey-marker',
    }),
    true,
  );
  assert.equal(
    resolveSurveyKeepChromeVisible({
      surface: 'desktop',
      activeCategoryDropdown: 'draw',
      activeTool: 'pen',
    }),
    false,
  );
  assert.equal(
    resolveSurveyKeepChromeVisible({
      surface: 'mobile',
      showSurveyPanel: true,
      activeTool: 'survey-marker',
    }),
    true,
  );
  assert.equal(
    resolveSurveyKeepChromeVisible({
      surface: 'mobile',
      showSurveyPanel: true,
      activeTool: 'pen',
    }),
    false,
  );
});

test('PDFViewer + rail + 390 chrome wire the Keep-active rules; notes chrome exists', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(!surveyKeepCategoryActive\)/);
  assert.match(viewer, /setSelectedCategoryId\(null\)/);
  assert.match(viewer, /if \(mobileMode\) setActiveTool\('pan'\)/);
  assert.match(viewer, /Keep active/);
  assert.match(viewer, /checked=\{surveyKeepCategoryActive\}/);
  assert.match(viewer, /placeholder="Enter your notes\.\.\."/);
  assert.match(viewer, /setNoteDialogOpen\(null\)/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /setSelectedCategoryId\(null\)/);
  assert.match(rail, /aria-label=\{surveyMarkers\[annotationId\]\?\.note\?\.text \? "Edit item notes" : "Add item notes"\}/);
  assert.match(rail, /aria-label=\{hasNoteText \? 'Edit Survey Marker notes' : 'Add Survey Marker notes'\}/);
  assert.match(rail, /setMobileNotesEditorOpen\(false\)/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /Keep active/);
  assert.match(mobile, /role="checkbox"/);
  assert.match(mobile, /survey\.onKeepCategoryActiveChange/);
  assert.match(mobile, /\['survey-marker', 'pan', 'select'\]\.includes\(api\.activeTool\)/);
});

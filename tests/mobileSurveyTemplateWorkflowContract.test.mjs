import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DEV_ROUTE = fs.readFileSync(new URL('../src/DevTestRoute.jsx', import.meta.url), 'utf8');
const WORKFLOW = fs.readFileSync(new URL('../agent-cli/mobile-workflows/survey-template.mjs', import.meta.url), 'utf8');
const DESKTOP_WORKFLOW = fs.readFileSync(new URL('../agent-cli/mobile-workflows/survey-template-desktop.mjs', import.meta.url), 'utf8');
const EDITOR = fs.readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');

test('dev viewer can hydrate the exact template model created by the mobile workflow', () => {
  assert.match(DEV_ROUTE, /surveyTemplateWorkflowE2E/);
  assert.match(DEV_ROUTE, /mobileWorkflowTemplates/);
  assert.match(DEV_ROUTE, /window\.__surveyTransitionE2ETemplates\s*=\s*readSurveyTemplateWorkflowTemplates\(\)/);
});

test('mobile survey-template workflow covers persisted nested CRUD and viewer marker cleanup', () => {
  for (const phrase of [
    'New template',
    'Add module',
    'Add category',
    'Add checklist item',
    'Survey Marker Delete',
    'page.reload',
    'localStorage.getItem',
  ]) assert.match(WORKFLOW, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(WORKFLOW, /deviceScaleFactor|trusted|touch/);
  assert.match(
    WORKFLOW,
    /replace\('tab=templates', 'tab=documents'\)[\s\S]{0,300}heading[^\n]*Documents[\s\S]{0,180}waitFor[\s\S]{0,280}test\.pdf[\s\S]{0,240}waitFor/,
    'survey setup must use the stable Documents route and wait for the exact fixture before tapping',
  );
});

test('module rename input is not nested in a disabled drag control', () => {
  assert.match(EDITOR, /\{\.\.\.\(!isRenaming \? attributes : \{\}\)\}/);
  assert.match(EDITOR, /\{\.\.\.\(!isRenaming \? listeners : \{\}\)\}/);
});

test('mobile template list rows omit the decorative clipboard icon', () => {
  assert.doesNotMatch(EDITOR, /templates-mobile-glyph/);
});

test('desktop and mobile category rows share the same disclosure glyph', () => {
  assert.match(EDITOR, /const CategoryDisclosureGlyph = \(\) =>/);
  assert.equal((EDITOR.match(/<CategoryDisclosureGlyph \/>/g) || []).length, 2);
  assert.doesNotMatch(EDITOR, /templates-mobile-category-toggle[\s\S]{0,500}<Icon name="arrow-r"/);
});

test('desktop category deletion uses its rendered selection control instead of screen coordinates', () => {
  assert.match(DESKTOP_WORKFLOW, /locator\(':scope > span'\)\.last\(\)/);
  assert.match(DESKTOP_WORKFLOW, /!button\.disabled/);
  assert.doesNotMatch(DESKTOP_WORKFLOW, /headerBox\.x/);
});

test('phone survey-template workflow tracks the current viewer chrome', () => {
  // The rail's select tool is named after its mode ("Rectangle Select").
  assert.doesNotMatch(WORKFLOW, /getByRole\('button', \{ name: 'Select', exact: true \}\), 'Select (tool|marker)/);
  assert.match(WORKFLOW, /VIEWER_SELECT_TOOL_NAME = \/\^\(\?:\(\?:Rectangle\|Lasso\|Text\) \)\?Select\$\//);
  // No "Collapse Survey panel" chevron; the category is armed from the rail by aria-pressed.
  assert.doesNotMatch(WORKFLOW, /Collapse Survey panel/);
  assert.match(WORKFLOW, /\[aria-pressed="true"\]/);
  // No floating Delete chip: delete a marker from the long-press menu.
  assert.match(WORKFLOW, /touch\.longPress\(/);
  assert.match(WORKFLOW, /data-annotation-context-menu/);
});

test('phone survey-template e2e is hermetic (loopback only)', () => {
  const RUNNER = fs.readFileSync(new URL('../agent-cli/mobile-workflows/survey-template-e2e.mjs', import.meta.url), 'utf8');
  assert.match(RUNNER, /guardContext\(browser\.newContext\(/);
  assert.match(RUNNER, /assertNoBrowserErrors\(\{ ignore: \/net::ERR_BLOCKED_BY_CLIENT\/ \}\)/);
});

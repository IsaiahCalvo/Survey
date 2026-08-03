import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DEV_ROUTE = fs.readFileSync(new URL('../src/DevTestRoute.jsx', import.meta.url), 'utf8');
const WORKFLOW = fs.readFileSync(new URL('../agent-cli/mobile-workflows/survey-template.mjs', import.meta.url), 'utf8');
const EDITOR = fs.readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');

test('dev viewer can hydrate the exact template model created by the mobile workflow', () => {
  assert.match(DEV_ROUTE, /surveyTemplateWorkflowE2E/);
  assert.match(DEV_ROUTE, /mobileWorkflowTemplates/);
  assert.match(DEV_ROUTE, /window\.__surveyTransitionE2ETemplates\s*=\s*readSurveyTemplateWorkflowTemplates\(\)/);
});

test('mobile survey-template workflow covers persisted nested CRUD and viewer marker cleanup', () => {
  for (const phrase of [
    'New template',
    'New module',
    'New category',
    'Add checklist item',
    'Delete Survey Marker',
    'page.reload',
    'localStorage.getItem',
  ]) assert.match(WORKFLOW, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(WORKFLOW, /deviceScaleFactor|trusted|touch/);
});

test('module rename input is not nested in a disabled drag control', () => {
  assert.match(EDITOR, /\{\.\.\.\(!isRenaming \? attributes : \{\}\)\}/);
  assert.match(EDITOR, /\{\.\.\.\(!isRenaming \? listeners : \{\}\)\}/);
});

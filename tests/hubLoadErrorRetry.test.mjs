import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-load-error-retry.spec.mjs
// Unique leftover after Documents Select All / None / Done:
// Hub load-error Try again. Distinct from empty=1 Upload leftover-18,
// hubLoading skeletons, Select All, Share Access, extras, Lock, Open file.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('HubLoadError Try again is local onRetry for documents / projects / templates', () => {
  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /const HubLoadError = \(\{ tabName, error, onRetry \}\) => \(/);
  assert.match(hub, /Couldn&apos;t load \{tabName\}\. Check your connection and try again\./);
  assert.match(hub, />Try again<\/button>/);
  assert.match(hub, /onClick=\{\(\) => \{ void Promise\.resolve\(onRetry\?\.\(\)\)\.catch\(\(\) => undefined\); \}\}/);
  assert.match(hub, /documentsLoadError && documents\.length === 0 \? \(/);
  assert.match(hub, /<HubLoadError tabName="documents" error=\{documentsLoadError\} onRetry=\{onRetryDocuments\} \/>/);
  assert.match(hub, /projectsLoadError && projects\.length === 0 \? \(/);
  assert.match(hub, /<HubLoadError tabName="projects" error=\{projectsLoadError\} onRetry=\{onRetryProjects\} \/>/);
  assert.match(hub, /templatesLoadError && templates\.length === 0 \? \(/);
  assert.match(hub, /<HubLoadError tabName="templates" error=\{templatesLoadError\} onRetry=\{onRetryTemplates\} \/>/);
  assert.doesNotMatch(hub, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(hub, /createDocumentInvite/);
});

test('HubPreview hubError fixture + retryLoad restores the local seed', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const errorFixture = params\.get\('hubError'\);/);
  assert.match(preview, /documents: errorFixture === 'documents' \? new Error\('Documents could not be loaded\.'\) : null,/);
  assert.match(preview, /projects: errorFixture === 'projects' \? new Error\('Projects could not be loaded\.'\) : null,/);
  assert.match(preview, /templates: errorFixture === 'templates' \? new Error\('Templates could not be loaded\.'\) : null,/);
  assert.match(preview, /const retryLoad = \(kind\) => \{/);
  assert.match(preview, /if \(kind === 'documents'\) setDocuments\(longDocsFixture \? makeLongDocumentFixture\(\) : INITIAL_DOCUMENTS\);/);
  assert.match(preview, /if \(kind === 'projects'\) setProjects\(MOCK_PROJECTS\);/);
  assert.match(preview, /if \(kind === 'templates'\) setTemplates\(MOCK_TEMPLATES\);/);
  assert.match(preview, /setLoadErrors\(\(previous\) => \(\{ \.\.\.previous, \[kind\]: null \}\)\)/);
  assert.match(preview, /onRetryDocuments=\{\(\) => retryLoad\('documents'\)\}/);
  assert.match(preview, /onRetryProjects=\{\(\) => retryLoad\('projects'\)\}/);
  assert.match(preview, /onRetryTemplates=\{\(\) => retryLoad\('templates'\)\}/);
  assert.match(preview, /if \(!workflowE2E\) \{\s*console\.log\('\[hub preview\] upload'\);/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /invented-upload/);
});

test('Load-error Try again is not Select All / extras / empty Upload', () => {
  const selectAll = read('debug/scenarios/e2e-hub-docs-select-all.spec.mjs');
  assert.match(selectAll, /DOCS_SELECT_ALL_PROOF/);
  assert.doesNotMatch(selectAll, /Try again/);
  assert.doesNotMatch(selectAll, /HUB_LOAD_ERROR_RETRY_PROOF/);
  assert.doesNotMatch(selectAll, /hubError=/);

  const extras = read('debug/scenarios/e2e-hub-docs-extras.spec.mjs');
  assert.match(extras, /Duplicate/);
  assert.doesNotMatch(extras, /HUB_LOAD_ERROR_RETRY_PROOF/);
  assert.doesNotMatch(extras, /hubError=/);

  const live = read('debug/scenarios/e2e-hub-load-error-retry.spec.mjs');
  assert.match(live, /HUB_LOAD_ERROR_RETRY_PROOF/);
  assert.match(live, /hubError=documents/);
  assert.match(live, /empty=1/);
  assert.match(live, /hubLoading=documents/);
  assert.match(live, /Couldn't load documents/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /invented-upload/);
});

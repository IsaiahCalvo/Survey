import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const harness = read('agent-cli/mobile-workflows/hub-resilience-e2e.mjs');
const preview = read('src/home/HubPreview.jsx');
const documents = read('src/home/DocumentsLedger.jsx');
const loading = read('src/home/HubLoading.jsx');
const workflowModel = read('agent-cli/mobile-workflows/project-document-model.mjs');

test('hub resilience runner is explicitly fast mock-local and not a durable certification', () => {
  assert.match(harness, /FAST \/ MOCK-LOCAL \/ NOT DURABLE/);
  assert.match(harness, /FAST\/mock-local \(dev-only; not durable\)/);
  assert.match(harness, /durablePersistenceCertified: false/);
  assert.match(harness, /hubPreview: '1'/);
  assert.doesNotMatch(harness, /SUPABASE_SERVICE_ROLE_KEY|DEV_AUTO_LOGIN|bot-credentials|test-account-lease/);
});

test('runner defaults to exact mobile touch and desktop mouse contracts in parallel', () => {
  assert.match(harness, /device: 'all'/);
  assert.match(harness, /Promise\.allSettled\(devices\.map/);
  assert.match(harness, /createTouchDriver\(\{ browserName: 'chromium'/);
  assert.match(harness, /trusted-cdp-touch/);
  assert.match(harness, /desktop-mouse-keyboard/);
  assert.match(harness, /WORKFLOW_VIEWPORTS/);
  assert.match(workflowModel, /desktop: \{ width: 1400, height: 900 \}/);
  assert.match(workflowModel, /mobile: \{ width: 390, height: 844 \}/);
});

test('runner covers tabs, discovery controls, bulk state, fixtures, lifecycle, and diagnostics', () => {
  for (const token of [
    'testFirstVisitTabContinuity',
    'first-visit-tab-frame-continuity',
    'frame.hubPresent',
    'frame.bodyFramed',
    'testMobileSafeAreaTabs',
    'mobile:safe-area-tabs',
    'testMobileEdgeSwipeBack',
    'mobile:edge-swipe-back',
    'testMobileTemplateCategoryRowAlignment',
    'mobile:template-category-row-alignment',
    'testMobileEntitiesModalCentering',
    'mobile:entities-modal-centering',
    'testDocuments',
    'testProjects',
    'testTemplates',
    'Search documents...',
    'Search projects...',
    'Search templates...',
    'first card has the shared top gap',
    'Move/Copy',
    'testEdgeFixtures',
    'testViewerReturn',
    'testHistory',
    'page.goBack',
    'page.goForward',
    'page.reload',
    'consoleErrors',
    'pageErrors',
    'criticalRequestFailures',
  ]) assert.match(harness, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('viewer deep link waits for the exact workflow fixture before asserting one visible source', () => {
  const readiness = harness.indexOf("await waitForWorkflowFixtureReady(page, { projectId: 'p1', documentId: 'd1' })");
  const projectVisible = harness.indexOf("await project.waitFor({ state: 'visible', timeout: 30_000 })");
  const exactProjectAssertion = harness.indexOf('assert.equal(await project.count(), 1');
  const documentVisible = harness.indexOf("await document.waitFor({ state: 'visible', timeout: 30_000 })");
  const exactDocumentAssertion = harness.indexOf('assert.equal(await document.count(), 1');
  assert.ok(readiness >= 0);
  assert.ok(projectVisible > readiness && exactProjectAssertion > projectVisible);
  assert.ok(documentVisible > exactProjectAssertion && exactDocumentAssertion > documentVisible);
  assert.match(harness, /matchingProjects\.length === 1 && matchingDocuments\.length === 1/);
  assert.match(harness, /window\.__mobileWorkflowState/);
});

test('dev preview exposes stable empty, loading, and long-document fixtures used by the runner', () => {
  assert.match(preview, /params\.get\('empty'\) === '1'/);
  assert.match(preview, /params\.get\('longDocs'\) === '1'/);
  assert.match(preview, /params\.get\('hubLoading'\)/);
  assert.match(preview, /makeLongDocumentFixture/);
  assert.match(preview, /documentsInitialLoading=\{loadingFixture === 'documents'\}/);
  assert.match(preview, /projectsInitialLoading=\{loadingFixture === 'projects'\}/);
  assert.match(preview, /templatesInitialLoading=\{loadingFixture === 'templates'\}/);
  assert.match(documents, /No documents match your search/);
  assert.match(documents, /sortOptions/);
  assert.match(loading, /aria-busy="true"/);
  // Owner 2026-10-04: the first load is the app's one quiet line, which
  // announces itself (QuietLoading is role="status"), not a labelled skeleton.
  assert.match(loading, /<QuietLoading label=\{`Loading \$\{title\.toLowerCase\(\)\}…`\} \/>/);
});

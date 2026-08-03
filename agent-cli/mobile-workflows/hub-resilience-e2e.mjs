#!/usr/bin/env node

// FAST / MOCK-LOCAL / NOT DURABLE.
// This harness only exercises Vite's dev-only `?hubPreview=1` fixtures. It
// never authenticates, reads credentials, calls Supabase, or certifies durable
// persistence. Run the durable harness separately for backend guarantees.

import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { ArtifactRecorder } from '../mobile-annotations/artifacts.mjs';
import { createTouchDriver } from '../mobile-annotations/touch.mjs';
import { ensureViteServer } from '../mobile-annotations/vite-server.mjs';
import { activate } from './project-document-ui.mjs';
import { WORKFLOW_STORAGE_KEYS, WORKFLOW_VIEWPORTS } from './project-document-model.mjs';

const CERTIFICATION = 'FAST/mock-local (dev-only; not durable)';
const EDGE_TABS = ['documents', 'projects', 'templates'];
const EMPTY_COPY = {
  documents: 'No documents yet',
  projects: 'No projects yet',
  templates: 'No templates yet',
};

function parseOptions(argv) {
  const options = {
    baseUrl: process.env.MOBILE_QA_BASE_URL || null,
    device: 'all',
    headful: process.env.HEADFUL === '1',
    outputDir: path.resolve('.playwright-mcp', 'hub-resilience'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (name) => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      if (inline !== null) return inline;
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };
    if (arg === '--device' || arg.startsWith('--device=')) options.device = take('--device');
    else if (arg === '--base-url' || arg.startsWith('--base-url=')) options.baseUrl = take('--base-url');
    else if (arg === '--output-dir' || arg.startsWith('--output-dir=')) options.outputDir = path.resolve(take('--output-dir'));
    else if (arg === '--headful') options.headful = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['mobile', 'desktop', 'all'].includes(options.device)) {
    throw new Error('--device must be mobile, desktop, or all');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node agent-cli/mobile-workflows/hub-resilience-e2e.mjs [options]

${CERTIFICATION}

Options:
  --device mobile|desktop|all  Device contract (default: all, parallel)
  --base-url <url>             Reuse an existing Survey Vite server
  --output-dir <path>          Isolated screenshots and summary JSON
  --headful                    Show Chromium
  --help                       Show help`);
}

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const devices = options.device === 'all' ? ['mobile', 'desktop'] : [options.device];
const artifacts = new ArtifactRecorder(options.outputDir, {
  certification: CERTIFICATION,
  devOnlyRoute: '?hubPreview=1',
  devices,
  inputContracts: { mobile: 'trusted-cdp-touch', desktop: 'desktop-mouse-keyboard' },
  viewports: WORKFLOW_VIEWPORTS,
  durablePersistenceCertified: false,
});

let browser;
let managedServer;

function hubRoute(tab, extras = {}, { workflow = false } = {}) {
  const params = new URLSearchParams({
    hubPreview: '1',
    tab,
    mobileNav: 'tabs',
    nativeShell: 'expo',
  });
  if (workflow) params.set('workflowE2E', '1');
  Object.entries(extras).forEach(([key, value]) => params.set(key, String(value)));
  return `/?${params.toString()}`;
}

function attachFailureGuards(page, baseUrl, device) {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    criticalRequestFailures: [],
  };
  const origin = new URL(baseUrl).origin;
  const criticalTypes = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch', 'font']);
  const isSameOrigin = (url) => {
    try { return new URL(url).origin === origin; } catch { return false; }
  };

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(`${device}: ${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(`${device}: ${error.message}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown request failure';
    if (failure.includes('ERR_ABORTED')) return;
    if (isSameOrigin(request.url()) && criticalTypes.has(request.resourceType())) {
      diagnostics.criticalRequestFailures.push(`${device}: ${request.resourceType()} ${request.url()} — ${failure}`);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (response.status() >= 400 && isSameOrigin(response.url()) && criticalTypes.has(request.resourceType())) {
      diagnostics.criticalRequestFailures.push(`${device}: ${request.resourceType()} ${response.status()} ${response.url()}`);
    }
  });
  return diagnostics;
}

function assertHealthy(diagnostics, device) {
  assert.deepEqual(diagnostics.pageErrors, [], `${device}: zero page errors`);
  assert.deepEqual(diagnostics.consoleErrors, [], `${device}: zero console errors`);
  assert.deepEqual(diagnostics.criticalRequestFailures, [], `${device}: zero critical request failures`);
}

async function waitForHub(page, tab) {
  await page.getByRole('heading', { name: EMPTY_COPY[tab].replace(/^No | yet$/g, '').replace(/\w/, (c) => c.toUpperCase()), exact: true })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.survey-hub').waitFor({ state: 'visible', timeout: 30_000 });
}

async function gotoHub(page, baseUrl, tab, extras = {}, config = {}) {
  await page.goto(`${baseUrl}${hubRoute(tab, extras, config)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, tab);
}

async function waitForWorkflowFixtureReady(page, { projectId, documentId }) {
  await page.waitForFunction(({ expectedProjectId, expectedDocumentId }) => {
    const state = window.__mobileWorkflowState;
    if (!state) return false;
    const matchingProjects = (state.projects || []).filter((project) => project.id === expectedProjectId);
    const matchingDocuments = (state.documents || []).filter((document) => document.id === expectedDocumentId);
    return matchingProjects.length === 1 && matchingDocuments.length === 1;
  }, {
    expectedProjectId: projectId,
    expectedDocumentId: documentId,
  }, { timeout: 30_000 });
}

function visibleNav(page, device) {
  return page.locator(device === 'mobile' ? '.mobile-home-tabs:visible' : '.side:visible .nav');
}

async function switchTab(page, touch, device, tab) {
  const name = tab[0].toUpperCase() + tab.slice(1);
  const button = visibleNav(page, device).getByRole('button', { name, exact: true });
  assert.equal(await button.count(), 1, `${device}: one visible ${name} nav button`);
  await activate(button, touch, device);
  await waitForHub(page, tab);
}

async function fillVisibleSearch(page, placeholder, value) {
  const search = page.locator(`input[placeholder="${placeholder}"]:visible`);
  await search.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await search.count(), 1, `one visible ${placeholder}`);
  await search.fill(value);
  return search;
}

async function waitForVisibleCopy(page, text) {
  const matches = page.getByText(text, { exact: true }).filter({ visible: true });
  await matches.first().waitFor({ state: 'visible', timeout: 20_000 });
  assert.ok(await matches.count() >= 1, `visible copy: ${text}`);
  return matches;
}

async function visibleRowIds(page, selector) {
  return page.locator(selector).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-document-id') || row.getAttribute('data-project-id')));
}

async function testDocuments(page, touch, device) {
  await switchTab(page, touch, device, 'documents');
  const rows = page.locator('[data-document-id]:visible');
  assert.equal(await rows.count(), 6, `${device}: base document fixture count`);

  const search = await fillVisibleSearch(page, 'Search documents...', 'RFI-014');
  assert.deepEqual(await visibleRowIds(page, '[data-document-id]:visible'), ['d3'], `${device}: document search filters exact row`);
  await search.fill('nothing-can-match-this-document');
  await waitForVisibleCopy(page, 'No documents match your search.');
  await search.fill('');

  let sortControl;
  if (device === 'mobile') {
    sortControl = page.locator('.documents-mobile-filter:visible');
    assert.equal(await sortControl.count(), 1, 'mobile: sort/filter control exposed');
    await activate(sortControl, touch, device);
    const fileSort = page.getByRole('menuitem', { name: /^File(?: [↑↓])?$/ });
    assert.equal(await fileSort.count(), 1, 'mobile: File sort choice exposed');
    await activate(fileSort, touch, device);
  } else {
    sortControl = page.locator('.documents-desktop-card:visible').getByText(/^File(?: [↑↓])?$/);
    assert.equal(await sortControl.count(), 1, 'desktop: File sort header exposed');
    await activate(sortControl, touch, device);
  }
  const asc = await visibleRowIds(page, '[data-document-id]:visible');
  await activate(sortControl, touch, device);
  if (device === 'mobile') {
    const fileSortAgain = page.getByRole('menuitem', { name: /^File(?: [↑↓])?$/ });
    await activate(fileSortAgain, touch, device);
  }
  const desc = await visibleRowIds(page, '[data-document-id]:visible');
  assert.notEqual(asc[0], desc[0], `${device}: exposed File sort reverses row order`);

  const select = page.locator('.header-subtitle:visible .mobile-header-select-button');
  assert.equal(await select.count(), 1, `${device}: document Select control`);
  await activate(select, touch, device);
  const target = page.locator('[data-document-id="d1"]:visible');
  assert.equal(await target.count(), 1, `${device}: selection target visible`);
  await activate(target, touch, device);
  const duplicate = page.locator('.header-subtitle:visible').getByRole('button', { name: 'Duplicate', exact: true });
  const moveCopy = page.locator('.header-subtitle:visible').getByRole('button', { name: 'Move/Copy', exact: true });
  assert.equal(await duplicate.isEnabled(), true, `${device}: Duplicate enables after selection`);
  assert.equal(await moveCopy.isEnabled(), true, `${device}: Move/Copy enables after selection`);
  const done = page.locator('.header-subtitle:visible').getByRole('button', { name: 'Done', exact: true });
  await activate(done, touch, device);
}

async function testProjects(page, touch, device) {
  await switchTab(page, touch, device, 'projects');
  const search = await fillVisibleSearch(page, 'Search projects...', 'Lab Reno');
  assert.deepEqual(await page.locator('[data-project-id]:visible').evaluateAll((rows) => [...new Set(rows.map((row) => row.getAttribute('data-project-id')))]), ['p2']);
  await search.fill('nothing-can-match-this-project');
  await waitForVisibleCopy(page, 'No projects match your search.');
  await search.fill('');

  const select = page.locator('[data-testid="project-select-toggle"]:visible');
  assert.equal(await select.count(), 1, `${device}: project Select control`);
  await activate(select, touch, device);
  const target = page.locator('[data-project-id="p1"]:visible');
  assert.equal(await target.count(), 1, `${device}: project selection target visible`);
  await activate(target, touch, device);
  const duplicate = page.getByRole('button', { name: 'Duplicate', exact: true }).filter({ visible: true });
  assert.equal(await duplicate.count(), 1, `${device}: one project bulk Duplicate`);
  assert.equal(await duplicate.isEnabled(), true, `${device}: project Duplicate enables after selection`);
  await activate(page.locator('[data-testid="project-select-toggle"]:visible'), touch, device);
}

async function testTemplates(page, touch, device) {
  await switchTab(page, touch, device, 'templates');
  const search = await fillVisibleSearch(page, 'Search templates...', 'MEP As-Built');
  const match = page.getByText('MEP As-Built Markup', { exact: true }).filter({ visible: true });
  assert.ok(await match.count() >= 1, `${device}: template search exposes matching template`);
  await search.fill('nothing-can-match-this-template');
  await waitForVisibleCopy(page, device === 'mobile' ? 'No templates match your search' : 'No templates match your search.');
  await search.fill('');

  const bulkScope = device === 'mobile'
    ? page.locator('.header-subtitle:visible')
    : page.locator('.templates-editor-grid:visible > aside').first();
  const select = bulkScope.getByRole('button', { name: 'Select', exact: true });
  assert.equal(await select.count(), 1, `${device}: template Select control`);
  await activate(select, touch, device);
  const target = page.getByText('Security Walk-Through', { exact: true }).filter({ visible: true });
  assert.ok(await target.count() >= 1, `${device}: template selection target visible`);
  await activate(target.first(), touch, device);
  const duplicate = bulkScope.getByRole('button', { name: 'Duplicate', exact: true });
  assert.equal(await duplicate.isEnabled(), true, `${device}: template Duplicate enables after selection`);
  await activate(bulkScope.getByRole('button', { name: 'Done', exact: true }), touch, device);
}

async function testEdgeFixtures(page, baseUrl, touch, device) {
  for (const tab of EDGE_TABS) {
    await gotoHub(page, baseUrl, tab, { empty: '1' });
    await waitForVisibleCopy(page, EMPTY_COPY[tab]);
    await artifacts.screenshot(page, `${device}-empty-${tab}`);

    await gotoHub(page, baseUrl, tab, { hubLoading: tab });
    const status = page.getByRole('status', { name: `Loading ${tab}`, exact: true });
    assert.equal(await status.count(), 1, `${device}: one real ${tab} skeleton region`);
    assert.equal(await status.getAttribute('aria-busy'), 'true', `${device}: ${tab} skeleton is busy`);
  }

  await gotoHub(page, baseUrl, 'documents', { longDocs: '1' });
  const longRows = page.locator('[data-document-id]:visible');
  assert.equal(await longRows.count(), 18, `${device}: long document fixture count`);
  const last = longRows.last();
  await last.scrollIntoViewIfNeeded();
  assert.equal(await last.isVisible(), true, `${device}: final long-fixture document remains reachable`);
  await artifacts.screenshot(page, `${device}-long-documents`);
}

async function testViewerReturn(page, baseUrl, touch, device) {
  await gotoHub(page, baseUrl, 'projects', {}, { workflow: true });
  await waitForWorkflowFixtureReady(page, { projectId: 'p1', documentId: 'd1' });
  const project = page.locator('[data-project-id="p1"]:visible');
  await project.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await project.count(), 1, `${device}: project deep-link source visible`);
  await activate(project, touch, device);
  const document = page.locator('[data-document-id="d1"]:visible');
  await document.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await document.count(), 1, `${device}: project document visible`);
  await activate(document, touch, device);
  await page.waitForURL((url) => url.searchParams.get('testPdf') === 'clickable-link-test.pdf', { timeout: 60_000 });
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(new URL(page.url()).searchParams.get('returnTab'), 'projects', `${device}: viewer deep link carries exact return tab`);
  const returnControl = device === 'mobile'
    ? page.getByRole('button', { name: 'Back to documents', exact: true })
    : page.getByText('Home', { exact: true }).filter({ visible: true });
  assert.equal(await returnControl.count(), 1, `${device}: one visible viewer return control`);
  await activate(returnControl, touch, device);
  await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1' && url.searchParams.get('tab') === 'projects', { timeout: 30_000 });
  await waitForHub(page, 'projects');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHub(page, 'projects');
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'projects', `${device}: exact returned tab survives refresh`);
}

async function testHistory(page, baseUrl, device) {
  await gotoHub(page, baseUrl, 'documents');
  await gotoHub(page, baseUrl, 'projects');
  await gotoHub(page, baseUrl, 'templates');

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await waitForHub(page, 'projects');
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'projects', `${device}: browser back restores projects deep link`);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await waitForHub(page, 'documents');
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'documents', `${device}: second browser back restores documents deep link`);
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await waitForHub(page, 'projects');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await waitForHub(page, 'templates');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHub(page, 'templates');
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'templates', `${device}: forward target survives refresh`);
}

async function runDevice(device, baseUrl) {
  const viewport = WORKFLOW_VIEWPORTS[device];
  const context = await browser.newContext({
    deviceScaleFactor: device === 'mobile' ? 3 : 1,
    hasTouch: device === 'mobile',
    isMobile: device === 'mobile',
    locale: 'en-US',
    screen: viewport,
    viewport,
  });
  await context.addInitScript(({ keys, gate }) => {
    try {
      if (sessionStorage.getItem(gate)) return;
      Object.values(keys).forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem('survey-hub-tab');
      sessionStorage.setItem(gate, '1');
    } catch { /* storage is unavailable on initial opaque documents */ }
  }, { keys: WORKFLOW_STORAGE_KEYS, gate: `hub-resilience-${artifacts.runId}-${device}` });

  const page = await context.newPage();
  const diagnostics = attachFailureGuards(page, baseUrl, device);
  const touch = device === 'mobile'
    ? await createTouchDriver({ browserName: 'chromium', context, page })
    : null;
  try {
    assert.deepEqual(page.viewportSize(), viewport, `${device}: exact viewport`);
    if (device === 'mobile') assert.equal(touch.inputKind, 'trusted-cdp-touch', 'mobile: trusted touch required');

    await artifacts.time(`${device}:tab-search-sort-selection`, async () => {
      await gotoHub(page, baseUrl, 'documents', {}, { workflow: true });
      await testDocuments(page, touch, device);
      await testProjects(page, touch, device);
      await testTemplates(page, touch, device);
    });
    await artifacts.screenshot(page, `${device}-tabs-search-selection`);

    await artifacts.time(`${device}:edge-fixtures`, () => testEdgeFixtures(page, baseUrl, touch, device));
    await artifacts.time(`${device}:viewer-return`, () => testViewerReturn(page, baseUrl, touch, device));
    await artifacts.time(`${device}:history`, () => testHistory(page, baseUrl, device));
    await page.waitForTimeout(300);
    assertHealthy(diagnostics, device);

    artifacts.recordScenario({
      certification: CERTIFICATION,
      device,
      viewport,
      input: device === 'mobile' ? touch.inputKind : 'desktop-mouse-keyboard',
      coverage: 'tabs-search-filter-sort-selection-bulk-state-empty-loading-long-docs-viewer-exact-return-back-forward-refresh',
      diagnostics,
      status: 'passed',
    });
    return diagnostics;
  } finally {
    await context.close();
  }
}

async function run() {
  const server = await ensureViteServer(options.baseUrl);
  managedServer = server.managedProcess;
  browser = await chromium.launch({ headless: !options.headful });
  const results = await Promise.allSettled(devices.map((device) => runDevice(device, server.baseUrl)));
  const failures = results
    .map((result, index) => ({ result, device: devices[index] }))
    .filter(({ result }) => result.status === 'rejected');
  artifacts.setFinal({
    certification: CERTIFICATION,
    baseUrl: server.baseUrl,
    devices,
    passedDevices: results.filter((result) => result.status === 'fulfilled').length,
    durablePersistenceCertified: false,
  });
  if (failures.length) {
    throw new Error(failures.map(({ device, result }) => `${device}: ${result.reason?.stack || result.reason}`).join('\n\n'));
  }
}

try {
  await run();
  const summary = artifacts.finish('passed');
  console.log('RESULT: PASS');
  console.log(`certification: ${CERTIFICATION}`);
  console.log(`devices: ${devices.join(', ')}`);
  console.log(`duration: ${artifacts.durationMs()}ms`);
  console.log(`artifacts: ${summary}`);
} catch (error) {
  const summary = artifacts.finish('failed', error);
  console.error('RESULT: FAIL');
  console.error(`certification: ${CERTIFICATION}`);
  console.error(error?.stack || error);
  console.error(`artifacts: ${summary}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedServer?.kill('SIGTERM');
}

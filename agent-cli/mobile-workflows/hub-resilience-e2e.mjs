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
    scenario: 'all',
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
    else if (arg === '--scenario' || arg.startsWith('--scenario=')) options.scenario = take('--scenario');
    else if (arg === '--headful') options.headful = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['mobile', 'desktop', 'all'].includes(options.device)) {
    throw new Error('--device must be mobile, desktop, or all');
  }
  if (!['all', 'fetch-error-retry'].includes(options.scenario)) {
    throw new Error('--scenario must be all or fetch-error-retry');
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

async function testContentTypeIconColors(page, baseUrl, device) {
  await gotoHub(page, baseUrl, 'documents');
  const nav = visibleNav(page, device);
  const expected = {
    Documents: 'rgb(122, 183, 230)',
    Projects: 'rgb(216, 168, 78)',
    Templates: 'rgb(194, 147, 230)',
  };
  for (const [label, color] of Object.entries(expected)) {
    const icon = nav.getByRole('button', { name: label, exact: true }).locator('svg');
    assert.equal(await icon.count(), 1, `${device}: ${label} has one identity icon`);
    assert.equal(
      await icon.evaluate((node) => getComputedStyle(node).stroke),
      color,
      `${device}: ${label} keeps its identity color`,
    );
  }
}

async function beginHubFrameProbe(page) {
  await page.evaluate(() => {
    window.__hubFrameProbe = { active: true, frames: [] };
    const sample = () => {
      const probe = window.__hubFrameProbe;
      if (!probe?.active) return;
      const hub = document.querySelector('.survey-hub');
      const main = hub?.querySelector('main');
      const box = hub?.getBoundingClientRect();
      probe.frames.push({
        hubPresent: !!hub,
        mainPresent: !!main,
        mainChildren: main?.childElementCount || 0,
        title: hub?.querySelector('h1')?.textContent?.trim() || '',
        width: box?.width || 0,
        height: box?.height || 0,
        background: hub ? getComputedStyle(hub).backgroundColor : '',
        bodyFramed: document.body.classList.contains('survey-hub-native-frame'),
        rootFramed: document.getElementById('root')?.classList.contains('survey-hub-native-root') || false,
      });
      if (probe.frames.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function endHubFrameProbe(page) {
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const probe = window.__hubFrameProbe;
      if (probe) probe.active = false;
      resolve(probe?.frames || []);
    }));
  }));
}

async function testFirstVisitTabContinuity(page, baseUrl, touch, device) {
  await gotoHub(page, baseUrl, 'documents');
  for (const tab of ['projects', 'templates', 'documents']) {
    await beginHubFrameProbe(page);
    await switchTab(page, touch, device, tab);
    const frames = await endHubFrameProbe(page);
    assert.ok(frames.length >= 2, `${device}: ${tab} first switch sampled multiple painted frames`);
    frames.forEach((frame, index) => {
      assert.equal(frame.hubPresent, true, `${device}: ${tab} frame ${index} retains hub`);
      assert.equal(frame.mainPresent, true, `${device}: ${tab} frame ${index} retains main content`);
      assert.ok(frame.mainChildren > 0, `${device}: ${tab} frame ${index} never exposes an empty main`);
      assert.ok(EDGE_TABS.some((name) => frame.title.toLowerCase() === name), `${device}: ${tab} frame ${index} retains a real tab heading`);
      assert.equal(frame.width, WORKFLOW_VIEWPORTS[device].width, `${device}: ${tab} frame ${index} retains viewport width`);
      assert.equal(frame.height, WORKFLOW_VIEWPORTS[device].height, `${device}: ${tab} frame ${index} retains viewport height`);
      assert.equal(frame.background, 'rgb(13, 15, 20)', `${device}: ${tab} frame ${index} retains hub background`);
      assert.equal(frame.bodyFramed, true, `${device}: ${tab} frame ${index} retains body frame class`);
      assert.equal(frame.rootFramed, true, `${device}: ${tab} frame ${index} retains root frame class`);
    });
  }
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

async function requiredBox(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(box, `${label}: measurable box`);
  return box;
}

function assertNear(actual, expected, label, tolerance = 1) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}

async function testMobileSafeAreaTabs(page, baseUrl) {
  await gotoHub(page, baseUrl, 'templates');

  const readLayout = async () => {
    const nav = page.locator('.mobile-home-tabs:visible');
    const documents = nav.getByRole('button', { name: 'Documents', exact: true });
    const templates = nav.getByRole('button', { name: 'Templates', exact: true });
    return {
      documents: await requiredBox(documents, 'mobile Documents tab'),
      templates: await requiredBox(templates, 'mobile Templates tab'),
      style: await nav.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          alignItems: style.alignItems,
        };
      }),
    };
  };

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--native-safe-area-bottom', '10px');
    document.documentElement.style.setProperty('--native-safe-area-left', '0px');
    document.documentElement.style.setProperty('--native-safe-area-right', '0px');
  });
  const flat = await readLayout();
  assert.equal(flat.style.paddingLeft, '0px', 'mobile: flat screen keeps left tab flush');
  assert.equal(flat.style.paddingRight, '0px', 'mobile: flat screen keeps right tab flush');
  assert.equal(flat.style.paddingBottom, '14px', 'mobile: flat screen keeps baseline bottom clearance');
  assertNear(flat.documents.x, 0, 'mobile: flat Documents edge remains unchanged');
  assertNear(flat.templates.x + flat.templates.width, WORKFLOW_VIEWPORTS.mobile.width, 'mobile: flat Templates edge remains unchanged');

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--native-safe-area-bottom', '34px');
  });
  const rounded = await readLayout();
  assert.equal(rounded.style.paddingLeft, '8px', 'mobile: rounded screen protects left tab corner');
  assert.equal(rounded.style.paddingRight, '8px', 'mobile: rounded screen protects right tab corner');
  assert.equal(rounded.style.paddingBottom, '35px', 'mobile: rounded screen lowers tabs without entering home indicator');
  assert.equal(rounded.style.alignItems, 'end', 'mobile: tabs sit against computed safe bottom');
  assertNear(rounded.documents.x, 8, 'mobile: rounded Documents edge is inset');
  assertNear(rounded.templates.x + rounded.templates.width, WORKFLOW_VIEWPORTS.mobile.width - 8, 'mobile: rounded Templates edge is inset');
  assertNear(rounded.templates.y + rounded.templates.height, WORKFLOW_VIEWPORTS.mobile.height - 35, 'mobile: rounded tabs retain home-indicator clearance');
  await artifacts.screenshot(page, 'mobile-rounded-safe-area-tabs');
}

async function testMobileEdgeSwipeBack(page, baseUrl, touch) {
  const readSwipeSurface = () => page.locator('.survey-hub .main:not([data-mobile-swipe-underlay="true"])').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return {
      phase: element.dataset.mobileSwipePhase || '',
      translateX: matrix.m41,
      transitionDuration: getComputedStyle(element).transitionDuration,
      underlayText: document.querySelector('[data-mobile-swipe-underlay="true"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    };
  });
  const dragToAndHold = async (start, end) => {
    await touch.start(start);
    const steps = 6;
    for (let index = 1; index <= steps; index += 1) {
      await touch.move({
        x: start.x + ((end.x - start.x) * index) / steps,
        y: start.y + ((end.y - start.y) * index) / steps,
      });
      await page.waitForTimeout(18);
    }
    await page.waitForTimeout(40);
    await touch.move(end);
    await page.waitForTimeout(32);
  };

  await gotoHub(page, baseUrl, 'projects');
  const project = page.locator('.projects-mobile-folder-row.drill:visible').first();
  await activate(project, touch, 'mobile');
  await page.locator('.projects-mobile-back-button:visible').waitFor({ state: 'visible' });

  await touch.drag({ x: 8, y: 280 }, { x: 12, y: 410 });
  assert.equal(await page.locator('.projects-mobile-back-button:visible').count(), 1, 'mobile: vertical edge scroll does not leave project');
  await dragToAndHold({ x: 8, y: 300 }, { x: 50, y: 302 });
  const projectDrag = await readSwipeSurface();
  assert.equal(projectDrag.phase, 'dragging', 'mobile: project page enters interactive drag phase');
  assert(projectDrag.translateX >= 35 && projectDrag.translateX <= 50, `mobile: project page follows finger (${projectDrag.translateX}px)`);
  assert.match(projectDrag.underlayText, /Tower 5|Lab Reno|MEP Phase/, 'mobile: project list is already rendered beneath the drag');
  await touch.end();
  await page.waitForFunction(() => !document.querySelector('.survey-hub .main:not([data-mobile-swipe-underlay="true"])')?.dataset.mobileSwipePhase);
  assert.equal(await page.locator('.projects-mobile-back-button:visible').count(), 1, 'mobile: short edge drag does not leave project');
  await touch.drag({ x: 40, y: 320 }, { x: 180, y: 322 });
  assert.equal(await page.locator('.projects-mobile-back-button:visible').count(), 1, 'mobile: swipe away from edge does not leave project');
  await dragToAndHold({ x: 8, y: 340 }, { x: 140, y: 344 });
  const projectCommitDrag = await readSwipeSurface();
  assert.equal(projectCommitDrag.phase, 'dragging', 'mobile: project page remains interactive before release');
  assert(projectCommitDrag.translateX >= 120, `mobile: project page visibly tracks committed drag (${projectCommitDrag.translateX}px)`);
  await touch.end();
  const projectSettle = await readSwipeSurface();
  assert.equal(projectSettle.phase, 'completing', 'mobile: project swipe animates to completion after release');
  assert.notEqual(projectSettle.transitionDuration, '0s', 'mobile: project completion has visible duration');
  await page.locator('.survey-hub .main:not([data-mobile-swipe-underlay="true"]) .projects-mobile-folder-row.drill:visible').first().waitFor({ state: 'visible' });
  await page.locator('[data-mobile-swipe-underlay="true"]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.survey-hub .main:not([data-mobile-swipe-underlay="true"]) .projects-mobile-back-button:visible').count(), 0, 'mobile: right swipe from left edge returns to projects');
  assert.equal(await page.locator('[data-mobile-swipe-underlay="true"]').count(), 0, 'mobile: project swipe underlay is removed after navigation');

  await gotoHub(page, baseUrl, 'templates');
  const template = page.locator('.templates-mobile-row:visible').first();
  await activate(template, touch, 'mobile');
  await page.locator('.templates-mobile-detail:visible').waitFor({ state: 'visible' });
  await dragToAndHold({ x: 8, y: 340 }, { x: 140, y: 344 });
  const templateDrag = await readSwipeSurface();
  assert.equal(templateDrag.phase, 'dragging', 'mobile: template page enters interactive drag phase');
  assert(templateDrag.translateX >= 120, `mobile: template page visibly follows finger (${templateDrag.translateX}px)`);
  assert.match(templateDrag.underlayText, /Security Walk-Through|MEP As-Built/, 'mobile: template list is already rendered beneath the drag');
  await touch.end();
  await page.locator('.survey-hub .main:not([data-mobile-swipe-underlay="true"]) .templates-mobile-browser:visible').waitFor({ state: 'visible' });
  await page.locator('[data-mobile-swipe-underlay="true"]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.survey-hub .main:not([data-mobile-swipe-underlay="true"]) .templates-mobile-detail:visible').count(), 0, 'mobile: right swipe from left edge returns to templates');
  await artifacts.screenshot(page, 'mobile-edge-swipe-back-complete');
}

async function testMobileTemplateCategoryRowAlignment(page, baseUrl, touch) {
  await gotoHub(page, baseUrl, 'templates');
  await activate(page.locator('.templates-mobile-row:visible').first(), touch, 'mobile');
  const rows = page.locator('.templates-mobile-category-row:visible');
  await rows.first().waitFor({ state: 'visible' });

  const assertRowsCentered = async (state) => {
    const measurements = await rows.evaluateAll((elements) => elements.map((row) => {
      const centerY = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? box.y + box.height / 2 : null;
      };
      return {
        row: centerY(row),
        handle: centerY(row.querySelector(':scope > [data-drag-rearrange-handle]')),
        toggle: centerY(row.querySelector(':scope > .templates-mobile-category-toggle')),
        toggleIcon: centerY(row.querySelector(':scope > .templates-mobile-category-toggle > svg')),
        input: centerY(row.querySelector(':scope > input')),
        count: centerY(row.querySelector(':scope > span')),
      };
    }));
    assert.ok(measurements.length >= 2, `mobile: ${state} template exposes multiple category rows`);
    measurements.forEach((measurement, index) => {
      for (const part of ['handle', 'toggle', 'toggleIcon', 'input', 'count']) {
        assert.notEqual(measurement[part], null, `mobile: ${state} category ${index} has ${part}`);
        assertNear(measurement[part], measurement.row, `mobile: ${state} category ${index} ${part} is vertically centered`);
      }
    });
  };

  await assertRowsCentered('collapsed');
  await activate(rows.first().locator('.templates-mobile-category-toggle'), touch, 'mobile');
  await page.locator('.templates-mobile-items:visible').waitFor({ state: 'visible' });
  await assertRowsCentered('expanded');
  await artifacts.screenshot(page, 'mobile-template-category-rows-centered');
}

async function testTemplateDisclosureIconParity(page, baseUrl, touch, device) {
  await gotoHub(page, baseUrl, 'templates');
  let toggle;
  if (device === 'mobile') {
    await activate(page.locator('.templates-mobile-row:visible').first(), touch, device);
    toggle = page.locator('.templates-mobile-category-toggle:visible').first();
  } else {
    toggle = page.locator('button[title="Expand"]:visible').first();
  }
  await toggle.waitFor({ state: 'visible' });
  const rendered = await toggle.evaluate((element) => ({
    hasSvg: Boolean(element.querySelector('svg')),
    glyphWidth: element.querySelector('svg')?.getBoundingClientRect().width || 0,
    glyphHeight: element.querySelector('svg')?.getBoundingClientRect().height || 0,
    strokeWidth: element.querySelector('svg path')?.getAttribute('stroke-width') || '',
  }));
  assert.equal(rendered.hasSvg, true, `${device}: category disclosure uses the shared desktop/web SVG chevron`);
  assert.equal(rendered.glyphWidth, 18, `${device}: shared category chevron is large enough to read`);
  assert.equal(rendered.glyphHeight, 18, `${device}: shared category chevron stays square`);
  assert.equal(rendered.strokeWidth, '2', `${device}: shared category chevron keeps readable weight`);
  await activate(toggle, touch, device);
  if (device === 'mobile') {
    const expandedToggle = page.locator('.templates-mobile-category-toggle[aria-label^="Collapse"]:visible').first();
    await expandedToggle.waitFor({ state: 'visible' });
    assert.match(await expandedToggle.getAttribute('aria-label'), /^Collapse /, 'mobile: shared disclosure control expands the category');
  } else {
    const expandedToggle = page.locator('button[title="Collapse"]:visible').first();
    await expandedToggle.waitFor({ state: 'visible' });
    assert.equal(await expandedToggle.getAttribute('title'), 'Collapse', 'desktop: shared disclosure control expands the category');
  }
}

async function testProjectRowTeamParity(page, baseUrl, device) {
  await gotoHub(page, baseUrl, 'projects');
  const row = device === 'mobile'
    ? page.locator('.projects-mobile-folder-row.drill.reorderable:visible').first()
    : page.locator('.projects-desktop-layout [data-project-id]:visible').first();
  await row.waitFor({ state: 'visible' });
  const summary = row.locator('.project-team-summary');
  assert.equal(await summary.count(), 1, `${device}: project row has one shared team summary`);
  assert.match(await summary.getAttribute('aria-label'), /^\d+ team members?$/, `${device}: project row exposes its team count`);
  assert.doesNotMatch(await row.innerText(), /\bfiles?\b|\b(?:Today|\d+d ago|No files)\b/i, `${device}: project row omits invented file and activity metadata`);
}

async function testMobileEntitiesModalCentering(page, baseUrl, touch) {
  await gotoHub(page, baseUrl, 'templates');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--native-safe-area-bottom', '34px');
  });
  await activate(page.locator('.templates-mobile-row:visible').first(), touch, 'mobile');
  await page.locator('.templates-mobile-detail:visible').waitFor({ state: 'visible' });
  await activate(page.getByRole('button', { name: 'Entities', exact: true }), touch, 'mobile');

  const scrim = page.locator('.templates-mobile-modal-scrim:visible');
  const modal = page.getByRole('dialog', { name: 'Entities', exact: true });
  await modal.waitFor({ state: 'visible' });

  const assertCentered = async (state) => {
    const scrimBox = await requiredBox(scrim, `mobile: ${state} Entities scrim`);
    const modalBox = await requiredBox(modal, `mobile: ${state} Entities modal`);
    const style = await scrim.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        alignItems: computed.alignItems,
        backdropFilter: computed.backdropFilter || computed.webkitBackdropFilter,
        paddingTop: Number.parseFloat(computed.paddingTop),
        paddingBottom: Number.parseFloat(computed.paddingBottom),
      };
    });
    const usableTop = scrimBox.y + style.paddingTop;
    const usableBottom = scrimBox.y + scrimBox.height - style.paddingBottom;
    const expectedCenter = usableTop + (usableBottom - usableTop) / 2;
    assert.equal(style.alignItems, 'center', `mobile: ${state} Entities modal uses centered flex alignment`);
    assert.match(style.backdropFilter, /blur\(/, `mobile: ${state} Entities background remains blurred`);
    assertNear(
      modalBox.y + modalBox.height / 2,
      expectedCenter,
      `mobile: ${state} Entities modal is vertically centered in the safe viewport`,
    );
    assert.ok(modalBox.y >= usableTop, `mobile: ${state} Entities modal remains below the safe top`);
    assert.ok(modalBox.y + modalBox.height <= usableBottom, `mobile: ${state} Entities modal remains above the safe bottom`);
  };

  await assertCentered('short-list');
  const addEntity = modal.getByRole('button', { name: 'Add entity', exact: true });
  const entityRows = modal.locator('.templates-mobile-entity-row');
  for (let index = 0; index < 8; index += 1) {
    const previousCount = await entityRows.count();
    await activate(addEntity, touch, 'mobile');
    await page.waitForFunction(
      ({ selector, count }) => document.querySelectorAll(selector).length === count + 1,
      { selector: '.templates-mobile-entity-modal .templates-mobile-entity-row', count: previousCount },
    );
    const colorPanel = modal.locator('.templates-mobile-color-panel:visible');
    if (await colorPanel.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)) {
      await page.keyboard.press('Escape');
      await colorPanel.waitFor({ state: 'hidden' });
    }
  }
  const panel = modal.locator('.templates-mobile-entity-panel');
  const overflow = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert.ok(overflow.scrollHeight > overflow.clientHeight, 'mobile: long Entities list scrolls inside the centered modal');
  assert.equal(overflow.overflowY, 'auto', 'mobile: Entities panel owns its vertical scrolling');
  await assertCentered('long-list');
  await artifacts.screenshot(page, 'mobile-entities-modal-centered');
}

async function measureMobileHeader(page, tab) {
  const row = page.locator(`.${tab}-mobile-search-actions:visible`);
  const action = row.locator('.hub-mobile-primary-action:visible');
  const search = row.locator('input:visible');
  const select = page.locator('.header-subtitle:visible .mobile-header-select-button');
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await action.waitFor({ state: 'visible', timeout: 30_000 });
  await search.waitFor({ state: 'visible', timeout: 30_000 });
  await select.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await row.count(), 1, `mobile: one ${tab} search/action row`);
  assert.equal(await action.count(), 1, `mobile: one ${tab} primary action`);
  assert.equal(await search.count(), 1, `mobile: one ${tab} search input`);
  assert.equal(await select.count(), 1, `mobile: one ${tab} Select control`);
  const actionTypography = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      whiteSpace: style.whiteSpace,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  return {
    row: await requiredBox(row, `${tab} search/action row`),
    action: await requiredBox(action, `${tab} primary action`),
    actionTypography,
    search: await requiredBox(search, `${tab} search input`),
    select: await requiredBox(select, `${tab} Select control`),
  };
}

async function testMobileHeaderParity(page, baseUrl) {
  const metrics = {};
  const cardSelectors = {
    documents: '.mobile-doc-card:visible',
    projects: '.projects-mobile-folder-row.drill.reorderable:visible',
    templates: '.templates-mobile-row.reorderable:visible',
  };
  const bodySelectors = {
    documents: '.documents-ledger-body:visible',
    projects: '.projects-tab-body:visible',
    templates: '.templates-editor-body:visible',
  };
  for (const tab of EDGE_TABS) {
    await gotoHub(page, baseUrl, tab);
    metrics[tab] = await measureMobileHeader(page, tab);
    const cards = page.locator(cardSelectors[tab]);
    await cards.first().waitFor({ state: 'visible', timeout: 30_000 });
    assert.ok(await cards.count() >= 1, `mobile: ${tab} has a list card`);
    metrics[tab].body = await requiredBox(page.locator(bodySelectors[tab]), `${tab} mobile body`);
    metrics[tab].card = await cards.first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });
    if (tab === 'projects') {
      assert.equal(await page.getByText('Project folders', { exact: true }).filter({ visible: true }).count(), 0, 'mobile: Projects omits redundant list heading');
      await artifacts.screenshot(page, 'mobile-projects-without-list-heading');
    }
    if (tab === 'templates') {
      assert.equal(await page.getByText('Template sets', { exact: true }).filter({ visible: true }).count(), 0, 'mobile: Templates omits redundant list heading');
      await artifacts.screenshot(page, 'mobile-templates-without-list-heading');
    }
  }

  const reference = metrics.documents;
  for (const tab of EDGE_TABS.slice(1)) {
    const candidate = metrics[tab];
    for (const key of ['row', 'action', 'search']) {
      for (const field of ['x', 'y', 'width', 'height']) {
        assertNear(candidate[key][field], reference[key][field], `mobile: ${tab} ${key} ${field} matches Documents`);
      }
    }
    assert.equal(candidate.actionTypography.fontSize, reference.actionTypography.fontSize, `mobile: ${tab} primary-action font size matches Documents`);
    assertNear(candidate.select.x, reference.select.x, `mobile: ${tab} Select left alignment`);
    assertNear(candidate.select.y, reference.select.y, `mobile: ${tab} Select row alignment`);
  }
  for (const tab of EDGE_TABS) {
    const typography = metrics[tab].actionTypography;
    assert.equal(typography.fontSize, '11.5px', `mobile: ${tab} primary action uses the shared font token`);
    assert.equal(typography.whiteSpace, 'nowrap', `mobile: ${tab} primary action cannot wrap`);
    assert.ok(typography.scrollWidth <= typography.clientWidth, `mobile: ${tab} primary action text is not horizontally clipped`);
    assert.ok(typography.scrollHeight <= typography.clientHeight, `mobile: ${tab} primary action text is not vertically clipped`);
  }
  assertNear(reference.action.width, 112, 'mobile: shared primary-action width');
  for (const tab of EDGE_TABS) {
    assertNear(metrics[tab].card.y - metrics[tab].body.y, 8, `mobile: ${tab} first card has the shared top gap`);
    assertNear(metrics[tab].card.width, 370, `mobile: ${tab} card uses the shared width`);
    assertNear(metrics[tab].card.height, 64, `mobile: ${tab} card uses the slimmer shared height`);
    assert.ok(metrics[tab].card.scrollHeight <= metrics[tab].card.clientHeight, `mobile: ${tab} card content is not vertically clipped`);
  }

  await gotoHub(page, baseUrl, 'documents');
  const sort = await requiredBox(page.locator('.documents-mobile-filter-visual:visible'), 'mobile Documents sort visual');
  assertNear(sort.y, reference.select.y, 'mobile: Select and sort share a row');
  assertNear(sort.x + sort.width, reference.action.x + reference.action.width, 'mobile: sort and Upload right edges align');
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
  } else {
    sortControl = page.locator('.documents-desktop-card:visible').getByText(/^File(?: [↑↓])?$/);
    assert.equal(await sortControl.count(), 1, 'desktop: File sort header exposed');
  }
  // Search still owns focus after clearing. Its first outside gesture must
  // dismiss only; the following gesture intentionally activates sorting.
  await activate(sortControl, touch, device);
  if (device === 'mobile') {
    assert.equal(await page.locator('.documents-mobile-sort-menu:visible').count(), 0, 'mobile: first sort tap only dismisses document search');
  }
  await activate(sortControl, touch, device);
  if (device === 'mobile') {
    const menu = page.locator('.documents-mobile-sort-menu:visible');
    const sortBox = await requiredBox(sortControl, 'mobile: open sort control');
    const menuBox = await requiredBox(menu, 'mobile: open sort menu');
    const viewport = page.viewportSize();
    assertNear(menuBox.x + menuBox.width, sortBox.x + sortBox.width, 'mobile: sort menu right edge aligns with control');
    assert.ok(menuBox.y >= sortBox.y + sortBox.height, 'mobile: sort menu opens below control');
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= viewport.width, 'mobile: sort menu remains within viewport');
    await artifacts.screenshot(page, 'mobile-documents-sort-menu-open');
    const fileSort = page.getByRole('menuitem', { name: /^File(?: [↑↓])?$/ });
    assert.equal(await fileSort.count(), 1, 'mobile: File sort choice exposed');
    await activate(fileSort, touch, device);
  }
  const asc = await visibleRowIds(page, '[data-document-id]:visible');
  await activate(sortControl, touch, device);
  if (device === 'mobile') {
    const fileSortAgain = page.getByRole('menuitem', { name: /^File(?: [↑↓])?$/ });
    await activate(fileSortAgain, touch, device);
  }
  const desc = await visibleRowIds(page, '[data-document-id]:visible');
  assert.notEqual(asc[0], desc[0], `${device}: exposed File sort reverses row order`);

  const stableMobileSortBox = device === 'mobile'
    ? await requiredBox(sortControl, 'mobile: sort before expanded selection')
    : null;

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
  if (device === 'mobile') {
    const selectionStrip = page.locator('.documents-mobile-select-main:visible');
    const expandedSortBox = await requiredBox(sortControl, 'mobile: sort after expanded selection');
    assertNear(expandedSortBox.x, stableMobileSortBox.x, 'mobile: sort remains fixed while Select expands');
    assertNear(expandedSortBox.y, stableMobileSortBox.y, 'mobile: sort stays on Select row while Select expands');
    await artifacts.screenshot(page, 'mobile-documents-selection-expanded-start');
    const stripState = await selectionStrip.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    assert.ok(stripState.scrollWidth > stripState.clientWidth, 'mobile: expanded bulk controls use bounded horizontal scrolling');
    await page.waitForTimeout(50);
    const stripBox = await requiredBox(selectionStrip, 'mobile: expanded selection strip');
    const deleteBox = await requiredBox(
      page.locator('.documents-mobile-select-main:visible').getByRole('button', { name: 'Delete', exact: true }),
      'mobile: scrolled Delete action',
    );
    assert.ok(deleteBox.x >= stripBox.x - 1 && deleteBox.x + deleteBox.width <= stripBox.x + stripBox.width + 1, 'mobile: every bulk action can scroll into the left control area');
    const scrolledSortBox = await requiredBox(sortControl, 'mobile: sort after bulk-control scroll');
    assertNear(scrolledSortBox.x, stableMobileSortBox.x, 'mobile: bulk scrolling does not move sort');
    await artifacts.screenshot(page, 'mobile-documents-selection-expanded-end');
  }
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
  // A focused search intentionally owns the first outside gesture: it blurs
  // without activating the underlying control. Prove that contract before
  // the second gesture enters selection mode.
  await activate(select, touch, device);
  assert.equal(await select.textContent(), 'Select', `${device}: first outside tap only dismisses project search`);
  await activate(select, touch, device);
  assert.equal(await select.textContent(), 'Done', `${device}: second tap enters project selection`);
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
  const searchOwnedFocus = await search.evaluate((element) => document.activeElement === element);
  await activate(select, touch, device);
  const done = bulkScope.getByRole('button', { name: 'Done', exact: true });
  if (searchOwnedFocus) {
    assert.equal(await done.count(), 0, `${device}: focused template search owns the first outside tap`);
    await activate(select, touch, device);
  }
  await done.waitFor({ state: 'visible' });
  const target = page.getByText('Security Walk-Through', { exact: true }).filter({ visible: true });
  assert.ok(await target.count() >= 1, `${device}: template selection target visible`);
  await activate(target.first(), touch, device);
  const duplicate = bulkScope.getByRole('button', { name: 'Duplicate', exact: true });
  assert.equal(await duplicate.isEnabled(), true, `${device}: template Duplicate enables after selection`);
  await activate(done, touch, device);
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

async function testFetchErrorRetry(page, baseUrl, touch, device) {
  const readySelectors = {
    documents: '[data-document-id]:visible',
    projects: '[data-project-id]:visible',
    templates: device === 'mobile' ? '.templates-mobile-row:visible' : '.templates-editor-grid [data-drag-rearrange-row]:visible',
  };
  for (const tab of EDGE_TABS) {
    await gotoHub(page, baseUrl, tab, { hubError: tab });
    const alert = page.getByRole('alert');
    await alert.waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await alert.innerText(), new RegExp(`Couldn't load ${tab}`, 'i'), `${device}: ${tab} fetch error is explicit`);
    await activate(alert.getByRole('button', { name: 'Try again', exact: true }), touch, device);
    await alert.waitFor({ state: 'hidden', timeout: 15_000 });
    assert.ok(await page.locator(readySelectors[tab]).count() > 0, `${device}: ${tab} retry repopulates the real view`);
  }
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
  await context.route('**/api/analytics/track', (route) => route.fulfill({
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: '',
  }));

  const page = await context.newPage();
  const diagnostics = attachFailureGuards(page, baseUrl, device);
  const touch = device === 'mobile'
    ? await createTouchDriver({ browserName: 'chromium', context, page })
    : null;
  try {
    assert.deepEqual(page.viewportSize(), viewport, `${device}: exact viewport`);
    if (device === 'mobile') assert.equal(touch.inputKind, 'trusted-cdp-touch', 'mobile: trusted touch required');

    if (options.scenario === 'fetch-error-retry') {
      await artifacts.time(`${device}:fetch-error-retry`, () => testFetchErrorRetry(page, baseUrl, touch, device));
      assertHealthy(diagnostics, device);
      artifacts.recordScenario({ certification: CERTIFICATION, device, viewport, input: device === 'mobile' ? touch.inputKind : 'desktop-mouse-keyboard', coverage: 'fetch-error-retry', diagnostics, status: 'passed' });
      return diagnostics;
    }

    await artifacts.time(`${device}:first-visit-tab-frame-continuity`, () => (
      testFirstVisitTabContinuity(page, baseUrl, touch, device)
    ));
    await artifacts.time(`${device}:template-disclosure-icon-parity`, () => (
      testTemplateDisclosureIconParity(page, baseUrl, touch, device)
    ));
    await artifacts.time(`${device}:project-row-team-parity`, () => (
      testProjectRowTeamParity(page, baseUrl, device)
    ));
    await artifacts.time(`${device}:content-type-icon-colors`, () => (
      testContentTypeIconColors(page, baseUrl, device)
    ));
    if (device === 'mobile') {
      await artifacts.time('mobile:safe-area-tabs', () => testMobileSafeAreaTabs(page, baseUrl));
      await artifacts.time('mobile:edge-swipe-back', () => testMobileEdgeSwipeBack(page, baseUrl, touch));
      await artifacts.time('mobile:template-category-row-alignment', () => testMobileTemplateCategoryRowAlignment(page, baseUrl, touch));
      await artifacts.time('mobile:entities-modal-centering', () => testMobileEntitiesModalCentering(page, baseUrl, touch));
    }
    await artifacts.time(`${device}:tab-search-sort-selection`, async () => {
      if (device === 'mobile') await testMobileHeaderParity(page, baseUrl);
      await gotoHub(page, baseUrl, 'documents', {}, { workflow: true });
      await testDocuments(page, touch, device);
      await testProjects(page, touch, device);
      await testTemplates(page, touch, device);
    });
    await artifacts.screenshot(page, `${device}-tabs-search-selection`);

    await artifacts.time(`${device}:edge-fixtures`, () => testEdgeFixtures(page, baseUrl, touch, device));
    await artifacts.time(`${device}:fetch-error-retry`, () => testFetchErrorRetry(page, baseUrl, touch, device));
    await artifacts.time(`${device}:viewer-return`, () => testViewerReturn(page, baseUrl, touch, device));
    await artifacts.time(`${device}:history`, () => testHistory(page, baseUrl, device));
    await page.waitForTimeout(300);
    assertHealthy(diagnostics, device);

    artifacts.recordScenario({
      certification: CERTIFICATION,
      device,
      viewport,
      input: device === 'mobile' ? touch.inputKind : 'desktop-mouse-keyboard',
      coverage: 'first-visit-frame-continuity-template-disclosure-icon-parity-project-row-team-parity-content-type-icon-colors-safe-area-tabs-edge-swipe-back-template-category-row-alignment-entities-modal-centering-search-filter-sort-selection-bulk-state-empty-loading-fetch-error-retry-long-docs-viewer-exact-return-back-forward-refresh',
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

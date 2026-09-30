#!/usr/bin/env node

// DEV-ROUTE / MOCK-AUTH ONLY. Exercises the real PDF viewer through ?testPdf;
// no credentials or backend data are read. External PDF links are intercepted
// in-page so this workflow never navigates away from the local app.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTouchDriver } from '../mobile-annotations/touch.mjs';
import { ensureViteServer } from '../mobile-annotations/vite-server.mjs';
import { activate } from './project-document-ui.mjs';

export const VIEWER_AUXILIARY_VIEWPORTS = Object.freeze({
  mobile: { width: 390, height: 844 },
  desktop: { width: 1512, height: 900 },
});

export const VIEWER_AUXILIARY_FIXTURES = Object.freeze({
  interactive: 'clickable-link-test.pdf',
  search: 'text-search-glyph-lab.pdf',
});

const CRITICAL_RESOURCE_TYPES = new Set([
  'document', 'fetch', 'font', 'script', 'stylesheet', 'worker', 'xhr',
]);

function parseOptions(argv) {
  const options = {
    baseUrl: process.env.MOBILE_QA_BASE_URL || null,
    device: 'all',
    headful: process.env.HEADFUL === '1',
    outputDir: path.resolve('.playwright-mcp', 'viewer-auxiliary'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (name) => {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
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
  if (!['all', 'desktop', 'mobile'].includes(options.device)) {
    throw new Error('--device must be all, desktop, or mobile');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node agent-cli/mobile-workflows/viewer-auxiliary-e2e.mjs [options]

Options:
  --device mobile|desktop|all  Device contract (default: all)
  --base-url <url>             Reuse an existing Survey Vite server
  --output-dir <path>          Artifact root
  --headful                    Show Chromium
  --help                       Show help`);
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
}

async function unique(locator, label) {
  const count = await locator.count();
  assert.equal(count, 1, `${label}: expected one element, found ${count}`);
  return locator;
}

async function activateOne(locator, label, touch, device) {
  await unique(locator, label);
  await activate(locator, touch, device);
}

async function typeTrusted(page, locator, value, label, touch, device) {
  await activateOne(locator, label, touch, device);
  assert.equal(
    await locator.evaluate((element) => document.activeElement === element),
    true,
    `${label}: pointer activation must focus the input before keyboard typing`,
  );
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(value);
}

async function readHitTarget(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      className: typeof target?.className === 'string' ? target.className : target?.getAttribute?.('class') || '',
      interactive: target === element || Boolean(target?.closest?.('.pdfjsFormLayer')),
      tagName: target?.tagName || null,
    };
  });
}

async function waitForPdf(page, expectedPages) {
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction((count) => {
    const pages = document.querySelectorAll('.survey-pdfjs-page-div');
    const firstCanvas = document.querySelector('.survey-pdfjs-page-div canvas');
    const firstForm = document.querySelector('.pdfjsFormLayer');
    return pages.length >= Math.min(count, 6) && firstCanvas?.width > 0 && firstForm;
  }, expectedPages, { timeout: 60_000 });
}

async function pageWidth(page) {
  return page.locator('.survey-pdfjs-page-div[data-page-number="1"]').evaluate((element) => element.offsetWidth);
}

async function pageOrdinal(page, device) {
  if (device === 'mobile') {
    return Number((await page.getByRole('button', { name: 'Jump to page', exact: true }).innerText()).split('/')[0].trim());
  }
  return Number((await page.getByRole('button', { name: 'Edit page number', exact: true }).innerText()).trim());
}

async function waitForPageOrdinal(page, device, expected) {
  const ariaLabel = device === 'mobile' ? 'Jump to page' : 'Edit page number';
  await page.waitForFunction(({ label, value }) => (
    [...document.querySelectorAll(`button[aria-label="${label}"]`)].some((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && button.textContent?.trim().startsWith(String(value));
    })
  ), { label: ariaLabel, value: expected }, { timeout: 15_000 });
}

async function runDevice({ artifactsDir, baseUrl, browser, device, rows, diagnostics }) {
  const viewport = VIEWER_AUXILIARY_VIEWPORTS[device];
  const context = await browser.newContext({
    deviceScaleFactor: device === 'mobile' ? 3 : 1,
    hasTouch: device === 'mobile',
    isMobile: device === 'mobile',
    locale: 'en-US',
    screen: viewport,
    viewport,
  });
  const openedExternalUrls = [];
  await context.addInitScript(() => {
    window.__viewerAuxOpenedUrls = [];
    const captureOpen = (url) => {
      window.__viewerAuxOpenedUrls.push(String(url));
      return null;
    };
    Object.defineProperty(window, 'open', { configurable: true, value: captureOpen, writable: true });
  });
  await context.route(/^https:\/\/claude\.com(?:\/|$)/, async (route) => {
    openedExternalUrls.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  const page = await context.newPage();
  const touch = device === 'mobile'
    ? await createTouchDriver({ browserName: 'chromium', context, page })
    : null;
  const input = device === 'mobile' ? touch.inputKind : 'desktop-mouse-keyboard';
  const deviceDiagnostics = {
    consoleErrors: [],
    criticalFailedRequests: [],
    pageErrors: [],
  };
  diagnostics[device] = deviceDiagnostics;
  page.on('pageerror', (error) => deviceDiagnostics.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') deviceDiagnostics.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (!CRITICAL_RESOURCE_TYPES.has(request.resourceType())) return;
    if (/^https:\/\/claude\.com(?:\/|$)/.test(request.url())) return;
    deviceDiagnostics.criticalFailedRequests.push({
      error: request.failure()?.errorText || 'unknown',
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });

  const screenshot = async (label) => {
    const target = path.join(artifactsDir, `${device}-${safeName(label)}.png`);
    await page.screenshot({ path: target, fullPage: false });
    return target;
  };
  const record = (scenario, fixture, status, evidence) => rows.push({
    device, evidence, fixture, input, scenario, status,
  });

  try {
    const interactiveUrl = `${baseUrl}/?testPdf=${encodeURIComponent(VIEWER_AUXILIARY_FIXTURES.interactive)}`;
    await page.goto(interactiveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPdf(page, 1);
    await page.locator('.pdfjsFormLayer[data-persistence-ready="true"]').waitFor({ state: 'visible', timeout: 15_000 });
    record('real no-auth viewer route', VIEWER_AUXILIARY_FIXTURES.interactive, 'passed', {
      renderedCanvas: true,
      route: new URL(page.url()).search,
      viewport,
    });

    const textField = page.locator('.pdfjsFormLayer input[type="text"]');
    const checkbox = page.locator('.pdfjsFormLayer input[type="checkbox"]');
    await unique(textField, `${device} form text field`);
    await unique(checkbox, `${device} form checkbox`);
    const formValue = `Auxiliary ${device}`;
    const textHitTarget = await readHitTarget(textField);
    let textChanged = false;
    let checkboxChanged = false;
    let checkboxFailure = null;
    let checkboxTransientFailure = null;
    let checkboxInitiallyChecked = null;
    if (textHitTarget.interactive) {
      await activateOne(textField, `${device} form text field`, touch, device);
      await textField.fill(formValue);
      textChanged = (await textField.inputValue()) === formValue;
    }
    await page.keyboard.press('Tab');
    // Let the text field's blur-save acknowledgement reach persistedValues
    // before touching a second widget. A visible fixture widget that still
    // cannot retain state is a product failure, not unavailable coverage.
    await page.waitForTimeout(650);
    const checkboxHitTarget = await readHitTarget(checkbox);
    if (checkboxHitTarget.interactive) {
      checkboxInitiallyChecked = await checkbox.isChecked();
      if (checkboxInitiallyChecked) {
        if (device === 'mobile') await activateOne(checkbox, `${device} form checkbox uncheck`, touch, device);
        else await checkbox.uncheck();
        assert.equal(await checkbox.isChecked(), false, `${device}: checkbox can be unchecked`);
        await page.waitForTimeout(650);
      }
      if (device === 'mobile') await activateOne(checkbox, `${device} form checkbox`, touch, device);
      else {
        try {
          await checkbox.check({ timeout: 3_000 });
        } catch (error) {
          checkboxTransientFailure = error?.message?.split('\n')[0] || String(error);
          await page.waitForTimeout(900);
        }
      }
      checkboxChanged = await checkbox.isChecked();
      if (!checkboxChanged) checkboxFailure = checkboxTransientFailure || 'checkbox remained unchecked';
    }
    await page.keyboard.press('Tab');
    if (textHitTarget.interactive) assert.equal(textChanged, true, `${device}: typed form value`);
    if (checkboxHitTarget.interactive && !checkboxFailure) {
      assert.equal(checkboxChanged, true, `${device}: checkbox value`);
    }
    if (textChanged && checkboxChanged) {
      record('form typing and checking', VIEWER_AUXILIARY_FIXTURES.interactive, 'passed', {
        checked: true,
        checkboxInitiallyChecked,
        checkboxTransientFailure,
        inputMethod: 'trusted pointer focus plus Playwright fill',
        text: formValue,
      });
    } else {
      record('form typing and checking', VIEWER_AUXILIARY_FIXTURES.interactive, 'failed', {
        checkboxChanged,
        checkboxFailure,
        checkboxInitiallyChecked,
        obstructions: { checkbox: checkboxHitTarget, text: textHitTarget },
        reason: checkboxFailure || 'one or more visible PDF form controls did not retain the requested state',
        textChanged,
        text: textChanged ? formValue : '',
      });
    }

    const link = page.locator('[data-pdfjs-link-layer="1"] a[href="https://claude.com/"]');
    const linkCount = await link.count();
    if (linkCount === 1) {
      const beforeUrl = page.url();
      await activate(link, touch, device);
      await page.waitForTimeout(120);
      const captured = await page.evaluate(() => window.__viewerAuxOpenedUrls.slice());
      assert.deepEqual(captured, ['https://claude.com/'], `${device}: external URL captured exactly`);
      assert.equal(page.url(), beforeUrl, `${device}: local viewer must not navigate`);
      record('clickable PDF link safely intercepted', VIEWER_AUXILIARY_FIXTURES.interactive, 'passed', {
        captured,
        localViewerStayedOpen: true,
        networkExternalUrls: openedExternalUrls,
      });
    } else {
      record('clickable PDF link safely intercepted', VIEWER_AUXILIARY_FIXTURES.interactive, 'failed', {
        expectedFixtureAnnotation: 'Link https://claude.com/',
        reason: `real PdfjsLinkLayer exposed ${linkCount} matching anchors`,
      });
    }

    const fitStartWidth = await pageWidth(page);
    if (device === 'mobile') {
      await activateOne(page.getByRole('button', { name: 'Zoom and fit options', exact: true }), 'mobile zoom options', touch, device);
      await activateOne(page.getByRole('option', { name: 'Fit width', exact: true }), 'mobile fit width', touch, device);
      await activateOne(page.getByRole('button', { name: 'More document options', exact: true }), 'mobile more options', touch, device);
    } else {
      await activateOne(page.getByRole('button', { name: 'Fit options', exact: true }), 'desktop fit options', touch, device);
      const desktopFitPage = page.getByText('Fit page', { exact: true });
      await desktopFitPage.waitFor({ state: 'visible', timeout: 10_000 });
      await activateOne(desktopFitPage, 'desktop fit page', touch, device);
    }
    const fittedWidth = await pageWidth(page);
    await activateOne(page.getByRole('button', { name: 'Zoom in', exact: true }), `${device} zoom in`, touch, device);
    await page.waitForTimeout(350);
    const zoomedWidth = await pageWidth(page);
    assert.ok(zoomedWidth > fittedWidth, `${device}: zoom-in must enlarge the page (${fittedWidth} -> ${zoomedWidth})`);
    if (device === 'mobile') {
      await activateOne(page.getByRole('button', { name: 'More document options', exact: true }), 'mobile reopen more options', touch, device);
    }
    await activateOne(page.getByRole('button', { name: 'Zoom out', exact: true }), `${device} zoom out`, touch, device);
    await page.waitForTimeout(350);
    const zoomedOutWidth = await pageWidth(page);
    assert.ok(zoomedOutWidth < zoomedWidth, `${device}: zoom-out must shrink the page (${zoomedWidth} -> ${zoomedOutWidth})`);
    record('zoom in, zoom out, and fit', VIEWER_AUXILIARY_FIXTURES.interactive, 'passed', {
      fitStartWidth, fittedWidth, zoomedOutWidth, zoomedWidth,
    });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPdf(page, 1);
    await page.locator('.pdfjsFormLayer[data-persistence-ready="true"]').waitFor({ state: 'visible', timeout: 15_000 });
    const reloadedText = page.locator('.pdfjsFormLayer input[type="text"]');
    const reloadedCheckbox = page.locator('.pdfjsFormLayer input[type="checkbox"]');
    if (textChanged) assert.equal(await reloadedText.inputValue(), formValue, `${device}: text survives hard reload`);
    if (checkboxChanged) assert.equal(await reloadedCheckbox.isChecked(), true, `${device}: checkbox survives hard reload`);
    record('hard reload form persistence', VIEWER_AUXILIARY_FIXTURES.interactive, textChanged && checkboxChanged ? 'passed' : 'failed', {
      checked: checkboxChanged ? true : false,
      reason: textChanged && checkboxChanged ? undefined : 'one or more visible fixture form controls could not be persisted',
      text: textChanged ? formValue : '',
    });

    const backControl = device === 'mobile'
      ? page.getByRole('button', { name: 'Back to documents', exact: true })
      : page.getByText('Home', { exact: true });
    await activateOne(backControl, `${device} back to documents`, touch, device);
    await page.locator('.survey-pdfjs-page-div').waitFor({ state: 'hidden', timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPdf(page, 1);
    await page.locator('.pdfjsFormLayer[data-persistence-ready="true"]').waitFor({ state: 'visible', timeout: 15_000 });
    if (textChanged) assert.equal(await page.locator('.pdfjsFormLayer input[type="text"]').inputValue(), formValue, `${device}: reopened form value`);
    record('back and reopen', VIEWER_AUXILIARY_FIXTURES.interactive, 'passed', {
      method: 'app back control, then hard reload of unchanged dev fixture route',
      persistedText: textChanged ? formValue : 'form edit unavailable',
    });
    await screenshot('interactive-reopened');

    const searchUrl = `${baseUrl}/?testPdf=${encodeURIComponent(VIEWER_AUXILIARY_FIXTURES.search)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPdf(page, 3);
    if (device === 'mobile') {
      await activateOne(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }), 'mobile open document hub', touch, device);
      await activateOne(page.getByRole('button', { name: 'Search', exact: true }), 'mobile search tab', touch, device);
    } else {
      await activateOne(page.getByRole('button', { name: 'Search text', exact: true }), 'desktop search tab', touch, device);
    }
    const searchBox = page.getByPlaceholder(device === 'mobile' ? 'Search text' : 'Search text in PDF...', { exact: true });
    await searchBox.waitFor({ state: 'visible', timeout: 15_000 });
    await typeTrusted(page, searchBox, 'Small Sync Test Fresh', `${device} PDF text search`, touch, device);
    const nextMatch = page.getByRole('button', { name: 'Next match (Enter)', exact: true });
    await nextMatch.waitFor({ state: 'visible', timeout: 15_000 });
    await activateOne(nextMatch, `${device} next search match`, touch, device);
    await waitForPageOrdinal(page, device, 3);
    assert.equal(await pageOrdinal(page, device), 3, `${device}: search result navigates to page 3`);
    record('PDF text search and result navigation', VIEWER_AUXILIARY_FIXTURES.search, 'passed', {
      query: 'Small Sync Test Fresh',
      targetPage: 3,
    });

    if (device === 'mobile') {
      // Owner 2026-09-30: phone sheets have no close X; a tap outside closes them.
      const backdrop = page.getByRole('button', { name: 'Close document panel', exact: true });
      if (await backdrop.count()) await backdrop.click({ position: { x: 195, y: 150 } });
    }
    await activateOne(page.getByRole('button', { name: 'Previous page', exact: true }), `${device} previous page`, touch, device);
    await waitForPageOrdinal(page, device, 2);
    assert.equal(await pageOrdinal(page, device), 2, `${device}: previous-page navigation`);
    await activateOne(page.getByRole('button', { name: 'Next page', exact: true }), `${device} next page`, touch, device);
    await waitForPageOrdinal(page, device, 3);
    assert.equal(await pageOrdinal(page, device), 3, `${device}: next-page navigation`);
    record('page navigation', VIEWER_AUXILIARY_FIXTURES.search, 'passed', {
      sequence: [3, 2, 3],
    });
    await screenshot('search-page-3');
  } finally {
    await context.close();
  }
}

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const devices = options.device === 'all' ? ['mobile', 'desktop'] : [options.device];
for (const fixture of Object.values(VIEWER_AUXILIARY_FIXTURES)) {
  const fixturePath = path.resolve('debug/fixtures', fixture);
  if (!fs.existsSync(fixturePath)) throw new Error(`Missing PDF fixture: ${fixturePath}`);
}

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const artifactsDir = path.join(options.outputDir, runId);
fs.mkdirSync(artifactsDir, { recursive: true });
const rows = [];
const diagnostics = {};
const startedAt = Date.now();
let browser;
let managedServer;
let finalStatus = 'failed';
let finalError = null;

try {
  const server = await ensureViteServer(options.baseUrl);
  managedServer = server.managedProcess;
  browser = await chromium.launch({ headless: !options.headful });
  const results = await Promise.allSettled(devices.map((device) => runDevice({
    artifactsDir,
    baseUrl: server.baseUrl,
    browser,
    device,
    diagnostics,
    rows,
  })));
  const failures = results
    .map((result, index) => ({ device: devices[index], result }))
    .filter(({ result }) => result.status === 'rejected');
  if (failures.length) {
    throw new Error(failures.map(({ device, result }) => `${device}: ${result.reason?.stack || result.reason}`).join('\n\n'));
  }
  const hardDiagnostics = Object.entries(diagnostics).flatMap(([device, value]) => [
    ...value.pageErrors.map((error) => `${device} pageerror: ${error}`),
    ...value.criticalFailedRequests.map((request) => `${device} requestfailed: ${request.method} ${request.url} (${request.error})`),
  ]);
  if (hardDiagnostics.length) throw new Error(`Browser diagnostics:\n${hardDiagnostics.join('\n')}`);
  const failedRows = rows.filter((row) => row.status === 'failed');
  if (failedRows.length) {
    throw new Error(`Viewer auxiliary product failures:\n${failedRows.map((row) => `${row.device}: ${row.scenario}: ${row.evidence?.reason || 'failed'}`).join('\n')}`);
  }
  finalStatus = rows.some((row) => row.status === 'unavailable') ? 'passed-with-unavailable' : 'passed';
  console.log('RESULT: PASS');
} catch (error) {
  finalError = error;
  console.error('RESULT: FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedServer?.kill('SIGTERM');
  const summaryPath = path.join(artifactsDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    status: finalStatus,
    runId,
    durationMs: Date.now() - startedAt,
    devices,
    fixtures: VIEWER_AUXILIARY_FIXTURES,
    viewports: VIEWER_AUXILIARY_VIEWPORTS,
    rows,
    diagnostics,
    error: finalError ? { message: finalError.message, stack: finalError.stack } : null,
  }, null, 2)}\n`);
  console.log(`artifacts: ${summaryPath}`);
}

#!/usr/bin/env node

// Mobile Documents memory/crash regression.
// Loads far more PDF-backed rows than fit in the viewport, idles, opens one,
// idles in the viewer, and returns. The list must never eagerly materialize
// every high-resolution first-page preview.

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ensureViteServer } from '../mobile-annotations/vite-server.mjs';

const documentCount = Number(process.env.DOCUMENT_STRESS_COUNT || 60);
const visibleThumbBudget = Number(process.env.DOCUMENT_THUMB_BUDGET || 16);
const listIdleMs = Number(process.env.DOCUMENT_LIST_IDLE_MS || 8_000);

const server = await ensureViteServer(process.env.MOBILE_QA_BASE_URL || null);
const baseUrl = server.baseUrl;
let browser;
try {
browser = await chromium.launch({ headless: process.env.HEADFUL !== '1' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

const failures = [];
const consoleMessages = [];
const page = await context.newPage();
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
page.on('crash', () => failures.push('page crashed'));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  }
});

await page.addInitScript(({ count }) => {
  const now = Date.now();
  const documents = Array.from({ length: count }, (_, index) => ({
    id: `idle-stress-${index}`,
    name: `Idle stress ${String(index + 1).padStart(2, '0')}.pdf`,
    file_size: 23_000,
    project_id: null,
    owner: 'IC',
    pages: 1,
    created_at: new Date(now - index * 86_400_000).toISOString(),
    updated_at: new Date(now - index * 3_600_000).toISOString(),
    dataUrl: '/debug-fixtures/clickable-link-test.pdf',
  }));
  localStorage.setItem('mobileWorkflowDocuments', JSON.stringify(documents));
  localStorage.setItem('mobileWorkflowProjects', '[]');
  localStorage.setItem('mobileWorkflowTemplates', '[]');
}, { count: documentCount });

const route = `${baseUrl}/?hubPreview=1&workflowE2E=1&tab=documents&mobileNav=tabs&nativeShell=expo`;
await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
const rows = page.locator('.mobile-doc-card');
await rows.first().waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForTimeout(listIdleMs);

const listState = await page.evaluate(() => ({
  rows: document.querySelectorAll('.mobile-doc-card').length,
  renderedThumbs: document.querySelectorAll('.mobile-doc-card img').length,
  fallbackThumbs: document.querySelectorAll('.mobile-doc-card .pdf-thumb').length,
  loadingThumbs: document.querySelectorAll('.mobile-doc-card .mobile-doc-thumbnail > div:not(.pdf-thumb)').length,
  domNodes: document.querySelectorAll('*').length,
  alive: Boolean(document.body),
}));

await page.locator('.documents-mobile-list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
await page.waitForTimeout(8_000);
const scrolledState = await page.evaluate(() => ({
  renderedThumbs: document.querySelectorAll('.mobile-doc-card img').length,
  alive: Boolean(document.body),
}));

await rows.last().click();
await page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 });
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('canvas')).some((canvas) => canvas.width > 100 && canvas.height > 100),
  undefined,
  { timeout: 30_000 },
);
await page.waitForTimeout(8_000);
const viewerState = await page.evaluate(() => ({
  alive: Boolean(document.body),
  painted: Array.from(document.querySelectorAll('canvas')).some((canvas) => canvas.width > 100 && canvas.height > 100),
  frameworkError: /Uncaught Runtime Error|Internal Server Error|Something went wrong/i.test(document.body?.innerText || ''),
}));

assert.equal(listState.rows, documentCount, 'stress fixture renders every document row');
assert.ok(listState.renderedThumbs >= 1, 'near-viewport document thumbnails finish rendering');
assert.ok(listState.renderedThumbs <= visibleThumbBudget,
  `only near-viewport thumbnails render (${listState.renderedThumbs} > ${visibleThumbBudget})`);
assert.ok(scrolledState.renderedThumbs >= 1, 'new near-viewport thumbnails render after scrolling');
assert.ok(scrolledState.renderedThumbs <= visibleThumbBudget,
  `off-screen thumbnails release after scrolling (${scrolledState.renderedThumbs} > ${visibleThumbBudget})`);
assert.equal(listState.alive, true, 'Documents page remains alive while idle');
assert.equal(scrolledState.alive, true, 'Documents page remains alive after scrolling');
assert.equal(viewerState.alive, true, 'viewer remains alive while idle');
assert.equal(viewerState.painted, true, 'viewer stays painted while idle');
assert.equal(viewerState.frameworkError, false, 'viewer has no crash overlay');
assert.deepEqual(failures, [], 'no page crash or uncaught error');
assert.deepEqual(consoleMessages.filter((message) => message.includes('[PdfPageThumb]')), [], 'thumbnail rendering has no resource errors');

console.log('RESULT: PASS');
console.log(JSON.stringify({ listState, scrolledState, viewerState, failures, consoleMessages }, null, 2));

await context.close();
} finally {
  await browser?.close().catch(() => {});
  server.managedProcess?.kill('SIGTERM');
}

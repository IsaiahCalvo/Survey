import { test, expect } from '@playwright/test';

import { LINK_CLUSTER } from '../../tests/helpers/buildLinkClusterPdf.mjs';

// Native PDF Link / URL / mailto / page-jump cluster.
// Not a replay of wave 5–11, flatten, survey-marker, move-up-down,
// insert-blank, rotate-ccw, leftover-18, or official npm test.
// No create/edit Link tool exists — do not invent one.

const CLAUDE_PDF = '/?testPdf=clickable-link-test.pdf';
const CLUSTER_PDF = '/?testPdf=e2e-link-cluster.pdf';

async function captureOpens(page) {
  await page.addInitScript(() => {
    window.__pdfLinkOpenedUrls = [];
    const capture = (url) => {
      window.__pdfLinkOpenedUrls.push(String(url));
      return null;
    };
    Object.defineProperty(window, 'open', { configurable: true, value: capture, writable: true });
  });
}

async function openEditor(page, fixture) {
  await captureOpens(page);
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
}

async function openedUrls(page) {
  return page.evaluate(() => window.__pdfLinkOpenedUrls.slice());
}

async function linkLayerHrefs(page, pageNumber = 1) {
  const layer = page.locator(`[data-pdfjs-link-layer="${pageNumber}"]`);
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return layer.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute('href'),
    title: node.getAttribute('title'),
    pointerEvents: getComputedStyle(node).pointerEvents,
  })));
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

test('native PDF links: click-through + adversarial schemes + page-jump', async ({ page }) => {
  const hunts = [];

  await openEditor(page, CLAUDE_PDF);
  const claudeHrefs = await linkLayerHrefs(page, 1);
  const claudeLink = page.locator('[data-pdfjs-link-layer="1"] a[href="https://claude.com/"]');
  await expect(claudeLink).toHaveCount(1);
  const beforeUrl = page.url();
  await claudeLink.click();
  await expect.poll(async () => openedUrls(page)).toEqual(['https://claude.com/']);
  expect(page.url()).toBe(beforeUrl);
  hunts.push({
    hunt: 'intended — fixture https://claude.com/ opens externally, viewer stays',
    pass: true,
    hrefs: claudeHrefs,
  });

  await activateTool(page, 'Draw', 'Pen');
  const armed = await linkLayerHrefs(page, 1);
  expect(armed.every((row) => row.pointerEvents === 'none')).toBeTruthy();
  const beforeArmed = await openedUrls(page);
  await claudeLink.click({ force: true });
  expect(await openedUrls(page)).toEqual(beforeArmed);
  hunts.push({
    hunt: 'break — Pen armed disables link pointer-events; force-click no-ops',
    pass: true,
    pointerEvents: armed.map((row) => row.pointerEvents),
  });

  const drawLabels = [];
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  drawLabels.push(...await page.locator('#chrome-sub-toolbar-host button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent || '')));
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  const shapeLabels = await page.locator('#chrome-sub-toolbar-host button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent || ''));
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const textLabels = await page.locator('#chrome-sub-toolbar-host button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent || ''));
  const catalog = [...drawLabels, ...shapeLabels, ...textLabels].join(' | ').toLowerCase();
  expect(catalog).not.toMatch(/\blink\b|\burl\b|\bmailto\b|\bstamp\b|\bimage\b|\bphoto\b/);
  hunts.push({
    hunt: 'edge — no create/edit Link/URL/mailto/stamp tool in Draw/Shapes/Text',
    pass: true,
    drawLabels,
    shapeLabels,
    textLabels,
  });

  await openEditor(page, CLUSTER_PDF);
  const clusterHrefs = await linkLayerHrefs(page, 1);
  const hrefs = clusterHrefs.map((row) => row.href);
  expect(hrefs).toContain(LINK_CLUSTER.https);
  expect(hrefs).toContain(LINK_CLUSTER.mailto);
  expect(hrefs).toContain('#');
  expect(hrefs.some((href) => /javascript:|data:|file:|ftp:/i.test(href || ''))).toBe(false);
  expect(clusterHrefs.some((row) => /javascript:|data:|file:|ftp:/i.test(row.title || ''))).toBe(false);
  hunts.push({
    hunt: 'break — javascript/data/file/ftp never become clickable hrefs',
    pass: true,
    hrefs: clusterHrefs,
  });

  await page.evaluate(() => { window.__pdfLinkOpenedUrls = []; });
  await page.locator(`[data-pdfjs-link-layer="1"] a[href="${LINK_CLUSTER.https}"]`).click();
  await page.locator(`[data-pdfjs-link-layer="1"] a[href="${LINK_CLUSTER.mailto}"]`).click();
  await expect.poll(async () => openedUrls(page)).toEqual([
    LINK_CLUSTER.https,
    LINK_CLUSTER.mailto,
  ]);
  hunts.push({
    hunt: 'intended — generated https + mailto open; viewer does not navigate',
    pass: true,
    opened: await openedUrls(page),
    url: page.url(),
  });

  const dest = page.locator('[data-pdfjs-link-layer="1"] a[title="Go to page"]');
  await expect(dest).toHaveCount(1);
  await dest.click();
  await expect(page.getByLabel('Edit page number')).toHaveText('2', { timeout: 15_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible();
  hunts.push({
    hunt: 'intended — dest GoTo jumps to page 2',
    pass: true,
  });

  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(page.getByLabel('Edit page number')).toHaveText('1', { timeout: 10_000 });
  const beforeDestOpen = await openedUrls(page);
  await dest.click();
  await expect(page.getByLabel('Edit page number')).toHaveText('2', { timeout: 15_000 });
  expect(await openedUrls(page)).toEqual(beforeDestOpen);
  hunts.push({
    hunt: 'edge — dest click does not also window.open',
    pass: true,
  });

  console.log('PDF_LINKS', JSON.stringify({
    leftover18: 'unchanged',
    hunts,
  }));
});

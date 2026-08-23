import { test, expect } from '@playwright/test';

// ?testPdf= Sync chip must stay hidden (no file.id). Unique leftover after
// hub Account menuitem (`46ffa455` / `f4a8a077`). Mock developer had
// cloudSync: true, so entitlement mounted a perpetual "Syncing… checking
// live collaboration" footer. Distinct from leftover-18 / X-01 cloud persist /
// UL-44 signed-in Retry / nameless-menu / rail-toggle / dismiss / Home `?` /
// remapped-after-CW. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function syncChrome(page) {
  return {
    syncing: await page.getByRole('button', { name: /Syncing/i }).count(),
    sync: await page.getByRole('button', { name: /^Sync$/i }).count(),
    retry: await page.getByRole('button', { name: 'Retry now', exact: true }).count(),
    saveVersion: await page.getByRole('button', { name: 'Save version', exact: true }).count(),
    checking: await page.getByRole('button', { name: /checking whether this document uses live collaboration/i }).count(),
    preview: await page.locator('[data-sync-chip-preview]').count(),
  };
}

test('intended: ?testPdf= hides entitlement Sync chip; DEV preview host stays opt-in', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  const before = await syncChrome(page);
  expect(before.syncing).toBe(0);
  expect(before.checking).toBe(0);
  expect(before.retry).toBe(0);
  expect(before.saveVersion).toBe(0);
  expect(before.preview).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');

  await page.evaluate(() => {
    window.__test_setSyncChipPreview?.({ status: { stage: 'pending' }, queueSize: 1 });
  });
  await expect(page.locator('[data-sync-chip-preview]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Saving/i })).toHaveCount(1);

  await page.evaluate(() => {
    window.__test_setSyncChipPreview?.(null);
  });
  await expect(page.locator('[data-sync-chip-preview]')).toHaveCount(0);
  expect((await syncChrome(page)).checking).toBe(0);
});

test('break + edge: hub / empty / 390 do not invent cloud sync; hidden tools stay 0', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect((await syncChrome(page)).checking).toBe(0);
  expect((await syncChrome(page)).saveVersion).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);

  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const beforeIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((node) => node.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const afterIds = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((node) => node.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
  expect(afterIds).toEqual(beforeIds);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('button', { name: /checking whether this document uses live collaboration/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Up to date\. Tap to sync now/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /unavailable\. undefined/i }).count()).toBe(0);
  const unavailable = page.getByRole('button', { name: /Cloud sync unavailable/i });
  if (await unavailable.count()) {
    await expect(unavailable.first()).toBeDisabled();
    await expect(unavailable.first()).toHaveAttribute('aria-label', 'Cloud sync unavailable');
  }
  expect(await fileId(page)).toBeNull();
});

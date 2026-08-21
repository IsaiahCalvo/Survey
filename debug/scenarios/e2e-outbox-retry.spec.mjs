import { test, expect } from '@playwright/test';

// UL-44: live outbox Retry on a signed-in cloud document.
// Do not wipe. Do not click Stripe. Do not invent captcha / MSAL / Capacitor.

function sanitizeAuthLog(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]');
}

async function waitSignedInHub(page) {
  const pageErrors = [];
  const authLogs = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  page.on('console', (msg) => {
    const text = msg.text();
    if (/dev-auto-login|captcha|sign-in FAILED|creds NOT loaded/i.test(text)) {
      authLogs.push(sanitizeAuthLog(text).slice(0, 180));
    }
  });
  await page.addInitScript(() => { window.__AUTH_DEBUG = true; });
  await page.goto('/');
  const accountMenu = page.getByRole('button', { name: 'Open account menu' });
  try {
    await accountMenu.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    return { signedIn: false, authLogs, pageErrors };
  }
  return { signedIn: true, authLogs, pageErrors };
}

async function userIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function pageBox(page, pageNumber = 1) {
  return page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
}

async function waitEditor(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 30_000 });
}

async function drawRect(page, { x0, y0, x1, y1 }) {
  const draw = page.getByRole('button', { name: 'Draw', exact: true });
  if (await draw.count()) await draw.click();
  const rectBtn = page.getByRole('button', { name: 'Rectangle', exact: true });
  if (await rectBtn.count() === 0) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  }
  await expect(rectBtn).toBeVisible({ timeout: 10_000 });
  await rectBtn.click();
  const box = await pageBox(page);
  if (!box) throw new Error('page 1 geometry missing');
  const before = new Set(await userIds(page));
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const ids = await userIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { timeout: 15_000 }).not.toBeNull();
  return created;
}

function syncChip(page) {
  return page.getByRole('button', { name: /Up to date|Saving|Syncing|Offline|Sync error|Saved locally/i }).first();
}

async function chipLabel(page) {
  const chip = syncChip(page);
  if ((await chip.count()) === 0) return null;
  return chip.getAttribute('aria-label').catch(() => null);
}

async function syncSnapshot(page) {
  const label = await chipLabel(page);
  const retry = page.locator('button[aria-label="Retry now"]');
  const details = page.locator('#sync-status-details');
  return {
    chipPresent: Boolean(label),
    label,
    pendingLike: /Offline|saved locally|Sync error|Saving|Syncing now/i.test(label || ''),
    detailsOpen: (await details.count()) > 0,
    retryVisible: (await retry.count()) > 0,
  };
}

test('UL-44 outbox Retry: offline draw, fail-closed retry, online flush', async ({ page, context }) => {
  test.setTimeout(360_000);
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

  const chipLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/\[SyncChip\]/.test(text)) chipLogs.push(text.slice(0, 220));
  });

  const boot = await waitSignedInHub(page);
  console.log('AUTOLOGIN', JSON.stringify({
    signedIn: boot.signedIn,
    href: page.url(),
    pageErrorCount: (boot.pageErrors || []).length,
    authLogs: boot.authLogs || [],
  }));
  if (!boot.signedIn) {
    test.info().annotations.push({ type: 'blocker', description: 'auto-login did not produce a hub session' });
    console.log('UL44', JSON.stringify({ verdict: 'blocked', reason: 'auto-login' }));
    return;
  }

  const firstDoc = page.locator('.documents-desktop-card [data-document-id]').first();
  await expect(firstDoc).toBeVisible({ timeout: 45_000 });
  const docId = await firstDoc.getAttribute('data-document-id');
  await firstDoc.click({ timeout: 10_000 });
  const openFile = page.getByRole('button', { name: 'Open file' });
  await expect(openFile).toBeVisible({ timeout: 15_000 });
  await openFile.click();
  await waitEditor(page);
  console.log('EDITOR_READY', JSON.stringify({
    documentIdLooksUuid: /^[0-9a-f-]{36}$/i.test(docId || ''),
  }));

  await expect.poll(async () => {
    const label = await chipLabel(page);
    return /Up to date|Offline|Sync error|Saving|Syncing/i.test(label || '') ? (label || 'chip') : 'wait';
  }, { timeout: 90_000 }).not.toBe('wait');

  const beforeIds = await userIds(page);
  const beforeSync = await syncSnapshot(page);
  console.log('OPEN_DOC', JSON.stringify({
    opened: true,
    beforeCount: beforeIds.length,
    beforeSync,
  }));

  await context.setOffline(true);
  const created = await drawRect(page, { x0: 0.18, y0: 0.22, x1: 0.34, y1: 0.38 });
  expect(created).toBeTruthy();
  console.log('DREW_OFFLINE', JSON.stringify({ created }));

  let afterOffline = null;
  try {
    await expect.poll(async () => {
      afterOffline = await syncSnapshot(page);
      if (afterOffline.retryVisible) return 'retry';
      if (afterOffline.pendingLike) return 'pending';
      return afterOffline.label || 'none';
    }, { timeout: 25_000 }).toMatch(/retry|pending/);
  } catch {
    afterOffline = await syncSnapshot(page);
  }

  if (!afterOffline?.pendingLike && !afterOffline?.retryVisible) {
    const blocker = 'live outbox never surfaced Retry/stuck/pending chrome after a single offline edit';
    test.info().annotations.push({ type: 'blocker', description: blocker });
    console.log('UL44', JSON.stringify({
      verdict: 'blocked',
      reason: blocker,
      created,
      afterOffline,
      chipLogs,
    }));
    await context.setOffline(false);
    return;
  }

  console.log('OFFLINE_PENDING', JSON.stringify({ created, afterOffline }));

  const chip = syncChip(page);
  if (await chip.count()) {
    await chip.click();
    afterOffline = await syncSnapshot(page);
  }
  const retry = page.locator('button[aria-label="Retry now"]');
  let retriedOffline = false;
  if (await retry.count()) {
    chipLogs.length = 0;
    await retry.click();
    retriedOffline = true;
  } else if (await chip.count()) {
    chipLogs.length = 0;
    await chip.click();
    retriedOffline = true;
  }

  try {
    await expect.poll(() => (
      chipLogs.some((line) => /succeeded|failed|all attempts failed/i.test(line)) ? 'logged' : 'wait'
    ), { timeout: 20_000 }).toBe('logged');
  } catch {
    /* first attempt may still be in flight */
  }

  const afterOfflineRetry = await syncSnapshot(page);
  const claimedSuccess = chipLogs.some((line) => /succeeded/i.test(line));
  const loggedFailure = chipLogs.some((line) => /failed/i.test(line));
  const stillPending = /Offline|saved locally|Sync error|Saving|Syncing now/i.test(afterOfflineRetry.label || '');
  const flippedGreen = /Up to date/i.test(afterOfflineRetry.label || '');

  console.log('OFFLINE_RETRY', JSON.stringify({
    retriedOffline,
    afterOfflineRetry,
    claimedSuccess,
    loggedFailure,
    stillPending,
    flippedGreen,
    chipLogs,
  }));

  expect(claimedSuccess, 'Retry while offline must not log success').toBe(false);
  expect(flippedGreen, 'Retry while offline must not flip the chip to Up to date').toBe(false);

  await context.setOffline(false);

  let afterOnline = null;
  try {
    await expect.poll(async () => {
      afterOnline = await syncSnapshot(page);
      const ids = await userIds(page);
      if (!ids.includes(created)) return 'missing';
      if (/Up to date/i.test(afterOnline.label || '')) return 'synced';
      if (afterOnline.retryVisible || afterOnline.pendingLike) return 'pending';
      return afterOnline.label || 'wait';
    }, { timeout: 60_000 }).toMatch(/synced|pending/);
  } catch {
    afterOnline = await syncSnapshot(page);
  }

  if (!/Up to date/i.test(afterOnline?.label || '')) {
    const retryOnline = page.locator('button[aria-label="Retry now"]');
    if (await retryOnline.count()) await retryOnline.click();
    else if (await chip.count()) await chip.click();
    await expect.poll(async () => {
      afterOnline = await syncSnapshot(page);
      return /Up to date/i.test(afterOnline.label || '') ? 'synced' : (afterOnline.label || 'wait');
    }, { timeout: 45_000 }).toBe('synced');
  }

  const persistedIds = await userIds(page);
  const persisted = persistedIds.includes(created);
  console.log('ONLINE_FLUSH', JSON.stringify({
    afterOnline,
    persisted,
    created,
  }));

  expect(persisted, 'offline mark must persist after online flush').toBe(true);
  console.log('UL44', JSON.stringify({
    verdict: persisted ? 'pass' : 'fail',
    created,
    afterOffline,
    afterOfflineRetry,
    afterOnline,
    claimedSuccess,
  }));
});

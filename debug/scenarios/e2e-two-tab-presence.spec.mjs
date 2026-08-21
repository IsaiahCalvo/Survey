import { test, expect } from '@playwright/test';

// A-06 / UL-45 leftover: same-user two tabs / two contexts on one real doc.
// Not a second account. Do not wipe, Stripe, MSAL, captcha, or apply migrations.

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

async function waitHubDocs(page) {
  const firstDoc = page.locator('.documents-desktop-card [data-document-id]').first();
  await expect.poll(async () => {
    if (await firstDoc.count()) return 'docs';
    if (await page.getByText(/could not be loaded|Failed to load/i).count()) return 'error';
    if (await page.getByText('No documents yet').first().isVisible().catch(() => false)) return 'empty';
    return 'loading';
  }, { timeout: 45_000 }).toBe('docs');
}

async function openDocument(page, documentId) {
  await waitHubDocs(page);
  const card = documentId
    ? page.locator(`.documents-desktop-card [data-document-id="${documentId}"]`).first()
    : page.locator('.documents-desktop-card [data-document-id]').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const id = await card.getAttribute('data-document-id');
  await card.click({ timeout: 10_000 });
  const openFile = page.getByRole('button', { name: 'Open file' });
  await expect(openFile).toBeVisible({ timeout: 15_000 });
  await openFile.click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  return id;
}

function presenceCaption(page) {
  return page.getByText(/just you|\d+ viewing/i);
}

async function expandPresenceRail(page) {
  if ((await presenceCaption(page).count()) > 0) return;
  // Collapsed rail uses compact PresenceAvatars: alone = no "just you" caption.
  const pages = page.getByRole('button', { name: 'Pages' });
  if (await pages.count()) await pages.click();
  await expect(presenceCaption(page)).toBeVisible({ timeout: 15_000 });
}

async function readPresence(page) {
  await expandPresenceRail(page);
  const loc = presenceCaption(page);
  const visible = await loc.count();
  const caption = visible ? (await loc.first().textContent())?.trim() || null : null;
  const viewingMatch = /(\d+)\s+viewing/i.exec(caption || '');
  const viewingCount = viewingMatch ? Number(viewingMatch[1]) : (caption === 'just you' ? 1 : null);
  return {
    visible: visible > 0,
    caption,
    viewingCount,
    twoClientRoster: typeof viewingCount === 'number' && viewingCount >= 2,
  };
}

async function userIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
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
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
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

test('A-06 same-user two tabs / two contexts on one real document', async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

  const boot = await waitSignedInHub(page);
  console.log('AUTOLOGIN', JSON.stringify({
    signedIn: boot.signedIn,
    href: page.url(),
    pageErrorCount: (boot.pageErrors || []).length,
    authLogs: boot.authLogs || [],
  }));
  if (!boot.signedIn) {
    test.info().annotations.push({ type: 'blocker', description: 'auto-login did not produce a hub session' });
    return;
  }

  const documentId = await openDocument(page);
  await expect.poll(async () => (await readPresence(page)).visible, { timeout: 20_000 }).toBe(true);
  const oneTab = await readPresence(page);
  console.log('PRESENCE_ONE_TAB', JSON.stringify({
    ...oneTab,
    documentIdLooksUuid: /^[0-9a-f-]{36}$/i.test(documentId || ''),
  }));

  const tab2 = await context.newPage();
  tab2.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await tab2.addInitScript(() => { window.__AUTH_DEBUG = true; });
  await tab2.goto('/');
  await expect(tab2.getByRole('button', { name: 'Open account menu' })).toBeVisible({ timeout: 45_000 });
  const tab2DocId = await openDocument(tab2, documentId);
  await expect.poll(async () => (await readPresence(tab2)).visible, { timeout: 20_000 }).toBe(true);
  await page.bringToFront();
  await expect.poll(async () => (await readPresence(page)).visible, { timeout: 20_000 }).toBe(true);

  const bothIdleTab1 = await readPresence(page);
  const bothIdleTab2 = await readPresence(tab2);
  console.log('PRESENCE_TWO_TABS_IDLE', JSON.stringify({
    sameDocument: tab2DocId === documentId,
    tab1: bothIdleTab1,
    tab2: bothIdleTab2,
    dedupedToOneRow: !bothIdleTab1.twoClientRoster && !bothIdleTab2.twoClientRoster,
  }));

  const markId = await drawRect(tab2, { x0: 0.18, y0: 0.22, x1: 0.34, y1: 0.38 });
  await page.waitForTimeout(2500);
  const afterDrawTab1 = await readPresence(page);
  const afterDrawTab2 = await readPresence(tab2);
  console.log('PRESENCE_ONE_DRAWING', JSON.stringify({
    drewOn: 'tab2',
    markCreated: Boolean(markId),
    tab1: afterDrawTab1,
    tab2: afterDrawTab2,
    stillDeduped: !afterDrawTab1.twoClientRoster && !afterDrawTab2.twoClientRoster,
  }));

  await tab2.close();
  await page.bringToFront();
  await expect.poll(async () => (await readPresence(page)).visible, { timeout: 20_000 }).toBe(true);
  const afterClose = await readPresence(page);
  console.log('PRESENCE_AFTER_TAB2_CLOSE', JSON.stringify({
    tab1: afterClose,
    droppedToOne: afterClose.caption === 'just you' || afterClose.viewingCount === 1,
  }));

  const storage = await context.storageState();
  const context2 = await browser.newContext({
    storageState: storage,
    viewport: { width: 1440, height: 900 },
  });
  const ctxPage = await context2.newPage();
  ctxPage.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await ctxPage.addInitScript(() => { window.__AUTH_DEBUG = true; });
  await ctxPage.goto('/');
  await expect(ctxPage.getByRole('button', { name: 'Open account menu' })).toBeVisible({ timeout: 45_000 });
  await openDocument(ctxPage, documentId);
  await expect.poll(async () => (await readPresence(ctxPage)).visible, { timeout: 20_000 }).toBe(true);
  await page.bringToFront();
  const twoCtxTab1 = await readPresence(page);
  const twoCtxTab2 = await readPresence(ctxPage);
  console.log('PRESENCE_TWO_CONTEXTS', JSON.stringify({
    tab1: twoCtxTab1,
    context2: twoCtxTab2,
    sameSessionNotSecondAccount: true,
    dedupedToOneRow: !twoCtxTab1.twoClientRoster && !twoCtxTab2.twoClientRoster,
  }));
  await context2.close();
  await page.bringToFront();
  await expect.poll(async () => (await readPresence(page)).visible, { timeout: 20_000 }).toBe(true);
  const afterCtxClose = await readPresence(page);
  console.log('PRESENCE_AFTER_CONTEXT2_CLOSE', JSON.stringify({
    tab1: afterCtxClose,
    droppedToOne: afterCtxClose.caption === 'just you' || afterCtxClose.viewingCount === 1,
  }));

  const everTwo = [bothIdleTab1, bothIdleTab2, afterDrawTab1, afterDrawTab2, twoCtxTab1, twoCtxTab2]
    .some((row) => row.twoClientRoster);
  console.log('A06_VERDICT', JSON.stringify({
    twoClientRoster: everTwo,
    blockerIfFalse: 'same-user two tabs/contexts are deduped to one presence row / just you',
    remainingShowsSelf: afterCtxClose.visible && (afterCtxClose.caption === 'just you' || afterCtxClose.viewingCount === 1),
    uiClaimedMultiViewer: [bothIdleTab1, bothIdleTab2, afterDrawTab1, afterDrawTab2, twoCtxTab1, twoCtxTab2]
      .some((row) => row.twoClientRoster),
  }));

  expect(oneTab.visible, 'single-tab self row should be visible').toBe(true);
  expect(afterClose.visible, 'remaining tab should keep a presence caption after tab2 close').toBe(true);
});

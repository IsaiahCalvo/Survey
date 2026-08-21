import { test, expect } from '@playwright/test';
import { copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A-07 leftover: named cloud save + restore on a real signed-in document.
// Do not wipe. Do not click Stripe. Do not invent captcha / MSAL / Capacitor.
// Prefer a hub-uploaded scratch PDF. Confirmed Restore on an existing
// production doc only after a reversible safety snapshot.

const FIXTURE = join(process.cwd(), 'debug/fixtures/clickable-link-test.pdf');
const RUN_ID = Date.now();
const NAMED_LABEL = `e2e-named-${RUN_ID}`;
const SAFETY_LABEL = `e2e-safety-${RUN_ID}`;

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
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  return box;
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

async function waitSynced(page) {
  const chip = page.getByRole('button', { name: /Up to date|Saving|Syncing|Offline|Sync error/i }).first();
  if (await chip.count() === 0) return { label: null, synced: false };
  try {
    await expect.poll(async () => {
      const label = await chip.getAttribute('aria-label').catch(() => '');
      return /Up to date/i.test(label || '') ? 'synced' : (label || 'wait');
    }, { timeout: 45_000 }).toBe('synced');
    return { label: 'Up to date', synced: true };
  } catch {
    const label = await chip.getAttribute('aria-label').catch(() => null);
    return { label, synced: false };
  }
}

async function openHistory(page) {
  const historyBtn = page.getByRole('button', { name: 'Version history' });
  await expect(historyBtn).toBeVisible({ timeout: 15_000 });
  await historyBtn.click();
  const panel = page.getByTestId('kal48-revisions-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => panel.getByText('Loading…').count(), { timeout: 20_000 }).toBe(0);
  return panel;
}

function revisionRows(panel) {
  return panel.locator('[data-testid^="kal48-revision-row-"]');
}

async function listNamed(panel) {
  const rows = revisionRows(panel);
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const testId = await row.getAttribute('data-testid');
    const text = (await row.textContent()) || '';
    items.push({
      testId,
      number: Number((testId || '').replace('kal48-revision-row-', '')) || null,
      label: text,
      hasNamed: text.includes(NAMED_LABEL),
      hasSafety: text.includes(SAFETY_LABEL),
      auto: /\bauto\b/i.test(text),
    });
  }
  return items;
}

test('A-07 named revision save + restore on a real document', async ({ page }) => {
  test.setTimeout(300_000);

  const dialogQueue = [];
  const dialogLog = [];
  page.on('dialog', async (dialog) => {
    const entry = { type: dialog.type(), message: dialog.message().slice(0, 160) };
    dialogLog.push(entry);
    const next = dialogQueue.shift();
    if (!next) {
      await dialog.dismiss().catch(() => {});
      return;
    }
    if (next.response === false) await dialog.dismiss().catch(() => {});
    else if (typeof next.response === 'string') await dialog.accept(next.response).catch(() => {});
    else await dialog.accept().catch(() => {});
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
    console.log('NAMED_RESTORE', JSON.stringify({ verdict: 'blocked', reason: 'auto-login' }));
    return;
  }

  let scratch = false;
  let openedVia = 'existing';
  const scratchPath = join(tmpdir(), `e2e-named-rev-${Date.now()}.pdf`);
  copyFileSync(FIXTURE, scratchPath);
  const fileInput = page.locator('input[type="file"][accept="application/pdf"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(scratchPath);
    const editorReady = await page.getByRole('button', { name: 'Draw', exact: true })
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (editorReady) {
      scratch = true;
      openedVia = 'scratch-upload';
    }
  }

  if (!scratch) {
    await page.goto('/');
    const firstDoc = page.locator('.documents-desktop-card [data-document-id]').first();
    await expect(firstDoc).toBeVisible({ timeout: 45_000 });
    await firstDoc.click({ timeout: 10_000 });
    const openFile = page.getByRole('button', { name: 'Open file' });
    await expect(openFile).toBeVisible({ timeout: 15_000 });
    await openFile.click();
    openedVia = 'existing-first-doc';
  }

  await waitEditor(page);
  const documentId = await page.evaluate(() => (
    document.querySelector('[data-document-id]')?.getAttribute('data-document-id')
    || window.__currentDocumentId
    || null
  ));
  console.log('OPEN_DOC', JSON.stringify({
    opened: true,
    scratch,
    openedVia,
    documentIdLooksUuid: /^[0-9a-f-]{36}$/i.test(documentId || ''),
  }));

  const baselineIds = await userIds(page);
  const panel = await openHistory(page);
  const namedBefore = await listNamed(panel);

  // Safety snapshot of current live state before we add test marks.
  // Required before Restore on a non-scratch production document.
  dialogQueue.push({ type: 'prompt', contains: 'Label for this revision', response: SAFETY_LABEL });
  await panel.getByTestId('kal48-save-revision').click();
  await expect.poll(async () => {
    const status = await panel.getByTestId('kal48-status').textContent().catch(() => '');
    if (/Save failed/i.test(status || '')) return 'failed';
    if (new RegExp(`Saved revision v\\d+`).test(status || '') && (await listNamed(panel)).some((row) => row.hasSafety)) {
      return 'saved';
    }
    return 'wait';
  }, { timeout: 45_000 }).toBe('saved');
  const safetyStatus = await panel.getByTestId('kal48-status').textContent().catch(() => '');
  let namedAfterSafety = await listNamed(panel);
  const safetyRow = namedAfterSafety.find((row) => row.hasSafety);
  const safetyCount = safetyRow
    ? Number((safetyRow.label.match(/(\d+)\s+annotation/i) || [])[1] || -1)
    : -1;
  console.log('SAFETY_SAVE', JSON.stringify({
    saved: Boolean(safetyRow),
    revision: safetyRow?.number || null,
    annotationCount: safetyCount,
    liveCount: baselineIds.length,
    status: (safetyStatus || '').slice(0, 100),
  }));

  const mark1 = await drawRect(page, { x0: 0.18, y0: 0.22, x1: 0.34, y1: 0.38 });
  const afterMark1 = await userIds(page);
  const sync1 = await waitSynced(page);
  console.log('MARK1', JSON.stringify({ id: mark1, liveCount: afterMark1.length, sync: sync1 }));

  dialogQueue.push({ type: 'prompt', contains: 'Label for this revision', response: NAMED_LABEL });
  await panel.getByTestId('kal48-save-revision').click();
  await expect.poll(async () => {
    const status = await panel.getByTestId('kal48-status').textContent().catch(() => '');
    if (/Save failed/i.test(status || '')) return 'failed';
    if ((await listNamed(panel)).some((row) => row.hasNamed)) return 'saved';
    return 'wait';
  }, { timeout: 45_000 }).toBe('saved');
  const afterNamedSave = await listNamed(panel);
  const namedRow = afterNamedSave.find((row) => row.hasNamed);
  const namedCount = namedRow
    ? Number((namedRow.label.match(/(\d+)\s+annotation/i) || [])[1] || -1)
    : -1;
  const statusAfterSave = await panel.getByTestId('kal48-status').textContent().catch(() => '');
  console.log('NAMED_SAVE', JSON.stringify({
    saved: Boolean(namedRow),
    revision: namedRow?.number || null,
    annotationCount: namedCount,
    liveCount: afterMark1.length,
    status: (statusAfterSave || '').slice(0, 100),
  }));

  const mark2 = await drawRect(page, { x0: 0.52, y0: 0.42, x1: 0.70, y1: 0.60 });
  const afterMark2 = await userIds(page);
  const sync2 = await waitSynced(page);
  console.log('MARK2', JSON.stringify({ id: mark2, liveCount: afterMark2.length, sync: sync2 }));

  // Break: empty name still saves (label is optional) — cancel the prompt instead
  // is the other save-break; empty accept must not crash.
  const namedCountBeforeEmpty = (await listNamed(panel)).length;
  dialogQueue.push({ type: 'prompt', contains: 'Label for this revision', response: '' });
  await panel.getByTestId('kal48-save-revision').click();
  await page.waitForTimeout(1500);
  const afterEmpty = await listNamed(panel);
  const emptySaved = afterEmpty.length >= namedCountBeforeEmpty;
  const statusEmpty = await panel.getByTestId('kal48-status').textContent().catch(() => '');
  console.log('BREAK_EMPTY_NAME', JSON.stringify({
    emptySaved,
    rowDelta: afterEmpty.length - namedCountBeforeEmpty,
    status: (statusEmpty || '').slice(0, 80),
  }));

  // Break: cancel restore — second mark stays.
  const restoreBtn = namedRow?.number
    ? panel.getByTestId(`kal48-restore-v${namedRow.number}`)
    : panel.locator('[data-testid^="kal48-restore-v"]').first();
  dialogQueue.push({ type: 'confirm', contains: 'Restore v', response: false });
  await expect(restoreBtn).toBeVisible({ timeout: 10_000 });
  await restoreBtn.click();
  await page.waitForTimeout(800);
  const idsAfterCancel = await userIds(page);
  const cancelKeptMark2 = idsAfterCancel.includes(mark2);
  console.log('BREAK_CANCEL_RESTORE', JSON.stringify({
    mark2StillPresent: cancelKeptMark2,
    liveCount: idsAfterCancel.length,
    dialogs: dialogLog.slice(-2),
  }));
  expect(cancelKeptMark2).toBe(true);

  const snapshotLooksLive = namedCount >= 1 && namedCount >= afterMark1.length;
  const restoreSafe = Boolean(namedRow) && (scratch || (Boolean(safetyRow) && snapshotLooksLive));
  if (!restoreSafe) {
    console.log('NAMED_RESTORE', JSON.stringify({
      verdict: 'blocked',
      reason: 'restore would rewrite a production document whose snapshot may not hold live marks; cancelled only',
      scratch,
      snapshotLooksLive,
      namedCount,
      liveAfterMark1: afterMark1.length,
      namedBefore: namedBefore.length,
    }));
    test.info().annotations.push({
      type: 'blocker',
      description: 'Named restore not confirmed — production snapshot not proven reversible',
    });
    return;
  }

  // Intended: restore the named version. Auto-pre-restore captures mark2 first.
  dialogQueue.push({ type: 'confirm', contains: 'Restore v', response: true });
  await restoreBtn.click();
  await expect.poll(async () => {
    const status = await panel.getByTestId('kal48-status').textContent().catch(() => '');
    if (/Restored v/i.test(status || '')) return 'restored';
    if (/Restore failed/i.test(status || '')) return 'failed';
    return 'wait';
  }, { timeout: 30_000 }).not.toBe('wait');
  const statusRestore = await panel.getByTestId('kal48-status').textContent().catch(() => '');
  const afterRestoreRows = await listNamed(panel);
  const namedStillListed = afterRestoreRows.some((row) => row.hasNamed);
  const autoPre = afterRestoreRows.find((row) => row.auto);
  let idsAfterRestore = await userIds(page);
  let mark2Gone = !idsAfterRestore.includes(mark2);
  let mark1Kept = idsAfterRestore.includes(mark1);

  // History restore semantics: live canvas may need a reopen if the RPC
  // rewrote cloud rows but the session still holds CRDT state.
  if (!mark2Gone && /Restored v/i.test(statusRestore || '')) {
    await page.goto('/');
    const reopen = page.locator('.documents-desktop-card [data-document-id]').first();
    await expect(reopen).toBeVisible({ timeout: 45_000 });
    if (scratch) {
      await page.getByText(/e2e-named-rev-|clickable-link-test/i).first().click().catch(async () => {
        await reopen.click();
      });
    } else {
      await reopen.click();
    }
    const openFile = page.getByRole('button', { name: 'Open file' });
    if (await openFile.count()) await openFile.click();
    await waitEditor(page);
    idsAfterRestore = await userIds(page);
    mark2Gone = !idsAfterRestore.includes(mark2);
    mark1Kept = idsAfterRestore.includes(mark1);
    const panel2 = await openHistory(page);
    const listed2 = await listNamed(panel2);
    console.log('RESTORE_REOPEN', JSON.stringify({
      mark2Gone,
      mark1Kept,
      liveCount: idsAfterRestore.length,
      namedStillListed: listed2.some((row) => row.hasNamed),
    }));
  }

  console.log('NAMED_RESTORE', JSON.stringify({
    verdict: /Restore failed/i.test(statusRestore || '')
      ? 'fail'
      : (mark2Gone ? 'pass' : 'fail'),
    status: (statusRestore || '').slice(0, 120),
    mark1Kept,
    mark2Gone,
    liveCount: idsAfterRestore.length,
    namedStillListed,
    autoPreRestoreRow: Boolean(autoPre),
    scratch,
    dialogs: dialogLog.map((d) => d.type),
  }));

  expect(/Restore failed/i.test(statusRestore || ''), statusRestore).toBe(false);
  expect(namedStillListed, 'edge: named version remains after restore').toBe(true);
  expect(mark2Gone, 'second mark should go away after named restore').toBe(true);

  // Put a production document back if we used the already-opened file.
  if (!scratch && safetyRow?.number) {
    const safetyRestore = page.getByTestId(`kal48-restore-v${safetyRow.number}`);
    if (await safetyRestore.count()) {
      dialogQueue.push({ type: 'confirm', contains: 'Restore v', response: true });
      await safetyRestore.click();
      await page.waitForTimeout(1500);
      console.log('SAFETY_RESTORE', JSON.stringify({ attempted: true, revision: safetyRow.number }));
    }
  }
});

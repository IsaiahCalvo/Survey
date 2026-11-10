// A document locked or moved to Archive while someone else has it open
// (deep test 2026-11-10, file-model/projects-answers.md Q8): that person is
// told at once, the tools stop, and no mark silently vanishes behind a
// "your changes are safe on this device" light.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';

async function seedDocument(label) {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const bytes = fs.readFileSync(path.resolve('debug/fixtures/clickable-link-test.pdf'));
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const name = `E2E ${label} ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  const editorId = data.users.find((u) => u.email === E2E_ACCOUNTS.editor.email).id;
  const share = await admin.from('document_collaborators').insert({
    document_id: id, user_id: editorId, invited_by: ownerId, role: 'editor', email: E2E_ACCOUNTS.editor.email, status: 'active',
  });
  if (share.error) throw share.error;
  return {
    id,
    name,
    ownerId,
    async update(patch) {
      const { error } = await admin.from('documents').update(patch).eq('id', id);
      if (error) throw error;
    },
    async remove() {
      await admin.from('document_collaborators').delete().eq('document_id', id);
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

async function openAsEditor(page, name) {
  await signIn(page, E2E_ACCOUNTS.editor);
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (await openFile.isVisible().catch(() => false)) await openFile.click();
  await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Up to date/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function drawRect(page, fx, fy) {
  const box = await page.locator(PAGE).boundingBox();
  await page.keyboard.press('r');
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

test('a lock reaches the other person at once', async ({ page }) => {
  test.setTimeout(150_000);
  const doc = await seedDocument('lock live');
  try {
    await openAsEditor(page, doc.name);
    await doc.update({ locked_at: new Date().toISOString(), locked_by: doc.ownerId });
    const at = Date.now();
    await expect(page.getByText('Document locked.').filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - at).toBeLessThan(5_000);
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-readonly'))).toBe('true');
    // It names who locked it, not their raw user id.
    await expect(page.getByText(`by ${E2E_ACCOUNTS.owner.label}`).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(doc.ownerId)).toHaveCount(0);
  } finally {
    await doc.remove();
  }
});

test('moved to Archive: the other person is told why, and the tools stop', async ({ page }) => {
  test.setTimeout(150_000);
  const doc = await seedDocument('archived live');
  try {
    await openAsEditor(page, doc.name);
    await doc.update({ user_archived_at: new Date().toISOString() });
    await page.waitForTimeout(1_000);
    // The server turns this mark down (the document is only the owner's now).
    await drawRect(page, 0.5, 0.6);
    await expect(page.getByText(/^This document was moved to Archive or deleted/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-readonly'))).toBe('true');
    // The sync light tells the truth: not "safe on this device".
    await expect(page.getByRole('button', { name: /^Not saved\./ }).filter({ visible: true }).first()).toBeVisible();
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/safe on this device/i);
  } finally {
    await doc.remove();
  }
});

test('the owner\'s other window is told at once when the document goes to Archive, and freed by Undo', async ({ page }) => {
  test.setTimeout(150_000);
  const doc = await seedDocument('archived owner window');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(doc.name, { exact: true }).filter({ visible: true }).first().click();
    const openFile = page.getByRole('button', { name: 'Open file' });
    if (await openFile.isVisible().catch(() => false)) await openFile.click();
    await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Up to date/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    await doc.update({ user_archived_at: new Date().toISOString() });
    await expect(page.getByText(/^This document was moved to Archive\. Restore it/).filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-readonly'))).toBe('true');

    // Undo (restore from Archive) frees the tools again.
    await doc.update({ user_archived_at: null });
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-readonly')), { timeout: 10_000 }).toBeNull();
    await expect(page.getByText(/^This document was moved to Archive\. Restore it/).filter({ visible: true })).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await doc.remove();
  }
});

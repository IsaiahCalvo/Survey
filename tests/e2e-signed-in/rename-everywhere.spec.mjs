// A rename shows everywhere at once (2026-10-28). Isaiah: "if I rename it in
// the Documents tab and I already have that PDF open ... it should change on
// the viewable tab at the exact same time."
//
// One screen: the open tab takes the new name the moment Save is pressed,
// before the database has answered (the save is held back here to prove it),
// and a rename from the tab menu shows in the Documents list at once.
// Other screens: the same owner on a second device and a teammate with the
// document shared to them see the new name on their open tab, through the
// database's rename broadcast (doc-names:<user> Realtime topic).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const editorId = data.users.find((u) => u.email === E2E_ACCOUNTS.editor.email).id;
  const bytes = fs.readFileSync(path.resolve('debug/fixtures/clickable-link-test.pdf'));
  const docId = randomUUID();
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const docName = `E2E Rename ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  const share = await admin.from('document_collaborators').insert({
    document_id: docId, user_id: editorId, role: 'editor', status: 'active',
  });
  if (share.error) throw share.error;
  return { docId, docName, filePath };
}

async function cleanup(admin, seeded) {
  await admin.from('document_collaborators').delete().eq('document_id', seeded.docId);
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
}

const tabBar = (page) => page.locator('.tab-bar');

async function openDocument(page, name) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(tabBar(page).getByText(name, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Type your name in the box:').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
}

function documentRowMore(page, name) {
  return page.locator('div')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'More' }) })
    .last()
    .getByRole('button', { name: 'More' });
}

async function saveRename(page, nextName) {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Rename document' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(nextName);
  await dialog.getByRole('button', { name: 'Save' }).click();
}

test('a rename shows on every open tab and list at once, here and on other screens', async ({ browser, page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  const contexts = [];
  try {
    // Owner's second device and the teammate, each with the document open.
    const otherScreens = [];
    for (const account of [E2E_ACCOUNTS.owner, E2E_ACCOUNTS.editor]) {
      const context = await browser.newContext();
      contexts.push(context);
      await context.route(
        (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
        (route) => route.abort('blockedbyclient'),
      );
      const other = await context.newPage();
      await signIn(other, account);
      await openDocument(other, seeded.docName);
      otherScreens.push(other);
    }

    await signIn(page, E2E_ACCOUNTS.owner);
    await openDocument(page, seeded.docName);
    await tabBar(page).getByText('Home', { exact: true }).click();

    // Hold the database write back for 3 s: the tab must not wait for it.
    let releaseSave;
    const saveHeld = new Promise((resolve) => { releaseSave = resolve; });
    await page.route('**/rest/v1/documents?**', async (route) => {
      if (route.request().method() === 'PATCH') await saveHeld;
      await route.continue();
    });
    const firstName = `Renamed on Documents ${Date.now()}.pdf`;
    await documentRowMore(page, seeded.docName).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await saveRename(page, firstName);
    const tab = tabBar(page).getByText(firstName, { exact: true });
    await expect(tab).toBeVisible({ timeout: 1000 });
    // The tab's hover name and close button follow too.
    await expect(tabBar(page).getByRole('button', { name: `Close ${firstName}` })).toBeAttached();
    await expect(tabBar(page).getByText(seeded.docName, { exact: true })).toHaveCount(0);
    setTimeout(releaseSave, 3000);
    await page.waitForResponse((res) => res.url().includes('/rest/v1/documents') && res.request().method() === 'PATCH', { timeout: 15_000 });
    await page.unroute('**/rest/v1/documents?**');
    const saved = await admin.from('documents').select('name').eq('id', seeded.docId).single();
    expect(saved.data.name).toBe(firstName);

    // The owner's other device and the teammate: their open tab renames.
    for (const other of otherScreens) {
      await expect(tabBar(other).getByText(firstName, { exact: true })).toBeVisible({ timeout: 10_000 });
    }

    // Rename from the tab menu: the Documents list shows it at once.
    const secondName = `Renamed on tab ${Date.now()}.pdf`;
    await tab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename document' }).click();
    await saveRename(page, secondName);
    await expect(documentRowMore(page, secondName)).toBeVisible({ timeout: 1000 });
    await expect(page.getByText(seeded.docName, { exact: true })).toHaveCount(0);
    for (const other of otherScreens) {
      await expect(tabBar(other).getByText(secondName, { exact: true })).toBeVisible({ timeout: 10_000 });
    }

    // A rename from somewhere else entirely (another app, the API) shows too.
    const thirdName = `Renamed by API ${Date.now()}.pdf`;
    const viaApi = await admin.from('documents')
      .update({ name: thirdName, updated_at: new Date(Date.now() + 1000).toISOString() })
      .eq('id', seeded.docId);
    expect(viaApi.error).toBeNull();
    for (const screen of [page, ...otherScreens]) {
      await expect(tabBar(screen).getByText(thirdName, { exact: true })).toBeVisible({ timeout: 10_000 });
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await cleanup(admin, seeded);
  }
});

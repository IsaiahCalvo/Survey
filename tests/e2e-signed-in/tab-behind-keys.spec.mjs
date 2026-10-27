// Keys belong to the front tab (docs/TAB-SWITCHING.md S6). Every open tab
// keeps its viewer mounted and its key handlers listen on window / document,
// so before this a key pressed in the front tab also acted in the tabs behind:
// Escape and a Space tap put a tab behind down to Pan, and Delete removed a
// highlight left selected in it. Here: tab A is left on Select, then Escape
// and a Space tap in tab B must leave A on Select.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const stamp = Date.now();
  const bytes = fs.readFileSync(path.resolve('debug/fixtures/clickable-link-test.pdf'));
  const docs = [];
  for (const label of ['A', 'B']) {
    const docId = randomUUID();
    const filePath = `${ownerId}/${docId}.pdf`;
    const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf', upsert: true,
    });
    if (up.error) throw up.error;
    const docName = `E2E Keys ${label} ${stamp}.pdf`;
    const doc = await admin.from('documents').insert({
      id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
      file_path: filePath, file_size: bytes.length, page_count: 1,
    });
    if (doc.error) throw doc.error;
    docs.push({ docId, docName, filePath });
  }
  return { A: docs[0], B: docs[1] };
}

async function cleanup(admin, seeded) {
  for (const d of [seeded.A, seeded.B]) {
    await admin.from('documents').delete().eq('id', d.docId);
    await admin.storage.from('documents').remove([d.filePath]);
  }
}

test('Escape and a Space tap in the front tab leave the tool of a tab behind alone', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  const { A, B } = seeded;
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const tabs = page.locator('.tab-bar');
    const visiblePage1 = page.locator('[data-touch-pdf-surface]:visible .survey-pdfjs-page-div[data-page-number="1"] canvas').first();
    for (const d of [A, B]) {
      if (d === B) await tabs.getByText('Home', { exact: true }).click();
      await page.getByText(d.docName, { exact: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      await expect(visiblePage1).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
    }
    const selectTool = page.locator('#chrome-top-host [data-select-tool="true"]').first();
    const panTool = page.locator('#chrome-top-host [data-tool-switch="true"][aria-label="Pan"]').first();
    // Put the keyboard on the document itself, off any button (a focused
    // button takes Space for itself).
    const focusDocument = async () => {
      await page.evaluate(() => { document.activeElement?.blur?.(); });
    };

    // A on Select.
    await tabs.getByText(A.docName, { exact: true }).click();
    await page.waitForTimeout(500);
    await selectTool.click();
    await expect(selectTool).toHaveAttribute('aria-pressed', 'true');

    // B on Pan; Escape there.
    await tabs.getByText(B.docName, { exact: true }).click();
    await page.waitForTimeout(500);
    await panTool.click();
    await expect(panTool).toHaveAttribute('aria-pressed', 'true');
    await focusDocument();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await tabs.getByText(A.docName, { exact: true }).click();
    await page.waitForTimeout(500);
    await expect(selectTool, 'Escape in B left A on Select').toHaveAttribute('aria-pressed', 'true');

    // A quick Space tap in B toggles B's Pan; A stays on Select.
    await tabs.getByText(B.docName, { exact: true }).click();
    await page.waitForTimeout(500);
    await focusDocument();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await tabs.getByText(A.docName, { exact: true }).click();
    await page.waitForTimeout(500);
    await expect(selectTool, 'a Space tap in B left A on Select').toHaveAttribute('aria-pressed', 'true');
  } finally {
    await cleanup(admin, seeded);
  }
});

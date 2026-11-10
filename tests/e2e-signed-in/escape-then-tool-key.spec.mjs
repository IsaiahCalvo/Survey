// Escape puts a drawing tool down to Pan on a timer (it waits for a draft to
// cancel itself on the same key). Chrome runs input before timers, so on a
// busy machine a tool key pressed right after Escape could land first and
// then be undone by that late Pan (CI 2026-11-10: C after the highlighter's
// Escape lost the Counter). The newer pick must win.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

test('a tool key pressed right after Escape is not undone by the late Pan', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Escape then key ${RUN}`;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(`${name} page one`, { x: 72, y: 540, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const filePath = `${user.id}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name: `${name}.pdf`, file_path: filePath, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  const changes = [];
  page.on('console', (msg) => {
    const m = /\[InteractionDiag\] tool-changed @ \d+ms from=\S+ to=(\S+)/.exec(msg.text());
    if (m) changes.push(m[1]);
  });
  const lastTool = () => changes[changes.length - 1];
  // The [InteractionDiag] lines only print with the debug switch on (#1384).
  await page.addInitScript(() => { window.__APP_DEBUG = true; });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(`${name}.pdf`, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText(`${name} page one`)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.activeElement?.blur?.());

    for (const [toolKey, key, tool] of [['h', 'c', 'counter'], ['r', 't', 'text'], ['p', 'o', 'ellipse'], ['l', 'v', 'select']]) {
      await page.keyboard.press(toolKey);
      await expect.poll(lastTool).not.toBe('pan');
      // Escape and the next key in one task: the key always lands before
      // Escape's Pan timer, the worst case a busy machine can produce.
      await page.evaluate((k) => {
        const fire = (keyName) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
        fire('Escape');
        fire(k);
      }, key);
      await page.waitForTimeout(400);
      expect(lastTool(), `${key} after Escape`).toBe(tool);
      await page.keyboard.press('Escape');
      await expect.poll(lastTool).toBe('pan');
    }

    // Escape alone still puts the tool down.
    await page.keyboard.press('l');
    await expect.poll(lastTool).toBe('line');
    await page.keyboard.press('Escape');
    await expect.poll(lastTool).toBe('pan');
  } finally {
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([filePath]);
  }
});

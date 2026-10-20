// Export from a document stored in the cloud. Its pdfFile is the library row
// ({ id, name, filePath }) with no bytes; every export used to fail with
// "e.arrayBuffer is not a function". Runs against the in-memory fake backend.
// Run (.env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5593 \
//     npx playwright test --config debug/playwright.noserver.config.mjs debug/scenarios/test-plan/cloud-doc-export.spec.mjs
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { DESKTOP, PHONE, OUT_DIR, prepareLocalContext, openViewer } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { dragPage, tool } from './tp-actions.mjs';
import { readZip } from '../../../tests/helpers/readStoredZip.mjs';

test.use({
  video: 'off',
  acceptDownloads: true,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const PDF = 'order-pages.pdf';
const OUT = `${OUT_DIR}/cloud-doc-export`;
mkdirSync(OUT, { recursive: true });

async function download(page, open, item) {
  if (open) await open();
  await page.waitForTimeout(300);
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), item.click()]);
  const path = `${OUT}/${Date.now()}-${file.suggestedFilename()}`;
  await file.saveAs(path);
  return { path, name: file.suggestedFilename(), bytes: readFileSync(path) };
}

for (const phone of [false, true]) {
  test(`cloud document exports PDF, XFDF and review ZIP (${phone ? 'phone' : 'desktop'})`, async ({ browser }) => {
    const docId = `cloud-export-${phone ? 'phone' : 'desktop'}-${Date.now()}`;
    const filePath = `dev-test-user/${docId}.pdf`;
    const backend = new FakeBackend({ documentId: docId, storage: true });
    backend.table('documents').push({
      id: docId, user_id: 'dev-test-user', name: PDF, file_path: filePath, archived: false,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    });
    const source = readFileSync(new URL(`../../fixtures/${PDF}`, import.meta.url));
    backend.seedStorageObject(filePath, source);

    const context = await browser.newContext({ ...(phone ? PHONE : DESKTOP), acceptDownloads: true });
    await prepareLocalContext(context, docId, { backend });
    // Open the library row instead of the dev route's local File.
    await context.addInitScript(({ id, path }) => {
      let held = null;
      Object.defineProperty(window, '__devTestPdf', {
        configurable: true,
        get() { return held; },
        set(file) {
          held = file ? { id, user_id: 'dev-test-user', name: file.name, size: file.size, filePath: path, file_path: path } : file;
        },
      });
    }, { id: docId, path: filePath });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openViewer(page, PDF, { phone, cloudLibrary: true });

    if (phone) {
      await tool(page, 'Shapes', 'Rectangle');
    } else {
      await page.keyboard.press('v');
      await page.waitForTimeout(150);
      await page.keyboard.press('r');
    }
    await page.waitForTimeout(300);
    await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');

    const more = phone
      ? () => page.getByRole('button', { name: /More document options|More/ }).first().click()
      : () => page.getByRole('button', { name: 'More export options' }).click();
    const item = (label) => (phone ? page.getByRole('button', { name: label }) : page.getByRole('menuitem', { name: label }));

    const pdf = phone
      ? await download(page, more, item('Export annotated PDF'))
      : await download(page, null, page.getByRole('button', { name: 'Export annotated PDF' }).first());
    expect(pdf.name).toMatch(/annotated\.pdf$/);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.bytes.length).toBeGreaterThan(source.length);

    const xfdf = await download(page, more, item(phone ? 'Export markup (XFDF)' : 'Markup only (XFDF)'));
    expect(xfdf.bytes.toString('utf8')).toMatch(/<square\b/);

    const zip = await download(page, more, item(phone ? 'Export review package' : 'Review package (ZIP)'));
    const names = readZip(new Uint8Array(zip.bytes), crc32).map((f) => f.name);
    expect(names.slice(0, 2)).toEqual(['manifest.json', 'annotations.xfdf']);

    const toasts = await page.locator('.app-toast-host [role=status]').allTextContents();
    await page.screenshot({ path: `${OUT}/${phone ? 'phone' : 'desktop'}-done.png` });
    console.log(JSON.stringify({ phone, pdf: pdf.name, xfdf: xfdf.name, zip: zip.name, names, toasts }));
    expect(toasts.join(' ')).not.toMatch(/Export failed/);
    expect(errors).toEqual([]);
    await context.close();
  });
}

// KAL-443 end to end on the in-memory backend: copy a document into another
// project from Home > Projects, then copy it again, then Duplicate it inside
// its own project. The copy must carry the real content fingerprint, a
// repeat copy must land on the existing document (one row per file per
// project) with a calm note saying so, and Duplicate inside the same project
// must still make a real second copy (its own object, no fingerprint). Desktop (1440x900) and phone
// (390x844, touch). No network, no database.
// Run (.env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5491 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/kal443-copy-fingerprint.spec.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { DESKTOP, OUT_DIR, PHONE } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { openWindow, waitFor } from './tp-actions.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const PDF_NAME = 'landscape-sheets.pdf';
const PDF = readFileSync(new URL(`../../fixtures/${PDF_NAME}`, import.meta.url));
const SHA = createHash('sha256').update(PDF).digest('hex');
const USER = 'dev-test-user';
const P1 = '7e57d0c0-0000-4000-8000-0000000000a1';
const P2 = '7e57d0c0-0000-4000-8000-0000000000a2';

function seededBackend(docId) {
  const backend = new FakeBackend({ documentId: docId, storage: true });
  Object.assign(backend.table('documents')[0], {
    name: 'Landscape sheets.pdf', file_path: `${USER}/${SHA}.pdf`, content_sha256: SHA, project_id: P1,
    archived: false, file_size: PDF.length, page_count: 8, updated_at: '2026-10-01T00:00:00.000Z',
  });
  backend.seedStorageObject(`${USER}/${SHA}.pdf`, PDF);
  for (const [id, name] of [[P1, 'North block'], [P2, 'South block']]) {
    backend.table('projects').push({ id, user_id: USER, name, archived: false, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' });
  }
  return backend;
}

const rowsIn = (backend, projectId) => backend.table('documents').filter((d) => d.project_id === projectId);

async function captureToasts(page) {
  await page.evaluate(() => {
    window.__kalToasts = [];
    window.addEventListener('app-toast', (e) => window.__kalToasts.push(e.detail?.message || ''));
  });
}
const toasts = (page) => page.evaluate(() => window.__kalToasts || []);

async function openProject(page, name, { phone }) {
  if (phone) {
    // The phone opens in the viewer; its back button leads to the library.
    await page.getByRole('button', { name: 'Back to documents' }).first().click();
    await page.waitForTimeout(1500);
  } else {
    await page.getByText('Home', { exact: true }).first().click();
  }
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' })).first().click();
  await page.waitForTimeout(1500);
  await page.getByText(name, { exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(1500);
  if (process.env.KAL443_PROBE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.KAL443_PROBE, await page.locator('body').ariaSnapshot());
    await page.screenshot({ path: `${process.env.KAL443_PROBE}.png` });
  }
}

async function selectFile(page, fileName) {
  // The file list's own Select button (the last one on screen); it reads
  // "Done" while selection is already on.
  if (await page.locator('button[aria-label="Done"]:visible').count() === 0) {
    await page.locator('button[aria-label="Select"]:visible').last().click();
    await page.waitForTimeout(500);
  }
  await page.getByText(fileName, { exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(500);
  if (process.env.KAL443_PROBE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${process.env.KAL443_PROBE}.selected.yml`, await page.locator('body').ariaSnapshot());
  }
}

async function copyTo(page, fileName, destination) {
  await selectFile(page, fileName);
  await page.locator('button[aria-label="Copy"]:visible').first().click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('button', { name: destination, exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy here' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

for (const device of ['desktop', 'phone']) {
  test(`KAL-443 copy into a project writes the real fingerprint and dedupes (${device})`, async ({ browser }) => {
    const phone = device === 'phone';
    const docId = phone ? '7e57d0c0-0000-4000-8000-000000000444' : '7e57d0c0-0000-4000-8000-000000000443';
    const backend = seededBackend(docId);
    const win = await openWindow(browser, backend, docId, PDF_NAME, { device: phone ? PHONE : DESKTOP, phone, cloudLibrary: true });
    const { page } = win;
    await captureToasts(page);

    await openProject(page, 'North block', { phone });
    await page.screenshot({ path: `${OUT_DIR}/kal443-${device}-1-north.png` });

    // 1) Copy to South block.
    await copyTo(page, 'Landscape sheets.pdf', 'South block');
    const firstCopy = await waitFor(() => rowsIn(backend, P2)[0] || null, { timeout: 20_000 });
    await page.screenshot({ path: `${OUT_DIR}/kal443-${device}-2-after-copy.png` });

    // 2) Copy the same file to South block again.
    await copyTo(page, 'Landscape sheets.pdf', 'South block');
    const noteAfterRepeat = await waitFor(async () => (await toasts(page)).find((m) => /already in “South block”/.test(m)) || null, { timeout: 20_000 });
    await page.screenshot({ path: `${OUT_DIR}/kal443-${device}-3-after-repeat.png` });

    // 3) Duplicate inside North block: a real second copy.
    await selectFile(page, 'Landscape sheets.pdf');
    await page.locator('button[aria-label="Duplicate"]:visible').first().click();
    const duplicate = await waitFor(() => rowsIn(backend, P1).find((d) => d.id !== docId) || null, { timeout: 20_000 });
    await page.getByText('Landscape sheets (Copy).pdf', { exact: true }).locator('visible=true').first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${OUT_DIR}/kal443-${device}-4-after-duplicate.png` });

    const southRows = rowsIn(backend, P2);
    const northRows = rowsIn(backend, P1);
    const objects = [...backend.storageObjects.keys()];
    const evidence = {
      firstCopy: firstCopy && { content_sha256: firstCopy.content_sha256, file_path: firstCopy.file_path, name: firstCopy.name },
      southRows: southRows.length,
      northRows: northRows.length,
      storageObjects: objects,
      duplicate: duplicate && { content_sha256: duplicate.content_sha256 ?? null, file_path: duplicate.file_path, name: duplicate.name },
      noteAfterRepeat,
      toasts: await toasts(page),
      errors: win.errors,
    };
    console.log(`[KAL-443 ${device}]`, JSON.stringify(evidence, null, 1));
    await win.context.close();

    expect(firstCopy?.content_sha256).toBe(SHA);
    // The copy's own object (never the original's), in the copier's folder.
    expect(firstCopy?.file_path).toBe(`${USER}/${firstCopy?.id}.pdf`);
    expect(southRows.length).toBe(1);
    expect(northRows.length).toBe(2);
    expect(duplicate?.name).toBe('Landscape sheets (Copy).pdf');
    expect(duplicate?.content_sha256 ?? null).toBe(null);
    expect(duplicate?.file_path).toBe(`${USER}/${duplicate?.id}.pdf`);
    // The original, the one copy and the duplicate; the repeat leaves nothing behind.
    expect(objects.sort()).toEqual([
      `documents/${USER}/${firstCopy?.id}.pdf`,
      `documents/${USER}/${duplicate?.id}.pdf`,
      `documents/${USER}/${SHA}.pdf`,
    ].sort());
    expect(noteAfterRepeat).toBeTruthy();
    expect(evidence.toasts.some((m) => /already in “North block”/.test(m))).toBe(false);
  });
}

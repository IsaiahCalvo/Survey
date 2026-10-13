// #812 end to end on the in-memory backend (no network, no database):
//   1) the same PDF in two projects the OLD way (two rows, one stored object
//      `<user>/<sha>.pdf`): delete a page in project A from the Pages rail ->
//      A moves onto its own object `<user>/<A id>.pdf` (fork_document_file) with
//      the edited bytes and their fingerprint; B and the shared object are
//      untouched;
//   2) every new document lands on its own object `<user>/<row id>.pdf`: an
//      upload through the file picker, a drag-and-drop upload, and a copy into
//      another project (KAL-443). Dropping the same file again still dedupes
//      onto the existing row.
// Run (.env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PLAYWRIGHT_BASE_URL=http://127.0.0.1:5493 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/shared-object-page-edit.spec.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { DESKTOP, OUT_DIR } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { openWindow, waitFor } from './tp-actions.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const fixture = (name) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pageCount = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

const USER = 'dev-test-user';
const DEV_DOC = '7e57d0c0-0000-4000-8000-000000000812';
const DOC_A = '7e57d0c0-0000-4000-8000-0000000008a1';
const DOC_B = '7e57d0c0-0000-4000-8000-0000000008b1';
const P1 = '7e57d0c0-0000-4000-8000-0000000008f1';
const P2 = '7e57d0c0-0000-4000-8000-0000000008f2';
const SHEETS = fixture('landscape-sheets.pdf');
const SHEETS_SHA = sha(SHEETS);
const SHARED = `${USER}/${SHEETS_SHA}.pdf`;

function backendWithProjects() {
  const backend = new FakeBackend({ documentId: DEV_DOC, storage: true });
  for (const [id, name] of [[P1, 'North block'], [P2, 'South block']]) {
    backend.table('projects').push({ id, user_id: USER, name, archived: false, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' });
  }
  return backend;
}

const docRow = (backend, id) => backend.table('documents').find((d) => d.id === id);

async function goHome(page, tab) {
  await page.getByText('Home', { exact: true }).first().click();
  await page.locator('.survey-hub').first().waitFor();
  await page.locator('.survey-hub .side .nav button', { hasText: tab }).first().click();
  await page.waitForTimeout(1200);
}

async function openProject(page, name) {
  await goHome(page, 'Projects');
  await page.getByText(name, { exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(1500);
}

/** Files "from the computer" dropped on the element under `selector`. */
async function dropFiles(page, selector, files) {
  return page.locator(selector).first().evaluate((el, list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bin = atob(f.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], f.name, { type: 'application/pdf' }));
    }
    const r = el.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const target = document.elementFromPoint(at.clientX, at.clientY) || el;
    for (const type of ['dragenter', 'dragover']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, ...at }));
    }
    return target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, ...at })) === false;
  }, files.map((f) => ({ name: f.name, b64: f.bytes.toString('base64') })));
}

test('#812: deleting a page in one project leaves the same PDF in another project unchanged', async ({ browser }) => {
  const backend = backendWithProjects();
  // The old shape: one upload of the same file into two projects -> two rows, ONE object.
  for (const [id, projectId] of [[DOC_A, P1], [DOC_B, P2]]) {
    backend.table('documents').push({
      id, user_id: USER, name: 'Landscape sheets.pdf', file_path: SHARED, content_sha256: SHEETS_SHA, project_id: projectId,
      archived: false, file_size: SHEETS.length, page_count: 8, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    });
  }
  backend.seedStorageObject(SHARED, SHEETS);
  expect(await pageCount(SHEETS)).toBe(8);

  const win = await openWindow(browser, backend, DEV_DOC, 'order-pages.pdf', { device: DESKTOP, cloudLibrary: true });
  const { page } = win;
  page.on('dialog', (dialog) => dialog.accept());

  await openProject(page, 'North block');
  await page.getByText('Landscape sheets.pdf', { exact: true }).locator('visible=true').first().click();
  await page.locator('[data-pdf-tab-id]', { hasText: 'Landscape sheets.pdf' }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3000);

  const pagesButton = page.getByRole('button', { name: 'Pages', exact: true }).first();
  if (await pagesButton.count()) await pagesButton.click();
  await waitFor(async () => (await page.locator('[data-page-card]').count()) >= 8, { timeout: 30_000 });
  await page.screenshot({ path: `${OUT_DIR}/812-1-before-delete.png` });
  await page.locator('[data-page-card]').nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).first().click();

  const ownA = `${USER}/${DOC_A}.pdf`;
  const forked = await waitFor(() => docRow(backend, DOC_A)?.file_path === ownA, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/812-2-after-delete.png` });

  const a = docRow(backend, DOC_A);
  const b = docRow(backend, DOC_B);
  const aBytes = backend.objectBytes(ownA);
  const sharedBytes = backend.objectBytes(SHARED);
  const evidence = {
    forked,
    a: { file_path: a.file_path, content_sha256: a.content_sha256, pages: aBytes ? await pageCount(aBytes) : null, bytesSha: aBytes ? sha(aBytes) : null },
    b: { file_path: b.file_path, content_sha256: b.content_sha256 },
    shared: { pages: sharedBytes ? await pageCount(sharedBytes) : null, unchanged: Boolean(sharedBytes) && Buffer.compare(sharedBytes, SHEETS) === 0 },
    rpc: backend.counts.get('RPC fork_document_file') || 0,
    errors: win.errors,
  };
  console.log('[812 page edit]', JSON.stringify(evidence, null, 1));
  await win.context.close();

  expect(forked).toBeTruthy();
  expect(evidence.a.pages).toBe(7);
  expect(evidence.a.content_sha256).toBe(evidence.a.bytesSha);
  expect(evidence.b).toEqual({ file_path: SHARED, content_sha256: SHEETS_SHA });
  expect(evidence.shared).toEqual({ pages: 8, unchanged: true });
  expect(evidence.rpc).toBe(1);
});

test('#812: picker upload, drag-and-drop upload and copy each land on <user>/<row id>.pdf', async ({ browser }) => {
  const backend = backendWithProjects();
  const win = await openWindow(browser, backend, DEV_DOC, 'order-pages.pdf', { device: DESKTOP, cloudLibrary: true });
  const { page } = win;
  const ORDER = fixture('order-pages.pdf');
  const MIXED = fixture('kal412-mixed-import-e2e.pdf');
  const rowsNamed = (name) => backend.table('documents').filter((d) => d.name === name);
  const onOwnObject = (row, bytes) => Boolean(row)
    && row.file_path === `${USER}/${row.id}.pdf`
    && Buffer.compare(backend.objectBytes(row.file_path) || Buffer.alloc(0), bytes) === 0;

  // 1) File picker (the browser file input behind the Upload button), into North block.
  await openProject(page, 'North block');
  await page.locator('input[type="file"][accept="application/pdf"]:not([multiple])').first()
    .setInputFiles({ name: 'landscape-sheets.pdf', mimeType: 'application/pdf', buffer: SHEETS });
  const picked = await waitFor(() => { const r = rowsNamed('landscape-sheets.pdf')[0]; return onOwnObject(r, SHEETS) ? r : null; }, { timeout: 30_000 });

  // 2) Drag-and-drop onto the Documents list.
  await goHome(page, 'Documents');
  await dropFiles(page, '.documents-desktop-card', [{ name: 'order-pages.pdf', bytes: ORDER }, { name: 'mixed.pdf', bytes: MIXED }]);
  const dropped = await waitFor(() => {
    const rows = [rowsNamed('order-pages.pdf').find((r) => r.id !== DEV_DOC), rowsNamed('mixed.pdf')[0]];
    return onOwnObject(rows[0], ORDER) && onOwnObject(rows[1], MIXED) ? rows : null;
  }, { timeout: 30_000 });

  // Dedupe unchanged: the same bytes dropped again land on the existing row.
  const rowsBefore = backend.table('documents').length;
  const objectsBefore = backend.storageObjects.size;
  await dropFiles(page, '.documents-desktop-card', [{ name: 'mixed.pdf', bytes: MIXED }]);
  await page.waitForTimeout(4000);
  const afterRepeat = { rows: backend.table('documents').length, objects: backend.storageObjects.size };

  // 3) Copy the picked file from North block into South block (KAL-443).
  await openProject(page, 'North block');
  if (await page.locator('button[aria-label="Done"]:visible').count() === 0) {
    await page.locator('button[aria-label="Select"]:visible').last().click();
    await page.waitForTimeout(500);
  }
  await page.getByText('landscape-sheets.pdf', { exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(500);
  await page.locator('button[aria-label="Copy"]:visible').first().click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('button', { name: 'South block', exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy here' }).click();
  const copy = await waitFor(() => {
    const r = backend.table('documents').find((d) => d.project_id === P2);
    return onOwnObject(r, SHEETS) ? r : null;
  }, { timeout: 30_000 });
  await page.screenshot({ path: `${OUT_DIR}/812-3-uploads-and-copy.png` });

  const evidence = {
    picked: picked && { id: picked.id, file_path: picked.file_path, project_id: picked.project_id, sha: picked.content_sha256 },
    dropped: dropped && dropped.map((r) => ({ id: r.id, file_path: r.file_path, sha: r.content_sha256 })),
    repeat: { rowsBefore, objectsBefore, ...afterRepeat },
    copy: copy && { id: copy.id, file_path: copy.file_path, sha: copy.content_sha256 },
    objects: [...backend.storageObjects.keys()].sort(),
    errors: win.errors,
  };
  console.log('[812 uploads]', JSON.stringify(evidence, null, 1));
  await win.context.close();

  expect(picked?.project_id).toBe(P1);
  expect(picked?.content_sha256).toBe(SHEETS_SHA);
  expect(dropped).toBeTruthy();
  expect(afterRepeat).toEqual({ rows: rowsBefore, objects: objectsBefore });
  expect(copy?.content_sha256).toBe(SHEETS_SHA);
  expect(copy?.id).not.toBe(picked?.id);
  // No new upload or copy used a content-addressed object.
  expect(evidence.objects.some((k) => /\/[0-9a-f]{64}\.pdf$/.test(k))).toBe(false);
});

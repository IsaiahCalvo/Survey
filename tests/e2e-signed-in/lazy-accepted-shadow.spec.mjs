// Open: the second copy of the marks kept only in the background worker
// (flag 'lazy-accepted-shadow', 2026-11-10: "pages and marks loading as fast
// as possible").
//
// The sync engine keeps the marks the cloud has accepted in a second Yjs
// document. Applying the cloud snapshot to it was ~0.34 s of a phone's main
// thread at every first open, and ~70 MB of memory on a 36-sheet set, though
// the checkpoint worker already holds the same copy. With the flag that copy
// is built only if something on the main thread truly needs it; the worker
// answers the rest.
//
// This walk opens a marked set cold, draws a mark, waits until it is saved,
// and checks the copy was never built; then a fresh device (no saved copy)
// opens the set and shows every mark, the new one included.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const PAGES = 4;
const MARKS_PER_PAGE = 40;
const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

async function seedDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < PAGES; p += 1) {
    // Portrait sheets: a phone shows about one and a half of them.
    const page = pdf.addPage([612, 792]);
    page.drawText(`Sheet ${p + 1}`, { x: 60, y: 720, size: 36, font, color: rgb(0, 0, 0) });
    for (let i = 0; i < 40; i += 1) {
      page.drawLine({ start: { x: 40 + ((i * 29) % 520), y: 80 + ((i * 31) % 560) }, end: { x: 90 + ((i * 37) % 500), y: 100 + ((i * 23) % 600) }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
    }
  }
  const bytes = Buffer.from(await pdf.save());
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const now = new Date().toISOString();
  const name = `E2E lazy shadow ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: PAGES,
    cutover_completed_at: now, embedded_import_completed_at: now,
  });
  if (doc.error) throw doc.error;
  return {
    id,
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

// Marks of two kinds on every page, written through the app's own store
// mapping and appended as the owner (page-and-marks-together.spec.mjs does
// the same for one busy page).
const MARKS_UPDATE = `
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { syncByPageToDoc } from './src/services/annotationDocStore.js';
const [pages, perPage] = process.argv.slice(1).map(Number);
const byPage = {};
for (let p = 1; p <= pages; p += 1) {
  const objects = [];
  for (let i = 0; i < perPage; i += 1) {
    const id = randomUUID();
    const left = 30 + ((i * 53) % 500);
    const top = 40 + ((i * 97) % 680);
    if (i % 2) objects.push({ type: 'rect', left, top, width: 40, height: 24, stroke: '#1565c0', fill: 'transparent', strokeWidth: 2, data: { id } });
    else objects.push({ type: 'path', path: [['M', left, top], ['L', left + 50, top + 8], ['L', left + 90, top - 4]], left, top: top - 4, width: 90, height: 12, stroke: '#d22', fill: null, strokeWidth: 3, data: { id, type: 'ink' } });
  }
  byPage[p] = { objects };
}
const doc = new Y.Doc();
const pending = [];
doc.on('update', (u) => { pending.push(u); });
syncByPageToDoc(doc, byPage);
process.stdout.write(Buffer.from(Y.mergeUpdates(pending)).toString('hex'));
`;

async function seedMarks(documentId) {
  const hex = execFileSync(process.execPath, ['--input-type=module', '-e', MARKS_UPDATE, String(PAGES), String(MARKS_PER_PAGE)], {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const { error } = await owner.rpc('append_annotation_update', {
    p_document_id: documentId, p_client_id: `lazy-shadow-seed-${Date.now()}`, p_client_seq: 1, p_data: `\\x${hex}`,
  });
  if (error) throw error;
}

// The open sync handles of this page: whether the accepted copy is unbuilt.
function acceptedCopies() {
  const states = [...(globalThis.__annotationDocSyncActiveStates__?.values() || [])].flatMap((set) => [...set]);
  return states.map((state) => ({ unbuilt: Array.isArray(state.acceptedUnbuilt), pending: state.appendRecords?.size ?? -1 }));
}

const page1Marks = (p) => p.evaluate(() => {
  const host = document.querySelector('[data-pdfjs-page-overlay-host][data-overlay-page="1"]');
  return host ? new Set([...host.querySelectorAll('[data-annotation-id]')].map((el) => el.getAttribute('data-annotation-id'))).size : 0;
});

async function openSet(browser, baseURL, storageState, name) {
  const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1400, height: 900 } });
  await context.route((url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('blockedbyclient'));
  await context.addInitScript(() => { localStorage.setItem('survey.flag.lazy-accepted-shadow', '1'); });
  const p = await context.newPage();
  await p.goto('/', { waitUntil: 'domcontentloaded' });
  const row = p.getByText(name, { exact: true }).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  const open = p.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  await expect(p.locator(`${PAGE}[data-raster-shown]`)).toBeVisible({ timeout: 60_000 });
  return { context, p };
}

test('with the accepted copy only in the worker, a mark drawn after a cold open is saved and a fresh device shows it', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(240_000);
  const seeded = await seedDocument();
  try {
    await seedMarks(seeded.id);
    await signIn(page, E2E_ACCOUNTS.owner);
    const storageState = await context.storageState();

    const first = await openSet(browser, baseURL, storageState, seeded.name);
    try {
      const { p } = first;
      await expect.poll(() => page1Marks(p), { timeout: 60_000 }).toBe(MARKS_PER_PAGE);
      await expect.poll(() => p.evaluate(acceptedCopies), { timeout: 20_000 }).toEqual([{ unbuilt: true, pending: 0 }]);

      // Draw one rectangle on page 1.
      const box = await p.locator(PAGE).boundingBox();
      await p.keyboard.press('r');
      const from = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.18 };
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      for (let i = 1; i <= 8; i += 1) await p.mouse.move(from.x + i * 10, from.y + i * 6);
      await p.mouse.up();
      await p.keyboard.press('v');
      await expect.poll(() => page1Marks(p), { timeout: 20_000 }).toBe(MARKS_PER_PAGE + 1);

      // Saved (nothing pending), and the copy was never built for it.
      await expect.poll(() => p.evaluate(acceptedCopies), { timeout: 30_000, message: 'the mark is saved with the copy still unbuilt' })
        .toEqual([{ unbuilt: true, pending: 0 }]);
    } finally {
      await first.context.close();
    }

    // A fresh device (no saved copy) opens the set from the cloud.
    const second = await openSet(browser, baseURL, storageState, seeded.name);
    try {
      await expect.poll(() => page1Marks(second.p), { timeout: 60_000, message: 'a fresh device shows the new mark' }).toBe(MARKS_PER_PAGE + 1);
    } finally {
      await second.context.close();
    }
  } finally {
    await seeded.remove();
  }
});

// First open of a PDF that carries its own markup (2026-10-07, owner:
// "you can change the save path for the first-open import").
//
// "Package 2 - Rev 4 -- IC.pdf" holds 3,055 marks of its own. The first open
// imports them into the document; that save used to be ~25 WAL rows (11.6 MB)
// on the same queue as the user's edits, so the first edit waited behind it.
// Now the import is ONE checkpoint, the user's edits go straight to the log,
// and screens already open take the checkpoint in from a small notice row.
// These walks prove, on the in-memory Supabase stand-in (tp-fake-backend.mjs,
// no network, no database), that:
//   A. two windows opening the document at the same moment (both import),
//      plus a third that opens afterwards, each show every imported mark
//      exactly once; the server's bytes (checkpoint + rows) hold each once;
//      no WAL row carries imported marks; the first edit is saved at once;
//   B. a reload in the middle of the import save (the checkpoint upload never
//      reached the server) imports nothing twice: the reopened window saves
//      the device's copy once, and a fresh window sees every mark once.
// Run (not in CI; .env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5631 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/first-open-import.spec.mjs
import { test, expect } from '@playwright/test';
import { OUT_DIR, report } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { drawRect, openWindow, waitFor } from './tp-actions.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 420_000 });

const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const IMPORTED = 3055;
const WIN = { device: { viewport: { width: 1200, height: 900 } } };
const VARIANT = 'first-open-import-local-backend';

// Every mark a window holds: { total, unique, imported, importedUnique }.
const windowCounts = (page) => page.evaluate(() => {
  const ids = [];
  const importedIds = [];
  for (const pageData of Object.values(window.__diagState?.annotationsByPage || {})) {
    for (const o of pageData?.objects || []) {
      const id = String(o?.data?.id ?? o?.id);
      ids.push(id);
      if (o?.isPdfImported || o?.pdfAnnotationId) importedIds.push(id);
    }
  }
  return { total: ids.length, unique: new Set(ids).size, imported: importedIds.length, importedUnique: new Set(importedIds).size };
});

async function serverCounts(backend) {
  const { byPage } = await backend.serverState();
  const ids = [];
  const importedIds = [];
  for (const pageData of Object.values(byPage || {})) {
    for (const o of pageData?.objects || []) {
      const id = String(o?.data?.id ?? o?.id);
      ids.push(id);
      if (o?.isPdfImported || o?.pdfAnnotationId) importedIds.push(id);
    }
  }
  return { total: ids.length, unique: new Set(ids).size, imported: importedIds.length, importedUnique: new Set(importedIds).size, ids };
}

// The marks a person drew (not the PDF's own), by the id the store keeps.
const userMarks = (page) => page.evaluate(() => Object.values(window.__diagState?.annotationsByPage || {})
  .flatMap((pageData) => pageData?.objects || [])
  .filter((o) => !(o?.isPdfImported || o?.pdfAnnotationId))
  .map((o) => ({ id: String(o?.data?.id ?? o?.id), type: o?.type })));

const walStats = (backend) => {
  const rows = backend.table('annotation_updates');
  const bytes = rows.map((r) => (String(r.data).length - 2) / 2);
  return { rows: rows.length, maxRowBytes: Math.max(0, ...bytes), totalBytes: bytes.reduce((n, b) => n + b, 0) };
};

const importDone = (backend) => backend.table('documents')[0]?.embedded_import_completed_at;

test('A: two windows open at once, a third later: every imported mark once, first edit saved at once', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-0000000f0a01';
  const backend = new FakeBackend({ documentId: docId });
  const [A, B] = await Promise.all([
    openWindow(browser, backend, docId, PDF, WIN),
    openWindow(browser, backend, docId, PDF, WIN),
  ]);
  // Both windows import (neither saw a marker); wait until A shows them.
  await waitFor(async () => (await windowCounts(A.page)).imported >= IMPORTED, { timeout: 120_000, every: 250 });
  const t0 = Date.now();
  await drawRect(A.page, 1, 100, 600, 220, 680);
  const rect = (await waitFor(async () => (await userMarks(A.page))[0], { timeout: 10_000 })) || null;
  const hex = rect ? Buffer.from(rect.id).toString('hex') : 'none';
  const saved = await waitFor(() => backend.table('annotation_updates').some((r) => String(r.data).includes(hex)), { timeout: 60_000, every: 25 });
  const savedMs = Date.now() - t0;
  await waitFor(() => importDone(backend), { timeout: 120_000, every: 250 });
  await backend.settle({ quietMs: 4000, timeout: 120_000 });
  const C = await openWindow(browser, backend, docId, PDF, WIN);
  await backend.settle({ quietMs: 3000, timeout: 60_000 });
  const [a, b, c, s] = [await windowCounts(A.page), await windowCounts(B.page), await windowCounts(C.page), await serverCounts(backend)];
  const wal = walStats(backend);
  await A.page.screenshot({ path: `${OUT_DIR}/first-open-A.png` });
  await C.page.screenshot({ path: `${OUT_DIR}/first-open-C.png` });
  const once = (x) => x.imported === IMPORTED && x.importedUnique === IMPORTED && x.unique === x.total;
  const ok = Boolean(rect) && Boolean(saved)
    && once(a) && once(b) && once(c) && once(s) && s.ids.includes(rect.id)
    && wal.maxRowBytes < 64 * 1024
    && A.errors.length + B.errors.length + C.errors.length === 0;
  report('FO-A', ok ? 'PASS' : 'FAIL', `rect saved ${savedMs} ms after drawing; windows imported/unique/total A=${a.imported}/${a.importedUnique}/${a.total} B=${b.imported}/${b.importedUnique}/${b.total} C(later)=${c.imported}/${c.importedUnique}/${c.total}; server ${s.imported}/${s.importedUnique}/${s.total} (rect in=${s.ids.includes(rect?.id)}); WAL ${wal.rows} rows, largest ${wal.maxRowBytes} B, ${wal.totalBytes} B in all; requests ${backend.summary().filter((l) => !/ WS /.test(l)).join(', ')}; errors ${JSON.stringify([...A.errors, ...B.errors, ...C.errors]).slice(0, 300)}`, VARIANT);
  for (const w of [A, B, C]) await w.context.close();
  expect(ok).toBe(true);
});

test('B: a reload in the middle of the import save imports nothing twice', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-0000000f0b01';
  const backend = new FakeBackend({ documentId: docId });
  // The import checkpoint's upload will not reach the server before the reload.
  const release = backend.holdSnapshots();
  const A = await openWindow(browser, backend, docId, PDF, WIN);
  await waitFor(async () => (await windowCounts(A.page)).imported >= IMPORTED, { timeout: 120_000, every: 250 });
  // An edit before the reload (saved at once, through the log).
  await drawRect(A.page, 1, 100, 600, 220, 680);
  const rect = (await waitFor(async () => (await userMarks(A.page))[0], { timeout: 10_000 })) || null;
  await waitFor(() => backend.counts.get('RPC store_annotation_snapshot') > 0, { timeout: 60_000, every: 100 });
  const before = { snapshots: backend.table('annotation_snapshots').length, marker: Boolean(importDone(backend)) };
  // Reload while that upload is still on its way; it never arrives.
  const reload = A.page.reload();
  await A.page.waitForTimeout(300);
  release('drop');
  await reload;
  await A.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await waitFor(() => importDone(backend), { timeout: 180_000, every: 250 });
  await backend.settle({ quietMs: 4000, timeout: 120_000 });
  const a = await windowCounts(A.page);
  const B = await openWindow(browser, backend, docId, PDF, WIN);
  await backend.settle({ quietMs: 3000, timeout: 60_000 });
  const [b, s] = [await windowCounts(B.page), await serverCounts(backend)];
  const wal = walStats(backend);
  await A.page.screenshot({ path: `${OUT_DIR}/first-open-reload-A.png` });
  const once = (x) => x.imported === IMPORTED && x.importedUnique === IMPORTED && x.unique === x.total;
  const ok = !before.marker && before.snapshots === 0
    && once(a) && once(b) && once(s) && Boolean(rect) && s.ids.includes(rect.id)
    && wal.maxRowBytes < 64 * 1024
    && A.errors.length + B.errors.length === 0;
  report('FO-B', ok ? 'PASS' : 'FAIL', `before reload: checkpoints stored=${before.snapshots}, marker=${before.marker}; after: A ${a.imported}/${a.importedUnique}/${a.total}, fresh B ${b.imported}/${b.importedUnique}/${b.total}, server ${s.imported}/${s.importedUnique}/${s.total} (rect drawn before the reload kept=${s.ids.includes(rect?.id)}); WAL ${wal.rows} rows, largest ${wal.maxRowBytes} B; requests ${backend.summary().filter((l) => !/ WS /.test(l)).join(', ')}; errors ${JSON.stringify([...A.errors, ...B.errors]).slice(0, 300)}`, VARIANT);
  for (const w of [A, B]) await w.context.close();
  expect(ok).toBe(true);
});

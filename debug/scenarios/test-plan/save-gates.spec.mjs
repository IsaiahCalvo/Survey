// KAL-275 — the two gating tests for deleting the last save patch.
//
// .planning/optimization/PRE-REBUILD-READINESS.md §6 Gate E says the old
// symptom patches may only go once these pass:
//   §2.1 cloud roundtrip: draw -> the server confirms it -> close -> reopen
//        -> the new mark AND every earlier mark are there.
//   §2.2 re-upload: bring the SAME file in again -> it is the SAME document
//        (no new row, no "which version?" question) -> every earlier mark is
//        visible.
// The last patch was resolveSafeSnapshot (the "empty-cloud safe-snapshot
// guard" in loadSurveyDataFromSupabase). It only ever guarded the project's
// Storage sidecar (`<project>/<doc>_data.json`) against blanking a cloud
// document's Survey Markers and spaces. So test 1 serves a STALE, EMPTY sidecar
// for the document the whole time (the exact hazard), with the document in a
// project so the viewer really downloads and reads it.
//
// Both run the real app against the in-memory stand-in for Supabase
// (tp-fake-backend.mjs): nothing reaches the network or a database. The plan
// wrote §2.1 against a real cloud document; that needs a live account and is
// out of bounds for automated runs, so this is the same flow on the fake.
//
// Run (the config starts its own dev server; .env needs VITE_SUPABASE_URL/KEY
// so the client exists — it never reaches the network here):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5392 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/save-gates.spec.mjs
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OUT_DIR, collectErrors, prepareLocalContext, report, viewerUrl,
} from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { drawRect, serverMarks, waitFor } from './tp-actions.mjs';
import { TEMPLATES, enterSurvey, placeMarker, surveyMarkers } from './lib.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 600_000 });

const PDF = 'clickable-link-test.pdf';
const PDF_BYTES = readFileSync(fileURLToPath(new URL(`../../fixtures/${PDF}`, import.meta.url)));
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');
const PROJECT_ID = '7e57d0c0-0000-4000-8000-0000000000aa';
const WIN = { device: { viewport: { width: 1440, height: 900 } } };

/** The document also sits in a project (a cloud document opened from Home always has its row's project). */
async function inProject(context) {
  await context.addInitScript((projectId) => {
    const held = Object.getOwnPropertyDescriptor(window, '__devTestPdf');
    if (!held?.set) return;
    Object.defineProperty(window, '__devTestPdf', {
      configurable: true,
      get: held.get,
      set(file) {
        if (file) { try { Object.defineProperty(file, 'projectId', { value: projectId, configurable: true }); } catch { /* keep going */ } }
        held.set.call(window, file);
      },
    });
  }, PROJECT_ID);
}

/**
 * Open the viewer; on this shared, busy box a cold dev server can reload the
 * page mid-open (dependency optimisation), so reload once before giving up.
 */
async function openViewerWithRetry(page) {
  await page.goto(viewerUrl(PDF, { cloudLibrary: true }));
  const firstPage = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  try {
    await firstPage.waitFor({ timeout: 90_000 });
  } catch {
    await page.reload();
    await firstPage.waitFor({ timeout: 120_000 });
  }
  await page.waitForFunction(() => typeof window.__ydocAnnotationCount === 'number', null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
}

/** One fresh window (own context: no IndexedDB, no localStorage) on the document. */
async function freshWindow(browser, backend, docId, { project = false } = {}) {
  const context = await browser.newContext(WIN.device);
  await prepareLocalContext(context, docId, { backend });
  if (project) await inProject(context);
  await context.addInitScript((t) => {
    try { localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(t)); } catch { /* private mode */ }
  }, TEMPLATES);
  const page = await context.newPage();
  const errors = collectErrors(page);
  await openViewerWithRetry(page);
  await backend.settle();
  return { context, page, errors };
}

// Marks as the viewer holds them (its state, not the DOM: Survey mode shows
// only the active module's marks).
const viewerMarks = (page) => page.evaluate(() => (window.__diagState?.annotationsByPage?.[1]?.objects || [])
  .map((o) => ({ id: String(o?.data?.id ?? o?.id ?? ''), imported: Boolean(o?.isPdfImported || o?.data?.isPdfImported) })));
const own = async (page) => (await viewerMarks(page)).filter((m) => !m.imported);
const imported = async (page) => (await viewerMarks(page)).filter((m) => m.imported);
const ownOnServer = async (backend) => (await serverMarks(backend)).filter((m) => !m.imported);
const serverSurveyMarkerCount = async (backend) => {
  const { surveyMarkers: sm } = await backend.serverState();
  return sm && typeof sm === 'object' ? Object.keys(sm).length : 0;
};

// --------------------------------------------------------------- §2.1

test('[KAL-275 gate 1] cloud roundtrip: draw, server confirms, close, reopen - every mark is back (with a stale empty sidecar served)', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000275';
  const backend = new FakeBackend({ documentId: docId });
  // The hazard the old guard was for: an older, EMPTY project sidecar.
  const sidecarPath = `${PROJECT_ID}/${docId}_data.json`;
  backend.putStorageObject(sidecarPath, {
    version: '1.0', pdfId: docId, annotations: {}, annotationsByPage: {}, callouts: [], spaces: [], entities: [], currentPage: 1,
  });

  // Session 0: three baseline marks (another day's work).
  const S0 = await freshWindow(browser, backend, docId, { project: true });
  const importedCount = (await imported(S0.page)).length;
  await drawRect(S0.page, 1, 60, 520, 140, 580);
  await drawRect(S0.page, 1, 180, 520, 260, 580);
  await drawRect(S0.page, 1, 300, 520, 380, 580);
  const baseline = await waitFor(async () => { const m = await ownOnServer(backend); return m.length >= 3 ? m.map((x) => x.id) : null; }, { timeout: 20_000 });
  await S0.context.close();

  // Session A: reopen, check the baseline, add one mark and one Survey Marker,
  // and wait until the SERVER holds both (never trust a fire-and-forget save).
  const A = await freshWindow(browser, backend, docId, { project: true });
  const aSawBaseline = await waitFor(async () => {
    const ids = (await own(A.page)).map((m) => m.id);
    return baseline && baseline.every((id) => ids.includes(id)) ? ids : null;
  }, { timeout: 20_000 });
  await enterSurvey(A.page);
  await placeMarker(A.page, 200, 680, 240, 720);
  await A.page.keyboard.press('Escape');
  await A.page.mouse.click(5, 450);
  await drawRect(A.page, 1, 420, 520, 500, 580);
  const confirmed = await waitFor(async () => {
    const m = await ownOnServer(backend);
    const markers = await serverSurveyMarkerCount(backend);
    return m.length >= 4 && markers >= 1 ? { ids: m.map((x) => x.id), markers } : null;
  }, { timeout: 30_000 });
  const newId = confirmed?.ids.find((id) => !baseline.includes(id)) || null;
  await A.page.screenshot({ path: `${OUT_DIR}/kal275-gate1-A.png` });
  await A.context.close();

  // Session B: a brand-new window (nothing cached on the device) reopens it.
  const B = await freshWindow(browser, backend, docId, { project: true });
  const reopened = await waitFor(async () => {
    const ids = (await own(B.page)).map((m) => m.id);
    return confirmed && confirmed.ids.every((id) => ids.includes(id)) ? ids : null;
  }, { timeout: 30_000 });
  await enterSurvey(B.page);
  const markersInB = await waitFor(async () => { const m = await surveyMarkers(B.page); return m.length >= 1 ? m.length : null; }, { timeout: 15_000 });
  const importedInB = (await imported(B.page)).length;
  const sidecarReads = backend.counts.get(`GET storage object ${sidecarPath}`) || 0;
  await B.page.screenshot({ path: `${OUT_DIR}/kal275-gate1-B-reopened.png` });
  const errors = [...S0.errors, ...A.errors, ...B.errors];
  await B.context.close();

  const ok = Boolean(baseline) && Boolean(aSawBaseline) && Boolean(newId) && Boolean(reopened)
    && markersInB === confirmed.markers && importedInB === importedCount && sidecarReads >= 3 && errors.length === 0;
  report('KAL-275-1', ok ? 'PASS' : 'FAIL',
    `baseline ${baseline?.length ?? 0} marks saved; A saw them=${Boolean(aSawBaseline)}; new mark ${newId} + ${confirmed?.markers ?? 0} Survey Marker confirmed on the server; `
    + `fresh window B shows ${reopened?.length ?? 0}/${confirmed?.ids.length ?? '?'} own marks, ${markersInB ?? 0} Survey Marker(s), ${importedInB}/${importedCount} PDF marks; `
    + `stale empty sidecar read ${sidecarReads}x; errors=${errors.length}`, 'kal275-local-backend');
  expect(baseline).toBeTruthy();
  expect(aSawBaseline).toBeTruthy();
  expect(newId).toBeTruthy();
  expect(reopened).toBeTruthy();
  expect(markersInB).toBe(confirmed.markers);
  expect(importedInB).toBe(importedCount);
  expect(sidecarReads).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

// --------------------------------------------------------------- §2.2

test('[KAL-275 gate 2] re-upload of the same file reuses the document and every mark is visible', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000276';
  const backend = new FakeBackend({ documentId: docId });
  const A = await freshWindow(browser, backend, docId);
  const importedCount = (await imported(A.page)).length;
  await drawRect(A.page, 1, 60, 520, 140, 580);
  await drawRect(A.page, 1, 200, 520, 280, 580);
  const before = await waitFor(async () => { const m = await ownOnServer(backend); return m.length >= 2 ? m.map((x) => x.id) : null; }, { timeout: 20_000 });

  // Close the document, then upload the very same file from Home.
  // (exact: the tab itself is a button whose name also contains "Close <file>")
  await A.page.getByRole('button', { name: `Close ${PDF}`, exact: true }).first().click();
  await A.page.waitForTimeout(1000);
  // Marks are already confirmed on the server; a close prompt, if any, is
  // about the local copy. Answer it with Save when offered.
  const closePrompt = A.page.getByRole('dialog').filter({ visible: true });
  let closePromptText = '';
  if (await closePrompt.count()) {
    closePromptText = (await closePrompt.first().innerText()).replace(/\s+/g, ' ').slice(0, 160);
    const save = closePrompt.first().getByRole('button', { name: /^Save/ });
    const discard = closePrompt.first().getByRole('button', { name: /^(Close without saving|Don.t save|Discard)/ });
    if (await save.count()) await save.first().click();
    else if (await discard.count()) await discard.first().click();
  }
  await expect(A.page.getByRole('button', { name: `Close ${PDF}`, exact: true })).toHaveCount(0, { timeout: 30_000 });
  await A.page.locator('.survey-hub').waitFor({ timeout: 30_000 });
  await A.page.waitForTimeout(800);
  // The document row as Home made it on the first upload (content-addressed:
  // name, bytes hash, bytes at <user>/<sha>.pdf). Filled in only now: the dev
  // route opens its test file directly, and a library row with the same name
  // during that first open makes the dev route open it a second time.
  Object.assign(backend.table('documents')[0], {
    name: PDF,
    file_path: `dev-test-user/${PDF_SHA}.pdf`,
    file_size: PDF_BYTES.length,
    content_sha256: PDF_SHA,
    project_id: null,
    archived: false,
  });
  // ...and its bytes, stored at the row's content-addressed path.
  backend.putStorageObject(`dev-test-user/${PDF_SHA}.pdf`, PDF_BYTES, 'application/pdf');

  const rowsBefore = backend.table('documents').length;
  const upload = { name: PDF, mimeType: 'application/pdf', buffer: PDF_BYTES };
  const chooser = A.page.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null);
  await A.page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first().click({ timeout: 30_000 });
  const picker = await chooser;
  // The hub's Upload opens the Documents file input; when the headless
  // browser does not surface the native picker, hand the same file to that
  // input (the app's own change handler runs either way).
  if (picker) await picker.setFiles(upload);
  else await A.page.locator('input[type="file"][accept="application/pdf"]:not([multiple])').first().setInputFiles(upload);
  const uploadedVia = picker ? 'file picker' : 'file input';

  // It opens again, as the same document, with no "which version?" question.
  await A.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 120_000 });
  const askedVersion = await A.page.getByRole('dialog').filter({ hasText: /version|already/i }).count();
  const after = await waitFor(async () => {
    const ids = (await own(A.page)).map((m) => m.id);
    return before && before.every((id) => ids.includes(id)) ? ids : null;
  }, { timeout: 30_000 });
  const importedAfter = (await imported(A.page)).length;
  const rowsAfter = backend.table('documents').length;
  // A mark drawn now lands in the SAME document on the server.
  await drawRect(A.page, 1, 340, 520, 420, 580);
  const sameDoc = await waitFor(async () => { const m = await ownOnServer(backend); return m.length >= 3 ? m.length : null; }, { timeout: 20_000 });
  const otherDocWrites = backend.table('annotation_updates').filter((r) => r.document_id !== docId).length;
  await A.page.screenshot({ path: `${OUT_DIR}/kal275-gate2-reuploaded.png` });
  const errors = [...A.errors];
  await A.context.close();

  const ok = Boolean(before) && Boolean(after) && askedVersion === 0 && rowsAfter === rowsBefore
    && importedAfter === importedCount && sameDoc === 3 && otherDocWrites === 0 && errors.length === 0;
  report('KAL-275-2', ok ? 'PASS' : 'FAIL',
    `${before?.length ?? 0} marks saved; close prompt: ${closePromptText || 'none'}; same file uploaded again (via ${uploadedVia}): document rows ${rowsBefore} -> ${rowsAfter}, version question=${askedVersion}; `
    + `reopened shows ${after?.length ?? 0} own marks (all earlier ones=${Boolean(after)}), ${importedAfter}/${importedCount} PDF marks; `
    + `next mark saved to the same document (server now ${sameDoc ?? 0}), writes to any other document=${otherDocWrites}; errors=${errors.length}`, 'kal275-local-backend');
  expect(before).toBeTruthy();
  expect(askedVersion).toBe(0);
  expect(rowsAfter).toBe(rowsBefore);
  expect(after).toBeTruthy();
  expect(importedAfter).toBe(importedCount);
  expect(sameDoc).toBe(3);
  expect(otherDocWrites).toBe(0);
  expect(errors).toEqual([]);
});

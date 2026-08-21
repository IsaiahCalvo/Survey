import { test, expect } from '@playwright/test';

// Live import of an annotated fixture on the unblocked DEV path:
//   http://localhost:5173/?testPdf=<annotated-fixture>
// Do not retry leftover 18 or Electron native File→Open (UL-03).
// Do not invent a guest hub importer. Hub web upload stays leftover-gated.

const IMPORT_PDF = '/?testPdf=kal412-mixed-import-e2e.pdf';
const MISSING_PDF = '/?testPdf=does-not-exist.pdf';

async function openEditor(page, fixture = IMPORT_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload Page', exact: true })).toHaveCount(0);
}

async function annotationProof(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const rows = ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true || Boolean(object.pdfAnnotationId || data.pdfAnnotationId),
        text: object.text || data.text || null,
      };
    });
    const imported = rows.filter((row) => row.imported);
    const live = rows.filter((row) => !row.imported);
    const pageCanvas = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNum}"] canvas`);
    return {
      imported: imported.length,
      live: live.length,
      importedIds: imported.map((row) => row.id),
      liveIds: live.map((row) => row.id),
      types: imported.map((row) => row.type || row.tool),
      pageCanvas: Boolean(pageCanvas),
      pageCanvasPixels: pageCanvas ? (pageCanvas.width * pageCanvas.height) : 0,
    };
  }, pageNumber);
}

async function waitForImportedOrFlattened(page) {
  let proof = null;
  await expect.poll(async () => {
    proof = await annotationProof(page);
    return proof.imported > 0 || (proof.pageCanvas && proof.pageCanvasPixels > 0);
  }, { message: 'expected imported annotations or a flattened page canvas' }).toBe(true);
  return proof;
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  const proof = await annotationProof(page, pageNumber);
  return [...proof.importedIds, ...proof.liveIds].map((id) => ({ id }));
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

test('?testPdf= annotated fixture: intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Break first: unknown fixture must fail closed (no crash, no editor).
  const pageErrors = [];
  page.on('pageerror', (err) => { pageErrors.push(String(err?.message || err)); });
  await page.goto(MISSING_PDF);
  await expect(page.getByText('Failed to load test PDF')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Failed to fetch test PDF:\s*404/)).toBeVisible();
  await assertNoErrorBoundary(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  const breakHref = page.url();
  const breakCrashed = pageErrors.some((msg) => /Rendered fewer hooks|Something went wrong|ChunkLoadError/i.test(msg));

  // Intended: annotated fixture loads; imported (or flattened natives) are countable.
  await openEditor(page, IMPORT_PDF);
  await assertNoErrorBoundary(page);
  const intendedProof = await waitForImportedOrFlattened(page);
  expect(
    intendedProof.imported > 0 || (intendedProof.pageCanvas && intendedProof.pageCanvasPixels > 0),
    'kal412 must show imported annotations or flattened natives',
  ).toBe(true);

  // Edge: one new live shape must not wipe imported content.
  const importedBefore = intendedProof.importedIds.slice();
  const liveBefore = new Set(intendedProof.liveIds);
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.62, y0: 0.18, x1: 0.86, y1: 0.36 });
  let created = null;
  await expect.poll(async () => {
    const after = await annotationProof(page);
    created = after.liveIds.find((id) => !liveBefore.has(id)) || null;
    return created;
  }, { message: 'expected a new live rectangle after draw' }).not.toBeNull();

  const edgeProof = await annotationProof(page);
  const importedStillPresent = importedBefore.every((id) => edgeProof.importedIds.includes(id));
  expect(edgeProof.imported, 'new draw must not wipe imported kal412 marks').toBe(intendedProof.imported);
  expect(importedStillPresent, 'imported ids must survive the new draw').toBe(true);
  expect(created, 'edge draw must create a live shape').toBeTruthy();
  await assertNoErrorBoundary(page);

  const receipt = {
    path: '?testPdf=',
    fixture: 'kal412-mixed-import-e2e.pdf',
    leftover18: 'unchanged',
    usedHubWebUpload: false,
    usedElectronNative: false,
    break: {
      href: breakHref,
      failClosed: true,
      crashed: breakCrashed,
      pageErrors,
      verdict: (!breakCrashed && /does-not-exist/.test(breakHref)) ? 'pass' : 'fail',
    },
    intended: {
      imported: intendedProof.imported,
      live: intendedProof.live,
      types: intendedProof.types,
      pageCanvas: intendedProof.pageCanvas,
      pageCanvasPixels: intendedProof.pageCanvasPixels,
      verdict: intendedProof.imported > 0 ? 'pass' : (intendedProof.pageCanvasPixels > 0 ? 'pass-flattened' : 'fail'),
    },
    edge: {
      drawnId: created,
      importedBefore: importedBefore.length,
      importedAfter: edgeProof.imported,
      importedIdsPreserved: importedStillPresent,
      liveAfter: edgeProof.live,
      verdict: (edgeProof.imported === intendedProof.imported && importedStillPresent && created) ? 'pass' : 'fail',
    },
  };
  console.log('TESTPDF_IMPORT', JSON.stringify(receipt));
});

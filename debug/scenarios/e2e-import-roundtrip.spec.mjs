import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Live import of an annotated export on Vite 5173 via the web file control.
// Do not replay wave9, leftover 18, or Electron File→Open (UL-03).
// Do not invent an importer. Guest hub upload is an intentional product gate.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const NATIVE_FIXTURE = join(process.cwd(), 'debug/fixtures/kal412-mixed-import-e2e.pdf');
const LINK_FIXTURE = join(process.cwd(), 'debug/fixtures/clickable-link-test.pdf');
const EXPORT_PATH = join(tmpdir(), `e2e-import-roundtrip-${Date.now()}.pdf`);
const NON_PDF_PATH = join(tmpdir(), `e2e-import-roundtrip-${Date.now()}.txt`);

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return annoIds.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        text: object.text || data.text || null,
      };
    });
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && row.imported !== true && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
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

async function createPenRectText(page) {
  const drawn = {};

  const beforePen = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { x0: 0.20, y0: 0.26, x1: 0.42, y1: 0.34 });
  drawn.pen = await waitForNewUserAnnotation(page, beforePen, (row) => (
    row.type === 'path' || row.tool === 'pen'
  ));

  const beforeRect = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.22, y0: 0.40, x1: 0.40, y1: 0.56 });
  drawn.rect = await waitForNewUserAnnotation(page, beforeRect, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));

  const beforeText = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await page.keyboard.press('t');
  const overlay = page.locator('[data-text-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
  if (await sub.count() && (await sub.getAttribute('aria-pressed')) !== 'true') await sub.click();
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, { x0: 0.18, y0: 0.62, x1: 0.40, y1: 0.74 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) {
    await page.keyboard.press('t');
    await expect(overlay).toBeVisible({ timeout: 8_000 });
    await dragOnPage(page, { x0: 0.22, y0: 0.66, x1: 0.44, y1: 0.78 });
  }
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('rt-import', { delay: 8 });
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  drawn.text = await waitForNewUserAnnotation(page, beforeText, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
  ));

  return drawn;
}

async function exportAnnotatedPdf(page) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  const path = await download.path();
  expect(path, 'exported PDF path').toBeTruthy();
  const bytes = readFileSync(path);
  writeFileSync(EXPORT_PATH, bytes);
  return { path: EXPORT_PATH, bytes, suggested: download.suggestedFilename() };
}

function pdfFileInput(page) {
  return page.locator('input[type="file"][accept="application/pdf"]');
}

async function editorVisible(page, timeout = 8_000) {
  return page.getByRole('button', { name: 'Draw', exact: true })
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

async function signInGateVisible(page) {
  const error = page.getByText('Please sign in to upload documents.');
  const welcome = page.getByRole('heading', { name: 'Welcome back' });
  const continueGuest = page.getByRole('button', { name: 'Continue without an account' });
  return (
    (await error.isVisible().catch(() => false))
    || (await welcome.isVisible().catch(() => false))
    || (await continueGuest.isVisible().catch(() => false))
  );
}

async function openGuestHub(page) {
  await page.goto('/');
  const accountMenu = page.getByRole('button', { name: 'Open account menu' });
  const signedIn = await accountMenu.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false);
  if (signedIn) {
    await expect(page.getByRole('button', { name: /^Upload/ }).first()).toBeVisible({ timeout: 30_000 });
    return { signedIn: true };
  }

  const continueGuest = page.getByRole('button', { name: 'Continue without an account' });
  if (await continueGuest.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await continueGuest.click();
  }
  await expect(page.getByRole('button', { name: /^Upload/ }).first()).toBeVisible({ timeout: 30_000 });
  return { signedIn: false };
}

async function importedOrFlattenedProof(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
      .map((id) => {
        const object = window.__phase35GetAnnotationById?.(id) || {};
        return {
          id,
          imported: object.isPdfImported === true,
          type: String(object.type || object.data?.type || '').toLowerCase(),
          tool: String(object.data?.tool || object.tool || '').toLowerCase(),
          text: object.text || object.data?.text || null,
        };
      });
    return {
      imported: rows.filter((row) => row.imported).length,
      live: rows.filter((row) => !row.imported).length,
      hasText: rows.some((row) => /rt-import/i.test(String(row.text || ''))),
      types: rows.map((row) => row.type || row.tool),
    };
  });
}

test('web file-control import hunt: intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  // Wave9 download is not on disk. Create a fresh annotated export (not the
  // wave9 suite): pen + rect + text on the testPdf editor, then leave that
  // route. Import must go through the hub web file control, not ?testPdf=.
  await openEditor(page);
  const drawn = await createPenRectText(page);
  expect(drawn.pen?.id).toBeTruthy();
  expect(drawn.rect?.id).toBeTruthy();
  expect(drawn.text?.id).toBeTruthy();
  const exported = await exportAnnotatedPdf(page);
  expect(exported.bytes.length).toBeGreaterThan(1000);
  writeFileSync(NON_PDF_PATH, 'this is not a pdf');

  const boot = await openGuestHub(page);
  const fileInputs = pdfFileInput(page);
  const fileInputCount = await fileInputs.count();
  const upload = page.getByRole('button', { name: /^Upload/ }).first();
  await expect(upload).toBeVisible();

  const inEditorPdfInput = await page.locator('input[type="file"][accept*="pdf"]').count();
  const electronApi = await page.evaluate(() => Boolean(window.electronAPI?.openFile));

  // Break: cancel the web picker. Do not use Electron showOpenDialog.
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
  await upload.click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  // Abandon without setFiles — that is cancel.
  await page.waitForTimeout(400);
  const afterCancelEditor = await editorVisible(page, 2_000);
  const afterCancelHref = page.url();

  // Break: reject a non-PDF through the same web control.
  expect(fileInputCount, 'hub must mount the web PDF file input').toBeGreaterThan(0);
  await fileInputs.first().setInputFiles(NON_PDF_PATH);
  await page.waitForTimeout(500);
  const afterNonPdfEditor = await editorVisible(page, 2_000);
  const afterNonPdfSignIn = await signInGateVisible(page);
  const afterNonPdfError = await page.getByText('Please sign in to upload documents.').count();

  // Intended: feed the annotated export through the web file input.
  await fileInputs.first().setInputFiles(EXPORT_PATH);
  const intendedOpened = await editorVisible(page, 20_000);
  const intendedGate = await signInGateVisible(page);
  const intendedError = await page.getByText('Please sign in to upload documents.').isVisible().catch(() => false);
  let intendedProof = null;
  if (intendedOpened) {
    await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
    intendedProof = await importedOrFlattenedProof(page);
  }

  // Edge: native-annotation fixture through the same web control — not ?testPdf=.
  // If intended already opened the editor, go back to the hub first.
  if (intendedOpened) {
    const home = page.getByRole('button', { name: /Home|Documents|Survey/i }).first();
    await page.goto('/');
    if (!boot.signedIn) {
      const continueGuest = page.getByRole('button', { name: 'Continue without an account' });
      if (await continueGuest.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await continueGuest.click();
      }
    }
    await expect(page.getByRole('button', { name: /^Upload/ }).first()).toBeVisible({ timeout: 30_000 });
  }
  const edgeInputs = pdfFileInput(page);
  let edgeOpened = false;
  let edgeGate = false;
  let edgeProof = null;
  let liveBefore = null;
  if (await edgeInputs.count()) {
    if (intendedOpened) {
      // If we are still in an editor (home failed), capture live draws first.
      if (await editorVisible(page, 1_000)) {
        liveBefore = await importedOrFlattenedProof(page);
      }
    }
    await edgeInputs.first().setInputFiles(NATIVE_FIXTURE);
    edgeOpened = await editorVisible(page, 20_000);
    edgeGate = await signInGateVisible(page);
    if (edgeOpened) {
      await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
      await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
      edgeProof = await importedOrFlattenedProof(page);
    }
  }

  const intendedVerdict = intendedOpened
    ? ((intendedProof?.imported > 0 || intendedProof?.hasText || intendedProof?.live > 0) ? 'pass' : 'fail')
    : (intendedGate || intendedError ? 'blocked' : 'fail');
  const breakVerdict = (!afterCancelEditor && !afterNonPdfEditor) ? 'pass' : 'fail';
  const edgeVerdict = edgeOpened
    ? ((edgeProof?.imported > 0) ? 'pass' : 'fail')
    : (edgeGate || intendedError ? 'blocked' : 'fail');

  const receipt = {
    webFileControl: fileInputCount > 0,
    fileInputCount,
    electronApi,
    inEditorPdfInput,
    signedIn: boot.signedIn,
    exportBytes: exported.bytes.length,
    exportSuggested: exported.suggested,
    drawn: { pen: drawn.pen?.id, rect: drawn.rect?.id, text: drawn.text?.id },
    break: {
      cancelOpenedEditor: afterCancelEditor,
      cancelHref: afterCancelHref,
      nonPdfOpenedEditor: afterNonPdfEditor,
      nonPdfSignIn: afterNonPdfSignIn,
      nonPdfSignInError: afterNonPdfError,
      verdict: breakVerdict,
    },
    intended: {
      opened: intendedOpened,
      gate: intendedGate,
      signInError: intendedError,
      proof: intendedProof,
      verdict: intendedVerdict,
      usedTestPdfToImport: false,
      usedElectronNative: false,
      inventedImporter: false,
    },
    edge: {
      fixture: 'kal412-mixed-import-e2e.pdf',
      opened: edgeOpened,
      gate: edgeGate,
      proof: edgeProof,
      liveBefore,
      verdict: edgeVerdict,
      usedTestPdfToImport: false,
    },
    leftover18: 'unchanged',
  };

  console.log('IMPORT_ROUNDTRIP', JSON.stringify(receipt));

  expect(electronApi, 'this hunt is Vite web, not Electron native File→Open').toBe(false);
  expect(fileInputCount, 'hub web file control must exist').toBeGreaterThan(0);
  expect(afterCancelEditor, 'cancel must not open an editor').toBe(false);
  expect(afterNonPdfEditor, 'non-PDF must not open an editor').toBe(false);

  if (intendedOpened) {
    expect(
      intendedProof?.imported > 0 || intendedProof?.hasText || (intendedProof?.live ?? 0) > 0,
      'opened export must show imported or flattened marks',
    ).toBe(true);
  } else {
    expect(
      intendedGate || intendedError,
      'guest/unsigned hub upload must hit the existing sign-in gate, not invent a local importer',
    ).toBe(true);
  }

  if (edgeOpened) {
    expect(edgeProof?.imported, 'kal412 natives must import').toBeGreaterThan(0);
    if (liveBefore?.live > 0 && intendedOpened && edgeOpened === intendedOpened) {
      expect(edgeProof.live, 'natives must not stomp live draws on the same open').toBeGreaterThan(0);
    }
  } else {
    expect(edgeGate || intendedError, 'edge open uses the same leftover auth gate').toBe(true);
  }
});

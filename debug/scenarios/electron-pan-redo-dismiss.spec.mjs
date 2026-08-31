import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.ELECTRON_REPRO_PORT || '5202';
const FIXTURE_URL = `http://127.0.0.1:${PORT}/?testPdf=text-selection-rotation-matrix.pdf`;
const PAN_NEGATIVE_CONTROL = process.env.ELECTRON_PAN_NEGATIVE_CONTROL === '1';

let electronApp;
let page;
let electronUserDataDir;

test.describe.configure({ mode: 'serial' });

async function openFixture() {
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);
  console.log(`ELECTRON_FIXTURE_BOOT ${JSON.stringify({
    url: page.url(),
    title: await page.title(),
    body: (await page.locator('body').innerText().catch(() => '')).slice(0, 500),
  })}`);
  await page.locator('.survey-pdfjs-page-div').first().waitFor({
    state: 'attached',
    timeout: 15_000,
  });
}

async function setZoomPercent(percent) {
  const trigger = page.getByRole('button', { name: 'Edit zoom percentage' });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const input = page.getByRole('textbox', { name: /zoom percentage/i });
  if (await input.count()) {
    await input.fill(String(percent));
    await input.press('Enter');
  } else {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(String(percent));
    await page.keyboard.press('Enter');
  }
  await expect(trigger).toHaveText(`${percent}%`);
}

async function panState() {
  const feature = page.locator('.survey-pdfjs-page-div').first();
  const featureBox = await feature.boundingBox();
  const scroll = await feature.evaluate((node) => {
    let current = node.parentElement;
    while (current) {
      if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
        return {
          left: Number(current.scrollLeft),
          top: Number(current.scrollTop),
          className: String(current.className || ''),
        };
      }
      current = current.parentElement;
    }
    return { left: 0, top: 0, className: null };
  });
  const zoom = (await page.getByRole('button', { name: 'Edit zoom percentage' }).innerText()).trim();
  return { featureBox, scroll, zoom };
}

async function annotationCount() {
  return page.locator('.survey-pdfjs-page-div').first().evaluate((node) =>
    Number(node.getAttribute('data-page-annotation-object-count') || 0)
  );
}

async function historyProof() {
  return page.evaluate(() => ({
    state: window.__pdfHistoryDebug?.state?.() || null,
    timeline: window.__pdfHistoryDebug?.getTimeline?.(20) || [],
  }));
}

async function selectFixtureText() {
  await page.keyboard.press('Shift+V');
  const pdfBox = await page.locator('.survey-pdfjs-page-div').first().boundingBox();
  expect(pdfBox, 'PDF page must be measurable').toBeTruthy();
  const start = { x: pdfBox.x + pdfBox.width * 0.08, y: pdfBox.y + pdfBox.height * 0.125 };
  const end = { x: pdfBox.x + pdfBox.width * 0.52, y: pdfBox.y + pdfBox.height * 0.16 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  console.log(`ELECTRON_SELECTION_BUTTONS ${JSON.stringify(await page.locator('button').evaluateAll((buttons) => buttons
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((button) => button.getAttribute('aria-label') || button.textContent?.trim())
    .filter(Boolean)))}`);
}

test.beforeEach(async () => {
  electronUserDataDir = mkdtempSync(join(tmpdir(), 'survey-electron-e2e-'));
  electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${electronUserDataDir}`],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEV_PORT: PORT,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });
  page = await electronApp.firstWindow();
});

test.afterEach(async () => {
  if (electronApp) {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(async () => {
      await electronApp.close().catch(() => {});
    });
    electronApp = null;
    page = null;
  }
  if (electronUserDataDir) {
    rmSync(electronUserDataDir, { recursive: true, force: true });
    electronUserDataDir = null;
  }
});

test('Electron Pan keeps fixed zoom and moves the page after a blank-space drag', async () => {
  test.setTimeout(120_000);
  await openFixture();

  await setZoomPercent(164);
  if (PAN_NEGATIVE_CONTROL) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Pan', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Edit zoom percentage' })).toHaveText('164%');

  const pdfPage = page.locator('.survey-pdfjs-page-div').first();
  const box = await pdfPage.boundingBox();
  expect(box, 'PDF page must be measurable').toBeTruthy();

  const before = await panState();
  const start = {
    x: box.x + box.width * 0.72,
    y: box.y + box.height * 0.72,
  };
  const end = { x: start.x - 100, y: start.y - 150 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await panState();
  const delta = {
    featureX: Math.abs(Number(after.featureBox?.x) - Number(before.featureBox?.x)),
    featureY: Math.abs(Number(after.featureBox?.y) - Number(before.featureBox?.y)),
    scrollLeft: Math.abs(after.scroll.left - before.scroll.left),
    scrollTop: Math.abs(after.scroll.top - before.scroll.top),
  };
  const maxDelta = Math.max(...Object.values(delta));
  const repro = { negativeControl: PAN_NEGATIVE_CONTROL, start, end, before, after, delta, maxDelta };
  console.log(`ELECTRON_PAN_REPRO ${JSON.stringify(repro)}`);

  expect(after.zoom, `Pan must keep the fixed zoom: ${JSON.stringify(repro)}`).toBe('164%');
  expect(maxDelta, `Blank-page Pan drag must move a fixed PDF feature or viewer scroll: ${JSON.stringify(repro)}`).toBeGreaterThanOrEqual(20);
});

test('Electron protected popover keeps inside input and consumes one outside dismiss click', async () => {
  test.skip(PAN_NEGATIVE_CONTROL, 'Pan negative control only');
  await openFixture();

  await selectFixtureText();
  await expect(page.getByRole('button', { name: 'Apply Highlight', exact: true })).toBeVisible();

  const colorButton = page.getByRole('button', { name: 'Set Highlight color', exact: true });
  await expect(colorButton).toBeVisible();
  await colorButton.click();

  const opacity = page.locator('input[type="range"]').first();
  await expect(opacity).toBeVisible();
  const rangeBox = await opacity.boundingBox();
  expect(rangeBox, 'Opacity control must be measurable').toBeTruthy();
  await page.mouse.click(rangeBox.x + rangeBox.width * 0.6, rangeBox.y + rangeBox.height / 2);
  await expect(opacity, 'Inside input must keep the protected popover open').toBeVisible();

  const beforeCount = await annotationCount();
  const pdfBox = await page.locator('.survey-pdfjs-page-div').first().boundingBox();
  expect(pdfBox, 'PDF page must be measurable').toBeTruthy();
  await page.mouse.click(pdfBox.x + pdfBox.width * 0.72, pdfBox.y + pdfBox.height * 0.72);
  await expect(opacity, 'First outside click must close the protected popover').toBeHidden();
  const afterCount = await annotationCount();
  console.log(`ELECTRON_DISMISS_REPRO ${JSON.stringify({ beforeCount, afterCount })}`);
  expect(afterCount, 'Outside dismissal click must be consumed without creating a mark').toBe(beforeCount);
});

test('Electron Redo is visible and restores the exact undone mark', async () => {
  test.skip(PAN_NEGATIVE_CONTROL, 'Pan negative control only');
  await openFixture();

  await selectFixtureText();
  const removeExisting = page.getByRole('button', { name: 'Remove Highlight', exact: true });
  if (await removeExisting.count()) {
    await removeExisting.click();
    await expect(page.getByRole('button', { name: 'Apply Highlight', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Apply Highlight', exact: true }).click();
  await expect.poll(async () => (await historyProof()).state?.localAnnotationUndoDepth).toBe(1);
  const afterApply = await historyProof();
  const created = [...afterApply.timeline].reverse().find((event) => event.type === 'local_annotation_history_added');
  expect(created?.annotationId, 'Apply must record the exact text-markup annotation ID').toBeTruthy();
  const renderedMark = page.locator(`[data-annotation-id="${created.annotationId}"]`);
  await expect(renderedMark, 'Apply must show the new mark').toBeVisible();

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(redo, 'Undo must expose visible enabled Redo state').toBeEnabled();
  await expect(renderedMark, 'Undo must remove the exact mark').toBeHidden();

  await redo.click();
  await expect(renderedMark, 'Redo must restore the exact mark').toBeVisible();
  const afterRedo = await historyProof();
  console.log(`ELECTRON_REDO_REPRO ${JSON.stringify({
    annotationId: created.annotationId,
    redoEnabledAfterUndo: true,
    state: afterRedo.state,
    timeline: afterRedo.timeline.map((event) => ({
      seq: event.seq,
      type: event.type,
      annotationId: event.annotationId || null,
      undoDepth: event.undoDepth ?? null,
      redoDepth: event.redoDepth ?? null,
    })),
  })}`);
});

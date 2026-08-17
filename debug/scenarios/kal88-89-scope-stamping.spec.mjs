// KAL-88 / KAL-89 residuals — live-app verification of survey scope stamping
// and the eraser's survey-mode gate, on the same surveyTransitionE2E fixture
// kal436-survey-transition.spec.mjs uses (local test PDF, seam templates,
// no cloud auth).
//
// KAL-88: a Text and a Counter created while survey mode (module
// "Existing Survey Data") is active must be survey-scoped — visible in the
// creating module, hidden in the other module, hidden in standard mode —
// while a standard-mode pen stroke stays canvas-scoped (hidden in survey
// mode, visible in standard mode).
//
// KAL-89: with survey mode active, an eraser sweep straight across a
// survey-HIDDEN standard pen stroke must be refused; the stroke survives
// back in standard mode.
import { test, expect } from '@playwright/test';

const FIXTURE = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

const annotationIds = (page) => page.evaluate(() => [
  ...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]'),
].map((node) => node.getAttribute('data-anno-id')).filter(Boolean).sort());

test('KAL-88/89: text + counter creations stamp survey scope; eraser refuses survey-hidden marks', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(FIXTURE);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const annotationLayer = page.locator('[data-svg-annotation-layer="1"]');
  await expect(annotationLayer).toBeVisible({ timeout: 30_000 });

  // ---- Standard mode: one canvas-scoped pen stroke (the KAL-89 victim). ----
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const box = await annotationLayer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + 260, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 250, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => annotationIds(page).then((ids) => ids.length)).toBe(1);
  const [penStrokeId] = await annotationIds(page);

  // ---- Enter survey mode (module: Existing Survey Data). ----
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByText('Existing Survey Data', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Walls/ }).click();
  await expect(page.getByRole('button', { name: 'Expand Survey panel' })).toBeVisible();
  // Canvas-scoped pen stroke is hidden by survey mode.
  await expect.poll(() => annotationIds(page)).toEqual([]);

  // ---- KAL-89: eraser sweep straight across the hidden pen stroke. ----
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: /Partial erase|Full stroke erase/ }).click();
  await page.mouse.move(box.x + 240, box.y + 210);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 260, { steps: 12 });
  await page.mouse.up();

  // ---- KAL-88 (text): create a Text annotation while survey mode is on. ----
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box.x + 420, box.y + 160);
  await page.keyboard.type('Survey scoped text');
  // Tool switch commits the text (unmount = commit).
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  // The committed text is survey-scoped -> visible in the active module.
  await expect.poll(() => annotationIds(page).then((ids) => ids.length)).toBe(1);
  const [textId] = await annotationIds(page);
  expect(textId).not.toBe(penStrokeId);

  // ---- KAL-88 (counter): drop a Counter pin while survey mode is on. ----
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  await page.mouse.move(box.x + 480, box.y + 300);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => annotationIds(page).then((ids) => ids.length)).toBe(2);
  const surveyIds = await annotationIds(page);
  const counterId = surveyIds.find((id) => id !== textId);
  expect(counterId).toBeTruthy();

  // ---- Switch to the OTHER survey module: both survey marks hide. ----
  const moduleSelect = page.getByRole('combobox', { name: 'Survey module' });
  await moduleSelect.selectOption('kal436-other-module');
  await expect.poll(() => annotationIds(page)).toEqual([]);
  await moduleSelect.selectOption('kal436-module');
  await expect.poll(() => annotationIds(page)).toEqual(surveyIds);

  // ---- Back to standard mode. ----
  await page.getByRole('button', { name: 'Close Survey panel' }).click();
  await expect(page.getByRole('button', { name: 'Survey', exact: true })).toBeVisible();

  const standardIds = await annotationIds(page);
  // KAL-89: the survey-hidden pen stroke survived the survey-mode erase sweep.
  expect(standardIds).toContain(penStrokeId);
  // KAL-88: the survey-scoped text + counter do NOT appear in standard mode.
  expect(standardIds).not.toContain(textId);
  expect(standardIds).not.toContain(counterId);
  expect(standardIds).toEqual([penStrokeId]);

  // ---- Control: the eraser DOES touch the pen stroke in standard mode, ----
  // proving the survey-mode refusal above was the gate, not a dead eraser.
  // Partial erase may carve (mutating the stroke) or delete it outright, so
  // "touched" means the id disappeared OR the rendered geometry changed.
  const strokeGeometry = (id) => page.evaluate((annoId) => {
    const node = document.querySelector(
      `[data-svg-annotation-layer="1"] [data-anno-id="${annoId}"]`,
    );
    return node ? node.innerHTML : null;
  }, penStrokeId);
  const geometryBefore = await strokeGeometry(penStrokeId);
  expect(geometryBefore).not.toBeNull();

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: /Partial erase|Full stroke erase/ }).click();
  await page.mouse.move(box.x + 240, box.y + 210);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 260, { steps: 12 });
  await page.mouse.up();
  await expect.poll(
    async () => {
      const after = await strokeGeometry(penStrokeId);
      return after === null || after !== geometryBefore;
    },
    { timeout: 15_000 },
  ).toBe(true);
});

import { test, expect } from '@playwright/test';

// Unique unblocked GAP after thumbnail click:
// Desktop Survey Previous/Next *module* vs U-01 Walls *category* stamp.
// KAL-436 has two modules; every prior spec clicked Walls only.
// Do not replay thumbnail click, Fit height, Bookmarks, leftover-18,
// Keep active, Survey notes, callout knee, Mirror V, page input.
// No 768 tablet pass. Do not stamp file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

async function waitEditor(page) {
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 45_000 });
}

async function openDesktopSurvey(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await waitEditor(page);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
}

function prevBtn(page) {
  return rightRail(page).getByRole('button', { name: 'Previous module', exact: true });
}

function nextBtn(page) {
  return rightRail(page).getByRole('button', { name: 'Next module', exact: true });
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

async function moduleLabel(page) {
  const trigger = rightRail(page).getByRole('button', { name: /Survey Data/ }).first();
  return (await trigger.innerText()).trim();
}

async function userMarkCount(page) {
  return page.evaluate(() => {
    if (typeof window.__phase35ListUserAnnotationIds === 'function') {
      return window.__phase35ListUserAnnotationIds().length;
    }
    return document.querySelectorAll('[data-anno-id], [data-callout-id], [data-survey-marker-id]').length;
  });
}

test('desktop Previous/Next module is not the Walls category click', async ({ page }) => {
  await openDesktopSurvey(page);

  await expect(prevBtn(page)).toBeVisible();
  await expect(nextBtn(page)).toBeVisible();
  expect(await moduleLabel(page)).toMatch(/Existing Survey Data/);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).toHaveCount(0);
  await expect(prevBtn(page)).toBeDisabled();
  await expect(nextBtn(page)).toBeEnabled();

  // Intended: Next steps to the other module. Walls is gone; Doors appears.
  await nextBtn(page).click();
  await expect.poll(async () => moduleLabel(page)).toMatch(/Other Survey Data/);
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveCount(0);
  await expect(prevBtn(page)).toBeEnabled();
  await expect(nextBtn(page)).toBeDisabled();

  // Intended back: Previous restores Existing / Walls.
  await prevBtn(page).click();
  await expect.poll(async () => moduleLabel(page)).toMatch(/Existing Survey Data/);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).toHaveCount(0);

  // Break: disabled Previous on the first module is a no-op.
  await prevBtn(page).click({ force: true });
  expect(await moduleLabel(page)).toMatch(/Existing Survey Data/);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();

  // Contrast: dropdown pick is not Next. Jump to Other, then Next stays.
  await rightRail(page).getByRole('button', { name: /Existing Survey Data/ }).click();
  await rightRail(page).getByRole('option', { name: 'Other Survey Data', exact: true }).click();
  await expect.poll(async () => moduleLabel(page)).toMatch(/Other Survey Data/);
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).toBeVisible();
  await nextBtn(page).click({ force: true });
  expect(await moduleLabel(page)).toMatch(/Other Survey Data/);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveCount(0);

  // Break absent: no third module control.
  await expect(page.getByRole('button', { name: 'Next module', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Third Survey Data/ })).toHaveCount(0);

  // Edge: Walls armed then Next clears the category (Doors not auto-selected).
  await prevBtn(page).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  await nextBtn(page).click();
  await expect.poll(async () => moduleLabel(page)).toMatch(/Other Survey Data/);
  const doors = page.getByRole('button', { name: 'Doors', exact: true });
  await expect(doors).toBeVisible();
  await expect(doors).not.toHaveClass(/btn-active|is-active/);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveCount(0);

  // Edge: Pen armed. Next still steps; no new mark.
  await prevBtn(page).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const before = await userMarkCount(page);
  await nextBtn(page).click();
  await expect.poll(async () => moduleLabel(page)).toMatch(/Other Survey Data/);
  expect(await userMarkCount(page)).toBe(before);
});

import { test, expect } from '@playwright/test';

const FIXTURE = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

test('KAL-436: selecting a real template preserves the PDF and isolates Survey annotations', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(FIXTURE);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const pdfPage = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pdfPage).toBeVisible({ timeout: 30_000 });
  const annotationLayer = page.locator('[data-svg-annotation-layer="1"]');
  await expect(annotationLayer).toBeVisible();

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const annotationBox = await annotationLayer.boundingBox();
  expect(annotationBox).not.toBeNull();
  await page.mouse.move(annotationBox.x + 260, annotationBox.y + 220);
  await page.mouse.down();
  await page.mouse.move(annotationBox.x + 340, annotationBox.y + 250, { steps: 8 });
  await page.mouse.up();
  await expect(annotationLayer.locator('[data-anno-id]')).not.toHaveCount(0);

  const before = await page.evaluate(() => {
    const mountedPage = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    mountedPage.dataset.kal436Identity = 'same-mounted-pdf';
    return {
      fileName: document.querySelector('[data-svg-annotation-layer="1"]')?.closest('[data-overlay-page]') != null,
      annotationIds: [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
        .map((node) => node.getAttribute('data-anno-id'))
        .filter(Boolean)
        .sort(),
    };
  });
  expect(before.annotationIds.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByText('Existing Survey Data', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Walls/ })).toBeVisible();
  await page.getByRole('button', { name: /Walls/ }).click();

  // Owner 2026-10-07 (Drawboard rail + Survey chip): no "Expand / Close Survey
  // panel" chevrons and no "Exit Survey" any more. The Survey tab opens and
  // closes the panel; the Survey chip's "Leave Survey" leaves Survey.
  await expect(page.getByRole('button', { name: 'Leave Survey' })).toBeVisible();
  await expect(pdfPage).toHaveAttribute('data-kal436-identity', 'same-mounted-pdf');

  const after = await page.evaluate(() => ({
    pageIdentity: document.querySelector(
      '.survey-pdfjs-page-div[data-page-number="1"]',
    )?.dataset.kal436Identity,
    annotationIds: [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
      .map((node) => node.getAttribute('data-anno-id'))
      .filter(Boolean)
      .sort(),
  }));

  expect(after.pageIdentity).toBe('same-mounted-pdf');
  expect(after.annotationIds).toEqual([]);

  const existingSurveyMarkerIds = new Set(
    await page.locator('[data-survey-marker-id]').evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')),
    ),
  );
  const surveyBox = await annotationLayer.boundingBox();
  await page.mouse.move(surveyBox.x + 360, surveyBox.y + 260);
  await page.mouse.down();
  await page.mouse.move(surveyBox.x + 480, surveyBox.y + 340, { steps: 10 });
  await page.mouse.up();
  await page.getByPlaceholder('Enter name').fill('Survey visibility audit');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const surveyMarkerId = await page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes, existingIds) => nodes
      .map((node) => node.getAttribute('data-survey-marker-id'))
      .find((id) => id && !existingIds.includes(id)),
    [...existingSurveyMarkerIds],
  );
  expect(surveyMarkerId).toBeTruthy();
  const surveyMarker = page.locator(`[data-survey-marker-id="${surveyMarkerId}"]`);
  await expect(surveyMarker).toHaveCount(1);

  const moduleSelect = page.getByRole('combobox', { name: 'Survey module' });
  await moduleSelect.selectOption('kal436-other-module');
  await expect(surveyMarker).toHaveCount(0);
  await moduleSelect.selectOption('kal436-module');
  await expect(surveyMarker).toHaveCount(1);

  {
    const surveyTab = page.getByRole('button', { name: 'Survey', exact: true });
    if ((await surveyTab.getAttribute('aria-expanded')) !== 'true') await surveyTab.click();
  }
  await expect(page.getByText('Existing Survey Data', { exact: true })).toBeVisible();
  await expect(page.getByText('Walls', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Leave Survey' }).click();
  await expect(page.getByRole('button', { name: 'Survey', exact: true })).toBeVisible();

  const restored = await page.evaluate(() => ({
    pageIdentity: document.querySelector(
      '.survey-pdfjs-page-div[data-page-number="1"]',
    )?.dataset.kal436Identity,
    annotationIds: [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
      .map((node) => node.getAttribute('data-anno-id'))
      .filter(Boolean)
      .sort(),
  }));
  expect(restored.pageIdentity).toBe('same-mounted-pdf');
  expect(restored.annotationIds).toEqual(before.annotationIds);
  await expect(surveyMarker).toHaveCount(0);
});

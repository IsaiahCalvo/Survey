import { test, expect } from '@playwright/test';

const FIXTURE = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

test('KAL-436: selecting a real template and category preserves the mounted PDF and annotations', async ({ page }) => {
  await page.goto(FIXTURE);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const pdfPage = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pdfPage).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible();

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

  await expect(page.getByRole('button', { name: 'Expand Survey panel' })).toBeVisible();
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
  expect(after.annotationIds).toEqual(before.annotationIds);

  await page.getByRole('button', { name: 'Expand Survey panel' }).click();
  await expect(page.getByText('Existing Survey Data', { exact: true })).toBeVisible();
  await expect(page.getByText('Walls', { exact: true })).toBeVisible();
});

import { test, expect } from '@playwright/test';

const templates = [{ id: 'work', name: 'Work Survey', entities: [], modules: [{ id: 'existing', name: 'Existing', categories: [] }] }];

test.describe('phone panels requested during viewer loading', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cases = [
    { name: 'Survey opens once after its viewer registers', taps: ['Open survey'], panel: 'survey' },
    { name: 'Spaces opens after its viewer registers', taps: ['Open spaces'], panel: 'spaces' },
    { name: 'second Survey tap cancels the pending open', taps: ['Open survey', 'Open survey'], panel: null },
    { name: 'Spaces replaces a pending Survey request', taps: ['Open survey', 'Open spaces'], panel: 'spaces' },
    { name: 'Survey replaces a pending Spaces request', taps: ['Open spaces', 'Open survey'], panel: 'survey' },
    { name: 'returning Home cancels the pending request', taps: ['Open survey', 'Back to documents'], panel: 'home' },
  ];
  for (const scenario of cases) {
    test(scenario.name, async ({ page, context }) => {
      await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
      await context.addInitScript((value) => localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value)), templates);
      let releaseViewer;
      const viewerGate = new Promise((resolve) => { releaseViewer = resolve; });
      let viewerRequestHeld = false;
      await context.route(/\/src\/PDFViewer\.jsx(?:\?|$)/, async (route) => {
        viewerRequestHeld = true;
        await viewerGate;
        await route.continue();
      });
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto('/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1&mobileNav=tabs&nativeShell=expo', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible();
        expect(viewerRequestHeld).toBe(true);
        await expect(page.locator('[data-svg-annotation-layer]')).toHaveCount(0);
        for (const name of scenario.taps) await page.getByRole('button', { name, exact: true }).tap();
        const viewerLoaded = page.waitForResponse((response) => /\/src\/PDFViewer\.jsx(?:\?|$)/.test(response.url()));
        releaseViewer();
        await viewerLoaded;
        // Wait for the real viewer rather than a timer. Returning Home
        // unmounts it, so that case must stay on Documents after load.
        if (scenario.panel !== 'home') await expect(page.locator('[data-svg-annotation-layer]').first()).toBeAttached();
        const surveySheet = page.locator('.mobile-survey-sheet').filter({ visible: true });
        const spacesHeading = page.getByRole('heading', { name: 'Spaces', exact: true }).filter({ visible: true });
        if (scenario.panel === 'survey') {
          await expect(surveySheet).toHaveCount(1);
          await expect(page.getByRole('button', { name: /Work Survey/ }).filter({ visible: true })).toHaveCount(1);
          // A consumed request must not replay when rail APIs update again.
          await page.getByRole('button', { name: /Work Survey/ }).filter({ visible: true }).tap();
          await page.getByRole('button', { name: 'Open survey', exact: true }).tap();
          await expect(surveySheet).toHaveCount(0);
        } else if (scenario.panel === 'spaces') {
          await expect(spacesHeading).toHaveCount(1);
          await expect(surveySheet).toHaveCount(0);
        } else {
          await expect(surveySheet).toHaveCount(0);
          await expect(spacesHeading).toHaveCount(0);
          if (scenario.panel === 'home') await expect(page.getByRole('button', { name: 'Documents', exact: true })).toBeVisible();
        }
        expect(errors).toEqual([]);
      } finally {
        releaseViewer();
      }
    });
  }
});

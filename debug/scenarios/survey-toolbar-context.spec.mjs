// Local-only toolbar regression: no accounts, cloud writes, or personal data.
import { test, expect } from '@playwright/test';

const templates = [
  { id: 'other-survey', name: 'Other Survey', entities: [], modules: [] },
  {
    id: 'work-survey', name: 'Work Survey',
    entities: [
      { id: 'existing', name: 'Existing', color: '#2563eb' },
      { id: 'new', name: 'New', color: '#ef4444' },
    ],
    modules: [
      { id: 'existing-module', name: 'Existing', categories: [{ id: 'walls', name: 'Walls', color: '#d8a84e', checklist: [] }] },
      { id: 'proposed-module', name: 'Proposed', categories: [{ id: 'doors', name: 'Doors', color: '#5ba1f0', checklist: [] }] },
    ],
  },
];

test.use({ video: 'off', screenshot: 'off', actionTimeout: 10000 });

// Record rendered frames, so a final position alone cannot pass the motion check.
async function startMotionCapture(page) {
  await page.evaluate(() => {
    const capture = { running: true, frames: [] };
    window.__surveyToolbarMotion = capture;
    const frame = () => {
      const top = document.querySelector('#chrome-top-host');
      const button = top.querySelector('[data-survey-tool]');
      const style = getComputedStyle(button);
      capture.frames.push({
        textX: top.querySelector('[aria-label="Text"]').getBoundingClientRect().x,
        toolsX: top.querySelector('[data-toolbar-subtools]').getBoundingClientRect().x,
        opacity: Number(style.opacity),
        scale: parseFloat(style.scale),
      });
      if (capture.running) requestAnimationFrame(frame);
    };
    frame();
  });
}

async function checkMotion(page, direction) {
  const rawButton = page.locator('[data-survey-tool]');
  await expect(rawButton).toHaveCSS('opacity', direction === 'in' ? '1' : '0');
  const frames = await page.evaluate(() => {
    window.__surveyToolbarMotion.running = false;
    return window.__surveyToolbarMotion.frames;
  });
  const first = frames[0];
  const last = frames.at(-1);
  expect(Math.abs(last.textX - first.textX), 'Text stays in place').toBeLessThan(0.5);
  expect(frames.every((frame) => Math.abs(frame.textX - first.textX) < 0.5)).toBe(true);
  expect(direction === 'in' ? last.toolsX - first.toolsX : first.toolsX - last.toolsX).toBeGreaterThan(28);
  expect(frames.some((frame) => frame.opacity > 0 && frame.opacity < 1), 'Survey fades through visible frames').toBe(true);
  expect(frames.some((frame) => frame.scale > 0.6 && frame.scale < 1), 'Survey grows/shrinks instead of morphing').toBe(true);
  expect(frames.some((frame) => frame.toolsX > Math.min(first.toolsX, last.toolsX) + 1
    && frame.toolsX < Math.max(first.toolsX, last.toolsX) - 1), 'adjacent tools slide through intermediate positions').toBe(true);
}

for (const width of [1400, 900]) {
  test(`Survey choices survive annotation switches at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    await context.addInitScript((value) => {
      localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value));
    }, templates);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1');
    const top = page.locator('#chrome-top-host');
    const surveyButton = top.getByRole('button', { name: 'Survey', exact: true });
    const surveyRow = page.locator('.survey-subrow');
    // Owner 2026-10-26: the swatches sit in the survey bar itself.
    const entityRow = page.getByRole('group', { name: 'Survey entities', exact: true });
    const formatting = page.getByRole('toolbar', { name: 'Formatting', exact: true });
    await expect(top.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();
    await expect(surveyButton).toHaveCount(0);
    await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
    await page.getByRole('button', { name: /Work Survey.*2 modules/ }).click();
    await expect(surveyRow).toBeVisible();
    await expect(surveyButton).toHaveAttribute('aria-pressed', 'true');
    await expect(surveyButton).toHaveCSS('opacity', '1');
    const textBox = await top.getByRole('button', { name: 'Text', exact: true }).boundingBox();
    expect((await surveyButton.boundingBox()).x).toBeGreaterThan(textBox.x + textBox.width);
    await surveyRow.getByRole('button', { name: 'Survey module', exact: true }).click();
    await page.getByRole('option', { name: 'Proposed', exact: true }).click();
    await surveyRow.getByRole('button', { name: 'Doors', exact: true }).click();
    await entityRow.getByRole('button', { name: 'Entity Existing', exact: true }).click();
    await top.getByRole('button', { name: 'Freehand marker', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });

    const checkChoices = async () => {
      await expect(surveyButton).toHaveAttribute('aria-pressed', 'true');
      await expect(surveyRow.getByRole('button', { name: /^Survey template: Work Survey/ })).toBeVisible();
      // Wait for the narrow-window plan before deciding whether settings moved.
      // Otherwise a resize can fold the module menu just after the visibility check.
      if (width === 900) await expect(surveyRow).toHaveAttribute('data-survey-bar-step', /^(fold|tight|fewer)$/);
      const more = surveyRow.getByRole('button', { name: 'More settings', exact: true });
      if (await more.isVisible()) await more.click();
      await expect(page.locator('.survey-subrow__fit > span:not(.is-ghost)')).toHaveText('Proposed');
      await expect(surveyRow.getByRole('button', { name: 'Doors', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(entityRow.getByRole('button', { name: 'Entity Existing', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if (await more.isVisible()) await more.click();
      await expect(top.getByRole('button', { name: 'Freehand marker', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(formatting).toBeHidden();
    };
    const checkAnnotation = async () => {
      await expect(surveyRow).toBeHidden();
      await expect(entityRow).toBeHidden();
      await expect(formatting).toBeVisible();
      await expect(surveyButton).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#survey-rail-panel, .survey-rail-panel').filter({ visible: true })).toHaveCount(1);
    };
    await checkChoices();
    // All three groups must return to the same saved Survey choices.
    for (const group of ['Draw', 'Shapes', 'Text']) {
      await top.getByRole('button', { name: group, exact: true }).click();
      await checkAnnotation();
      await surveyButton.click();
      await checkChoices();
    }
    // Use a real annotation created in this Survey module, then select it.
    await top.getByRole('button', { name: 'Shapes', exact: true }).click();
    await top.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const paper = page.locator('.survey-pdfjs-page-div').first();
    const box = await paper.boundingBox();
    const x = box.x + box.width * 0.26;
    const y = box.y + box.height * 0.65;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 55, { steps: 8 });
    await page.mouse.up();
    const rectangle = page.locator('[data-svg-annotation-layer] [data-annotation-index]').last();
    await expect(rectangle).toBeVisible();
    await surveyButton.click();
    await checkChoices();
    // Both the toolbar and V must show annotation formatting on selection.
    for (const path of ['button', 'keyboard', 'pan']) {
      if (path === 'button') await top.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
      else await page.keyboard.press(path === 'keyboard' ? 'v' : 'm');
      await page.mouse.click(x, y + 20);
      await checkAnnotation();
      await expect(formatting.getByRole('button', { name: 'Border and fill colors', exact: true })).toBeVisible();
      await surveyButton.click();
      await checkChoices();
    }
    // Same button is safe to press again; leaving Survey is a separate action.
    await surveyButton.click();
    await checkChoices();
    await expect(page.locator('[data-loadout-ghost-layer] > *')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('survey-controls.png') });
    await top.getByRole('button', { name: 'Shapes', exact: true }).click();
    await checkAnnotation();
    await expect(page.locator('[data-loadout-ghost-layer] > *')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('annotation-controls.png') });
    await surveyButton.click();
    await startMotionCapture(page);
    await surveyRow.getByRole('button', { name: 'Leave Survey', exact: true }).click();
    await expect(surveyButton).toHaveCount(0);
    await expect(surveyRow).toBeHidden();
    await checkMotion(page, 'out');
    await startMotionCapture(page);
    await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
    await checkMotion(page, 'in');
    await expect(surveyButton).toHaveAttribute('aria-pressed', 'true');
    // Reduced motion skips the entry/exit and the horizontal movement.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('[data-toolbar-subtools]')).toHaveCSS('transition-duration', '0s');
    await expect(page.locator('[data-survey-tool]')).toHaveCSS('transition-duration', '0s');
    expect(errors).toEqual([]);
  });
}

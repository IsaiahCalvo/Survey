import { test, expect } from '@playwright/test';

// CREATE-01 E2E (callout half): dashed rect + dashed connector + dashed
// arrowhead during drag; committed callout has solid stroke.
// Status: SCAFFOLD — Plan 14-03 ships the callout creation state machine
// with the transient SVG preview inside SVGAnnotationLayer.

test.describe('CREATE-01 callout dashed preview', () => {
  test.skip(true, 'Wave 0 scaffold — implementation pending Plan 14-03');

  test('callout preview shows dashed rect during drag', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: activate Q tool, press mouse down at (arrowTip), move to (textBox),
    // query <g className="callout-preview"> and assert its child <rect>
    // has stroke-dasharray="5,5" and opacity="0.6"
    expect(true).toBe(true);
  });

  test('callout preview shows dashed connector line during drag', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: same setup, assert two <line> children have
    // stroke-dasharray="5,5" and opacity="0.6"
    expect(true).toBe(true);
  });

  test('callout preview disappears on mouse up', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: full creation cycle, after mouseup assert
    // document.querySelector('.callout-preview') is null
    expect(true).toBe(true);
  });

  test('committed callout has solid stroke in unified render path', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: create callout, query [data-callout-id] <line>s,
    // assert NONE have stroke-dasharray
    expect(true).toBe(true);
  });

  test('callout preview clears on tool switch mid-drag', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: activate Q tool, mouse down, move, press V (switch to select),
    // assert .callout-preview not in DOM, no stray callout committed
    expect(true).toBe(true);
  });
});

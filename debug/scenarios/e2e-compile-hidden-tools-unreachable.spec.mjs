import { test, expect } from '@playwright/test';

// COMPILE_HIDDEN_TOOLS_UNREACHABLE_PROOF
// Remaining compile-hidden tools (stamp / measure / Group / Extract /
// Note-Link create / Forms) have no Print-class reachable fail-closed
// chrome. This pass classifies them as compile-hidden / zero callers.
// Do not flip flags. Do not invent backends. Do not replay Print,
// leftover-18 Settings/Upload/Share/Restore/Lock, Templates/Projects/
// Documents/Archive, or dedicated PDF waves.

const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1&tab=documents';

function attachHiddenLogs(page) {
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/\[Group\]|\[Ungroup\]|onGroupSelected|onUngroupSelected|\[Renderer\]|setFormFieldMode|Extract Pages/i.test(text)) {
      logs.push(text);
    }
  });
  return logs;
}

async function assertNamedToolsAbsent(page) {
  await expect(page.getByTestId('forms-category-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Forms', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-form-tool]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text field', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stamp', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Measure', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Extract Pages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ungroup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(0);
}

test('compile-hidden stamp/measure/Group/Extract/Note-Link/Forms are unreachable', async ({ page }) => {
  test.setTimeout(120_000);
  const logs = attachHiddenLogs(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(TEST_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  await assertNamedToolsAbsent(page);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true })).toBeVisible();
  await expect(page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Callout', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Underline', exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible();
  const overlayText = await overlay.innerText();
  expect(overlayText).toMatch(/Select annotations/);
  expect(overlayText).not.toMatch(/Stamp|Measure|Ungroup|Extract|Forms|Note create|Link create/i);
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press('Control+g');
  await page.keyboard.press('Control+Shift+g');
  await page.keyboard.press('n');
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
  await assertNamedToolsAbsent(page);
  expect(logs.filter((line) => /\[Group\]|\[Ungroup\]|onGroupSelected|setFormFieldMode|Extract Pages/i.test(line))).toHaveLength(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toBeVisible({ timeout: 30_000 });
  await assertNamedToolsAbsent(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TEST_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await assertNamedToolsAbsent(page);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forms', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stamp', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toHaveCount(0);
});

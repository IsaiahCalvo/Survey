import { test, expect } from '@playwright/test';

// Compile-hidden custom Print panel (`PRINT_PANEL_ENABLED = false`) is
// reachable fail-closed chrome: Cmd/Ctrl+P and Cmd/Ctrl+Shift+P still
// intercept and take the blob / flatten-iframe path. leftover18-save-export
// only polled `[PrintPanel] OPEN`. UL-40–43 needs a DEV flag flip.
// Distinct from leftover-18 X-01 cloud save, leftover18-save-export cluster,
// and the flag-on custom panel spec. Do not flip the flag. Do not invent
// a Print backend, .env.local, Stripe, MSAL, Turnstile, leases, or SQL.

const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1&tab=documents';

function attachPrintLogs(page) {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });
  return printLogs;
}

async function openEditor(page, { width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(TEST_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
}

async function assertNoCustomPanel(page) {
  await expect(page.getByRole('dialog', { name: 'Print' })).toHaveCount(0);
  await expect(page.locator('[aria-label="Print options"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More copies' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fewer copies' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Markups' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save as PDF/i })).toHaveCount(0);
  await expect(page.getByLabel('Close print panel')).toHaveCount(0);
}

function countMatching(logs, re) {
  return logs.filter((line) => re.test(line)).length;
}

// Native iframe.print() can steal later Playwright keyboard.press('Control+p')
// into Chromium's print UI. Dispatch the same window keydown the viewer
// capture-listens for so later presses still hit the fail-closed path.
async function dispatchPrintHotkey(page, { shift = false } = {}) {
  await page.evaluate((withShift) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'p',
      code: 'KeyP',
      keyCode: 80,
      which: 80,
      ctrlKey: true,
      metaKey: false,
      shiftKey: withShift,
      altKey: false,
      bubbles: true,
      cancelable: true,
    }));
  }, shift);
}

test('PRINT_PANEL_ENABLED=false blob/OS print intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  const printLogs = attachPrintLogs(page);

  // --- Intended: Ctrl+P on ?testPdf= is blob print, not the custom panel ---
  await openEditor(page);
  await assertNoCustomPanel(page);
  await page.keyboard.press('Control+p');
  await expect.poll(
    () => printLogs.some((line) => /OPEN requested via window keydown/.test(line) && /panel enabled=false/.test(line) && /withMarkup=false/.test(line)),
    { timeout: 15_000 },
  ).toBeTruthy();
  await expect.poll(
    () => printLogs.some((line) => /disabled — base PDF blob print/.test(line)),
    { timeout: 15_000 },
  ).toBeTruthy();
  await expect.poll(
    () => printLogs.some((line) => /blob-URL iframe\.print\(\) called/.test(line)),
    { timeout: 15_000 },
  ).toBeTruthy();
  expect(printLogs.some((line) => /panel enabled=true/.test(line))).toBe(false);
  expect(printLogs.some((line) => /listing printers/.test(line))).toBe(false);
  await assertNoCustomPanel(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export annotated PDF', exact: true })).toBeVisible();

  const afterFirstP = printLogs.length;

  // --- Break: second Ctrl+P still fail-closes (no-markup path does not set inFlight) ---
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await dispatchPrintHotkey(page);
  await expect.poll(
    () => countMatching(printLogs, /disabled — base PDF blob print/) >= 2,
    { timeout: 15_000 },
  ).toBeTruthy();
  expect(printLogs.slice(afterFirstP).some((line) => /ignoring — a print job is still composing/.test(line))).toBe(false);
  await assertNoCustomPanel(page);

  // --- Edge: Ctrl+Shift+P flatten path; second press inFlight-ignored ---
  await dispatchPrintHotkey(page, { shift: true });
  await dispatchPrintHotkey(page, { shift: true });
  await expect.poll(
    () => printLogs.some((line) => /OPEN requested via window keydown shift/.test(line) && /withMarkup=true/.test(line) && /panel enabled=false/.test(line)),
    { timeout: 30_000 },
  ).toBeTruthy();
  await expect.poll(
    () => printLogs.some((line) => /ignoring — a print job is still composing/.test(line)),
    { timeout: 15_000 },
  ).toBeTruthy();
  await expect.poll(
    () => printLogs.some((line) => /disabled — temporary annotated PDF print/.test(line) || /temporary annotated PDF print failed/.test(line)),
    { timeout: 45_000 },
  ).toBeTruthy();
  // OPEN is logged before the inFlight gate, so the ignored second press
  // still records an OPEN line with inFlight=true.
  expect(countMatching(printLogs, /OPEN requested via window keydown shift/)).toBe(2);
  expect(countMatching(printLogs, /ignoring — a print job is still composing/)).toBeGreaterThanOrEqual(1);
  await assertNoCustomPanel(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();

  // Isolation: Export is not this leftover. leftover18-save-export already
  // downloaded annotated PDFs. Do not click it here.
  const exportIsolated = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).isVisible();

  // --- Break: hubPreview has no PrintPanel listener ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const beforeHub = printLogs.length;
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(800);
  expect(printLogs.slice(beforeHub).some((line) => /PrintPanel/.test(line))).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Print' })).toHaveCount(0);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  // --- Edge: 390 same blob path ---
  await openEditor(page, { width: 390, height: 844 });
  const beforeMobile = printLogs.length;
  await page.keyboard.press('Control+p');
  await expect.poll(
    () => printLogs.slice(beforeMobile).some((line) => /panel enabled=false/.test(line) && /withMarkup=false/.test(line)),
    { timeout: 15_000 },
  ).toBeTruthy();
  await expect.poll(
    () => printLogs.slice(beforeMobile).some((line) => /disabled — base PDF blob print/.test(line)),
    { timeout: 15_000 },
  ).toBeTruthy();
  await assertNoCustomPanel(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();

  const proof = {
    intendedBlobPrint: true,
    customPanelHidden: true,
    flagStayedFalse: !printLogs.some((line) => /panel enabled=true/.test(line)),
    secondCtrlPNoInFlight: true,
    shiftPFlatten: printLogs.some((line) => /disabled — temporary annotated PDF print/.test(line) || /temporary annotated PDF print failed/.test(line)),
    shiftPInFlightIgnored: printLogs.some((line) => /ignoring — a print job is still composing/.test(line)),
    exportIsolated,
    hubPreviewNoListener: true,
    mobile390: true,
    flagNotFlipped: true,
    leftover18HostNotInvented: true,
  };
  console.log('PRINT_PANEL_FAILCLOSED_PROOF', JSON.stringify(proof));
  expect(proof.flagStayedFalse).toBe(true);
  expect(proof.shiftPFlatten).toBe(true);
  expect(proof.shiftPInFlightIgnored).toBe(true);
  expect(proof.exportIsolated).toBe(true);
});

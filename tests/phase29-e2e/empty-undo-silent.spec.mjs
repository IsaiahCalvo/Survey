import { test, expect } from '@playwright/test';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from '../../agent-cli/lib/leased-browser-session.mjs';

// Phase 29 e2e — UI-SPEC §"Empty-undo-stack press" silent contract.
// Activated by Plan 29-04. CONTEXT.md decision: "Empty-undo-stack Cmd+Z press
// is silent — no toast, no flash, no message. Matches every desktop app."

test('Cmd+Z on empty stack is silent — zero DOM diff', async ({ page }) => {
  const leasedBrowserAccount = await installLeasedBrowserAccount(page);
  await page.goto('http://localhost:5173/');
  await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });
  await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
  await page.waitForSelector('.survey-pdfjs-page-container', { timeout: 20000 });
  // Wait for hydration to settle — empty undo stack guaranteed when no draw fired.
  await page.waitForTimeout(1500);

  const initialNodeCount = await page.evaluate(() => document.body.getElementsByTagName('*').length);

  // Capture console messages to assert no warnings / errors fired.
  const consoleMsgs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
  // Allow any toast / overlay element a moment to mount if it were going to.
  await page.waitForTimeout(700);

  const afterNodeCount = await page.evaluate(() => document.body.getElementsByTagName('*').length);
  // No toast or flash element should have entered the DOM.
  expect(afterNodeCount).toBe(initialNodeCount);

  // Y.UndoManager.undo() is a clean no-op on empty undoStack — no error or warn
  // log should fire as a result of the Cmd+Z press itself. Note: pre-existing
  // benign console traffic from Pdfjs / React HMR is NOT captured by the
  // listener because it was attached AFTER the page settled.
  expect(consoleMsgs).toEqual([]);
});

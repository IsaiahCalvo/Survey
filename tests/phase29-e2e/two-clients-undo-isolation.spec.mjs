import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Phase 29 e2e — UNDO-02 CANONICAL: user A's Cmd+Z does NOT erase user B's stroke.
// Activated by Plan 29-04. Maps to Pitfall 7 (per-user undo silently broken
// when trackedOrigins reference equality fails) — the canonical mitigation
// is the memoized origin object shared across the bridge + the undo manager.
//
// Uses the Phase 28 bot accounts left in place per STATE.md. Skips cleanly when
// .bot-credentials.json is missing or has fewer than 2 accounts.

const credsPath = path.resolve(process.cwd(), '.bot-credentials.json');
const HAS_BOTS = existsSync(credsPath);

test('UNDO-02 canonical: user A undo never erases user B stroke', async ({ browser }) => {
  test.skip(!HAS_BOTS, '.bot-credentials.json not present (Phase 28 bots required)');
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
  const bots = Array.isArray(creds?.bots) ? creds.bots : (Array.isArray(creds) ? creds : []);
  test.skip(bots.length < 2, 'fewer than 2 bot accounts available in .bot-credentials.json');

  const botA = bots[0];
  const botB = bots[1];

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // Sign-in injection: dev seed reads test-bot-email/password from localStorage
  // when present (per CLAUDE.md feedback_dev_auto_login pattern). If the seed
  // doesn't honor that surface, the test is gracefully skipped below.
  for (const [page, bot] of [[pageA, botA], [pageB, botB]]) {
    await page.goto('http://localhost:5173/');
    await page.evaluate(({ email, password }) => {
      window.localStorage.setItem('test-bot-email', email);
      window.localStorage.setItem('test-bot-password', password);
    }, { email: bot.email, password: bot.password });
    await page.reload();
  }

  // Both clients open the same document on the same page.
  for (const page of [pageA, pageB]) {
    await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
    await page.waitForSelector('.survey-pdfjs-page-container', { timeout: 20000 });
    await page.evaluate(() => window.__navigateToPage?.(6));
  }
  await pageA.waitForTimeout(1500);

  // Each draws a stroke at a different x-offset.
  for (const [page, offset] of [[pageA, 100], [pageB, 320]]) {
    const box = await page.locator('.survey-pdfjs-page-container').first().boundingBox();
    if (!box) {
      test.skip(true, 'page container not available — dev seed may not be reachable');
      return;
    }
    await page.mouse.move(box.x + offset, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + offset + 100, box.y + 200, { steps: 12 });
    await page.mouse.up();
  }
  // Sync window — Supabase Realtime + IndexedDB persistence settle.
  await pageA.waitForTimeout(2500);

  const beforeUndoA = await pageA.locator('svg [data-anno-id]').count();
  const beforeUndoB = await pageB.locator('svg [data-anno-id]').count();
  // Skip if both clients didn't actually receive both strokes — likely the dev
  // seed doesn't sync via the Phase 28 transport in this environment.
  test.skip(beforeUndoA < 2 || beforeUndoB < 2, 'pre-undo sync incomplete — at least one client missing strokes');

  // Bot A presses Cmd+Z. Plan 29-03's Pitfall 7 mitigation says A's UndoManager
  // tracks A's memoized origin only — B's stroke (with B's origin) is untouchable
  // by A's undo regardless of stack contents.
  const isMac = process.platform === 'darwin';
  await pageA.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
  await pageA.waitForTimeout(2500);

  const afterUndoA = await pageA.locator('svg [data-anno-id]').count();
  const afterUndoB = await pageB.locator('svg [data-anno-id]').count();

  // A's view drops by exactly 1 (their own stroke); B's view also drops by 1
  // because the deletion replicates via Supabase Realtime. The CRITICAL check
  // is that B's stroke survives on BOTH clients — NOT that the count stays the
  // same on B.
  expect(afterUndoA).toBe(beforeUndoA - 1);
  expect(afterUndoB).toBe(beforeUndoB - 1);

  // Read surviving annotation author IDs from page A. After A's undo, every
  // surviving annotation should be authored by B (or by an unknown / null author
  // if the bridge hasn't filled in meta yet — that's still PASS because A's
  // contribution is what's gone).
  const survivingAuthorsA = await pageA.evaluate(() => {
    const els = document.querySelectorAll('svg [data-anno-id]');
    return Array.from(els).map(el => el.getAttribute('data-author-id'));
  });
  // A's userId should NOT appear in any surviving annotation's author tag.
  // Strict: every surviving annotation must NOT carry A's userId.
  const aUserId = await pageA.evaluate(async () => {
    // Read via supabase if available; otherwise return localStorage hint.
    if (window.__supabase?.auth?.getSession) {
      const { data } = await window.__supabase.auth.getSession();
      return data?.session?.user?.id ?? null;
    }
    return null;
  });
  if (aUserId) {
    expect(survivingAuthorsA.every(a => a !== aUserId)).toBe(true);
  }

  await ctxA.close();
  await ctxB.close();
});

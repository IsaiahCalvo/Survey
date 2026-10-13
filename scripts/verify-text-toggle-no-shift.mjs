// w43 (2026-09-26): live layout check for the tool bar's "Aa" button.
//
// Owner report: clicking Aa moved other items in the desktop tool bar. The
// contract is that Aa only shows or hides the text-formatting bar (and puts the
// caret in the text); every item in the main bar keeps its exact x, width and
// y, and the PDF page does not move when the formatting bar appears.
//
// Starts its own Vite on VERIFY_PORT (default 5244), opens the offline
// ?testPdf fixture route (no cloud document, Supabase blocked) in a throwaway
// profile, and for 1280px and 840px windows measures every control in the bar
// before and after each Aa click in three states: text box tool armed, a text
// box open for typing, and a text box or callout picked with Select.
//
//   node scripts/verify-text-toggle-no-shift.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.VERIFY_PORT || 5244);
const baseUrl = `http://127.0.0.1:${port}`;
// RULED 2026-09-26 owner: flip rows (w44) — the Aa sits in the formatting row
// (row 2) now, and both the tool bar and that row must stay still.
const AA = '[data-chrome-format-row] button.chrome-text-toggle[aria-label="Edit text"]';

const server = spawn(process.execPath, [
  resolve(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort',
], { cwd: repoRoot, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' });

const waitForServer = async () => {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try { if ((await fetch(baseUrl)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

const measure = (page) => page.evaluate(() => {
  const out = [];
  for (const root of [document.getElementById('chrome-top-host'), document.querySelector('[data-chrome-format-row]')]) {
    for (const n of root.querySelectorAll('button, input, label, .chrome-divider, [data-toolbar-slot]')) {
      if (!n.getClientRects().length) continue;
      const b = n.getBoundingClientRect();
      out.push(`${n.getAttribute('aria-label') || n.getAttribute('data-toolbar-slot') || n.className}@${b.left.toFixed(1)},${b.top.toFixed(1)},${b.width.toFixed(1)}`);
    }
  }
  const pageEl = document.querySelector('.page, [data-page-number]');
  const pb = pageEl?.getBoundingClientRect();
  return { bar: out, page: pb ? `${pb.left.toFixed(1)},${pb.top.toFixed(1)}` : null };
});

const focusInText = (page) => page.evaluate(() => !!document.activeElement?.isContentEditable);

const clickAaAndCompare = async (page, label, { expectFocusInText }) => {
  const before = await measure(page);
  for (let i = 0; i < 4; i += 1) {
    await page.click(AA);
    await page.waitForTimeout(350);
    const after = await measure(page);
    assert.deepEqual(after.bar, before.bar, `${label}: tool bar moved after Aa click ${i + 1}`);
    assert.equal(after.page, before.page, `${label}: the page moved after Aa click ${i + 1}`);
    if (expectFocusInText === 'always') {
      assert.ok(await focusInText(page), `${label}: the caret left the text after Aa click ${i + 1}`);
    }
  }
  if (expectFocusInText === 'eventually') {
    assert.ok(await focusInText(page), `${label}: Aa never put the caret in the picked text`);
  }
};

const runAt = async (width) => {
  const profile = mkdtempSync(join(tmpdir(), 'w43-aa-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width, height: 830 } });
  try {
    await ctx.route(/supabase\.co/, (route) => route.abort());
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(`${baseUrl}/?testPdf=text-search-glyph-lab.pdf`);
    await page.waitForSelector('#chrome-top-host [aria-label="Draw"]', { timeout: 90_000 });
    await page.waitForTimeout(1200);
    const box = await (await page.$('.page, [data-page-number]')).boundingBox();

    await page.click('#chrome-top-host [aria-label="Text"]');
    await page.waitForTimeout(300);
    await clickAaAndCompare(page, `${width}px armed`, {});

    // Draw a text box and type into it: the editor is open.
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 140, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.type('Aa check');
    await clickAaAndCompare(page, `${width}px typing`, { expectFocusInText: 'always' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Pick it with Select: Aa shows/hides the bar and drops into the text.
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    await page.mouse.click(box.x + 120, box.y + 88);
    await page.waitForTimeout(500);
    assert.ok(await page.$(AA), `${width}px: Aa shows for a picked text box`);
    await clickAaAndCompare(page, `${width}px picked`, { expectFocusInText: 'eventually' });
    console.log(`ok ${width}px: Aa moved nothing in the bar or on the page`);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
};

try {
  await waitForServer();
  for (const width of [1280, 840]) await runAt(width);
} finally {
  server.kill();
}

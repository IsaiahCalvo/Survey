// w59 (2026-09-28): live check for "Command-drag snaps back on release".
//
// Owner: "When I do Command-drag, I can drag it, yes, but when I release it,
// it just snaps back to where I had it before."
//
// Cause: the drag preview followed the pointer with no page clamp, while the
// save clamped each mark back inside the page — so a mark let go past a page
// edge (easy with a tiny mark zoomed out) jumped back on release. Group drags
// clamped each member separately and callouts not at all.
//
// Starts its own Vite on VERIFY_PORT (default 5264) unless VERIFY_URL points
// at a running one, opens the offline ?testPdf fixture (Supabase blocked,
// nothing saved anywhere) in a throwaway headless Chromium profile, draws
// tiny marks hugging the page edges, and at 25 % and 100 % zoom Cmd-drags
// them outward / along the edge with real key orders:
//   (a) Cmd down -> press -> many small moves -> release -> Cmd up
//   (b) Cmd down -> press -> move -> Cmd up -> move -> release
//   (c) Cmd held for several drags in a row
// and checks, from the DOM, that where the mark sits after release is exactly
// where the preview showed it (no snap), for a rect, a pen dot, a counter, a
// line, a callout and a two-mark selection. It also checks a drag that the
// page edge fully blocks logs one [MoveDiag] line naming the PDF, and that a
// counter dragged, swung with Shift, then dragged again lands where drawn.
//
//   node scripts/verify-cmd-drag-snapback.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.VERIFY_PORT || 5264);
const baseUrl = process.env.VERIFY_URL || `http://127.0.0.1:${port}`;
const server = process.env.VERIFY_URL ? null : spawn(process.execPath, [
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

const TOP = '#chrome-top-host';

const run = async () => {
  const profile = mkdtempSync(join(tmpdir(), 'w59-snapback-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 900 } });
  const failures = [];
  try {
    await ctx.route(/supabase\.co/, (route) => route.abort());
    const page = ctx.pages()[0] || await ctx.newPage();
    const errors = [];
    const diag = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.text().includes('[MoveDiag]')) diag.push(msg.text()); });
    await page.goto(`${baseUrl}/?testPdf=text-search-glyph-lab.pdf`);
    await page.waitForSelector(`${TOP} [aria-label="Draw"]`, { timeout: 90_000 });
    await page.waitForTimeout(1500);
    const settle = (ms = 250) => page.waitForTimeout(ms);
    // Real pointer timing: many small moves, one per frame.
    const glide = async (x0, y0, dx, dy, n = 24) => {
      for (let i = 1; i <= n; i += 1) {
        await page.mouse.move(x0 + (dx * i) / n, y0 + (dy * i) / n);
        await page.waitForTimeout(16);
      }
    };
    const pageBox = async () => (await page.$('.page, [data-page-number]')).boundingBox();
    const marks = () => page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('[data-annotation-index], [data-callout-id]')) {
        if (el.parentElement?.closest('[data-annotation-index], [data-callout-id]')) continue;
        // A callout is measured by its text box (its arrow / knee reroute).
        const measured = el.hasAttribute('data-callout-id')
          ? (el.querySelector('[data-callout-part="textBox"]') || el)
          : el;
        const b = measured.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        const key = el.hasAttribute('data-callout-id') ? `c:${el.getAttribute('data-callout-id')}` : `a:${el.getAttribute('data-annotation-index')}`;
        if (!out[key]) out[key] = { cx: b.left + b.width / 2, cy: b.top + b.height / 2, x: b.left, y: b.top, w: b.width, h: b.height };
      }
      return out;
    });
    const pick = async (group, tool) => {
      await page.click(`${TOP} [aria-label="${group}"]`); await settle();
      await page.click(`#chrome-subtools-host button[aria-label="${tool}"]`); await settle();
    };
    const drawAndKey = async (fn) => {
      const before = new Set(Object.keys(await marks()));
      await fn(); await settle(600);
      await page.keyboard.press('Escape'); await settle();
      const key = Object.keys(await marks()).find((k) => !before.has(k));
      assert.ok(key, 'mark drawn');
      return key;
    };

    let pb = await pageBox();
    const keys = {};
    await pick('Shapes', 'Rectangle');
    keys.rect = await drawAndKey(async () => {
      await page.mouse.move(pb.x + pb.width - 40, pb.y + 160); await page.mouse.down();
      await glide(pb.x + pb.width - 40, pb.y + 160, 36, 30, 6); await page.mouse.up();
    });
    await pick('Draw', 'Pen');
    keys.pen = await drawAndKey(async () => {
      await page.mouse.move(pb.x + 200, pb.y + pb.height - 8); await page.mouse.down();
      await glide(pb.x + 200, pb.y + pb.height - 8, 6, 3, 4); await page.mouse.up();
    });
    await pick('Shapes', 'Counter');
    keys.counter = await drawAndKey(() => page.mouse.click(pb.x + 320, pb.y + 40));
    await pick('Shapes', 'Line');
    keys.line = await drawAndKey(async () => {
      await page.mouse.move(pb.x + 6, pb.y + 400); await page.mouse.down();
      await glide(pb.x + 6, pb.y + 400, 0, 40, 6); await page.mouse.up();
    });
    await pick('Text', 'Callout');
    keys.callout = await drawAndKey(async () => {
      // Mid-page (a callout's text box grows with its text); the drags below
      // run it into the left and bottom edges.
      await page.mouse.move(pb.x + pb.width * 0.3, pb.y + pb.height * 0.6); await page.mouse.down();
      await glide(pb.x + pb.width * 0.3, pb.y + pb.height * 0.6, 60, -40, 8); await page.mouse.up();
      await settle(600); await page.keyboard.type('Hi'); await settle(200);
    });
    await page.click(`${TOP} [data-select-tool]`); await settle();

    const zoomTo = async (percent) => {
      await page.click('[aria-label="Edit zoom percentage"]');
      const input = await page.waitForSelector('[aria-label="Zoom percentage"]');
      await input.fill(String(percent)); await input.press('Enter'); await settle(1500);
      pb = await pageBox();
    };
    const clearSelection = async () => {
      await page.keyboard.press('Escape'); await settle(120);
      // Empty page, inside the window.
      const y = Math.max(pb.y + 20, Math.min(pb.y + pb.height - 20, 450));
      await page.mouse.click(pb.x + pb.width * 0.5, y); await settle(200);
    };
    // A right-to-left (crossing) marquee over the mark, kept on the page
    // (marks hug the edges), so selection never depends on hitting a thin
    // stroke or on enclosing a box that touches the page edge.
    const marqueeAround = async (m, shift = false) => {
      const pad = 10;
      const x0 = Math.min(m.x + m.w + pad, pb.x + pb.width - 2);
      const y0 = Math.min(m.y + m.h + pad, pb.y + pb.height - 2, 890);
      const x1 = Math.max(m.x - pad, pb.x + 2);
      const y1 = Math.max(m.y - pad, pb.y + 2, 60);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.move(x0, y0); await page.mouse.down();
      await glide(x0, y0, x1 - x0, y1 - y0, 6); await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      await settle(250);
    };
    // Scroll the mark into the middle of the view (the page is taller than
    // the window at 100 %).
    const reveal = async (key) => {
      await page.evaluate((k) => {
        const sel = k.startsWith('c:') ? `[data-callout-id="${k.slice(2)}"]` : `[data-annotation-index="${k.slice(2)}"]`;
        document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'center' });
      }, key);
      await settle(400);
      pb = await pageBox();
    };
    const selectOne = async (key) => {
      await reveal(key);
      await clearSelection();
      if (key.startsWith('c:')) {
        // A callout is picked by a click on its text box.
        const box = await page.evaluate((id) => {
          const b = document.querySelector(`svg [data-callout-id="${id}"] [data-callout-part="textBox"]`)?.getBoundingClientRect();
          return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
        }, key.slice(2));
        if (box) { await page.mouse.click(box.x, box.y); await settle(300); }
        return;
      }
      await marqueeAround((await marks())[key]);
    };
    const selectTwo = async (keyA, keyB) => {
      await selectOne(keyA);
      await marqueeAround((await marks())[keyB], true);
    };
    const zoneUp = () => page.evaluate(() => !!document.querySelector('[data-modifier-move-zone]'));

    // One Cmd-drag, in the given key order. Returns preview + settled deltas.
    const cmdDrag = async (label, watchKeys, dx, dy, order) => {
      const start = await marks();
      const grab = start[watchKeys[0]];
      if (order !== 'c-next') { await page.keyboard.down('Meta'); await settle(150); }
      if (!(await zoneUp())) failures.push(`${label}: no move zone with Cmd held`);
      await page.mouse.move(grab.cx, grab.cy); await page.waitForTimeout(40);
      await page.mouse.down();
      if (order === 'b') {
        await glide(grab.cx, grab.cy, dx / 2, dy / 2, 12);
        await page.keyboard.up('Meta');
        await glide(grab.cx + dx / 2, grab.cy + dy / 2, dx / 2, dy / 2, 12);
      } else {
        await glide(grab.cx, grab.cy, dx, dy);
      }
      const preview = await marks();
      await page.mouse.up(); await settle(150);
      if (order === 'a') { await settle(80); await page.keyboard.up('Meta'); }
      await settle(700);
      const after = await marks();
      for (const key of watchKeys) {
        const shown = { x: preview[key].cx - start[key].cx, y: preview[key].cy - start[key].cy };
        const kept = { x: after[key].cx - start[key].cx, y: after[key].cy - start[key].cy };
        const snap = Math.hypot(kept.x - shown.x, kept.y - shown.y);
        const line = `${label} ${key}: preview (${shown.x.toFixed(1)}, ${shown.y.toFixed(1)}) kept (${kept.x.toFixed(1)}, ${kept.y.toFixed(1)})`;
        console.log(`${snap <= 0.75 ? 'ok  ' : 'SNAP'} ${line}`);
        if (snap > 0.75) failures.push(`snapped back: ${line}`);
      }
      return { start, preview, after };
    };

    for (const zoom of [25, 100]) {
      await zoomTo(zoom);
      // Outward past each edge, and along + out.
      const plans = [
        ['rect', 60, 0], ['rect', 30, 25],
        ['pen', 0, 40], ['pen', 30, 25],
        ['counter', 0, -80], ['counter', 25, -60],
        ['line', -50, 0], ['line', -30, 20],
        ['callout', -400, 0], ['callout', 20, 400],
      ];
      for (const [name, dx, dy] of plans) {
        for (const order of ['a', 'b']) {
          await selectOne(keys[name]);
          await cmdDrag(`${zoom}% ${order} ${name} (${dx},${dy})`, [keys[name]], dx, dy, order);
        }
      }
      // (c) Cmd held for three drags in a row, into the corner.
      await selectOne(keys.rect);
      await page.keyboard.down('Meta'); await settle(150);
      for (let i = 0; i < 3; i += 1) await cmdDrag(`${zoom}% c${i} rect`, [keys.rect], 40, -30, 'c-next');
      await page.keyboard.up('Meta'); await settle(200);
      // Two marks as one rigid piece: into the page, then out past the
      // corner. They never slide apart, and what shows is what stays.
      for (const [gdx, gdy] of [[-80, 60], [100, -100]]) {
        await selectTwo(keys.rect, keys.counter);
        const res = await cmdDrag(`${zoom}% a group rect+counter (${gdx},${gdy})`, [keys.rect, keys.counter], gdx, gdy, 'a');
        const gap = (s) => ({ x: s[keys.counter].cx - s[keys.rect].cx, y: s[keys.counter].cy - s[keys.rect].cy });
        const g0 = gap(res.start);
        const g1 = gap(res.after);
        if (Math.hypot(g1.x - g0.x, g1.y - g0.y) > 0.75) failures.push(`${zoom}% group members slid apart: (${g0.x.toFixed(1)},${g0.y.toFixed(1)}) -> (${g1.x.toFixed(1)},${g1.y.toFixed(1)})`);
        const moved = Math.hypot(res.after[keys.rect].cx - res.start[keys.rect].cx, res.after[keys.rect].cy - res.start[keys.rect].cy);
        if (moved < 5) failures.push(`${zoom}% group (${gdx},${gdy}) did not move (${moved.toFixed(1)} px)`);
      }
    }

    // A drag the page edge fully blocks: nothing moves, nothing snaps, and
    // one [MoveDiag] line says why (names the PDF).
    await zoomTo(100);
    await selectOne(keys.rect);
    diag.length = 0;
    const blocked = await cmdDrag('blocked rect', [keys.rect], 200, 0, 'a');
    assert.ok(Math.abs(blocked.after[keys.rect].cx - blocked.start[keys.rect].cx) < 0.75, 'rect already at the right edge does not move further right');
    assert.ok(diag.some((l) => /reason=held-at-page-edge/.test(l) && /pdf=text-search-glyph-lab\.pdf/.test(l)), `[MoveDiag] names the reason and the PDF (${diag.join(' | ') || 'no line'})`);
    console.log(`ok   diagnostic line: ${diag[diag.length - 1]}`);

    // Counter: drag, Shift to swing it round its tip, let Shift go, keep
    // dragging, release. The counter lands where it was last drawn (the
    // swing included) — before, the preview drew the pre-swing counter.
    {
      await selectOne(keys.counter);
      const c0 = (await marks())[keys.counter];
      const sx = c0.cx;
      const sy = c0.cy;
      await page.mouse.move(sx, sy); await page.mouse.down();
      await glide(sx, sy, -40, 120, 12);
      await page.keyboard.down('Shift');
      await glide(sx - 40, sy + 120, 60, 30, 12);
      await page.keyboard.up('Shift');
      await glide(sx + 20, sy + 150, -30, 40, 12);
      const shown = (await marks())[keys.counter];
      await page.mouse.up(); await settle(900);
      const kept = (await marks())[keys.counter];
      const off = Math.hypot(kept.cx - shown.cx, kept.cy - shown.cy) + Math.abs(kept.w - shown.w) + Math.abs(kept.h - shown.h);
      console.log(`${off <= 1 ? 'ok  ' : 'SNAP'} counter move -> Shift swing -> move: shown (${shown.cx.toFixed(1)}, ${shown.cy.toFixed(1)}) kept (${kept.cx.toFixed(1)}, ${kept.cy.toFixed(1)})`);
      if (off > 1) failures.push('counter swing-then-move did not land where it was drawn');
    }

    assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
    assert.deepEqual(failures, [], failures.join('\n'));
    console.log('\nall Cmd-drag snap-back checks passed');
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
};

try {
  if (server) await waitForServer();
  await run();
} finally {
  server?.kill('SIGTERM');
}

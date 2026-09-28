// w58 (2026-09-28): live check for "hold Command / Control to move".
//
// Owner: "If I have an annotation selected and I hold down Command, I want to
// click and drag to MOVE it instead of worrying about resizing. With a small
// dot while zoomed out, all I can do is resize. When I hold Command, the
// resize handles go away and I can click and drag and move it wherever I
// want. The rotation handle can stay."
//
// Starts its own Vite on VERIFY_PORT (default 5263) unless VERIFY_URL points at
// a running one, opens the offline ?testPdf fixture (Supabase blocked, nothing
// saved anywhere) in a throwaway headless Chromium profile, and:
//   - draws a small rectangle and a short line, zooms out to 25 %;
//   - selects the tiny rectangle: grabbers show; Cmd down -> resize grabbers
//     gone (no mouse move), rotate grabber still there, move zone shown;
//   - Cmd-drags from inside the box (not on the stroke): it moves, one Undo
//     puts it back, Redo moves it again; releasing Cmd brings the grabbers back;
//   - Cmd + rotate grabber still rotates;
//   - window blur while Cmd is held clears it (no stuck hidden grabbers);
//   - the short line: its end / bend grabbers hide and Cmd-drag moves it;
//   - both selected: Cmd-drag moves both together, one Undo;
//   - a locked mark stays put under a Cmd-drag;
//   - Cmd + click on a mark OUTSIDE the selection box still just selects it.
//
//   node scripts/verify-cmd-drag-move.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.VERIFY_PORT || 5263);
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
const settle = (page, ms = 250) => page.waitForTimeout(ms);
// Headless Chromium on macOS reports MacIntel -> Command. PLATFORM=win makes
// the page report Win32 (as Windows / the Windows desktop app does) and drives
// the same checks with Control.
const asWindows = process.env.PLATFORM === 'win';
const MOD = asWindows ? 'Control' : 'Meta';

// Everything about page 1's layer we assert on, read from the DOM.
const layerState = (page) => page.evaluate(() => {
  const svg = document.querySelector('svg[data-page-number="1"]')
    || document.querySelector('[data-page-number="1"] svg')
    || document.querySelector('svg.svg-annotation-layer');
  const root = svg || document;
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  };
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const marks = [...root.querySelectorAll('[data-annotation-index]')].map((el) => ({
    index: Number(el.getAttribute('data-annotation-index')),
    box: box(el),
    transform: el.getAttribute('transform') || '',
    inner: [...el.querySelectorAll('[transform]')].map((n) => n.getAttribute('transform')).join('|'),
  }));
  return {
    marks,
    resizeHandles: [...root.querySelectorAll('[data-resize-handle], [data-handle-hit-pad]')]
      .filter((el) => visible(el) && !el.closest('[data-rotation-handle]')
        && el.getAttribute('data-handle-hit-pad') !== 'counter-rotate').length,
    lineGrabbers: [...root.querySelectorAll('[data-handle="midpoint"]')].filter(visible).length,
    rotate: box(root.querySelector('[data-rotation-handle="mtr"] circle')),
    zone: box(root.querySelector('[data-modifier-move-zone]')),
    zoneCursor: root.querySelector('[data-modifier-move-zone]')?.style.cursor || null,
    lock: !!root.querySelector('[data-selection-lock-badge]'),
    groupFrame: !!root.querySelector('[data-group-selection-bbox]'),
  };
});

const run = async () => {
  const profile = mkdtempSync(join(tmpdir(), 'w58-cmd-move-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 900 } });
  const results = [];
  const ok = (label) => { results.push(label); console.log(`ok ${label}`); };
  try {
    await ctx.route(/supabase\.co/, (route) => route.abort());
    if (asWindows) {
      await ctx.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
        Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'Windows' }) });
        // This browser runs on a Mac, where Control + left click is always a
        // right click (a contextmenu event). Windows has no such rule, so
        // drop that Mac-only event to emulate Windows faithfully.
        window.addEventListener('contextmenu', (ev) => {
          if (ev.ctrlKey && ev.button === 0) { ev.stopImmediatePropagation(); ev.preventDefault(); }
        }, true);
      });
    }
    const page = ctx.pages()[0] || await ctx.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${baseUrl}/?testPdf=text-search-glyph-lab.pdf`);
    await page.waitForSelector(`${TOP} [aria-label="Draw"]`, { timeout: 90_000 });
    await page.waitForTimeout(1500);
    const platform = await page.evaluate(() => navigator.platform);
    assert.match(platform, asWindows ? /Win/ : /Mac/, `page reports ${platform}, so ${MOD} is the key`);

    const pageBox = await (await page.$('.page, [data-page-number]')).boundingBox();
    // Draw a 36 x 36 rectangle and a short line at the default zoom.
    await page.click(`${TOP} [aria-label="Shapes"]`); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Rectangle"]'); await settle(page);
    await page.mouse.move(pageBox.x + 200, pageBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 236, pageBox.y + 236, { steps: 6 });
    await page.mouse.up();
    await settle(page, 500);
    await page.click('#chrome-subtools-host button[aria-label="Line"]'); await settle(page);
    await page.mouse.move(pageBox.x + 400, pageBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 440, pageBox.y + 200, { steps: 6 });
    await page.mouse.up();
    await settle(page, 500);
    await page.click(`${TOP} [data-select-tool]`); await settle(page);

    let st = await layerState(page);
    assert.equal(st.marks.length, 2, `two marks drawn (${st.marks.length})`);
    const rectIndex = st.marks.reduce((a, m) => (m.box.cx < a.box.cx ? m : a)).index;
    const lineIndex = st.marks.find((m) => m.index !== rectIndex).index;

    // Zoom out to 25 %.
    await page.click('[aria-label="Edit zoom percentage"]');
    const zoomInput = await page.waitForSelector('[aria-label="Zoom percentage"]');
    await zoomInput.fill('25');
    await zoomInput.press('Enter');
    await settle(page, 1500);
    const mark = async (index) => (await layerState(page)).marks.find((m) => m.index === index);
    const rectAt25 = await mark(rectIndex);
    assert.ok(rectAt25.box.w < 14, `rectangle is tiny at 25 % (${rectAt25.box.w.toFixed(1)} px)`);
    ok(`tiny rectangle at 25 % zoom (${rectAt25.box.w.toFixed(1)} px)`);

    // Select it with a marquee from empty page space.
    const marquee = async (x1, y1, x2, y2) => {
      await page.mouse.move(x1, y1); await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); await settle(page);
    };
    await marquee(rectAt25.box.x - 15, rectAt25.box.y - 15, rectAt25.box.x + rectAt25.box.w + 15, rectAt25.box.y + rectAt25.box.h + 15);
    st = await layerState(page);
    assert.ok(st.resizeHandles > 0, `resize grabbers show when selected (${st.resizeHandles})`);
    assert.ok(st.rotate, 'rotate grabber shows when selected');
    assert.equal(st.zone, null, 'no move zone without the key');

    // Without the key, a press in the middle of the tiny mark lands on a grabber.
    const hitNoKey = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.getAttribute('data-resize-handle') || el?.getAttribute('data-handle-hit-pad') || el?.tagName;
    }, { x: rectAt25.box.cx, y: rectAt25.box.cy });
    ok(`without Cmd a press on the tiny mark hits: ${hitNoKey}`);

    // Cmd down, no mouse move: grabbers hide at once, rotate stays, zone appears.
    await page.keyboard.down(MOD); await settle(page, 120);
    st = await layerState(page);
    assert.equal(st.resizeHandles, 0, `Cmd hides every resize grabber (${st.resizeHandles} left)`);
    assert.ok(st.rotate, 'Cmd keeps the rotate grabber');
    assert.ok(st.zone, 'Cmd shows the move zone');
    assert.equal(st.zoneCursor, 'move', 'move cursor over the box');
    assert.ok(st.zone.w >= 23 && st.zone.h >= 23, `zone is a comfortable size on a tiny mark (${st.zone.w.toFixed(1)} px)`);
    const hitKey = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute('data-modifier-move-zone'), { x: rectAt25.box.cx, y: rectAt25.box.cy });
    assert.equal(hitKey, true, 'with Cmd the press lands on the move zone');
    ok('Cmd hides resize grabbers at once, keeps rotate, shows the move cursor');

    // Cmd-drag from inside the box, off the stroke (a few px from the corner inward).
    const before = await mark(rectIndex);
    await page.mouse.move(before.box.cx + 2, before.box.cy + 2);
    await page.mouse.down();
    await page.mouse.move(before.box.cx + 42, before.box.cy + 32, { steps: 8 });
    await page.mouse.up();
    await settle(page, 400);
    let after = await mark(rectIndex);
    const moved = { dx: after.box.cx - before.box.cx, dy: after.box.cy - before.box.cy };
    assert.ok(Math.abs(moved.dx - 40) < 3 && Math.abs(moved.dy - 30) < 3, `Cmd-drag moved the tiny mark by (40, 30) px: got (${moved.dx.toFixed(1)}, ${moved.dy.toFixed(1)})`);
    assert.ok(Math.abs(after.box.w - before.box.w) < 0.5, 'size unchanged (moved, not resized)');
    st = await layerState(page);
    assert.equal(st.resizeHandles, 0, 'grabbers stay hidden while Cmd is still down');
    await page.keyboard.up(MOD); await settle(page, 150);
    st = await layerState(page);
    assert.ok(st.resizeHandles > 0, 'releasing Cmd brings the grabbers back');
    assert.equal(st.zone, null, 'releasing Cmd removes the move zone');
    ok(`Cmd-drag moves the tiny mark (${moved.dx.toFixed(1)}, ${moved.dy.toFixed(1)}) px; handles return on release`);

    // One Undo step puts it back; Redo moves it again.
    await page.keyboard.press(`${MOD}+z`); await settle(page, 500);
    const undone = await mark(rectIndex);
    assert.ok(Math.abs(undone.box.cx - before.box.cx) < 1 && Math.abs(undone.box.cy - before.box.cy) < 1,
      `one Undo returns the mark (${(undone.box.cx - before.box.cx).toFixed(1)}, ${(undone.box.cy - before.box.cy).toFixed(1)})`);
    await page.keyboard.press(`${MOD}+Shift+z`); await settle(page, 500);
    const redone = await mark(rectIndex);
    assert.ok(Math.abs(redone.box.cx - after.box.cx) < 1 && Math.abs(redone.box.cy - after.box.cy) < 1, 'Redo moves it again');
    ok('Cmd-drag is one Undo step (and Redo re-applies it)');

    // Re-select (undo/redo may keep or drop the selection).
    after = await mark(rectIndex);
    st = await layerState(page);
    if (!st.rotate) {
      await marquee(after.box.x - 15, after.box.y - 15, after.box.x + after.box.w + 15, after.box.y + after.box.h + 15);
    }

    // Stuck-key safety: window blur while Cmd is down brings the grabbers back.
    await page.keyboard.down(MOD); await settle(page, 120);
    assert.equal((await layerState(page)).resizeHandles, 0);
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await settle(page, 150);
    st = await layerState(page);
    assert.ok(st.resizeHandles > 0 && !st.zone, 'window blur clears the held key (no stuck hidden grabbers)');
    await page.keyboard.up(MOD); await settle(page, 100);
    ok('window blur (Cmd+Tab away) clears the key: grabbers come back');

    // Cmd + rotate grabber still rotates.
    await page.keyboard.down(MOD); await settle(page, 120);
    st = await layerState(page);
    assert.ok(st.rotate, 'rotate grabber present with Cmd');
    const rotBefore = (await mark(rectIndex)).transform + (await mark(rectIndex)).inner;
    const rc = { x: st.rotate.cx, y: st.rotate.cy };
    const topAtRotate = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.hasAttribute('data-modifier-move-zone') ? 'move zone (press handed to the grabber)' : 'rotate grabber'), rc);
    console.log(`   on top at the rotate grabber: ${topAtRotate}`);
    const centre = (await mark(rectIndex)).box;
    await page.mouse.move(rc.x, rc.y); await page.mouse.down();
    await page.mouse.move(centre.cx + 40, centre.cy, { steps: 10 });
    await page.mouse.up(); await settle(page, 400);
    await page.keyboard.up(MOD); await settle(page, 150);
    const rotAfterMark = await mark(rectIndex);
    const rotAfter = rotAfterMark.transform + rotAfterMark.inner;
    assert.notEqual(rotAfter, rotBefore, `Cmd + rotate grabber rotates (${rotBefore} -> ${rotAfter})`);
    assert.match(rotAfter, /rotate\(/, 'mark carries a rotation');
    const rotCentreShift = Math.hypot(rotAfterMark.box.cx - centre.cx, rotAfterMark.box.cy - centre.cy);
    assert.ok(rotCentreShift < 2, `rotation did not move the mark (${rotCentreShift.toFixed(1)} px)`);
    ok('Cmd + rotate grabber still rotates (not a move)');
    await page.keyboard.press(`${MOD}+z`); await settle(page, 400); // back to unrotated

    // The short line: its end + bend grabbers hide; Cmd-drag moves it.
    const line = await mark(lineIndex);
    await marquee(line.box.x - 12, line.box.y - 12, line.box.x + line.box.w + 12, line.box.y + line.box.h + 12);
    st = await layerState(page);
    assert.ok(st.lineGrabbers > 0 || st.resizeHandles > 0, 'line grabbers show when selected');
    await page.keyboard.down(MOD); await settle(page, 120);
    st = await layerState(page);
    assert.equal(st.lineGrabbers, 0, 'Cmd hides the bend grabber');
    assert.equal(st.resizeHandles, 0, 'Cmd hides the end grabbers');
    assert.ok(st.zone, 'move zone over the short line');
    await page.mouse.move(line.box.cx, line.box.cy + 6); // below the stroke, inside the zone
    await page.mouse.down();
    await page.mouse.move(line.box.cx + 30, line.box.cy + 46, { steps: 8 });
    await page.mouse.up(); await settle(page, 400);
    await page.keyboard.up(MOD); await settle(page, 150);
    const lineAfter = await mark(lineIndex);
    const lineMoved = { dx: lineAfter.box.cx - line.box.cx, dy: lineAfter.box.cy - line.box.cy };
    assert.ok(Math.abs(lineMoved.dx - 30) < 3 && Math.abs(lineMoved.dy - 40) < 3, `line moved (30, 40): got (${lineMoved.dx.toFixed(1)}, ${lineMoved.dy.toFixed(1)})`);
    assert.ok(Math.abs(lineAfter.box.w - line.box.w) < 0.5, 'line length unchanged');
    ok('short line: end / bend grabbers hide, Cmd-drag from beside the stroke moves it');

    // Both selected: Cmd-drag from inside the group frame moves both, one Undo.
    const r0 = await mark(rectIndex);
    const l0 = await mark(lineIndex);
    const gx1 = Math.min(r0.box.x, l0.box.x) - 12;
    const gy1 = Math.min(r0.box.y, l0.box.y) - 12;
    const gx2 = Math.max(r0.box.x + r0.box.w, l0.box.x + l0.box.w) + 12;
    const gy2 = Math.max(r0.box.y + r0.box.h, l0.box.y + l0.box.h) + 12;
    await marquee(gx1, gy1, gx2, gy2);
    st = await layerState(page);
    assert.ok(st.groupFrame, 'both selected (group frame)');
    await page.keyboard.down(MOD); await settle(page, 120);
    st = await layerState(page);
    assert.ok(st.zone, 'move zone over the group');
    await page.mouse.move(st.zone.cx, st.zone.cy); await page.mouse.down();
    await page.mouse.move(st.zone.cx + 25, st.zone.cy - 20, { steps: 8 });
    await page.mouse.up(); await settle(page, 400);
    await page.keyboard.up(MOD); await settle(page, 150);
    const r1 = await mark(rectIndex);
    const l1 = await mark(lineIndex);
    for (const [a, b, name] of [[r0, r1, 'rectangle'], [l0, l1, 'line']]) {
      assert.ok(Math.abs(b.box.cx - a.box.cx - 25) < 3 && Math.abs(b.box.cy - a.box.cy + 20) < 3,
        `${name} rode the group move: (${(b.box.cx - a.box.cx).toFixed(1)}, ${(b.box.cy - a.box.cy).toFixed(1)})`);
    }
    await page.keyboard.press(`${MOD}+z`); await settle(page, 500);
    const r2 = await mark(rectIndex);
    const l2 = await mark(lineIndex);
    assert.ok(Math.abs(r2.box.cx - r0.box.cx) < 1 && Math.abs(l2.box.cx - l0.box.cx) < 1, 'one Undo returns both');
    ok('group: Cmd-drag moves every selected mark together, one Undo step');

    // Cmd + click on a mark OUTSIDE the selection box still just selects it.
    const r3 = await mark(rectIndex);
    await marquee(r3.box.x - 15, r3.box.y - 15, r3.box.x + r3.box.w + 15, r3.box.y + r3.box.h + 15); // select rectangle only
    const l3 = await mark(lineIndex);
    await page.keyboard.down(MOD); await settle(page, 120);
    await page.mouse.click(l3.box.cx, l3.box.cy); await settle(page, 300);
    await page.keyboard.up(MOD); await settle(page, 150);
    st = await layerState(page);
    assert.ok(st.lineGrabbers > 0, 'Cmd + click on a mark outside the selection selects that mark (plain click, as before)');
    const l4 = await mark(lineIndex);
    assert.ok(Math.abs(l4.box.cx - l3.box.cx) < 0.5, 'and does not move it');
    ok('Cmd + click outside the selection box keeps its old meaning (select that mark)');

    // Lock: right-click the rectangle -> Lock, then a Cmd-drag leaves it put.
    const r5 = await mark(rectIndex);
    await marquee(r5.box.x - 15, r5.box.y - 15, r5.box.x + r5.box.w + 15, r5.box.y + r5.box.h + 15);
    await page.mouse.click(r5.box.x + 1, r5.box.cy, { button: 'right' }); await settle(page, 400);
    const lockItem = page.getByText('Lock', { exact: true }).first();
    if (await lockItem.count()) {
      await lockItem.click(); await settle(page, 400);
      st = await layerState(page);
      assert.ok(st.lock, 'lock badge shows on the locked mark');
      await page.keyboard.down(MOD); await settle(page, 120);
      st = await layerState(page);
      assert.equal(st.zone, null, 'no move zone on a selection that is all locked');
      await page.mouse.move(r5.box.cx, r5.box.cy); await page.mouse.down();
      await page.mouse.move(r5.box.cx + 40, r5.box.cy + 40, { steps: 8 });
      await page.mouse.up(); await settle(page, 400);
      await page.keyboard.up(MOD); await settle(page, 150);
      const r6 = await mark(rectIndex);
      assert.ok(Math.abs(r6.box.cx - r5.box.cx) < 0.5 && Math.abs(r6.box.cy - r5.box.cy) < 0.5, 'locked mark stayed put under a Cmd-drag');
      ok('a locked mark does not move under a Cmd-drag');
    } else {
      await page.keyboard.press('Escape');
      const labels = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent.trim()));
      console.log(`SKIP lock step: no Lock item in this offline menu (${JSON.stringify(labels)})`);
    }

    // A counter (tiny at 25 %): its nub rotate grabber stays, Cmd-drag moves it.
    await page.keyboard.press('Escape'); await settle(page);
    const pb = await (await page.$('.page, [data-page-number]')).boundingBox();
    const beforeCounter = new Set((await layerState(page)).marks.map((m) => m.index));
    await page.click(`${TOP} [aria-label="Shapes"]`); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Counter"]'); await settle(page);
    await page.mouse.click(pb.x + pb.width * 0.6, pb.y + pb.height * 0.3); await settle(page, 500);
    await page.click(`${TOP} [data-select-tool]`); await settle(page);
    const counter = (await layerState(page)).marks.find((m) => !beforeCounter.has(m.index));
    assert.ok(counter, 'counter placed');
    await marquee(counter.box.x - 12, counter.box.y - 12, counter.box.x + counter.box.w + 12, counter.box.y + counter.box.h + 12);
    const counterRotateVisible = () => page.evaluate(() => [...document.querySelectorAll('[data-handle-hit-pad="counter-rotate"]')].filter((el) => el.getClientRects().length).length);
    assert.ok(await counterRotateVisible(), 'counter rotate grabber shows when selected');
    await page.keyboard.down(MOD); await settle(page, 120);
    st = await layerState(page);
    assert.ok(st.zone, 'move zone over the counter');
    assert.ok(await counterRotateVisible(), 'counter rotate grabber stays with Cmd');
    await page.mouse.move(counter.box.cx, counter.box.cy); await page.mouse.down();
    await page.mouse.move(counter.box.cx - 35, counter.box.cy + 25, { steps: 8 });
    await page.mouse.up(); await settle(page, 400);
    await page.keyboard.up(MOD); await settle(page, 150);
    const counterAfter = await mark(counter.index);
    assert.ok(Math.abs(counterAfter.box.cx - counter.box.cx + 35) < 3 && Math.abs(counterAfter.box.cy - counter.box.cy - 25) < 3,
      `counter moved (-35, 25): got (${(counterAfter.box.cx - counter.box.cx).toFixed(1)}, ${(counterAfter.box.cy - counter.box.cy).toFixed(1)})`);
    ok('counter: rotate nub stays, Cmd-drag moves it');

    // ...and pressing the part of its nub grabber that sticks out past the
    // counter still turns it, even though the move zone is on top there.
    const nubInfo = () => page.evaluate(() => {
      const pad = [...document.querySelectorAll('[data-handle-hit-pad="counter-rotate"]')].find((el) => el.getClientRects().length);
      if (!pad) return null;
      const b = pad.getBoundingClientRect();
      return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 };
    });
    await page.keyboard.down(MOD); await settle(page, 120);
    const nub0 = await nubInfo();
    const body = (await mark(counter.index)).box;
    const ux = (nub0.cx - body.cx) / Math.hypot(nub0.cx - body.cx, nub0.cy - body.cy);
    const uy = (nub0.cy - body.cy) / Math.hypot(nub0.cx - body.cx, nub0.cy - body.cy);
    // Between the counter's own box and the zone's edge, along the nub.
    const zoneNow = (await layerState(page)).zone;
    const bodyHalf = Math.hypot(body.w, body.h) / 2;
    const zoneHalf = Math.min(zoneNow.w, zoneNow.h) / 2;
    const reach = (bodyHalf + zoneHalf) / 2;
    const press = { x: body.cx + ux * reach, y: body.cy + uy * reach };
    assert.ok(Math.hypot(press.x - nub0.cx, press.y - nub0.cy) < nub0.r, 'press point is on the nub grabber');
    const onTop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute('data-modifier-move-zone'), press);
    assert.equal(onTop, true, 'the move zone is on top of the nub grabber here (so the hand-off is what is tested)');
    await page.mouse.move(press.x, press.y); await page.mouse.down();
    await page.mouse.move(body.cx - 40, body.cy, { steps: 10 });
    await page.mouse.up(); await settle(page, 400);
    await page.keyboard.up(MOD); await settle(page, 150);
    const nub1 = await nubInfo();
    const body1 = (await mark(counter.index)).box;
    assert.ok(Math.hypot(nub1.cx - nub0.cx, nub1.cy - nub0.cy) > 3, `the nub swung round (${nub0.cx.toFixed(1)},${nub0.cy.toFixed(1)} -> ${nub1.cx.toFixed(1)},${nub1.cy.toFixed(1)})`);
    assert.ok(Math.hypot(body1.cx - body.cx, body1.cy - body.cy) < 3, 'the counter body did not move');
    ok('counter: Cmd + press on the nub grabber past the counter still turns it');

    // A callout: knee / tip / text-box corner grabbers hide, Cmd-drag moves it whole.
    await page.keyboard.press('Escape'); await settle(page);
    await page.click(`${TOP} [aria-label="Text"]`); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Callout"]'); await settle(page);
    const cx0 = pb.x + pb.width * 0.3;
    const cy0 = pb.y + pb.height * 0.6;
    await page.mouse.move(cx0, cy0); await page.mouse.down();
    await page.mouse.move(cx0 + 60, cy0 - 40, { steps: 8 }); await page.mouse.up(); await settle(page, 600);
    await page.keyboard.type('Hi'); await settle(page, 200);
    await page.keyboard.press('Escape'); await settle(page, 600);
    await page.click(`${TOP} [data-select-tool]`); await settle(page);
    const calloutBox = () => page.evaluate(() => {
      const els = [...document.querySelectorAll('svg [data-callout-id]')].filter((el) => el.getClientRects().length);
      if (!els.length) return null;
      const id = els[0].getAttribute('data-callout-id');
      const text = document.querySelector(`svg [data-callout-id="${id}"] [data-callout-part="textBox"]`)
        || els[0];
      const b = text.getBoundingClientRect();
      return { id, x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
    });
    const c0 = await calloutBox();
    assert.ok(c0, 'callout drawn');
    await page.mouse.click(c0.cx, c0.cy); await settle(page, 300);
    const cornerGrabbers = () => page.evaluate(() => [...document.querySelectorAll('svg [data-callout-part^="textBox-"]')].filter((el) => el.getClientRects().length).length);
    assert.ok(await cornerGrabbers() > 0, 'callout corner grabbers show when selected');
    await page.keyboard.down(MOD); await settle(page, 120);
    assert.equal(await cornerGrabbers(), 0, 'Cmd hides the callout grabbers');
    st = await layerState(page);
    assert.ok(st.zone, 'move zone over the callout');
    await page.mouse.move(c0.cx, c0.cy); await page.mouse.down();
    await page.mouse.move(c0.cx + 30, c0.cy + 20, { steps: 8 }); await page.mouse.up(); await settle(page, 500);
    await page.keyboard.up(MOD); await settle(page, 150);
    const c1 = await calloutBox();
    assert.ok(Math.abs(c1.cx - c0.cx - 30) < 3 && Math.abs(c1.cy - c0.cy - 20) < 3, `callout moved (30, 20): got (${(c1.cx - c0.cx).toFixed(1)}, ${(c1.cy - c0.cy).toFixed(1)})`);
    assert.ok(Math.abs(c1.w - c0.w) < 0.5, 'callout text box size unchanged');
    await page.keyboard.press(`${MOD}+z`); await settle(page, 500);
    const c2 = await calloutBox();
    assert.ok(Math.abs(c2.cx - c0.cx) < 1 && Math.abs(c2.cy - c0.cy) < 1, 'one Undo returns the callout');
    ok('callout: grabbers hide, Cmd-drag moves it whole, one Undo step');

    // Cmd shortcuts still work while the key is held (it is only watched).
    await page.keyboard.press('Escape'); await settle(page);
    const cc = await mark(counter.index);
    await marquee(cc.box.x - 12, cc.box.y - 12, cc.box.x + cc.box.w + 12, cc.box.y + cc.box.h + 12);
    const countBefore = (await layerState(page)).marks.length;
    await page.keyboard.down(MOD); await settle(page, 120);
    await page.keyboard.press('c'); await settle(page, 200);
    await page.keyboard.press('v'); await settle(page, 600);
    await page.keyboard.up(MOD); await settle(page, 200);
    const countAfter = (await layerState(page)).marks.length;
    assert.equal(countAfter, countBefore + 1, `Cmd+C, Cmd+V while held pastes a copy (${countBefore} -> ${countAfter})`);
    ok('Cmd+C / Cmd+V still work while Cmd is held');

    assert.deepEqual(errors, [], `no page errors: ${errors.join('\n')}`);
    console.log(`\nall ${results.length} checks passed`);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
};

try {
  if (server) await waitForServer();
  await run();
} finally {
  server?.kill();
}

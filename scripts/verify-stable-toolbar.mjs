// w47 (2026-09-26): live check for the fixed centred groups + animated
// loadouts.
//
// RULED 2026-09-26 owner: fixed centred groups + animated loadouts. Owner:
// "Right now, everything just keeps adjusting to stay centered, and it's
// throwing me off. I want consistency so there are not big jumps and snaps."
//
// Starts its own Vite on VERIFY_PORT (default 5248) unless VERIFY_URL points at
// a running one, opens the offline ?testPdf fixture (Supabase blocked) in a
// throwaway profile and, at 1440 / 1280 / 1024 / 840px:
//   - switches Pan / Select / Draw / Shapes / Text (and every tool in each
//     group) over and over, draws a pen stroke and a rectangle, picks and
//     drops them with Select, and asserts that Pan, Select, the Draw / Shapes
//     / Text icons, the loadout's left edge and row 2's left edge never move;
//   - samples every animation frame of a loadout swap and of row 2 leaving,
//     and asserts a real crossfade (a ghost fading out, the new set fading
//     in, both within ~200ms) with nothing around it moving;
//   - repeats a swap with prefers-reduced-motion and asserts it is instant.
//
// w48 (2026-09-27): RULED 2026-09-27 owner: Pan/Select beside the groups —
// Pan / Select sit just left of Draw (the rule between), never over Undo /
// Redo. RULED 2026-09-27 owner: rows 2/3 centred, animated — row 2 is centred
// under the Draw / Shapes / Text icons in every state (it re-centres when its
// controls change, gliding over ~190ms, and never moves while they do not:
// opening a picker or menu from it moves nothing); instant with reduced motion.
//
//   node scripts/verify-stable-toolbar.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.VERIFY_PORT || 5248);
const baseUrl = process.env.VERIFY_URL || `http://127.0.0.1:${port}`;
const widths = (process.env.WIDTHS || '1440,1280,1024,840').split(',').map(Number);

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
const GROUP = { draw: `${TOP} [aria-label="Draw"]`, shapes: `${TOP} [aria-label="Shapes"]`, text: `${TOP} [aria-label="Text"]` };
const PAN = `${TOP} [aria-label="Pan"]`;
const SELECT = `${TOP} [data-select-tool]`;

// Everything that must stay put, in window px.
const fixedPoints = (page) => page.evaluate(() => {
  const x = (el) => (el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null);
  const q = (s) => document.querySelector(s);
  const row2 = q('[data-chrome-format-row]');
  return {
    pan: x(q('#chrome-top-host [aria-label="Pan"]')),
    select: x(q('#chrome-top-host [data-select-tool]')),
    draw: x(q('#chrome-top-host [aria-label="Draw"]')),
    shapes: x(q('#chrome-top-host [aria-label="Shapes"]')),
    text: x(q('#chrome-top-host [aria-label="Text"]')),
    loadout: x(q('[data-toolbar-subtools]')),
    row2: row2 && row2.style.display !== 'none' ? x(q('[data-chrome-settings-holder]')) : 'hidden',
    row2Centre: (() => {
      const b = q('[data-chrome-settings-holder]')?.getBoundingClientRect();
      return row2 && row2.style.display !== 'none' && b ? Math.round((b.left + b.width / 2) * 10) / 10 : null;
    })(),
    row2Right: (() => { const b = q('[data-chrome-settings-holder]')?.getBoundingClientRect(); return b ? Math.round(b.right) : null; })(),
    rowSpan: (() => { const b = row2?.getBoundingClientRect(); return b ? [Math.round(b.left), Math.round(b.right)] : null; })(),
    // Whether a side panel covers the row just past each end of the settings
    // (the row stops at a panel's inset rather than centring).
    panelBeside: (() => {
      const h = q('[data-chrome-settings-holder]')?.getBoundingClientRect();
      if (!row2 || row2.style.display === 'none' || !h) return null;
      const y = h.top + h.height / 2;
      const covered = (px) => { const el = document.elementFromPoint(px, y); return !!el && !row2.contains(el); };
      return { left: covered(h.left - 10.5), right: covered(h.right + 10.5) };
    })(),
    iconsCentre: (() => { const b = q('#chrome-top-host [data-tool-toolbar]')?.getBoundingClientRect(); return b ? Math.round((b.left + b.width / 2) * 10) / 10 : null; })(),
    selectRight: (() => { const b = q('#chrome-top-host [data-select-tool]')?.getBoundingClientRect(); return b ? Math.round(b.right * 10) / 10 : null; })(),
    redoRight: (() => { const b = q('#chrome-top-host [aria-label="Redo"]')?.getBoundingClientRect(); return b ? Math.round(b.right * 10) / 10 : null; })(),
    loadoutRight: (() => { const b = q('[data-toolbar-subtools]')?.getBoundingClientRect(); return b ? Math.round(b.right) : null; })(),
    exportLeft: x(q('[data-toolbar-export]')),
  };
});

const settle = (page) => page.waitForTimeout(260);

// w48: row 2 is centred under the group icons, unless it would cross the
// row's 10px inset (or a panel), where it slides just far enough.
const assertRow2Centred = (states, label) => {
  for (const s of states) {
    if (s.row2 === 'hidden' || s.row2Centre === null) continue;
    const clamped = s.row2 <= (s.rowSpan?.[0] ?? 0) + 10 + 1 || s.row2Right >= (s.rowSpan?.[1] ?? 1e9) - 10 - 1
      || s.panelBeside?.left || s.panelBeside?.right;
    if (clamped && Math.abs(s.row2Centre - s.iconsCentre) > 1) continue;
    assert.ok(Math.abs(s.row2Centre - s.iconsCentre) <= 1, `${label} ${s.label || ''}: row 2 centred ${s.row2Centre} under the icons ${s.iconsCentre} ${JSON.stringify(s)}`);
  }
};

// w48: a re-centre glides: several frames between the two spots, no one
// frame jumping most of the way.
const assertGlide = (frames, label) => {
  const xs = frames.map((f) => f.holder).filter((v) => v !== null);
  const total = Math.abs(xs[xs.length - 1] - xs[0]);
  if (total < 4) return { total, frames: 0 };
  const steps = xs.slice(1).map((v, i) => Math.abs(v - xs[i]));
  const moving = steps.filter((d) => d > 0.05).length;
  assert.ok(moving >= 4, `${label}: row 2 glided over several frames (${JSON.stringify(xs)})`);
  assert.ok(Math.max(...steps) <= total * 0.6, `${label}: no frame jumped most of the way (${JSON.stringify(xs)})`);
  return { total, frames: moving };
};

// Click `selector` from inside the page and sample every frame for `ms`:
// the ghost's opacity, the live slot's opacity / translate, and the fixed
// points' x each frame.
const sampleSwap = (page, selector, { slot = '[data-toolbar-subtools]', ms = 320 } = {}) => page.evaluate(({ selector, slot, ms }) => new Promise((done) => {
  const q = (s) => document.querySelector(s);
  const x = (el) => (el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null);
  const frames = [];
  const start = performance.now();
  const sample = () => {
    const live = q(slot);
    const ghost = document.querySelector('[data-loadout-ghost]');
    // w47 review: each changed control animates on its own now, so read the
    // faintest live control (and its slide) rather than the slot box.
    const controls = live ? [...live.querySelectorAll('button, input, .chrome-divider')].filter((b) => b.getClientRects().length) : [];
    const styles = controls.map((b) => getComputedStyle(b));
    const faintest = styles.reduce((min, s) => (Number(s.opacity) < Number(min?.opacity ?? 2) ? s : min), null);
    const liveColours = live?.querySelector('[data-quick-colours]');
    frames.push({
      t: Math.round(performance.now() - start),
      ghost: ghost ? Number(getComputedStyle(ghost).opacity).toFixed(2) : null,
      // Controls in the ghost that are actually drawn (not place-holders).
      ghostShown: ghost ? [...ghost.querySelectorAll('button, input')].filter((b) => getComputedStyle(b).visibility !== 'hidden').length : 0,
      live: faintest ? Number(faintest.opacity).toFixed(2) : (live ? '1.00' : null),
      translate: faintest ? faintest.translate : null,
      // Script-made animations only (not the swatches' own CSS transitions).
      coloursAnimating: liveColours
        ? liveColours.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length
        : null,
      draw: x(q('#chrome-top-host [aria-label="Draw"]')),
      pan: x(q('#chrome-top-host [aria-label="Pan"]')),
      // The slot's laid-out spot (offsetLeft ignores the animation's own
      // `translate`, which is the slide itself, not a layout move).
      anchor: (() => {
        const slotEl = q('[data-toolbar-subtools]');
        const parent = slotEl?.offsetParent;
        return slotEl && parent ? Math.round((parent.getBoundingClientRect().left + slotEl.offsetLeft) * 10) / 10 : null;
      })(),
      holder: x(q('[data-chrome-settings-holder]')),
      rowDisplay: q('[data-chrome-format-row]')?.style.display,
      rowOpacity: Number(getComputedStyle(q('[data-chrome-format-row]')).opacity).toFixed(2),
    });
    if (performance.now() - start < ms) requestAnimationFrame(sample); else done(frames);
  };
  q(selector).click();
  requestAnimationFrame(sample);
}), { selector, slot, ms });

const assertCrossfade = (frames, label) => {
  if (process.env.DEBUG_FRAMES) console.log(label, frames.map((f) => `${f.t}:g${f.ghost}/l${f.live}/${f.translate}`).join(' '));
  const withGhost = frames.filter((f) => f.ghost !== null);
  assert.ok(withGhost.length >= 2, `${label}: the outgoing set faded out over several frames (${JSON.stringify(frames.slice(0, 4))})`);
  const ghostEnd = withGhost[withGhost.length - 1].t;
  assert.ok(ghostEnd <= 220, `${label}: the ghost was gone by ~200ms (last seen ${ghostEnd}ms)`);
  assert.ok(Number(withGhost[0].ghost) > Number(withGhost[withGhost.length - 1].ghost), `${label}: ghost opacity falls`);
  const early = frames.find((f) => Number(f.live) < 0.9);
  assert.ok(early, `${label}: the new set started faded`);
  const last = frames[frames.length - 1];
  assert.equal(last.live, '1.00', `${label}: the new set ends fully shown`);
  const settledAt = frames.find((f) => f.t > 60 && f.live === '1.00' && (f.translate === 'none' || f.translate === '0px'));
  assert.ok(settledAt && settledAt.t <= 230, `${label}: the new set settled within ~200ms (${settledAt?.t})`);
  // Nothing around the swap moved on any frame.
  for (const key of ['draw', 'pan', 'anchor']) {
    assert.equal(new Set(frames.map((f) => f[key])).size, 1, `${label}: ${key} moved during the swap`);
  }
  return { frames: frames.length, ghostMs: ghostEnd, settledMs: settledAt.t };
};

const runAt = async (width, { reducedMotion = false } = {}) => {
  const profile = mkdtempSync(join(tmpdir(), 'w47-toolbar-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width, height: 830 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  try {
    await ctx.route(/supabase\.co/, (route) => route.abort());
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(`${baseUrl}/?testPdf=text-search-glyph-lab.pdf`);
    await page.waitForSelector(GROUP.draw, { timeout: 90_000 });
    await page.waitForTimeout(1200);
    const pageBox = await (await page.$('.page, [data-page-number]')).boundingBox();

    if (reducedMotion) {
      await page.click(GROUP.draw); await settle(page);
      const frames = await sampleSwap(page, GROUP.shapes, { ms: 120 });
      assert.ok(frames.every((f) => f.ghost === null), `${width}px reduced motion: no ghost`);
      assert.ok(frames.every((f) => f.live === '1.00'), `${width}px reduced motion: the new set is shown at once`);
      const leave = await sampleSwap(page, PAN, { slot: '[data-chrome-settings-holder]', ms: 120 });
      assert.ok(leave.every((f) => f.rowDisplay === 'none'), `${width}px reduced motion: row 2 goes at once`);
      // w48: a re-centre is instant too.
      await page.click(GROUP.shapes); await settle(page);
      await page.click('#chrome-subtools-host button[aria-label="Line"]'); await settle(page);
      const jump = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Arrow"]', { slot: '[data-chrome-settings-holder]', ms: 160 });
      const spots = [...new Set(jump.map((f) => f.holder))];
      assert.ok(spots.length <= 2, `${width}px reduced motion: row 2 re-centres at once (${JSON.stringify(spots)})`);
      console.log(`ok ${width}px reduced motion: swaps are instant`);
      return;
    }

    const seen = [];
    const record = async (label) => { seen.push({ label, ...(await fixedPoints(page)) }); };
    for (let round = 0; round < 2; round += 1) {
      for (const sel of [PAN, SELECT, GROUP.draw, GROUP.shapes, GROUP.text, SELECT, GROUP.shapes, PAN, GROUP.draw, GROUP.text]) {
        await page.click(sel); await settle(page); await record(sel);
      }
      for (const group of ['draw', 'shapes', 'text']) {
        await page.click(GROUP[group]); await settle(page);
        const labels = await page.$$eval('#chrome-subtools-host button', (bs) => bs.map((b) => b.getAttribute('aria-label')));
        for (const label of labels) {
          await page.click(`#chrome-subtools-host button[aria-label="${label}"]`); await settle(page); await record(`${group}:${label}`);
        }
      }
    }
    // Draw a pen stroke and a rectangle, then pick / drop each with Select.
    await page.click(GROUP.draw); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Pen"]'); await settle(page);
    await page.mouse.move(pageBox.x + 90, pageBox.y + 300);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 220, pageBox.y + 330, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    await page.click(GROUP.shapes); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Rectangle"]'); await settle(page);
    await page.mouse.move(pageBox.x + 90, pageBox.y + 420);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 240, pageBox.y + 500, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    await page.click(SELECT); await settle(page); await record('select (nothing)');
    const pickPen = async () => { await page.mouse.click(pageBox.x + 155, pageBox.y + 315); await settle(page); };
    const pickRect = async () => { await page.mouse.click(pageBox.x + 90, pageBox.y + 460); await settle(page); };
    const drop = async () => { await page.keyboard.press('Escape'); await settle(page); };
    let pickedGroups = 0;
    for (let i = 0; i < 2; i += 1) {
      await pickPen(); await record('picked pen');
      if (await page.$('#chrome-subtools-host button[aria-label="Pen"]')) pickedGroups += 1;
      await drop(); await record('dropped');
      await pickRect(); await record('picked rect');
      if (await page.$('#chrome-subtools-host button[aria-label="Rectangle"]')) pickedGroups += 1;
      await drop(); await record('dropped');
    }
    assert.ok(pickedGroups >= 2, `${width}px: picking a mark brought its group's tools (${pickedGroups})`);

    for (const key of ['pan', 'select', 'draw', 'shapes', 'text', 'loadout', 'exportLeft']) {
      const values = new Set(seen.map((s) => s[key]));
      assert.equal(values.size, 1, `${width}px: ${key} moved: ${JSON.stringify(seen.map((s) => [s.label, s[key]]))}`);
    }
    // RULED 2026-09-27 owner: rows 2/3 centred, animated (w47 held row 2 at
    // one start for every tool).
    assertRow2Centred(seen, `${width}px`);
    const rowStarts = new Set(seen.map((s) => s.row2).filter((v) => v !== 'hidden'));
    const maxLoadoutRight = Math.max(...seen.map((s) => s.loadoutRight));
    assert.ok(maxLoadoutRight <= seen[0].exportLeft - 8, `${width}px: the widest loadout ends clear of Export`);
    // RULED 2026-09-27 owner: Pan/Select beside the groups: Select ends just
    // left of Draw (the rule and its air between), Pan clear of Redo.
    const besideGap = seen[0].draw - seen[0].selectRight;
    assert.ok(besideGap >= 10 && besideGap <= 24, `${width}px: Pan / Select sit beside the groups (gap ${besideGap})`);
    assert.ok(seen[0].pan >= seen[0].redoRight + 12 - 0.5, `${width}px: Pan clear of Undo / Redo (${seen[0].pan} vs ${seen[0].redoRight})`);

    // Frame-sampled swaps.
    await page.click(GROUP.draw); await settle(page);
    const drawToShapes = assertCrossfade(await sampleSwap(page, GROUP.shapes), `${width}px Draw→Shapes`);
    await settle(page);
    const shapesToSelect = assertCrossfade(await sampleSwap(page, SELECT), `${width}px Shapes→Select`);
    await settle(page);
    // Pan → Draw: nothing leaves, the Draw tools arrive.
    await page.click(PAN); await settle(page);
    const arrive = await sampleSwap(page, GROUP.draw);
    assert.ok(arrive.some((f) => Number(f.live) < 0.9), `${width}px Pan→Draw: the Draw tools faded in`);
    await settle(page);
    // Draw → Pan: the Draw tools fade out, row 2 fades up and away.
    const leave = await sampleSwap(page, PAN, { slot: '[data-chrome-settings-holder]', ms: 320 });
    const lingering = leave.filter((f) => f.rowDisplay === 'block');
    assert.ok(lingering.length >= 2, `${width}px Draw→Pan: row 2 stayed for its fade-out`);
    assert.ok(Number(lingering[lingering.length - 1].rowOpacity) < Number(lingering[0].rowOpacity), `${width}px: row 2 faded`);
    assert.equal(leave[leave.length - 1].rowDisplay, 'none', `${width}px: row 2 gone after the fade`);
    assert.ok(leave.some((f) => f.ghost !== null), `${width}px Draw→Pan: the outgoing set faded out`);
    assert.equal(new Set(leave.map((f) => f.draw)).size, 1, `${width}px Draw→Pan: the icons stayed put`);
    // Same set, different tool lit: no animation.
    await page.click(GROUP.shapes); await settle(page);
    const sameSet = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Ellipse"]', { ms: 120 });
    assert.ok(sameSet.every((f) => f.ghost === null), `${width}px: picking another shape does not animate the loadout`);
    // w47 review 3: Line → Arrow keeps the colours and width in place — they
    // neither slide nor show twice; only the added settings arrive.
    await page.click('#chrome-subtools-host button[aria-label="Line"]'); await settle(page);
    const lineToArrow = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Arrow"]', { slot: '[data-chrome-settings-holder]', ms: 320 });
    assert.ok(lineToArrow.every((f) => f.coloursAnimating === 0), `${width}px Line→Arrow: the colours did not animate on their own`);
    // RULED 2026-09-27 owner: rows 2/3 centred, animated — the wider Arrow
    // row re-centres, gliding (w47 held it still).
    const glide = assertGlide(lineToArrow, `${width}px Line→Arrow`);
    assertRow2Centred([{ label: 'arrow', ...(await fixedPoints(page)) }], `${width}px`);
    // w47 review 1: Eraser → Pen never blinks row 2.
    await page.click(GROUP.draw); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Eraser"]'); await settle(page);
    const eraserToPen = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Pen"]', { slot: '[data-chrome-settings-holder]', ms: 240 });
    assert.ok(eraserToPen.every((f) => f.rowDisplay === 'block' && f.rowOpacity === '1.00'), `${width}px Eraser→Pen: row 2 blinked ${JSON.stringify(eraserToPen.map((f) => f.rowOpacity))}`);
    // w47 review 2: Shapes → Pan → Shapes 70ms later: the Shapes tools and
    // row 2 run back from where they were — no copy of the same tools fading
    // over them, no row 2 drop-in replay from nothing.
    await page.click(GROUP.shapes); await settle(page);
    const back = await page.evaluate(({ pan, shapes }) => new Promise((done) => {
      const frames = [];
      const start = performance.now();
      let clickedBack = false;
      const tick = () => {
        const t = performance.now() - start;
        if (!clickedBack && t >= 70) { document.querySelector(shapes).click(); clickedBack = true; }
        const row = document.querySelector('[data-chrome-format-row]');
        frames.push({
          t: Math.round(t),
          after: clickedBack,
          ghosts: document.querySelectorAll('[data-loadout-ghost]').length,
          row: row.style.display === 'none' ? 0 : Number(getComputedStyle(row).opacity),
        });
        if (t < 360) requestAnimationFrame(tick); else done(frames);
      };
      document.querySelector(pan).click();
      requestAnimationFrame(tick);
    }), { pan: PAN, shapes: GROUP.shapes });
    const afterBack = back.filter((f) => f.after);
    assert.ok(afterBack.slice(1).every((f) => f.ghosts === 0), `${width}px Shapes→Pan→Shapes: no copy left fading over the returning tools ${JSON.stringify(afterBack.map((f) => f.ghosts))}`);
    const lowest = Math.min(...afterBack.map((f) => f.row));
    const atReturn = afterBack[0].row;
    assert.ok(lowest >= Math.min(atReturn, back.filter((f) => !f.after).slice(-1)[0].row) - 0.05, `${width}px Shapes→Pan→Shapes: row 2 ran back instead of replaying ${JSON.stringify(back.map((f) => f.row.toFixed(2)))}`);
    assert.equal(afterBack[afterBack.length - 1].row, 1, `${width}px: row 2 fully back`);
    await settle(page);
    // Opening a picker or menu from row 2 is not a loadout change.
    await page.click('#chrome-subtools-host button[aria-label="Line"]'); await settle(page);
    let openers = 0;
    for (const opener of ['[data-quick-colour-custom]', '[data-quick-paint-swatch]', '[data-toolbar-slot="style"] button', '[data-toolbar-slot="width"] input']) {
      const selector = `[data-chrome-settings-holder] ${opener}`;
      if (!(await page.$(selector))) continue;
      openers += 1;
      const { ghosts, xs } = await page.evaluate((sel) => new Promise((done) => {
        document.querySelector(sel).click();
        const seenGhost = [];
        const holderX = [];
        const start = performance.now();
        const tick = () => {
          seenGhost.push(!!document.querySelector('[data-loadout-ghost]'));
          holderX.push(Math.round(document.querySelector('[data-chrome-settings-holder]').getBoundingClientRect().left * 10) / 10);
          if (performance.now() - start < 260) requestAnimationFrame(tick); else done({ ghosts: seenGhost, xs: holderX });
        };
        requestAnimationFrame(tick);
      }), selector);
      assert.ok(ghosts.every((g) => !g), `${width}px: opening ${opener} from row 2 does not crossfade the row`);
      // w48: nor move it — its controls have not changed.
      assert.equal(new Set(xs).size, 1, `${width}px: opening ${opener} did not move row 2 (${JSON.stringify(xs)})`);
      await page.keyboard.press('Escape'); await settle(page);
      await page.mouse.click(pageBox.x + pageBox.width - 20, pageBox.y + 20); await settle(page);
      if (!(await page.$('#chrome-subtools-host button[aria-label="Line"]'))) {
        await page.click(GROUP.shapes); await settle(page);
        await page.click('#chrome-subtools-host button[aria-label="Line"]'); await settle(page);
      }
    }
    assert.ok(openers >= 2, `${width}px: found row-2 openers to try (${openers})`);

    // With a side panel open the icons centre on the canvas that is left —
    // and still never move with the tool.
    const panelReport = [];
    for (const panel of ['#chrome-left-host [aria-label="Pages"]', '#chrome-right-host [aria-label="Survey"]']) {
      const toggle = await page.$(panel);
      if (!toggle) continue;
      await toggle.evaluate((b) => b.click()); await page.waitForTimeout(700);
      const inPanel = [];
      for (const sel of [PAN, GROUP.shapes, SELECT, GROUP.draw, GROUP.text, GROUP.shapes]) {
        await page.click(sel); await settle(page); inPanel.push(await fixedPoints(page));
      }
      await page.click('#chrome-subtools-host button[aria-label="Arrow"]'); await settle(page);
      inPanel.push(await fixedPoints(page));
      for (const key of ['pan', 'select', 'draw', 'loadout']) {
        assert.equal(new Set(inPanel.map((s) => s[key])).size, 1, `${width}px ${panel}: ${key} moved: ${JSON.stringify(inPanel.map((s) => s[key]))}`);
      }
      assertRow2Centred(inPanel, `${width}px ${panel}`);
      const rows = new Set(inPanel.map((s) => s.row2).filter((v) => v !== 'hidden'));
      panelReport.push(`${panel.includes('Pages') ? 'Pages' : 'Survey'}: icons ${inPanel[0].draw}, row 2 ${[...rows].join('/')}`);
      assert.ok(Math.max(...inPanel.map((s) => s.loadoutRight)) <= inPanel[0].exportLeft - 8,
        `${width}px ${panel}: the widest loadout ends clear of Export`);
      assert.ok(inPanel[0].pan >= inPanel[0].redoRight + 12 - 0.5, `${width}px ${panel}: Pan clear of Redo`);
      await toggle.evaluate((b) => b.click()); await page.waitForTimeout(700);
    }

    console.log(`  ${width}px panels: ${panelReport.join('; ')}`);
    console.log(`ok ${width}px: icons at ${seen[0].draw} (centre ${seen[0].iconsCentre}), Pan at ${seen[0].pan}, Select ends ${seen[0].selectRight}, Redo ends ${seen[0].redoRight}, loadout at ${seen[0].loadout} across ${seen.length} states; `
      + `row 2 starts ${[...rowStarts].sort((a, b) => a - b).join('/')} (centred); Line→Arrow glide ${glide.total}px over ${glide.frames} frames; `
      + `Draw→Shapes ghost ${drawToShapes.ghostMs}ms / in ${drawToShapes.settledMs}ms, Shapes→Select ghost ${shapesToSelect.ghostMs}ms / in ${shapesToSelect.settledMs}ms`);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
};

try {
  await waitForServer();
  for (const width of widths) await runAt(width);
  await runAt(widths[0], { reducedMotion: true });
} finally {
  server?.kill();
}

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
// w49 (2026-09-27): RULED 2026-09-27 owner: morphing icons + one motion
// language — a group switch MORPHS each tool icon that has a slot in both
// loadouts (pen → rectangle → text box → Box …), grows in / shrinks out the
// rest from their centres, and nothing slides sideways except a row gliding
// to its new centre; every one takes the same ~200ms ease-in-out. The frame
// samples below record every overlay's path, every control's scale /
// opacity / translate, and row 2's centre, and assert exactly that.
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
    // w49: morph overlays (their path and spot) and every control's own
    // motion — live and in the outgoing copy.
    const morphs = [...document.querySelectorAll('[data-loadout-morph]')].map((m) => ({
      icon: m.getAttribute('data-loadout-morph'),
      d: [...m.querySelectorAll('path')].map((p) => p.getAttribute('d')).join(''),
      x: Math.round(m.getBoundingClientRect().left * 10) / 10,
    }));
    const motionOf = (el) => { const s = getComputedStyle(el); return { o: Number(s.opacity), s: s.scale === 'none' ? 1 : Number(s.scale), tr: s.translate }; };
    const unitsOf = (root) => (root ? [...root.querySelectorAll('button, input, .chrome-divider, [data-toolbar-slot], [data-quick-colours], [data-toolbar-subtools] div[style*="relative"]')] : []);
    const liveMotion = [...unitsOf(q('[data-toolbar-subtools]')), ...unitsOf(q('[data-chrome-settings-holder]'))].map(motionOf);
    const ghostMotion = [...document.querySelectorAll('[data-loadout-ghost] *')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && e.getAnimations().length).map(motionOf);
    frames.push({
      t: Math.round(performance.now() - start),
      morphs,
      liveMotion,
      ghostMotion,
      holderCentre: (() => { const h = q('[data-chrome-settings-holder]'); if (!h) return null; const b = h.getBoundingClientRect(); return Math.round((b.left + b.width / 2) * 10) / 10; })(),
      holderLeft: (() => { const h = q('[data-chrome-settings-holder]'); return h ? Math.round(h.getBoundingClientRect().left * 10) / 10 : null; })(),
      holderWidth: (() => { const h = q('[data-chrome-settings-holder]'); return h ? Math.round(h.getBoundingClientRect().width * 10) / 10 : null; })(),
      holderTranslate: q('[data-chrome-settings-holder]') ? getComputedStyle(q('[data-chrome-settings-holder]')).translate : null,
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

// w49 (RULED 2026-09-27 owner: morphing icons + one motion language): a
// group switch morphs `morphs` slots in place — each overlay's path changes
// over several frames, sits still, and is gone (the real icon back) by
// ~240ms; any control that grows or shrinks does it about its own centre
// (scale + opacity), never with a sideways translate; nothing around the
// loadout moves.
const assertMorph = (frames, label, { morphs }) => {
  if (process.env.DEBUG_FRAMES) console.log(label, frames.map((f) => `${f.t}:${f.morphs.map((m) => m.icon).join('+')}`).join(' '));
  const withMorph = frames.filter((f) => f.morphs.length);
  assert.ok(withMorph.length >= 4, `${label}: morphs drawn over several frames (${withMorph.length})`);
  assert.equal(Math.max(...frames.map((f) => f.morphs.length)), morphs, `${label}: ${morphs} slots morphed`);
  for (let k = 0; k < morphs; k += 1) {
    const ds = withMorph.map((f) => f.morphs[k]?.d).filter(Boolean);
    assert.ok(new Set(ds).size >= 4, `${label}: slot ${k + 1}'s icon changed shape frame by frame (${new Set(ds).size} shapes)`);
    const xs = new Set(withMorph.map((f) => f.morphs[k]?.x).filter((v) => v != null));
    assert.equal(xs.size, 1, `${label}: slot ${k + 1} morphed in place (${[...xs]})`);
  }
  const lastMorph = withMorph[withMorph.length - 1].t;
  assert.ok(lastMorph <= 240, `${label}: morphs done by ~200ms (last ${lastMorph}ms)`);
  assert.equal(frames[frames.length - 1].morphs.length, 0, `${label}: the real icons are back at rest`);
  for (const f of frames) {
    for (const m of [...f.liveMotion, ...f.ghostMotion]) {
      assert.ok(m.tr === 'none' || m.tr === '0px', `${label} @${f.t}ms: a control slid sideways (${m.tr})`);
      if (m.s !== 1) assert.ok(m.s >= 0.59 && m.s < 1, `${label} @${f.t}ms: grows / shrinks between 0.6 and 1 (${m.s})`);
    }
  }
  // Nothing around the swap moved on any frame.
  for (const key of ['draw', 'pan', 'anchor']) {
    assert.equal(new Set(frames.map((f) => f[key])).size, 1, `${label}: ${key} moved during the swap`);
  }
  const grew = frames.some((f) => f.liveMotion.some((m) => m.s < 1)) || frames.some((f) => f.ghostMotion.some((m) => m.s < 1));
  return { frames: frames.length, morphMs: lastMorph, grew };
};

// w49: row 2 in every group switch — its controls never slide on their own
// (only grow / shrink), and the one sideways motion is the row re-centring
// under the group icons: it keeps its left edge for the first frame and
// glides from there, straight to its new spot with no overshoot. So every
// switch obeys the same rule: a row that gets WIDER glides left (half the
// extra width), one that gets NARROWER glides right, and one whose width is
// unchanged does not move. (w47's 6px left→right slide on the changed
// controls used to swamp the small Draw ↔ Shapes glide, which is why Text
// read as the odd one out.)
const assertRowLanguage = (frames, label, iconsCentre, widthBefore) => {
  for (const f of frames) {
    for (const m of f.liveMotion) assert.ok(m.tr === 'none' || m.tr === '0px', `${label} @${f.t}ms: a row-2 control slid (${m.tr})`);
  }
  // Row 2 arriving (drops in where it belongs) or leaving (fades up and
  // away) is not a re-centre.
  if (frames[frames.length - 1].rowDisplay !== 'block') return 'leaves';
  if (widthBefore == null) return 'arrives';
  const shown = frames.filter((f) => f.holderLeft != null && f.rowDisplay === 'block');
  if (shown.length < 2) return null;
  const settled = shown[shown.length - 1];
  assert.ok(Math.abs(settled.holderCentre - iconsCentre) <= 1.5, `${label}: row 2 ends centred (${settled.holderCentre} vs ${iconsCentre})`);
  const lefts = shown.map((f) => f.holderLeft);
  const widthChange = settled.holderWidth - (widthBefore ?? shown[0].holderWidth);
  const travel = lefts[lefts.length - 1] - lefts[0];
  if (Math.abs(widthChange) < 2) {
    assert.ok(Math.abs(travel) < 2, `${label}: same width, row 2 stays put (${lefts})`);
    return 'still';
  }
  assert.ok(Math.sign(travel) === -Math.sign(widthChange), `${label}: wider glides left, narrower glides right (width ${widthChange}, travel ${travel})`);
  const steps = lefts.slice(1).map((v, i) => v - lefts[i]);
  assert.ok(steps.every((d) => d * travel >= -0.6), `${label}: row 2 glides one way, no overshoot (${lefts})`);
  return travel < 0 ? 'left' : 'right';
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
      assert.ok(frames.every((f) => f.morphs.length === 0), `${width}px reduced motion: no morph`);
      assert.ok(frames.every((f) => f.live === '1.00'), `${width}px reduced motion: the new set is shown at once`);
      const leave = await sampleSwap(page, PAN, { slot: '[data-chrome-settings-holder]', ms: 120 });
      // w49: the click's render can land a frame after the first sample; from
      // the frame it goes, it is gone at once (no fade frames at full-ish
      // opacity in between).
      const goneAt = leave.findIndex((f) => f.rowDisplay === 'none');
      assert.ok(goneAt >= 0 && goneAt <= 2 && leave.slice(goneAt).every((f) => f.rowDisplay === 'none'),
        `${width}px reduced motion: row 2 goes at once (${leave.map((f) => `${f.t}:${f.rowDisplay}`).join(' ')})`);
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
    // RULED 2026-09-27 owner: morphing icons + one motion language — cycle
    // Draw → Shapes → Text → Draw → Select → Draw twice: every switch morphs
    // the shared slots and moves row 2 by the same rules.
    const cycle = [['draw', 'shapes', 3], ['shapes', 'text', 2], ['text', 'draw', 2], ['draw', 'select', 3], ['select', 'draw', 3], ['draw', 'text', 2], ['text', 'select', 2], ['select', 'shapes', 3], ['shapes', 'draw', 3]];
    const cycleReport = [];
    for (let round = 0; round < 2; round += 1) {
      for (const [from, to, morphs] of cycle) {
        const fromSel = from === 'select' ? SELECT : GROUP[from];
        const toSel = to === 'select' ? SELECT : GROUP[to];
        await page.click(fromSel); await settle(page);
        const { iconsCentre, row2, row2Right } = await fixedPoints(page);
        const frames = await sampleSwap(page, toSel);
        const r = assertMorph(frames, `${width}px ${from}→${to}`, { morphs });
        const way = assertRowLanguage(frames, `${width}px ${from}→${to}`, iconsCentre, row2 === 'hidden' ? null : row2Right - row2);
        if (round === 0) cycleReport.push(`${from}→${to} ${morphs} morphs/${r.morphMs}ms row 2 ${way}`);
        await settle(page);
      }
    }
    // w49: switches faster than the motion (every 70ms): each slot carries on
    // from what is on screen — per slot, the drawn ink never jumps between
    // frames, and nothing is left over once it settles.
    await page.click(GROUP.draw); await settle(page);
    const rapid = await page.evaluate(({ order }) => new Promise((done) => {
      const frames = [];
      const start = performance.now();
      let next = 0;
      const tick = () => {
        const t = performance.now() - start;
        if (next < order.length && t >= next * 70) { document.querySelector(order[next]).click(); next += 1; }
        // Per slot (by its button's x): the ink of whatever is drawn there —
        // a morph overlay, else the live glyph (if shown) — as a bounding box
        // in 24-unit glyph space, and how much of it shows.
        const slotEls = [...document.querySelectorAll('[data-toolbar-subtools] [data-morph-icon]')];
        const perSlot = {};
        for (const m of document.querySelectorAll('[data-loadout-morph]')) {
          const r = m.getBoundingClientRect();
          const pts = [...m.querySelectorAll('path')].flatMap((p) => (p.getAttribute('d') || '').slice(1).split('L').map((xy) => xy.split(' ').map(Number)));
          const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
          const o = Number(getComputedStyle(m).opacity);
          perSlot[Math.round(r.left + r.width / 2)] = { box: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], o };
        }
        frames.push({ t: Math.round(t), perSlot, slots: slotEls.length, morphs: document.querySelectorAll('[data-loadout-morph]').length, ghosts: document.querySelectorAll('[data-loadout-ghost]').length });
        if (t < order.length * 70 + 400) requestAnimationFrame(tick); else done(frames);
      };
      requestAnimationFrame(tick);
    }), { order: [GROUP.shapes, GROUP.text, GROUP.draw, SELECT, GROUP.shapes, GROUP.draw].map((sel) => sel) });
    let worst = 0;
    let compared = 0;
    for (let k = 1; k < rapid.length; k += 1) {
      for (const [x, cur] of Object.entries(rapid[k].perSlot)) {
        const prev = rapid[k - 1].perSlot[x];
        if (!prev || cur.o < 0.99 || prev.o < 0.99) continue;
        const jump = Math.max(...cur.box.map((v, i) => Math.abs(v - prev.box[i])));
        worst = Math.max(worst, jump);
        compared += 1;
      }
    }
    // A 200ms morph moves at most ~18 units over its whole run; an ease-in-out
    // frame near its middle moves ~2.5 units. A snap would be most of the box.
    assert.ok(compared >= 20, `${width}px rapid switching: morphs were caught mid-way and compared (${compared})`);
    assert.ok(worst <= 5, `${width}px rapid switching: no slot's icon jumped between frames (worst ${worst.toFixed(2)} units)`);
    const end = rapid[rapid.length - 1];
    assert.equal(end.morphs, 0, `${width}px rapid switching: every morph landed`);
    assert.equal(end.ghosts, 0, `${width}px rapid switching: no copy left behind`);
    assert.equal(end.slots, 3, `${width}px rapid switching: ends on Draw's three tools`);
    await settle(page);
    const drawToShapes = { morphMs: cycleReport[0] };
    const shapesToSelect = { morphMs: cycleReport[7] };
    // Pan → Draw: nothing leaves, the Draw tools arrive.
    await page.click(PAN); await settle(page);
    const arrive = await sampleSwap(page, GROUP.draw);
    assert.ok(arrive.some((f) => Number(f.live) < 0.9), `${width}px Pan→Draw: the Draw tools faded in`);
    assert.ok(arrive.some((f) => f.liveMotion.some((m) => m.s < 0.9 && m.s >= 0.59)), `${width}px Pan→Draw: the Draw tools grew in from their centres`);
    assert.ok(arrive.every((f) => f.morphs.length === 0), `${width}px Pan→Draw: nothing to morph from`);
    await settle(page);
    // Draw → Pan: the Draw tools fade out, row 2 fades up and away.
    const leave = await sampleSwap(page, PAN, { slot: '[data-chrome-settings-holder]', ms: 320 });
    const lingering = leave.filter((f) => f.rowDisplay === 'block');
    assert.ok(lingering.length >= 2, `${width}px Draw→Pan: row 2 stayed for its fade-out`);
    assert.ok(Number(lingering[lingering.length - 1].rowOpacity) < Number(lingering[0].rowOpacity), `${width}px: row 2 faded`);
    assert.equal(leave[leave.length - 1].rowDisplay, 'none', `${width}px: row 2 gone after the fade`);
    assert.ok(leave.some((f) => f.ghostMotion.some((m) => m.s < 0.95)), `${width}px Draw→Pan: the outgoing tools shrank out`);
    assert.equal(new Set(leave.map((f) => f.draw)).size, 1, `${width}px Draw→Pan: the icons stayed put`);
    // Same set, different tool lit: no animation.
    await page.click(GROUP.shapes); await settle(page);
    const sameSet = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Ellipse"]', { ms: 120 });
    assert.ok(sameSet.every((f) => f.ghost === null && f.morphs.length === 0), `${width}px: picking another shape does not animate the loadout`);
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
      + `morphs: ${cycleReport.join(', ')}; rapid switching worst frame step ${worst.toFixed(2)} units over ${compared} steps`);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
};

try {
  await waitForServer();
  if (!process.env.REDUCED_ONLY) for (const width of widths) await runAt(width);
  await runAt(widths[0], { reducedMotion: true });
} finally {
  server?.kill();
}

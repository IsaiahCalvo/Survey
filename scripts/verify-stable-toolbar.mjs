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
// w50 (2026-09-28): RULED 2026-09-28 owner: one motion for row 2 (in-place
// crossfade), row 3 drops down. The tool bar (row 1) keeps the w49 morphs.
// Row 2 no longer glides or grows / shrinks controls: when its SET of
// controls changes the whole row crossfades in place (a copy of the old row
// fades out ~90ms, the live row fades in ~140ms (opacity only), already at its
// final centred spot); an unchanged set never animates. The frame samples
// assert no translate on row 2 on any frame, that its spot changes at most
// once (a jump while it is still faint, never a glide), and the crossfade
// itself. Row 3 (Aa) drops down from under row 2 (translateY -8 → 0 + fade,
// ~150ms) and goes back up (~110ms) without moving row 2.
//
// w51 (2026-09-28): RULED 2026-09-28 owner: row 2 downward swap. Row 2's
// swap now flows DOWN: the old row's copy sinks (~7px) as it fades out
// (~120ms, ease-in) and the live row comes down from ~6px above into its
// final centred spot (~150ms ease-out, ~35ms later). The frame samples
// assert: straight down on every frame (no x), both copies moving the same
// (downward) way, everything drawn inside row 2's band (never over the tool
// bar or the page), the row landing at exactly its centred spot, an
// unchanged set never animating, and row 2 arriving down from under the bar.
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

// RULED 2026-09-28 owner: row 2 downward swap (w51, was w50's in-place
// crossfade). On every frame: row 2 and the copy of the old row move straight
// down or not at all (x always 0), and what they draw stays inside row 2's
// band. The row's spot changes at most once, and only while it is still
// faint. A changed set: the old row's copy sinks and fades and is gone by
// ~150ms, the live row comes down from above (its y only ever increasing)
// and is whole and exactly in place by ~230ms. The same set: nothing moves or
// fades at all.
const ty = (tr) => (!tr || tr === 'none' ? [0, 0] : tr.split(' ').map(parseFloat).concat([0]).slice(0, 2));
const assertRowSwap = (frames, label) => {
  const shown = frames.filter((f) => f.rowDisplay === 'block' && f.holderLeft != null);
  for (const f of frames) {
    const [hx] = ty(f.holderTranslate);
    assert.equal(hx, 0, `${label} @${f.t}ms: row 2 slid sideways (${f.holderTranslate})`);
    for (const g of f.rowGhosts) assert.equal(ty(g.tr)[0], 0, `${label} @${f.t}ms: the old row's copy slid sideways (${g.tr})`);
    if (f.holderScale != null) assert.ok(f.holderScale === 1, `${label} @${f.t}ms: row 2 scale ${f.holderScale}`);
    // Inside row 2's band: never over the tool bar, never onto the page.
    if (f.band) {
      for (const d of [f.holderDrawn, ...f.rowGhosts.map((g) => g.drawn)].filter(Boolean)) {
        assert.ok(d[0] >= f.band[0] - 0.6 && d[1] <= f.band[1] + 0.6, `${label} @${f.t}ms: row 2 drew outside its band (${d} vs ${f.band})`);
      }
    }
  }
  const lefts = shown.map((f) => f.holderLeft);
  const jumps = [];
  for (let k = 1; k < shown.length; k += 1) {
    if (Math.abs(shown[k].holderLeft - shown[k - 1].holderLeft) > 0.5) jumps.push({ t: shown[k].t, by: Math.round((shown[k].holderLeft - shown[k - 1].holderLeft) * 10) / 10, o: Math.round(shown[k].holderOpacity * Number(shown[k].rowOpacity) * 100) / 100, prevO: Math.round(shown[k - 1].holderOpacity * Number(shown[k - 1].rowOpacity) * 100) / 100 });
  }
  assert.ok(jumps.length <= 1, `${label}: row 2 moved sideways on more than one frame — a glide (${JSON.stringify(jumps)} lefts ${lefts})`);
  for (const j of jumps) assert.ok(Math.min(j.o, j.prevO) <= 0.6, `${label}: row 2 jumped while clearly visible (${JSON.stringify(j)})`);
  const changed = frames.sigBefore != null && shown.length && shown[shown.length - 1].rowSig !== frames.sigBefore;
  const ghostFrames = frames.filter((f) => f.rowGhosts.length);
  if (!changed) {
    // Arriving (the row's own drop-in) or the same set: no swap.
    if (frames.sigBefore != null) {
      assert.equal(ghostFrames.length, 0, `${label}: same set, but row 2 swapped`);
      assert.ok(shown.every((f) => f.holderOpacity === 1 && ty(f.holderTranslate)[1] === 0), `${label}: same set, but row 2 moved or faded (${shown.map((f) => `${f.holderOpacity}/${f.holderTranslate}`)})`);
    }
    return { kind: frames.sigBefore == null ? 'arrives' : 'same', jumps: jumps.length };
  }
  assert.ok(ghostFrames.length >= 1, `${label}: the old row went out (no copy seen)`);
  const lastGhost = ghostFrames[ghostFrames.length - 1].t;
  assert.ok(lastGhost <= 170, `${label}: the old row's copy was gone by ~150ms (last ${lastGhost}ms)`);
  // The old row sinks: its y only increases, and is below where it started.
  const ghostYs = ghostFrames.map((f) => ty(f.rowGhosts[f.rowGhosts.length - 1].tr)[1]);
  assert.ok(ghostYs.every((v, k) => k === 0 || v >= ghostYs[k - 1] - 0.01), `${label}: the old row went down (${ghostYs})`);
  assert.ok(Math.max(...ghostYs) > 1, `${label}: the old row moved down (${ghostYs})`);
  // The new row comes down: y from above, only ever increasing, landing at 0.
  const holderYs = shown.map((f) => ty(f.holderTranslate)[1]);
  assert.ok(Math.min(...holderYs) < -1, `${label}: the new row came from above (${holderYs})`);
  assert.ok(holderYs.every((v, k) => k === 0 || v >= holderYs[k - 1] - 0.01 || holderYs[k - 1] === 0), `${label}: the new row came straight down (${holderYs})`);
  assert.ok(shown.some((f) => f.holderOpacity < 0.9), `${label}: the new row faded in (${shown.map((f) => f.holderOpacity)})`);
  const whole = shown.find((f) => f.holderOpacity === 1 && ty(f.holderTranslate)[1] === 0 && f.t > 0
    && shown.slice(shown.indexOf(f)).every((g) => g.holderOpacity === 1 && ty(g.holderTranslate)[1] === 0));
  assert.ok(whole && whole.t <= 240, `${label}: the new row whole and in place by ~190ms (${shown.map((f) => `${f.t}:${f.holderOpacity}/${ty(f.holderTranslate)[1]}`).join(' ')})`);
  // The copy stays where the old row was drawn, sideways.
  const copyXs = new Set(frames.flatMap((f) => f.rowGhosts.map((g) => g.x)));
  assert.ok(copyXs.size <= 2, `${label}: the old row's copy never moved sideways (${[...copyXs]})`);
  // It starts a beat after the old one: the first frame the new row shows,
  // the old one is already on its way.
  const firstIn = shown.find((f) => f.holderOpacity > 0.02 && f.holderOpacity < 1);
  return { kind: 'swap', jumps: jumps.length, ghostMs: lastGhost, wholeMs: whole.t, firstInMs: firstIn?.t ?? null, downPx: Math.round(Math.max(...ghostYs) * 10) / 10, fromPx: Math.round(Math.min(...holderYs) * 10) / 10 };
};

// Click `selector` from inside the page and sample every frame for `ms`:
// the ghost's opacity, the live slot's opacity / translate, and the fixed
// points' x each frame.
const sampleSwap = (page, selector, { slot = '[data-toolbar-subtools]', ms = 320 } = {}) => page.evaluate(({ selector, slot, ms }) => new Promise((done) => {
  const q = (s) => document.querySelector(s);
  const x = (el) => (el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null);
  const frames = [];
  const start = performance.now();
  // w50: row 2's set of controls (value-free), to tell a changed set from
  // the same one.
  const rowSig = () => {
    const h = q('[data-chrome-settings-holder]');
    const r = q('[data-chrome-format-row]');
    if (!h || !r || r.style.display === 'none') return null;
    return [...h.querySelectorAll('button, input, select, [data-toolbar-slot], .chrome-divider')]
      .filter((e) => !e.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-loadout-ignore]'))
      .map((e) => `${e.tagName}:${e.getAttribute('data-toolbar-slot') || ''}:${String(e.getAttribute('aria-label') || '').replace(/[#\d].*$/, '').trim()}`).join('|');
  };
  // w51: the vertical span an element actually draws: its box, cut by its
  // own clip-path inset and (for a copy) by the clipping layer it sits in.
  const drawnSpan = (el, clipper = null) => {
    if (!el || !el.getClientRects().length) return null;
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 0.02 || cs.visibility === 'hidden') return null;
    const b = el.getBoundingClientRect();
    let top = b.top; let bottom = b.bottom;
    const m = cs.clipPath && cs.clipPath.startsWith('inset(') ? cs.clipPath.slice(6).split(/[ )]/).map(parseFloat) : null;
    if (m) { top = Math.max(top, b.top + m[0]); bottom = Math.min(bottom, b.bottom - (Number.isFinite(m[2]) ? m[2] : m[0])); }
    if (clipper) { const c = clipper.getBoundingClientRect(); top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
    return [Math.round(top * 10) / 10, Math.round(bottom * 10) / 10];
  };
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
      colour: m.style.color,
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
      // w50: row 2's crossfade — the live row's own opacity / scale, and the
      // copy of the old row in row 2's ghost layer.
      holderOpacity: q('[data-chrome-settings-holder]') ? Number(Number(getComputedStyle(q('[data-chrome-settings-holder]')).opacity).toFixed(2)) : null,
      holderScale: (() => { const h = q('[data-chrome-settings-holder]'); if (!h) return null; const sc = getComputedStyle(h).scale; return sc === 'none' ? 1 : Number(sc); })(),
      rowGhosts: [...document.querySelectorAll('[data-chrome-format-row] [data-loadout-ghost-layer] > [data-loadout-ghost]')].map((g) => ({ o: Number(Number(getComputedStyle(g).opacity).toFixed(2)), tr: getComputedStyle(g).translate, x: Math.round(g.getBoundingClientRect().left * 10) / 10, drawn: drawnSpan(g, q('[data-chrome-format-row] [data-loadout-ghost-layer]')) })),
      // w51: row 2's band (its bar) and the span the live row draws in it.
      band: (() => { const r = q('[data-chrome-format-row]'); if (!r || r.style.display === 'none') return null; const b = r.getBoundingClientRect(); return [Math.round(b.top * 10) / 10, Math.round(b.bottom * 10) / 10]; })(),
      holderDrawn: drawnSpan(q('[data-chrome-settings-holder]')),
      rowSig: rowSig(),
      rowRect: (() => { const r = q('[data-chrome-format-row]'); if (!r || r.style.display === 'none') return null; const b = r.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)].join(','); })(),
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
    if (performance.now() - start < ms) requestAnimationFrame(sample); else done({ frames, before, sigBefore });
  };
  // w49: each loadout slot's glyph colour as drawn just before the click (a
  // morph must start from it — no colour pop on its first frame).
  const before = [...document.querySelectorAll('[data-toolbar-subtools] [data-morph-icon]')].map((b) => getComputedStyle(b.querySelector('svg, span[aria-hidden="true"]')).color);
  const sigBefore = rowSig();
  if (selector) q(selector).click();
  requestAnimationFrame(sample);
}), { selector, slot, ms }).then(({ frames, before, sigBefore }) => Object.assign(frames, { before, sigBefore }));

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
    assert.equal(xs.size, 1, `${label}: slot ${k + 1} morphed in place (${[...xs]}) ${withMorph.map((f) => `${f.t}:${f.morphs.map((m) => `${m.icon}@${m.x}`).join('+')}`).join(' ')}`);
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
  // The first drawn frame of each morph wears the colour the glyph had on
  // screen just before (the lit tool's gold, the others' grey).
  const rgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const firstMorphs = withMorph[0].morphs;
  for (let k = 0; k < firstMorphs.length && k < (frames.before || []).length; k += 1) {
    const [a, b] = [rgb(firstMorphs[k].colour), rgb(frames.before[k])];
    const off = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    // (A switch lands a frame or two after the click, by which time a tool
    // losing its lit state has started its own 100ms fade; a pop between
    // gold and grey is ~120 in blue, so 45 separates "carried on" from "popped".)
    assert.ok(off <= 45, `${label}: slot ${k + 1}'s morph starts in the colour it had (${firstMorphs[k].colour} vs ${frames.before[k]})`);
  }
  return { frames: frames.length, morphMs: lastMorph, grew };
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
      // w50: row 2's set changing, and row 3 coming and going, are instant.
      assert.ok(jump.every((f) => f.rowGhosts.length === 0 && (f.holderOpacity === 1 || f.holderOpacity === null)), `${width}px reduced motion: row 2 crossfaded`);
      await page.click(GROUP.text); await settle(page);
      if (!(await page.$('[data-chrome-text-format-row] [data-rich-text-toolbar]'))) {
        await page.click('[data-chrome-settings-holder] [aria-label="Edit text"]'); await settle(page);
      }
      const row3 = await page.evaluate(() => new Promise((done) => {
        const frames = [];
        const start = performance.now();
        document.querySelector('[data-chrome-settings-holder] [aria-label="Edit text"]').click();
        const tick = () => {
          const slotEl = document.querySelector('[data-chrome-text-format-row]');
          frames.push({ copies: slotEl.querySelectorAll('[data-loadout-ghost]').length, anims: [...slotEl.querySelectorAll('*')].reduce((n, e) => n + e.getAnimations().filter((a) => !(a instanceof CSSTransition)).length, 0) });
          if (performance.now() - start < 150) requestAnimationFrame(tick); else done(frames);
        };
        requestAnimationFrame(tick);
      }));
      assert.ok(row3.every((f) => f.copies === 0 && f.anims === 0), `${width}px reduced motion: row 3 went at once ${JSON.stringify(row3)}`);
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
        const frames = await sampleSwap(page, toSel);
        const r = assertMorph(frames, `${width}px ${from}→${to}`, { morphs });
        const way = assertRowSwap(frames, `${width}px ${from}→${to}`);
        assertRow2Centred([{ label: to, ...(await fixedPoints(page)) }], `${width}px ${from}→${to}`);
        if (round === 0) cycleReport.push(`${from}→${to} ${morphs} morphs/${r.morphMs}ms row 2 ${way.kind}${way.ghostMs != null ? ` (old down ${way.downPx}px, out by ${way.ghostMs}ms; new from ${way.fromPx}px, first shown ${way.firstInMs}ms, whole ${way.wholeMs}ms)` : ''}`);
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
    // RULED 2026-09-28 owner: row 2 downward swap (w51): leaving, its held
    // settings sink as the row fades, straight down, inside its band.
    const leaveYs = leave.filter((f) => f.rowGhosts.length).map((f) => ty(f.rowGhosts[0].tr));
    assert.ok(leaveYs.length >= 2 && leaveYs.every(([x]) => x === 0) && Math.max(...leaveYs.map(([, y]) => y)) > 1
      && leaveYs.every(([, y], k) => k === 0 || y >= leaveYs[k - 1][1] - 0.01), `${width}px Draw→Pan: row 2's settings sank as it went (${JSON.stringify(leaveYs)})`);
    for (const f of leave) for (const g of f.rowGhosts) if (f.band && g.drawn) assert.ok(g.drawn[1] <= f.band[1] + 0.6, `${width}px Draw→Pan: row 2's settings drew onto the page (${g.drawn} vs ${f.band})`);
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
    // RULED 2026-09-28 owner: one motion for row 2 — the wider Arrow row is
    // drawn at its new centre and swaps there; no glide (w48 glided).
    // RULED 2026-09-28 owner: row 2 downward swap (w51): the swap flows down.
    const glide = assertRowSwap(lineToArrow, `${width}px Line→Arrow`);
    assert.equal(glide.kind, 'swap', `${width}px Line→Arrow: the set changed, so row 2 swapped`);
    // And back: Arrow → Line.
    const arrowToLine = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Line"]', { slot: '[data-chrome-settings-holder]', ms: 320 });
    assertRowSwap(arrowToLine, `${width}px Arrow→Line`);
    await page.click('#chrome-subtools-host button[aria-label="Arrow"]'); await settle(page);
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
          where: [...document.querySelectorAll('[data-loadout-ghost]')].map((g) => (g.closest('[data-chrome-format-row]') ? 'row2' : 'row1') + ':' + Number(getComputedStyle(g).opacity).toFixed(2) + ':' + g.querySelectorAll('button,input').length).join(' '),
          row: row.style.display === 'none' ? 0 : Number(getComputedStyle(row).opacity),
        });
        if (t < 360) requestAnimationFrame(tick); else done(frames);
      };
      document.querySelector(pan).click();
      requestAnimationFrame(tick);
    }), { pan: PAN, shapes: GROUP.shapes });
    const afterBack = back.filter((f) => f.after);
    assert.ok(afterBack.slice(1).every((f) => f.ghosts === 0), `${width}px Shapes→Pan→Shapes: no copy left fading over the returning tools ${JSON.stringify(back.map((f) => [f.t, f.after, f.row.toFixed(2), f.where]))}`);
    const lowest = Math.min(...afterBack.map((f) => f.row));
    const atReturn = afterBack[0].row;
    assert.ok(lowest >= Math.min(atReturn, back.filter((f) => !f.after).slice(-1)[0].row) - 0.05, `${width}px Shapes→Pan→Shapes: row 2 ran back instead of replaying ${JSON.stringify(back.map((f) => f.row.toFixed(2)))}`);
    assert.equal(afterBack[afterBack.length - 1].row, 1, `${width}px: row 2 fully back`);
    await settle(page);
    // w50: more row-2 changes, each one crossfade or nothing.
    const extraReport = [];
    // Pen → Highlighter: report whether the set is the same (then nothing
    // may animate) or not (then one crossfade).
    await page.click(GROUP.draw); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Pen"]'); await settle(page);
    const penToHl = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Highlighter"]', { slot: '[data-chrome-settings-holder]', ms: 300 });
    extraReport.push(`Pen→Highlighter ${assertRowSwap(penToHl, `${width}px Pen→Highlighter`).kind}`);
    const hlToPen = await sampleSwap(page, '#chrome-subtools-host button[aria-label="Pen"]', { slot: '[data-chrome-settings-holder]', ms: 300 });
    extraReport.push(`Highlighter→Pen ${assertRowSwap(hlToPen, `${width}px Highlighter→Pen`).kind}`);
    // A value change inside a control (a preset colour) never animates row 2.
    const presets = await page.$$('[data-chrome-settings-holder] [data-quick-colours] button');
    if (presets.length >= 2) {
      const idx = presets.length - 2;
      const colourFrames = await page.evaluate((i) => new Promise((done) => {
        const h = document.querySelector('[data-chrome-settings-holder]');
        const frames = [];
        const start = performance.now();
        h.querySelectorAll('[data-quick-colours] button')[i].click();
        const tick = () => {
          frames.push({ o: Number(getComputedStyle(h).opacity), ghosts: document.querySelectorAll('[data-chrome-format-row] [data-loadout-ghost]').length, x: h.getBoundingClientRect().left });
          if (performance.now() - start < 250) requestAnimationFrame(tick); else done(frames);
        };
        requestAnimationFrame(tick);
      }), idx);
      assert.ok(colourFrames.every((f) => f.o === 1 && f.ghosts === 0), `${width}px: picking a colour animated row 2 ${JSON.stringify(colourFrames)}`);
      assert.equal(new Set(colourFrames.map((f) => f.x)).size, 1, `${width}px: picking a colour moved row 2`);
      extraReport.push('colour pick still');
    }
    // Cloud on / off (Rectangle's line style): Cloud adds its bump size.
    await page.click(GROUP.shapes); await settle(page);
    await page.click('#chrome-subtools-host button[aria-label="Rectangle"]'); await settle(page);
    const styleTrigger = '[data-chrome-settings-holder] [data-toolbar-slot="style"] button';
    const pickStyle = async (name) => {
      await page.click(styleTrigger); await page.waitForTimeout(200);
      const option = page.locator('[role="listbox"] [role="option"]', { hasText: name }).first();
      if (!(await option.count())) { await page.keyboard.press('Escape'); await settle(page); return null; }
      // Sample from the option's press: the menu closes and the set changes.
      const box = await option.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const sampled = sampleSwap(page, null,{ slot: '[data-chrome-settings-holder]', ms: 320 });
      await page.mouse.down(); await page.mouse.up();
      return sampled;
    };
    if (await page.$(styleTrigger)) {
      const cloudOn = await pickStyle('Cloud');
      if (cloudOn) {
        const r = assertRowSwap(cloudOn, `${width}px Cloud on`);
        await settle(page);
        const bump = await page.$('[data-chrome-settings-holder] [aria-label="Cloud bump size"]');
        extraReport.push(`Cloud on ${r.kind}${bump ? ' (bump size shown)' : ''}`);
        const cloudOff = await pickStyle('Solid');
        extraReport.push(`Cloud off ${assertRowSwap(cloudOff, `${width}px Cloud off`).kind}`);
        await settle(page);
      }
    }
    // Picking marks with Select: row 2 comes — RULED 2026-09-28 owner: row 2
    // downward swap (w51): down from under the tool bar, like row 3 (8px,
    // clipped at its top so it never draws over the tool bar), never sideways.
    await page.click(SELECT); await settle(page);
    const pickFrames = await page.evaluate(({ x, y }) => new Promise((done) => {
      const frames = [];
      const start = performance.now();
      const target = document.elementFromPoint(x, y);
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        target.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
      }
      const tick = () => {
        const r = document.querySelector('[data-chrome-format-row]');
        const h = document.querySelector('[data-chrome-settings-holder]');
        const cs = getComputedStyle(r);
        const b = r.getBoundingClientRect();
        const clipTop = cs.clipPath && cs.clipPath.startsWith('inset(') ? parseFloat(cs.clipPath.slice(6)) : 0;
        frames.push({ t: Math.round(performance.now() - start), display: r.style.display, o: Number(Number(cs.opacity).toFixed(2)), tr: cs.translate, htr: h ? getComputedStyle(h).translate : 'none', drawnTop: Math.round((b.top + clipTop) * 10) / 10 });
        if (performance.now() - start < 260) requestAnimationFrame(tick); else done(frames);
      };
      requestAnimationFrame(tick);
    }), { x: pageBox.x + 155, y: pageBox.y + 315 });
    const pickShown = pickFrames.filter((f) => f.display === 'block');
    const rowYs = pickShown.map((f) => ty(f.tr)[1]);
    assert.ok(pickShown.every((f) => ty(f.tr)[0] === 0 && ty(f.htr)[0] === 0), `${width}px pick: row 2 moved sideways as it came ${JSON.stringify(pickFrames)}`);
    assert.ok(rowYs.every((v, k) => v <= 0.01 && v >= -8.01 && (k === 0 || v >= rowYs[k - 1] - 0.01)), `${width}px pick: row 2 came straight down (${rowYs})`);
    const restTop = pickShown.length ? pickShown[pickShown.length - 1].drawnTop : null;
    assert.ok(pickShown.every((f) => f.drawnTop >= restTop - 0.6), `${width}px pick: row 2 drew above its spot, over the tool bar ${JSON.stringify(pickShown.map((f) => f.drawnTop))}`);
    extraReport.push(`pick: row 2 ${pickShown.some((f) => ty(f.tr)[1] < -1) ? `dropped in (from ${Math.min(...rowYs)}px)` : 'already there'}`);
    await page.keyboard.press('Escape'); await settle(page);

    // RULED 2026-09-28 owner: row 3 drops down. Text → row 3 (Aa) arrives;
    // Aa hides and shows it; Draw sends it away.
    const sampleRow3 = (selector) => page.evaluate((sel) => new Promise((done) => {
      const frames = [];
      const start = performance.now();
      const row2 = () => { const r = document.querySelector('[data-chrome-format-row]'); if (!r || r.style.display === 'none') return null; const b = r.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round).join(','); };
      const slotEl = document.querySelector('[data-chrome-text-format-row]');
      const beforeRow2 = row2();
      const pageTop = () => { const p = document.querySelector('.page, [data-page-number]'); return p ? Math.round(p.getBoundingClientRect().top * 10) / 10 : null; };
      const beforePage = pageTop();
      document.querySelector(sel).click();
      const tick = () => {
        const bar = document.querySelector('[data-chrome-text-format-row] > [data-rich-text-toolbar]');
        const copy = slotEl.querySelector(':scope > [data-loadout-ghost]');
        const read = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          const [tx, ty] = cs.translate === 'none' ? [0, 0] : cs.translate.split(' ').map(parseFloat).concat([0]).slice(0, 2);
          const clipTop = cs.clipPath && cs.clipPath !== 'none' ? parseFloat(cs.clipPath.slice(6)) : 0;
          return { o: Number(Number(cs.opacity).toFixed(2)), tx, ty: Math.round(ty * 100) / 100, clipTop: Math.round(clipTop * 100) / 100, drawnTop: Math.round((b.top + clipTop) * 10) / 10, left: Math.round(b.left) };
        };
        frames.push({ t: Math.round(performance.now() - start), bar: read(bar), copy: read(copy), slotTop: Math.round(slotEl.getBoundingClientRect().top * 10) / 10, row2: row2(), pageTop: pageTop() });
        if (performance.now() - start < 300) requestAnimationFrame(tick); else done({ frames, beforeRow2, beforePage });
      };
      requestAnimationFrame(tick);
    }), selector);
    const assertRow3 = ({ frames, beforeRow2, beforePage }, label, kind) => {
      const key = kind === 'in' ? 'bar' : 'copy';
      const moving = frames.filter((f) => f[key]);
      assert.ok(moving.length >= 3, `${label}: row 3 drawn over several frames (${moving.length})`);
      for (const f of moving) {
        const m = f[key];
        assert.equal(m.tx, 0, `${label} @${f.t}ms: row 3 moved sideways`);
        assert.ok(m.ty <= 0.01 && m.ty >= -8.01, `${label} @${f.t}ms: row 3 within its 8px drop (${m.ty})`);
        assert.ok(m.drawnTop >= f.slotTop - 0.6, `${label} @${f.t}ms: row 3 drawn above its slot, over row 2 (${m.drawnTop} vs ${f.slotTop})`);
      }
      const tys = moving.map((f) => f[key].ty);
      if (kind === 'in') {
        assert.ok(tys[0] < -1, `${label}: row 3 started above its spot (${tys})`);
        assert.ok(tys.every((v, i) => i === 0 || v >= tys[i - 1] - 0.01), `${label}: row 3 came straight down (${tys})`);
        assert.equal(tys[tys.length - 1], 0, `${label}: row 3 landed`);
        const landed = moving.find((f) => f.bar.ty === 0 && f.bar.o === 1);
        assert.ok(landed && landed.t <= 200, `${label}: row 3 in place by ~150ms (${moving.map((f) => `${f.t}:${f.bar.ty}/${f.bar.o}`).join(' ')})`);
      } else {
        assert.ok(tys.every((v, i) => i === 0 || v <= tys[i - 1] + 0.01), `${label}: row 3 went straight back up (${tys})`);
        const last = moving[moving.length - 1].t;
        assert.ok(last <= 160, `${label}: row 3 gone by ~110ms (last ${last}ms)`);
        assert.ok(!frames[frames.length - 1].copy, `${label}: no copy left`);
      }
      // Row 2 and the page never moved.
      for (const f of frames) {
        if (beforeRow2 && f.row2) assert.equal(f.row2, beforeRow2, `${label} @${f.t}ms: row 2 moved`);
        assert.equal(f.pageTop, beforePage, `${label} @${f.t}ms: the page moved`);
      }
      return kind === 'in' ? moving.find((f) => f.bar.ty === 0 && f.bar.o === 1)?.t : moving[moving.length - 1].t;
    };
    await page.click(GROUP.draw); await settle(page);
    // Make sure the Aa bar is on for the text tools.
    await page.click(GROUP.text); await settle(page);
    if (!(await page.$('[data-chrome-text-format-row] [data-rich-text-toolbar]'))) {
      await page.click('[data-chrome-settings-holder] [aria-label="Edit text"]'); await settle(page);
    }
    await page.click(GROUP.draw); await settle(page);
    const row3In = assertRow3(await sampleRow3(GROUP.text), `${width}px Draw→Text`, 'in');
    await settle(page);
    const row3Off = assertRow3(await sampleRow3('[data-chrome-settings-holder] [aria-label="Edit text"]'), `${width}px Aa off`, 'out');
    await settle(page);
    const row3On = assertRow3(await sampleRow3('[data-chrome-settings-holder] [aria-label="Edit text"]'), `${width}px Aa on`, 'in');
    await settle(page);
    const row3Leave = assertRow3(await sampleRow3(GROUP.draw), `${width}px Text→Draw`, 'out');
    await settle(page);
    extraReport.push(`row 3 drops in by ${row3In}/${row3On}ms, leaves by ${row3Off}/${row3Leave}ms`);
    await page.click(GROUP.shapes); await settle(page);

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
      + `row 2 starts ${[...rowStarts].sort((a, b) => a - b).join('/')} (centred); Line→Arrow ${glide.kind} (old down ${glide.downPx}px out by ${glide.ghostMs}ms, new from ${glide.fromPx}px first shown ${glide.firstInMs}ms whole ${glide.wholeMs}ms, ${glide.jumps} jump); ${extraReport.join('; ')}; `
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

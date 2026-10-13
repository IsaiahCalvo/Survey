// RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
// "As I switch between the annotation tools and the Select tool, the loadouts
// on the right, I want those to get animated in and out... a quick
// animation." This pins src/utils/loadoutTransition.js on a tiny stand-in DOM:
// what counts as a change of loadout, the motion it runs, and the
// reduced-motion path (instant). The live frame-by-frame check is
// scripts/verify-stable-toolbar.mjs.
//
// RULED 2026-09-27 owner: morphing icons + one motion language (w49). The
// w47 crossfade (fade + 6px sideways slide, 120ms out / 150ms in) is gone:
// a slot in both sets stays or MORPHS its icon in place, a slot only in the
// new set grows in from its centre, one only in the old set shrinks out, and
// every one takes the same 200ms ease-in-out as the row glide. The tests
// below that pinned the crossfade were rewritten for that ruling.
//
// RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
// drops down. Owner: row 2 was inconsistent — "sometimes you get a pan-in
// animation, sometimes some type of morph". The morph / grow / shrink above
// stays the TOOL BAR's (row 1's) alone. Row 2 now crossfades as a whole in
// place (attachRowCrossfade) and never glides; row 3 drops down from under
// row 2 (playRowDrop). The w48 glide tests, the w49 row-2 grow / shrink test
// and the w49 review tests of the glide (swapSharedNothing, the copy's drift
// offset) were removed or rewritten deliberately for that ruling.
//
// RULED 2026-09-28 owner: row 2 downward swap (w51). The w50 row-2 crossfade
// tests (opacity only, "never a translate") were rewritten deliberately for
// that ruling: row 2's swap now moves both copies DOWN (old sinks and fades,
// new comes down into place a beat later), clipped to row 2's band, still
// with no sideways motion and landing exactly at its final spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DROP_ROW_MOTION,
  LOADOUT_MOTION,
  ROW_MOTION,
  attachLoadoutTransition,
  attachRowCrossfade,
  dropRowKeyframes,
  loadoutKeyframes,
  loadoutSignature,
  makeGhost,
  planLoadoutSwap,
  playRowDrop,
  popoverOpenFrom,
  rowSwapKeyframes,
} from '../src/utils/loadoutTransition.js';

const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);

class FakeElement {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.hidden = false;
    this.animations = [];
    for (const child of children) this.appendChild(child);
  }

  get tagName() { return this.tag.toUpperCase(); }

  get isConnected() { return true; }

  get attributes() { return Object.keys(this.attrs).map((name) => ({ name })); }

  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }

  setAttribute(name, value) { this.attrs[name] = String(value); }

  removeAttribute(name) { delete this.attrs[name]; }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }

  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; }

  remove() { this.parentNode?.removeChild(this); }

  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }

  querySelectorAll(selector) {
    const all = this.descendants();
    if (selector === '*') return all;
    return all.filter((el) => CONTROL_TAGS.has(el.tag)
      || el.getAttribute('data-toolbar-slot') !== null
      || String(el.getAttribute('class') || '').split(' ').includes('chrome-divider'));
  }

  closest() {
    for (let el = this; el; el = el.parentNode) {
      if (['dialog', 'menu', 'listbox'].includes(el.getAttribute('role')) || el.getAttribute('data-loadout-ignore') !== null) return el;
    }
    return null;
  }

  cloneNode() {
    const copy = new FakeElement(this.tag, this.attrs, this.children.map((c) => c.cloneNode(true)));
    copy.style = { ...this.style };
    return copy;
  }

  getClientRects() { return this.hidden ? [] : [{}]; }

  getBoundingClientRect() { return { left: 0, top: 0, width: this.tag === 'button' ? 28 : 16, height: this.tag === 'button' ? 28 : 16 }; }

  matches(selector) {
    if (selector === 'button') return this.tag === 'button';
    return CONTROL_TAGS.has(this.tag) || this.getAttribute('data-toolbar-slot') !== null
      || String(this.getAttribute('class') || '').split(' ').includes('chrome-divider');
  }

  // Enough of querySelector for the loadout code: 'button', a data-morph-icon
  // holder, and a glyph ('svg, span[aria-hidden="true"]').
  querySelector(selector) {
    const all = this.descendants();
    if (selector === 'button') return all.find((n) => n.tag === 'button') || null;
    if (selector === '[data-morph-icon]') return all.find((n) => n.getAttribute('data-morph-icon') !== null) || null;
    if (selector.startsWith('svg')) return all.find((n) => n.tag === 'svg' || n.tag === 'span') || null;
    return null;
  }

  animate(keyframes, options) {
    const animation = {
      keyframes, options, onfinish: null, oncancel: null, cancelled: false, progress: 0,
      effect: { getComputedTiming: () => ({ progress: animation.progress }) },
      cancel() { this.cancelled = true; this.oncancel?.(); },
    };
    this.animations.push(animation);
    return animation;
  }
}

const el = (tag, attrs, children) => new FakeElement(tag, attrs, children);
// A tool button: its glyph inside, and (w49) the glyph's name for morphing.
const ICONS = { Pen: 'pen', Highlighter: 'highlighter', Eraser: 'eraser', Rectangle: 'rect', Ellipse: 'ellipse', Polygon: 'polygon', Text: 'textBox', Callout: 'callout', Box: 'selectCursor', Lasso: 'lassoSelect', 'Text select': 'textSelect', Line: 'line', Counter: 'counter' };
const tools = (...labels) => labels.map((label, i) => el('button', {
  'aria-label': label, id: `t${i}`, 'data-testid': `tool-${label}`, class: i === 0 ? 'btn btn-active' : 'btn',
  ...(ICONS[label] ? { 'data-morph-icon': ICONS[label] } : {}),
}, [el('svg', { 'data-colour': i === 0 ? 'rgb(216, 168, 78)' : 'rgb(183, 190, 201)' })]));

// A stand-in window: a MutationObserver we fire by hand, a switchable
// reduced-motion preference, and computed visibility from a flag.
const fakeWindow = ({ reduced = false } = {}) => {
  const win = {
    reduced,
    observers: [],
    matchMedia: (query) => ({ matches: query.includes('reduce') && win.reduced }),
    getComputedStyle: (element) => ({ visibility: element.style.visibility === 'hidden' ? 'hidden' : 'visible', color: element.getAttribute?.('data-colour') || 'rgb(100, 100, 100)' }),
    time: 0,
    frames: [],
    performance: { now: () => win.time },
    requestAnimationFrame: (callback) => { win.frames.push(callback); return win.frames.length; },
    cancelAnimationFrame: () => {},
    // Run animation frames until `ms` has passed.
    advance: (ms, step = 16) => {
      for (let t = 0; t < ms; t += step) {
        win.time += step;
        const due = win.frames.splice(0);
        due.forEach((callback) => callback(win.time));
      }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; win.observers.push(this); }

      observe() {}

      disconnect() { this.disconnected = true; }
    },
    flush: () => win.observers.forEach((o) => !o.disconnected && o.callback([])),
  };
  return win;
};

const setup = (options) => {
  const win = fakeWindow(options);
  const slot = el('div', { 'data-toolbar-subtools': 'true', style: 'left: 100%' }, [el('div', { class: 'chrome-divider' }), el('div', { id: 'chrome-subtools-host', 'data-chrome-subtools-host': 'true' }, tools('Pen', 'Highlighter', 'Eraser'))]);
  const layer = el('div', { 'data-loadout-ghost-layer': 'true' });
  layer.ownerDocument = { createElementNS: (_ns, tag) => el(tag) };
  const detach = attachLoadoutTransition(slot, layer, { win });
  const replace = (...children) => { slot.children = []; children.flat().forEach((c) => slot.appendChild(c)); win.flush(); };
  return { win, slot, layer, detach, replace };
};

test('the signature names the set of controls, not which one is lit or what value it holds', () => {
  const a = el('div', {}, [...tools('Pen', 'Highlighter', 'Eraser')]);
  const b = el('div', {}, [...tools('Pen', 'Highlighter', 'Eraser')]);
  b.children[0].setAttribute('class', 'btn');
  b.children[2].setAttribute('class', 'btn btn-active');
  assert.equal(loadoutSignature(a), loadoutSignature(b), 'a different lit tool is the same loadout');
  const swatch = (label) => el('div', {}, [el('button', { 'aria-label': label }), el('div', { 'data-toolbar-slot': 'width' }, [el('input', { 'aria-label': 'Width 2 pt' })])]);
  assert.equal(loadoutSignature(swatch('Custom colour #ff0000')), loadoutSignature(swatch('Custom colour #00ff00')), 'a new colour is the same loadout');
  assert.notEqual(loadoutSignature(a), loadoutSignature(el('div', {}, tools('Rectangle', 'Ellipse'))), 'another group is a new loadout');
  // A popover opened from the slot is not part of it.
  const withMenu = el('div', {}, [...tools('Pen', 'Highlighter', 'Eraser'), el('div', { role: 'menu' }, [el('button', { 'aria-label': 'Solid' })])]);
  assert.equal(loadoutSignature(withMenu), loadoutSignature(a));
});

const divider = () => el('div', { class: 'chrome-divider' });
// The tool bar's loadout slot as drawn live: the rule, then the viewer's host
// box holding a group's tools.
const host = (...labels) => el('div', { id: 'chrome-subtools-host', 'data-chrome-subtools-host': 'true' }, tools(...labels));
const buttonsIn = (node) => node.descendants().filter((c) => c.tag === 'button');
const glyphOf = (button) => button.children[0];
const overlays = (layer) => layer.children.filter((c) => c.getAttribute('data-loadout-morph') !== null);
const ghostsIn = (layer) => layer.children.filter((c) => c.getAttribute('data-loadout-ghost') !== null);
const GROW = [{ opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1' }];
const SHRINK = [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.6' }];

test('RULED w49: Draw → Shapes — slots 1-3 morph pen → rectangle, highlighter → ellipse, eraser → polygon in place; slot 4 grows in; the rule stays', () => {
  const { slot, layer, win, replace } = setup();
  replace(divider(), host('Rectangle', 'Ellipse', 'Polygon', 'Line'));
  const morphs = overlays(layer);
  assert.deepEqual(morphs.map((m) => m.getAttribute('data-loadout-morph')), ['rect', 'ellipse', 'polygon'], 'one morph per shared slot, drawing towards the new icon');
  for (const m of morphs) {
    assert.equal(m.getAttribute('aria-hidden'), 'true');
    assert.equal(m.style.pointerEvents, 'none');
    assert.match(m.children[0].getAttribute('d'), /^M[\d.-]+ [\d.-]+L/, 'drawn as a path');
  }
  // The live glyphs under the morphs are hidden until it lands (an
  // animation, not a DOM change).
  const live = buttonsIn(slot);
  for (const button of live.slice(0, 3)) assert.deepEqual(glyphOf(button).animations[0].keyframes, [{ opacity: 0 }, { opacity: 0 }]);
  // Slot 4 is only in Shapes: it grows in from its centre.
  const grow = live[3].animations[0];
  assert.deepEqual(grow.keyframes, GROW);
  assert.equal(grow.options.duration, LOADOUT_MOTION.durationMs);
  assert.equal(grow.options.easing, LOADOUT_MOTION.easing);
  // Morphing tools do not also grow; the rule does not animate; nothing
  // shrinks, so no copy of the old set is drawn.
  for (const button of live.slice(0, 3)) assert.equal(button.animations.length, 0);
  assert.equal(slot.children[0].animations.length, 0);
  assert.equal(ghostsIn(layer).length, 0);
  // The morph's colour runs from the old glyph's to the new one's.
  assert.equal(morphs[0].style.color, 'rgba(216, 168, 78, 1)');
  // Frames run it to the end; at rest the overlays are gone and the real
  // (crisp) icons are shown again.
  const first = morphs[0].children[0].getAttribute('d');
  win.advance(96);
  assert.notEqual(morphs[0].children[0].getAttribute('d'), first, 'the shape changes frame by frame');
  win.advance(128);
  assert.equal(overlays(layer).length, 0);
  for (const button of live.slice(0, 3)) assert.equal(glyphOf(button).animations[0].cancelled, true);
});

test('RULED w49: Shapes → Draw — slots 1-3 morph back; slots only Shapes had shrink out to their centres in a lifeless copy', () => {
  const { slot, layer, win, replace } = setup();
  replace(divider(), host('Rectangle', 'Ellipse', 'Polygon', 'Line'));
  buttonsIn(slot)[3].animations[0].onfinish();
  win.advance(240);
  replace(divider(), host('Pen', 'Highlighter', 'Eraser'));
  assert.equal(overlays(layer).length, 3);
  const [ghost] = ghostsIn(layer);
  assert.ok(ghost, 'the leaving slot is drawn in a copy');
  assert.equal(ghost.getAttribute('aria-hidden'), 'true');
  assert.equal(ghost.getAttribute('inert'), '');
  const units = [ghost.children[0], ...buttonsIn(ghost)];
  // Only the Line slot shows (and shrinks); the rule and the morphing slots
  // are held hidden in the copy.
  assert.deepEqual(units.map((u) => u.style.visibility === 'hidden'), [true, true, true, true, false]);
  const out = units[4].animations[0];
  assert.deepEqual(out.keyframes, SHRINK);
  assert.equal(out.options.duration, LOADOUT_MOTION.durationMs);
  assert.ok(buttonsIn(slot).every((b) => b.animations.length === 0), 'nothing grows: every Draw slot morphs');
  out.onfinish();
  assert.equal(ghostsIn(layer).length, 0, 'the copy goes when its last slot has shrunk');
});

test('RULED w49: one motion language in the tool bar — the same 200ms ease-in-out for every morph, grow and shrink, and nothing slides sideways', () => {
  assert.equal(LOADOUT_MOTION.durationMs, 200);
  assert.ok(LOADOUT_MOTION.durationMs >= 180 && LOADOUT_MOTION.durationMs <= 220, 'quick: 180-220ms');
  assert.match(LOADOUT_MOTION.easing, /^cubic-bezier\(0\.45, 0, 0\.55, 1\)$/, 'ease-in-out');
  assert.equal(LOADOUT_MOTION.growFrom, 0.6);
  assert.deepEqual(loadoutKeyframes('in'), GROW);
  assert.deepEqual(loadoutKeyframes('out'), SHRINK);
  for (const frame of [...loadoutKeyframes('in'), ...loadoutKeyframes('out')]) {
    assert.equal(frame.translate, undefined, 'no sideways slide');
  }
  assert.deepEqual(loadoutKeyframes('in', { from: { opacity: 0.4, scale: 0.76 } })[0], { opacity: 0.4, scale: '0.76' }, 'a change caught mid-way starts where it was');
});

// The loadouts as the planner sees them: the rule, then each tool's slot.
const LOADOUTS = {
  Pan: [],
  Draw: ['rule', 'pen', 'highlighter', 'eraser'],
  Shapes: ['rule', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter'],
  Text: ['rule', 'textBox', 'callout'],
  Select: ['rule', 'selectCursor', 'lassoSelect', 'textSelect'],
};
const slots = (names) => names.map((name) => ({ sig: name, icon: name === 'rule' ? null : name }));

test('RULED w49: every group switch plans the same way — shared tool slots morph, the rule stays, extra slots grow or shrink, in every direction', () => {
  const MORPHABLE = new Set(['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'polygon', 'textBox', 'callout', 'selectCursor', 'lassoSelect', 'textSelect']);
  for (const [fromName, from] of Object.entries(LOADOUTS)) {
    for (const [toName, to] of Object.entries(LOADOUTS)) {
      if (fromName === toName) continue;
      const kinds = planLoadoutSwap(slots(from), slots(to));
      const label = `${fromName} → ${toName}`;
      kinds.forEach((kind, i) => {
        const [a, b] = [from[i], to[i]];
        let expected;
        if (a && b) expected = a === b ? 'stay' : (MORPHABLE.has(a) && MORPHABLE.has(b) ? 'morph' : 'swap');
        else expected = b ? 'grow' : 'shrink';
        assert.equal(kind, expected, `${label} slot ${i}`);
      });
      // The reverse switch is the mirror image: morphs stay morphs, grows
      // become shrinks — one language whichever way you go.
      const back = planLoadoutSwap(slots(to), slots(from));
      assert.deepEqual(back, kinds.map((k) => ({ grow: 'shrink', shrink: 'grow' }[k] || k)), `${label} mirrors its reverse`);
    }
  }
  // The owner's slots: 1 = pen / rectangle / text box / Box, 2 = highlighter
  // / ellipse / callout / Lasso, 3 = eraser / polygon / Text select.
  assert.deepEqual(planLoadoutSwap(slots(LOADOUTS.Draw), slots(LOADOUTS.Text)), ['stay', 'morph', 'morph', 'shrink']);
  assert.deepEqual(planLoadoutSwap(slots(LOADOUTS.Text), slots(LOADOUTS.Select)), ['stay', 'morph', 'morph', 'grow']);
});

test('RULED w49: a morph caught mid-way (Draw → Shapes → Text quickly) carries on from the shape on screen, never snapping back', () => {
  const { layer, win, replace } = setup();
  replace(divider(), host('Rectangle', 'Ellipse', 'Polygon'));
  win.advance(96);
  const midway = overlays(layer)[0].children.map((p) => p.getAttribute('d'));
  replace(divider(), host('Text', 'Callout'));
  const next = overlays(layer).filter((m) => !m.animations.length);
  assert.deepEqual(next.map((m) => m.getAttribute('data-loadout-morph')), ['textBox', 'callout'], 'slots 1-2 morph on to the Text tools');
  // The new morph's first frame is the old one's last: the same ink.
  const pts = (d) => d.slice(1).split('L').map((xy) => xy.split(' ').map(Number));
  const inkOf = (ds) => ds.flatMap(pts);
  const box = (points) => [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))];
  const before = box(inkOf(midway));
  const after = box(inkOf(next[0].children.map((p) => p.getAttribute('d'))));
  before.forEach((v, i) => assert.ok(Math.abs(v - after[i]) < 0.05, `starts where it was (${before} vs ${after})`));
  // Slot 3 (polygon, mid-morph) has no Text slot: its overlay shrinks out
  // as drawn.
  const shrinking = layer.children.find((c) => c.getAttribute('data-loadout-morph') === 'polygon');
  assert.deepEqual(shrinking?.animations[0]?.keyframes, SHRINK);
});



test('w49 review: a tool lit mid-morph turns its overlay the new colour at once (over the buttons\' 100ms), not when the morph lands', () => {
  const { slot, layer, win, replace } = setup();
  replace(divider(), host('Rectangle', 'Ellipse', 'Polygon'));
  win.advance(48);
  const [rect, ellipse] = overlays(layer);
  // Ellipse is clicked: it lights, Rectangle dims — same set, so no swap.
  const [rectButton, ellipseButton] = buttonsIn(slot);
  glyphOf(rectButton).setAttribute('data-colour', 'rgb(183, 190, 201)');
  glyphOf(ellipseButton).setAttribute('data-colour', 'rgb(216, 168, 78)');
  win.flush();
  win.advance(112);
  assert.equal(rect.style.color, 'rgba(183, 190, 201, 1)', 'the dimmed tool is grey before its morph ends');
  assert.equal(ellipse.style.color, 'rgba(216, 168, 78, 1)', 'the lit tool is gold before its morph ends');
});

test('the same set with another tool lit, or a new value, does not animate', () => {
  const { slot, layer, replace } = setup();
  const again = host('Pen', 'Highlighter', 'Eraser');
  again.children[0].setAttribute('class', 'btn');
  again.children[1].setAttribute('class', 'btn btn-active');
  replace(divider(), again);
  assert.equal(layer.children.length, 0);
  assert.ok(slot.descendants().every((n) => n.animations.length === 0));
});

test('reduced motion: the swap is instant — no copy, no morph, no animation', () => {
  const { slot, layer, replace } = setup({ reduced: true });
  replace(divider(), host('Rectangle', 'Ellipse'));
  assert.equal(layer.children.length, 0);
  assert.ok(slot.descendants().every((n) => n.animations.length === 0));
});

test('nothing leaving (Pan → Draw): the rule and tools grow in at once, with no wait', () => {
  const { slot, layer, replace } = setup();
  replace();
  for (const ghost of ghostsIn(layer)) for (const unit of ghost.descendants()) unit.animations[0]?.onfinish();
  assert.equal(layer.children.length, 0);
  replace(divider(), host('Pen', 'Highlighter', 'Eraser'));
  assert.equal(layer.children.length, 0);
  const arrivals = [slot.children[0], ...buttonsIn(slot)].map((n) => n.animations[0]);
  assert.equal(arrivals.length, 4);
  assert.ok(arrivals.every((a) => a && !a.options.delay && JSON.stringify(a.keyframes) === JSON.stringify(GROW)));
});

test('a burst of changes (Draw → Select: tools out, then the modes in): the Draw tools shrink out, the modes grow in', () => {
  const { slot, layer, replace } = setup();
  replace(divider(), host());
  replace(divider(), el('div', { 'data-select-mode-toggle': 'true' }, tools('Box', 'Lasso', 'Text select')), host());
  const [ghost] = ghostsIn(layer);
  assert.equal(buttonsIn(ghost).filter((b) => b.animations[0]).length, 3, 'the Draw tools are the ones leaving');
  const arrivals = buttonsIn(slot).map((b) => b.animations[0]);
  assert.equal(arrivals.length, 3);
  assert.ok(arrivals.every((a) => JSON.stringify(a.keyframes) === JSON.stringify(GROW)));
});

test('the set that is leaving comes straight back (Shapes → Pan → Shapes): it grows back from where it had shrunk to, and no copy of it stays', () => {
  const { slot, layer, replace } = setup();
  replace();
  const [ghost] = ghostsIn(layer);
  const shrinking = [ghost.children[0], ...buttonsIn(ghost)];
  shrinking.forEach((u) => { u.animations[0].progress = 0.5; });
  replace(divider(), host('Pen', 'Highlighter', 'Eraser'));
  assert.equal(ghostsIn(layer).length, 0, 'their copy is dropped at once');
  const arrivals = [slot.children[0], ...buttonsIn(slot)].map((n) => n.animations[0]);
  for (const a of arrivals) {
    assert.deepEqual(a.keyframes[0], { opacity: 0.5, scale: '0.8' }, 'from half shrunk');
    assert.ok(a.options.duration < LOADOUT_MOTION.durationMs, 'and only the rest of the way');
  }
});

test('a slot hidden (row 2 leaving) holds its last set while the row fades; shown again, it just stays', () => {
  const { slot, layer, win } = setup();
  slot.style.visibility = 'hidden';
  win.flush();
  assert.equal(layer.children.length, 1, 'the last set is held');
  const [hold] = layer.children[0].animations;
  assert.deepEqual(hold.keyframes, [{ opacity: 1 }, { opacity: 1 }], 'no second fade on top of the row\'s own');
  assert.equal(hold.options.duration, ROW_MOTION.outMs);
  assert.ok(slot.descendants().every((n) => n.animations.length === 0), 'nothing arrives into a hidden slot');
  slot.style.visibility = '';
  slot.appendChild(el('button', { 'aria-label': 'Solid' }));
  win.flush();
  assert.equal(layer.children.length, 0, 'wanted again: the held copy goes, the row\'s own fade covers the rest');
  assert.ok(slot.descendants().every((n) => n.animations.length === 0));
});

test('detaching stops watching and clears any copy or morph', () => {
  const { layer, win, detach, replace } = setup();
  replace(host('Rectangle'));
  assert.ok(layer.children.length >= 1);
  detach();
  assert.equal(layer.children.length, 0);
  assert.ok(win.observers.every((o) => o.disconnected));
});

test('makeGhost strips every hook a selector — the app\'s or a test\'s — could find', () => {
  const copy = el('div', { 'data-chrome-settings-holder': 'true', id: 'x', role: 'toolbar' }, [
    el('div', { 'data-toolbar-slot': 'width', 'data-toolbar-compact': 'false', 'data-annotation-size-control': 'true' }, [el('input', { name: 'w', title: 'Width', 'aria-label': 'Width', tabindex: '0' })]),
    el('button', { 'data-quick-colour-custom': 'true', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-testid': 'more' }),
    el('div', { role: 'group', 'data-quick-colours': 'true' }),
  ]);
  makeGhost(copy);
  for (const node of [copy, ...copy.descendants()]) {
    const names = Object.keys(node.attrs).filter((n) => !['aria-hidden', 'inert', 'data-loadout-ghost', 'class'].includes(n));
    assert.deepEqual(names, [], `${node.tag} kept ${names}`);
  }
});

// RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
// drops down.
const rowSettings = (...extra) => [
  el('div', { 'data-quick-colours': 'true' }, [el('button', { 'aria-label': 'Red' }), el('button', { 'aria-label': 'Custom colour #ff0000' })]),
  divider(),
  el('div', { 'data-toolbar-slot': 'width' }, [el('input', { 'aria-label': 'Width 2 pt' })]),
  ...extra,
];
const setupRow = (options) => {
  const win = fakeWindow(options);
  const holder = el('div', { 'data-chrome-settings-holder': 'true', style: 'left: 480px' }, rowSettings(el('div', { 'data-toolbar-slot': 'style' })));
  holder.ownerDocument = { querySelector: () => null };
  const layer = el('div', { 'data-loadout-ghost-layer': 'true' });
  const detach = attachRowCrossfade(holder, layer, { win });
  const replace = (...children) => { holder.children = []; children.flat().forEach((c) => holder.appendChild(c)); win.flush(); };
  return { win, holder, layer, detach, replace };
};
const everyFrame = (node) => [node, ...node.descendants()].flatMap((n) => n.animations.flatMap((a) => a.keyframes));

// Where a keyframe draws its element: [x, y] from its translate.
const moveOf = (frame) => frame.translate.split(' ').map(parseFloat);
// clip-path inset(top right bottom left) as numbers.
const clipOf = (frame) => frame.clipPath.slice(6, -1).split(' ').map(parseFloat);

test('RULED 2026-09-28 owner: row 2 downward swap — a changed set sinks the old row and brings the new one down into place, overlapping, no sideways motion, landing exactly', () => {
  const { holder, layer, replace } = setupRow();
  // Line → Cloud-style change: the settings after the colours change.
  replace(rowSettings(el('div', { 'data-toolbar-slot': 'fill' }), el('div', { 'data-toolbar-slot': 'arrowhead' })));
  // The live row: one animation on the row itself, coming DOWN to its spot.
  assert.equal(holder.animations.length, 1);
  const [incoming] = holder.animations;
  assert.deepEqual(incoming.keyframes, rowSwapKeyframes('in', { room: { top: 0, bottom: 0 } }));
  const [inFrom, inTo] = incoming.keyframes;
  assert.equal(inFrom.opacity, 0);
  assert.equal(inTo.opacity, 1);
  assert.equal(incoming.options.duration, ROW_MOTION.inMs);
  assert.equal(incoming.options.delay, ROW_MOTION.inDelayMs);
  assert.equal(incoming.options.easing, ROW_MOTION.inEasing);
  assert.equal(incoming.options.fill, 'backwards', 'hidden above while it waits its beat; nothing left on it after');
  // The old row: one lifeless copy over it, sinking as it fades.
  const [ghost] = ghostsIn(layer);
  assert.ok(ghost, 'the old row is drawn in a copy');
  assert.equal(ghost.getAttribute('aria-hidden'), 'true');
  const outgoing = ghost.animations[0];
  const [outFrom, outTo] = outgoing.keyframes;
  assert.equal(outFrom.opacity, 1);
  assert.equal(outTo.opacity, 0);
  assert.equal(outgoing.options.duration, ROW_MOTION.outMs);
  assert.equal(outgoing.options.easing, ROW_MOTION.outEasing);
  // Both move the same way — DOWN — and never sideways.
  const [, inY0] = moveOf(inFrom);
  const [, inY1] = moveOf(inTo);
  const [, outY0] = moveOf(outFrom);
  const [, outY1] = moveOf(outTo);
  assert.ok(inY1 > inY0, 'the new row travels down');
  assert.ok(outY1 > outY0, 'the old row travels down');
  assert.equal(inY0, -ROW_MOTION.inTravelPx);
  assert.equal(outY1, ROW_MOTION.outTravelPx);
  for (const frame of [...incoming.keyframes, ...outgoing.keyframes]) assert.equal(moveOf(frame)[0], 0, 'no x motion');
  // It lands exactly where it belongs: no offset left at the end, and the
  // row's own laid-out spot (its planned centre) is never touched.
  assert.deepEqual(moveOf(inTo), [0, 0]);
  assert.equal(holder.getAttribute('style'), 'left: 480px');
  assert.equal(holder.style.translate, undefined);
  // The copy sits where the old row was drawn (its own laid-out spot).
  assert.equal(ghost.getAttribute('style'), 'left: 480px');
  assert.equal(ghost.style.translate, undefined, 'the copy is not shifted');
  // Nothing inside either row animates on its own; no scale anywhere.
  for (const node of [...holder.descendants(), ...ghost.descendants()]) assert.equal(node.animations.length, 0, `${node.tag} animated on its own`);
  for (const frame of [...everyFrame(holder), ...everyFrame(ghost)]) {
    assert.equal(frame.transform, undefined);
    assert.equal(frame.scale, undefined);
  }
  ghost.animations[0].onfinish();
  assert.equal(ghostsIn(layer).length, 0, 'the copy goes when it has faded');
});

test('RULED 2026-09-28 owner: row 2 downward swap — quick enough to hide it: ~180-200ms end to end, the new row a beat (30-40ms) after the old', () => {
  const total = Math.max(ROW_MOTION.outMs, ROW_MOTION.inDelayMs + ROW_MOTION.inMs);
  assert.ok(total >= 175 && total <= 200, `total ${total}ms`);
  assert.ok(ROW_MOTION.inDelayMs >= 30 && ROW_MOTION.inDelayMs <= 40);
  assert.ok(ROW_MOTION.outTravelPx >= 6 && ROW_MOTION.outTravelPx <= 8);
  assert.ok(ROW_MOTION.inTravelPx >= 6 && ROW_MOTION.inTravelPx <= 8);
  assert.equal(ROW_MOTION.inEasing, 'cubic-bezier(0.33, 1, 0.68, 1)', 'ease-out: settles');
  assert.equal(ROW_MOTION.outEasing, 'cubic-bezier(0.32, 0, 0.67, 0)', 'ease-in: speeds away');
});

test('RULED 2026-09-28 owner: row 2 downward swap — every frame is clipped to row 2\'s band, so nothing draws over the tool bar or the page', () => {
  // Settings 28px tall centred in a 36px band: 4px of band above and below.
  const room = { top: 4, bottom: 4 };
  for (const frames of [rowSwapKeyframes('in', { room }), rowSwapKeyframes('out', { room }), rowSwapKeyframes('out', { room, from: 0.4, fromY: -3 }), rowSwapKeyframes('leave', { room })]) {
    for (const frame of frames) {
      const [, y] = moveOf(frame);
      const [top, right, bottom, left] = clipOf(frame);
      // The clip, in the element's own moved coordinates, sits exactly on
      // the band: its top at the band's top, its bottom at the band's bottom.
      assert.equal(top + y, -room.top, 'clip top on the band\'s top edge');
      assert.equal(y - bottom, room.bottom, 'clip bottom on the band\'s bottom edge');
      assert.ok(left < -1000 && right < -1000, 'never clipped sideways');
    }
  }
  // Coming down 6px with 4px of room: 2px of it is still above the band and hidden.
  assert.equal(clipOf(rowSwapKeyframes('in', { room })[0])[0], ROW_MOTION.inTravelPx - 4);
  // The band is measured from the real row: settings box vs its bar.
  const { holder, replace } = setupRow();
  const bar = el('div', { 'data-chrome-format-row': 'true' });
  bar.getBoundingClientRect = () => ({ top: 100, bottom: 136, left: 0, width: 800, height: 36 });
  holder.parentNode = bar;
  holder.getBoundingClientRect = () => ({ top: 104, bottom: 132, left: 480, width: 200, height: 28 });
  replace(rowSettings(el('div', { 'data-toolbar-slot': 'fill' })));
  const last = holder.animations.at(-1);
  assert.deepEqual(last.keyframes, rowSwapKeyframes('in', { room: { top: 4, bottom: 4 } }));
});

test('RULED 2026-09-28 owner: row 2 with the same set (pen → highlighter, a new colour or width) does not animate at all', () => {
  const { holder, layer, replace } = setupRow();
  const same = rowSettings(el('div', { 'data-toolbar-slot': 'style' }));
  same[0].children[1].setAttribute('aria-label', 'Custom colour #00ff00');
  same[2].children[0].setAttribute('aria-label', 'Width 5 pt');
  replace(same);
  assert.equal(layer.children.length, 0);
  assert.equal(everyFrame(holder).length, 0);
});

test('RULED 2026-09-28 owner: a row 2 change caught mid-swap carries the half-shown row on down from where it was; the new one comes down behind it', () => {
  const { holder, layer, replace } = setupRow();
  replace(rowSettings(el('div', { 'data-toolbar-slot': 'fill' })));
  const [first] = holder.animations;
  first.progress = 0.5;
  replace(rowSettings(el('div', { 'data-toolbar-slot': 'arrowhead' })));
  assert.equal(first.cancelled, true);
  const ghosts = ghostsIn(layer);
  assert.equal(ghosts.length, 2, 'the older copy keeps going, the half-shown row joins it');
  const [from, to] = ghosts[1].animations[0].keyframes;
  assert.equal(from.opacity, 0.5);
  assert.deepEqual(moveOf(from), [0, -ROW_MOTION.inTravelPx * 0.5], 'from where it was drawn, half-way down');
  assert.deepEqual(moveOf(to), [0, ROW_MOTION.outTravelPx]);
  assert.equal(to.opacity, 0);
  assert.equal(ghosts[1].animations[0].options.duration, ROW_MOTION.outMs * 0.5);
  assert.deepEqual(holder.animations[1].keyframes, rowSwapKeyframes('in', { room: { top: 0, bottom: 0 } }));
});

test('RULED 2026-09-28 owner: a row 2 change with a popover open is instant, so the popover stays on its opener', () => {
  const { holder, layer, replace } = setupRow();
  holder.ownerDocument = { querySelector: (s) => (s === '[data-anchored-popover]' ? {} : null) };
  assert.equal(popoverOpenFrom(holder), true);
  replace(rowSettings(el('div', { 'data-toolbar-slot': 'fill' })));
  assert.equal(layer.children.length, 0);
  assert.equal(everyFrame(holder).length, 0);
});

test('RULED 2026-09-28 owner: reduced motion — row 2 changes, row 3 comes and goes, all instantly', () => {
  const { holder, layer, replace } = setupRow({ reduced: true });
  replace(rowSettings(el('div', { 'data-toolbar-slot': 'fill' })));
  assert.equal(layer.children.length, 0);
  assert.equal(everyFrame(holder).length, 0);
  const win = fakeWindow({ reduced: true });
  const slot = el('div');
  const bar = el('div', {}, [el('button', { 'aria-label': 'Bold' })]);
  assert.equal(playRowDrop(bar, null, slot, { win }), null);
  assert.equal(bar.animations.length, 0);
  assert.equal(playRowDrop(null, bar, slot, { win }), null);
  assert.equal(slot.children.length, 0);
});

test('RULED 2026-09-28 owner: row 2 leaving holds its last set, sinking it while the row fades itself, then the copy goes', () => {
  const { holder, layer, win } = setupRow();
  holder.style.visibility = 'hidden';
  win.flush();
  const [ghost] = ghostsIn(layer);
  const [from, to] = ghost.animations[0].keyframes;
  assert.deepEqual([from.opacity, to.opacity], [1, 1], 'no second fade on top of the row\'s own');
  assert.deepEqual(moveOf(from), [0, 0]);
  assert.deepEqual(moveOf(to), [0, ROW_MOTION.outTravelPx], 'it moves down as it goes');
  assert.equal(ghost.animations[0].options.duration, ROW_MOTION.outMs);
  holder.style.visibility = '';
  win.flush();
  assert.equal(layer.children.length, 0, 'wanted again: the copy goes, the row\'s own drop-in covers it');
});

test('RULED 2026-09-28 owner: row 3 drops down from under row 2 (~150ms in, ~110ms out), straight down, clipped at its top', () => {
  assert.ok(DROP_ROW_MOTION.inMs >= 130 && DROP_ROW_MOTION.inMs <= 170);
  assert.ok(DROP_ROW_MOTION.outMs >= 90 && DROP_ROW_MOTION.outMs <= 130 && DROP_ROW_MOTION.outMs < DROP_ROW_MOTION.inMs);
  const [from, to] = dropRowKeyframes('in');
  assert.deepEqual(from, { opacity: 0, translate: '0px -8px', clipPath: 'inset(8px 0px 0px 0px)' });
  assert.deepEqual(to, { opacity: 1, translate: '0px 0px', clipPath: 'inset(0px 0px 0px 0px)' });
  assert.deepEqual(dropRowKeyframes('out'), [to, from], 'it leaves the reverse way');
  // The clip moves exactly against the travel, so nothing of it ever shows
  // above its own slot (it never covers row 2); no sideways part.
  for (const frame of dropRowKeyframes('in')) {
    const [x, y] = frame.translate.split(' ').map(parseFloat);
    assert.equal(x, 0);
    assert.equal(parseFloat(frame.clipPath.slice(6)) + y, 0);
  }
});

test('RULED 2026-09-28 owner: row 3 enter drops the bar in; exit sends a lifeless copy back up out of the flow', () => {
  const win = fakeWindow();
  const slot = el('div', { 'data-chrome-text-format-row': 'true' });
  const bar = el('div', { 'data-rich-text-toolbar': 'true', style: 'padding-left: 500px' }, [el('button', { 'aria-label': 'Bold' }), el('button', { 'aria-label': 'Italic' })]);
  // Enter.
  assert.equal(playRowDrop(bar, null, slot, { win }), null);
  assert.deepEqual(bar.animations[0].keyframes, dropRowKeyframes('in'));
  assert.equal(bar.animations[0].options.duration, DROP_ROW_MOTION.inMs);
  assert.equal(bar.animations[0].options.easing, DROP_ROW_MOTION.inEasing);
  // Exit: React already took the bar out; its copy goes up in the slot.
  const leaving = playRowDrop(null, bar, slot, { win });
  assert.ok(leaving);
  const [copy] = slot.children;
  assert.equal(copy, leaving.copy);
  assert.equal(copy.getAttribute('data-loadout-ghost'), 'true');
  assert.equal(copy.getAttribute('data-rich-text-toolbar'), null, 'no hooks left for the editor or a test to find');
  assert.equal(copy.style.position, 'absolute', 'out of the flow: nothing below waits or moves');
  assert.deepEqual(leaving.animation.keyframes, dropRowKeyframes('out'));
  assert.equal(leaving.animation.options.duration, DROP_ROW_MOTION.outMs);
  leaving.animation.onfinish();
  assert.equal(slot.children.length, 0, 'gone when it is up');
  // Back again mid-exit: the copy goes at once and the bar drops in again.
  const again = playRowDrop(null, bar, slot, { win });
  const bar2 = el('div', {}, [el('button', { 'aria-label': 'Bold' })]);
  playRowDrop(bar2, null, slot, { win, previous: again });
  assert.equal(slot.children.length, 0);
  assert.equal(bar2.animations.length, 1);
  // Disabled (the phone): nothing.
  const bar3 = el('div', {}, [el('button')]);
  assert.equal(playRowDrop(bar3, null, slot, { win, enabled: false }), null);
  assert.equal(bar3.animations.length, 0);
});

test('RULED 2026-09-28 owner: row 2 downward swap — row 2 appears the way row 3 does (down from under the bar above, same curve), never over the tool bar', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const t = DROP_ROW_MOTION.travelPx;
  const block = css.slice(css.indexOf('@keyframes chromeRowDropIn'));
  assert.ok(block.includes(`from { opacity: 0; translate: 0px -${t}px; clip-path: inset(${t}px 0px 0px 0px); }`));
  assert.ok(block.includes('to { opacity: 1; translate: 0px 0px; clip-path: inset(0px 0px 0px 0px); }'));
  const rule = css.match(/\.chrome-row-drop-in \{\s*animation: chromeRowDropIn (\d+)ms (cubic-bezier\([^)]*\));/);
  assert.ok(rule);
  assert.equal(Number(rule[1]), DROP_ROW_MOTION.inMs);
  assert.equal(rule[2], DROP_ROW_MOTION.inEasing);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.chrome-row-drop-in \{\s*animation: none;/);
  assert.doesNotMatch(css, /chrome-row-fade-in/);
});


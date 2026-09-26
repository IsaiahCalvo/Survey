// RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
// "As I switch between the annotation tools and the Select tool, the loadouts
// on the right, I want those to get animated in and out... a quick
// animation." This pins src/utils/loadoutTransition.js on a tiny stand-in DOM:
// what counts as a change of loadout, the crossfade it runs, and the
// reduced-motion path (instant). The live frame-by-frame check is
// scripts/verify-stable-toolbar.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOADOUT_MOTION,
  attachLoadoutTransition,
  loadoutKeyframes,
  loadoutSignature,
  makeGhost,
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

  animate(keyframes, options) {
    const animation = { keyframes, options, onfinish: null, oncancel: null, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
    this.animations.push(animation);
    return animation;
  }
}

const el = (tag, attrs, children) => new FakeElement(tag, attrs, children);
const tools = (...labels) => labels.map((label, i) => el('button', { 'aria-label': label, id: `t${i}`, 'data-testid': `tool-${label}`, class: i === 0 ? 'btn btn-active' : 'btn' }));

// A stand-in window: a MutationObserver we fire by hand, a switchable
// reduced-motion preference, and computed visibility from a flag.
const fakeWindow = ({ reduced = false } = {}) => {
  const win = {
    reduced,
    observers: [],
    matchMedia: (query) => ({ matches: query.includes('reduce') && win.reduced }),
    getComputedStyle: (element) => ({ visibility: element.style.visibility === 'hidden' ? 'hidden' : 'visible' }),
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

test('a new set crossfades: the changed tools fade out as a lifeless copy and their replacements fade in; the rule stays', () => {
  const { slot, layer, replace } = setup();
  replace(divider(), host('Rectangle', 'Ellipse', 'Arrow'));
  assert.equal(layer.children.length, 1, 'the outgoing tools are drawn in the ghost layer');
  const ghost = layer.children[0];
  assert.equal(ghost.getAttribute('aria-hidden'), 'true');
  assert.equal(ghost.getAttribute('inert'), '');
  assert.equal(ghost.style.pointerEvents, 'none');
  assert.equal(ghost.getAttribute('data-toolbar-subtools'), null, 'no planner hooks on the copy');
  assert.equal(ghost.getAttribute('style'), 'left: 100%', 'it keeps the slot\'s own placement');
  // The rule is the same control in the same place: its copy only holds its
  // place, and the live rule does not animate.
  assert.equal(ghost.children[0].style.visibility, 'hidden');
  assert.equal(slot.children[0].animations.length, 0);
  for (const button of buttonsIn(ghost)) {
    assert.equal(button.getAttribute('id'), null);
    assert.equal(button.getAttribute('data-testid'), null);
    assert.equal(button.getAttribute('aria-label'), null);
  }
  const [out] = ghost.animations;
  assert.deepEqual(out.keyframes, loadoutKeyframes('out'));
  assert.equal(out.options.duration, LOADOUT_MOTION.outMs);
  // Each new tool fades in on its own, after the old ones have thinned out.
  const arrivals = buttonsIn(slot).map((b) => b.animations[0]);
  assert.equal(arrivals.length, 3);
  for (const arrive of arrivals) {
    assert.deepEqual(arrive.keyframes, loadoutKeyframes('in'));
    assert.equal(arrive.options.duration, LOADOUT_MOTION.inMs);
    assert.equal(arrive.options.delay, LOADOUT_MOTION.inDelayMs);
    assert.equal(arrive.options.fill, 'backwards', 'hidden while it waits');
  }
  // When the old tools' fade ends, their copy is gone.
  out.onfinish();
  assert.equal(layer.children.length, 0);
});

test('row 2: controls that stay the same at the front do not animate; only the new ones arrive', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts —
  // switching Line → Arrow must not slide or double the colours and width.
  const win = fakeWindow();
  const settings = (...extra) => [
    el('div', { 'data-quick-colours': 'true' }, [el('button', { 'aria-label': 'Red' }), el('button', { 'aria-label': 'Custom colour #ff0000' })]),
    divider(),
    el('div', { 'data-toolbar-slot': 'width' }, [el('input', { 'aria-label': 'Width 2 pt' })]),
    ...extra,
  ];
  const holder = el('div', { 'data-chrome-settings-holder': 'true' }, settings(el('div', { 'data-toolbar-slot': 'style' })));
  const layer = el('div');
  attachLoadoutTransition(holder, layer, { win });
  holder.children = [];
  settings(el('div', { 'data-toolbar-slot': 'style' }), el('div', { 'data-toolbar-slot': 'arrowhead' })).forEach((c) => holder.appendChild(c));
  win.flush();
  assert.equal(layer.children.length, 0, 'nothing left: every old control is still there');
  assert.deepEqual(holder.children.map((c) => c.animations.length), [0, 0, 0, 0, 1]);
  assert.equal(holder.children[4].animations[0].options.delay, 0, 'no wait when nothing leaves');
});

test('the motion is quick and subtle: ~140-180ms, a 6px slide, done within 200ms', () => {
  assert.ok(LOADOUT_MOTION.outMs >= 100 && LOADOUT_MOTION.outMs <= 180);
  assert.ok(LOADOUT_MOTION.inMs >= 140 && LOADOUT_MOTION.inMs <= 180);
  assert.ok(LOADOUT_MOTION.inDelayMs + LOADOUT_MOTION.inMs <= 200);
  assert.equal(LOADOUT_MOTION.slidePx, 6);
  assert.match(LOADOUT_MOTION.arriveEasing, /cubic-bezier\(0\.33, 1,/, 'arrivals settle (ease-out)');
  assert.match(LOADOUT_MOTION.leaveEasing, /cubic-bezier\(0\.4, 0, 1, 1\)/, 'departures speed away (ease-in)');
  assert.deepEqual(loadoutKeyframes('in'), [{ opacity: 0, translate: '-6px 0' }, { opacity: 1, translate: '0 0' }]);
  assert.deepEqual(loadoutKeyframes('out'), [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '-6px 0' }]);
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

test('reduced motion: the swap is instant — no copy, no animation', () => {
  const { slot, layer, replace } = setup({ reduced: true });
  replace(divider(), host('Rectangle', 'Ellipse'));
  assert.equal(layer.children.length, 0);
  assert.ok(slot.descendants().every((n) => n.animations.length === 0));
});

test('nothing leaving (Pan → Draw): the rule and tools fade in at once, with no wait', () => {
  const { slot, layer, replace } = setup();
  replace();
  layer.children[0]?.animations[0]?.onfinish();
  replace(divider(), host('Pen', 'Highlighter', 'Eraser'));
  assert.equal(layer.children.length, 0);
  const arrivals = [slot.children[0], ...buttonsIn(slot)].map((n) => n.animations[0]);
  assert.equal(arrivals.length, 4);
  assert.ok(arrivals.every((a) => a && a.options.delay === 0));
});

test('a burst of changes (Draw → Select: tools out, then the modes in) keeps the Draw tools as the ones leaving', () => {
  const { slot, layer, replace } = setup();
  replace(divider(), host());
  replace(divider(), el('div', { 'data-select-mode-toggle': 'true' }, tools('Box', 'Lasso', 'Text')), host());
  assert.equal(layer.children.length, 1, 'one ghost, of the Draw tools');
  assert.deepEqual(buttonsIn(layer.children[0]).length, 3);
  const arrivals = buttonsIn(slot).map((b) => b.animations[0]);
  assert.equal(arrivals.length, 3);
  assert.ok(arrivals.every((a) => a.options.delay === LOADOUT_MOTION.inDelayMs), 'the modes wait for the Draw tools to thin out');
});

test('the set that is leaving comes straight back (Shapes → Pan → Shapes): no copy of itself fades out', () => {
  const { slot, layer, replace } = setup();
  replace();
  assert.equal(layer.children.length, 1, 'the Draw tools start to leave');
  replace(divider(), host('Pen', 'Highlighter', 'Eraser'));
  assert.equal(layer.children.length, 0, 'their copy is dropped at once');
  const arrivals = [slot.children[0], ...buttonsIn(slot)].map((n) => n.animations[0]);
  assert.ok(arrivals.every((a) => a && a.options.delay === 0), 'and they ease straight back in');
});

test('a slot hidden (row 2 leaving) holds its last set while the row fades; shown again, it just stays', () => {
  const { slot, layer, win } = setup();
  slot.style.visibility = 'hidden';
  win.flush();
  assert.equal(layer.children.length, 1, 'the last set is held');
  const [hold] = layer.children[0].animations;
  assert.deepEqual(hold.keyframes, [{ opacity: 1 }, { opacity: 1 }], 'no second fade on top of the row\'s own');
  assert.equal(hold.options.duration, LOADOUT_MOTION.rowOutMs);
  assert.ok(slot.descendants().every((n) => n.animations.length === 0), 'nothing arrives into a hidden slot');
  slot.style.visibility = '';
  slot.appendChild(el('button', { 'aria-label': 'Solid' }));
  win.flush();
  assert.equal(layer.children.length, 0, 'wanted again: the held copy goes, the row\'s own fade covers the rest');
  assert.ok(slot.descendants().every((n) => n.animations.length === 0));
});

test('detaching stops watching and clears any copy', () => {
  const { layer, win, detach, replace } = setup();
  replace(host('Rectangle'));
  assert.equal(layer.children.length, 1);
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

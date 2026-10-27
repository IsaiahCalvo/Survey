// Owner 2026-10-27: "when I put something in selection mode and the loadout
// changes to show all the duplicate, move, copy, share, and delete options,
// when I hit Done, it doesn't properly retract that loadout or change the
// loadout back to what it was before. It looks a little off."
//
// Frame captures of the real app showed why: a list header's select row was
// paired with its old set slot by slot, and the copy of the old row was laid
// at the top-left of the header's (now narrower) box, so on Done it slid
// right and was cut off by the panel edge (Projects, Templates) or dropped 6px
// (Documents); Select jumped to the start of the row as it turned into Done;
// and the phone's flattened select row (display: contents) read as "hidden",
// flashing a copy of Select over the menu button. This pins the fix in
// src/utils/loadoutTransition.js on a tiny stand-in DOM. The tool bar's own
// rules stay in tests/loadoutTransition.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachLoadoutTransition, pairLoadoutUnits } from '../src/utils/loadoutTransition.js';

class Node {
  constructor(tag, attrs = {}, children = [], box = null) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.box = box;
    this.animations = [];
    for (const child of children) this.appendChild(child);
  }

  get tagName() { return this.tag.toUpperCase(); }

  get isConnected() { return true; }

  get attributes() { return Object.keys(this.attrs).map((name) => ({ name })); }

  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }

  setAttribute(name, value) { this.attrs[name] = String(value); }

  removeAttribute(name) { delete this.attrs[name]; }

  appendChild(child) { child.parentNode?.removeChild?.(child); child.parentNode = this; this.children.push(child); return child; }

  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; }

  remove() { this.parentNode?.removeChild(this); }

  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }

  querySelectorAll(selector) {
    const all = this.descendants();
    return selector === '*' ? all : all.filter((n) => n.tag === 'button');
  }

  querySelector(selector) {
    const all = this.descendants();
    if (selector === 'button') return all.find((n) => n.tag === 'button') || null;
    if (selector === '[data-morph-icon]') return all.find((n) => n.getAttribute('data-morph-icon') !== null) || null;
    if (selector.startsWith('svg')) return all.find((n) => n.tag === 'svg') || null;
    return null;
  }

  closest() {
    for (let n = this; n; n = n.parentNode) if (n.getAttribute?.('data-loadout-ignore') !== null) return n;
    return null;
  }

  matches(selector) { return selector === 'button' ? this.tag === 'button' : ['button', 'input'].includes(this.tag); }

  cloneNode() {
    const copy = new Node(this.tag, this.attrs, this.children.map((c) => c.cloneNode(true)), this.box);
    copy.style = { ...this.style };
    return copy;
  }

  getClientRects() { return [{}]; }

  // A placed copy draws at its own left / top (its holder sits at 0, 0);
  // anything else where the test laid it out.
  getBoundingClientRect() {
    const box = this.box || { left: 0, top: 0, width: 28, height: 28 };
    if (this.style.position === 'absolute') return { ...box, left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0 };
    return box;
  }

  animate(keyframes, options) {
    const animation = {
      keyframes, options, cancelled: false, progress: 0,
      effect: { getComputedTiming: () => ({ progress: animation.progress }) },
      cancel() { this.cancelled = true; this.oncancel?.(); },
    };
    this.animations.push(animation);
    return animation;
  }
}

const at = (left, top = 100) => ({ left, top, width: 28, height: 28 });
const icon = (action, label, x, morph) => new Node('button', {
  'data-section-action': action, 'aria-label': label, ...(morph ? { 'data-morph-icon': morph } : {}),
}, [new Node('svg')], at(x));

const fakeWindow = (styles = new Map()) => {
  const win = {
    observers: [],
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (n) => ({ display: styles.get(n) || 'flex', visibility: 'visible', color: 'rgb(1, 2, 3)' }),
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; win.observers.push(this); }

      observe() {}

      disconnect() {}
    },
    flush: () => win.observers.forEach((o) => o.callback([])),
  };
  return win;
};

const doc = { createElement: (tag) => new Node(tag), createElementNS: (_ns, tag) => new Node(tag) };

// The Projects header: "+ New project" on the left, [Select] at the right end.
// In select mode: [Done][All][Duplicate][Share][Delete], right-aligned.
const browse = () => [
  new Node('button', { class: 'btn primary', 'aria-label': 'New project' }, [], { left: 20, top: 100, width: 100, height: 28 }),
  new Node('div', { class: 'hub-select-actions' }, [icon('select', 'Select', 300, 'listChecks')]),
];
const selecting = () => [new Node('div', { class: 'hub-select-actions' }, [
  icon('select', 'Done', 180, 'checkCheck'), icon('all', 'Select all', 210), icon('duplicate', 'Duplicate', 240),
  icon('share', 'Share', 270), icon('delete', 'Delete', 300),
])];

const setup = (children, styles) => {
  const win = fakeWindow(styles);
  const head = new Node('div', { class: 'hub-section-head' }, children);
  const layer = new Node('span', { 'data-loadout-ignore': '' }, [], { left: 0, top: 0, width: 0, height: 0 });
  layer.ownerDocument = doc;
  head.appendChild(layer);
  attachLoadoutTransition(head, layer, { win });
  const replace = (next) => {
    head.children = [];
    [...next, layer].forEach((c) => head.appendChild(c));
    win.flush();
  };
  return { head, layer, replace, win };
};

const ghostUnits = (layer) => layer.children.filter((c) => c.getAttribute('data-loadout-ghost') !== null).flatMap((g) => g.children);
const centre = (n) => { const b = n.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };

test('a list header pairs its controls by what they are: Select with Done, never Add with All', () => {
  const unit = (key, sig) => ({ key, sig });
  const { keyed, pairs } = pairLoadoutUnits(
    [unit('select', 'Select'), unit('add', 'Add')],
    [unit('select', 'Done'), unit('all', 'All'), unit('delete', 'Delete')],
  );
  assert.equal(keyed, true);
  assert.deepEqual(pairs.map(({ b, a, id }) => [b, a, id]), [[0, 0, 'select'], [-1, 1, 'all'], [-1, 2, 'delete'], [1, -1, 'add']]);
  // A control with no key stays only when the very same one is in both sets.
  const label = pairLoadoutUnits([unit(null, 'Entities'), unit('select', 'Select')], [unit('select', 'Done')]);
  assert.deepEqual(label.pairs.map(({ b, a, kind }) => [b, a, kind]), [[1, 0, 'swap'], [0, -1, 'shrink']]);
});

test('the tool bar (no keys) still pairs slot 1 with slot 1', () => {
  const { keyed, pairs } = pairLoadoutUnits([{ sig: 'a' }, { sig: 'b' }], [{ sig: 'c' }]);
  assert.equal(keyed, false);
  assert.deepEqual(pairs.map(({ b, a, id }) => [b, a, id]), [[0, 0, 0], [1, -1, 1]]);
});

test('Done: each leaving control shrinks out exactly where it was drawn, not shifted by the shorter row', () => {
  const { layer, replace } = setup(selecting());
  replace(browse());
  const ghosts = ghostUnits(layer);
  // Done (moved), All, Duplicate, Share, Delete all leave from their own spots.
  assert.equal(ghosts.length, 5);
  assert.deepEqual(ghosts.map((g) => centre(g)), [[194, 114], [224, 114], [254, 114], [284, 114], [314, 114]]);
  for (const g of ghosts) {
    assert.deepEqual(g.animations[0].keyframes, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.6' }]);
    assert.equal(g.getAttribute('aria-hidden'), null, 'the copy is inside a hidden holder');
    assert.equal(g.getAttribute('data-section-action'), null, 'no hook a selector could find');
  }
  assert.equal(layer.children.find((c) => c.getAttribute('data-loadout-ghost') !== null).style.position, 'fixed', 'no scrolling row clips it');
});

test('Done: the gold button comes back growing in, and Select grows in at its spot instead of jumping across the row', () => {
  const { head, replace } = setup(selecting());
  replace(browse());
  const [newProject, actions] = head.children;
  assert.deepEqual(newProject.animations[0].keyframes, [{ opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1' }]);
  const select = actions.children[0];
  assert.deepEqual(select.animations.map((a) => a.keyframes[0]), [{ opacity: 0, scale: '0.6' }], 'grows; no sideways glide');
});

test('Select: the gold button shrinks out where it was while the select row grows in', () => {
  const { head, layer, replace } = setup(browse());
  replace(selecting());
  const ghosts = ghostUnits(layer);
  assert.deepEqual(ghosts.map((g) => centre(g)).sort((p, q) => p[0] - q[0]), [[70, 114], [314, 114]], 'New project and the old Select');
  const live = head.children[0].children;
  assert.ok(live.every((b) => b.animations[0]?.keyframes[0].scale === '0.6'), 'every select-row control grows in');
});

test('a toggle that keeps its spot (Documents, the phone) morphs in place', () => {
  const { head, layer, replace } = setup([icon('select', 'Select', 300, 'listChecks')]);
  replace([icon('select', 'Done', 300, 'checkCheck'), icon('all', 'Select all', 330)]);
  assert.equal(layer.children.filter((c) => c.getAttribute('data-loadout-morph') === 'checkCheck').length, 1);
  assert.equal(ghostUnits(layer).length, 0, 'nothing leaves');
  assert.equal(head.children[0].animations.length, 0, 'Done itself does not grow');
});

test('a select row flattened with display: contents (the phone header) is still on screen: no copy of it is held', () => {
  const styles = new Map();
  const { head, layer, replace, win } = setup([icon('select', 'Select', 300, 'listChecks')], styles);
  styles.set(head, 'contents');
  void win;
  replace([icon('select', 'Done', 300, 'checkCheck'), icon('all', 'Select all', 30)]);
  assert.equal(layer.children.filter((c) => c.getAttribute('data-loadout-ghost') !== null).length, 0, 'no stray copy of Select');
  assert.equal(layer.children.filter((c) => c.getAttribute('data-loadout-morph') !== null).length, 1, 'Select morphs into Done');
});

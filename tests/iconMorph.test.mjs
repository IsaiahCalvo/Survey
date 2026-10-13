// RULED 2026-09-27 owner: morphing icons + one motion language (w49).
// "When switching between annotation tool groups, loadout slots should MORPH
// icon-to-icon in place: slot 1 is pen (Draw) / rectangle (Shapes) / text box
// (Text); slot 2 highlighter / ellipse / callout; etc." This pins
// src/utils/iconMorph.js: the glyph data is the icon set's own geometry (and
// stays in step with it), a morph starts exactly on the old icon and lands
// exactly on the new one, the pieces even up, and the motion helpers behave.
// The live frame-by-frame check is scripts/verify-stable-toolbar.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MORPH_ICONS, MORPH_SAMPLES, cubicBezier, flattenPath, iconPolylines, isMorphableIcon, mixColour,
  morphFrame, parseTransform, planMorph, resample,
} from '../src/utils/iconMorph.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();
const sourceOf = (name) => squash(readFileSync(resolve(root, MORPH_ICONS[name].source), 'utf8'));

// The loadouts, slot by slot (Draw, Shapes, Text, Select).
const SLOTS = [
  ['pen', 'rect', 'textBox', 'selectCursor'],
  ['highlighter', 'ellipse', 'callout', 'lassoSelect'],
  ['eraser', 'polygon', 'textSelect'],
];

test('every tool that can share a slot with another group\'s tool can morph', () => {
  for (const slot of SLOTS) for (const name of slot) assert.ok(isMorphableIcon(name), name);
  assert.equal(isMorphableIcon('counter'), false, 'the counter (filled, only ever in Shapes) grows / shrinks instead');
  assert.equal(isMorphableIcon(undefined), false);
});

test('the morph data is the icon set\'s own geometry, verbatim — redraw an icon and this fails until the copy is updated', () => {
  for (const [name, icon] of Object.entries(MORPH_ICONS)) {
    const source = sourceOf(name);
    if (icon.transform && !/rotate/.test(icon.transform) && name !== 'highlighter') {
      assert.ok(source.includes(icon.transform), `${name}: transform ${icon.transform} is in ${icon.source}`);
    }
    for (const path of icon.paths) {
      if (path.transform) assert.ok(source.includes(path.transform), `${name}: ${path.transform}`);
      if (path.rect) {
        const [x, y, w, h, r] = path.rect;
        assert.ok(new RegExp(`x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"`).test(source), `${name}: rect ${path.rect}`);
      } else if (path.circle) {
        const [cx, cy, r] = path.circle;
        assert.ok(source.includes(`cx="${cx}" cy="${cy}" r="${r}"`), `${name}: circle ${path.circle}`);
      } else if (path.node) {
        assert.ok(source.includes(`[${path.node[0]}, ${path.node[1]}]`), `${name}: node ${path.node}`);
      } else if (path.line) {
        const [x1, y1, x2, y2] = path.line;
        assert.ok(source.includes(`x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`), `${name}: line ${path.line}`);
      } else {
        assert.ok(source.includes(squash(path.d)), `${name}: path ${path.d.slice(0, 40)}… is in ${icon.source}`);
      }
      // An SVG asset spells its dash as an attribute; the Areas tool glyphs
      // (utils/areaToolGlyphs.js, owner 2026-10-02) keep theirs as data.
      if (path.dash) {
        assert.ok(
          source.includes(`stroke-dasharray="${path.dash.join(' ')}"`) || source.includes(`dasharray: '${path.dash.join(' ')}'`),
          `${name}: dash`,
        );
      }
    }
  }
  // The transforms the morph bakes in that come from elsewhere.
  const icons = squash(readFileSync(resolve(root, 'src/Icons.jsx'), 'utf8'));
  assert.ok(icons.includes("transform: 'rotate(270deg)'") && icons.includes('rotate(-45 12 12)'), 'eraser rotations');
  assert.ok(icons.includes('ICON_NODE_RADIUS = 2'), 'polygon node radius');
  assert.ok(sourceOf('highlighter').includes('viewBox="0 0 128 128"'), 'highlighter is on a 128 grid (scale 0.1875 → 24)');
  assert.ok(icons.includes('translateY(2px)'), 'text select sits 2px low');
});

const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const dense = (name) => iconPolylines(name).flatMap((piece) => resample(piece.pts, 400));
const onInk = (points, ink, tol) => points.every((p) => ink.some((q) => near(p, q) < tol));

test('a morph starts exactly on the old icon and lands exactly on the new one, for every pair that can share a slot', () => {
  for (const slot of SLOTS) {
    for (const from of slot) {
      for (const to of slot) {
        if (from === to) continue;
        const pairs = planMorph(from, to);
        assert.ok(pairs.length >= Math.max(iconPolylines(from).length, iconPolylines(to).length), `${from}→${to}: pieces even up`);
        for (const pair of pairs) {
          assert.equal(pair.a.length, MORPH_SAMPLES);
          assert.equal(pair.b.length, MORPH_SAMPLES);
        }
        const start = morphFrame(pairs, 0).flatMap((f) => f.pts);
        const end = morphFrame(pairs, 1).flatMap((f) => f.pts);
        assert.ok(onInk(start, dense(from), 0.12), `${from}→${to}: frame 0 lies on the ${from} icon`);
        assert.ok(onInk(end, dense(to), 0.12), `${from}→${to}: the last frame lies on the ${to} icon`);
        // …and covers all of it (no piece of the icon missing at either end).
        assert.ok(onInk(dense(from), start, 1.2), `${from}→${to}: frame 0 draws all of ${from}`);
        assert.ok(onInk(dense(to), end, 1.2), `${from}→${to}: the last frame draws all of ${to}`);
        // Every frame in between is drawable.
        for (const t of [0.25, 0.5, 0.75]) {
          for (const piece of morphFrame(pairs, t)) assert.ok(piece.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
        }
      }
    }
  }
});

test('the glyphs sit on the 24-unit box the icons are drawn in', () => {
  for (const name of Object.keys(MORPH_ICONS)) {
    const pts = iconPolylines(name).flatMap((p) => p.pts);
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    assert.ok(Math.min(...xs) >= 1.5 && Math.max(...xs) <= 22.5, `${name} x`);
    assert.ok(Math.min(...ys) >= 1.5 && Math.max(...ys) <= 22.5, `${name} y`);
  }
  // DELIBERATE ASSERTION CHANGE (2026-10-02, Select-trio optical balance):
  // textSelect used to carry a fixed CSS translateY(2px), so its morph copy was
  // drawn 3 units low on a 16px glyph and this test pinned that. The drop is
  // now part of the asset's own drawing (it scales with the glyph instead of
  // being 4 units at the 12px phone strip), so the copy sits on the 24 box at
  // every size, like every other glyph.
  const at16 = iconPolylines('textSelect', { glyphPx: 16 }).flatMap((p) => p.pts);
  const at12 = iconPolylines('textSelect', { glyphPx: 12 }).flatMap((p) => p.pts);
  assert.deepEqual(at16, at12, 'textSelect sits in the same place at every glyph size');
});

test('the lasso\'s dashes open from nothing and close to nothing — never pop', () => {
  const pairs = planMorph('callout', 'lassoSelect');
  const dashed = (t) => morphFrame(pairs, t).filter((f) => f.dash);
  assert.equal(dashed(0).length, 0, 'solid at the callout end');
  assert.ok(dashed(1).length >= 1, 'dashed at the lasso end');
  const gaps = [0.2, 0.5, 0.8, 1].map((t) => Math.max(...dashed(t).map((f) => Number(f.dash.split(' ')[1]))));
  assert.ok(gaps.every((g, i) => i === 0 || g > gaps[i - 1]), `gaps open steadily ${gaps}`);
  assert.equal(gaps[3], 2.1);
});

test('w49 review: the lasso\'s dashed arc is never cut or run backwards, so its dashes land exactly on the real icon\'s', () => {
  const [arc] = iconPolylines('lassoSelect').filter((p) => p.dash);
  for (const from of ['highlighter', 'ellipse', 'callout']) {
    const pairs = planMorph(from, 'lassoSelect');
    const dashed = pairs.filter((p) => p.dashB);
    assert.equal(dashed.length, 1, `${from}→lasso: one dashed piece`);
    const end = dashed[0].b;
    assert.ok(Math.hypot(end[0][0] - arc.pts[0][0], end[0][1] - arc.pts[0][1]) < 1e-6, `${from}→lasso: the arc starts where the icon's does`);
    const last = arc.pts[arc.pts.length - 1];
    assert.ok(Math.hypot(end.at(-1)[0] - last[0], end.at(-1)[1] - last[1]) < 1e-6, `${from}→lasso: and ends where it does`);
    const back = planMorph('lassoSelect', from).filter((p) => p.dashA);
    assert.equal(back.length, 1);
    assert.ok(Math.hypot(back[0].a[0][0] - arc.pts[0][0], back[0].a[0][1] - arc.pts[0][1]) < 1e-6, `lasso→${from}: starts on the icon's own dashes`);
  }
});

test('path parsing and transforms: arcs, relative commands, rotate about a point', () => {
  const [square] = flattenPath('M0 0h10v10h-10z');
  assert.equal(square.closed, true);
  assert.deepEqual(square.pts.at(-1), [0, 0]);
  const [arc] = flattenPath('M0 5A5 5 0 0 1 10 5');
  const mid = arc.pts[Math.floor(arc.pts.length / 2)];
  assert.ok(Math.abs(Math.hypot(mid[0] - 5, mid[1] - 5) - 5) < 1e-6, 'on the circle');
  assert.ok(mid[1] < 5, 'sweep 1 goes over the top');
  const m = parseTransform('rotate(90 12 12)');
  const [x, y] = [m[0] * 12 + m[2] * 0 + m[4], m[1] * 12 + m[3] * 0 + m[5]];
  assert.ok(Math.abs(x - 24) < 1e-9 && Math.abs(y - 12) < 1e-9);
  const subs = flattenPath('M9 6V18M9 6C9 4.89543 9.89543 4 11 4');
  assert.equal(subs.length, 2, 'each M starts a new piece');
});

test('easing and colour helpers', () => {
  const ease = cubicBezier(0.45, 0, 0.55, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(Math.abs(ease(0.5) - 0.5) < 1e-3, 'symmetric ease-in-out');
  assert.ok(ease(0.1) < 0.1 && ease(0.9) > 0.9, 'slow at both ends');
  assert.equal(mixColour('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 0.5), 'rgba(100, 50, 25, 1)');
  assert.equal(mixColour(null, 'rgb(1, 2, 3)', 0.2), 'rgb(1, 2, 3)');
});

test('a plan is worked out once per pair, then reused', () => {
  const first = planMorph('pen', 'textBox');
  assert.equal(planMorph('pen', 'textBox'), first, 'cached');
});

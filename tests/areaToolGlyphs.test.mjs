// Owner 2026-10-02: the Spaces Areas tools get their own icons (provisional
// picks: Hugeicons Select 01 for Rectangle area, "F1" for Freehand area),
// kept in ONE place (src/utils/areaToolGlyphs.js) so a later pick is a
// one-file swap. Desktop tool bar, phone rail and the tool-group morph all
// read them from there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREA_TOOL_GLYPHS, AREA_TOOL_STROKE_WIDTH } from '../src/utils/areaToolGlyphs.js';
import { MORPH_ICONS, iconPolylines, planMorph, morphFrame, resample } from '../src/utils/iconMorph.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('one source: Icons.jsx and the morph read the glyphs from areaToolGlyphs.js', () => {
  const icons = read('src/Icons.jsx');
  assert.match(icons, /import \{ AREA_TOOL_GLYPHS, AREA_TOOL_STROKE_WIDTH \} from '\.\/utils\/areaToolGlyphs\.js';/);
  assert.match(icons, /areaRect: \(size, color, style, className\) => renderAreaToolGlyph\('areaRect'/);
  assert.match(icons, /areaFreehand: \(size, color, style, className\) => renderAreaToolGlyph\('areaFreehand'/);
  for (const name of ['areaRect', 'areaFreehand']) {
    assert.equal(MORPH_ICONS[name].transform, AREA_TOOL_GLYPHS[name].transform);
    assert.deepEqual(MORPH_ICONS[name].paths.map((p) => p.d), AREA_TOOL_GLYPHS[name].paths.map((p) => p.d));
    // No path text anywhere else.
    for (const path of AREA_TOOL_GLYPHS[name].paths.slice(1)) {
      assert.ok(!icons.includes(path.d), `${name}: no copy in Icons.jsx`);
      assert.ok(!read('src/utils/iconMorph.js').includes(path.d), `${name}: no copy in iconMorph.js`);
    }
  }
});

test('the tool bar and the phone rail use them', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /tool\('rectangle', 'Rectangle area', 'areaRect'/);
  assert.match(shell, /tool\('freehand', 'Freehand area', 'areaFreehand'/);
  const phone = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(phone, /icon="areaRect"[\s\S]{0,80}label="Rectangle area"[\s\S]{0,40}data-morph-icon="areaRect"/);
  assert.match(phone, /icon="areaFreehand"[\s\S]{0,80}label="Freehand area"[\s\S]{0,40}data-morph-icon="areaFreehand"/);
});

test('optical balance: house stroke, a 20-unit box centred on the grid', () => {
  for (const [name, glyph] of Object.entries(AREA_TOOL_GLYPHS)) {
    const scale = Number(glyph.transform.match(/scale\(([\d.]+)\)/)[1]);
    assert.ok(Math.abs(AREA_TOOL_STROKE_WIDTH * scale - 1.5) < 0.01, `${name}: stroke resolves to 1.5`);
    const pts = iconPolylines(name).flatMap((p) => p.pts);
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const [w, h] = [Math.max(...xs) - Math.min(...xs) + 1.5, Math.max(...ys) - Math.min(...ys) + 1.5];
    const [cx, cy] = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
    assert.ok(w >= 19 && w <= 20.5 && h >= 18.5 && h <= 20.5, `${name}: ink ${w.toFixed(1)} x ${h.toFixed(1)}`);
    assert.ok(Math.abs(cx - 12) < 0.35 && Math.abs(cy - 12) < 0.35, `${name}: centred (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
  }
});

test('they morph cleanly to and from the Select glyphs that share their slots', () => {
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const dense = (name) => iconPolylines(name).flatMap((piece) => resample(piece.pts, 400));
  const onInk = (points, ink, tol) => points.every((p) => ink.some((q) => near(p, q) < tol));
  for (const [from, to] of [['selectCursor', 'areaRect'], ['lassoSelect', 'areaFreehand'], ['areaRect', 'rect'], ['areaFreehand', 'pen']]) {
    const pairs = planMorph(from, to);
    assert.ok(onInk(morphFrame(pairs, 0).flatMap((f) => f.pts), dense(from), 0.12), `${from}→${to} starts on ${from}`);
    assert.ok(onInk(morphFrame(pairs, 1).flatMap((f) => f.pts), dense(to), 0.12), `${from}→${to} lands on ${to}`);
  }
});

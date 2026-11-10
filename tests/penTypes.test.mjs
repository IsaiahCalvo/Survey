// Nightly 'pen-types': Drawboard's Basic / Pro / Calligraphy pens
// (endings-and-pens.md, pdf.drawboard.com 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PEN_TYPES,
  activePenType,
  calligraphyFactor,
  penWidthFactors,
  proPressureFactor,
  proSpeedFactor,
} from '../src/utils/penTypes.js';
import { directVariableRing, variableWidthPolygon } from '../src/utils/penWidthInk.js';
import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test("three pens with Drawboard's names; Basic is the default and the flag is beta", () => {
  assert.deepEqual(PEN_TYPES.map((t) => `${t.label}: ${t.sub}`), ['Basic: Fixed width', 'Pro: Variable width', 'Calligraphy: Dynamic width']);
  assert.equal(activePenType(), 'basic');
  assert.equal(FEATURE_FLAGS['pen-types']?.stage, 'beta');
});

test('Pro with a pen follows the measured pressure curve', () => {
  assert.equal(proPressureFactor(0.05), 0.5);
  assert.ok(near(proPressureFactor(0.13), 0.75));
  assert.equal(proPressureFactor(0.27), 1);
  assert.equal(proPressureFactor(0.9), 1);
  assert.ok(proPressureFactor(0.2) > 0.75 && proPressureFactor(0.2) < 1);
});

test('Pro with a mouse: slow is full width, fast is half, a short taper at the start', () => {
  assert.equal(proSpeedFactor(0.05), 1);
  assert.equal(proSpeedFactor(5), 0.5);
  const slow = Array.from({ length: 60 }, (_, i) => ({ x: i * 0.5, y: 0, t: i * 10 }));
  const f = penWidthFactors(slow, 'pro', 2);
  assert.ok(f[0] <= 0.51, 'starts thin');
  assert.ok(f[59] > 0.98, 'slow movement is full width');
  const fast = Array.from({ length: 60 }, (_, i) => ({ x: i * 5, y: 0, t: i }));
  assert.ok(penWidthFactors(fast, 'pro', 2)[59] < 0.55, 'fast movement is about half');
});

test('Calligraphy: down 1.75w, down-right 1.2w, down-left 0.75w, sideways and up 0.5w', () => {
  assert.ok(near(calligraphyFactor(90), 1.75));
  assert.ok(near(calligraphyFactor(45), 1.2));
  assert.ok(near(calligraphyFactor(135), 0.75));
  assert.equal(calligraphyFactor(0), 0.5);
  assert.equal(calligraphyFactor(180), 0.5);
  for (const up of [200, 270, 315, -45]) assert.equal(calligraphyFactor(up), 0.5);
  const down = Array.from({ length: 40 }, (_, i) => ({ x: 0, y: i }));
  const across = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 0 }));
  assert.ok(near(penWidthFactors(down, 'calligraphy', 2)[39], 1.75, 1e-3));
  assert.ok(near(penWidthFactors(across, 'calligraphy', 2)[39], 0.5, 1e-3));
  assert.equal(penWidthFactors(down, 'basic', 2), null);
});

test('the variable outline is one clean ring that covers each point at its own radius', () => {
  const pts = Array.from({ length: 30 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 5) * 6 }));
  const radii = pts.map((_, i) => 0.5 + i * 0.1);
  const ring = directVariableRing(pts, radii);
  assert.ok(ring, 'a smooth stroke makes a direct ring');
  // Every ring point sits within its nearest circle's reach.
  for (const [x, y] of ring) {
    const reach = Math.min(...pts.map((p, i) => Math.hypot(x - p.x, y - p.y) - radii[i]));
    assert.ok(reach < 0.05, `ring point stays on the stroke edge (${reach})`);
  }
  // A tight hairpin falls back to the capsule union and still covers both ends.
  const hairpin = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0.5, y: 0.6 }];
  const set = variableWidthPolygon(hairpin, [2, 3, 2]);
  assert.ok(set.length >= 1 && set[0][0].length > 8);
});

test('a Pro or Calligraphy pen commit stores its width factors; Basic and the highlighter do not', () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ x: 10, y: 10 + i * 2 }));
  const common = { id: 'p1', points, strokeColor: '#ff0000', strokeOpacity: 100, strokeWidth: 4 };
  const cal = buildFreehandCommitJSON({ ...common, tool: 'pen', penType: 'calligraphy' });
  assert.equal(cal.data.penType, 'calligraphy');
  assert.equal(cal.data.penWidths.length, cal.paperCenterline.length);
  assert.ok(cal.data.penWidths.at(-1) > 1.7, 'a downward stroke is thick');
  assert.ok(cal.paperCenterline.every((p) => Object.keys(p).sort().join() === 'x,y'), 'no pointer data saved');
  const xs = cal.polygons.flat(2).map(([x]) => x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 4 * 1.6, 'the ink is wider than the plain width');
  const basic = buildFreehandCommitJSON({ ...common, tool: 'pen' });
  assert.equal(basic.data.penWidths, undefined);
  assert.equal(basic.data.penType, undefined);
  const hl = buildFreehandCommitJSON({ ...common, tool: 'highlighter', highlightColor: '#ff0', penType: 'calligraphy' });
  assert.equal(hl.data.penWidths, undefined);
});

test('wired: the layer passes the pen type, width restyle keeps the factors, both pickers sit behind the flag', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /penType: activePenType\(\),/);
  assert.match(layer, /variablePenRef\.current = tool === 'pen' && activePenType\(\) !== 'basic';/);
  assert.match(read('src/utils/selectionRestyle.js'), /createVariableInk\(annotation\.paperCenterline, penWidths/);
  assert.match(read('src/AppShell.jsx'), /isFeatureOn\('pen-types'\) && bottomToolbarApi\.activeTool === 'pen' && toolbarSlot\('pen'/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /isFeatureOn\('pen-types'\) && \(\s*<SheetSection>\s*<PenTypeTiles/);
  assert.match(read('supabase/migrations/20261110150000_pen_types_flag.sql'), /'pen-types', 'off'/);
});

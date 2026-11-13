// Nightly 'equation-tool' (Drawboard Insert > Equation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import {
  applyEquationEdit, EQUATION_COLORS, EQUATION_DEFAULT_COLOR, EQUATION_EX_PX, EQUATION_RASTER_MAX_PX,
  equationItem, equationRasterSize, equationSvgSize, isEquationMark, selectedEquationOf, sizedEquationSvg,
} from '../src/utils/equation.js';
import { texToSvg } from '../src/utils/equationRender.js';
import { planSelectionQuickBar } from '../src/utils/selectionQuickBar.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('equation-tool is a Nightly beta flag with a seeded off row', () => {
  assert.equal(FEATURE_FLAGS['equation-tool']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261113190000_drawboard_tool_flags.sql'), /\('equation-tool', 'off'/);
});

test('LaTeX becomes MathJax SVG paths; a typing mistake is an error', () => {
  const svg = texToSvg('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
  assert.match(svg, /^<svg\b/);
  assert.doesNotMatch(svg, /<text\b|<use\b|href=/, 'plain paths only: nothing to fetch, nothing to link');
  const size = equationSvgSize(svg);
  assert.ok(size.width > size.height && size.height > 2 * EQUATION_EX_PX);
  assert.throws(() => texToSvg('\\frac{1}{'), /close brace/i);
  assert.throws(() => texToSvg('   '), /Type an equation/);
});

test('the SVG is sized in px and painted in the chosen colour', () => {
  const svg = '<svg style="vertical-align: -1ex;" xmlns="http://www.w3.org/2000/svg" width="10ex" height="2ex" viewBox="0 0 1 1"><g/></svg>';
  assert.deepEqual(equationSvgSize(svg), { width: 10 * EQUATION_EX_PX, height: 2 * EQUATION_EX_PX });
  const sized = sizedEquationSvg(svg, { width: 360, height: 72, color: EQUATION_COLORS[2].hex });
  assert.match(sized, /^<svg width="360" height="72" style="color:#D0021B"/);
  assert.doesNotMatch(sized, /ex"|vertical-align/);
  assert.match(sizedEquationSvg(svg, { width: 1, height: 1, color: 'url(x)' }), /color:#000000/, 'only the listed colours');
  const big = equationRasterSize(1000, 100);
  assert.equal(big.width, EQUATION_RASTER_MAX_PX);
});

test('the equation lands as a picture mark that keeps its LaTeX', () => {
  const item = equationItem({ src: PNG, pixelWidth: 120, pixelHeight: 40, tex: 'E = mc^2', color: EQUATION_COLORS[1].hex });
  const object = item.payload.items[0].object;
  assert.ok(isEquationMark(object));
  assert.equal(object.data.equation.tex, 'E = mc^2');
  assert.deepEqual(selectedEquationOf(object, 'e1'), { id: 'e1', tex: 'E = mc^2', color: EQUATION_COLORS[1].hex });
  assert.equal(equationItem({ src: 'javascript:alert(1)', pixelWidth: 1, pixelHeight: 1, tex: 'x' }), null);
});

test('an edit keeps how much the equation was resized', () => {
  const object = equationItem({ src: PNG, pixelWidth: 120, pixelHeight: 40, tex: 'a', color: EQUATION_DEFAULT_COLOR }).payload.items[0].object;
  const grown = { ...object, width: object.width * 2, height: object.height * 2, left: 30, top: 40 };
  const edited = applyEquationEdit(grown, { src: PNG, pixelWidth: 240, pixelHeight: 40, tex: 'abc', color: EQUATION_DEFAULT_COLOR });
  assert.equal(edited.left, 30);
  assert.equal(edited.top, 40);
  assert.ok(Math.abs(edited.width - grown.width * 2) < 0.02, 'twice as long, at the same zoom-in');
  assert.ok(Math.abs(edited.height - grown.height) < 0.02);
  assert.equal(edited.data.equation.tex, 'abc');
});

test('toolbar, phone rail and picked bar are wired', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /equationToolEnabled \? \[\{ id: 'equation', label: 'Equation', iconName: 'equation', action: 'equation' \}\]/);
  assert.match(viewer, /if \(t\.action === 'equation'\) \{[\s\S]{0,300}EQUATION_OPEN_EVENT/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'equation', label: 'Equation', icon: 'equation', flag: 'equation-tool', action: 'equation' \}/);
  const api = { selectedEquation: { id: 'e1', tex: 'x', color: EQUATION_DEFAULT_COLOR }, editSelectedEquation: () => {} };
  assert.equal(planSelectionQuickBar({ items: [{ id: 'e1', typeKey: 'image' }], api }).equation, true);
  assert.equal(planSelectionQuickBar({ items: [{ id: 'e1', typeKey: 'image' }], api, locked: true }).equation, undefined);
  // MathJax only loads when the card opens.
  assert.match(read('src/components/EquationHost.jsx'), /const loadRenderer = \(\) => import\('\.\.\/utils\/equationRender\.js'\);/);
  assert.doesNotMatch(viewer, /equationRender/);
});

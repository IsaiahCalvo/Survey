import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/Icons.jsx', import.meta.url), 'utf8');

// 2026-09-07 polish pass: the top toolbar row (Pan / Select / Draw / Shapes /
// Text) must sit on ONE baseline. It did not: drawGroup carried
// translateY(-2px) and text carried translateY(2px), which put a 4.0px spread
// between the glyph bbox centres (measured 1x and 2x) where plain main had
// 0.25px. Both assets are already centred on their own painted ink, so the
// correct fix is no nudge at all — these assertions replace the old ones that
// REQUIRED the nudges.
const renderer = (name) => {
  const i = source.indexOf(`${name}: (size, color, style, className)`);
  assert.notEqual(i, -1, `renderer ${name} not found`);
  const j = source.indexOf('\n    ),', i);
  const k = source.indexOf('\n', i + 1);
  return source.slice(i, j === -1 ? k + 400 : j);
};

test('top toolbar group glyphs carry no translateY optical nudge', () => {
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner ruling): the Text
  // group's glyph is Lucide scan-text, so the renderer to read is `scanText`;
  // `textGroup` is the alias that points at it. The rule is unchanged — no group
  // glyph in the tool cluster may be nudged off its own ink centre.
  assert.match(source, /textGroup: 'scanText',/);
  for (const name of ['drawGroup', 'scanText', 'shapes']) {
    assert.doesNotMatch(
      renderer(name),
      /translateY\(/,
      `${name} must stay centred on its ink bbox, not nudged`,
    );
  }
});

test('no glyph in the set carries a translateY nudge — text-select included', () => {
  // DELIBERATE ASSERTION CHANGE (2026-10-02, Select-trio optical balance; owner:
  // "Lasso looks smaller than Rectangular, Text Select looks even smaller").
  // This test used to REQUIRE textSelect's translateY(2px): the owner had asked
  // for the top-heavy text-select glyph to sit lower. A fixed 2 CSS px is 3 grid
  // units at the 16px tool bar but 4 at the 12px phone strip, so it sat the
  // glyph visibly low and made it read smaller. The asset is now redrawn larger
  // and centred on the grid (ink 2.25..22 x 2..22, the same box as Box Select),
  // which keeps the owner's intent — it no longer sits high — and scales with
  // the glyph. So the rule is now the plain one: no nudges anywhere.
  assert.match(source, /textSelect: \(size, color, style, className\) => renderMaskIcon\(textSelectUrl, size, color, style, className\),/);
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.equal((code.match(/translateY\(/g) || []).length, 0);
});

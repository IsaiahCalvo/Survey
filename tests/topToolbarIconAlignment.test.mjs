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

test('the deliberate text-select drop is the only kept vertical nudge', () => {
  // Owner rule: the text-select glyph is top-heavy and is asked to sit ~2px
  // lower than the rest of the selection trio. That one nudge stays.
  assert.match(source, /textSelect: \(size, color, style, className\)[\s\S]{0,260}translateY\(2px\)/);
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.equal((code.match(/translateY\(/g) || []).length, 1);
});

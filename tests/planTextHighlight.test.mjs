import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHighlightQuads } from '../src/agent/planText.js';

// Words as textItemsToWords / ocrWordsToWords return them: page points,
// top-left origin, { text, box:{x,y,width,height} }.
const line = (texts, y = 100) => texts.map((text, i) => ({
  text,
  box: { x: 50 + i * 60, y, width: 50, height: 12 },
}));

test('finds a one-word phrase and returns its quad in page points', () => {
  const words = line(['General', 'Notes']);
  const res = findHighlightQuads(words, 'Notes');
  assert.ok(res);
  assert.equal(res.text, 'Notes');
  assert.equal(res.quads.length, 1);
  // The word box at index 1: x=110,y=100,w=50,h=12. Quad corners:
  assert.deepEqual(res.quads[0], {
    x1: 110, y1: 100, x2: 160, y2: 100, x3: 110, y3: 112, x4: 160, y4: 112,
  });
});

test('a multi-word phrase on one line is one continuous quad spanning it', () => {
  const res = findHighlightQuads(line(['General', 'Notes', 'apply']), 'general notes');
  assert.equal(res.quads.length, 1);
  assert.equal(res.text, 'General Notes');
  // Spans from the first word's left (50) to the last word's right (110+50).
  assert.equal(res.quads[0].x1, 50);
  assert.equal(res.quads[0].x2, 160);
});

test('matching ignores case and extra whitespace', () => {
  const res = findHighlightQuads(line(['General', 'Notes']), '  GENERAL   notes ');
  assert.ok(res);
  assert.equal(res.quads.length, 1);
});

test('a phrase inside one word covers the whole word', () => {
  const res = findHighlightQuads(line(['Introduction']), 'duct');
  assert.ok(res);
  assert.equal(res.quads.length, 1);
});

test('occurrence picks which match when the text repeats', () => {
  const words = [...line(['see', 'note'], 100), ...line(['see', 'note'], 200)];
  const first = findHighlightQuads(words, 'note', { occurrence: 1 });
  const second = findHighlightQuads(words, 'note', { occurrence: 2 });
  assert.equal(first.quads[0].y1, 100);
  assert.equal(second.quads[0].y1, 200);
  // Past the last occurrence: no match.
  assert.equal(findHighlightQuads(words, 'note', { occurrence: 3 }), null);
});

test('a phrase that wraps across lines still matches both lines', () => {
  const words = [...line(['the', 'quick'], 100), ...line(['brown', 'fox'], 120)];
  const res = findHighlightQuads(words, 'quick brown');
  assert.ok(res);
  assert.equal(res.quads.length, 2);
  assert.equal(res.quads[0].y1, 100);
  assert.equal(res.quads[1].y1, 120);
});

test('a word the PDF split across items (abutting boxes) still matches as written', () => {
  // "Gen" ends at x=100; "eral" starts right there (gap 0) — one visual word
  // split by a mid-word font change. Then a real space before "Notes".
  const words = [
    { text: 'Gen', box: { x: 50, y: 100, width: 50, height: 12 } },
    { text: 'eral', box: { x: 100, y: 100, width: 40, height: 12 } },
    { text: 'Notes', box: { x: 160, y: 100, width: 50, height: 12 } },
  ];
  const res = findHighlightQuads(words, 'General Notes');
  assert.ok(res, 'split word should still match');
  // The stored text rejoins the split word with no space, keeping real gaps.
  assert.equal(res.text, 'General Notes');
  // All three fragments are on one line → one continuous quad.
  assert.equal(res.quads.length, 1);
  assert.equal(res.quads[0].x1, 50);
  assert.equal(res.quads[0].x2, 210);
  // "General" alone matches both fragments, still one line → one quad.
  assert.equal(findHighlightQuads(words, 'General').quads.length, 1);
});

test('no match, empty query and no words all return null', () => {
  assert.equal(findHighlightQuads(line(['hello']), 'goodbye'), null);
  assert.equal(findHighlightQuads(line(['hello']), '   '), null);
  assert.equal(findHighlightQuads([], 'hello'), null);
  assert.equal(findHighlightQuads(null, 'hello'), null);
});

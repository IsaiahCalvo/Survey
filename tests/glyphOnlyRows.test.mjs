import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isGlyphOnly } from '../src/utils/glyphOnlyButtons.js';

// 2026-11-16: a Templates entity row is role="button" and its name sits in a
// rename field, so the row had no text of its own and was marked a glyph
// button. On hover every part of it grew 12% (the glyph hover) and the name
// ran into the colour dot. A control that holds a field or another control is
// a row, not a glyph.

const el = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body.firstElementChild;

test('a button with only an icon is a glyph button', () => {
  assert.equal(isGlyphOnly(el('<button aria-label="More"><svg></svg></button>')), true);
  assert.equal(isGlyphOnly(el('<span role="button" aria-label="Drag to rearrange"><span><svg></svg></span></span>')), true);
});

test('a button with words is not', () => {
  assert.equal(isGlyphOnly(el('<button><svg></svg>New project</button>')), false);
});

test('a row that holds a rename field or other buttons is not', () => {
  assert.equal(isGlyphOnly(el('<div role="button"><span role="button"><svg></svg></span><button></button><span><input value="Existing"></span><button><svg></svg></button></div>')), false);
  assert.equal(isGlyphOnly(el('<div role="button"><input value="Existing"></div>')), false);
  assert.equal(isGlyphOnly(el('<div role="button"><button aria-label="More"><svg></svg></button></div>')), false);
});

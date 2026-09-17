import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * REGRESSION GUARD (verify-hp-phone, 2026-09-17).
 *
 * The revision-2 palette pass rewrote the phone text editor's two action discs
 * in src/components/TextEditOverlay.jsx. actionDiscStyle(fill, border) takes the
 * disc's fill first and its 1px ring second, so the second argument is a RING on
 * a coloured disc, never a text colour.
 *
 * Before:  actionDiscStyle('#2563eb', '#1d4ed8')   // blue disc, darker blue ring
 * After:   actionDiscStyle('#2563eb', 'var(--text-disabled)')
 *
 * --text-disabled is #5c6370, the one token tokens.css documents as "fails
 * contrast on purpose", and it is now the ring around the blue KEEP TEXT button
 * a user taps to commit their text. Measured live on the phone at 402x874 with a
 * text box open: bg rgb(37, 99, 235), border 1px solid rgb(92, 99, 112).
 *
 * A disabled-state token must never paint an enabled control's edge. The ring
 * belongs to the same family as the fill.
 */

const SOURCE = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');

const discCalls = [...SOURCE.matchAll(/actionDiscStyle\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
  .map(([, fill, ring]) => ({ fill, ring }));

test('the text editor renders both of its action discs', () => {
  assert.equal(discCalls.length, 2, 'expected the cancel disc and the commit disc');
});

test('no action disc wears the disabled token as its ring', () => {
  for (const { fill, ring } of discCalls) {
    assert.notEqual(
      ring,
      'var(--text-disabled)',
      `actionDiscStyle('${fill}', '${ring}') — --text-disabled (#5c6370) is the palette's `
      + 'deliberately-failing token; an enabled disc may not use it as its edge.',
    );
  }
});

test('the blue commit disc keeps a blue ring, not a neutral one', () => {
  const blue = discCalls.find((d) => d.fill.toLowerCase() === '#2563eb');
  assert.ok(blue, 'the commit disc is the blue one');
  assert.match(
    blue.ring,
    /#1d4ed8|--accent|blue/i,
    `the blue commit disc's ring is '${blue.ring}'; it should stay in the blue family `
    + '(it was #1d4ed8) or move to a sanctioned accent token.',
  );
});

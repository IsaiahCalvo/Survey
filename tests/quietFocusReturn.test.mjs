// Design review 2026-10-27: after Esc closed Keyboard shortcuts, focus went
// back to the rail button and its tooltip chip stayed up beside it. Focus a
// closing dialog hands back is "quiet": the chip skips it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusQuietly, isQuietFocus } from '../src/utils/quietFocus.js';

test('the focus event inside focusQuietly sees the quiet mark, later ones do not', () => {
  const seen = [];
  const el = { focus() { seen.push(isQuietFocus(el)); } };
  focusQuietly(el);
  el.focus();
  assert.deepEqual(seen, [true, false]);
  focusQuietly(null);
});

test('the focus trap returns focus quietly and the chip skips quiet focus', () => {
  const trap = readFileSync(new URL('../src/hooks/useFocusTrap.js', import.meta.url), 'utf8');
  assert.match(trap, /focusQuietly\(openerRef\.current\);/);
  assert.doesNotMatch(trap, /openerRef\.current\?\.focus\?\.\(\)/);
  const tip = readFileSync(new URL('../src/components/Tooltip.jsx', import.meta.url), 'utf8');
  assert.match(tip, /if \(isFocus && isQuietFocus\(el\)\) return;/);
});

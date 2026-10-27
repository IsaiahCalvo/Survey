// Owner 2026-10-26: the "Aa" text-formatting toggle and the eraser's Partial /
// Whole toggle press like every other chrome button (grow on hover, tighten on
// press), on desktop and on the phone strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const states = read('src/styles/states.css');
const shell = read('src/AppShell.jsx');
const phone = read('src/mobile/MobilePdfViewerChrome.jsx');

test('word buttons share the icon press model', () => {
  assert.match(states, /\[data-press-label\]:not\(:disabled\):not\(\[aria-disabled='true'\]\):hover > span:not\(\[data-anchored-tooltip\]\) \{\s*scale: 1\.08;/);
  assert.match(states, /\[data-press-label\]:not\(:disabled\):not\(\[aria-disabled='true'\]\):active > span:not\(\[data-anchored-tooltip\]\) \{\s*scale: 0\.92;\s*transition-duration: 80ms;/);
  assert.match(states, /prefers-reduced-motion: reduce\) \{\s*\[data-press-label\] > span \{\s*scale: none !important;/);
});

test('desktop Aa and Partial / Whole wear it', () => {
  assert.match(shell, /aria-label="Edit text"[\s\S]{0,120}data-press-label=""\s*>\s*<span>Aa<\/span>/);
  assert.match(shell, /aria-label=\{full\}\s*data-press-label=""\s*>\s*<span>\{short\}<\/span>/);
});

test('phone Aa and the strip segments wear it', () => {
  assert.match(phone, /data-press-label=""\s*>\s*<span>Aa<\/span>/);
  assert.match(phone, /onClick=\{\(\) => onChange\?\.\(option\.value\)\}\s*data-press-label=""\s*>\s*<span>/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMorphableIcon } from '../src/utils/iconMorph.js';

/*
 * Owner 2026-10-01 (iPhone): the desktop group-switch morph on the phone rail
 * ("an icon takes the place of another icon, and new icons appear where no
 * icons were"). The rail reuses the desktop tool bar's motion
 * (attachLoadoutTransition) on the open group's strip; the strip's block
 * glides open / shut and between heights so nothing below it jumps.
 */
const chrome = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/mobile/useRailGroupMotion.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

test('the phone rail runs the desktop loadout motion, not a copy of it', () => {
  assert.match(hook, /import useLoadoutTransition from '\.\.\/hooks\/useLoadoutTransition\.js'/);
  assert.match(hook, /useLoadoutTransition\(slot, layer, enabled\)/);
  assert.match(hook, /LOADOUT_MOTION\.durationMs/, 'the height glide takes the morph\'s own duration');
  assert.match(hook, /prefersReducedMotion\(\)/, 'reduced motion: the strip changes height at once');
});

test('the group block stays mounted so a switch can morph slot by slot', () => {
  assert.doesNotMatch(chrome, /\{openCategory && \(\s*<>\s*<div className="mobile-pdf-tools__divider is-short" \/>/);
  assert.match(chrome, /className=\{`mobile-pdf-tools__group-tools\$\{openCategory \? ' is-open' : ''\}`\}/);
  assert.match(chrome, /data-morph-icon=\{tool\.icon\}/, 'each sub-tool names its glyph for the morph');
  assert.match(chrome, /data-loadout-ghost-layer="true"/);
});

test('a closed block takes no room: zero high, the column gap handed back', () => {
  const closed = /\.mobile-pdf-tools__group-tools:not\(\.is-open\) \{([^}]*)\}/.exec(css)?.[1] || '';
  assert.match(closed, /height: 0;/);
  assert.match(closed, /margin-top: calc\(-1 \* var\(--rail-pitch-gap, var\(--mobile-rail-gap\)\)\);/);
  assert.match(closed, /overflow: hidden;/);
});

test('the slots that pair up across Draw, Shapes and Text all have a morph', () => {
  // Slot 1-3 of Draw / Shapes and slot 1-2 of Text (positional pairing).
  for (const name of ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'polygon', 'textBox', 'callout']) {
    assert.ok(isMorphableIcon(name), `${name} has no morph geometry`);
    assert.match(chrome, new RegExp(`icon: '${name}'`), `${name} is not a phone sub-tool icon`);
  }
});

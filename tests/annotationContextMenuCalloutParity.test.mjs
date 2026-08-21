// Callout context-menu ITEM PARITY pin (2026-07-17).
//
// Product rule: callouts behave like every other annotation. The callout
// right-click menu must carry every MEANINGFUL shape-menu item — Cut / Copy /
// Paste / Delete — wired through the same gated handlers, and the exclusions
// must be DELIBERATE and DOCUMENTED, never accidental:
//
//   - The four z-order items (bringToFront / bringForward / sendBackward /
//     sendToBack) are excluded from the callout menu BY DESIGN: callouts
//     render in their own SVG loop above all shapes (cross-type order is
//     meaningless) and deriveCalloutsFromByPage sorts per-page callouts by id
//     (callout-vs-callout order is not user-controllable without a persisted
//     z-field / render-loop unification). A menu item would be a dead no-op.
//   - Group / Ungroup are hidden app-wide (2026-04-21) on BOTH menus.
//
// Source-assertion tests (the repo's pattern for guarding contracts inside
// JSX files node --test can't import).
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const MENU_SOURCE = readFileSync(
  new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url),
  'utf8',
);

/** Slice the callout branch out of renderAnnotationContextMenu: from the
 *  `ctx.kind === 'callout'` guard to the next `ctx.kind === 'counter'` guard. */
function calloutBranch() {
  const start = MENU_SOURCE.indexOf("ctx.kind === 'callout'");
  const end = MENU_SOURCE.indexOf("ctx.kind === 'counter'");
  assert.ok(start > -1, 'callout branch exists');
  assert.ok(end > start, 'counter branch follows the callout branch');
  return MENU_SOURCE.slice(start, end);
}

/** Slice the single-shape branch: `ctx.kind === 'annotation'` up to the
 *  `ctx.kind === 'group'` guard. */
function annotationBranch() {
  const start = MENU_SOURCE.indexOf("ctx.kind === 'annotation'");
  const end = MENU_SOURCE.indexOf("ctx.kind === 'group'");
  assert.ok(start > -1, 'annotation branch exists');
  assert.ok(end > start, 'group branch follows the annotation branch');
  return MENU_SOURCE.slice(start, end);
}

test('shape menu item-set baseline: Cut/Copy/Paste/Delete + four z-order items', () => {
  const branch = annotationBranch();
  for (const key of ['cut', 'copy', 'paste', 'delete', 'bringToFront', 'bringForward', 'sendBackward', 'sendToBack']) {
    assert.ok(branch.includes(`'${key}'`), `shape menu carries '${key}'`);
  }
});

test('callout menu carries every meaningful shape item: Cut, Copy, Paste, Delete', () => {
  const branch = calloutBranch();
  assert.match(branch, /item\('Cut',\s*'cut'/);
  assert.match(branch, /item\('Copy',\s*'copy'/);
  assert.match(branch, /item\('Paste',\s*'paste'/);
  assert.match(branch, /item\('Delete',\s*'delete'/);
});

test('callout Paste shares the one-paste-rule (doPasteAny + hasAnyClipboard gray-out) with the shape menu', () => {
  const branch = calloutBranch();
  assert.match(branch, /item\('Paste',\s*'paste',\s*doPasteAny,\s*hasAnyClipboard\)/);
});

test('doPasteAny picks the most recently copied lane (callout can beat a leftover shape)', () => {
  assert.match(MENU_SOURCE, /pickActiveClipboard\(\{\s*clipboardAnnotation,\s*clipboardCallout,\s*lastKind:\s*lastClipboardKind,/);
});

test('callout Cut runs the same own-marks-only gate as the shape Cut (canModifyObj on the projected group)', () => {
  const branch = calloutBranch();
  // Resolves the projected callout group object from the page projection…
  assert.match(branch, /data\?\.type === 'callout' && o\?\.data\?\.id === ctx\.calloutId/);
  // …and refuses to cut anything the viewer cannot modify (cross-author
  // removal must go through Delete's confirm-modal path instead).
  assert.match(branch, /if \(!obj \|\| !canModifyObj\(obj\)\) return;/);
});

test('callout Delete still routes through the gated window bridge (handleDeleteSelectedCallouts)', () => {
  const branch = calloutBranch();
  assert.match(branch, /window\.__onDeleteSelectedCallouts\(\[ctx\.calloutId\]\)/);
});

test('z-order items are excluded from the callout menu DELIBERATELY (documented), not merely missing', () => {
  const branch = calloutBranch();
  // No dead items: none of the four z-order keys may render in the callout menu.
  for (const key of ['bringToFront', 'bringForward', 'sendBackward', 'sendToBack']) {
    assert.ok(!branch.includes(`'${key}'`), `callout menu must not render dead z-order item '${key}'`);
  }
  // The exclusion must be documented in-place so a future parity pass reads
  // it as a decision, not a gap.
  assert.match(branch, /DELIBERATELY EXCLUDED/);
  assert.match(branch, /deriveCalloutsFromByPage/);
});

test('callout render order really is id-sorted (the premise of the z-order exclusion)', () => {
  // Guard the exclusion's factual basis: if someone makes callout order
  // user-controllable (drops the per-page id sort), this test fails and the
  // z-order exclusion above must be revisited.
  const bridgeSource = readFileSync(
    new URL('../src/utils/calloutAnnotationBridge.js', import.meta.url),
    'utf8',
  );
  assert.match(bridgeSource, /pageCallouts\.sort\(\(a, b\) =>\s*\n?\s*String\(a\?\.id \?\? ''\)\.localeCompare\(String\(b\?\.id \?\? ''\)\)/);
});

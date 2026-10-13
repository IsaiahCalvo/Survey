// Callout context-menu ITEM PARITY pin (2026-07-17).
//
// Product rule: callouts behave like every other annotation. The callout
// right-click menu must carry every MEANINGFUL shape-menu item — Cut / Copy /
// Paste / Delete — wired through the same gated handlers, and the exclusions
// must be DELIBERATE and DOCUMENTED, never accidental:
//
//   - The four z-order items (bringToFront / bringForward / sendBackward /
//     sendToBack) are ON the callout menu (w52, 2026-09-28 owner ruling:
//     "annotations are annotations"). They used to be excluded because
//     callouts drew in their own loop above every shape; callouts now sit in
//     the page's one stacking order, so the items are live, not dead.
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

// w52 ruling (2026-09-28): this test used to pin the z-order items as
// DELIBERATELY EXCLUDED from the callout menu. The owner overruled that
// design ("I can't change the Z-order of different things and put some above
// callouts ... annotations are annotations"), and its premise (callouts drawn
// in their own loop above every shape) no longer holds — see
// src/services/annotationStackOrder.js. It now pins the opposite: the four
// items are present and use the SAME reorder handler as the shape menu.
test('callout menu carries the four z-order items through the shared reorder handler', () => {
  const branch = calloutBranch();
  for (const key of ['bringToFront', 'bringForward', 'sendBackward', 'sendToBack']) {
    assert.ok(branch.includes(`'${key}'`), `callout menu carries z-order item '${key}'`);
  }
  // Resolved to the callout's slot in the page's objects, then the shared handler.
  assert.match(branch, /findIndex\(\s*\(o\) => o\?\.data\?\.type === 'callout' && o\?\.data\?\.id === ctx\.calloutId/);
  assert.match(branch, /handleReorderAnnotation\(ctx\.pageNumber, index, direction\)/);
});

test('the derived callout LIST stays id-sorted (fingerprint determinism)', () => {
  // w52: the derived list's id sort is for deterministic sync fingerprints
  // only; what a callout is drawn above or below comes from its slot in the
  // page's objects, never from this list's order.
  const bridgeSource = readFileSync(
    new URL('../src/utils/calloutAnnotationBridge.js', import.meta.url),
    'utf8',
  );
  assert.match(bridgeSource, /pageCallouts\.sort\(\(a, b\) =>\s*\n?\s*String\(a\?\.id \?\? ''\)\.localeCompare\(String\(b\?\.id \?\? ''\)\)/);
});

// Right-click Delete on a callout must route through the SAME gated path as
// keyboard Delete/Backspace: PDFViewer's handleDeleteSelectedCallouts
// (canModify ownership check, undo checkpoint, trash history). The menu item
// previously shipped as `item('Delete', 'delete')` — no action — so it fell
// through to the logStub no-op. These are source-assertion tests (the repo's
// pattern for guarding contracts inside JSX files node --test can't import).
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const MENU_SOURCE = readFileSync(
  new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url),
  'utf8',
);
const SVG_LAYER_SOURCE = readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);

test('callout context-menu Delete carries a real action (not the logStub fallthrough)', () => {
  // The stub signature is an item() call with no third argument. It must not
  // exist anywhere in the file for the Delete key.
  assert.doesNotMatch(MENU_SOURCE, /item\('Delete',\s*'delete'\),/);
  // The callout branch's Delete must invoke the gated window bridge with the
  // right-clicked callout id.
  assert.match(MENU_SOURCE, /window\.__onDeleteSelectedCallouts\(\[ctx\.calloutId\]\)/);
  // ...and guard for the bridge actually being registered.
  assert.match(MENU_SOURCE, /typeof window\.__onDeleteSelectedCallouts === 'function'/);
});

test('SVGAnnotationLayer publishes the gated delete callback on the window bridge', () => {
  // The bridge must be the onDeleteSelectedCallouts prop — the same callback
  // (PDFViewer's handleDeleteSelectedCallouts) the keyboard Delete path uses —
  // never a local ungated re-implementation.
  assert.match(SVG_LAYER_SOURCE, /window\.__onDeleteSelectedCallouts = onDeleteSelectedCallouts/);
  // Keyboard path still routes through the same prop (parity anchor).
  assert.match(SVG_LAYER_SOURCE, /const effectiveDeleteCalloutsCallback = onDeleteSelectedCallouts \|\| \(\(\) => \{\}\)/);
  // Virtualized pages unmount independently — teardown must be refcounted so
  // one page unmount can't kill the bridge while other layers are mounted.
  assert.match(SVG_LAYER_SOURCE, /calloutDeleteBridgeCount -= 1/);
  assert.match(SVG_LAYER_SOURCE, /calloutDeleteBridgeCount <= 0/);
});

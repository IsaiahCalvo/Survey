// calloutEditingToolbarRow.test.mjs — drawing a callout keeps the Callout row.
//
// Owner 2026-10-04: "When the callout tool is selected, I see the options in
// the second toolbar: color picker, line weight, line type, arrow type, and the
// AA option. When I click on the canvas to actually draw the callout, all those
// drop-downs disappear and I only have the color picker and the AA, which is
// terrible."
//
// Drawing a callout opens it for typing and puts the tool down to Select with
// nothing picked, so row 2 fell back to Select's own row. The callout being
// typed in now stands in for the pick: same row as the armed tool, and its
// changes land on that callout (PDFViewer -> handlePatchSelectedCallout).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { resolveRowTwoTool, resolveToolbarCallout } from '../src/utils/toolbarCalloutTarget.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const VIEWER = read('../src/PDFViewer.jsx');
const APP_SHELL = read('../src/AppShell.jsx');
const OVERLAY = read('../src/components/TextEditOverlay.jsx');

const CALLOUT = { id: 'c1', pageNumber: 2, style: { lineThickness: 2 } };
const OTHER = { id: 'c2', pageNumber: 3, style: {} };

// What PDFViewer's toolbar publish does with the result (selectionMappedTool).
const rowFor = ({ activeTool, selectedCalloutIds = new Set(), editingCalloutId = null }) => {
  const target = resolveToolbarCallout({ selectedCalloutIds, callouts: [CALLOUT, OTHER], editingCalloutId });
  return resolveRowTwoTool({ activeTool, selectionMappedTool: target ? 'callout' : null });
};

test('armed Callout and typing in the callout just drawn show the SAME row', () => {
  const armed = rowFor({ activeTool: 'callout' });
  // handleRequestCalloutEditMode: drawing puts the tool down to Select.
  const editingNew = rowFor({ activeTool: 'select', editingCalloutId: 'c1' });
  assert.equal(armed, 'callout');
  assert.equal(editingNew, armed);
});

test('the typed-in callout is what the row edits; a real pick still wins', () => {
  assert.equal(resolveToolbarCallout({ selectedCalloutIds: new Set(), callouts: [CALLOUT], editingCalloutId: 'c1' })?.id, 'c1');
  assert.equal(resolveToolbarCallout({ selectedCalloutIds: new Set(['c2']), callouts: [CALLOUT, OTHER], editingCalloutId: 'c1' })?.id, 'c2');
  assert.equal(resolveToolbarCallout({ selectedCalloutIds: new Set(), callouts: [CALLOUT], editingCalloutId: null }), null);
  assert.equal(resolveToolbarCallout({ selectedCalloutIds: new Set(['c1', 'c2']), callouts: [CALLOUT, OTHER] }), null);
  // A text box being typed in (no callout id) changes nothing here.
  assert.equal(rowFor({ activeTool: 'select' }), 'select');
});

test('PDFViewer feeds the callout being typed in to the bar', () => {
  assert.match(VIEWER, /const editingCalloutIdForToolbar = editingAnnotation\?\.reactCalloutId \|\| null;/);
  assert.match(VIEWER, /const selectedToolbarCallout = useMemo\(\(\) => resolveToolbarCallout\(\{\s*selectedCalloutIds,\s*callouts,\s*editingCalloutId: editingCalloutIdForToolbar,/);
  // ...and maps it onto the Callout row exactly like resolveRowTwoTool.
  assert.match(VIEWER, /if \(selectedToolbarCallout\) \{\s*selectionMappedTool = 'callout';/);
  assert.match(VIEWER, /const contextTool = \(activeTool === 'select' && selectionMappedTool\)\s*\? selectionMappedTool\s*: activeTool;/);
});

test("row 2's Callout controls are the armed tool's: colour, Width, Style, Arrowhead, Aa", () => {
  // Width, Style and Arrowhead all render for contextTool 'callout'.
  const width = APP_SHELL.slice(APP_SHELL.indexOf("toolbarSlot('width'") - 1500, APP_SHELL.indexOf("toolbarSlot('width'"));
  assert.match(width, /bottomToolbarApi\.contextTool === 'callout'/);
  const style = APP_SHELL.slice(APP_SHELL.indexOf("toolbarSlot('style'") - 1500, APP_SHELL.indexOf("toolbarSlot('style'"));
  assert.match(style, /bottomToolbarApi\.contextTool === 'callout'/);
  const head = APP_SHELL.slice(APP_SHELL.indexOf("toolbarSlot('arrowhead'") - 1200, APP_SHELL.indexOf("toolbarSlot('arrowhead'"));
  assert.match(head, /bottomToolbarApi\.contextTool === 'callout'/);
  const aa = APP_SHELL.slice(APP_SHELL.indexOf("toolbarSlot('aa'") - 400, APP_SHELL.indexOf("toolbarSlot('aa'"));
  assert.match(aa, /bottomToolbarApi\.contextTool === 'callout'/);
});

test('a press on those controls edits the callout instead of ending the typing', () => {
  assert.match(OVERLAY, /const CALLOUT_SETTINGS_SELECTOR = \[/);
  for (const marker of ['[data-chrome-settings-holder]', '[data-annotation-dropdown-popover]', '[data-annotation-size-popover]', '[data-annotation-color-picker]']) {
    assert.ok(OVERLAY.includes(`'${marker}'`), `${marker} passes while a callout is open`);
  }
  // Both the editor's own outside-press commit and dismiss rule R3 let it pass.
  assert.match(OVERLAY, /if \(isCallout && t\.closest\(CALLOUT_SETTINGS_SELECTOR\)\) \{/);
  assert.match(OVERLAY, /\|\| \(isCallout && Boolean\(target\?\.closest\?\.\(CALLOUT_SETTINGS_SELECTOR\)\)\),/);
  // The markers exist where the editor looks for them.
  assert.match(APP_SHELL, /data-chrome-settings-holder="true"/);
  assert.match(read('../src/components/AnnotationDropdown.jsx'), /data-annotation-dropdown-popover="true"/);
  assert.match(read('../src/components/AnnotationSizeControl.jsx'), /data-annotation-size-popover="true"/);
});

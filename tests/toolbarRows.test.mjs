// RULED 2026-09-26 owner: flip rows (w44). The desktop tool bar holds the tool
// groups and, right of them, the TOOLS inside the chosen group; the formatting
// controls moved down to the second row. In Select mode a picked mark always
// brings its own group's tools up top and its own formatting below, and
// pressing one of those tools arms it (owner answered yes). This file pins the
// rules (src/utils/toolbarRows.js) and the wiring in AppShell / PDFViewer that
// makes them true; the live check is in the w44 browser pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORMAT_ROW_TOOLS,
  TOOL_BAR_GROUPS,
  resolveToolBarGroup,
  showsFormatRow,
} from '../src/utils/toolbarRows.js';

const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const pdfViewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

const picked = (contextTool) => ({ activeTool: 'select', activeCategoryDropdown: null, contextTool });

test('in Select mode a picked mark always brings its own group\'s tools into the tool bar', () => {
  // Pen and highlighter strokes publish as 'pen'; polygons as 'rect'; polylines as 'line'.
  assert.equal(resolveToolBarGroup(picked('pen')), 'draw');
  assert.equal(resolveToolBarGroup(picked('highlighter')), 'draw');
  for (const tool of ['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter']) {
    assert.equal(resolveToolBarGroup(picked(tool)), 'shape', tool);
  }
  assert.equal(resolveToolBarGroup(picked('text')), 'review');
  assert.equal(resolveToolBarGroup(picked('callout')), 'review');
});

test('Select with nothing picked (or a mark no drawing group makes) shows Select\'s own modes', () => {
  assert.equal(resolveToolBarGroup(picked('select')), 'select');
  assert.equal(resolveToolBarGroup(picked(undefined)), 'select');
  assert.equal(resolveToolBarGroup(picked('text-markup')), 'select');
  assert.equal(resolveToolBarGroup({ activeTool: 'text-select', contextTool: 'text-select' }), 'select');
});

test('an armed tool shows its group\'s tools; Pan and Survey Marker placement show none', () => {
  assert.equal(resolveToolBarGroup({ activeTool: 'pen', activeCategoryDropdown: 'draw', contextTool: 'pen' }), 'draw');
  assert.equal(resolveToolBarGroup({ activeTool: 'eraser', activeCategoryDropdown: 'draw', contextTool: 'eraser' }), 'draw');
  // A keyboard shortcut arms a tool before its group catches up: still its group.
  assert.equal(resolveToolBarGroup({ activeTool: 'arrow', activeCategoryDropdown: null, contextTool: 'arrow' }), 'shape');
  assert.equal(resolveToolBarGroup({ activeTool: 'callout', activeCategoryDropdown: 'review' }), 'review');
  assert.equal(resolveToolBarGroup({ activeTool: 'pan', activeCategoryDropdown: null, contextTool: 'pan' }), null);
  assert.equal(resolveToolBarGroup({ activeTool: 'survey-marker', activeCategoryDropdown: 'survey' }), null);
  assert.deepEqual([...TOOL_BAR_GROUPS], ['draw', 'shape', 'review', 'forms']);
});

test('the formatting row shows exactly when there are settings: armed tool, picked mark, eraser, open text box', () => {
  assert.equal(showsFormatRow({ activeTool: 'pan', contextTool: 'pan' }), false);
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'select' }), false);
  assert.equal(showsFormatRow({ activeTool: 'survey-marker', contextTool: 'survey-marker' }), false);
  assert.equal(showsFormatRow(null), false);
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'pen' }), true, 'a picked pen stroke');
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'callout' }), true, 'a picked callout');
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'text-markup' }), true, 'a picked text highlight');
  assert.equal(showsFormatRow({ activeTool: 'eraser', contextTool: 'eraser' }), true);
  assert.equal(showsFormatRow({ activeTool: 'text-select', contextTool: 'text-select' }), true);
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'select', richTextEditor: {} }), true);
  // Every tool whose settings the row draws is listed.
  for (const tool of ['pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'polygon', 'polyline', 'text', 'callout', 'counter']) {
    assert.ok(FORMAT_ROW_TOOLS.includes(tool), tool);
  }
});

test('PDFViewer draws a group\'s tools into the tool bar, keyed on the picked mark in Select mode', () => {
  assert.match(pdfViewer, /resolveToolBarGroup\(\{ activeTool, activeCategoryDropdown, contextTool: subToolContextTool \}\)/);
  assert.match(pdfViewer, /setSubToolContextTool\(\(prev\) => \(prev === contextTool \? prev : contextTool\)\)/);
  assert.match(pdfViewer, /document\.getElementById\('chrome-subtools-host'\)/);
  assert.match(pdfViewer, /TOOL_BAR_GROUPS\.includes\(toolBarGroup\) && subToolsHostEl/);
  // The Survey row keeps its own bar under the tool bar.
  assert.match(pdfViewer, /activeCategoryDropdown && !TOOL_BAR_GROUPS\.includes\(activeCategoryDropdown\) && subRowHost/);
  for (const group of ['draw', 'shape', 'review', 'survey']) {
    assert.match(pdfViewer, new RegExp(`\\{subRowCategory === '${group}' && `), group);
  }
});

test('pressing a group tool while Select is armed arms that tool and shows its group', () => {
  // The buttons arm their own tool (the same handler as ever)...
  const row = pdfViewer.slice(pdfViewer.indexOf("{subRowCategory === 'draw' && "), pdfViewer.indexOf("{subRowCategory === 'survey' && "));
  assert.match(row, /setActiveTool\('highlighter'\)/);
  assert.match(row, /setActiveTool\('eraser'\)/);
  assert.match(row, /setActiveTool\(t\.id\)/);
  // ...and arming a drawing tool opens its group, which ends Select mode's
  // picked-mark view (the effect that keeps the row on the armed tool's group).
  assert.match(pdfViewer, /setActiveCategoryDropdown\(\(prev\) => \(prev === 'draw' \? prev : 'draw'\)\)/);
  assert.match(pdfViewer, /setActiveCategoryDropdown\(\(prev\) => \(prev === 'shape' \? prev : 'shape'\)\)/);
  assert.match(pdfViewer, /setActiveCategoryDropdown\(\(prev\) => \(prev === 'review' \? prev : 'review'\)\)/);
});

test('AppShell: tools up top, settings in row 2, the Aa bar in row 3', () => {
  // Row 1: Select's modes and the group tools host hang off the icon cluster.
  const subtools = appShell.slice(appShell.indexOf('data-toolbar-subtools="true"'), appShell.indexOf('id="chrome-subtools-host"'));
  assert.ok(subtools.length > 0, 'the tools block exists');
  assert.match(subtools, /data-select-mode-toggle="true"/);
  assert.match(subtools, /toolBarGroup === 'select' && isSelectFamilyTool\(bottomToolbarApi\.activeTool\)/);
  assert.ok(appShell.indexOf('id="chrome-subtools-host"') < appShell.indexOf('data-chrome-settings-holder="true"'));
  // Row 2: the settings are portalled into the formatting row, which shows only
  // when it has something to show and is one fixed bar tall.
  assert.match(appShell, /\{formatRowEl && createPortal\(/);
  assert.match(appShell, /display: formatRowShown \? 'block' : 'none'/);
  const slots = appShell.slice(appShell.indexOf('id="chrome-sub-toolbar-host"'), appShell.indexOf('<Dashboard'));
  assert.ok(slots.indexOf('data-chrome-format-row="true"') > 0);
  assert.ok(slots.indexOf('data-chrome-format-row="true"') < slots.indexOf('data-chrome-text-format-row="true"'),
    'row 2 comes before row 3');
  assert.match(slots, /height: 'var\(--chrome-bar-h\)'/);
  // Row 3: the Aa bar drops into its own slot under row 2.
  assert.match(appShell, /\{showTextFormatting && textFormatRowEl && createPortal\(/);
  // The phone draws neither slot.
  assert.match(slots, /\{!isMobileViewer && \(\s*<div\s*ref=\{attachFormatRow\}/);
  assert.match(slots, /\{!isMobileViewer && <div ref=\{setTextFormatRowEl\}/);
});

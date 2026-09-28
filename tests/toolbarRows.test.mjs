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
import { WIDEST_SUBTOOLS_WIDTH } from '../src/utils/responsiveToolbar.js';

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

test('the formatting row shows for an armed tool, a picked mark, the eraser, an open text box, and Text Select', () => {
  assert.equal(showsFormatRow({ activeTool: 'pan', contextTool: 'pan' }), false);
  // DELIBERATE ASSERTION CHANGE — RULED 2026-09-26 owner: select modes in top
  // bar (w46). The Box / Lasso / Text modes left row 2 for the tool bar, so
  // Box or Lasso Select with nothing picked has nothing for row 2: it is
  // hidden (w44's review kept it up to carry the modes).
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'select' }), false);
  assert.equal(showsFormatRow({ activeTool: 'survey-marker', contextTool: 'survey-marker' }), false);
  assert.equal(showsFormatRow(null), false);
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'pen' }), true, 'a picked pen stroke');
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'callout' }), true, 'a picked callout');
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'text-markup' }), true, 'a picked text highlight');
  assert.equal(showsFormatRow({ activeTool: 'eraser', contextTool: 'eraser' }), true);
  assert.equal(showsFormatRow({ activeTool: 'text-select', contextTool: 'text-select' }), true);
  assert.equal(showsFormatRow({ activeTool: 'select', contextTool: 'select', richTextEditor: {} }), true);
  // w47: an armed drawing tool keeps the row up even for the one render its
  // settings context still names the tool before it (Eraser → Pen).
  assert.equal(showsFormatRow({ activeTool: 'pen', contextTool: 'eraser' }), true);  // Every tool whose settings the row draws is listed.
  for (const tool of ['pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'polygon', 'polyline', 'text', 'callout', 'counter']) {
    assert.ok(FORMAT_ROW_TOOLS.includes(tool), tool);
  }
});

test('PDFViewer draws a group\'s tools into the tool bar, keyed on the picked mark in Select mode', () => {
  assert.match(pdfViewer, /resolveToolBarGroup\(\{ activeTool, activeCategoryDropdown, contextTool: subToolContextTool \}\)/);
  assert.match(pdfViewer, /setSubToolContextTool\(\(prev\) => \(prev === subToolTool \? prev : subToolTool\)\)/);
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
  assert.match(subtools, /\{selectModesInToolBar && renderSelectModeToggle\(\)\}/);
  assert.ok(appShell.indexOf('id="chrome-subtools-host"') < appShell.indexOf('data-chrome-settings-holder="true"'));
  // Row 2: the settings are portalled into the formatting row, which shows only
  // when it has something to show and is one fixed bar tall.
  assert.match(appShell, /\{formatRowEl && createPortal\(/);
  // DELIBERATE ASSERTION CHANGE — RULED 2026-09-26 owner: fixed centred
  // groups + animated loadouts (w47). Row 2 now also stays drawn for its
  // 140ms fade-out after it has nothing to show (formatRowLeaving), instead
  // of vanishing in one frame; it is still hidden the rest of the time.
  assert.match(appShell, /display: formatRowShown \|\| formatRowLeaving \? 'block' : 'none'/);
  const slots = appShell.slice(appShell.indexOf('id="chrome-sub-toolbar-host"'), appShell.indexOf('<Dashboard'));
  assert.ok(slots.indexOf('data-chrome-format-row="true"') > 0);
  assert.ok(slots.indexOf('data-chrome-format-row="true"') < slots.indexOf('data-chrome-text-format-row="true"'),
    'row 2 comes before row 3');
  assert.match(slots, /height: 'var\(--chrome-bar-h\)'/);
  // Row 3: the Aa bar drops into its own slot under row 2.
  assert.match(appShell, /\{showTextFormatting && textFormatRowEl && createPortal\(/);
  // Both slots are always drawn (never re-added after the Survey row or the
  // text-selection bar); the phone keeps row 2 hidden (formatRowShown is false
  // there) and row 3 empty.
  assert.doesNotMatch(slots, /\{!isMobileViewer && \(\s*<div\s*ref=\{attachFormatRow\}/);
  assert.match(appShell, /const formatRowShown = !isMobileViewer && /);
  // Row 2 is a labelled toolbar.
  assert.match(slots, /data-chrome-format-row="true"\s*role="toolbar"\s*aria-label="Formatting"/);
});

test('Select mode: the modes sit in the tool bar with nothing picked, or for a mark no group makes; never in row 2', () => {
  // DELIBERATE ASSERTION CHANGE — RULED 2026-09-26 owner: select modes in top
  // bar (w46): "Those need to be to the very right, just like every other
  // annotation type of tool, like pen, highlighter, and eraser." w44 put them
  // in row 2 with nothing picked; now the tool bar holds them whenever Select
  // shows its own tools (resolveToolBarGroup → 'select').
  assert.doesNotMatch(appShell, /selectModesInFormatRow/);
  assert.match(appShell, /const selectModesInToolBar = selectArmed && toolBarGroup === 'select';/);
  const row2 = appShell.slice(appShell.indexOf('data-chrome-settings-holder="true"'), appShell.indexOf('data-eraser-mode-toggle="true"'));
  assert.doesNotMatch(row2, /renderSelectModeToggle\(\)/);
  const toolBar = appShell.slice(appShell.indexOf('data-toolbar-subtools="true"'), appShell.indexOf('id="chrome-subtools-host"'));
  assert.match(toolBar, /\{selectModesInToolBar && renderSelectModeToggle\(\)\}/);
  // The same rule before them as before a group's tools.
  assert.match(toolBar, /\(\(toolBarGroup && toolBarGroup !== 'select'\) \|\| selectModesInToolBar\) && \(\s*<div className="chrome-divider" \/>/);
  // They answer the pointer exactly as the group tools beside them do.
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#chrome-subtools-host \.btn:hover:not\(:disabled\),\s*\[data-select-mode-toggle\] \.btn:hover:not\(:disabled\)/);
  assert.match(css, /#chrome-subtools-host \.btn-active:hover:not\(:disabled\),\s*\[data-select-mode-toggle\] \.btn-active:hover:not\(:disabled\)/);
  assert.match(css, /#chrome-subtools-host \.btn:active:not\(:disabled\),\s*\[data-select-mode-toggle\] \.btn:active:not\(:disabled\)/);
});

test('row 2 coming and going in Select mode moves neither the Survey row nor the storage banner', () => {
  // w46: the Survey row has its own slot above row 2...
  const slots = appShell.slice(appShell.indexOf('id="chrome-sub-toolbar-host"'), appShell.indexOf('<Dashboard'));
  assert.ok(slots.indexOf('id="chrome-survey-row-slot"') > 0);
  assert.ok(slots.indexOf('id="chrome-survey-row-slot"') < slots.indexOf('data-chrome-format-row="true"'));
  assert.match(pdfViewer, /const subRowHost = document\.getElementById\('chrome-survey-row-slot'\)\s*\|\| document\.getElementById\('chrome-sub-toolbar-host'\);/);
  // ...and the banner anchors as if row 2 were up the whole time Select is armed.
  assert.match(appShell, /const reserveFormatRowForBanner = selectArmed && !isMobileViewer;/);
  assert.match(appShell, /setProperty\('--app-banner-top'/);
  const banner = readFileSync(new URL('../src/components/collab/StorageFailureBanner.css', import.meta.url), 'utf8');
  assert.match(banner, /top: var\(--app-banner-top, var\(--app-chrome-top, 96px\)\);/);
});

test('marks of several kinds picked together borrow no group: the tool bar shows the Select modes', () => {
  const restyle = readFileSync(new URL('../src/utils/selectionRestyle.js', import.meta.url), 'utf8');
  assert.match(restyle, /mixedKinds: tools\.size > 1/);
  assert.match(pdfViewer, /const subToolTool = groupSummary\?\.mixedKinds \? 'select' : contextTool;/);
  assert.equal(resolveToolBarGroup({ activeTool: 'select', contextTool: 'select' }), 'select');
  // PDFViewer publishes that choice, and AppShell reads it for the rule and the modes.
  assert.match(pdfViewer, /toolBarContextTool: subToolTool,/);
  assert.match(appShell, /contextTool: bottomToolbarApi\.toolBarContextTool \?\? bottomToolbarApi\.contextTool/);
});

test('a popover opened from row 2 closes when the row goes away, and never flies to the corner', () => {
  assert.match(appShell, /if \(isMobileViewer \|\| formatRowShown\) return;\s*setOpenAnnotationDropdown\(null\);\s*setShowFontColorPicker\(false\);/);
  const anchored = readFileSync(new URL('../src/components/AnchoredPopover.jsx', import.meta.url), 'utf8');
  assert.match(anchored, /anchor\.getClientRects\(\)\.length === 0/);
});

test('the Survey row and the tool-bar tools are keyed portals, so one never remounts the other', () => {
  assert.match(pdfViewer, /inToolBar \? 'tool-bar-tools' : 'sub-row'\s*\);/);
});

test('w48: Pan / Select hang beside the group icons; Undo/Redo pinned left; nothing reads the loadout', () => {
  // RULED 2026-09-27 owner: Pan/Select beside the groups (supersedes w47's
  // pin beside Undo/Redo). "No, the Pan and Select are supposed to stay next
  // to the other tool groups; I was just saying to keep it on the left."
  assert.doesNotMatch(appShell, /data-toolbar-start/);
  // Undo / Redo pinned at the far left on their own, as before w47.
  assert.match(appShell, /data-undo-redo-controls="true"\s*style=\{\{\s*\/\/ Narrow shells: flow inline with the tool cluster \(no pinning\)\.\s*\.\.\.\(isNarrowShell\s*\? \{ position: 'static' \}\s*: \{ position: 'absolute', left: '10px', top: 0, bottom: 0 \}\),/);
  // Pan / Select sit INSIDE the icon cluster, hung off its left edge, with
  // the rule between Select and Draw.
  const cluster = appShell.slice(appShell.indexOf('data-tool-toolbar="true"'), appShell.indexOf('data-toolbar-subtools="true"'));
  const left = cluster.indexOf('data-toolbar-left-block="true"');
  assert.ok(left > 0, 'Pan / Select inside the cluster');
  assert.match(cluster, /position: 'absolute', right: '100%', top: '50%', transform: 'translateY\(-50%\)'/);
  const rule = cluster.indexOf('<div className="chrome-divider" />', left);
  assert.ok(rule > left && rule < cluster.indexOf('{/* Draw category */}'), 'rule after Select, before Draw');
  // The plan keeps Pan / Select clear of Undo/Redo, and never reads the
  // loadout's width.
  const hook = readFileSync(new URL('../src/hooks/useResponsiveToolbar.js', import.meta.url), 'utf8');
  assert.match(hook, /startRight: rel\(undo, 'right'\) \?\? 0,\s*leftBlockWidth: leftBlock \? leftBlock\.getBoundingClientRect\(\)\.width : 0,/);
  assert.doesNotMatch(hook, /subtoolsWidth/);
  assert.doesNotMatch(hook, /querySelector\('\[data-toolbar-subtools\]'\)/);
  // RULED 2026-09-27 owner: rows 2/3 centred, animated. Rows 2 and 3 centre
  // under the icons (w47 started them level with the icons' left edge).
  assert.match(hook, /const centre = hostRect\.left \+ top\.clusterLeft \+ clusterRect\.width \/ 2 - rowRect\.left;/);
  assert.match(hook, /centre: hostRect\.left \+ top\.clusterLeft \+ clusterRect\.width \/ 2 - textBarRect\.left,/);
});

test('RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3 drops down — no row glides; rows never move on unchanged content', () => {
  // Was w48 (rows 2 and 3 glide when they re-centre); the glide is gone.
  assert.doesNotMatch(appShell, /useRowSlide\(/);
  assert.match(appShell, /useRowCrossfade\(formatHolderEl, formatGhostLayerEl, chromeMotion\);/);
  assert.match(appShell, /useDropInRow\(textBarEl, textFormatRowEl, chromeMotion\);/);
  assert.match(appShell, /<div data-rich-text-toolbar ref=\{setTextBarEl\}/);
  const motion = readFileSync(new URL('../src/utils/loadoutTransition.js', import.meta.url), 'utf8');
  assert.doesNotMatch(motion, /slideRow|swapSharedNothing|ROW_SLIDE_MS/);
  // A pixel of measuring noise never moves a row.
  const hook = readFileSync(new URL('../src/hooks/useResponsiveToolbar.js', import.meta.url), 'utf8');
  assert.match(hook, /Math\.abs\(next\.left - current\.formatLeft\) <= 1\s*\? current\.formatLeft/);
  assert.match(hook, /Math\.abs\(textRowLeft - current\.textRowLeft\) <= 1\s*\? current\.textRowLeft/);
});

test('w47: the loadout and row 2 crossfade through ghost layers; row 2 fades out as it goes', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts.
  assert.match(appShell, /useLoadoutTransition\(loadoutSlotEl, loadoutGhostLayerEl, chromeMotion\);/);
  // RULED 2026-09-28 owner: one motion for row 2 — row 2 crossfades as a
  // whole (useRowCrossfade); the tool bar keeps its morph / grow / shrink.
  assert.doesNotMatch(appShell, /useLoadoutTransition\(formatHolderEl/);
  assert.match(appShell, /useRowCrossfade\(formatHolderEl, formatGhostLayerEl, chromeMotion\);/);
  assert.match(appShell, /const chromeMotion = Boolean\(isViewerVisible && !isMobileViewer\);/);
  assert.match(appShell, /ref=\{setLoadoutSlotEl\}\s*data-toolbar-subtools="true"/);
  assert.match(appShell, /ref=\{setFormatHolderEl\}\s*data-chrome-settings-holder="true"/);
  assert.equal((appShell.match(/data-loadout-ghost-layer="true"/g) || []).length, 2);
  // Leaving (useLeavingRow): the row stays drawn and takes no clicks while it
  // fades; its live settings hide so only their held copy shows; the ghost
  // layer comes AFTER the live settings.
  assert.match(appShell, /useLeavingRow\(formatRowEl, formatRowShown, chromeMotion\)/);
  assert.match(appShell, /data-leaving=\{formatRowLeaving \? 'true' : undefined\}/);
  assert.match(appShell, /visibility: formatRowFading \? 'hidden' : undefined,/);
  const holderAt = appShell.indexOf('data-chrome-settings-holder="true"');
  const layerAt = appShell.indexOf('ref={setFormatGhostLayerEl}');
  assert.ok(layerAt > holderAt, 'row 2 ghost layer after the live settings');
  // RULED 2026-09-28 owner: row 2 downward swap (w51): the old settings sink
  // inside row 2's ghost layer, which clips them to the band (never onto the
  // page); row 2 itself drops in like row 3.
  assert.match(appShell, /ref=\{setFormatGhostLayerEl\}[\s\S]{0,400}style=\{\{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'clip' \}\}/);
  assert.match(appShell, /data-chrome-format-row="true"[\s\S]{0,300}className="chrome-row-drop-in"/);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-chrome-format-row\]\[data-leaving="true"\] \{\s*pointer-events: none;/);
  const hook = readFileSync(new URL('../src/hooks/useLoadoutTransition.js', import.meta.url), 'utf8');
  // Skipped with reduced motion; confirmed a frame later (no blink on a
  // one-render gap); run backwards when wanted again mid-fade.
  assert.match(hook, /setLeaving\(!shown && enabled && !prefersReducedMotion\(\)\);/);
  assert.match(hook, /requestAnimationFrame\(\(\) => \{\s*setFading\(true\);/);
  assert.match(hook, /running\.reverse\(\);/);
});

test('w47: the room kept for the widest loadout matches the Shapes group\'s seven tools', () => {
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts. The
  // icons keep WIDEST_SUBTOOLS_WIDTH clear on their right for the loadout; a
  // new tool in the widest group must raise it, or that loadout would run
  // into Export in a narrow window.
  const shapes = pdfViewer.slice(pdfViewer.indexOf("{subRowCategory === 'shape' && "), pdfViewer.indexOf("{subRowCategory === 'review' && "));
  const listed = shapes.slice(0, shapes.indexOf('].map(')).match(/\{ id: '[a-z-]+', label: /g) || [];
  assert.equal(listed.length, 7);
  assert.equal(WIDEST_SUBTOOLS_WIDTH, listed.length * 28 + (listed.length - 1) * 6 + 17);
});

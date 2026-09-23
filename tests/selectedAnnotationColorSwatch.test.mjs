import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewerSource = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);
const appShellSource = readFileSync(
  new URL('../src/AppShell.jsx', import.meta.url),
  'utf8',
);

test('selected annotation swatch colors come from the current saved annotation', () => {
  assert.match(
    viewerSource,
    /getAnnotationRenderIdentity\(\s*selectedToolbarAnnotation\?\.annotation,?\s*\)\.annotationId/,
  );
  assert.match(viewerSource, /pageObjects\.find\(\(annotation\) =>/);
  assert.match(viewerSource, /selectedFillColor: selectedPreviewColors\.fill,/);
  assert.match(viewerSource, /selectedStrokeColor: selectedPreviewColors\.stroke,/);
  assert.match(viewerSource, /annotationsByPage,/);
});

test('selected text markup publishes its own base color and opacity to the edit controls', () => {
  assert.match(viewerSource, /const selectedTextMarkupPaint = activeTool === 'select' && selectedAnnot\?\.data\?\.type === 'text-markup'/);
  assert.match(viewerSource, /resolveTextMarkupEditPaint\(selectedAnnot, strokeColor\)/);
  assert.match(viewerSource, /strokeColor: selectedTextMarkupPaint\?\.color \|\| counterToolStrokeColor,/);
  assert.match(viewerSource, /strokeOpacity: selectedTextMarkupPaint\?\.opacity \?\? counterToolStrokeOpacity,/);
  assert.match(viewerSource, /strokeColorStateRef\.current = paint\.color;[\s\S]*?strokeOpacityStateRef\.current = paint\.opacity;/);
  assert.match(viewerSource, /const color = getHexFromColor\(strokeColorStateRef\.current\) \|\| paint\.color;/);
  // RULED 2026-09-23 (owner: sliders must be smooth). Was `handleTextMarkupPaintChange,`
  // and an exact `(hex, Math.round(alpha * 100))` call. The toolbar now gets the
  // handler through its drag-phase wrapper, and the call also passes the colour
  // picker's drag phase so a drag previews live and lands as one undo step. What
  // is guarded is unchanged: the markup's own paint handler is what the toolbar
  // calls, with the picker's colour and opacity.
  assert.match(viewerSource, /handleTextMarkupPaintChange: handleTextMarkupPaintChangePhased,/);
  assert.match(viewerSource, /runWithPaintPhase\(options, \(\) => handleTextMarkupPaintChange\(color, opacity\)\)/);
  assert.match(appShellSource, /isTextMarkupPalette && bottomToolbarApi\.handleTextMarkupPaintChange/);
  assert.match(appShellSource, /handleTextMarkupPaintChange\(hex, Math\.round\(alpha \* 100\)(, meta)?\)/);
});

test('live Text Select paint focus hands the active saved mark to the edit transaction', () => {
  assert.match(viewerSource, /const liveRangeMarks = getTextMarkupRangeAnnotations\(/);
  assert.match(viewerSource, /sourceMarks: liveRangeMarks\.map\(\(entry\) => entry\.annotation\)/);
  assert.match(viewerSource, /const target = selection\?\.sourceMarks\?\.find\(/);
  assert.match(viewerSource, /selectedToolbarAnnotationRef\.current = nextSelection;[\s\S]*?setSelectedToolbarAnnotation\(nextSelection\)/);
  assert.match(viewerSource, /selectedToolbarAnnotationRef\.current\?\.annotation\?\.data\?\.type === 'text-markup'[\s\S]*?handlePatchSelectedAnnotation/);
});

test('mobile text markup picker taps stay inside the shared color popover boundary', () => {
  assert.match(
    appShellSource,
    /\[data-annotation-color-trigger\], \[data-annotation-color-picker\], \.mobile-pdf-colorpicker-surface/,
  );
});

test('counter preview publishes the renderer-exact fill and number colors', () => {
  assert.match(
    viewerSource,
    /effectivePreviewColor\(currentSelectedAnnot\.fill \|\| currentSelectedAnnot\.data\?\.color \|\| '#ef4444', objectOpacity\)/,
  );
  assert.match(
    viewerSource,
    /effectivePreviewColor\(currentSelectedAnnot\.data\?\.numberColor \|\| '#ffffff', objectOpacity\)/,
  );
});

test('selected previews include renderer opacity and every editable rendered type', () => {
  assert.match(viewerSource, /const effectivePreviewColor = \(color, opacity = 1\) =>/);
  assert.match(viewerSource, /colorAlpha \* Math\.max\(0, Math\.min\(1, Number\(opacity\) \|\| 0\)\)/);
  assert.match(viewerSource, /selectedType === 'circle'.*selectionMappedTool = 'ellipse'/);
  assert.match(viewerSource, /selectedType === 'i-text' \|\| selectedType === 'text'/);
  assert.match(viewerSource, /selectedType === 'group'[\s\S]*?selectionMappedTool = 'arrow'/);
  assert.match(viewerSource, /const pathAttrs = renderPathToSvgAttrs\(currentSelectedAnnot\);/);
  assert.match(viewerSource, /pathAttrs\.stroke[\s\S]*?: pathAttrs\.fill;/);
});

test('selected preview cannot override an armed drawing tool and only text markup hydrates picker bases', () => {
  assert.match(
    viewerSource,
    /if \(activeTool !== 'select'\) return \{ fill: null, stroke: null \};/,
  );
  assert.match(viewerSource, /strokeColor: selectedTextMarkupPaint\?\.color \|\| counterToolStrokeColor,/);
  assert.match(viewerSource, /const selectedTextMarkupPaint = activeTool === 'select'/);
  assert.match(viewerSource, /fillColor: counterToolFillColor,/);
  assert.doesNotMatch(viewerSource, /strokeColor: selectedPreviewColors\.stroke/);
  assert.doesNotMatch(viewerSource, /fillColor: selectedPreviewColors\.fill/);
});

test('counter draw mode previews the active series instead of unrelated tool defaults', () => {
  assert.match(viewerSource, /const activeCounterSeriesPaint = resolveCounterSeriesPaint\(/);
  assert.match(viewerSource, /if \(activeTool === 'counter'\) \{/);
  assert.match(viewerSource, /fill: effectivePreviewColor\(activeCounterSeriesPaint\.fill\)/);
  assert.match(viewerSource, /stroke: effectivePreviewColor\(activeCounterSeriesPaint\.numberColor\)/);
  assert.match(
    viewerSource,
    /const numberColor = activeCounterSeriesNumberColorRef\.current\s*\|\| inheritedNumberColor\s*\|\| '#ffffff';/,
  );
});

test('counter draw color edits patch only the active series and never a stale selection', () => {
  const handlerBlocks = [
    ['handleStrokeColorChange', 'handleStrokeOpacityChange', 'numberColor'],
    ['handleStrokeOpacityChange', 'handleFillColorChange', 'numberColor'],
    ['handleFillColorChange', 'handleFillOpacityChange', 'fill'],
    ['handleFillOpacityChange', 'handleStrokeWidthChange', 'fill'],
  ];

  handlerBlocks.forEach(([startName, endName, patchKey]) => {
    const start = viewerSource.indexOf(`const ${startName} = useCallback`);
    const end = viewerSource.indexOf(`const ${endName} = useCallback`, start + 1);
    assert.ok(start >= 0 && end > start, `${startName} source block exists`);
    const block = viewerSource.slice(start, end);

    assert.match(block, /const activeSeriesId = activeCounterSeriesIdRef\.current;/);
    assert.match(block, /counterSeriesList\.some\(\(series\) => series\.seriesId === activeSeriesId && series\.count > 0\)/);
    assert.match(block, new RegExp(`handleCounterGroupUpdateRef\\.current\\?\\.\\(activeSeriesId, \\{ ${patchKey}:`));
    assert.match(block, /if \(activeTool === 'counter'\) return;/);
    assert.match(block, /if \(activeTool !== 'select'\) return;/);
    assert.ok(
      block.indexOf("if (activeTool === 'counter') return;") < block.indexOf('isCalloutSelected()'),
      `${startName} exits counter draw mode before selected-object edits`,
    );
  });
});

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-22, pass 7 integration). Was
 * /setColorPickerTab\(k\);\s*bottomToolbarApi\.setShowAnnotationColorPicker\(true\);/.
 *
 * RULING: board 19 draws the Border / Fill tabs INSIDE the 276px picker panel,
 * as the same tablist boards 17 and 18 draw on the phone, so the desktop bar no
 * longer builds its own strip above the panel. The behaviour this guards is
 * unchanged and is now the picker's: selecting a tab only changes which channel
 * the panel is on, and nothing in that path closes the popover.
 */
test('switching Fill and Number keeps the counter color picker open', () => {
  const tabs = appShellSource.slice(
    appShellSource.indexOf('tabs={isShape ? {'),
    appShellSource.indexOf('onChange={applyChange}'),
  );
  assert.ok(tabs.length > 80, 'the picker tabs must still be where this test reads them');
  assert.match(tabs, /\{ id: 'border', label: secondTabLabel \}/);
  assert.match(tabs, /\{ id: 'fill', label: 'Fill' \}/);
  // Picking a tab does exactly one thing: it moves the panel to that channel.
  assert.match(tabs, /onSelect: \(id\) => setColorPickerTab\(id\),/);
  assert.doesNotMatch(tabs, /setShowAnnotationColorPicker\(false\)/);
});

test('callout preview matches renderer defaults and nested opacity', () => {
  assert.match(viewerSource, /style\.borderColor \|\| style\.lineColor \|\| '#1e293b'/);
  assert.match(viewerSource, /style\.fillColor \|\| 'transparent'/);
  assert.match(viewerSource, /Math\.max\(0\.2, Math\.min\(1, Number\(style\.borderOpacity \?\? 1\)\)\)/);
  assert.match(viewerSource, /Math\.max\(0\.08, Math\.min\(1, Number\(style\.fillOpacity \?\? 0\.4\)\)\)/);
  assert.match(viewerSource, /effectivePreviewColor\(fill, borderOpacity \* fillOpacityValue\)/);
});

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-17, quick styles).
 *
 * What this test is for has NOT changed: every swatch in the tool-properties
 * row must show the selected mark's exact colour when there is one, and fall
 * back to the armed tool's default otherwise. Two of its five lines named the
 * CSS property each channel is painted with, and on the shape swatch those two
 * swapped: the DISC is now the border and the 2px ring around it is the fill,
 * so that the disc and the four quick colour dots beside it are the same
 * channel (see the swatch's own comment in AppShell). The `?? ensureRgbaOpacity`
 * contract each line guards is untouched — only which side of the swatch it is
 * read off.
 */
/*
 * DELIBERATE ASSERTION CHANGE (2026-09-22, pass 7 integration).
 *
 * What this test is for STILL has not changed: every colour control in the
 * tool-properties row must show the selected mark's exact colour when there is
 * one and fall back to the armed tool's default otherwise. What changed is where
 * those four values are read: boards 8-12 replace the bar's two hand-drawn
 * swatches — a flat "Color" disc and a border/fill circle — with the shared
 * <QuickPaintSwatch>, so the values are named once each and handed to it as
 * `ring` and `center` instead of being written straight into a CSS `background`
 * and `border`. The `?? ensureRgbaOpacity(...)` contract and every fallback
 * (#ef4444, #ffffff, #000000, #ffffff) are untouched, which is what the lines
 * below check.
 */
test('every annotation swatch prefers exact selected colors over tool defaults', () => {
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner ruling "the counter
  // icon is the app's real pin, NEVER a circle", board 11): the counter swatch
  // draws the owner's traced PIN instead of a round disc with a "1" on it, so its
  // two colours are named once each as `pinColour` / `numberColour` and handed to
  // the pin's fill and its numeral. The contract this test guards is unchanged —
  // the selected mark's exact colour wins, the armed tool's default is the
  // fallback, and the fallbacks are still #ef4444 and #ffffff.
  assert.match(
    appShellSource,
    /const pinColour = bottomToolbarApi\.selectedFillColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.fillColor \|\| '#ef4444'/,
  );
  assert.match(
    appShellSource,
    /const numberColour = bottomToolbarApi\.selectedStrokeColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.strokeColor \|\| '#ffffff'/,
  );
  // The counter's pin rings in the pin colour and centres the number colour.
  assert.match(appShellSource, /ring=\{isCounter \? pinColour : borderColour\}/);
  assert.match(appShellSource, /center=\{isCounter \? numberColour : fillColour\}/);
  // A shape's border — the ring, and the channel the quick dots act on.
  assert.match(
    appShellSource,
    /const borderColour = bottomToolbarApi\.selectedStrokeColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.strokeColor \|\| '#000000'/,
  );
  // A shape's fill — the centre of the swatch.
  assert.match(
    appShellSource,
    /const fillColour = bottomToolbarApi\.selectedFillColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.fillColor \|\| '#ffffff'/,
  );
});

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
  assert.match(viewerSource, /handleTextMarkupPaintChange,/);
  assert.match(appShellSource, /isTextMarkupPalette && bottomToolbarApi\.handleTextMarkupPaintChange/);
  assert.match(appShellSource, /handleTextMarkupPaintChange\(hex, Math\.round\(alpha \* 100\)\)/);
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

test('switching Fill and Number keeps the counter color picker open', () => {
  assert.match(appShellSource, /setColorPickerTab\(k\);\s*bottomToolbarApi\.setShowAnnotationColorPicker\(true\);/);
});

test('callout preview matches renderer defaults and nested opacity', () => {
  assert.match(viewerSource, /style\.borderColor \|\| style\.lineColor \|\| '#1e293b'/);
  assert.match(viewerSource, /style\.fillColor \|\| 'transparent'/);
  assert.match(viewerSource, /Math\.max\(0\.2, Math\.min\(1, Number\(style\.borderOpacity \?\? 1\)\)\)/);
  assert.match(viewerSource, /Math\.max\(0\.08, Math\.min\(1, Number\(style\.fillOpacity \?\? 0\.4\)\)\)/);
  assert.match(viewerSource, /effectivePreviewColor\(fill, borderOpacity \* fillOpacityValue\)/);
});

test('every annotation swatch prefers exact selected colors over tool defaults', () => {
  assert.match(
    appShellSource,
    /background: bottomToolbarApi\.selectedStrokeColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.strokeColor/,
  );
  assert.match(
    appShellSource,
    /background: bottomToolbarApi\.selectedFillColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.fillColor \|\| '#ef4444'/,
  );
  assert.match(
    appShellSource,
    /color: bottomToolbarApi\.selectedStrokeColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.strokeColor \|\| '#ffffff'/,
  );
  assert.match(
    appShellSource,
    /border: `2px solid \$\{bottomToolbarApi\.selectedStrokeColor \?\? ensureRgbaOpacity/,
  );
  assert.match(
    appShellSource,
    /background: bottomToolbarApi\.selectedFillColor \?\? ensureRgbaOpacity\(bottomToolbarApi\.fillColor \|\| '#ffffff'/,
  );
});

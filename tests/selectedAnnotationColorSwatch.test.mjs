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
    /const currentSelectedAnnot = annotationsByPage\?\.\[selectedToolbarAnnotation\?\.pageNumber\]\?\.objects\?\.\[selectedToolbarAnnotation\?\.annotationIndex\]/,
  );
  assert.match(viewerSource, /selectedFillColor: selectedPreviewColors\.fill,/);
  assert.match(viewerSource, /selectedStrokeColor: selectedPreviewColors\.stroke,/);
  assert.match(viewerSource, /annotationsByPage,/);
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

test('selected preview cannot override an armed drawing tool or mutate picker bases', () => {
  assert.match(
    viewerSource,
    /if \(activeTool !== 'select'\) return \{ fill: null, stroke: null \};/,
  );
  assert.match(viewerSource, /\n\s+strokeColor,\n\s+strokeOpacity,\n\s+selectedStrokeColor:/);
  assert.match(viewerSource, /\n\s+fillColor,\n\s+fillOpacity,\n\s+selectedFillColor:/);
  assert.doesNotMatch(viewerSource, /strokeColor: publishedStrokeColor/);
  assert.doesNotMatch(viewerSource, /fillColor: publishedFillColor/);
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

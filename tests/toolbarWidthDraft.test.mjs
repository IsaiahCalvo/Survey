import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewerSource = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);

test('toolbar publishes synchronous pen and eraser width drafts instead of stale effect state', () => {
  assert.match(
    viewerSource,
    /Mirror only the tool discriminator before paint[\s\S]*?useLayoutEffect\(\(\) => \{[\s\S]*?current\.activeTool === activeTool[\s\S]*?activeTool,\s*strokeWidthInputValue: strokeWidthInputValueRef\.current,\s*eraserSizeInputValue: eraserSizeInputValueRef\.current/,
  );
  assert.match(
    viewerSource,
    /strokeWidthInputValue:\s*strokeWidthInputValueRef\.current/,
  );
  assert.match(
    viewerSource,
    /eraserSizeInputValue:\s*eraserSizeInputValueRef\.current/,
  );
  // DELIBERATE ASSERTION CHANGE (2026-09-09, cloud-fill-knockout): the width
  // draft is still applied synchronously (setStrokeWidth before the draft is
  // published), but it now goes through the shared decimal-aware
  // normalizeAnnotationSize (one decimal for line widths, whole numbers for
  // counter sizes) instead of parseInt, so "2.5" no longer truncates to 2.
  assert.match(
    viewerSource,
    /const isCounterSize = activeTool === 'counter' \|\| getSelectedShapeMeta\(\)\.isCounter;[\s\S]*?strokeWidthInputValueRef\.current = value;\s*setStrokeWidthInputValue\(value\);[\s\S]*?const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50;[\s\S]*?setStrokeWidth\(normalizeAnnotationSize\(value, minWidth, maxWidth, widthDecimals\)\);[\s\S]*?publishToolbarDraft\('strokeWidthInputValue', value\)/,
  );
  assert.match(
    viewerSource,
    /eraserSizeInputValueRef\.current = value;\s*setEraserSizeInputValue\(value\);[\s\S]*?setEraserSize\(Math\.min\(Math\.max\(parseInt\(value, 10\), 1\), 100\)\);[\s\S]*?publishToolbarDraft\('eraserSizeInputValue', value\)/,
  );
  assert.match(
    viewerSource,
    /isStrokeWidthFocusedRef\.current = nextFocused;\s*setIsStrokeWidthFocused\(nextFocused\)/,
  );
  assert.match(
    viewerSource,
    /isEraserSizeFocusedRef\.current = nextFocused;\s*setIsEraserSizeFocused\(nextFocused\)/,
  );
  assert.doesNotMatch(
    viewerSource,
    /if \(!isEraserSizeFocused\) \{\s*const nextValue = String\(eraserSize\)/,
  );
});

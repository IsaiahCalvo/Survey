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
  assert.match(
    viewerSource,
    /strokeWidthInputValueRef\.current = value;\s*setStrokeWidthInputValue\(value\);[\s\S]*?setStrokeWidth\(Math\.min\(Math\.max\(parseInt\(value, 10\), 1\), 50\)\);[\s\S]*?publishToolbarDraft\('strokeWidthInputValue', value\)/,
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

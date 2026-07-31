import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const HOOK_SOURCE = readFileSync(
  new URL('../src/hooks/useAnnotationDoc.js', import.meta.url),
  'utf8',
);
const VIEWER_SOURCE = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);
const COVER_SOURCE = readFileSync(
  new URL('../src/components/annotationHydrationCover.jsx', import.meta.url),
  'utf8',
);

test('cloud PDFs stay concealed and non-editable until authoritative annotations finish opening', () => {
  assert.match(
    HOOK_SOURCE,
    /initialHydration,/,
    'the annotation hook must expose the authoritative open state',
  );
  assert.match(
    VIEWER_SOURCE,
    /documentId:\s*pdfFile\?\.id\s*\|\|\s*null,[\s\S]{0,240}normalHydration:\s*normalAnnotationHydration,[\s\S]{0,120}surveyHydration:\s*surveyAnnotationHydration/,
    'the viewer must gate against both hydration sources for the current document',
  );
  assert.match(
    VIEWER_SOURCE,
    /renderAnnotationHydrationPageCover\(pageNumber,\s*'pdfjs',\s*annotationVisualCoverActive\)/,
    'the viewer must cover the PDF page while annotation hydration is pending',
  );
  assert.match(
    VIEWER_SOURCE,
    /pointerEvents:\s*annotationVisualCoverActive\s*\?\s*'auto'\s*:\s*'none'/,
    'the page overlay must intercept editing during the startup window',
  );
  assert.match(
    COVER_SOURCE,
    /data-annotation-hydration-cover-active="true"/,
    'the active cover must be observable in the rendered DOM',
  );
  assert.match(
    COVER_SOURCE,
    /pointerEvents:\s*'auto'/,
    'the active cover must block pen and annotation input',
  );
});

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

// Owner 2026-10-04 ("it looked like we had two different loading screens"):
// the grey page with three pulsing dots is gone. The cover paints nothing —
// the PDF page shows as soon as it is drawn, the marks fade in when hydration
// is ready, and the cover only keeps input off the page until then.
test('hydration cover is see-through: the page shows, input waits, marks fade in', () => {
  assert.match(COVER_SOURCE, /aria-busy="true"/);
  assert.match(
    COVER_SOURCE,
    /role="status"[\s\S]*?aria-live="polite"[\s\S]*?>\s*Opening document\s*<\/span>/,
    'screen readers still hear that the document is opening',
  );
  assert.match(COVER_SOURCE, /background:\s*'transparent'/);
  assert.doesNotMatch(COVER_SOURCE, /data-annotation-hydration-skeleton|data-annotation-hydration-dot/,
    'no skeleton page and no loading dots');
  assert.doesNotMatch(COVER_SOURCE, /@keyframes|animation:/, 'nothing pulses');
  assert.doesNotMatch(COVER_SOURCE, /#e7edf1|#cbd4dc|#63717d/, 'no grey page paint');
  assert.match(
    VIEWER_SOURCE,
    /opacity:\s*annotationHydrationGated \? 0 : undefined,\s*\n\s*transition:\s*'opacity 180ms ease-out'/,
    'the marks fade in when the gate lifts',
  );
});

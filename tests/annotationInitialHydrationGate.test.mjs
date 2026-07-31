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

test('hydration cover renders the approved generic synchronized-cool page treatment', () => {
  assert.match(
    COVER_SOURCE,
    /data-annotation-hydration-skeleton="true"/,
    'the cover must expose the PDF skeleton marker',
  );
  assert.match(
    COVER_SOURCE,
    /aria-hidden="true"/,
    'skeleton visuals must stay hidden from assistive technology',
  );
  assert.match(COVER_SOURCE, /aria-busy="true"/);
  assert.match(
    COVER_SOURCE,
    /role="status"[\s\S]*?aria-live="polite"[\s\S]*?>\s*Opening document\s*<\/span>/,
    'the loading announcement must live outside the busy region so it is spoken',
  );
  assert.equal(
    (COVER_SOURCE.match(/data-annotation-hydration-dot="true"/g) || []).length,
    3,
    'the generic treatment must contain exactly three loading dots',
  );
  assert.match(COVER_SOURCE, /background:\s*'#e7edf1'/);
  assert.match(COVER_SOURCE, /background:\s*#cbd4dc/);
  assert.match(COVER_SOURCE, /background:\s*#63717d/);
  assert.match(COVER_SOURCE, /width:\s*5px;[\s\S]*?height:\s*5px;/);
  assert.match(
    COVER_SOURCE,
    /animation:\s*annotationHydrationPagePulse 2s ease-in-out 850ms infinite/,
    'the page pulse must use the approved shared timing',
  );
  assert.match(
    COVER_SOURCE,
    /animation:\s*annotationHydrationDotPulse 2s ease-in-out 850ms infinite/,
    'the dots must use the same duration, easing, and delay as the page pulse',
  );
  assert.doesNotMatch(
    COVER_SOURCE,
    /Loading annotations/,
    'the old visible loading copy must not remain',
  );
  assert.doesNotMatch(
    COVER_SOURCE,
    /annotation-hydration-(?:rule|line|table|cell|title-block)/,
    'fake document content must not return to the generic page treatment',
  );
  assert.equal(
    (COVER_SOURCE.match(/<div\b/g) || []).length,
    3,
    'the treatment must remain limited to the cover, paper, and dot wrapper',
  );
  assert.equal(
    (COVER_SOURCE.match(/<span\b/g) || []).length,
    4,
    'the treatment must contain only the accessible status and three dots',
  );
  assert.doesNotMatch(
    COVER_SOURCE,
    /<(?:table|thead|tbody|tr|th|td|p|hr|svg|canvas)\b/i,
    'document-like elements must not be added to the generic loading treatment',
  );
  assert.doesNotMatch(COVER_SOURCE, /annotationHydrationSpin/);
  assert.match(
    COVER_SOURCE,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.annotation-hydration-paper::after,[\s\S]*?\.annotation-hydration-dot[\s\S]*?animation:\s*none/,
    'reduced-motion users must receive static page and dot cues',
  );
});

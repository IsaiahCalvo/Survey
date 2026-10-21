// First-run walk #7: the phone top bar has a labelled Export button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');

test('header has a labelled Export button wired to the kebab export action; kebab row kept', () => {
  const header = chrome.slice(chrome.indexOf('className="mobile-pdf-header"'), chrome.indexOf('mobile-pdf-header__pages'));
  assert.match(header, /aria-label="Export"/);
  assert.match(header, /bottomToolbarApi\?\.exportAnnotatedPdf\?\.\(\)/);
  assert.match(chrome, /Export annotated PDF\n\s*<\/button>/);
});

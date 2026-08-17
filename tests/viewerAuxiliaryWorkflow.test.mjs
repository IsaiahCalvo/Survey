import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const harness = readFileSync('agent-cli/mobile-workflows/viewer-auxiliary-e2e.mjs', 'utf8');
const linkLayer = readFileSync('src/components/PdfjsLinkLayer.jsx', 'utf8');
const viewerContainer = readFileSync('src/components/PdfjsViewerContainer.jsx', 'utf8');

test('viewer auxiliary workflow owns exact mobile and desktop contracts', () => {
  assert.match(harness, /mobile: \{ width: 390, height: 844 \}/);
  assert.match(harness, /desktop: \{ width: 1512, height: 900 \}/);
  assert.match(harness, /hasTouch: device === 'mobile'/);
  assert.match(harness, /createTouchDriver/);
  assert.match(harness, /touch\.inputKind/);
  assert.match(harness, /desktop-mouse-keyboard/);
  assert.match(harness, /Promise\.allSettled\(devices\.map/);
});

test('viewer auxiliary workflow uses only real no-auth fixtures and safe external interception', () => {
  assert.match(harness, /clickable-link-test\.pdf/);
  assert.match(harness, /text-search-glyph-lab\.pdf/);
  assert.match(harness, /\?testPdf=/);
  assert.match(harness, /window\.__viewerAuxOpenedUrls/);
  assert.match(harness, /https:\\\/\\\/claude\\\.com/);
  assert.match(harness, /local viewer must not navigate/);
  assert.doesNotMatch(harness, /DEV_AUTO_LOGIN|SERVICE_ROLE|bot-credentials|signInWithPassword/);
});

test('viewer auxiliary workflow reports every requested fixture row and fails visible fixture regressions', () => {
  for (const scenario of [
    'real no-auth viewer route',
    'PDF text search and result navigation',
    'clickable PDF link safely intercepted',
    'zoom in, zoom out, and fit',
    'page navigation',
    'form typing and checking',
    'back and reopen',
    'hard reload form persistence',
  ]) {
    assert.match(harness, new RegExp(scenario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(harness, /status, evidence/);
  assert.match(harness, /'failed'/);
  assert.match(harness, /Viewer auxiliary product failures/);
  assert.match(harness, /expectedFixtureAnnotation/);
  assert.match(harness, /real PdfjsLinkLayer exposed/);
});

test('viewer auxiliary artifacts retain browser failures and critical request evidence', () => {
  assert.match(harness, /page\.on\('pageerror'/);
  assert.match(harness, /message\.type\(\) === 'error'/);
  assert.match(harness, /page\.on\('requestfailed'/);
  assert.match(harness, /CRITICAL_RESOURCE_TYPES/);
  assert.match(harness, /criticalFailedRequests/);
  assert.match(harness, /summary\.json/);
  assert.match(harness, /page\.screenshot/);
  assert.match(harness, /ensureViteServer/);
});

test('PDF link geometry uses the pdf.js 5 PageViewport point API', () => {
  assert.match(linkLayer, /convertToViewportPoint\(a\.rect\[0\], a\.rect\[1\]\)/);
  assert.match(linkLayer, /convertToViewportPoint\(a\.rect\[2\], a\.rect\[3\]\)/);
  assert.doesNotMatch(linkLayer, /viewport\.convertToViewportRectangle\(/);
});

test('desktop pan preserves native PDF form and link pointer sequences', () => {
  assert.match(viewerContainer, /if \(isEditableTarget\(event\.target\)/);
  assert.match(viewerContainer, /a\[href\], \.linkAnnotation, \[data-element-id="link"\]/);
  assert.match(viewerContainer, /Pan owns blank document space, never native controls/);
});

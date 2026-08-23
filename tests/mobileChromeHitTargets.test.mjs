import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for the 390×844 chrome hit-target cluster.
// Live proof is debug/scenarios/e2e-mobile-chrome-hit-targets.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('mobile viewer More / history / sync / dock are distinct 390 hit targets', () => {
  const chrome = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(chrome, /label="More document options"/);
  assert.match(chrome, /Export annotated PDF/);
  assert.match(chrome, /Zoom out/);
  assert.match(chrome, /Zoom in/);
  assert.match(chrome, /disabled=\{!leftRailApi\?\.documentId\}/);
  assert.match(chrome, /disabled=\{leftRailApi\?\.cloudSyncEnabled === false\}/);
  assert.match(chrome, /aria-label="Open spaces"/);
  assert.match(chrome, /aria-label="Open pages, search, and bookmarks"/);
  assert.match(chrome, /aria-label="Open survey"/);
  assert.match(chrome, /aria-label="Jump to page"/);
  assert.match(chrome, /ref=\{bottomToolbarApi\?\.pageInputRef\}/);
  assert.match(chrome, /ZOOM_MODE_OPTIONS\.filter\(\(option\) => option\.id !== 'manual'\)/);
  assert.doesNotMatch(chrome, /Capacitor\?\.isNativePlatform[\s\S]{0,80}Export annotated PDF/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /window\.matchMedia\('\(max-width: 720px\)'\)/);
  assert.match(shell, /isMobileViewer \? \(\s*<MobilePdfViewerHeader/);
  assert.match(shell, /KeyboardShortcutsOverlay only renders on the home tab/);
  assert.match(shell, /isDevTestPdfRoute/);
  assert.match(shell, /has\('testPdf'\)/);
  assert.match(shell, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(shell, /!isViewerVisible && <KeyboardShortcutsOverlay \/>/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /commitPageInput\(e\.target\?\.value\)/);
  assert.match(viewer, /Prefer the live input value/);
});

test('mobile hub documents list / filter / detail are 720px hit targets, not the desktop extras spec', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /documents-mobile-search-actions/);
  assert.match(ledger, /documents-desktop-search/);
  assert.match(ledger, /className="btn documents-mobile-filter"/);
  assert.match(ledger, /documents-mobile-sort-menu/);
  assert.match(ledger, /className="mobile-doc-card"/);
  assert.match(ledger, /onOpenDocument && onOpenDocument\(d\.raw\)/);
  assert.match(ledger, /window\.matchMedia\('\(max-width: 720px\)'\)\.matches/);
  assert.match(ledger, /setMobileDetailId\(doc\.id\)/);
  assert.match(ledger, />Open file</);
  assert.match(ledger, /documents-mobile-detail-actions/);

  const hubCss = read('src/home/hub.css');
  assert.match(hubCss, /@media \(max-width: 720px\)/);
  assert.match(hubCss, /\.survey-hub \.documents-desktop-card[\s\S]{0,80}display: none !important/);
  assert.match(hubCss, /\.survey-hub \.documents-mobile-list/);
});

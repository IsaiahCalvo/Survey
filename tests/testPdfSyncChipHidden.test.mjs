import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts: ?testPdf= mock auth must not entitle cloud sync chrome.
// Live proof: debug/scenarios/e2e-testpdf-sync-chip-hidden.spec.mjs
// Distinct from leftover-18 / UL-44 signed-in Retry / nameless-menu.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('DevTestRoute mock auth keeps cloudSync off; no file.id stamp', () => {
  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /cloud-aware consumers must remain offline/);
  assert.match(dev, /cloudSync: false/);
  assert.doesNotMatch(dev, /cloudSync: true/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.match(dev, /file\.__localHistoryDocumentId = `dev-testpdf:\$\{pdfName\}`/);
  assert.match(dev, /function DevSyncChipPreview/);
  assert.match(dev, /window\.__test_setSyncChipPreview/);
  assert.match(dev, /sidebar chip stays correctly hidden/);
});

test('sidebar chip still gates on cloudSyncEnabled; History stays documentId-gated', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /cloudSyncEnabled && !mobileMode/);
  assert.match(sidebar, /\{documentId && <HistoryButton/);
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /leftRailApi\?\.cloudSyncEnabled === true/);
  assert.match(mobile, /disabled=\{!leftRailApi\?\.cloudSyncEnabled\}/);
  assert.doesNotMatch(mobile, /cloudSyncEnabled !== false/);
});

test('live spec covers intended + break + edge; skip leftover-18 and nameless-menu', () => {
  const spec = read('debug/scenarios/e2e-testpdf-sync-chip-hidden.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /__test_setSyncChipPreview/);
  assert.match(spec, /checking whether this document uses live collaboration/);
  assert.match(spec, /Cloud sync unavailable/);
  assert.match(spec, /unavailable\\. undefined/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('menuitem'/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});

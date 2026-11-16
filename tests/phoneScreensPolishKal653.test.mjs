// KAL-653 (owner 2026-11-16: "check the UIs, make sure all the UIs are
// pretty"): what the phone screen pass fixed, so it stays fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const hub = read('src/home/hub.css');
const settings = read('src/components/AccountSettings.css');

test('a phone search field shows its hint at 12px, so "Search documents..." fits', () => {
  assert.match(hub, /\.survey-hub \.hub-search input::placeholder \{\s*font-size: 12px;\s*\}/);
});

test('the phone "no match" lines keep clear of the card edge, as Archive and desktop do', () => {
  const documents = read('src/home/DocumentsLedger.jsx');
  const projects = read('src/home/ProjectsFolderTree.jsx');
  assert.doesNotMatch(documents, /padding: '18px 4px'/);
  assert.doesNotMatch(projects, /padding: '14px 4px'/);
  assert.match(projects, /padding: '24px 16px' \}\}>\{showClosed \|\| !closedTotal \|\| search\.trim\(\) \? 'No projects match your search\.'/);
});

test('the Archive sort button has a 44px touch band on the phone', () => {
  assert.match(hub, /\.archive-mobile-search-row > \.archive-filter-button::after \{\s*content: '';\s*position: absolute;\s*inset: -5px 0 -13px;/);
});

test('a connected service row wraps its words beside the button and keeps its icon tile', () => {
  assert.match(settings, /\.account-connected-account-info \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;/);
  assert.match(settings, /\.account-connected-account-details \{\s*min-width: 0;/);
  assert.match(settings, /\.account-connected-account-actions \{\s*flex: none;/);
  assert.match(settings, /\.account-connected-account-icon \{\s*flex: none;/);
});

test('the Privacy policy link in Settings is the calm --link, not the browser colour', () => {
  assert.match(settings, /\.account-pref-description a \{\s*color: var\(--link\);/);
});

// Round 2: the phone Pages sheet.
const viewer = read('src/mobile/mobilePdfViewer.css');

test('Pages sheet tabs press like every other icon: the glyph tightens, no grey plate', () => {
  assert.match(read('src/styles/states.css'), /:not\(\.mobile-pdf-dock__center\):not\(\.mobile-pdf-hub-tab\)/);
  assert.match(viewer, /\.mobile-pdf-hub-tabs \.mobile-pdf-hub-tab:not\(:disabled\):active > :is\(svg, span\[aria-hidden="true"\]\) \{\s*scale: 0\.92;/);
});

test('Pages sheet tabs, the select bar and the action pill all have 44px touch boxes', () => {
  // 34x32 tab + 5px / 6px each side.
  assert.match(viewer, /\.mobile-pdf-hub-tabs \.mobile-pdf-hub-tab::after \{\s*content: '';\s*position: absolute;\s*inset: -6px -5px;/);
  // 28px words; the sheet body clips above them, so the pad grows down 16px.
  assert.match(viewer, /\.mobile-pages-counter\.is-selecting > button::after \{\s*content: '';\s*position: absolute;\s*inset: 0 -8px -16px;/);
  // 28px chips; 10px up + 6px down (the sheet body clips 4px under the pill).
  assert.match(viewer, /\.mobile-pages-actions > button::after \{\s*content: '';\s*position: absolute;\s*inset: -10px 0 -6px;/);
});

test("Select mode's tick circle sits on the page picture, not the card corner", () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  const preview = panel.slice(panel.indexOf("className={mobileMode ? 'mobile-page-preview' : 'pages-panel-preview'}"));
  const circle = preview.indexOf('mobile-page-select-indicator');
  assert.ok(circle > 0 && circle < preview.indexOf('{thumbnailSrc ? ('), 'the circle is drawn inside the page picture');
  assert.equal(panel.split('mobile-page-select-indicator').length - 1, 1);
  assert.match(viewer, /\.mobile-page-select-indicator \{\s*position: absolute;\s*left: 5px;\s*top: 5px;\s*pointer-events: none;/);
});

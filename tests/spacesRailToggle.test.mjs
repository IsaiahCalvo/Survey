import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Desktop collapsed-rail Spaces tab (48 → 272 Spaces panel) + 390 Open spaces.
// Live proof: debug/scenarios/e2e-spaces-rail-toggle.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// Expand Survey / left-rail History Collapse sidebar / Spaces card Expand.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('collapsed left-rail Spaces is type=button and expands to the Spaces panel', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /\{ id: 'spaces', label: 'Spaces', icon: 'layers' \}/);
  assert.match(sidebar, /isCollapsed \? '48px' : '272px'/);
  assert.match(sidebar, /const \[isCollapsed, setIsCollapsed\] = useState\(true\)/);
  assert.match(sidebar, /const \[activeTab, setActiveTab\] = useState\('pages'\)/);

  const collapsed = sidebar.slice(sidebar.indexOf('Collapsed State'));
  const spacesLabel = collapsed.indexOf('aria-label={tab.label}');
  assert.notEqual(spacesLabel, -1, 'collapsed rail must label Pages/Search/Bookmarks/Spaces');
  const collapsedButton = collapsed.slice(collapsed.lastIndexOf('<button', spacesLabel), spacesLabel + 40);
  assert.match(collapsedButton, /type="button"/);
  assert.match(collapsed, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    collapsed.slice(collapsed.indexOf('onClick={() => {'), collapsed.indexOf('style={{')),
    /setIsCollapsed\(false\);\s*setActiveTab\(tab\.id\)/,
    'collapsed Spaces must use openPanel after the Search focus-token SHA',
  );

  const expanded = sidebar.slice(sidebar.indexOf('Tab Navigation'), sidebar.indexOf('Collapsed State'));
  assert.match(expanded, /type="button"/);
  assert.match(expanded, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    expanded.slice(expanded.indexOf('onClick={() => {'), expanded.indexOf('style={{')),
    /setActiveTab\(tab\.id\);/,
    'expanded Spaces tab must also route through openPanel',
  );

  assert.match(sidebar, /aria-label=\{isCollapsed \? 'Expand sidebar' : 'Collapse sidebar'\}/);
  assert.match(sidebar, /type="button"/);
});

test('390 Open spaces is the mobile leftover, not the 48px Spaces icon', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Open spaces"/);
  assert.match(mobile, /onClick=\{\(\) => onOpenPanel\?\.\('spaces'\)\}/);
  assert.doesNotMatch(mobile, /Expand Spaces/);
});

test('live spec covers Spaces rail toggle intended + break + edge; skip leftover-18 and Survey replay', () => {
  const spec = read('debug/scenarios/e2e-spaces-rail-toggle.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Spaces rail toggle intended \+ break \+ edge/);
  assert.match(spec, /390 Open spaces sheet edge/);
  assert.match(spec, /collapsed rail Spaces must be live/);
  assert.match(spec, /Expand sidebar must not open Spaces/);
  assert.match(spec, /expanded Spaces panel is 272/);
  assert.match(spec, /Escape must not collapse Spaces/);
  assert.match(spec, /Space must not collapse Spaces/);
  assert.match(spec, /double-click Spaces must stay expanded/);
  assert.match(spec, /hubPreview viewer Spaces panel 0/);
  assert.match(spec, /page-1 rect must survive Spaces/);
  assert.match(spec, /Pen-armed Spaces invents 0/);
  assert.match(spec, /Spaces must not change page/);
  assert.match(spec, /390 Spaces panel 0 until Open spaces/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /collapsed rail Expand Survey must be live/);
  assert.doesNotMatch(spec, /Expand click must show Collapse Survey/);
  assert.doesNotMatch(spec, /Control\+=/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /onExportSpaceCSV|onExportSpacePDF/);
});

test('hunt goes beyond Expand Survey hunt and skips leftover-18 / Survey replay', () => {
  const hunt = read('debug/scenarios/e2e-after-expand-survey-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Expand Survey panel leftover/);
  assert.match(hunt, /e2e-after-zoom-buttons-independent-hunt/);
  assert.match(hunt, /Spaces rail toggle/);
  assert.match(hunt, /Open spaces/);
  assert.match(hunt, /Create space/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Expand Survey panel stays open/);
  assert.doesNotMatch(hunt, /Control\+=/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
});

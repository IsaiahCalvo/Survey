import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Desktop collapsed-rail Bookmarks tab (48 → 272 empty Bookmarks panel)
// + 390 Open pages, search, and bookmarks → Bookmarks.
// Live proof: debug/scenarios/e2e-bookmarks-rail-toggle.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// Search rail toggle / Spaces rail toggle / Expand Survey / V-07
// jump-rename-group / dest-XYZ remapping.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('collapsed left-rail Bookmarks routes through openPanel to the empty panel', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /\{ id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' \}/);
  assert.match(sidebar, /isCollapsed \? '48px' : '272px'/);
  assert.match(sidebar, /const \[isCollapsed, setIsCollapsed\] = useState\(true\)/);
  assert.match(sidebar, /const \[activeTab, setActiveTab\] = useState\('pages'\)/);
  assert.match(sidebar, /const validPanel = \['pages', 'search', 'bookmarks', 'spaces', 'history'\]/);

  const collapsed = sidebar.slice(sidebar.indexOf('Collapsed State'));
  const bookmarksLabel = collapsed.indexOf('aria-label={tab.label}');
  assert.notEqual(bookmarksLabel, -1, 'collapsed rail must label Pages/Search/Bookmarks/Spaces');
  const collapsedButton = collapsed.slice(collapsed.lastIndexOf('<button', bookmarksLabel), bookmarksLabel + 40);
  assert.match(collapsedButton, /type="button"/);
  assert.match(collapsed, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    collapsed.slice(collapsed.indexOf('onClick={() => {'), collapsed.indexOf('style={{')),
    /setIsCollapsed\(false\);\s*setActiveTab\(tab\.id\)/,
    'collapsed Bookmarks must use openPanel',
  );

  const expanded = sidebar.slice(sidebar.indexOf('Tab Navigation'), sidebar.indexOf('Collapsed State'));
  assert.match(expanded, /type="button"/);
  assert.match(expanded, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    expanded.slice(expanded.indexOf('onClick={() => {'), expanded.indexOf('style={{')),
    /setActiveTab\(tab\.id\);/,
    'expanded Bookmarks tab must also route through openPanel',
  );
});

test('desktop Add bookmark empty chrome is type=button; 390 leftover is the hub tab', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  const desktopAdd = panel.slice(panel.indexOf('Add Button at Bottom'));
  assert.match(desktopAdd, /type="button"/);
  assert.match(desktopAdd, /aria-label="Add bookmark"/);
  assert.match(desktopAdd, /No bookmarks yet\. Create one to get started\./);
  assert.doesNotMatch(desktopAdd.slice(0, desktopAdd.indexOf('Add bookmark') + 20), /destination|dest\.xyz|XYZ/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Open pages, search, and bookmarks"/);
  assert.match(mobile, /hubLabels = \{ pages: 'Pages', search: 'Search', bookmarks: 'Bookmarks' \}/);
  assert.doesNotMatch(mobile, /Expand Bookmarks/);
});

test('live spec covers Bookmarks rail toggle intended + break + edge; skip leftover-18 and Search replay', () => {
  const spec = read('debug/scenarios/e2e-bookmarks-rail-toggle.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Bookmarks rail toggle intended \+ break \+ edge/);
  assert.match(spec, /390 Open pages\/search\/bookmarks Bookmarks tab edge/);
  assert.match(spec, /collapsed rail Bookmarks must be live/);
  assert.match(spec, /Expand sidebar must not open Bookmarks/);
  assert.match(spec, /overlay lists B Toggle sidebar/);
  assert.match(spec, /expanded Bookmarks panel is 272/);
  assert.match(spec, /Escape must not collapse Bookmarks/);
  assert.match(spec, /Space must not collapse Bookmarks/);
  assert.match(spec, /double-click Bookmarks must stay expanded/);
  assert.match(spec, /hubPreview viewer Bookmarks panel 0/);
  assert.match(spec, /page-1 rect must survive Bookmarks/);
  assert.match(spec, /Pen-armed Bookmarks invents 0/);
  assert.match(spec, /Bookmarks must not change page/);
  assert.match(spec, /390 hub defaults to Pages not Bookmarks/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Search text tab must focus the field/);
  assert.doesNotMatch(spec, /expanded Spaces panel is 272/);
  assert.doesNotMatch(spec, /Control\+=/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /goToBookmarkSource|dest\.xyz|invent XYZ/);
});

test('hunt goes beyond Search hunt and skips leftover-18 / Bookmarks replay as leftover', () => {
  const hunt = read('debug/scenarios/e2e-after-search-rail-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Search rail toggle leftover/);
  assert.match(hunt, /e2e-after-spaces-rail-independent-hunt/);
  assert.match(hunt, /Pages tab-as-switcher from Bookmarks/);
  assert.match(hunt, /390 Bookmarks tab/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Search text tab must focus the field/);
  assert.doesNotMatch(hunt, /expanded Bookmarks panel is 272/);
  assert.doesNotMatch(hunt, /Control\+=/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Expanded left-rail Pages tab-as-switcher (Bookmarks / Search / Spaces
// → Pages without navigating) + 390 hub Bookmarks → Pages.
// Live proof: debug/scenarios/e2e-pages-tab-as-switcher.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// Bookmarks rail toggle / Search rail toggle / Spaces rail toggle /
// Expand Survey / Expand sidebar→Pages / V-06 thumbnail jump / dest-XYZ.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('expanded Pages tab routes through openPanel and does not navigate', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /\{ id: 'pages', label: 'Pages', icon: 'pages' \}/);
  assert.match(sidebar, /isCollapsed \? '48px' : '272px'/);
  assert.match(sidebar, /const \[isCollapsed, setIsCollapsed\] = useState\(true\)/);
  assert.match(sidebar, /const \[activeTab, setActiveTab\] = useState\('pages'\)/);
  assert.match(sidebar, /const validPanel = \['pages', 'search', 'bookmarks', 'spaces', 'history'\]/);

  const expanded = sidebar.slice(sidebar.indexOf('Tab Navigation'), sidebar.indexOf('Collapsed State'));
  assert.match(expanded, /type="button"/);
  assert.match(expanded, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    expanded.slice(expanded.indexOf('onClick={() => {'), expanded.indexOf('style={{')),
    /onNavigateToPage/,
    'Pages tab click must not navigate',
  );
  assert.doesNotMatch(
    expanded.slice(expanded.indexOf('onClick={() => {'), expanded.indexOf('style={{')),
    /setActiveTab\(tab\.id\);/,
    'expanded Pages tab must also route through openPanel',
  );

  const pagesMount = sidebar.slice(sidebar.indexOf('{/* Pages Panel */}'));
  assert.match(pagesMount, /display: activeTab === 'pages' \? 'flex' : 'none'/);
  assert.match(pagesMount, /<PagesPanel/);
});

test('PagesPanel thumbnail click is the only navigate path; tab switcher is not', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  assert.match(panel, /alt=\{`Page \$\{pageNumber\}`\}/);
  assert.match(panel, /onClick=\{\(\) => handlePageClick\(pageNumber\)\}/);
  assert.match(panel, /onNavigateToPage\(action\.pageNumber\)/);
  assert.match(panel, /resolvePageThumbnailClick/);
  assert.doesNotMatch(panel, /openPanel\(/);

  const utils = read('src/sidebar/pagesPanelUtils.js');
  assert.match(utils, /return \{ kind: 'navigate', pageNumber: page \}/);
  assert.match(utils, /kind: 'toggle-select'/);
});

test('live spec covers Pages tab-as-switcher intended + break + edge; skip leftover-18 and Bookmarks replay', () => {
  const spec = read('debug/scenarios/e2e-pages-tab-as-switcher.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Pages tab-as-switcher intended \+ break \+ edge/);
  assert.match(spec, /390 Open pages\/search\/bookmarks Pages tab-as-switcher edge/);
  assert.match(spec, /Expand sidebar opens Pages/);
  assert.match(spec, /overlay lists B Toggle sidebar/);
  assert.match(spec, /Bookmarks → Pages must not jump/);
  assert.match(spec, /Search → Pages must not jump/);
  assert.match(spec, /Spaces → Pages must not jump/);
  assert.match(spec, /Escape must not collapse Pages/);
  assert.match(spec, /Space must not collapse Pages/);
  assert.match(spec, /double-click Pages must stay expanded/);
  assert.match(spec, /hubPreview viewer Pages thumbnails 0/);
  assert.match(spec, /page-1 rect must survive Pages switcher/);
  assert.match(spec, /Pen-armed Pages switcher invents 0/);
  assert.match(spec, /Bookmarks → Pages must stay on page 2/);
  assert.match(spec, /390 Bookmarks → Pages must not jump/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Search text tab must focus the field/);
  assert.doesNotMatch(spec, /expanded Bookmarks panel is 272/);
  assert.doesNotMatch(spec, /Control\+=/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /goToBookmarkSource|dest\.xyz|invent XYZ/);
});

test('hunt goes beyond Search hunt and skips leftover-18 / Pages switcher replay as leftover', () => {
  const hunt = read('debug/scenarios/e2e-after-bookmarks-rail-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Bookmarks rail toggle leftover/);
  assert.match(hunt, /e2e-after-search-rail-independent-hunt/);
  assert.match(hunt, /collapsed-rail Version history/);
  assert.match(hunt, /390 History/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Bookmarks → Pages must not jump/);
  assert.doesNotMatch(hunt, /expanded Pages panel is 272/);
  assert.doesNotMatch(hunt, /Control\+=/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
});

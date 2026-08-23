import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Desktop collapsed-rail Search text tab (48 → 272 Search panel + focus)
// + 390 Open pages, search, and bookmarks → Search.
// Live proof: debug/scenarios/e2e-search-rail-toggle.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// Spaces rail toggle / Expand Survey / V-08 Next-Previous / Match case=0.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('collapsed left-rail Search text routes through openPanel so the field focuses', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /\{ id: 'search', label: mobileMode \? 'Search' : 'Search text', icon: 'search' \}/);
  assert.match(sidebar, /isCollapsed \? '48px' : '272px'/);
  assert.match(sidebar, /const \[isCollapsed, setIsCollapsed\] = useState\(true\)/);
  assert.match(sidebar, /const \[activeTab, setActiveTab\] = useState\('pages'\)/);
  assert.match(sidebar, /openSearchPanel: \(\{ focus = true, select = true \} = \{\}\) => \{/);
  assert.match(sidebar, /if \(validPanel === 'search' && focus\) \{/);
  assert.match(sidebar, /setSearchFocusRequestToken\(\(prev\) => prev \+ 1\)/);

  const collapsed = sidebar.slice(sidebar.indexOf('Collapsed State'));
  const searchLabel = collapsed.indexOf('aria-label={tab.label}');
  assert.notEqual(searchLabel, -1, 'collapsed rail must label Pages/Search/Bookmarks/Spaces');
  const collapsedButton = collapsed.slice(collapsed.lastIndexOf('<button', searchLabel), searchLabel + 40);
  assert.match(collapsedButton, /type="button"/);
  assert.match(collapsed, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    collapsed.slice(collapsed.indexOf('onClick={() => {'), collapsed.indexOf('style={{')),
    /setIsCollapsed\(false\);\s*setActiveTab\(tab\.id\)/,
    'collapsed Search must not skip the focus token',
  );

  const expanded = sidebar.slice(sidebar.indexOf('Tab Navigation'), sidebar.indexOf('Collapsed State'));
  assert.match(expanded, /type="button"/);
  assert.match(expanded, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(
    expanded.slice(expanded.indexOf('onClick={() => {'), expanded.indexOf('style={{')),
    /setActiveTab\(tab\.id\);/,
    'expanded Search tab must also request focus',
  );
});

test('390 Search leftover is the hub dock, not the 48px Search text icon', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Open pages, search, and bookmarks"/);
  assert.match(mobile, /onClick=\{onToggleHub\}/);
  assert.doesNotMatch(mobile, /Expand Search/);
});

test('live spec covers Search rail toggle intended + break + edge; skip leftover-18 and Spaces replay', () => {
  const spec = read('debug/scenarios/e2e-search-rail-toggle.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Search text rail toggle intended \+ break \+ edge/);
  assert.match(spec, /390 Open pages\/search\/bookmarks Search tab edge/);
  assert.match(spec, /collapsed rail Search text must be live/);
  assert.match(spec, /Expand sidebar must not show Search field/);
  assert.match(spec, /Search text tab must focus the field/);
  assert.match(spec, /Escape must not collapse Search/);
  assert.match(spec, /Space must not collapse Search/);
  assert.match(spec, /double-click Search must stay expanded/);
  assert.match(spec, /hubPreview viewer Search field 0/);
  assert.match(spec, /page-1 rect must survive Search/);
  assert.match(spec, /Pen-armed Search invents 0/);
  assert.match(spec, /Search must not change page/);
  assert.match(spec, /390 Search tab must focus the field/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Expand click must show Collapse Survey/);
  assert.doesNotMatch(spec, /Control\+=/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
});

test('hunt goes beyond Spaces hunt and skips leftover-18 / Search replay as leftover', () => {
  const hunt = read('debug/scenarios/e2e-after-spaces-rail-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Spaces rail toggle leftover/);
  assert.match(hunt, /e2e-after-expand-survey-independent-hunt/);
  assert.match(hunt, /Bookmarks panel empty chrome/);
  assert.match(hunt, /No bookmarks yet/);
  assert.match(hunt, /Open pages, search, and bookmarks/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Search text tab must focus the field/);
  assert.doesNotMatch(hunt, /expanded Spaces panel is 272/);
  assert.doesNotMatch(hunt, /Control\+=/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
});

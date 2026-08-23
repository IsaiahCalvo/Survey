import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-home-tab-click.spec.mjs
// Unique leftover after toolbar click-to-arm.
// Desktop TabBar Home click is handleTabClick → dashboard without
// returnTab. Distinct from Close tab (handleTabClose) and from
// Open-file Home (returnToDevHubPreview).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('TabBar Home is a named keyboard-activable tab; Close stays on PDF tabs', () => {
  const tabBar = read('src/TabBar.jsx');
  assert.match(tabBar, /data-home-tab=\{isHome \? 'true' : undefined\}/);
  assert.match(tabBar, /role=\{isHome \? 'tab' : undefined\}/);
  assert.match(tabBar, /aria-label=\{isHome \? 'Home' : undefined\}/);
  assert.match(tabBar, /aria-selected=\{isHome \? isActive : undefined\}/);
  assert.match(tabBar, /tabIndex=\{isHome \? 0 : undefined\}/);
  assert.match(tabBar, /if \(e\.key === 'Enter'\)/);
  assert.match(tabBar, /Space is the global temporary-pan chord/);
  assert.match(tabBar, /onTabClick\(tab\.id\)/);
  assert.match(tabBar, /aria-label="Close tab"/);
  assert.match(tabBar, /\{!isHome && \(/);
  assert.doesNotMatch(tabBar, /returnToDevHubPreview/);
  assert.doesNotMatch(tabBar, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tabBar, /__e2eHomeTab/);
  assert.doesNotMatch(tabBar, /setCopyModeActive\(true\)/);
});

test('AppShell Home click without returnTab stays on dashboard; Close tab is different', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /const handleTabClick = \(tabId\) => \{/);
  assert.match(shell, /if \(tab\.isHome\) \{/);
  assert.match(shell, /if \(returnToDevHubPreview\(\)\) return;/);
  assert.match(shell, /setCurrentView\('dashboard'\)/);
  assert.match(shell, /\/\/ setSelectedPDF\(null\); \/\/ Keep selectedPDF to prevent unmounting/);
  assert.match(shell, /onTabClick=\{handleTabClick\}/);
  assert.match(shell, /const handleTabClose = \(tabId\) => \{/);
  assert.match(shell, /if \(tabId === HOME_TAB_ID\) return;/);
  assert.match(shell, /\{tabs\.length > 0 && !isNarrowShell && \(/);

  const homeClick = shell.slice(shell.indexOf('const handleTabClick'), shell.indexOf('const handleViewStateChange'));
  assert.match(homeClick, /if \(tab\.isHome\) \{/);
  assert.match(homeClick, /if \(returnToDevHubPreview\(\)\) return;/);
  assert.match(homeClick, /setCurrentView\('dashboard'\)/);

  const closeFn = shell.slice(shell.indexOf('const handleTabClose'), shell.indexOf('const handleTabReorder'));
  assert.doesNotMatch(closeFn, /returnToDevHubPreview/);
});

test('live spec covers Home click intended + break + edge; skip leftover-18 and Close/CW replay', () => {
  const spec = read('debug/scenarios/e2e-home-tab-click.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Home tab click intended \+ break \+ edge/);
  assert.match(spec, /390 Home tab click edge/);
  assert.match(spec, /Home click does not navigate away from testPdf/);
  assert.match(spec, /Home click without returnTab does not assign hubPreview/);
  assert.match(spec, /Home keep-mounted restores the same mark/);
  assert.match(spec, /Enter Home does not assign hubPreview/);
  assert.match(spec, /hubPreview has no Home tab/);
  assert.match(spec, /390 has no Home tab/);
  assert.match(spec, /file\.id must stay null/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Next page click must move a page/);
  assert.doesNotMatch(spec, /P must arm Pen/);
  assert.doesNotMatch(spec, /Rectangle button must arm Rectangle/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.match(spec, /Distinct from Close tab/);
  assert.doesNotMatch(spec, /name: 'Close tab'[^;\n]*\.click\(/);

  const close = read('debug/scenarios/e2e-tab-close.spec.mjs');
  assert.match(close, /Close tab leaves the viewer/);
  assert.doesNotMatch(close, /data-home-tab/);
  assert.doesNotMatch(close, /getByRole\('tab', \{ name: 'Home'/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

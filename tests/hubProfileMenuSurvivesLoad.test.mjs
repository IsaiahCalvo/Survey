import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Found by the signed-in E2E on the React 19 upgrade: the Home loading screen
// (HubLoading) and the loaded list (DocumentsLedger, ...) are two different
// HubShells, so the account menu opened while the list was loading shut the
// moment the list arrived. Its open state now lives in SurveyHub, which stays
// mounted across that swap, and reaches the menu through HubChromeContext.
const shell = readFileSync(new URL('../src/home/HubShell.jsx', import.meta.url), 'utf8');
const hub = readFileSync(new URL('../src/home/SurveyHub.jsx', import.meta.url), 'utf8');

test('ProfileMenu reads its open state from HubChromeContext when SurveyHub provides it', () => {
  assert.match(shell, /openProfileMenu,\s*setOpenProfileMenu\s*\}\s*=\s*useContext\(HubChromeContext\)/);
  assert.match(shell, /const open = shared \? openProfileMenu === menuId : localOpen;/);
});

test('SurveyHub holds the account menu state and provides it to every shell', () => {
  assert.match(hub, /const \[openProfileMenu, setOpenProfileMenu\] = useState\(null\)/);
  assert.match(hub, /HubChromeContext\.Provider value=\{\{[^}]*openProfileMenu, setOpenProfileMenu \}\}/);
  // A tab switch or a different user still closes it.
  assert.match(hub, /useEffect\(\(\) => \{ setOpenProfileMenu\(null\); \}, \[tab, userId\]\)/);
});

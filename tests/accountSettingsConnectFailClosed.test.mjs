import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-account-settings-connect-failclosed.spec.mjs
// Leftover-18 A-02 / UL-21 Account Settings Connect fail-closed.
// Distinct from leftover18-unblock + chrome-03 Connect clicks.
// Does not invent MSAL, a Google OAuth completion, or .env.local.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('HubPreview / DevTestRoute fail-close Connect and do not invent MSAL', () => {
  const preview = read('src/home/HubPreview.jsx');
  const devTest = read('src/DevTestRoute.jsx');
  const settings = read('src/components/AccountSettings.jsx');

  assert.match(preview, /msalInstance: null/);
  assert.match(preview, /account: null/);
  assert.match(preview, /isAuthenticated: false/);
  assert.match(preview, /login: previewBlocked\('start Microsoft login'\)/);
  assert.match(preview, /linkGoogleIdentity: previewBlocked\('start Google OAuth'\)/);
  assert.match(preview, /throw new Error\(`Preview cannot \$\{action\}\.`\)/);
  assert.doesNotMatch(preview, /PublicClientApplication|msal-browser/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /login\.microsoftonline\.com\/invented/);

  assert.match(devTest, /msalInstance: null/);
  assert.match(devTest, /login: previewBlocked\('start Microsoft login'\)/);
  assert.match(devTest, /linkGoogleIdentity: previewBlocked\('start Google OAuth'\)/);
  assert.match(devTest, /throw new Error\(`Test PDF cannot \$\{action\}\.`\)/);
  assert.doesNotMatch(devTest, /PublicClientApplication|msal-browser/);

  assert.match(settings, /await msLogin\(\)/);
  assert.match(settings, /await linkGoogleIdentity\(\)/);
  assert.match(settings, /err\?\.message \|\| 'Failed to connect Microsoft account'/);
  assert.match(settings, /err\?\.message \|\| 'Failed to update Google connection\.'/);
  const msCatch = settings.indexOf("err?.message || 'Failed to connect Microsoft account'");
  const msLogin = settings.indexOf('await msLogin()');
  assert.ok(msLogin > 0 && msCatch > msLogin, 'Microsoft Connect must surface the previewBlocked reason');
});

test('Microsoft Connect stays hidden on Capacitor and is offered on localhost', () => {
  const routing = read('src/utils/microsoftOAuthRouting.js');
  const settings = read('src/components/AccountSettings.jsx');

  assert.match(routing, /isCapacitorMicrosoftConnectHidden/);
  assert.match(routing, /isMicrosoftConnectAvailable/);
  assert.match(routing, /origin\.startsWith\('capacitor:\/\/'\)/);
  assert.match(settings, /isCapacitorMicrosoftConnectHidden\(\)/);
  assert.match(settings, /Not available in the iOS\/Android app/);
});

test('Connect live spec clicks Microsoft and Google and does not complete MSAL', () => {
  const live = read('debug/scenarios/e2e-account-settings-connect-failclosed.spec.mjs');
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  const chrome = read('debug/scenarios/e2e-chrome-03-vite.spec.mjs');
  const trial = read('debug/scenarios/e2e-account-settings-start-trial-failclosed.spec.mjs');

  assert.match(live, /ACCOUNT_SETTINGS_CONNECT_FAILCLOSED_PROOF/);
  assert.match(live, /Connected services/);
  assert.match(live, /Preview cannot start Microsoft login/);
  assert.match(live, /Preview cannot start Google OAuth/);
  assert.match(live, /Test PDF cannot start Microsoft login/);
  assert.match(live, /Test PDF cannot start Google OAuth/);
  assert.match(live, /empty=1/);
  assert.match(live, /guest=1/);
  assert.match(live, /testPdf=/);
  assert.match(live, /width: 390/);
  assert.match(live, /MSAL_HOST/);
  assert.match(live, /GOOGLE_HOST/);
  assert.match(live, /OAUTH_HOST/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /PublicClientApplication/);
  assert.doesNotMatch(live, /setInputFiles/);
  assert.doesNotMatch(live, /cs_test_invented/);

  assert.match(leftover, /A-02 \/ UL-21 \/ UL-22/);
  assert.match(chrome, /CHROME03_A02_PROOF/);
  assert.doesNotMatch(chrome, /ACCOUNT_SETTINGS_CONNECT_FAILCLOSED_PROOF/);
  assert.doesNotMatch(trial, /ACCOUNT_SETTINGS_CONNECT_FAILCLOSED_PROOF/);
});

test('96 unique inventory IDs still have proven receipts', () => {
  const inventory = read('.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md');
  const unique = inventory
    .split('## All unique IDs (96)')[1]
    .split('### P2-34 / P2-35 sub-defects')[0];
  const ids = [];
  for (const line of unique.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const head = cells[1];
    const singles = head.match(/^(KB-\d+|P1-\d+|P2-\d+)$/);
    if (singles) {
      ids.push(singles[1]);
      continue;
    }
    const pair = head.match(/^(P1-\d+) \/ (P1-\d+)$/);
    if (pair) {
      ids.push(pair[1], pair[2]);
    }
  }
  assert.equal(ids.length, 96, `expected 96 unique IDs, got ${ids.length}: ${ids.join(',')}`);
  assert.equal(new Set(ids).size, 96);
  const unproven = [];
  for (const line of unique.split('\n')) {
    if (!/^\| (KB-\d+|P1-\d+|P2-\d+)/.test(line)) continue;
    if (!line.includes('**proven**')) unproven.push(line.slice(0, 80));
  }
  assert.deepEqual(unproven, []);
});

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const HUB_SHELL = read('../src/home/HubShell.jsx');
const SURVEY_HUB = read('../src/home/SurveyHub.jsx');
const DASHBOARD = read('../src/Dashboard.jsx');
const ACCOUNT_SETTINGS = read('../src/components/AccountSettings.jsx');
const HUB_CSS = read('../src/home/hub.css');

test('signed-out hub chrome renders Sign in instead of a fake profile menu', () => {
  const profileMenu = HUB_SHELL.slice(
    HUB_SHELL.indexOf('const ProfileMenu'),
    HUB_SHELL.indexOf('const MobileRailNav'),
  );

  assert.match(profileMenu, /if \(!user\) \{/);
  assert.match(profileMenu, />\s*Sign in\s*</);
  assert.match(profileMenu, /onSignIn/);
  assert.ok(
    profileMenu.indexOf('if (!user) {') < profileMenu.indexOf('const name ='),
    'guest branch must return before any fallback name or avatar is resolved',
  );
});

test('the shared Dashboard-to-Hub path opens authentication for guests', () => {
  assert.match(DASHBOARD, /onSignIn=\{onShowAuthModal\}/);
  assert.match(SURVEY_HUB, /onSignIn,/);
  assert.match(SURVEY_HUB, /HubChromeContext\.Provider value=\{\{ user, onSettings: openSettings, onSignOut, onSignIn, projectUploadRecovery \}\}/);
});

test('settings and subscription UI cannot mount without an authenticated user', () => {
  assert.match(SURVEY_HUB, /const openSettings = \(\) => \{\s*if \(!user\) return;/);
  assert.match(SURVEY_HUB, /\{settingsOpen && user && \(/);
  assert.match(ACCOUNT_SETTINGS, /if \(!isOpen \|\| !user\) return null;/);
});

test('mobile guest sign-in control clears the action row below it', () => {
  assert.match(
    HUB_CSS,
    /\.mobile-profile \.who > button\.profile-signin\s*\{[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s,
  );
});

test('authenticated account menu consumes the first outside click before content can activate', () => {
  const profileMenu = HUB_SHELL.slice(
    HUB_SHELL.indexOf('const ProfileMenu'),
    HUB_SHELL.indexOf('const MobileRailNav'),
  );

  assert.doesNotMatch(profileMenu, /addEventListener\(['"]mousedown['"]/);
  assert.match(profileMenu, /className="profile-menu-scrim"/);
  assert.match(profileMenu, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/s);
  assert.match(profileMenu, /setOpen\(false\);\s*setConfirmSignOut\(false\);/s);
  assert.match(
    HUB_CSS,
    /\.survey-hub \.profile-menu-scrim\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*49;/s,
  );
});

test('authenticated account menu identifies the exact app build without a global overlay', () => {
  const profileMenu = HUB_SHELL.slice(
    HUB_SHELL.indexOf('const ProfileMenu'),
    HUB_SHELL.indexOf('const MobileRailNav'),
  );

  assert.match(profileMenu, /Survey App version 1\.0/);
  assert.match(profileMenu, /Build \{HUB_BUILD_STAMP\}/);
  assert.match(HUB_SHELL, /typeof __BUILD_STAMP__ !== 'undefined'/);
  assert.match(HUB_CSS, /\.survey-hub \.profile-menu-build-footer\s*\{[^}]*justify-content:\s*space-between;/s);
});

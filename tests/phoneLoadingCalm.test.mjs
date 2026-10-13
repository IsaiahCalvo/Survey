// Phone loading (owner 2026-10-07: "some weird flicker ... and it doesn't
// automatically load"). Guards the fixes found by recording the /mobile cold
// start -> home -> open path frame by frame (scratchpad phoneLoad):
// no signed-out flash for a signed-in phone, no empty-list frame, no sign-in
// sheet or keyboard on a saved sign-in that only lacks the network, a tap that
// answers at once, failed loads that heal by themselves, and an Expo shell
// with the one quiet loading line instead of spinners.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveHubInitialLoading } from '../src/home/hubInitialLoadingState.js';
import { AUTO_RETRY_DELAYS_MS, nextAutoRetryDelay } from '../src/home/useAutoRetryLoad.js';
import { schedulePdfViewerPrefetch } from '../src/utils/pdfViewerPrefetch.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const AUTH_CONTEXT = read('../src/contexts/AuthContext.jsx');
const SUPABASE_CLIENT = read('../src/supabaseClient.js');
const OPTIONAL_AUTH = read('../src/components/OptionalAuthPrompt.jsx');
const AUTH_MODAL = read('../src/components/AuthModal.jsx');
const AUTH_MODAL_CSS = read('../src/components/AuthModal.css');
const TURNSTILE = read('../src/components/TurnstileWidget.jsx');
const HUB_SHELL = read('../src/home/HubShell.jsx');
const SURVEY_HUB = read('../src/home/SurveyHub.jsx');
const DASHBOARD = read('../src/Dashboard.jsx');
const APP_SHELL = read('../src/AppShell.jsx');
const DATABASE_HOOKS = read('../src/hooks/useDatabase.js');
const QUIET = read('../src/components/QuietLoading.jsx');
const MAIN = read('../src/main.jsx');
const RAIL = read('../src/mobile/MobilePdfViewerChrome.jsx');
const EXPO_APP = read('../mobile-expo/App.tsx');
const EXPO_CONFIG = JSON.parse(read('../mobile-expo/app.json'));

test('the home holds its quiet loading state until the saved sign-in is read', () => {
  const settledLists = { documentsInitialLoading: false, projectsInitialLoading: false, templatesInitialLoading: false };
  assert.deepEqual(
    resolveHubInitialLoading({ ...settledLists, authLoading: true }),
    { documents: true, projects: true, templates: true },
  );
  assert.deepEqual(
    resolveHubInitialLoading({ ...settledLists, authLoading: false }),
    { documents: false, projects: false, templates: false },
  );
  assert.match(DASHBOARD, /loading: authLoading \} = useAuth\(\)/);
  assert.match(DASHBOARD, /resolveHubInitialLoading\(\{[\s\S]*?authLoading,/);
  // The account corner shows neither "Sign in" nor an avatar until it knows.
  assert.match(HUB_SHELL, /if \(!user && auth\?\.loading\) \{\s*return <div className="who who-guest" aria-hidden="true" \/>;/);
});

test('arrived documents never show "No documents yet" for the frame before the home copies them', () => {
  assert.deepEqual(
    resolveHubInitialLoading({
      documentsInitialLoading: false,
      projectsInitialLoading: false,
      templatesInitialLoading: false,
      documentsAwaitingSync: true,
    }),
    { documents: true, projects: true, templates: false },
  );
  assert.match(DASHBOARD, /documentsAwaitingSync: \(supabaseDocuments\?\.length \|\| 0\) > 0 && \(documents\?\.length \|\| 0\) === 0/);
});

test('a saved sign-in that only lacks the network keeps loading and retries instead of signing out', () => {
  assert.match(SUPABASE_CLIENT, /export async function readStartupSession/);
  assert.match(SUPABASE_CLIENT, /offline: !session && isAuthRetryableFetchError\(error\)/);
  assert.match(SUPABASE_CLIENT, /if \(isAuthLockStolenError\(err\)\) return \{ session: null, offline: true \};/);
  assert.match(AUTH_CONTEXT, /if \(!session && offline\) \{/);
  assert.match(AUTH_CONTEXT, /window\.addEventListener\('online', readBootSession\)/);
  assert.match(AUTH_CONTEXT, /document\.addEventListener\('visibilitychange', readBootSessionWhenVisible\)/);
  assert.match(AUTH_CONTEXT, /setInterval\(readBootSession, 5_000\)/);
});

test('the sign-in sheet closes itself once someone is signed in', () => {
  assert.match(OPTIONAL_AUTH, /if \(isAuthenticated && showAuthModal\) setShowAuthModal\(false\);/);
});

test('on a touch screen the sign-in sheet opens without raising the keyboard or a ring', () => {
  assert.match(AUTH_MODAL, /const focusTitleFirst = hasCoarsePointer\(\);/);
  assert.match(AUTH_MODAL, /data-autofocus=\{focusTitleFirst \? '' : undefined\}/);
  assert.match(AUTH_MODAL_CSS, /\.auth-modal-header h2\[tabindex='-1'\]:focus-visible \{\s*outline: none !important;/);
});

test('the human check keeps its room from the first frame and is dark', () => {
  assert.match(TURNSTILE, /theme: 'dark'/);
  assert.match(TURNSTILE, /minHeight: unavailable \? 0 : 65/);
});

test('a tapped document answers at once with the quiet "Opening <file>…"', () => {
  assert.match(DASHBOARD, /onDocumentOpenStart\?\.\(doc\);\s*const blob = await downloadFromStorage\(filePath\);/);
  assert.match(DASHBOARD, /catch \(error\) \{\s*onDocumentOpenEnd\?\.\(\);/);
  assert.match(APP_SHELL, /const handleDocumentSelect = \(file, filePath = null\) => \{\s*setPendingDocumentOpen\(null\);/);
  assert.match(APP_SHELL, /pendingDocumentOpen && currentView !== 'viewer' && \(/);
  assert.match(APP_SHELL, /<QuietLoading label=\{openingLabel\(pendingDocumentOpen\.name\)\} background="var\(--surface-0\)" \/>/);
});

test('every loading line on a phone sits in one place', () => {
  assert.match(QUIET, /@media \(max-width: 720px\) \{\s*\.quiet-loading-text \{[\s\S]*?position: fixed;/);
  assert.match(QUIET, /\.survey-pdfjs-viewer \.quiet-loading-text \{ top: 50%; \}/);
  // The Expo shell's line uses the same frame: 34px header, 36px + inset dock.
  assert.match(EXPO_APP, /paddingTop: 34, paddingBottom: 36 \+ bottomInset/);
});

test('a list that failed to load tries again by itself, without flashing the empty list', () => {
  assert.deepEqual(AUTO_RETRY_DELAYS_MS, [3000, 6000, 12000, 24000, 30000]);
  assert.equal(nextAutoRetryDelay(0), 3000);
  assert.equal(nextAutoRetryDelay(99), 30000);
  assert.match(SURVEY_HUB, /useAutoRetryLoad\(Boolean\(documentsLoadError\) && documents\.length === 0, onRetryDocuments\)/);
  assert.match(SURVEY_HUB, /useAutoRetryLoad\(Boolean\(projectsLoadError\) && projects\.length === 0, onRetryProjects\)/);
  assert.match(SURVEY_HUB, /useAutoRetryLoad\(Boolean\(templatesLoadError\) && templates\.length === 0, onRetryTemplates\)/);
  // The error is cleared only by a read that worked.
  assert.doesNotMatch(DATABASE_HOOKS, /setLoading\(true\);\s*setError\(null\);/);
  assert.match(DATABASE_HOOKS, /setDocuments\(merged\);\s*setError\(null\);/);
  // Coming back to the app after a minute reads the lists again.
  assert.match(DASHBOARD, /Date\.now\(\) - hiddenAt >= 60_000\) notifyLibraryChanged\(\)/);
});

test('offline, the viewer prefetch waits and no stale-deploy reload fires', () => {
  const listeners = new Map();
  let loads = 0;
  const fakeWindow = {
    navigator: { onLine: false },
    document: { readyState: 'complete' },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  };
  schedulePdfViewerPrefetch(() => { loads += 1; }, { windowObject: fakeWindow });
  assert.equal(loads, 0, 'nothing is fetched while offline');
  assert.equal(listeners.has('online'), true);
  fakeWindow.navigator.onLine = true;
  listeners.get('online')();
  assert.equal(loads, 1, 'the prefetch runs once the connection is back');

  assert.match(MAIN, /if \(window\.navigator\?\.onLine === false\) return;/);
  assert.match(APP_SHELL, /function ViewerLoadFailed\(\) \{[\s\S]*?window\.addEventListener\('online', reload\)/);
});

test('the phone rail opens on your own initials, not a placeholder', () => {
  assert.match(APP_SHELL, /leftRailApi=\{leftRailApi\}\s*signedInUser=\{user\}/);
  assert.match(RAIL, /currentUserId: leftRailApi\?\.currentUserId \?\? signedInUser\?\.id \?\? null/);
});

test('the Expo shell: dark splash, no spinner, patient timeout, retries by itself', () => {
  assert.equal(EXPO_CONFIG.expo.splash.backgroundColor, '#0d0f14');
  assert.doesNotMatch(EXPO_APP, /ActivityIndicator/);
  assert.doesNotMatch(EXPO_APP, /startInLoadingState/);
  assert.match(EXPO_APP, /onLoadProgress=\{\(\) => \{ lastLoadProgressAtRef\.current = Date\.now\(\); \}\}/);
  assert.match(EXPO_APP, /if \(quietFor < SHELL_LOAD_TIMEOUT_MS\) \{/);
  assert.match(EXPO_APP, /const SHELL_AUTO_RETRY_DELAYS_MS = \[4_000, 8_000, 15_000, 30_000\];/);
  assert.match(EXPO_APP, /AppState\.addEventListener\('change', \(state\) => \{/);
});

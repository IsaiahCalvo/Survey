// KAL-27 regression lock — Save Log banner must dedupe its GitHub push.
// One user-visible Save Log action (shortcut OR menu OR rapid combo) must
// produce at most one push call. The banner enforces this through a
// pushInFlightRef guard checked in runPush AND in the save-log-banner-start
// handler, plus an effect that clears the flag when state lands on
// success/error.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BANNER_SOURCE = readFileSync(
  new URL('../src/components/SaveLogBanner.jsx', import.meta.url),
  'utf8'
);

test('SaveLogBanner never creates a second local snapshot after the trigger site saved one', () => {
  assert.doesNotMatch(
    BANNER_SOURCE,
    /saveLogSnapshot/,
    'GitHub push success or failure must not create another local snapshot'
  );
});

test('SaveLogBanner declares the pushInFlightRef dedupe guard', () => {
  assert.match(
    BANNER_SOURCE,
    /const pushInFlightRef = useRef\(false\)/,
    'pushInFlightRef must exist so runPush and handleStart can read/clear it'
  );
});

test('runPush early-returns when a push is already in flight', () => {
  assert.match(
    BANNER_SOURCE,
    /const runPush = useCallback\(async \(descriptionText\) => \{[\s\S]*?if \(pushInFlightRef\.current\)[\s\S]*?return;[\s\S]*?pushInFlightRef\.current = true;/,
    'runPush must check pushInFlightRef at the top and bail out if a push is already running'
  );
});

test('save-log-banner-start handler ignores re-entry while a push is in flight', () => {
  assert.match(
    BANNER_SOURCE,
    /const handleStart = \(event\) => \{[\s\S]*?if \(pushInFlightRef\.current\)[\s\S]*?return;[\s\S]*?\};/,
    'handleStart must early-return when a push is in flight so a second trigger does not restart the banner mid-push'
  );
});

test('dismiss clears the in-flight guard so the next Save Log can run', () => {
  assert.match(
    BANNER_SOURCE,
    /const dismiss = useCallback\(\(\) => \{[\s\S]*?pushInFlightRef\.current = false;[\s\S]*?\}, \[clearTimers\]\);/,
    'dismiss must reset pushInFlightRef so a dismissed-while-submitting banner does not strand the flag'
  );
});

test('success/error effect clears the in-flight guard immediately', () => {
  assert.match(
    BANNER_SOURCE,
    /if \(state !== 'success' && state !== 'error'\) return undefined;\s*\n\s*pushInFlightRef\.current = false;/,
    'the success/error effect must clear pushInFlightRef so a fast follow-up Save Log does not wait for the auto-dismiss'
  );
});

// Polish round 6: App and PDFViewer each mount a banner, so with a document
// open one Save Log showed two banners and ran two pushes. Only the oldest
// live instance answers; and the banner portals into <body> so the phone
// shell's `#root > div { height: 100% !important }` cannot stretch it.
test('only the oldest live banner answers Save Log events', () => {
  assert.match(BANNER_SOURCE, /const liveBanners = \[\];/);
  assert.match(BANNER_SOURCE, /const handleStart = \(event\) => \{\s*if \(!isSaveLogBannerOwner\(instanceRef\.current\)\) return;/);
  assert.match(BANNER_SOURCE, /const handleToast = \(event\) => \{\s*if \(!isSaveLogBannerOwner\(instanceRef\.current\)\) return;/);
  assert.match(BANNER_SOURCE, /export const isSaveLogBannerOwner = \(token\) => liveBanners\[0\] === token;/);
});

test('the banner renders into document.body, not inside #root', () => {
  assert.match(BANNER_SOURCE, /return createPortal\(\s*<>[\s\S]*<\/>,\s*document\.body,\s*\);\s*\}\s*$/);
});

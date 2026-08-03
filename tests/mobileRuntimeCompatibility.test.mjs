import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSafeNavigatorLock } from '../src/utils/safeNavigatorLock.js';
import { installBlobArrayBufferPolyfill, readBlobAsArrayBuffer } from '../src/utils/blobArrayBuffer.js';
import { getMobileSyncPresentation, normalizeMobilePresence } from '../src/mobile/mobilePdfViewerModel.js';

const EXPO_APP_SOURCE = readFileSync(new URL('../mobile-expo/App.tsx', import.meta.url), 'utf8');
const APP_SHELL_SOURCE = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const MAIN_SOURCE = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const HUB_CSS_SOURCE = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');
const IOS_SIMULATOR_SOURCE = readFileSync(new URL('../scripts/run-ios-simulator.mjs', import.meta.url), 'utf8');
const IOS_APP_SCHEME_SOURCE = readFileSync(new URL('../ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme', import.meta.url), 'utf8');
const PDFJS_VIEWER_SOURCE = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
// Unified renderer (FabricDrawingCanvas retired): touch-compat behavior for
// creation strokes now lives in SVGAnnotationLayer (the live creation surface).
const SVG_ANNOTATION_LAYER_SOURCE = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const MOBILE_VIEWER_CHROME_SOURCE = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const MOBILE_VIEWER_CSS_SOURCE = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const PAGES_PANEL_SOURCE = readFileSync(new URL('../src/sidebar/PagesPanel.jsx', import.meta.url), 'utf8');
const SPACES_PANEL_SOURCE = readFileSync(new URL('../src/sidebar/SpacesPanel.jsx', import.meta.url), 'utf8');
const SURVEY_RAIL_SOURCE = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');

test('Supabase auth runs without navigator.locks on an insecure mobile host', async () => {
  let lockCalls = 0;
  const lock = createSafeNavigatorLock(async () => {
    lockCalls += 1;
    throw new Error('navigatorLock must not run without navigator.locks');
  }, {});

  const result = await lock('auth-token', 5000, async () => 'authenticated');

  assert.equal(result, 'authenticated');
  assert.equal(lockCalls, 0);
});

test('Supabase auth keeps navigator locking when the browser supports it', async () => {
  const calls = [];
  const lock = createSafeNavigatorLock(async (name, timeout, callback) => {
    calls.push({ name, timeout });
    return callback();
  }, { locks: { request() {} } });

  const result = await lock('auth-token', 5000, async () => 'locked');

  assert.equal(result, 'locked');
  assert.deepEqual(calls, [{ name: 'auth-token', timeout: 2500 }]);
});

test('reads an iOS WebView file when Blob.arrayBuffer is unavailable', async () => {
  const expected = Uint8Array.from([37, 80, 68, 70, 45]);

  class FakeFileReader {
    readAsArrayBuffer(blob) {
      this.result = blob.bytes.buffer.slice(0);
      queueMicrotask(() => this.onload?.());
    }
  }

  const result = await readBlobAsArrayBuffer(
    { bytes: expected },
    { FileReaderCtor: FakeFileReader, ResponseCtor: null },
  );

  assert.deepEqual(new Uint8Array(result), expected);
});

test('falls back to FileReader when a WebView file arrayBuffer call rejects', async () => {
  const expected = Uint8Array.from([1, 2, 3, 4]);

  class FakeFileReader {
    readAsArrayBuffer(blob) {
      this.result = blob.bytes.buffer.slice(0);
      queueMicrotask(() => this.onload?.());
    }
  }

  const result = await readBlobAsArrayBuffer(
    {
      bytes: expected,
      arrayBuffer: async () => { throw new Error('WebKit file handle unavailable'); },
    },
    { FileReaderCtor: FakeFileReader, ResponseCtor: null },
  );

  assert.deepEqual(new Uint8Array(result), expected);
});

test('installs a non-recursive Blob.arrayBuffer fallback for older WebKit', async () => {
  class FakeBlob {
    constructor(bytes) {
      this.bytes = bytes;
    }
  }
  class FakeFileReader {
    readAsArrayBuffer(blob) {
      this.result = blob.bytes.buffer.slice(0);
      queueMicrotask(() => this.onload?.());
    }
  }
  const target = { Blob: FakeBlob, FileReader: FakeFileReader };

  assert.equal(installBlobArrayBufferPolyfill(target), true);
  const result = await new FakeBlob(Uint8Array.from([5, 6, 7])).arrayBuffer();
  assert.deepEqual(new Uint8Array(result), Uint8Array.from([5, 6, 7]));
});

test('Expo shell publishes native safe areas and keeps controls above the home indicator', () => {
  assert.match(EXPO_APP_SOURCE, /useSafeAreaInsets\(\)/);
  assert.match(EXPO_APP_SOURCE, /paddingTop: insets\.top/);
  assert.match(EXPO_APP_SOURCE, /Math\.max\(insets\.bottom, 10\)/);
  assert.match(EXPO_APP_SOURCE, /--native-safe-area-bottom/);
  assert.match(EXPO_APP_SOURCE, /injectedJavaScriptBeforeContentLoaded/);
  assert.match(EXPO_APP_SOURCE, /process\.env\.EXPO_PUBLIC_SURVEY_URL/);
  assert.match(EXPO_APP_SOURCE, /DEFAULT_SURVEY_URL = 'https:\/\/surveytool\.app\/'/);
  assert.match(EXPO_APP_SOURCE, /url\.searchParams\.set\('mobileNav', 'tabs'\)/);
  assert.match(EXPO_APP_SOURCE, /url\.searchParams\.set\('nativeShell', 'expo'\)/);
  assert.match(HUB_CSS_SOURCE, /\.survey-hub\.hub-native-shell-expo \.mobile-home-tabs \{/);
  assert.match(HUB_CSS_SOURCE, /padding-top: 4px/);
  assert.match(HUB_CSS_SOURCE, /padding-bottom: calc\(4px \+ var\(--native-safe-area-bottom, 0px\)\)/);
  assert.doesNotMatch(HUB_CSS_SOURCE, /\.mobile-home-tabs button[\s\S]{0,500}transform: translateY\(4px\)/);
  assert.match(EXPO_APP_SOURCE, /onContentProcessDidTerminate/);
  assert.match(EXPO_APP_SOURCE, /onRenderProcessGone/);
});

test('build identity is diagnostic-only and Simulator rejects a stale bundle', () => {
  assert.doesNotMatch(APP_SHELL_SOURCE, /position:\s*'fixed'[\s\S]{0,500}\{__BUILD_STAMP__\}/);
  assert.doesNotMatch(APP_SHELL_SOURCE, /\{__BUILD_STAMP__\}/);
  assert.match(MAIN_SOURCE, /console\.log\('\[Survey build\]'/);
  assert.match(MAIN_SOURCE, /new URL\('release\.json', document\.baseURI\)/);
  assert.match(IOS_SIMULATOR_SOURCE, /distRelease\.commit !== sourceCommit/);
  assert.match(IOS_SIMULATOR_SOURCE, /appRelease\.commit !== sourceCommit/);
  assert.match(IOS_APP_SCHEME_SOURCE, /BlueprintName="App"/);
  assert.match(IOS_APP_SCHEME_SOURCE, /BuildableName="App\.app"/);
});

test('Capacitor and Expo mobile headers each consume the top safe area once', () => {
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.header \{[\s\S]{0,520}top: env\(safe-area-inset-top, 0px\)/);
  assert.match(HUB_CSS_SOURCE, /html\[data-native-shell="expo"\] \.survey-hub \.header \{\s*top: 0;/);
  assert.match(EXPO_APP_SOURCE, /paddingTop: insets\.top/);
});

test('mobile PDF rendering stays inside the WKWebView memory budget', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_MAX_CANVAS_AREA = 8 \* 1024 \* 1024/);
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_MAX_OVERSCAN_PAGES = 1/);
  assert.match(PDFJS_VIEWER_SOURCE, /const target = isMobileSurface \? canvasRef\.current : document\.createElement\('canvas'\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /const externalPdf = isPdfDocumentProxy\(activeSource\) \? activeSource : null/);
});

test('starting a two-finger pinch cancels a partial creation stroke', () => {
  // A named region gives native XCUITest/Appium an exact real gesture target
  // inside WKWebView instead of pinching the shell-level web view.
  assert.match(PDFJS_VIEWER_SOURCE, /import\.meta\.env\.DEV[\s\S]{0,180}nativePinchE2E/);
  assert.match(PDFJS_VIEWER_SOURCE, /nativePinchE2E && \([\s\S]{0,220}aria-label="PDF gesture surface"/);
  assert.match(PDFJS_VIEWER_SOURCE, /window\.dispatchEvent\(new Event\(PINCH_START_EVENT\)\)/);
  // SVGAnnotationLayer's pinch listener must discard (never commit) the
  // in-flight gesture: synchronous ref clear + captured-point flush.
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /window\.addEventListener\('survey-pdfjs-pinch-start', cancelPinchGesture\)/);
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /shapeCreationRef\.current = null;/);
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /freehandPointsRef\.current = \[\];/);
});

test('native pinch and trackpad gestures override a stale fit-mode source', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /source: 'pinch'/);
  assert.match(PDFJS_VIEWER_SOURCE, /source: 'wheel'/);
  assert.match(PDFJS_VIEWER_SOURCE, /source: 'imperative'/);
  assert.match(
    PDF_VIEWER_SOURCE,
    /payload\?\.source === 'pinch'[\s\S]{0,80}payload\?\.source === 'wheel'[\s\S]{0,300}pdfjsZoomSourceRef\.current = ZOOM_MODES\.MANUAL/,
  );
});

test('one-finger creation strokes stay touch-compatible on the SVG surface', () => {
  // The fabric upper canvas used to grant these implicitly; the SVG creation
  // surface must keep them explicitly: one-finger strokes must not scroll the
  // page (touchAction none while a creation tool is armed), and 120Hz styli
  // must not lose samples (coalesced pointer capture into page space).
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /touchAction: isCreationTool \? 'none' : undefined/);
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /getCoalescedEvents/);
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /appendCoalescedPagePoints\(e\.nativeEvent\)/);
});

test('mobile Fit Page settles through the native viewer in one pass', () => {
  assert.match(PDF_VIEWER_SOURCE, /initialFitPageTimersRef\.current = \[setTimeout\(fire, 0\)\]/);
  assert.match(PDF_VIEWER_SOURCE, /if \(mode === ZOOM_MODES\.FIT_PAGE\) \{[\s\S]{0,500}magnification\.fitToPage\(\)/);
  assert.doesNotMatch(PDF_VIEWER_SOURCE, /setTimeout\(fire, 250\)|setTimeout\(fire, 550\)/);
});

test('mobile viewer exposes the preserved dynamic tool and page controls', () => {
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /Partial Erase/);
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /Solid Triangle/);
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /aria-label="Text formatting"/);
  assert.match(PAGES_PANEL_SOURCE, /aria-label="Page actions"/);
  assert.match(PAGES_PANEL_SOURCE, /onInsertBlankPage\?\.\(pageNum\)/);
  assert.match(PAGES_PANEL_SOURCE, /mobileSelectMode \? 'Done' : 'Select'/);
});

test('mobile live text formatting stays scroll-reachable with 44px touch targets', () => {
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /\.mobile-pdf-properties--text \{[\s\S]{0,420}justify-content: flex-start;[\s\S]{0,160}touch-action: pan-x;/);
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /\.mobile-pdf-properties--text > button,[\s\S]{0,180}min-width: 44px;[\s\S]{0,80}min-height: 44px;/);
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /aria-label="Font color"[\s\S]{0,120}onPointerDown=\{\(event\) => event\.preventDefault\(\)\}[\s\S]{0,100}setColorPicker\('fontColorLive'\)/);
});

test('mobile annotation settings retain the preserved app geometry and controls', () => {
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /MOBILE_ANNOTATION_COLORS/);
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /Shape settings/);
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /Text alignment/);
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /Vertical text alignment/);
  // 2026-07-12 Phase E stage 2 (OWNER DECISION 3): the in-sheet arrowhead
  // control is now the reusable app-styled MobileStyledSelect (native OS
  // <select> retired); it emits the same runtime aria-label from its ariaLabel
  // prop. Guard the control's presence via that prop.
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /ariaLabel="Arrowhead"/);
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /height: calc\(432px \+ var\(--mobile-bottom-inset\)\)/);
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /is-shape:not\(\.is-callout\)[\s\S]{0,100}height: calc\(368px \+ var\(--mobile-bottom-inset\)\)/);
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /is-shape\.is-callout[\s\S]{0,100}height: calc\(448px \+ var\(--mobile-bottom-inset\)\)/);
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /mobile-pdf-text-card--shape-color[\s\S]{0,120}height: 150px/);
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /mobile-pdf-text-card--arrowhead[\s\S]{0,80}height: 85px/);
});

test('native mobile home remains viewport-contained with a solid full-width tab bar', () => {
  assert.match(HUB_CSS_SOURCE, /html\.survey-hub-native-frame,[\s\S]{0,180}overflow: hidden !important/);
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.mobile-home-tabs \{[\s\S]{0,180}left: 0;[\s\S]{0,80}right: 0;[\s\S]{0,300}background: #0d0f14/);
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.mobile-home-tabs::before \{\s*display: none/);
});

test('mobile viewer rails do not mix flex shorthand with flexShrink during rerender', () => {
  assert.match(APP_SHELL_SOURCE, /id="chrome-left-host"[\s\S]{0,220}flexGrow: 0,[\s\S]{0,100}flexBasis: isMobileViewer \? '44px' : '48px',[\s\S]{0,100}flexShrink: 0/);
  assert.match(APP_SHELL_SOURCE, /id="chrome-right-host"[\s\S]{0,220}flexGrow: 0,[\s\S]{0,100}flexBasis: isMobileViewer \? '0px' : '48px',[\s\S]{0,100}flexShrink: 0/);
  assert.doesNotMatch(APP_SHELL_SOURCE, /flex: isMobileViewer \? '0 0 (?:0|44)px' : '0 0 48px'/);
});

test('mobile Survey and Spaces drawers follow their content', () => {
  assert.match(MOBILE_VIEWER_CHROME_SOURCE, /else \{\s*setOpenCategory\(null\)/);
  assert.match(SURVEY_RAIL_SOURCE, /mobile-survey-template-menu/);
  // 2026-07-12 Phase C (vocabulary rule): the mobile hint spells out the full
  // product term "Survey Marker" — never bare "marker".
  assert.match(SURVEY_RAIL_SOURCE, /Tap category to place a Survey Marker/);
  assert.match(SPACES_PANEL_SOURCE, /Array\.isArray\(space\.assignedPages\)/);
  // 2026-07-12 Phase B (defect #4): the spaces sheet now follows MEASURED
  // panel content instead of predicted row heights — the metrics callback
  // reports contentHeight alongside the legacy expandedPageRows fallback.
  assert.match(SPACES_PANEL_SOURCE, /onMobilePanelMetricsChange\(\{ expandedPageRows, contentHeight \}\)/);
  // 2026-07-12 Phase B (S3): every bottom sheet bakes home-indicator
  // clearance into itself, like the demo's paddingBottom: inset + 10..14.
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /\.mobile-pdf-sheet \{[\s\S]{0,1200}padding-bottom: calc\(12px \+ var\(--mobile-bottom-inset\)\)/);
});

test('mobile viewer sync presentation consumes the structured sync state', () => {
  assert.deepEqual(
    getMobileSyncPresentation({ stage: 'syncing' }, 0, true),
    { state: 'syncing', label: 'Syncing...', color: '#f5a524' },
  );
  assert.deepEqual(
    getMobileSyncPresentation({ stage: 'queued' }, 3, true),
    { state: 'offline', label: 'Offline · 3 saved locally', color: '#ef4444' },
  );
});

test('mobile viewer presence uses Supabase row names, deduplicates, and pins the local user', () => {
  const users = normalizeMobilePresence({
    currentUserId: 'me',
    currentUserEmail: 'isaiah@example.com',
    presence: [
      { user_id: 'other', display_name: 'Other Person', last_seen: '2026-07-10T12:00:00Z' },
      { user_id: 'me', display_name: 'Isaiah Calvo', last_seen: '2026-07-10T11:00:00Z' },
      { user_id: 'other', display_name: 'Other New', last_seen: '2026-07-10T13:00:00Z' },
    ],
  });

  assert.deepEqual(users.map(({ id, label, initials, isCurrent }) => ({ id, label, initials, isCurrent })), [
    { id: 'me', label: 'Isaiah Calvo', initials: 'IC', isCurrent: true },
    { id: 'other', label: 'Other New', initials: 'ON', isCurrent: false },
  ]);
});

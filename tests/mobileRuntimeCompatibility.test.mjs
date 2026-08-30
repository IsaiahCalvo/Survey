import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSafeNavigatorLock } from '../src/utils/safeNavigatorLock.js';
import { installBlobArrayBufferPolyfill, readBlobAsArrayBuffer } from '../src/utils/blobArrayBuffer.js';
import { getMobileSyncPresentation, normalizeMobilePresence } from '../src/mobile/mobilePdfViewerModel.js';
import {
  simulatorDevServerUrl,
  withSimulatorDevServer,
} from '../scripts/ios-simulator-dev-config.mjs';

const EXPO_APP_SOURCE = readFileSync(new URL('../mobile-expo/App.tsx', import.meta.url), 'utf8');
const EXPO_CONFIG_SOURCE = readFileSync(new URL('../mobile-expo/app.json', import.meta.url), 'utf8');
const EXPO_EAS_CONFIG_SOURCE = readFileSync(new URL('../mobile-expo/eas.json', import.meta.url), 'utf8');
const EXPO_PACKAGE_SOURCE = readFileSync(new URL('../mobile-expo/package.json', import.meta.url), 'utf8');
const EXPO_DIAGNOSTIC_STORE_SOURCE = readFileSync(new URL('../mobile-expo/src/nativeDiagnosticStore.js', import.meta.url), 'utf8');
const AUTH_CONTEXT_SOURCE = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
const INDEX_HTML_SOURCE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const APP_SHELL_SOURCE = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const MAIN_SOURCE = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const HUB_CSS_SOURCE = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');
const HUB_SHELL_SOURCE = readFileSync(new URL('../src/home/HubShell.jsx', import.meta.url), 'utf8');
const IOS_SIMULATOR_SOURCE = readFileSync(new URL('../scripts/run-ios-simulator.mjs', import.meta.url), 'utf8');
const IOS_APP_SCHEME_SOURCE = readFileSync(new URL('../ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme', import.meta.url), 'utf8');
const PDFJS_VIEWER_SOURCE = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
const UNSUPPORTED_NOTICE_SOURCE = readFileSync(new URL('../src/components/UnsupportedAnnotationsNotice.jsx', import.meta.url), 'utf8');
// Unified renderer (FabricDrawingCanvas retired): touch-compat behavior for
// creation strokes now lives in SVGAnnotationLayer (the live creation surface).
const SVG_ANNOTATION_LAYER_SOURCE = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const MOBILE_VIEWER_CHROME_SOURCE = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const MOBILE_VIEWER_CSS_SOURCE = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const PAGES_PANEL_SOURCE = readFileSync(new URL('../src/sidebar/PagesPanel.jsx', import.meta.url), 'utf8');
const SPACES_PANEL_SOURCE = readFileSync(new URL('../src/sidebar/SpacesPanel.jsx', import.meta.url), 'utf8');
const SURVEY_RAIL_SOURCE = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const SURVEY_ANALYTICS_SOURCE = readFileSync(new URL('../src/utils/surveyAnalytics.js', import.meta.url), 'utf8');

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
  assert.match(EXPO_APP_SOURCE, /DEFAULT_SURVEY_URL = 'https:\/\/surveytool\.app\/mobile'/);
  assert.match(EXPO_APP_SOURCE, /url\.searchParams\.set\('mobileNav', 'tabs'\)/);
  assert.match(EXPO_APP_SOURCE, /url\.searchParams\.set\('nativeShell', 'expo'\)/);
  assert.match(HUB_CSS_SOURCE, /\.survey-hub\.hub-native-shell-expo \.mobile-home-tabs \{/);
  assert.match(HUB_CSS_SOURCE, /--mobile-tab-corner-inset: min\(8px, max\(0px, calc\(var\(--mobile-tab-safe-bottom\) - 10px\)\)\)/);
  assert.match(HUB_CSS_SOURCE, /--mobile-tab-lower-offset: min\(3px, max\(0px, calc\(var\(--mobile-tab-safe-bottom\) - 10px\)\)\)/);
  assert.match(HUB_CSS_SOURCE, /max\(var\(--native-safe-area-right, env\(safe-area-inset-right, 0px\)\), var\(--mobile-tab-corner-inset\)\)/);
  assert.match(HUB_CSS_SOURCE, /max\(var\(--native-safe-area-left, env\(safe-area-inset-left, 0px\)\), var\(--mobile-tab-corner-inset\)\)/);
  assert.match(HUB_CSS_SOURCE, /calc\(4px \+ var\(--mobile-tab-safe-bottom\) - var\(--mobile-tab-lower-offset\)\)/);
  assert.match(HUB_CSS_SOURCE, /align-items: end/);
  assert.doesNotMatch(HUB_CSS_SOURCE, /\.mobile-home-tabs button[\s\S]{0,500}transform: translateY\(4px\)/);
  assert.match(EXPO_APP_SOURCE, /onContentProcessDidTerminate/);
  assert.match(EXPO_APP_SOURCE, /onRenderProcessGone/);
});

test('Expo cold launches bypass stale hosted HTML while preserving the signed-in WebView profile', () => {
  assert.match(EXPO_APP_SOURCE, /function withLaunchCacheBust\(surveyUrl: string, launchId: string\)/);
  assert.match(EXPO_APP_SOURCE, /url\.searchParams\.set\('shellLaunch', launchId\)/);
  assert.match(EXPO_APP_SOURCE, /surveyLaunchUrlRef = useRef\(withLaunchCacheBust\(SURVEY_URL, shellSessionIdRef\.current\)\)/);
  assert.match(EXPO_APP_SOURCE, /source=\{\{ uri: surveyLaunchUrlRef\.current \}\}/);
  assert.doesNotMatch(EXPO_APP_SOURCE, /incognito/);
});

test('Expo never leaves a failed or stalled WebView as a silent blank screen', () => {
  assert.match(EXPO_APP_SOURCE, /const SHELL_LOAD_TIMEOUT_MS = 15_000/);
  assert.match(EXPO_APP_SOURCE, /type: 'survey:shell-ready'/);
  assert.match(EXPO_APP_SOURCE, /new MutationObserver\(notifyShellReady\)/);
  assert.match(EXPO_APP_SOURCE, /message\?\.type === 'survey:shell-ready'/);
  assert.match(EXPO_APP_SOURCE, /surveyLaunchUrlRef\.current = withLaunchCacheBust\(SURVEY_URL,[\s\S]{0,120}-retry-/);
  assert.match(EXPO_APP_SOURCE, /!shellReady && !loadError/);
  assert.match(EXPO_APP_SOURCE, /onError=\{failShellLoad\}/);
  assert.match(EXPO_APP_SOURCE, /onHttpError=\{failShellLoad\}/);
});

test('hosted mobile route is canonical and preserves mobile OAuth return', () => {
  assert.match(INDEX_HTML_SOURCE, /\^\\\/mobile\(\?:\\\/\|\$\)/);
  assert.match(HUB_SHELL_SOURCE, /\^\\\/mobile\(\?:\\\/\|\$\)[\s\S]{0,80}return 'tabs'/);
  assert.match(AUTH_CONTEXT_SOURCE, /redirectTo = `\$\{window\.location\.origin\}\/mobile`/);
});

test('build identity avoids a floating overlay and Simulator rejects a stale bundle', () => {
  assert.doesNotMatch(APP_SHELL_SOURCE, /position:\s*'fixed'[\s\S]{0,500}\{__BUILD_STAMP__\}/);
  assert.match(APP_SHELL_SOURCE, /console\.info\(`\[build\] \$\{__BUILD_STAMP__\}`\)/);
  assert.match(MAIN_SOURCE, /console\.log\('\[Survey build\]'/);
  assert.match(MAIN_SOURCE, /new URL\('release\.json', document\.baseURI\)/);
  assert.match(IOS_SIMULATOR_SOURCE, /distRelease\.commit !== sourceCommit/);
  assert.match(IOS_SIMULATOR_SOURCE, /appRelease\.commit !== sourceCommit/);
  assert.match(IOS_APP_SCHEME_SOURCE, /BlueprintName="App"/);
  assert.match(IOS_APP_SCHEME_SOURCE, /BuildableName="App\.app"/);
});

test('iOS Simulator dev mode targets Vite without changing production Capacitor config', () => {
  const serverUrl = simulatorDevServerUrl('http://127.0.0.1:5177/?mobileNav=rail&nativeShell=expo');
  assert.equal(
    serverUrl,
    'http://127.0.0.1:5177/?mobileNav=tabs&nativeShell=capacitor',
  );
  assert.deepEqual(withSimulatorDevServer({ appId: 'com.kalvoe.survey' }, serverUrl), {
    appId: 'com.kalvoe.survey',
    server: { cleartext: true, url: serverUrl },
  });
  assert.throws(() => simulatorDevServerUrl('file:///tmp/app'), /http:\/\/ or https:\/\//);
  assert.throws(() => simulatorDevServerUrl('https://user:secret@example.com'), /credentials/);
  assert.match(IOS_SIMULATOR_SOURCE, /temporaryIosRoot = path\.join\(artifactRoot, 'SimulatorSource'\)/);
  assert.match(IOS_SIMULATOR_SOURCE, /cp\(path\.join\(ROOT, 'ios'\), temporaryIosRoot/);
  assert.match(IOS_SIMULATOR_SOURCE, /CAPACITOR_SERVER_URL: ''/);
});

test('Capacitor and Expo mobile headers each consume the top safe area once', () => {
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.header \{[\s\S]{0,520}top: env\(safe-area-inset-top, 0px\)/);
  assert.match(HUB_CSS_SOURCE, /html\[data-native-shell="expo"\] \.survey-hub \.header \{\s*top: 0;/);
  assert.match(EXPO_APP_SOURCE, /paddingTop: insets\.top/);
});

test('mobile shells lock page zoom without disabling app-controlled PDF pinch', () => {
  assert.match(
    INDEX_HTML_SOURCE,
    /name="viewport" content="[^"]*maximum-scale=1\.0[^"]*user-scalable=no[^"]*viewport-fit=cover"/,
  );
  assert.match(INDEX_HTML_SOURCE, /root\.dataset\.mobileViewport = 'locked'/);
  assert.match(INDEX_HTML_SOURCE, /nativeShell === 'expo' \|\| nativeShell === 'capacitor'/);
  assert.match(
    INDEX_HTML_SOURCE,
    /html\[data-mobile-viewport="locked"\][\s\S]{0,420}input:not\(\[type="hidden"\]\)[\s\S]{0,300}font-size: max\(16px, 1em\) !important/,
  );
  assert.match(INDEX_HTML_SOURCE, /addEventListener\('gesturestart', preventPageZoom, \{ passive: false \}\)/);
  assert.match(INDEX_HTML_SOURCE, /addEventListener\('gesturechange', preventPageZoom, \{ passive: false \}\)/);
  assert.match(INDEX_HTML_SOURCE, /addEventListener\('gestureend', preventPageZoom, \{ passive: false \}\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /source: 'pinch'/);
  assert.match(PDFJS_VIEWER_SOURCE, /event\.touches\.length >= 2/);
});

test('mobile selected text exposes the shared toolbar and its shared color picker', () => {
  assert.match(PDF_VIEWER_SOURCE, /hasLiveTextSelection:\s*!!liveTextSelection\?\.pages\?\.length/);
  assert.match(
    MOBILE_VIEWER_CHROME_SOURCE,
    /if \(textMarkup\.sharedToolbarActive\) \{[\s\S]*?api\.showAnnotationColorPicker[\s\S]*?<MobileColorPickerSurface/,
  );
});

test('Expo enforces the zoom lock inside its WebView even when the hosted app is older', () => {
  assert.match(EXPO_APP_SOURCE, /maximum-scale=1\.0, user-scalable=no/);
  assert.match(EXPO_APP_SOURCE, /data-survey-mobile-viewport-lock/);
  assert.match(EXPO_APP_SOURCE, /font-size: 16px !important/);
  assert.match(EXPO_APP_SOURCE, /addEventListener\('gesturestart', preventPageZoom, \{ passive: false \}\)/);
  assert.match(EXPO_APP_SOURCE, /root\.dataset\.mobileViewport = 'locked'/);
});

test('Expo gives external OAuth navigation a native dismiss button', () => {
  assert.match(EXPO_APP_SOURCE, /const \[externalNavigationActive, setExternalNavigationActive\] = useState\(false\)/);
  assert.match(EXPO_APP_SOURCE, /isExternalNavigationUrl\(state\.url\)/);
  assert.match(EXPO_APP_SOURCE, /accessibilityLabel="Close sign-in"/);
  assert.match(EXPO_APP_SOURCE, /const dismissExternalNavigation = \(\) =>/);
  assert.match(EXPO_APP_SOURCE, /setWebViewKey\(\(value\) => value \+ 1\)/);
  assert.match(EXPO_APP_SOURCE, /minWidth: 44/);
  assert.match(EXPO_APP_SOURCE, /minHeight: 44/);
  const closeStyle = EXPO_APP_SOURCE.match(/externalNavigationClose:\s*\{([\s\S]*?)\n\s*\},\n\s*externalNavigationCloseText:/)?.[1] || '';
  assert.doesNotMatch(closeStyle, /borderRadius|borderWidth|backgroundColor/);
});

test('Survey development build owns Google sign-in without exposing the Supabase callback host', () => {
  assert.match(EXPO_CONFIG_SOURCE, /"bundleIdentifier": "com\.kalvoe\.survey"/);
  assert.match(EXPO_CONFIG_SOURCE, /"appleTeamId": "T3KR4X5869"/);
  assert.match(EXPO_CONFIG_SOURCE, /com\.googleusercontent\.apps\.88293580204-481ecgudu1qgmlh2nvdhip13jtqj0iku/);
  assert.match(EXPO_PACKAGE_SOURCE, /"start:tunnel": "expo start --dev-client --tunnel"/);
  assert.match(EXPO_PACKAGE_SOURCE, /"start:remote": "EXPO_PUBLIC_SURVEY_URL='https:\/\/isaiahs-macbook-pro\.taila0b324\.ts\.net\/' expo start --dev-client --tunnel --port 8081"/);
  assert.match(EXPO_PACKAGE_SOURCE, /"start:remote:expo-go": "EXPO_PUBLIC_SURVEY_URL='https:\/\/isaiahs-macbook-pro\.taila0b324\.ts\.net\/' expo start --go --tunnel --port 8082"/);
  assert.match(EXPO_PACKAGE_SOURCE, /"start:simulator": "EXPO_PUBLIC_SURVEY_URL='http:\/\/127\.0\.0\.1:5177\/' expo start --dev-client --localhost --port 8084"/);
  assert.match(EXPO_APP_SOURCE, /new AuthSession\.AuthRequest/);
  assert.match(EXPO_APP_SOURCE, /responseType: AuthSession\.ResponseType\.Code/);
  assert.match(EXPO_APP_SOURCE, /usePKCE: true/);
  assert.match(EXPO_APP_SOURCE, /AuthSession\.exchangeCodeAsync/);
  assert.match(EXPO_APP_SOURCE, /result\.type === 'cancel' \|\| result\.type === 'dismiss'/);
  assert.match(EXPO_APP_SOURCE, /survey-native-google-auth-result/);
  assert.match(EXPO_APP_SOURCE, /ExecutionEnvironment\.StoreClient/);
  assert.match(EXPO_APP_SOURCE, /Google sign-in is not available in Expo Go\. Open the Survey app to continue\./);
  assert.match(EXPO_APP_SOURCE, /new URL\(event\.nativeEvent\.url\)\.origin !== SURVEY_ORIGIN/);
  assert.match(EXPO_APP_SOURCE, /onMessage=\{handleWebMessage\}/);
  assert.match(AUTH_CONTEXT_SOURCE, /window\.ReactNativeWebView\.postMessage/);
  assert.match(AUTH_CONTEXT_SOURCE, /supabase\.auth\.signInWithIdToken/);
  assert.match(AUTH_CONTEXT_SOURCE, /provider: 'google'/);
  assert.match(AUTH_CONTEXT_SOURCE, /token: result\.idToken/);
});

test('Expo has durable development, preview, and production build lanes', () => {
  const easConfig = JSON.parse(EXPO_EAS_CONFIG_SOURCE);
  assert.equal(easConfig.cli.appVersionSource, 'remote');
  assert.equal(easConfig.build.development.developmentClient, true);
  assert.equal(easConfig.build.development.distribution, 'internal');
  assert.equal(easConfig.build['development-simulator'].ios.simulator, true);
  assert.equal(easConfig.build.preview.channel, 'preview');
  assert.equal(easConfig.build.production.channel, 'production');
});

test('mobile PDF rendering stays inside the WKWebView memory budget', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_MAX_SCALE = 8/);
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_MAX_CANVAS_AREA = 3 \* 1024 \* 1024/);
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_BASE_MAX_SCALE = 1\.25/);
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_MAX_OVERSCAN_PAGES = 1/);
  assert.match(PDFJS_VIEWER_SOURCE, /target = document\.createElement\('canvas'\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /if \(target && !targetRetained\) releaseRasterCanvas\(target\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /finally \{\s*releaseRasterCanvas\(off\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /const externalPdf = isPdfDocumentProxy\(activeSource\) \? activeSource : null/);
});

test('mobile PDF pinch previews translation, progressively sharpens, and commits the same anchor', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /resolveGesturePreview\(g, oldScale \* lz\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /pendingAnchorRef\.current = \{ left: preview\.left, top: preview\.top \}/);
  assert.match(PDFJS_VIEWER_SOURCE, /translate\(\$\{liveTranslateX\}px, \$\{liveTranslateY\}px\) scale/);
  assert.match(PDFJS_VIEWER_SOURCE, /lastSharpAtRef/);
  assert.match(PDFJS_VIEWER_SOURCE, /240/);
});

test('mobile deep zoom-out rebases before WebKit composites an unsafe downscale', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /MOBILE_LIVE_ZOOM_REBASE_MIN = 0\.67/);
  assert.match(PDFJS_VIEWER_SOURCE, /checkpointPinchGesture/);
  assert.match(PDFJS_VIEWER_SOURCE, /nextLiveZoom < MOBILE_LIVE_ZOOM_REBASE_MIN/);
  assert.match(PDFJS_VIEWER_SOURCE, /PDF live zoom floor/);
  assert.match(PDFJS_VIEWER_SOURCE, /if \(isMobileSurface && liveZoom < 1\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /willChange: isMobileSurface[\s\S]{0,80}\? 'auto'/);
});

test('mobile pan keeps two-axis velocity and coasts after release', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /velocityX/);
  assert.match(PDFJS_VIEWER_SOURCE, /velocityY/);
  assert.match(PDFJS_VIEWER_SOURCE, /touchState\.samples\.push/);
  assert.match(PDFJS_VIEWER_SOURCE, /startMobilePanInertia\(velocityX, velocityY\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /PDF pan coast distance/);
  assert.match(PDFJS_VIEWER_SOURCE, /Math\.hypot\(vx, vy\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /Math\.exp\(-dt \/ 325\)/);
});

test('mobile PDF load paints page one before refining remaining page sizes', () => {
  const firstPage = PDFJS_VIEWER_SOURCE.indexOf('const firstPage = await pdf.getPage(1)');
  const visibleSizes = PDFJS_VIEWER_SOURCE.indexOf('setPageSizes(sizes.slice())', firstPage);
  const remainingPages = PDFJS_VIEWER_SOURCE.indexOf('for (let start = 2; start <= pdf.numPages', visibleSizes);
  assert.ok(firstPage > 0 && visibleSizes > firstPage && remainingPages > visibleSizes);
  assert.match(PDF_VIEWER_SOURCE, /if \(pdfFile\?\.id\) \{[\s\S]{0,260}setIsLoadingPDF\(false\)/);
  assert.match(PDF_VIEWER_SOURCE, /const transferCloudBytes = Boolean\(pdfFile\?\.id\)/);
  assert.match(PDF_VIEWER_SOURCE, /const primaryPdfData = transferCloudBytes \? arrayBuffer : arrayBuffer\.slice\(0\)/);
  assert.match(PDF_VIEWER_SOURCE, /survey_pdf_bytes_ready/);
  assert.match(PDF_VIEWER_SOURCE, /survey_pdf_parse_completed/);
  assert.match(PDF_VIEWER_SOURCE, /survey_pdf_first_page_ready/);
});

test('unsupported annotation notice is compact above the mobile dock and expands for details', () => {
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /Unsupported annotation/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /--mobile-viewer-dock-height/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /aria-expanded/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /COLLAPSED_DISMISS_MS = 3000/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /EXPANDED_DISMISS_MS = 5000/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /setIsExpanded\(\(expanded\) => !expanded\)/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /event\.stopPropagation\(\); handleDismiss\(\)/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /aria-label="Information"/);
  assert.match(UNSUPPORTED_NOTICE_SOURCE, /<Icon name="infoCircle" size=\{20\}/);
  assert.doesNotMatch(UNSUPPORTED_NOTICE_SOURCE, /M2 10C4\.1 6\.6/);
});

test('mobile pinch settles at the latest centroid and suppresses a staggered release', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /resolvePinchCommitCursor\(g\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /gestureRef\.current\.currentCursorX = center\.x/);
  assert.match(PDFJS_VIEWER_SOURCE, /resolvePinchEndTransition\(touchState\.mode, event\.touches\.length\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /mode === 'pinch-release'/);
});

test('Expo forwards narrow PDF diagnostics and reports WebView process termination', () => {
  assert.match(PDFJS_VIEWER_SOURCE, /type: 'survey:diagnostic'/);
  assert.match(EXPO_APP_SOURCE, /\[Survey phone PDF\]/);
  assert.match(EXPO_APP_SOURCE, /\[Survey shell\] WebView process terminated/);
  assert.doesNotMatch(EXPO_APP_SOURCE, /console\.error\('\[Survey shell\] WebView process terminated/);
  assert.match(EXPO_APP_SOURCE, /pdfDiagnosticRef\.current = \[\.\.\.pdfDiagnosticRef\.current, diagnostic\]\.slice\(-24\)/);
  assert.match(EXPO_APP_SOURCE, /survey_webview_process_terminated/);
  assert.doesNotMatch(EXPO_APP_SOURCE, /EXPO_PUBLIC_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY/);
  assert.match(EXPO_APP_SOURCE, /survey-native-analytics/);
  assert.match(EXPO_APP_SOURCE, /pendingNativeAnalyticsRef/);
  assert.match(EXPO_APP_SOURCE, /loadNativeDiagnosticState\(AsyncStorage\)/);
  assert.match(EXPO_APP_SOURCE, /nativePersistenceGateRef\.current\.persist/);
  assert.match(EXPO_APP_SOURCE, /survey:native-analytics-ack/);
  assert.match(EXPO_APP_SOURCE, /survey:native-analytics-nack/);
  assert.match(EXPO_APP_SOURCE, /scheduleNativeAnalyticsRetry/);
  assert.match(EXPO_APP_SOURCE, /createNativeDiagnosticPersistenceGate/);
  assert.match(EXPO_APP_SOURCE, /mergeNativeDiagnosticStates/);
  assert.match(EXPO_APP_SOURCE, /window\.__surveyShellReadySent/);
  assert.match(EXPO_APP_SOURCE, /shellReadyMessageHandledRef/);
  assert.match(EXPO_APP_SOURCE, /nativeAnalyticsInFlightRef/);
  assert.match(EXPO_APP_SOURCE, /claimNativeAnalyticsEvents/);
  assert.doesNotMatch(EXPO_APP_SOURCE, /deliveredIds/);
  assert.doesNotMatch(EXPO_APP_SOURCE, /pendingNativeAnalyticsRef\.current = \[\];/);
  assert.match(EXPO_PACKAGE_SOURCE, /@react-native-async-storage\/async-storage/);
  assert.match(EXPO_DIAGNOSTIC_STORE_SOURCE, /BLOCKED_KEY/);
  assert.match(EXPO_DIAGNOSTIC_STORE_SOURCE, /diagnostics\.slice\(-24\)/);
  assert.match(EXPO_DIAGNOSTIC_STORE_SOURCE, /pendingEvents\.slice\(-8\)/);
  assert.match(EXPO_APP_SOURCE, /lastPdfDiagnostics: pdfDiagnosticRef\.current/);
  assert.match(EXPO_APP_SOURCE, /window\.__surveyShellSessionId/);
});

test('hosted web and native shell analytics share a privacy-bounded session', () => {
  assert.match(MAIN_SOURCE, /installSurveyAnalytics\(\)/);
  assert.match(PDFJS_VIEWER_SOURCE, /trackSurveyAnalyticsEvent\(`survey_pdf_/);
  assert.doesNotMatch(SURVEY_ANALYTICS_SOURCE, /VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY/);
  assert.match(SURVEY_ANALYTICS_SOURCE, /window\.__surveyShellSessionId/);
  assert.match(SURVEY_ANALYTICS_SOURCE, /BLOCKED_PROPERTY/);
  assert.match(SURVEY_ANALYTICS_SOURCE, /keepalive: true/);
  assert.match(SURVEY_ANALYTICS_SOURCE, /getSupabaseSession\('surveyAnalytics'\)/);
  assert.match(SURVEY_ANALYTICS_SOURCE, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(SURVEY_ANALYTICS_SOURCE, /userId:/);
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
  assert.match(SVG_ANNOTATION_LAYER_SOURCE, /touchAction: \(isCreationTool \|\| \(activeTool === 'select' && selectionMode === 'lasso'\)\) \? 'none' : undefined/);
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
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.mobile-home-tabs \{[\s\S]{0,500}left: 0;[\s\S]{0,80}right: 0/);
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.mobile-home-tabs \{[\s\S]{0,1000}background: #0d0f14/);
  assert.match(HUB_CSS_SOURCE, /\.survey-hub \.mobile-home-tabs::before \{\s*display: none/);
});

test('mobile viewer rails do not mix flex shorthand with flexShrink during rerender', () => {
  assert.match(APP_SHELL_SOURCE, /id="chrome-left-host"[\s\S]{0,220}flexGrow: 0,[\s\S]{0,100}flexBasis: isMobileViewer \? '44px' : '48px',[\s\S]{0,100}flexShrink: 0/);
  assert.match(APP_SHELL_SOURCE, /id="chrome-right-host"[\s\S]{0,220}flexGrow: 0,[\s\S]{0,100}flexBasis: isMobileViewer \? '0px' : '48px',[\s\S]{0,100}flexShrink: 0/);
  assert.doesNotMatch(APP_SHELL_SOURCE, /flex: isMobileViewer \? '0 0 (?:0|44)px' : '0 0 48px'/);
  assert.match(
    APP_SHELL_SOURCE,
    /id="chrome-sub-toolbar-host"[\s\S]{0,320}display: isViewerVisible[\s\S]{0,180}activeTool === 'text-select'[\s\S]{0,180}contextTool === 'text-markup'/,
    'mobile text selection and existing text markup must expose the shared full-width action bar',
  );
  assert.match(
    APP_SHELL_SOURCE,
    /zIndex: isMobileViewer && \([\s\S]{0,180}activeTool === 'text-select'[\s\S]{0,120}contextTool === 'text-markup'[\s\S]{0,80}\) \? 5800 : 5400/,
    'the mobile text action bar must sit above the old mobile property strip',
  );
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
    {
      state: 'syncing',
      label: 'Syncing...',
      detail: 'Survey is loading and backing up this document’s cloud changes.',
      retryLabel: 'Keep this document open while backup finishes.',
      compactMessage: 'Loading and backing up this document.',
      color: '#f5a524',
    },
  );
  assert.deepEqual(
    getMobileSyncPresentation({ stage: 'queued' }, 3, true),
    {
      state: 'offline',
      label: 'Offline · 3 saved locally',
      detail: 'Your changes are safe on this device and are waiting for cloud backup.',
      retryLabel: 'Backup is retrying automatically.',
      compactMessage: '3 changes are safe locally and waiting to back up.',
      color: '#ef4444',
    },
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

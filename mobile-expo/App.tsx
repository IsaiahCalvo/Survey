import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import { discovery as googleDiscovery } from 'expo-auth-session/providers/google';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  acknowledgeNativeAnalyticsEvents,
  claimNativeAnalyticsEvents,
  createNativeDiagnosticPersistenceGate,
  loadNativeDiagnosticState,
  mergeNativeDiagnosticStates,
} from './src/nativeDiagnosticStore.js';
import { parseNativeShellMessage, resolveSurveyDeepLink } from './src/nativeShellProtocol.js';

export { resolveSurveyDeepLink } from './src/nativeShellProtocol.js';

const DEFAULT_SURVEY_URL = 'https://surveytool.app/mobile';
const GOOGLE_IOS_CLIENT_ID = '88293580204-481ecgudu1qgmlh2nvdhip13jtqj0iku.apps.googleusercontent.com';
const GOOGLE_REDIRECT_URI = 'com.googleusercontent.apps.88293580204-481ecgudu1qgmlh2nvdhip13jtqj0iku:/oauthredirect';

WebBrowser.maybeCompleteAuthSession();

function resolveSurveyUrl(configuredUrl = process.env.EXPO_PUBLIC_SURVEY_URL) {
  try {
    const url = new URL(configuredUrl?.trim() || DEFAULT_SURVEY_URL);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`Unsupported Survey URL protocol: ${url.protocol}`);
    }
    // These identify the real mobile viewer and the native safe-area bridge.
    // Override conflicting caller values so every shell launch is consistent.
    url.searchParams.set('mobileNav', 'tabs');
    url.searchParams.set('nativeShell', 'expo');
    return url.toString();
  } catch (error) {
    console.warn('Invalid EXPO_PUBLIC_SURVEY_URL; using the deployed Survey app.', error);
    const fallbackUrl = new URL(DEFAULT_SURVEY_URL);
    fallbackUrl.searchParams.set('mobileNav', 'tabs');
    fallbackUrl.searchParams.set('nativeShell', 'expo');
    return fallbackUrl.toString();
  }
}

function withLaunchCacheBust(surveyUrl: string, launchId: string) {
  const url = new URL(surveyUrl);
  // Expo Go keeps the WKWebView data store (and therefore auth) between
  // launches. A launch-scoped URL bypasses stale HTML without clearing the
  // signed-in profile or disabling caching for hashed assets and PDFs.
  url.searchParams.set('shellLaunch', launchId);
  return url.toString();
}

const SURVEY_URL = resolveSurveyUrl();
const SURVEY_ORIGIN = new URL(SURVEY_URL).origin;
const SHELL_LOAD_TIMEOUT_MS = 15_000;
console.info('[Survey shell]', { runtime: 'expo', url: SURVEY_URL });

function isExternalNavigationUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && parsed.origin !== SURVEY_ORIGIN;
  } catch {
    return false;
  }
}

function SurveyApp() {
  const webViewRef = useRef<WebView>(null);
  const processRecoveryRef = useRef<number[]>([]);
  const pdfDiagnosticRef = useRef<Array<Record<string, unknown>>>([]);
  const pendingNativeAnalyticsRef = useRef<Array<Record<string, unknown>>>([]);
  const nativeStoreHydratedRef = useRef(false);
  const nativeStoreWarningRef = useRef(false);
  const nativePersistenceGateRef = useRef(createNativeDiagnosticPersistenceGate(AsyncStorage));
  const nativeAnalyticsInFlightRef = useRef(new Set<string>());
  const nativeAnalyticsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellReadyRef = useRef(false);
  const shellReadyMessageHandledRef = useRef(false);
  const shellSessionIdRef = useRef(`expo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const surveyLaunchUrlRef = useRef(withLaunchCacheBust(SURVEY_URL, shellSessionIdRef.current));
  const googleAuthInFlightRef = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [externalNavigationActive, setExternalNavigationActive] = useState(false);
  const insets = useSafeAreaInsets();
  const nativeBottomInset = Math.max(insets.bottom, 10);
  // 2026-07-12 (S2 device-adaptive safe areas): publish ALL four device-
  // reported insets so the web side can be curve-aware (rounded corners,
  // notch) everywhere. The shell still pads the TOP natively (paddingTop
  // below), so --native-safe-area-top is informational — web chrome must not
  // consume it while running inside the shell (html[data-native-shell] rules
  // pin the header to 34px). Portrait is locked in app.json, so left/right
  // are normally 0; they exist for corner-curve awareness only.
  const nativeTopInset = Math.max(insets.top, 0);
  const nativeLeftInset = Math.max(insets.left, 0);
  const nativeRightInset = Math.max(insets.right, 0);
  const nativeSafeAreaScript = useMemo(() => `
    (() => {
      const root = document.documentElement;
      const viewportContent = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
      let viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        (document.head || root).appendChild(viewport);
      }
      viewport.setAttribute('content', viewportContent);

      let viewportStyle = document.querySelector('style[data-survey-mobile-viewport-lock]');
      if (!viewportStyle) {
        viewportStyle = document.createElement('style');
        viewportStyle.setAttribute('data-survey-mobile-viewport-lock', '');
        viewportStyle.textContent = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"] { font-size: 16px !important; }';
        (document.head || root).appendChild(viewportStyle);
      }

      if (!window.__surveyPageZoomLockInstalled) {
        const preventPageZoom = (event) => event.preventDefault();
        document.addEventListener('gesturestart', preventPageZoom, { passive: false });
        document.addEventListener('gesturechange', preventPageZoom, { passive: false });
        document.addEventListener('gestureend', preventPageZoom, { passive: false });
        window.__surveyPageZoomLockInstalled = true;
      }

      root.style.setProperty('--native-safe-area-bottom', '${nativeBottomInset}px');
      root.style.setProperty('--native-safe-area-top', '${nativeTopInset}px');
      root.style.setProperty('--native-safe-area-left', '${nativeLeftInset}px');
      root.style.setProperty('--native-safe-area-right', '${nativeRightInset}px');
      root.dataset.nativeShell = 'expo';
      root.dataset.mobileViewport = 'locked';
      window.__surveyShellSessionId = '${shellSessionIdRef.current}';
      window.dispatchEvent(new CustomEvent('survey-native-safe-area-change', {
        detail: { bottom: ${nativeBottomInset}, top: ${nativeTopInset}, left: ${nativeLeftInset}, right: ${nativeRightInset} }
      }));

      const notifyShellReady = () => {
        if (window.__surveyShellReadySent) return true;
        const appRoot = document.getElementById('root');
        if (!appRoot?.firstElementChild || !window.ReactNativeWebView) return false;
        window.__surveyShellReadySent = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'survey:shell-ready' }));
        window.__surveyShellReadyObserver?.disconnect();
        window.__surveyShellReadyObserver = null;
        return true;
      };
      if (!notifyShellReady() && !window.__surveyShellReadyObserver) {
        window.__surveyShellReadyObserver = new MutationObserver(notifyShellReady);
        window.__surveyShellReadyObserver.observe(root, { childList: true, subtree: true });
      }
    })();
    true;
  `, [nativeBottomInset, nativeTopInset, nativeLeftInset, nativeRightInset]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(nativeSafeAreaScript);
  }, [nativeSafeAreaScript]);

  useEffect(() => () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (nativeAnalyticsRetryTimerRef.current) clearTimeout(nativeAnalyticsRetryTimerRef.current);
  }, []);

  const persistNativeDiagnosticState = () => {
    void nativePersistenceGateRef.current.persist(() => ({
        diagnostics: pdfDiagnosticRef.current,
        pendingEvents: pendingNativeAnalyticsRef.current,
        recoveries: processRecoveryRef.current,
      }))
      .catch(() => {
        if (nativeStoreWarningRef.current) return;
        nativeStoreWarningRef.current = true;
        console.warn('[Survey shell] Native diagnostic storage unavailable');
      });
  };

  useEffect(() => {
    let active = true;
    void loadNativeDiagnosticState(AsyncStorage).then((stored) => {
      if (!active) return;
      const merged = mergeNativeDiagnosticStates(stored, {
        diagnostics: pdfDiagnosticRef.current,
        pendingEvents: pendingNativeAnalyticsRef.current,
        recoveries: processRecoveryRef.current,
      });
      pdfDiagnosticRef.current = merged.diagnostics;
      pendingNativeAnalyticsRef.current = merged.pendingEvents;
      processRecoveryRef.current = merged.recoveries;
      nativeStoreHydratedRef.current = true;
      void nativePersistenceGateRef.current.markHydrated().catch(() => undefined);
      persistNativeDiagnosticState();
      if (shellReadyRef.current) flushNativeAnalyticsEvents();
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const openDeepLink = (url: string | null | undefined) => {
      const target = resolveSurveyDeepLink(url);
      if (!target) return;
      const launchId = `${shellSessionIdRef.current}-link-${Date.now()}`;
      surveyLaunchUrlRef.current = withLaunchCacheBust(target, launchId);
      setExternalNavigationActive(false);
      setCanGoBack(false);
      beginShellLoad();
      setWebViewKey((value) => value + 1);
    };
    void Linking.getInitialURL().then(openDeepLink).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => openDeepLink(url));
    return () => subscription.remove();
  }, []);

  const beginShellLoad = () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    setLoadError(false);
    setShellReady(false);
    shellReadyRef.current = false;
    shellReadyMessageHandledRef.current = false;
    nativeAnalyticsInFlightRef.current.clear();
    loadTimeoutRef.current = setTimeout(() => {
      loadTimeoutRef.current = null;
      setShellReady(false);
      shellReadyRef.current = false;
      setLoadError(true);
    }, SHELL_LOAD_TIMEOUT_MS);
  };

  const finishShellLoad = () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
    setLoadError(false);
    setShellReady(true);
    shellReadyRef.current = true;
  };

  const failShellLoad = () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
    setShellReady(false);
    shellReadyRef.current = false;
    setLoadError(true);
  };

  const handleLoadStart = (event: { nativeEvent: { url: string } }) => {
    // OAuth pages render inside this WebView but do not own Survey's #root.
    // Keep them visible instead of waiting for the Survey-ready bridge.
    if (isExternalNavigationUrl(event.nativeEvent.url)) return;
    beginShellLoad();
  };

  const retry = () => {
    processRecoveryRef.current = [];
    persistNativeDiagnosticState();
    surveyLaunchUrlRef.current = withLaunchCacheBust(SURVEY_URL, `${shellSessionIdRef.current}-retry-${Date.now()}`);
    beginShellLoad();
    setWebViewKey((value) => value + 1);
  };

  const dismissExternalNavigation = () => {
    setExternalNavigationActive(false);
    setCanGoBack(false);
    setWebViewKey((value) => value + 1);
  };

  const sendGoogleAuthResult = (payload: Record<string, unknown>) => {
    const serialized = JSON.stringify(payload)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new CustomEvent('survey-native-google-auth-result', {
        detail: ${serialized}
      }));
      true;
    `);
  };

  const queueNativeAnalyticsEvent = (event: string, properties: Record<string, unknown>) => {
    pendingNativeAnalyticsRef.current = [...pendingNativeAnalyticsRef.current, {
      id: `native-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      event,
      properties: {
        surface: 'expo-webview',
        os: Platform.OS,
        route: '/mobile',
        ...properties,
      },
    }].slice(-8);
    persistNativeDiagnosticState();
  };

  function flushNativeAnalyticsEvents() {
    if (!nativeStoreHydratedRef.current || !shellReadyRef.current) return;
    const pending = claimNativeAnalyticsEvents(
      pendingNativeAnalyticsRef.current,
      nativeAnalyticsInFlightRef.current,
    );
    if (!pending.length) return;
    const serialized = JSON.stringify(pending)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    webViewRef.current?.injectJavaScript(`
      for (const entry of ${serialized}) {
        window.dispatchEvent(new CustomEvent('survey-native-analytics', { detail: entry }));
      }
      true;
    `);
  }

  const scheduleNativeAnalyticsRetry = (retryAfterMs: number) => {
    if (nativeAnalyticsRetryTimerRef.current) return;
    const delay = Math.max(5_000, Math.min(Number(retryAfterMs) || 30_000, 15 * 60_000));
    nativeAnalyticsRetryTimerRef.current = setTimeout(() => {
      nativeAnalyticsRetryTimerRef.current = null;
      flushNativeAnalyticsEvents();
    }, delay);
  };

  const handleGoogleSignIn = async (requestId: string) => {
    if (googleAuthInFlightRef.current) {
      sendGoogleAuthResult({ requestId, ok: false, error: 'Google sign-in is already open.' });
      return;
    }

    googleAuthInFlightRef.current = true;
    try {
      if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
        throw new Error('Google sign-in is not available in Expo Go. Open the Survey app to continue.');
      }

      const request = new AuthSession.AuthRequest({
        clientId: GOOGLE_IOS_CLIENT_ID,
        redirectUri: GOOGLE_REDIRECT_URI,
        responseType: AuthSession.ResponseType.Code,
        scopes: ['openid', 'profile', 'email'],
        prompt: AuthSession.Prompt.SelectAccount,
        usePKCE: true,
      });
      const result = await request.promptAsync(googleDiscovery);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        sendGoogleAuthResult({ requestId, ok: false, cancelled: true });
        return;
      }
      if (result.type !== 'success' || !result.params.code) {
        throw new Error(result.type === 'error'
          ? result.error?.message || 'Google sign-in failed.'
          : 'Google sign-in did not return an authorization code.');
      }

      const tokens = await AuthSession.exchangeCodeAsync({
        clientId: GOOGLE_IOS_CLIENT_ID,
        code: result.params.code,
        redirectUri: GOOGLE_REDIRECT_URI,
        extraParams: { code_verifier: request.codeVerifier || '' },
      }, googleDiscovery);
      if (!tokens.idToken) {
        throw new Error('Google sign-in did not return an identity token.');
      }

      sendGoogleAuthResult({ requestId, ok: true, idToken: tokens.idToken });
    } catch (error) {
      sendGoogleAuthResult({
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : 'Google sign-in failed.',
      });
    } finally {
      googleAuthInFlightRef.current = false;
    }
  };

  const handleWebMessage = (event: WebViewMessageEvent) => {
    try {
      if (new URL(event.nativeEvent.url).origin !== SURVEY_ORIGIN) return;
      const message = parseNativeShellMessage(event.nativeEvent.data);
      if (!message) return;
      if (message?.type === 'survey:google-sign-in' && typeof message.requestId === 'string') {
        void handleGoogleSignIn(message.requestId);
      } else if (message?.type === 'survey:shell-ready') {
        if (shellReadyMessageHandledRef.current) return;
        shellReadyMessageHandledRef.current = true;
        finishShellLoad();
        flushNativeAnalyticsEvents();
      } else if (message?.type === 'survey:native-analytics-ack' && Array.isArray(message.ids)) {
        for (const id of message.ids) nativeAnalyticsInFlightRef.current.delete(String(id));
        pendingNativeAnalyticsRef.current = acknowledgeNativeAnalyticsEvents(
          pendingNativeAnalyticsRef.current,
          message.ids,
        );
        persistNativeDiagnosticState();
      } else if (message?.type === 'survey:native-analytics-nack' && Array.isArray(message.ids)) {
        for (const id of message.ids) nativeAnalyticsInFlightRef.current.delete(String(id));
        // A negative acknowledgement never removes the persisted diagnostic.
        // Auth, network, collector, and quota failures remain retryable.
        persistNativeDiagnosticState();
        if (message.retryable !== false) scheduleNativeAnalyticsRetry(Number(message.retryAfterMs));
      } else if (message?.type === 'survey:diagnostic' && message.area === 'pdf-zoom') {
        const diagnostic = {
          event: message.event,
          detail: message.detail,
          timestamp: message.timestamp,
        };
        pdfDiagnosticRef.current = [...pdfDiagnosticRef.current, diagnostic].slice(-24);
        persistNativeDiagnosticState();
        console.info('[Survey phone PDF]', {
          ...diagnostic,
        });
      }
    } catch {
      // Ignore messages that are not part of Survey's small native bridge.
    }
  };

  const handleNavigationStateChange = (state: { canGoBack: boolean; url: string }) => {
    setCanGoBack(state.canGoBack);
    setExternalNavigationActive(isExternalNavigationUrl(state.url));
  };

  const recoverTerminatedProcess = (source: string) => {
    const now = Date.now();
    const recent = processRecoveryRef.current.filter((time) => now - time < 60_000);
    // Keep the recovery visible in Metro/device logs without opening Expo's
    // full-screen red LogBox over the app. The shell already owns the reload or
    // terminal error UI below; this diagnostic is not a React render failure.
    console.warn('[Survey shell] WebView process terminated', {
      source,
      recoveriesInLastMinute: recent.length,
      timestamp: now,
      lastPdfDiagnostics: pdfDiagnosticRef.current,
    });
    queueNativeAnalyticsEvent('$exception', {
      exceptionType: 'WebViewProcessTerminated',
      fatal: true,
      unhandled: true,
      source,
      recoveriesInLastMinute: recent.length,
      lastPdfDiagnostics: pdfDiagnosticRef.current,
    });
    queueNativeAnalyticsEvent('survey_webview_process_terminated', {
      source,
      recoveriesInLastMinute: recent.length,
      lastPdfDiagnostics: pdfDiagnosticRef.current,
    });
    if (recent.length >= 2) {
      processRecoveryRef.current = recent;
      persistNativeDiagnosticState();
      setLoadError(true);
      return;
    }
    processRecoveryRef.current = [...recent, now];
    persistNativeDiagnosticState();
    setLoadError(false);
    setWebViewKey((value) => value + 1);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ uri: surveyLaunchUrlRef.current }}
        style={styles.webView}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        setBuiltInZoomControls={false}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentInset={{ top: 0, right: 0, bottom: 0, left: 0 }}
        injectedJavaScriptBeforeContentLoaded={nativeSafeAreaScript}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.centered}>
            <ActivityIndicator color={PALETTE.accent} />
          </View>
        )}
        onLoadStart={handleLoadStart}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleWebMessage}
        onLoadEnd={() => {
          webViewRef.current?.injectJavaScript(nativeSafeAreaScript);
        }}
        onError={failShellLoad}
        onHttpError={failShellLoad}
        onContentProcessDidTerminate={() => recoverTerminatedProcess('ios-content-process')}
        onRenderProcessGone={() => {
          recoverTerminatedProcess('android-render-process');
          return true;
        }}
      />
      {!shellReady && !loadError ? (
        <View pointerEvents="none" style={styles.centered}>
          <ActivityIndicator color={PALETTE.accent} />
        </View>
      ) : null}
      {externalNavigationActive ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sign-in"
          hitSlop={8}
          onPress={dismissExternalNavigation}
          style={[styles.externalNavigationClose, { top: insets.top + 8 }]}
        >
          <Text style={styles.externalNavigationCloseText}>×</Text>
        </Pressable>
      ) : null}
      {loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Survey could not connect</Text>
          <Text style={styles.errorBody}>Check this phone's connection and make sure the selected Survey server is online.</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SurveyApp />
    </SafeAreaProvider>
  );
}

// UX 2026-09-17 (revision-2 palette, owner approved): the Expo Go shell had
// five colours of its own — a near-black #090C12 root, a cool white #F4F5F7,
// a grey #9CA3AF, a warm cream #F4F1EA and a near-black button ink #11141A —
// none of which the app itself uses. React Native cannot read a CSS variable,
// so the tokens from src/styles/tokens.css are mirrored here as literals.
// Keep the two in step: this file is the ONLY place the native shell paints.
const PALETTE = {
  surface0: '#0d0f14',   // --surface-0
  text1: '#dadfe8',      // --text-1
  text3: '#8d96a6',      // --text-3
  accent: '#d8a84e',     // --accent
  accentText: '#15110a', // --accent-text
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PALETTE.surface0,
  },
  webView: {
    flex: 1,
    backgroundColor: PALETTE.surface0,
  },
  externalNavigationClose: {
    position: 'absolute',
    right: 12,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 12,
  },
  externalNavigationCloseText: {
    color: PALETTE.text1,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '400',
  },
  centered: {
    // RN 0.86 (Expo SDK 57) removed StyleSheet.absoluteFillObject; absoluteFill
    // is the same {position:'absolute', top/right/bottom/left: 0} object and is
    // the supported spelling. Spreading the removed export would have silently
    // dropped the overlay's absolute positioning.
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PALETTE.surface0,
    padding: 24,
  },
  errorTitle: {
    color: PALETTE.text1,
    fontSize: 18,
    fontWeight: '700',
  },
  errorBody: {
    color: PALETTE.text3,
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 120,
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: PALETTE.accent,
  },
  retryButtonText: {
    color: PALETTE.accentText,
    fontSize: 14,
    fontWeight: '700',
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const SURVEY_URL = 'http://isaiahs-macbook-pro.taila0b324.ts.net:5177/?mobileNav=tabs&nativeShell=expo';

function SurveyApp() {
  const webViewRef = useRef<WebView>(null);
  const processRecoveryRef = useRef<number[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
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
      root.style.setProperty('--native-safe-area-bottom', '${nativeBottomInset}px');
      root.style.setProperty('--native-safe-area-top', '${nativeTopInset}px');
      root.style.setProperty('--native-safe-area-left', '${nativeLeftInset}px');
      root.style.setProperty('--native-safe-area-right', '${nativeRightInset}px');
      root.dataset.nativeShell = 'expo';
      window.dispatchEvent(new CustomEvent('survey-native-safe-area-change', {
        detail: { bottom: ${nativeBottomInset}, top: ${nativeTopInset}, left: ${nativeLeftInset}, right: ${nativeRightInset} }
      }));
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

  const retry = () => {
    processRecoveryRef.current = [];
    setLoadError(false);
    setWebViewKey((value) => value + 1);
  };

  const recoverTerminatedProcess = () => {
    const now = Date.now();
    const recent = processRecoveryRef.current.filter((time) => now - time < 60_000);
    if (recent.length >= 2) {
      processRecoveryRef.current = recent;
      setLoadError(true);
      return;
    }
    processRecoveryRef.current = [...recent, now];
    setLoadError(false);
    setWebViewKey((value) => value + 1);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ uri: SURVEY_URL }}
        style={styles.webView}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
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
            <ActivityIndicator color="#D8A84E" />
          </View>
        )}
        onLoadStart={() => setLoadError(false)}
        onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
        onLoadEnd={() => webViewRef.current?.injectJavaScript(nativeSafeAreaScript)}
        onError={() => setLoadError(true)}
        onHttpError={() => setLoadError(true)}
        onContentProcessDidTerminate={recoverTerminatedProcess}
        onRenderProcessGone={() => {
          recoverTerminatedProcess();
          return true;
        }}
      />
      {loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Survey could not connect</Text>
          <Text style={styles.errorBody}>Keep Tailscale running on this phone and the laptop.</Text>
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#090C12',
  },
  webView: {
    flex: 1,
    backgroundColor: '#090C12',
  },
  centered: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#090C12',
    padding: 24,
  },
  errorTitle: {
    color: '#F4F5F7',
    fontSize: 18,
    fontWeight: '700',
  },
  errorBody: {
    color: '#9CA3AF',
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
    backgroundColor: '#D8A84E',
  },
  retryButtonText: {
    color: '#11141A',
    fontSize: 14,
    fontWeight: '700',
  },
});

import type { CapacitorConfig } from '@capacitor/cli';

// UX 2026-04-22: Capacitor wraps the Vite-built web bundle as native iOS and
// Android apps. The same bundle ships to Electron (desktop) and the two
// mobile targets without a fork. The `webDir` must match Vite's build output;
// `appId` is the permanent store identifier — do not change after submission.
const config: CapacitorConfig = {
  appId: 'com.kalvoe.survey',
  appName: 'Survey',
  webDir: 'dist',
  server: {
    // Dev convenience: when set, the app loads from this URL instead of the
    // bundled dist/ folder — lets us point a simulator at the running Vite
    // dev server for hot reload. Leave commented out for production builds.
    // url: 'http://192.168.1.10:5173',
    // cleartext: true,
  },
  ios: {
    // UX 2026-04-22: Let the web view fill the whole screen edge-to-edge;
    // CSS safe-area insets inside the app handle the content padding. With
    // `always`, the native shell pushed the web view down past the status
    // bar and revealed a white iOS root view behind it. `never` + dark
    // native background makes the status-bar strip match the app's grey.
    contentInset: 'never',
    backgroundColor: '#1E1E1E'
  },
  backgroundColor: '#1E1E1E'
};

export default config;

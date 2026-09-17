import type { CapacitorConfig } from '@capacitor/cli';

// UX 2026-04-22: Capacitor wraps the Vite-built web bundle as native iOS and
// Android apps. The same bundle ships to Electron (desktop) and the two
// mobile targets without a fork. The `webDir` must match Vite's build output;
// `appId` is the permanent store identifier — do not change after submission.
const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const liveReloadUrl = env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.kalvoe.survey',
  appName: 'Survey',
  webDir: 'dist',
  ...(liveReloadUrl
    ? {
        server: {
          // Dev-only live reload: set CAPACITOR_SERVER_URL to a LAN/Tailscale
          // Vite URL before `npx cap sync`. Omit it for production builds.
          url: liveReloadUrl,
          cleartext: true
        }
      }
    : {}),
  ios: {
    // UX 2026-04-22: Let the web view fill the whole screen edge-to-edge;
    // CSS safe-area insets inside the app handle the content padding. With
    // `always`, the native shell pushed the web view down past the status
    // bar and revealed a white iOS root view behind it. `never` + dark
    // native background makes the status-bar strip match the app's grey.
    //
    // UX 2026-09-17 (revision-2 palette): this is --surface-1 from
    // src/styles/tokens.css, written as a literal because a native config
    // cannot read a CSS variable. It is what `npx cap sync` copies into
    // ios/App/App/capacitor.config.json, so changing it here is the only
    // place the native background is decided. Keep it in step with the token.
    contentInset: 'never',
    backgroundColor: '#171a21'
  },
  backgroundColor: '#171a21'
};

export default config;

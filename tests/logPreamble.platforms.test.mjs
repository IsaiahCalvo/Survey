import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLogPreamble } from '../src/utils/logPreamble.js';

async function withNavigator(ua, fn) {
  const originalNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: ua, language: 'en-US' },
  });
  try {
    return await fn();
  } finally {
    if (originalNav) Object.defineProperty(globalThis, 'navigator', originalNav);
    else delete globalThis.navigator;
  }
}

test('buildLogPreamble covers desktop/mobile/web platform + OS branches', async () => {
  const originalWindow = globalThis.window;

  try {
    globalThis.window = {
      electronAPI: {},
      location: { protocol: 'file:', hostname: '' },
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 2,
      innerWidth: 1200,
      innerHeight: 800,
    };
    await withNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', async () => {
      const desktopText = buildLogPreamble({ description: 'desk' });
      assert.match(desktopText, /platform:\s+desktop/);
      assert.match(desktopText, /runtime:\s+desktop-installer/);
      assert.match(desktopText, /os:\s+macOS/);
    });

    globalThis.window = {
      Capacitor: { isNativePlatform: () => true },
      location: { protocol: 'https:', hostname: 'app.example' },
      screen: { width: 800, height: 600 },
      innerWidth: 800,
      innerHeight: 600,
    };
    await withNavigator('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', async () => {
      assert.match(buildLogPreamble(), /platform:\s+ipad/);
      assert.match(buildLogPreamble(), /runtime:\s+mobile-build/);
    });

    await withNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', async () => {
      assert.match(buildLogPreamble(), /platform:\s+iphone/);
    });

    await withNavigator('Mozilla/5.0 (Linux; Android 13; Pixel 7)', async () => {
      assert.match(buildLogPreamble(), /platform:\s+android/);
      assert.match(buildLogPreamble(), /device:\s+Pixel 7/);
    });

    await withNavigator('Mozilla/5.0 (Linux; Android 13) Mobile', async () => {
      assert.match(buildLogPreamble(), /platform:\s+android/);
    });

    globalThis.window = {
      location: { protocol: 'http:', hostname: 'localhost' },
      electronAPI: {},
      screen: { width: 1, height: 1 },
      innerWidth: 1,
      innerHeight: 1,
    };
    await withNavigator('Mozilla/5.0 (Windows NT 10.0)', async () => {
      assert.match(buildLogPreamble(), /runtime:\s+(dev-server|desktop-installer)/);
      assert.match(buildLogPreamble(), /os:\s+Windows/);
    });

    // Capacitor native without matching UA → generic mobile platform
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true },
      location: { protocol: 'https:', hostname: 'app.example' },
      screen: { width: 400, height: 400 },
      innerWidth: 400,
      innerHeight: 400,
    };
    await withNavigator('Mozilla/5.0 (UnknownTablet)', async () => {
      assert.match(buildLogPreamble(), /platform:\s+mobile/);
    });

    // Plain browser window (no electron / Capacitor) → platform web
    globalThis.window = {
      location: { protocol: 'https:', hostname: 'app.example' },
      screen: { width: 1280, height: 720 },
      innerWidth: 1280,
      innerHeight: 720,
    };
    await withNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', async () => {
      assert.match(buildLogPreamble(), /platform:\s+web/);
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

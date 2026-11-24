// src/suiteLook.js - the suite look: shared greys and Survey's gold, dark only (KAL-663; gold again and dark only since 2026-11-24).
//
// Survey, Walkthru and Plot share one colour set (docs/suite/SUITE-RULES.md,
// "One colour set"). The values live in src/styles/tokens.css under
// html[data-look="suite"]; this file only decides whether that attribute is
// on. Survey is dark only (owner 2026-11-24): there is no light mode and no
// Appearance setting, so data-theme is always "dark".
//
// Nightly first: the look is on only where the beta flag 'one-look' is on.
// Without the flag nothing here touches the page and Survey keeps the palette
// it had.
//
// index.html reads the saved look key before the first paint, so a reload
// never flashes the old colours. Keep the key name here and there the same
// (tests/suiteLook.test.mjs checks).
import { isFeatureOn } from './featureFlags.js';

export const SUITE_LOOK_FLAG = 'one-look';
// The old Appearance setting's key. Nothing reads it now; it is cleared.
export const OLD_APPEARANCE_KEY = 'survey:appearance';
// '1' while the look is on, so index.html can set it before the app loads.
export const LOOK_CACHE_KEY = 'survey:look';
// The browser bar and the phone status strip: the ground colour.
export const THEME_COLOR = '#131315';

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function isSuiteLookOn(options) {
  return isFeatureOn(SUITE_LOOK_FLAG, options);
}

// The mode the page is in: always 'dark' now. Kept for the few things that
// can't read a colour name, such as another maker's widget that only takes
// "light" or "dark".
export function currentTheme() {
  return 'dark';
}

// Put the look (or its absence) on the page. Returns 'dark' while the look is
// on, or null when it is off.
export function applySuiteLook({
  doc = typeof document !== 'undefined' ? document : null,
  storage = safeStorage(),
  on = isSuiteLookOn({ storage }),
} = {}) {
  const root = doc?.documentElement;
  if (!root) return null;
  try { storage?.removeItem(OLD_APPEARANCE_KEY); } catch { /* blocked storage */ }
  if (!on) {
    root.removeAttribute('data-look');
    root.removeAttribute('data-theme');
    try { storage?.removeItem(LOOK_CACHE_KEY); } catch { /* blocked storage */ }
    return null;
  }
  root.setAttribute('data-look', 'suite');
  root.setAttribute('data-theme', 'dark');
  try { storage?.setItem(LOOK_CACHE_KEY, '1'); } catch { /* blocked storage */ }
  doc.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR);
  doc.querySelector?.('meta[name="color-scheme"]')?.setAttribute('content', 'dark');
  return 'dark';
}

// Called once at load (src/main.jsx).
export function installSuiteLook() {
  return applySuiteLook();
}

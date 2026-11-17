// src/suiteLook.js - the suite look: grey and coral, dark and light (KAL-663).
//
// Survey, Walkthru and Plot share one colour set (docs/suite/SUITE-RULES.md,
// "One colour set"). The values live in src/styles/tokens.css under
// html[data-look="suite"]; this file only decides whether that attribute is
// on, and which mode (data-theme="dark" or "light") goes with it.
//
// Nightly first: the look is on only where the beta flag 'one-look' is on.
// Without the flag nothing here touches the page and Survey keeps the palette
// it had.
//
// Appearance is this device's setting (Light, Dark, Match system), like the
// other per-device settings in src/utils/annotationPreferences.js. Survey
// opens dark until the person picks.
//
// index.html reads the two saved keys before the first paint, so a reload
// never flashes the old colours or the wrong mode. Keep the key names here
// and there the same (tests/suiteLook.test.mjs checks).
import { isFeatureOn } from './featureFlags.js';

export const SUITE_LOOK_FLAG = 'one-look';
export const APPEARANCE_KEY = 'survey:appearance';
export const APPEARANCE_CHOICES = Object.freeze(['light', 'dark', 'system']);
export const APPEARANCE_DEFAULT = 'dark';
// '1' while the look is on, so index.html can set it before the app loads.
export const LOOK_CACHE_KEY = 'survey:look';
export const APPEARANCE_EVENT = 'survey:appearance-changed';
// The browser bar and the phone status strip: the ground colour of each mode.
export const THEME_COLOR = Object.freeze({ dark: '#131315', light: '#f4f4f6' });

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

let appearanceMemo = null;

export function readAppearance(storage = safeStorage()) {
  try {
    const stored = storage?.getItem(APPEARANCE_KEY);
    if (APPEARANCE_CHOICES.includes(stored)) return stored;
  } catch { /* blocked storage */ }
  return appearanceMemo ?? APPEARANCE_DEFAULT;
}

export function prefersDark(win = typeof window !== 'undefined' ? window : null) {
  try { return win?.matchMedia?.('(prefers-color-scheme: dark)')?.matches !== false; } catch { return true; }
}

// 'light' or 'dark' for a saved choice. Match system follows the device.
export function resolveTheme(appearance, systemDark = prefersDark()) {
  if (appearance === 'light') return 'light';
  if (appearance === 'system') return systemDark ? 'dark' : 'light';
  return 'dark';
}

export function isSuiteLookOn(options) {
  return isFeatureOn(SUITE_LOOK_FLAG, options);
}

// The mode the page is in now: 'light' or 'dark'. For the few things that
// can't read a colour name, such as another maker's widget that only takes
// "light" or "dark". Everything else uses the colour names and never asks.
export function currentTheme(doc = typeof document !== 'undefined' ? document : null) {
  const root = doc?.documentElement;
  if (root?.getAttribute?.('data-look') !== 'suite') return 'dark';
  return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Put the look (or its absence) on the page. Returns the mode in use, or null
// when the look is off.
export function applySuiteLook({
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  storage = safeStorage(),
  on = isSuiteLookOn({ storage }),
} = {}) {
  const root = doc?.documentElement;
  if (!root) return null;
  if (!on) {
    root.removeAttribute('data-look');
    root.removeAttribute('data-theme');
    try { storage?.removeItem(LOOK_CACHE_KEY); } catch { /* blocked storage */ }
    return null;
  }
  const theme = resolveTheme(readAppearance(storage), prefersDark(win));
  root.setAttribute('data-look', 'suite');
  root.setAttribute('data-theme', theme);
  try { storage?.setItem(LOOK_CACHE_KEY, '1'); } catch { /* blocked storage */ }
  doc.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  doc.querySelector?.('meta[name="color-scheme"]')?.setAttribute('content', theme);
  return theme;
}

export function writeAppearance(value, { storage = safeStorage(), win = typeof window !== 'undefined' ? window : null } = {}) {
  const appearance = APPEARANCE_CHOICES.includes(value) ? value : APPEARANCE_DEFAULT;
  appearanceMemo = appearance;
  try { storage?.setItem(APPEARANCE_KEY, appearance); } catch { /* blocked storage */ }
  applySuiteLook({ storage, win });
  try { win?.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: { appearance } })); } catch { /* no window */ }
  return appearance;
}

// Called once at load (src/main.jsx). Keeps the page in step when the device
// changes mode (Match system) and when another window changes the setting.
export function installSuiteLook({ win = typeof window !== 'undefined' ? window : null } = {}) {
  const theme = applySuiteLook({ win });
  if (theme === null || !win) return theme;
  const again = () => applySuiteLook({ win });
  try {
    const media = win.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', again);
  } catch { /* no matchMedia */ }
  win.addEventListener?.('storage', (event) => {
    if (!event || event.key == null || event.key === APPEARANCE_KEY) again();
  });
  return theme;
}

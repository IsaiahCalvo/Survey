/**
 * chromeInsets.js - where the app's chrome edges sit right now, for the few
 * things that line up with them: the side rails' widths and the bottom of the
 * top bar (with and without the tool settings row).
 *
 * Owner 2026-10-27 (smooth tab switches, docs/TAB-SWITCHING.md): the rails and
 * AppShell used to publish these as custom properties on :root. Every element
 * inherits a custom property set there, so each change made the browser
 * restyle the whole document - about 100 ms on a 36-sheet drawing set (~12k
 * elements). A switch between tabs with different panels open, or one with
 * the Survey row and one without, paid that three times. Now they publish
 * here, and each consumer sets the same properties on itself with
 * chromeInsetVars(), so the CSS that reads them is unchanged:
 *   - StorageFailureBanner: all four;
 *   - TextSelectionActionBar: the top (its link form's height cap).
 * Phone-only CSS (mobilePdfViewer.css, the locked-document banner) still
 * reads --app-chrome-top from :root, so AppShell keeps writing that one there
 * on the phone, where only the front tab's chrome exists.
 *
 * Values are CSS lengths ('308px'); null means "not published", and the CSS
 * falls back to its default.
 */
const VARS = {
  left: '--app-sidebar-width',
  right: '--app-right-rail-width',
  top: '--app-chrome-top',
  bannerTop: '--app-banner-top',
};

let insets = Object.freeze({ left: null, right: null, top: null, bannerTop: null });
const listeners = new Set();

export function getChromeInsets() {
  return insets;
}

export function subscribeChromeInsets(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** key: 'left' | 'right' | 'top' | 'bannerTop'; value: a CSS length, or null to clear. */
export function publishChromeInset(key, value) {
  if (!(key in VARS)) return;
  const next = value == null ? null : String(value);
  if (insets[key] === next) return;
  insets = Object.freeze({ ...insets, [key]: next });
  listeners.forEach((listener) => { try { listener(); } catch { /* never breaks the others */ } });
}

/** The inline custom properties for a consumer (only those published, of `keys`). */
export function chromeInsetVars(current = insets, keys = Object.keys(VARS)) {
  const vars = {};
  for (const key of keys) if (current[key] != null) vars[VARS[key]] = current[key];
  return vars;
}

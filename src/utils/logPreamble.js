// UX 2026-04-22: Every Save Log stamps a header with app version, runtime
// (dev / installer / simulator), device model, OS, screen size, and a
// local timestamp. Keeps triage Issues self-describing so we can tell at
// a glance which build a bug came from without asking.

/* global __APP_VERSION__ */

const safe = (fn, fallback = 'unknown') => {
  try {
    const value = fn();
    return value ? String(value) : fallback;
  } catch {
    return fallback;
  }
};

const detectPlatform = () => {
  if (typeof window === 'undefined') return 'unknown';
  if (window.electronAPI) return 'desktop';
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const ua = navigator.userAgent || '';
      if (/iPad/i.test(ua)) return 'ipad';
      if (/iPhone/i.test(ua)) return 'iphone';
      if (/Android/i.test(ua)) return 'android';
      return 'mobile';
    }
  } catch {}
  return 'web';
};

const detectRuntime = () => {
  // UX 2026-04-22: dev vs installer detection. Vite's import.meta.env.DEV is
  // the primary signal but can be undefined in Electron-wrapped builds where
  // the renderer loads over file:// or where Vite's static replacement didn't
  // see this file. Fall back to location-based check: Electron dev points the
  // renderer at the Vite dev server (http://localhost:...), installed builds
  // load from file://. That makes dev vs shipped unambiguous on every platform.
  try {
    if (import.meta?.env?.DEV) return 'dev-server';
  } catch {}
  if (typeof window !== 'undefined') {
    const loc = window.location;
    const isLocalDevUrl = loc && (
      loc.protocol === 'http:' || loc.protocol === 'https:'
    ) && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(loc.hostname || '');
    if (isLocalDevUrl && window.electronAPI) return 'dev-server';
    if (window.electronAPI) return 'desktop-installer';
    if (window.Capacitor?.isNativePlatform?.()) return 'mobile-build';
  }
  return 'web';
};

const detectOS = () => {
  const ua = safe(() => navigator.userAgent);
  const matches = [
    [/Windows NT ([\d.]+)/, 'Windows'],
    [/Mac OS X ([\d_]+)/, 'macOS'],
    [/iPhone OS ([\d_]+)/, 'iOS'],
    [/CPU OS ([\d_]+) like Mac OS X/, 'iOS'],
    [/Android ([\d.]+)/, 'Android'],
    [/Linux/, 'Linux']
  ];
  for (const [rx, label] of matches) {
    const m = ua.match(rx);
    if (m) {
      const ver = (m[1] || '').replace(/_/g, '.');
      return ver ? `${label} ${ver}` : label;
    }
  }
  return 'unknown';
};

const detectDeviceModel = () => {
  const ua = safe(() => navigator.userAgent);
  const pixelMatch = ua.match(/sdk_gphone[0-9a-z_]+|Pixel [^;)]+/i);
  if (pixelMatch) return pixelMatch[0];
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'unknown';
};

export function buildLogPreamble({ description } = {}) {
  const version = safe(() => __APP_VERSION__, 'unknown');
  const platform = detectPlatform();
  const runtime = detectRuntime();
  const os = detectOS();
  const device = detectDeviceModel();
  const screen = safe(() => `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio || 1}x`);
  const viewport = safe(() => `${window.innerWidth}x${window.innerHeight}`);
  const lang = safe(() => navigator.language);
  const timeUtc = new Date().toISOString();
  const timeLocal = safe(() => new Date().toLocaleString());

  const lines = [];
  if (description && description.trim()) {
    lines.push(`# Description: ${description.trim()}`);
    lines.push('');
  }
  lines.push(`===== SurveyApp Save Log =====`);
  lines.push(`version:   ${version}`);
  lines.push(`runtime:   ${runtime}`);
  lines.push(`platform:  ${platform}`);
  lines.push(`device:    ${device}`);
  lines.push(`os:        ${os}`);
  lines.push(`screen:    ${screen}`);
  lines.push(`viewport:  ${viewport}`);
  lines.push(`locale:    ${lang}`);
  lines.push(`timestamp: ${timeUtc} (${timeLocal})`);
  lines.push(`==============================`);
  lines.push('');
  return lines.join('\n');
}

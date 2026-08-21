/**
 * Allowed schemes for native PDF Link annotations opened from the viewer.
 * Matches Electron `shell:openExternal` (`src/electron-main.js`) so web,
 * Electron, and Capacitor reject javascript:/data:/file:/ftp: the same way.
 * Never read pdf.js `unsafeUrl` — that field is the rejected leftover.
 */
export const PDF_EXTERNAL_LINK_PROTOCOLS = Object.freeze(['http:', 'https:', 'mailto:']);

export function isAllowedPdfExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const url = rawUrl.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return PDF_EXTERNAL_LINK_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export async function openPdfExternalUrl(rawUrl, { openExternal, openWindow } = {}) {
  if (!isAllowedPdfExternalUrl(rawUrl)) {
    return { opened: false, reason: 'disallowed' };
  }
  if (typeof openExternal === 'function') {
    try {
      await openExternal(rawUrl);
      return { opened: true, via: 'electron' };
    } catch {
      // Fall through to the window opener (same as today's Link-layer catch).
    }
  }
  if (typeof openWindow === 'function') {
    openWindow(rawUrl);
    return { opened: true, via: 'window' };
  }
  return { opened: false, reason: 'no-opener' };
}

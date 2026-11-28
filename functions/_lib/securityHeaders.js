/**
 * Security, CSP, and cache headers for Cloudflare Pages parity with vercel.json (#1685).
 * Keep these policies in sync with vercel.json (enforced by tests/cloudflarePagesConfig.test.mjs).
 */

export const MARKETING_PREFIX_RE =
  /^\/(?:welcome|features|devices|pricing|faq|status|delete-account|whats-new|use-with-ai|kal-voe|use-cases|compare|tools)(?:\/|$)/;
export const MARKETING_HTML_RE = /^\/(?:privacy|terms|404|google-connected)\.html$/;
export const TEAMS_PATH_RE = /^\/teams(?:\/|$)/;
export const WELL_KNOWN_JSON_RE = /^\/\.well-known\/(?:apple-app-site-association|assetlinks\.json)$/;

export const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
});

export const APP_CSP =
  "default-src 'self'; script-src 'self' 'sha256-BGc+jgl/EbMGuqYayQWZd27/gSnabh2TUC+dHMGaq1I=' 'sha256-dcveo2muxWvLrM7H8rn3NZpgPKxGwVXzgVaZei7nzqk=' 'sha256-n3tAjTvPpo6um2+lJHK+WmlF1AnFUNQAHQPkNhpkzMM=' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src https://huggingface.co https://*.hf.co 'self' data: blob: https://surveytool.app https://cvamwtpsuvxvjdnotbeg.supabase.co wss://cvamwtpsuvxvjdnotbeg.supabase.co https://*.r2.cloudflarestorage.com https://graph.microsoft.com https://login.microsoftonline.com https://*.sharepoint.com https://*.1drv.com https://*.livefilestore.com https://*.microsoftpersonalcontent.com https://api.onedrive.com https://www.googleapis.com; worker-src 'self' blob:; frame-src 'self' blob: https://challenges.cloudflare.com https://login.microsoftonline.com https://docs.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export const MARKETING_CSP =
  "default-src 'self'; script-src 'self' 'sha256-wsmnxD6kqdZZ/V2wQ85d92sMux2lvh7NN1y5/Y5SS5c=' 'sha256-WHLZ/YELHqy+opU9IqvqRd2140XchvBrOUUNPpZayho=' 'sha256-pPAtw/xaq8uUTJ7yw5xve/j51EShs2BaJeN83cAKRV4=' 'sha256-LD/KC18ObHl/LVNmg9OM7PRajdnDlaAvYMdx/t9v2Qk=' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob: https://cvamwtpsuvxvjdnotbeg.supabase.co; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export const TEAMS_CSP =
  "default-src 'self'; script-src 'self' 'sha256-BGc+jgl/EbMGuqYayQWZd27/gSnabh2TUC+dHMGaq1I=' 'sha256-dcveo2muxWvLrM7H8rn3NZpgPKxGwVXzgVaZei7nzqk=' 'sha256-n3tAjTvPpo6um2+lJHK+WmlF1AnFUNQAHQPkNhpkzMM=' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src https://huggingface.co https://*.hf.co 'self' data: blob: https://res.cdn.office.net https://surveytool.app https://cvamwtpsuvxvjdnotbeg.supabase.co wss://cvamwtpsuvxvjdnotbeg.supabase.co https://*.r2.cloudflarestorage.com https://graph.microsoft.com https://login.microsoftonline.com https://*.sharepoint.com https://*.1drv.com https://*.livefilestore.com https://*.microsoftpersonalcontent.com https://api.onedrive.com https://www.googleapis.com; worker-src 'self' blob:; frame-src 'self' blob: https://challenges.cloudflare.com https://login.microsoftonline.com https://docs.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft https://*.microsoft365.com https://*.office.com https://outlook.office.com https://outlook.office365.com";

export function isMarketingPath(pathname) {
  return MARKETING_PREFIX_RE.test(pathname) || MARKETING_HTML_RE.test(pathname);
}

export function headersForPath(pathname) {
  const out = { ...BASE_SECURITY_HEADERS };
  if (TEAMS_PATH_RE.test(pathname)) {
    out['Content-Security-Policy'] = TEAMS_CSP;
  } else {
    out['X-Frame-Options'] = 'DENY';
    out['Content-Security-Policy'] = isMarketingPath(pathname) ? MARKETING_CSP : APP_CSP;
  }
  if (WELL_KNOWN_JSON_RE.test(pathname)) {
    out['Content-Type'] = 'application/json';
  }
  if (pathname.startsWith('/assets/')) {
    out['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else if (pathname.startsWith('/ocr/')) {
    out['Cache-Control'] = 'public, max-age=2592000';
  }
  return out;
}

export function applySecurityHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  const rules = headersForPath(pathname);
  for (const [key, value] of Object.entries(rules)) {
    // Preserve explicit no-store set by API handlers (e.g. /api/analytics/track).
    if (key === 'Cache-Control' && headers.has('Cache-Control')) continue;
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

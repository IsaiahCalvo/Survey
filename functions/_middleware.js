import { applySecurityHeaders } from './_lib/securityHeaders.js';

const KAL_VOE_HOST = 'kalvoe.com';
const KAL_VOE_PAGE = '/kal-voe/';
const KAL_VOE_ROOT = '/kal-voe';

// Other apps' subdomains, if ever attached to this Pages project, send visitors
// to that app. survey.kalvoe.com is not here: it serves Survey itself, as it does
// on Vercel today, so sign-ins and saved work on that address keep working.
const KAL_VOE_APP_HOSTS = new Map([
  ['walkthru.kalvoe.com', 'https://walkthru.tools'],
  ['plot.kalvoe.com', 'https://plot-taupe-eight.vercel.app'],
]);

// Paths on kalvoe.com that keep their normal Survey handling.
function isKalVoePassthrough(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/assets/') ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/') ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/privacy.html' ||
    pathname === '/terms.html'
  );
}

function hasExtension(pathname) {
  return (pathname.split('/').pop() || '').includes('.');
}

// The suite site lives in public/kal-voe/ and is served at the root of kalvoe.com:
// kalvoe.com/pricing -> /kal-voe/pricing/index.html. Returns null to fall through.
async function serveKalVoe(url, request, env) {
  const { pathname } = url;
  if (isKalVoePassthrough(pathname)) return null;

  if (pathname === '/' && (url.searchParams.has('signin') || url.searchParams.has('signup'))) {
    const surveyUrl = new URL('/', 'https://surveytool.app');
    surveyUrl.search = url.search;
    return applySecurityHeaders(Response.redirect(surveyUrl.toString(), 302), KAL_VOE_PAGE);
  }

  // Old /kal-voe/... page URLs move to the root. Files under /kal-voe/ (logo, static) still load.
  if (pathname === KAL_VOE_ROOT || (pathname.startsWith(`${KAL_VOE_ROOT}/`) && !hasExtension(pathname))) {
    const target = new URL(url);
    target.pathname = pathname.slice(KAL_VOE_ROOT.length).replace(/\/+$/, '') || '/';
    return applySecurityHeaders(Response.redirect(target.toString(), 308), KAL_VOE_PAGE);
  }
  if (pathname.startsWith(`${KAL_VOE_ROOT}/`)) return null;

  // One URL per page: /pricing/ -> /pricing.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const target = new URL(url);
    target.pathname = pathname.replace(/\/+$/, '');
    return applySecurityHeaders(Response.redirect(target.toString(), 308), KAL_VOE_PAGE);
  }

  if (!env?.ASSETS?.fetch) return null;
  const assetPath = hasExtension(pathname)
    ? `${KAL_VOE_ROOT}${pathname}`
    : `${KAL_VOE_ROOT}${pathname === '/' ? '/' : `${pathname}/`}`;
  const res = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin).toString(), request));
  if (res.ok) return applySecurityHeaders(res, assetPath);

  const notFound = await env.ASSETS.fetch(new Request(new URL(`${KAL_VOE_ROOT}/404.html`, url.origin).toString(), request));
  const body = notFound.ok ? notFound.body : 'Not found';
  const headers = new Headers(notFound.ok ? notFound.headers : { 'Content-Type': 'text/plain; charset=utf-8' });
  return applySecurityHeaders(new Response(body, { status: 404, statusText: 'Not Found', headers }), `${KAL_VOE_ROOT}/404.html`);
}

const PERMANENT_REDIRECTS = new Map([
  ['/privacy', '/privacy.html'],
  ['/terms', '/terms.html'],
]);

const NESTED_ASSET_RE = /^\/.+\/assets\/(.+)$/;

function isSpaFallbackCandidate(pathname, method) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname.startsWith('/api/') || pathname.startsWith('/assets/') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    return false;
  }
  if (pathname.startsWith('/.well-known/')) return false;
  // Direct requests for explicit static files (e.g. /404.html, /foo.png) keep their status.
  const lastSegment = pathname.split('/').pop() || '';
  if (lastSegment.includes('.')) return false;
  return true;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;

  if (url.hostname === `www.${KAL_VOE_HOST}`) {
    url.protocol = 'https:';
    url.hostname = KAL_VOE_HOST;
    url.port = '';
    return applySecurityHeaders(Response.redirect(url.toString(), 308), pathname);
  }

  const appHost = KAL_VOE_APP_HOSTS.get(url.hostname);
  if (appHost) {
    const target = new URL(pathname + url.search, appHost);
    return applySecurityHeaders(Response.redirect(target.toString(), 302), pathname);
  }

  if (url.hostname === KAL_VOE_HOST && (request.method === 'GET' || request.method === 'HEAD')) {
    const suite = await serveKalVoe(url, request, env);
    if (suite) return suite;
  } else if (pathname === KAL_VOE_ROOT || (pathname.startsWith(`${KAL_VOE_ROOT}/`) && !hasExtension(pathname))) {
    // Parity with vercel.json: suite pages on other hosts send visitors to kalvoe.com.
    const target = new URL(pathname.slice(KAL_VOE_ROOT.length) || '/', `https://${KAL_VOE_HOST}`);
    target.search = url.search;
    return applySecurityHeaders(Response.redirect(target.toString(), 302), KAL_VOE_PAGE);
  }

  const redirectTarget = PERMANENT_REDIRECTS.get(pathname);
  if (redirectTarget) {
    return applySecurityHeaders(
      Response.redirect(new URL(redirectTarget, url.origin).toString(), 301),
      pathname,
    );
  }

  // Parity with vercel.json: /(.*)/assets/(.*) -> /assets/$2
  const nestedAsset = NESTED_ASSET_RE.exec(pathname);
  if (nestedAsset && env?.ASSETS?.fetch) {
    const assetUrl = new URL(`/assets/${nestedAsset[1]}`, url.origin);
    const assetRes = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    return applySecurityHeaders(assetRes, `/assets/${nestedAsset[1]}`);
  }

  let response = await context.next();

  // Cloudflare Pages disables automatic SPA fallback when dist/404.html exists.
  // Serve /index.html for app routes (e.g. /teams, /agent-link, /share/...) while
  // letting real static marketing pages (/welcome, /pricing, /tools/*) serve normally.
  if (response.status === 404 && isSpaFallbackCandidate(pathname, request.method) && env?.ASSETS?.fetch) {
    // Ask for "/" rather than "/index.html": Pages answers /index.html with a
    // 308 redirect to "/", which is not ok() and left app routes as 404s.
    const indexRes = await env.ASSETS.fetch(new Request(new URL('/', url.origin).toString(), request));
    if (indexRes.ok) {
      response = new Response(indexRes.body, {
        status: 200,
        statusText: 'OK',
        headers: indexRes.headers,
      });
    }
  }

  return applySecurityHeaders(response, pathname);
}

import { applySecurityHeaders } from './_lib/securityHeaders.js';

const KAL_VOE_HOST = 'kalvoe.com';
const KAL_VOE_PAGE = '/kal-voe/';

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

  if (url.hostname === KAL_VOE_HOST && (request.method === 'GET' || request.method === 'HEAD')) {
    if (pathname === '/kal-voe' || pathname === KAL_VOE_PAGE) {
      url.pathname = '/';
      return applySecurityHeaders(Response.redirect(url.toString(), 308), KAL_VOE_PAGE);
    }

    if (pathname === '/') {
      if (url.searchParams.has('signin') || url.searchParams.has('signup')) {
        const surveyUrl = new URL('/', 'https://surveytool.app');
        surveyUrl.search = url.search;
        return applySecurityHeaders(Response.redirect(surveyUrl.toString(), 302), KAL_VOE_PAGE);
      }

      const page = await env.ASSETS.fetch(new Request(new URL(KAL_VOE_PAGE, url), request));
      return applySecurityHeaders(page, KAL_VOE_PAGE);
    }
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
    const indexRes = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString(), request));
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
